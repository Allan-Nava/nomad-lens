// Zero-dependency SVG chart kit (NOM-26). Pure functions returning `<svg>`
// strings — NO 'vscode' import. Used by the webview panels (NOM-23/24).
// Colours come from the caller (usually `var(--vscode-*)`), geometry is here.

function n(x: number): string {
  // compact, deterministic number for SVG attributes
  return (Math.round(x * 100) / 100).toString();
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

/** Stacked donut. Renders a track when the total is 0 (never NaN). */
export function donut(segments: DonutSegment[], size = 120, thickness = 18): string {
  const r = (size - thickness) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const title = segments.map((s) => `${esc(s.label)}: ${s.value}`).join(', ') || 'empty';

  const track = `<circle cx="${n(c)}" cy="${n(c)}" r="${n(r)}" fill="none" stroke="var(--vscode-panel-border, #8884)" stroke-width="${thickness}"/>`;

  let acc = 0;
  const arcs = total
    ? segments
        .filter((s) => s.value > 0)
        .map((s) => {
          const len = (s.value / total) * circ;
          const arc = `<circle cx="${n(c)}" cy="${n(c)}" r="${n(r)}" fill="none" stroke="${s.color}" stroke-width="${thickness}" stroke-dasharray="${n(len)} ${n(circ - len)}" stroke-dashoffset="${n(-acc)}"><title>${esc(s.label)}: ${s.value}</title></circle>`;
          acc += len;
          return arc;
        })
        .join('')
    : '';

  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${title}"><title>${title}</title><g transform="rotate(-90 ${n(c)} ${n(c)})">${track}${arcs}</g><text x="${n(c)}" y="${n(c)}" text-anchor="middle" dominant-baseline="central" font-size="${n(size * 0.26)}" fill="var(--vscode-foreground)" font-weight="700">${total}</text></svg>`;
}

/** Horizontal progress bar. value/max clamped to [0,1]. */
export function progressBar(value: number, max: number, color: string, width = 160, height = 10): string {
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const fill = n(pct * width);
  const r = height / 2;
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${value} of ${max}"><title>${value} / ${max}</title><rect x="0" y="0" width="${width}" height="${height}" rx="${n(r)}" fill="var(--vscode-panel-border, #8884)"/><rect x="0" y="0" width="${fill}" height="${height}" rx="${n(r)}" fill="${color}"/></svg>`;
}

/** Sparkline from samples. Fewer than 2 points renders an empty (titled) svg. */
export function sparkline(values: number[], width = 120, height = 28, color = 'var(--vscode-foreground)'): string {
  const clean = values.filter((v) => Number.isFinite(v));
  const head = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="sparkline">`;
  if (clean.length < 2) return `${head}<title>no data</title></svg>`;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const step = width / (clean.length - 1);
  const pts = clean
    .map((v, i) => `${n(i * step)},${n(height - ((v - min) / span) * height)}`)
    .join(' ');
  return `${head}<title>min ${n(min)} · max ${n(max)}</title><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
