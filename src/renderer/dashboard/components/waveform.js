/**
 * Waveform — a smoothly scrolling, glowing real-time line chart on canvas.
 *
 * - Samples arrive at a fixed interval; between samples the chart scrolls
 *   continuously, so motion never stutters at 1 Hz.
 * - Lines are Catmull-Rom splines (they pass through every sample).
 * - The newest point carries a glowing "pulse" head with a ripple that
 *   fires on every sample — the app's visual heartbeat.
 * - Rendering pauses automatically while the window is hidden.
 */

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const DEFAULT_SERIES = {
  stroke: ['#60cdff', '#9a86ff'],
  fill: 'rgba(96, 205, 255, 0.16)',
  glow: 'rgba(96, 205, 255, 0.55)',
  width: 2,
  head: true,
};

export class Waveform {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} [options]
   * @param {number} [options.capacity=60]   samples kept on screen
   * @param {number} [options.interval=1000] expected ms between samples
   * @param {number|null} [options.max=100]  fixed max, or null to autoscale
   * @param {number} [options.minScale=1]    smallest autoscale ceiling
   * @param {number} [options.gridLines=3]   faint horizontal guides
   * @param {number|null} [options.prefill=0] initial history value (like Task
   *   Manager's flat baseline), or null to start with an empty chart
   * @param {Array<Partial<typeof DEFAULT_SERIES>>} [options.series]
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.capacity = options.capacity ?? 60;
    this.interval = options.interval ?? 1000;
    this.fixedMax = options.max === undefined ? 100 : options.max;
    this.minScale = options.minScale ?? 1;
    this.gridLines = options.gridLines ?? 3;
    const prefill = options.prefill === undefined ? 0 : options.prefill;
    const initial = () => (prefill == null ? [] : new Array(this.capacity + 2).fill(prefill));
    this.series = (options.series ?? [{}]).map((s) => ({ ...DEFAULT_SERIES, ...s, data: initial() }));

    this.lastPushAt = performance.now();
    this.scaleMax = this.fixedMax ?? this.minScale;
    this.frame = 0;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    document.addEventListener('visibilitychange', () => this.syncRunning());
    this.resize();
    this.syncRunning();
  }

  /** Adds one sample per series (in series order). */
  push(...values) {
    this.series.forEach((series, i) => {
      const value = Number.isFinite(values[i]) ? values[i] : 0;
      series.data.push(value);
      // Keep two extra samples so the spline enters smoothly from the left.
      if (series.data.length > this.capacity + 2) series.data.shift();
    });
    this.lastPushAt = performance.now();
    if (!this.frame) this.draw(this.lastPushAt);
  }

  // ── Internals ───────────────────────────────────────────────────────

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.draw(performance.now());
  }

  syncRunning() {
    const shouldRun = document.visibilityState === 'visible';
    if (shouldRun && !this.frame) {
      const loop = (now) => {
        this.draw(now);
        this.frame = requestAnimationFrame(loop);
      };
      this.frame = requestAnimationFrame(loop);
    } else if (!shouldRun && this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
  }

  /** Smoothly eases the autoscale ceiling toward the visible peak. */
  updateScale() {
    if (this.fixedMax != null) {
      this.scaleMax = this.fixedMax;
      return;
    }
    let peak = 0;
    for (const s of this.series) for (const v of s.data) peak = Math.max(peak, v);
    const target = Math.max(this.minScale, peak * 1.25);
    this.scaleMax += (target - this.scaleMax) * 0.08;
  }

  draw(now) {
    const { ctx, width, height, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    this.updateScale();
    this.drawGrid();

    // Scroll progress since the last sample (0 → 1).
    const t = prefersReducedMotion.matches
      ? 1
      : Math.min(1, Math.max(0, (now - this.lastPushAt) / this.interval));

    for (const series of this.series) this.drawSeries(series, t, now);
  }

  drawGrid() {
    const { ctx, width, height } = this;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    for (let i = 1; i <= this.gridLines; i++) {
      const y = Math.round((height * i) / (this.gridLines + 1)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Maps every sample to canvas coordinates for the current scroll offset. */
  project(data, t) {
    const { width, height } = this;
    const top = 10;
    const bottom = height - 4;
    const step = width / (this.capacity - 1);
    const n = data.length;
    const scale = this.scaleMax || 1;

    // Newest sample enters from one step beyond the right edge and reaches
    // the edge just as the next sample arrives.
    return data.map((value, i) => ({
      x: width - (n - 1 - i) * step + (1 - t) * step,
      y: bottom - Math.min(1, Math.max(0, value / scale)) * (bottom - top),
    }));
  }

  drawSeries(series, t, now) {
    const { ctx, width, height } = this;
    if (series.data.length < 2) return;

    const points = this.project(series.data, t);
    const path = splinePath(points);

    // Area fill fading to transparent at the bottom.
    const fill = ctx.createLinearGradient(0, 0, 0, height);
    fill.addColorStop(0, series.fill);
    fill.addColorStop(1, 'rgba(0, 0, 0, 0)');
    const area = new Path2D(path);
    area.lineTo(points.at(-1).x, height);
    area.lineTo(points[0].x, height);
    area.closePath();
    ctx.fillStyle = fill;
    ctx.fill(area);

    // Glowing stroke that fades in from the left edge.
    const stroke = ctx.createLinearGradient(0, 0, width, 0);
    stroke.addColorStop(0, withAlpha(series.stroke[0], 0));
    stroke.addColorStop(0.18, series.stroke[0]);
    stroke.addColorStop(1, series.stroke[1] ?? series.stroke[0]);

    ctx.save();
    ctx.lineWidth = series.width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = stroke;
    ctx.shadowColor = series.glow;
    ctx.shadowBlur = 12;
    ctx.stroke(path);
    ctx.restore();

    if (series.head) this.drawHead(series, points, t, now);
  }

  /** The glowing point where the line meets the right edge. */
  drawHead(series, points, t, now) {
    const { ctx, width } = this;
    const n = points.length;
    const head = splinePoint(points[n - 3] ?? points[n - 2], points[n - 2], points[n - 1], points[n - 1], t);
    const x = Math.min(width - 5, head.x);
    const color = series.stroke[1] ?? series.stroke[0];

    // Ripple emitted on each new sample.
    const age = (now - this.lastPushAt) / 900;
    if (age < 1 && !prefersReducedMotion.matches) {
      ctx.beginPath();
      ctx.arc(x, head.y, 4 + age * 12, 0, Math.PI * 2);
      ctx.strokeStyle = withAlpha(color, 0.5 * (1 - age));
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.save();
    ctx.shadowColor = series.glow;
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, head.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ── Geometry helpers ─────────────────────────────────────────────────────

/** Builds a Catmull-Rom spline through all points as cubic Béziers. */
function splinePath(points) {
  const path = new Path2D();
  path.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    path.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6,
      p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6,
      p2.y - (p3.y - p1.y) / 6,
      p2.x,
      p2.y,
    );
  }
  return path;
}

/** Evaluates the Catmull-Rom segment p1→p2 at parameter s ∈ [0, 1]. */
function splinePoint(p0, p1, p2, p3, s) {
  const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
  const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
  const u = 1 - s;
  const b = (a, c, d, e) => u * u * u * a + 3 * u * u * s * c + 3 * u * s * s * d + s * s * s * e;
  return { x: b(p1.x, c1.x, c2.x, p2.x), y: b(p1.y, c1.y, c2.y, p2.y) };
}

/** Converts `#rrggbb` to an rgba() string with the given alpha. */
function withAlpha(hex, alpha) {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}
