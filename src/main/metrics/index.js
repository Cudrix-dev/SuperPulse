/**
 * MetricsService — collects hardware telemetry on independent cadences and
 * publishes one merged snapshot per second.
 *
 *   fast  (1 s)  CPU load, per-core load, memory, network throughput
 *   gpu   (2 s)  GPU utilisation / VRAM / temperature (nvidia-smi via systeminformation)
 *   slow (10 s)  storage volumes, swap, CPU temperature
 *
 * Expensive collectors pause while the dashboard is minimised. Every loop
 * re-schedules itself only after the previous run finished, so slow
 * PowerShell / WMI calls can never pile up.
 */
'use strict';

const os = require('node:os');
const { EventEmitter } = require('node:events');
const si = require('systeminformation');

const { CpuSampler } = require('./cpu-sampler');
const { NetworkSampler } = require('./network-sampler');

const INTERVALS = Object.freeze({ fast: 1000, gpu: 2000, slow: 10000 });

/** Picks the most useful GPU: one that reports live utilisation, else the one with most VRAM. */
function pickPrimaryGpu(controllers = []) {
  const real = controllers.filter((c) => (c.vram ?? 0) > 0 || c.utilizationGpu != null);
  const withTelemetry = real.filter((c) => Number.isFinite(c.utilizationGpu));
  const pool = withTelemetry.length ? withTelemetry : real;
  return pool.sort((a, b) => (b.vram ?? 0) - (a.vram ?? 0))[0] ?? null;
}

const finiteOrNull = (value) => (Number.isFinite(value) && value >= 0 ? value : null);

class MetricsService extends EventEmitter {
  constructor() {
    super();
    this.cpuSampler = new CpuSampler();
    this.networkSampler = new NetworkSampler();
    this.active = true;
    this.running = false;
    this.heavyStarted = false;
    this.timers = new Set();
    this.staticInfoPromise = null;

    /** Latest merged snapshot, sent to the renderer. */
    this.snapshot = {
      timestamp: Date.now(),
      cpu: { load: 0, cores: [], temperature: null },
      memory: { total: os.totalmem(), used: 0, percent: 0, swapTotal: null, swapUsed: null },
      gpu: null,
      network: null,
      disks: [],
      uptime: os.uptime(),
    };
  }

  /**
   * Starts the collection loops. Safe to call once.
   * @param {object} [options]
   * @param {boolean} [options.deferHeavy=false] start only the cheap 1 s loop
   *   for now; call `startHeavy()` later (keeps the main thread quiet while
   *   the splash animates)
   */
  start({ deferHeavy = false } = {}) {
    if (this.running) return;
    this.running = true;

    // On Windows, keep one PowerShell process alive for systeminformation
    // instead of spawning a new one for every query.
    if (process.platform === 'win32' && typeof si.powerShellStart === 'function') {
      si.powerShellStart();
    }

    // The first CPU/OS query can take seconds on Windows: warm the cache now
    // so the dashboard has it by the time the splash finishes.
    this.getStaticInfo();

    this.loop('fast', INTERVALS.fast, () => this.collectFast(), { always: true });
    if (!deferHeavy) this.startHeavy();
  }

  /** Starts the GPU and storage collectors (idempotent). */
  startHeavy() {
    if (!this.running || this.heavyStarted) return;
    this.heavyStarted = true;
    this.loop('gpu', INTERVALS.gpu, () => this.collectGpu());
    this.loop('slow', INTERVALS.slow, () => this.collectSlow());
  }

  stop() {
    this.running = false;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    if (process.platform === 'win32' && typeof si.powerShellRelease === 'function') {
      si.powerShellRelease();
    }
  }

  /** Pauses the expensive collectors (e.g. while the window is minimised). */
  setActive(active) {
    this.active = Boolean(active);
  }

  /**
   * Runs `task` now and then every `interval` ms after it completes.
   * @param {boolean} [options.always] keep running even when inactive
   */
  loop(name, interval, task, { always = false } = {}) {
    const run = async () => {
      if (!this.running) return;
      if (always || this.active) {
        try {
          await task();
        } catch (error) {
          console.warn(`[metrics:${name}]`, error?.message ?? error);
        }
      }
      if (!this.running) return;
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        run();
      }, interval);
      this.timers.add(timer);
    };
    run();
  }

  // ── Collectors ─────────────────────────────────────────────────────────

  async collectFast() {
    const { load, cores } = this.cpuSampler.sample();
    const total = os.totalmem();
    const used = total - os.freemem();
    const network = await this.networkSampler.sample().catch(() => null);

    Object.assign(this.snapshot, {
      timestamp: Date.now(),
      uptime: os.uptime(),
      network: network ?? this.snapshot.network,
    });
    Object.assign(this.snapshot.cpu, { load, cores });
    Object.assign(this.snapshot.memory, { total, used, percent: (used / total) * 100 });

    this.emit('update', this.snapshot);
  }

  async collectGpu() {
    const { controllers } = await si.graphics();
    const gpu = pickPrimaryGpu(controllers);
    if (!gpu) {
      this.snapshot.gpu = null;
      return;
    }

    const memoryTotal = finiteOrNull(gpu.memoryTotal) ?? finiteOrNull(gpu.vram);
    this.snapshot.gpu = {
      model: gpu.model || gpu.name || 'Graphics adapter',
      vendor: gpu.vendor || '',
      load: finiteOrNull(gpu.utilizationGpu),
      memoryUsed: finiteOrNull(gpu.memoryUsed),
      memoryTotal,
      temperature: finiteOrNull(gpu.temperatureGpu),
      power: finiteOrNull(gpu.powerDraw),
      clockCore: finiteOrNull(gpu.clockCore),
    };
  }

  async collectSlow() {
    const [volumes, memory, temperature] = await Promise.allSettled([
      si.fsSize(),
      si.mem(),
      si.cpuTemperature(),
    ]);

    if (volumes.status === 'fulfilled') {
      this.snapshot.disks = volumes.value
        .filter((v) => v.size > 0)
        .map((v) => ({
          mount: v.mount || v.fs,
          type: v.type || '',
          size: v.size,
          used: v.used,
          percent: v.size ? (v.used / v.size) * 100 : 0,
        }));
    }

    if (memory.status === 'fulfilled') {
      this.snapshot.memory.swapTotal = memory.value.swaptotal ?? null;
      this.snapshot.memory.swapUsed = memory.value.swapused ?? null;
    }

    if (temperature.status === 'fulfilled') {
      // Usually null on Windows unless the app runs elevated (ACPI thermal zones).
      this.snapshot.cpu.temperature = finiteOrNull(temperature.value.main);
    }
  }

  /** Hardware facts that never change during a session (cached). */
  getStaticInfo() {
    if (!this.staticInfoPromise) {
      this.staticInfoPromise = Promise.allSettled([si.cpu(), si.osInfo()]).then(([cpu, osInfo]) => {
        const c = cpu.status === 'fulfilled' ? cpu.value : {};
        const o = osInfo.status === 'fulfilled' ? osInfo.value : {};
        const fallbackCpu = os.cpus()[0]?.model?.trim() ?? 'Processor';
        return {
          cpu: {
            brand: [c.manufacturer, c.brand].filter(Boolean).join(' ') || fallbackCpu,
            physicalCores: c.physicalCores || null,
            threads: c.cores || os.cpus().length,
          },
          os: {
            name: o.distro || `${os.type()} ${os.release()}`,
            build: o.build || os.release(),
            arch: o.arch || os.arch(),
            hostname: o.hostname || os.hostname(),
          },
          memoryTotal: os.totalmem(),
        };
      });
    }
    return this.staticInfoPromise;
  }
}

module.exports = { MetricsService, INTERVALS };
