/**
 * Display formatting helpers. Every helper renders an em dash for
 * missing values so the UI never shows "NaN" or "undefined".
 */

export const DASH = '—';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/** 1536 → "1.5 KB" (binary units, as Windows Explorer shows them). */
export function formatBytes(bytes, decimals = 1) {
  if (!Number.isFinite(bytes) || bytes < 0) return DASH;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const exponent = Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 100 ? 0 : decimals)} ${UNITS[exponent]}`;
}

/** Splits a byte rate into value and unit, e.g. { value: "1.2", unit: "MB/s" }. */
export function splitRate(bytesPerSecond) {
  const text = formatBytes(bytesPerSecond);
  if (text === DASH) return { value: DASH, unit: '' };
  const [value, unit] = text.split(' ');
  return { value, unit: `${unit}/s` };
}

export function formatRate(bytesPerSecond) {
  const { value, unit } = splitRate(bytesPerSecond);
  return unit ? `${value} ${unit}` : value;
}

/** Megabytes (as reported by GPU drivers) → human readable. */
export function formatMegabytes(mb) {
  return Number.isFinite(mb) ? formatBytes(mb * 1024 * 1024) : DASH;
}

export function formatPercent(value, decimals = 0) {
  return Number.isFinite(value) ? value.toFixed(decimals) : DASH;
}

export function formatTemperature(celsius) {
  return Number.isFinite(celsius) ? `${Math.round(celsius)} °C` : DASH;
}

/** 273600 → "3d 4h 0m". */
export function formatUptime(seconds) {
  if (!Number.isFinite(seconds)) return DASH;
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
}

/** Maps a utilisation percentage to a severity level used for colouring. */
export function severity(percent) {
  if (!Number.isFinite(percent)) return 'idle';
  if (percent >= 90) return 'critical';
  if (percent >= 75) return 'warn';
  return 'ok';
}
