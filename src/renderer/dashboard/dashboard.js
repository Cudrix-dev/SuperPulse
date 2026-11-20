/**
 * Dashboard controller — binds live metrics from the main process to the UI.
 *
 * Data flow:  MetricsService (main) ──metrics:update──▶ preload ──▶ render()
 * Everything here is pure DOM work; no Node APIs are reachable.
 */

import { Waveform } from './components/waveform.js';
import { RingGauge } from './components/ring-gauge.js';
import {
  DASH,
  formatBytes,
  formatMegabytes,
  formatPercent,
  formatTemperature,
  formatUptime,
  severity,
  splitRate,
} from './format.js';

const api = window.superpulse;
const root = document.documentElement;
root.dataset.material = new URLSearchParams(location.search).get('material') ?? 'none';

// ── Small DOM helpers ────────────────────────────────────────────────────

const byId = (id) => document.getElementById(id);

/** Updates text only when it changed (avoids needless layout work). */
function setText(id, text) {
  const el = typeof id === 'string' ? byId(id) : id;
  if (el && el.textContent !== text) el.textContent = text;
}

/** Sets a 0–100 meter fill and its severity colour. */
function setMeter(id, percent) {
  const el = byId(id);
  const value = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  el.style.transform = `scaleX(${value / 100})`;
  el.dataset.level = severity(percent);
}

function setRate(valueId, unitId, bytesPerSecond) {
  const { value, unit } = splitRate(bytesPerSecond);
  setText(valueId, value);
  setText(unitId, unit);
}

// ── Components ───────────────────────────────────────────────────────────

const cpuWave = new Waveform(byId('cpu-wave'), { capacity: 60, max: 100, gridLines: 3 });

const netWave = new Waveform(byId('net-wave'), {
  capacity: 40,
  max: null, // autoscale
  minScale: 64 * 1024,
  gridLines: 1,
  series: [
    { stroke: ['#60cdff', '#60cdff'], fill: 'rgba(96, 205, 255, 0.14)', glow: 'rgba(96, 205, 255, 0.5)' },
    { stroke: ['#9a86ff', '#9a86ff'], fill: 'rgba(154, 134, 255, 0.08)', glow: 'rgba(154, 134, 255, 0.45)', width: 1.6 },
  ],
});

const memGauge = new RingGauge(byId('mem-gauge'));
const gpuGauge = new RingGauge(byId('gpu-gauge'), { colors: ['#9a86ff', '#60cdff'] });

/** Per-core vertical bars, created once the core count is known. */
const coreBars = {
  host: byId('cores'),
  fills: [],

  ensure(count) {
    if (this.fills.length === count) return;
    this.host.replaceChildren();
    this.fills = Array.from({ length: count }, () => {
      const core = document.createElement('div');
      core.className = 'core';
      const fill = document.createElement('span');
      fill.className = 'core__fill';
      core.append(fill);
      this.host.append(core);
      return fill;
    });
    // One row for up to 16 cores, then wrap into balanced rows.
    const rows = Math.ceil(count / 16);
    this.host.style.setProperty('--cols', String(Math.ceil(count / rows)));
    this.host.style.setProperty('--bar-height', `${rows > 1 ? Math.max(18, 44 / rows + 6) : 44}px`);
  },

  update(cores) {
    this.ensure(cores.length);
    cores.forEach((load, i) => {
      this.fills[i].style.transform = `scaleY(${Math.max(0.02, load / 100)})`;
    });
  },
};

/** Storage rows keyed by mount point so existing rows animate smoothly. */
const diskList = {
  host: byId('disks'),
  rows: new Map(),

  update(disks) {
    const seen = new Set();
    for (const disk of disks) {
      seen.add(disk.mount);
      let row = this.rows.get(disk.mount);
      if (!row) {
        row = this.createRow(disk);
        this.rows.set(disk.mount, row);
        this.host.append(row.el);
      }
      setText(row.usage, `${formatBytes(disk.used)} / ${formatBytes(disk.size)}`);
      const pct = Math.min(100, Math.max(0, disk.percent));
      row.fill.style.transform = `scaleX(${pct / 100})`;
      row.fill.dataset.level = severity(disk.percent);
    }
    for (const [mount, row] of this.rows) {
      if (!seen.has(mount)) {
        row.el.remove();
        this.rows.delete(mount);
      }
    }
    setText('disk-badge', disks.length === 1 ? '1 volume' : `${disks.length} volumes`);
  },

  createRow(disk) {
    const el = document.createElement('li');
    el.className = 'meter';
    el.innerHTML = `
      <div class="meter__label">
        <span><span class="disk__name"></span><span class="disk__type"></span></span>
        <span class="disk__usage"></span>
      </div>
      <div class="meter__track"><span class="meter__fill"></span></div>`;
    el.querySelector('.disk__name').textContent = disk.mount;
    el.querySelector('.disk__type').textContent = disk.type;
    return { el, usage: el.querySelector('.disk__usage'), fill: el.querySelector('.meter__fill') };
  },
};

// ── Rendering ────────────────────────────────────────────────────────────

function renderStatic(info, appInfo) {
  if (info) {
    setText('cpu-model', info.cpu.brand);
    setText('cpu-threads', `${info.cpu.threads} threads`);
    setText('cpu-physical', info.cpu.physicalCores ? String(info.cpu.physicalCores) : DASH);
    setText('mem-badge', `${formatBytes(info.memoryTotal, 0)} total`);
    setText('sys-os', info.os.name);
    setText('sys-build', info.os.build);
    setText('sys-host', info.os.hostname);
    setText('sys-arch', info.os.arch);
  }
  if (appInfo) setText('app-version', `SuperPulse v${appInfo.version}`);
}

let lastTimestamp = 0;

function render(snapshot) {
  if (!snapshot || snapshot.timestamp === lastTimestamp) return;
  lastTimestamp = snapshot.timestamp;

  const { cpu, memory, gpu, network, disks, uptime } = snapshot;

  // Processor
  setText('cpu-load', formatPercent(cpu.load));
  cpuWave.push(cpu.load);
  if (cpu.cores.length) {
    coreBars.update(cpu.cores);
    setText('cpu-peak', `${formatPercent(Math.max(...cpu.cores))} %`);
  }
  setText('cpu-temp', cpu.temperature != null ? formatTemperature(cpu.temperature) : 'N/A');
  byId('cpu-temp').title =
    cpu.temperature != null ? '' : 'Windows only exposes CPU temperature to elevated processes on most devices.';

  // Memory
  setText('mem-percent', formatPercent(memory.percent));
  setText('hero-mem', formatPercent(memory.percent));
  memGauge.set(memory.percent);
  setText('mem-used', formatBytes(memory.used));
  setText('mem-free', formatBytes(memory.total - memory.used));
  if (Number.isFinite(memory.swapTotal) && memory.swapTotal > 0) {
    setText('swap-text', `${formatBytes(memory.swapUsed)} / ${formatBytes(memory.swapTotal)}`);
    setMeter('swap-fill', (memory.swapUsed / memory.swapTotal) * 100);
  }

  // Graphics
  renderGpu(gpu);

  // Network
  if (network) {
    setRate('net-down', 'net-down-unit', network.rxPerSec);
    setRate('net-up', 'net-up-unit', network.txPerSec);
    setRate('hero-net', 'hero-net-unit', network.rxPerSec);
    netWave.push(network.rxPerSec, network.txPerSec);
  }

  // Storage & system
  if (disks.length) diskList.update(disks);
  setText('sys-uptime', formatUptime(uptime));

  heartbeat();
}

function renderGpu(gpu) {
  if (!gpu) {
    setText('gpu-model', 'No dedicated telemetry');
    setText('hero-gpu', DASH);
    setText('gpu-percent', DASH);
    gpuGauge.set(null);
    return;
  }

  const vendor = gpu.vendor.split(/[\s,]/)[0] || 'GPU';
  setText('gpu-vendor', vendor);
  setText('gpu-model', gpu.model);
  byId('gpu-model').title = gpu.model;
  setText('gpu-percent', formatPercent(gpu.load));
  setText('hero-gpu', formatPercent(gpu.load));
  gpuGauge.set(gpu.load);
  setText('gpu-temp', formatTemperature(gpu.temperature));
  setText('gpu-power', Number.isFinite(gpu.power) ? `${gpu.power.toFixed(1)} W` : DASH);

  if (Number.isFinite(gpu.memoryUsed) && Number.isFinite(gpu.memoryTotal) && gpu.memoryTotal > 0) {
    setText('vram-text', `${formatMegabytes(gpu.memoryUsed)} / ${formatMegabytes(gpu.memoryTotal)}`);
    setMeter('vram-fill', (gpu.memoryUsed / gpu.memoryTotal) * 100);
  } else {
    setText('vram-text', gpu.memoryTotal ? `${formatMegabytes(gpu.memoryTotal)} VRAM` : DASH);
  }
}

/** Pulses the "Live" indicator once per sample. */
function heartbeat() {
  byId('live-dot').animate(
    [
      { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(96, 205, 255, 0.55)' },
      { transform: 'scale(1.25)', boxShadow: '0 0 0 6px rgba(96, 205, 255, 0)' },
      { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(96, 205, 255, 0)' },
    ],
    { duration: 900, easing: 'cubic-bezier(0.1, 0.9, 0.2, 1)' },
  );
}

// ── Entrance & pointer light ─────────────────────────────────────────────

document.querySelectorAll('[data-reveal]').forEach((el, i) => el.style.setProperty('--i', String(i)));

function reveal() {
  root.classList.remove('is-revealed');
  void root.offsetWidth; // restart the CSS animation
  root.classList.add('is-revealed');
}

// Feeds the pointer position to the hovered card for the "reveal" light.
document.addEventListener(
  'pointermove',
  (event) => {
    const card = event.target instanceof Element ? event.target.closest('.card') : null;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
    card.style.setProperty('--my', `${event.clientY - rect.top}px`);
  },
  { passive: true },
);

// ── Boot ─────────────────────────────────────────────────────────────────

async function init() {
  if (!api) {
    // Opened outside Electron (e.g. in a browser for layout work).
    reveal();
    return;
  }

  api.onReveal(reveal);
  api.onMetrics(render);

  const [info, appInfo, snapshot] = await Promise.all([
    api.getStaticInfo().catch(() => null),
    api.getAppInfo().catch(() => null),
    api.getSnapshot().catch(() => null),
  ]);
  renderStatic(info, appInfo);
  render(snapshot);
}

init();
