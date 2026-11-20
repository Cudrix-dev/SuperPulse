/**
 * Network throughput sampler.
 *
 * On Windows the aggregate byte counters printed by `netstat -e` are the
 * most reliable and cheapest source (≈ 30 ms, no WMI, works on every
 * locale because only the numeric row is parsed). Other platforms fall
 * back to systeminformation's per-interface statistics.
 */
'use strict';

const { execFile } = require('node:child_process');
const si = require('systeminformation');

/** Reads cumulative received/sent bytes across all interfaces. */
function readWindowsCounters() {
  return new Promise((resolve, reject) => {
    execFile('netstat', ['-e'], { windowsHide: true, timeout: 4000 }, (error, stdout) => {
      if (error) return reject(error);
      // The first row with exactly two integers is the "Bytes" row,
      // whatever language the label is printed in.
      for (const line of stdout.split(/\r?\n/)) {
        const match = line.match(/^\s*\S.*?\s+(\d+)\s+(\d+)\s*$/);
        if (match) return resolve({ rx: Number(match[1]), tx: Number(match[2]) });
      }
      reject(new Error('Unexpected netstat output'));
    });
  });
}

async function readGenericCounters() {
  const stats = await si.networkStats('*');
  return stats.reduce(
    (sum, iface) => ({ rx: sum.rx + (iface.rx_bytes || 0), tx: sum.tx + (iface.tx_bytes || 0) }),
    { rx: 0, tx: 0 },
  );
}

class NetworkSampler {
  constructor() {
    this.previous = null;
    this.read = process.platform === 'win32' ? readWindowsCounters : readGenericCounters;
  }

  /**
   * @returns {Promise<{ rxPerSec: number, txPerSec: number } | null>}
   *   bytes per second since the previous call, or null for the first call.
   */
  async sample() {
    const counters = await this.read();
    const at = performance.now();
    const previous = this.previous;
    this.previous = { ...counters, at };
    if (!previous) return null;

    const seconds = (at - previous.at) / 1000;
    const rx = counters.rx - previous.rx;
    const tx = counters.tx - previous.tx;
    // Counters may wrap around or reset when adapters change: skip that tick.
    if (seconds <= 0 || rx < 0 || tx < 0) return null;
    return { rxPerSec: rx / seconds, txPerSec: tx / seconds };
  }
}

module.exports = { NetworkSampler };
