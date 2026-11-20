/**
 * CPU load sampler based on `os.cpus()` tick counters.
 *
 * Each call to `sample()` returns utilisation since the previous call, both
 * overall and per logical core. This costs nothing beyond reading kernel
 * counters, so it is safe to run every second.
 */
'use strict';

const os = require('node:os');

/** Sums every time bucket of a core (user, nice, sys, idle, irq). */
const totalTicks = (times) => times.user + times.nice + times.sys + times.idle + times.irq;

class CpuSampler {
  constructor() {
    this.previous = os.cpus().map((cpu) => cpu.times);
  }

  /**
   * @returns {{ load: number, cores: number[] }} percentages in the 0–100 range
   */
  sample() {
    const current = os.cpus().map((cpu) => cpu.times);
    let busySum = 0;
    let totalSum = 0;

    const cores = current.map((times, index) => {
      const before = this.previous[index] ?? times;
      const total = totalTicks(times) - totalTicks(before);
      const idle = times.idle - before.idle;
      busySum += total - idle;
      totalSum += total;
      return total > 0 ? clampPercent(((total - idle) / total) * 100) : 0;
    });

    this.previous = current;
    return {
      load: totalSum > 0 ? clampPercent((busySum / totalSum) * 100) : 0,
      cores,
    };
  }
}

function clampPercent(value) {
  return Math.min(100, Math.max(0, value));
}

module.exports = { CpuSampler };
