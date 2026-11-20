/**
 * RingGauge — a circular percentage meter drawn with SVG.
 * The arc animates via a CSS transition on `stroke-dashoffset`.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
let gaugeCount = 0;

export class RingGauge {
  /**
   * @param {HTMLElement} host   element that receives the gauge
   * @param {object} [options]
   * @param {number} [options.size=112]
   * @param {number} [options.thickness=9]
   * @param {[string, string]} [options.colors]
   */
  constructor(host, { size = 112, thickness = 9, colors = ['#60cdff', '#9a86ff'] } = {}) {
    const id = `ring-gradient-${++gaugeCount}`;
    const radius = (size - thickness) / 2;
    this.circumference = 2 * Math.PI * radius;

    const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'ring__svg' });
    const defs = svgEl('defs');
    const gradient = svgEl('linearGradient', { id, x1: '0', y1: '0', x2: '1', y2: '1' });
    gradient.append(
      svgEl('stop', { offset: '0', 'stop-color': colors[0] }),
      svgEl('stop', { offset: '1', 'stop-color': colors[1] }),
    );
    defs.append(gradient);

    const center = size / 2;
    const common = { cx: center, cy: center, r: radius, fill: 'none', 'stroke-width': thickness };
    const track = svgEl('circle', { ...common, class: 'ring__track' });
    this.arc = svgEl('circle', {
      ...common,
      class: 'ring__arc',
      stroke: `url(#${id})`,
      'stroke-linecap': 'round',
      'stroke-dasharray': this.circumference,
      'stroke-dashoffset': this.circumference,
      transform: `rotate(-90 ${center} ${center})`,
    });

    svg.append(defs, track, this.arc);
    host.classList.add('ring');
    host.prepend(svg);
  }

  /** @param {number|null} percent 0–100, or null for "unavailable" */
  set(percent) {
    const value = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
    this.arc.style.strokeDashoffset = String(this.circumference * (1 - value / 100));
    this.arc.classList.toggle('is-empty', !Number.isFinite(percent));
  }
}

function svgEl(tag, attributes = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, String(value));
  return el;
}
