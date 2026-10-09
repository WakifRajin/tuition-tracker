// Lightweight HTML/CSS bar charts. Crisp at any size, follow the theme via CSS
// variables, and include a visually hidden table for screen readers.
import { html } from "../lib/format.js";

function niceMax(max) {
  if (max <= 0) return 4;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 4, 5, 10]) {
    if (m * pow >= max) {
      const nice = m * pow;
      return nice < 4 ? 4 : nice;
    }
  }
  return 10 * pow;
}

/**
 * @param {object} o
 * @param {string[]} o.labels           x-axis labels
 * @param {string[]} [o.fullLabels]     labels for tooltips / table
 * @param {{name:string, values:number[]}[]} o.series  one or two series
 * @param {(n:number)=>string} [o.format]  value formatter
 * @param {(n:number)=>string} [o.axisFormat]  y-axis tick formatter
 * @param {number} [o.current]          index to emphasise (e.g. this month)
 * @param {string} o.caption            accessible name
 * @param {number} [o.height]
 */
export function barChart({ labels, fullLabels = labels, series, format = String, axisFormat, current = -1, caption, height = 160 }) {
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const ticks = [4, 3, 2, 1, 0].map((i) => (max * i) / 4);
  const grouped = series.length > 1;
  const yFmt = axisFormat || format;

  return html`
    <figure class="chart-figure">
      ${grouped
        ? html`<div class="legend" style="margin-bottom:10px">
            ${series.map((s, i) => html`<span><i class="${i ? "s2" : ""}"></i>${s.name}</span>`)}
          </div>`
        : ""}
      <div class="chart" style="--h:${height}px" aria-hidden="true">
        <div class="chart-y">${ticks.map((t) => html`<span>${yFmt(t)}</span>`)}</div>
        <div class="chart-plot">
          <div class="chart-bars">
            ${labels.map(
              (_, i) => html`<div class="chart-col ${grouped ? "grouped" : ""} ${i === current ? "current" : ""}" tabindex="-1">
                ${series.map(
                  (s, si) =>
                    html`<div class="chart-bar s${si + 1} ${grouped ? "" : "single"}" style="height:${(Math.max(0, s.values[i]) / max) * 100}%"></div>`,
                )}
                <div class="chart-tip">
                  <b>${fullLabels[i]}</b>
                  ${series.map((s) => html`<br />${grouped ? `${s.name}: ` : ""}${format(s.values[i])}`)}
                </div>
              </div>`,
            )}
          </div>
          <div class="chart-x">${labels.map((l) => html`<span>${l}</span>`)}</div>
        </div>
      </div>
      <table class="visually-hidden">
        <caption>${caption}</caption>
        <thead><tr><th scope="col">Period</th>${series.map((s) => html`<th scope="col">${s.name}</th>`)}</tr></thead>
        <tbody>
          ${labels.map(
            (_, i) => html`<tr><th scope="row">${fullLabels[i]}</th>${series.map((s) => html`<td>${format(s.values[i])}</td>`)}</tr>`,
          )}
        </tbody>
      </table>
    </figure>
  `;
}

/** Horizontal ranked bars (e.g. top subjects). */
export function rankedBars(items, { format = String, color } = {}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return html`${items.map(
    (it) => html`<div class="hbar">
      <div class="top"><span class="truncate">${it.label}</span><span>${format(it.value)}</span></div>
      <div class="progress" role="presentation"><span style="width:${(it.value / max) * 100}%;--c:${it.color || color || "var(--chart-1)"}"></span></div>
    </div>`,
  )}`;
}
