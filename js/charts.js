// A small SVG chart kit for CheckDamCal: time charts (lines, bars, dots and
// fitted segments on a shared date axis) and XY charts (stage curves).
//
// Conventions (see the dataviz notes in the README): one y-axis per chart,
// 2px lines, bars ≤ 24px with a rounded data end, hairline grid, direct end
// labels plus a legend for 2+ series, a crosshair that snaps to the nearest
// reading, keyboard focus that shows the same tooltip as hover, and a table
// view for every chart. Series names are data — always set via textContent.

import { num, dateFromDay, monthLabel } from "./format.js";
import { h, s } from "./dom.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// ---------------------------------------------------------------------------
// Scales

function niceNum(range, round) {
  const exp = Math.floor(Math.log10(range));
  const f = range / 10 ** exp;
  let nf;
  if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * 10 ** exp;
}

/** Clean ticks spanning [min, max]: steps of 1, 2 or 5 × 10ⁿ. */
export function niceScale(min, max, maxTicks = 5) {
  if (!isNum(min) || !isNum(max)) return { min: 0, max: 1, step: 0.25, ticks: [0, 0.25, 0.5, 0.75, 1], digits: 2 };
  if (min === max) {
    const d = Math.abs(min) * 0.1 || 1;
    min -= d;
    max += d;
  }
  const step = niceNum(niceNum(max - min, false) / Math.max(1, maxTicks - 1), true);
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  const digits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(digits + 2));
  return { min: lo, max: hi, step, ticks, digits };
}

const lin = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);

/** Nearest index in a sorted array. */
function nearest(xs, x) {
  let lo = 0;
  let hi = xs.length - 1;
  if (hi < 0) return -1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid;
    else hi = mid;
  }
  return Math.abs(xs[lo] - x) <= Math.abs(xs[hi] - x) ? lo : hi;
}

/** Month ticks for a day-number domain; weekly ticks for short spans. */
function dateTicks(x0, x1, width) {
  const ticks = [];
  const start = new Date(Math.floor(x0) * 86400000);
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  for (;;) {
    const day = Date.UTC(y, m, 1) / 86400000;
    if (day > x1) break;
    if (day >= x0) ticks.push({ x: day, label: m === 0 || !ticks.length ? monthLabel(m, y) : monthLabel(m) });
    m += 1;
    if (m === 12) {
      m = 0;
      y += 1;
    }
  }
  if (ticks.length < 2) {
    ticks.length = 0;
    const every = x1 - x0 > 20 ? 7 : x1 - x0 > 6 ? 2 : 1;
    for (let d = Math.ceil(x0); d <= x1; d += every) ticks.push({ x: d, label: dateFromDay(d, { year: false }) });
  }
  const maxTicks = Math.max(2, Math.floor(width / 64));
  const stride = Math.ceil(ticks.length / maxTicks);
  return ticks.filter((_, i) => i % stride === 0);
}

// ---------------------------------------------------------------------------
// Shared chart frame

class ChartBase {
  /**
   * @param {HTMLElement} root  an empty element; becomes a <figure>-like card
   * @param {{title:string, unit?:string, note?:string}} head
   */
  constructor(root, head) {
    this.root = root;
    this.root.classList.add("chart");
    this.hover = null;
    this.tableOpen = false;
    this.titleEl = h("h3", { class: "chart-title" });
    this.unitEl = h("span", { class: "chart-unit" });
    this.legendEl = h("div", { class: "chart-legend" });
    this.tableBtn = h("button", {
      class: "btn btn-ghost btn-sm chart-table-toggle",
      type: "button",
      "aria-pressed": "false",
      text: "Table",
      onclick: () => this.toggleTable(),
    });
    this.noteEl = h("p", { class: "chart-note" });
    this.body = h("div", { class: "chart-body", tabindex: "0", role: "group" });
    this.tooltip = h("div", { class: "chart-tooltip", hidden: true, role: "status" });
    this.tableWrap = h("div", { class: "chart-table table-scroll", hidden: true });
    this.root.append(
      h("div", { class: "chart-head" }, h("div", { class: "chart-heading" }, this.titleEl, this.unitEl), this.tableBtn),
      this.legendEl,
      this.body,
      this.tableWrap,
      this.noteEl,
    );
    this.body.append(this.tooltip);
    this.setHead(head);
    this.ro = new ResizeObserver(() => {
      const w = this.body.clientWidth;
      if (w && w !== this.lastWidth) this.draw();
    });
    this.ro.observe(this.body);
  }

  setHead({ title, unit, note } = {}) {
    this.titleEl.textContent = title || "";
    this.unitEl.textContent = unit ? unit : "";
    this.noteEl.textContent = note || "";
    this.noteEl.hidden = !note;
    this.body.setAttribute("aria-label", `${title || "Chart"}${unit ? ` (${unit})` : ""}. Use the arrow keys to read values, or open the table.`);
  }

  toggleTable(force) {
    this.tableOpen = force ?? !this.tableOpen;
    this.tableBtn.setAttribute("aria-pressed", String(this.tableOpen));
    this.tableBtn.textContent = this.tableOpen ? "Chart" : "Table";
    this.body.hidden = this.tableOpen;
    this.tableWrap.hidden = !this.tableOpen;
    if (this.tableOpen) this.renderTable();
    else this.draw();
  }

  renderLegend(items) {
    this.legendEl.replaceChildren(
      ...items.map((it) =>
        h(
          "span",
          { class: "legend-item" },
          h("span", { class: `legend-key legend-key-${it.shape || "line"}`, style: `--key:${it.color}` }),
          h("span", { text: it.label }),
        ),
      ),
    );
    this.legendEl.hidden = items.length === 0;
  }

  showTooltip(px, rows, heading) {
    const tip = this.tooltip;
    tip.replaceChildren(
      h("div", { class: "tt-head", text: heading }),
      ...rows.map((r) =>
        h(
          "div",
          { class: "tt-row" },
          h("span", { class: `tt-key tt-key-${r.shape || "line"}`, style: `--key:${r.color || "var(--muted)"}` }),
          h("strong", { class: "tt-value", text: r.value }),
          h("span", { class: "tt-label", text: r.label }),
        ),
      ),
    );
    tip.hidden = false;
    const bw = this.body.clientWidth;
    const tw = tip.offsetWidth;
    const left = px + 14 + tw > bw ? Math.max(4, px - 14 - tw) : px + 14;
    tip.style.left = `${left}px`;
    tip.style.top = "6px";
  }

  hideTooltip() {
    this.tooltip.hidden = true;
  }
}

// ---------------------------------------------------------------------------
// Time chart

/**
 * spec = {
 *   title, unit, note, height,
 *   x: number[]            day numbers (may be fractional), ascending
 *   domain?: [x0, x1]      shared across a stack of charts
 *   frame?: {left, right}  shared margins so stacked plots line up
 *   series: [{ key, label, type: "line"|"bar"|"dot", color, values: (number|null)[],
 *              area?: bool, format?: v=>string, endLabel?: bool, faded?: bool, legend?: bool }]
 *   fits?: [{ x0, y0, x1, y1, color, faded? }]     straight fitted segments
 *   refLines?: [{ y, label }]
 *   yZero?: bool, yMin?, yMax?, yFormat?: v=>string
 *   tooltip?: (i) => rows[]      custom tooltip rows for index i
 *   tableColumns?: [{label, value:(i)=>string}]
 * }
 */
export class TimeChart extends ChartBase {
  constructor(root, head, { onHover } = {}) {
    super(root, head);
    this.onHover = onHover;
    this.body.addEventListener("keydown", (e) => this.onKey(e));
    this.body.addEventListener("blur", () => this.emitHover(null));
  }

  update(spec) {
    this.spec = spec;
    this.setHead(spec);
    const legendItems = spec.series
      .filter((se) => se.legend !== false)
      .map((se) => ({ label: se.label, color: se.color, shape: se.type === "bar" ? "rect" : se.type === "dot" ? "dot" : "line" }));
    if (spec.fits && spec.fits.length && spec.fitLegend) legendItems.push({ label: spec.fitLegend, color: spec.fits[0].color, shape: "line" });
    this.renderLegend(legendItems.length >= 2 ? legendItems : []);
    if (this.tableOpen) this.renderTable();
    else this.draw();
  }

  draw() {
    const spec = this.spec;
    if (!spec || this.tableOpen) return;
    const W = this.body.clientWidth;
    this.lastWidth = W;
    if (!W) return;
    const narrow = W < 560;
    const H = spec.height || 180;
    const frame = spec.frame || {};
    const m = {
      top: 10,
      bottom: 24,
      left: frame.left ?? 56,
      right: narrow ? 10 : frame.right ?? 16,
    };
    const pw = Math.max(40, W - m.left - m.right);
    const ph = H - m.top - m.bottom;
    const xs = spec.x;
    const hasBars = spec.series.some((se) => se.type === "bar");
    let [x0, x1] = spec.domain || [xs[0], xs[xs.length - 1]];
    if (hasBars || spec.padDomain) {
      x0 -= 0.5;
      x1 += 0.5;
    }
    const X = lin(x0, x1, m.left, m.left + pw);

    // y domain from every plotted value
    let lo = Infinity;
    let hi = -Infinity;
    for (const se of spec.series) for (const v of se.values) if (isNum(v)) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
    for (const f of spec.fits || []) (lo = Math.min(lo, f.y0, f.y1)), (hi = Math.max(hi, f.y0, f.y1));
    for (const r of spec.refLines || []) (lo = Math.min(lo, r.y)), (hi = Math.max(hi, r.y));
    if (spec.yZero || hasBars) lo = Math.min(lo, 0);
    if (isNum(spec.yMin)) lo = spec.yMin;
    if (isNum(spec.yMax)) hi = Math.max(hi, spec.yMax);
    if (!isNum(lo)) (lo = 0), (hi = 1);
    const sc = niceScale(lo, hi, Math.max(3, Math.min(6, Math.floor(ph / 34))));
    const Y = lin(sc.min, sc.max, m.top + ph, m.top);
    const yFmt = spec.yFormat || ((v) => num(v, sc.digits));
    this.geom = { X, Y, m, pw, ph, xs, W, H, narrow };

    const root = s("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "chart-svg", "aria-hidden": "true" });
    // grid + y ticks
    const grid = s("g", { class: "grid" }, root);
    for (const t of sc.ticks) {
      const y = Y(t);
      s("line", { x1: m.left, x2: m.left + pw, y1: y, y2: y, class: t === 0 ? "axis-line" : "grid-line" }, grid);
      const tx = s("text", { x: m.left - 8, y: y + 4, class: "tick tick-y", "text-anchor": "end" }, grid);
      tx.textContent = yFmt(t);
    }
    // x ticks
    const xt = s("g", { class: "x-ticks" }, root);
    s("line", { x1: m.left, x2: m.left + pw, y1: m.top + ph, y2: m.top + ph, class: "axis-line" }, xt);
    for (const t of dateTicks(Math.ceil(x0), x1, pw)) {
      const x = X(t.x);
      s("line", { x1: x, x2: x, y1: m.top + ph, y2: m.top + ph + 4, class: "axis-line" }, xt);
      const tx = s("text", { x, y: H - 6, class: "tick", "text-anchor": "middle" }, xt);
      tx.textContent = t.label;
    }
    // reference lines
    const refs = s("g", { class: "refs" }, root);
    const labelsRight = [];
    for (const r of spec.refLines || []) {
      const y = Y(r.y);
      s("line", { x1: m.left, x2: m.left + pw, y1: y, y2: y, class: "ref-line" }, refs);
      if (!narrow && m.right > 60) labelsRight.push({ y, text: r.label, kind: "ref" });
      else {
        const tx = s("text", { x: m.left + 6, y: y - 5, class: "ref-label" }, refs);
        tx.textContent = r.label;
      }
    }

    const plot = s("g", { class: "plot" }, root);
    // bars
    const barStep = (() => {
      let d = Infinity;
      for (let i = 1; i < xs.length; i++) d = Math.min(d, xs[i] - xs[i - 1]);
      return Number.isFinite(d) ? X(x0 + d) - X(x0) : pw;
    })();
    const barW = Math.max(1, Math.min(24, barStep - 2));
    for (const se of spec.series.filter((q) => q.type === "bar")) {
      const g = s("g", { class: "bars", style: `--c:${se.color}` }, plot);
      se.values.forEach((v, i) => {
        if (!isNum(v) || v === 0) return;
        const x = X(xs[i]) - barW / 2;
        const y0 = Y(0);
        const y1 = Y(v);
        s("path", { d: barPath(x, y0, barW, y1), class: `bar${se.faded ? " faded" : ""}`, "data-i": i }, g);
      });
    }
    // area washes, lines
    for (const se of spec.series.filter((q) => q.type === "line")) {
      const segs = [];
      let cur = [];
      se.values.forEach((v, i) => {
        if (isNum(v)) cur.push([X(xs[i]), Y(v)]);
        else if (cur.length) segs.push(cur), (cur = []);
      });
      if (cur.length) segs.push(cur);
      for (const seg of segs) {
        if (se.area && seg.length > 1) {
          const base = Y(Math.max(sc.min, 0 > sc.min && 0 < sc.max ? 0 : sc.min));
          s(
            "path",
            {
              d: `M${seg[0][0]},${base}L${seg.map((p) => p.join(",")).join("L")}L${seg[seg.length - 1][0]},${base}Z`,
              class: "area",
              style: `--c:${se.color}`,
            },
            plot,
          );
        }
        s("path", { d: `M${seg.map((p) => p.join(",")).join("L")}`, class: `line${se.faded ? " faded" : ""}`, style: `--c:${se.color}` }, plot);
      }
    }
    // fitted segments
    for (const f of spec.fits || []) {
      s("line", { x1: X(f.x0), y1: Y(f.y0), x2: X(f.x1), y2: Y(f.y1), class: `fit${f.faded ? " faded" : ""}`, style: `--c:${f.color}` }, plot);
    }
    // dots
    for (const se of spec.series.filter((q) => q.type === "dot")) {
      const g = s("g", { class: "dots", style: `--c:${se.color}` }, plot);
      se.values.forEach((v, i) => {
        if (isNum(v)) s("circle", { cx: X(xs[i]), cy: Y(v), r: se.r || 3.5, class: `dot${se.faded ? " faded" : ""}` }, g);
      });
    }

    // direct end labels in the right margin
    if (!narrow && m.right > 60) {
      for (const se of spec.series.filter((q) => q.endLabel)) {
        let i = se.values.length - 1;
        while (i >= 0 && !isNum(se.values[i])) i--;
        if (i < 0) continue;
        labelsRight.push({ y: Y(se.values[i]), text: `${se.label} ${(se.format || yFmt)(se.values[i])}`, color: se.color, kind: "series" });
      }
      for (const extra of spec.marginLabels || []) labelsRight.push({ y: Y(extra.y), text: extra.text, color: extra.color, kind: "series" });
      placeRightLabels(root, labelsRight, m.left + pw, m.top, m.top + ph);
    }

    // hover layer
    const cross = s("g", { class: "crosshair", visibility: "hidden" }, root);
    this.crossLine = s("line", { y1: m.top, y2: m.top + ph, class: "cross-line" }, cross);
    this.crossDots = s("g", {}, cross);
    this.cross = cross;
    const hit = s("rect", { x: m.left, y: m.top, width: pw, height: ph, class: "hit" }, root);
    hit.addEventListener("pointermove", (e) => {
      const rect = this.body.getBoundingClientRect();
      const xDay = x0 + ((e.clientX - rect.left - m.left) / pw) * (x1 - x0);
      this.emitHover(nearest(xs, xDay), true);
    });
    hit.addEventListener("pointerleave", () => this.emitHover(null));

    this.body.querySelector("svg")?.remove();
    this.body.prepend(root);
    this.setHover(this.hover, false);
  }

  emitHover(i, own = false) {
    if (i === this.hover && own === this.ownHover) return;
    this.ownHover = own;
    this.setHover(i, own);
    this.onHover?.(i, this);
  }

  /** Draw the crosshair at index i; show the tooltip only on the chart being read. */
  setHover(i, withTooltip = false) {
    this.hover = i;
    if (!this.geom || !this.cross) return;
    const { X, Y, xs } = this.geom;
    if (i == null || i < 0 || i >= xs.length) {
      this.cross.setAttribute("visibility", "hidden");
      this.hideTooltip();
      return;
    }
    const x = X(xs[i]);
    this.crossLine.setAttribute("x1", x);
    this.crossLine.setAttribute("x2", x);
    this.crossDots.replaceChildren();
    for (const se of this.spec.series) {
      const v = se.values[i];
      if (se.type === "line" && isNum(v)) s("circle", { cx: x, cy: Y(v), r: 4, class: "cross-dot", style: `--c:${se.color}` }, this.crossDots);
    }
    this.cross.setAttribute("visibility", "visible");
    if (withTooltip) this.showTooltip(x, this.tooltipRows(i), this.spec.tooltipHeading?.(i) ?? dateFromDay(xs[i]));
    else this.hideTooltip();
  }

  tooltipRows(i) {
    if (this.spec.tooltip) return this.spec.tooltip(i);
    return this.spec.series
      .filter((se) => isNum(se.values[i]) || se.type === "bar")
      .map((se) => ({
        label: se.label,
        value: (se.format || ((v) => num(v, 2)))(isNum(se.values[i]) ? se.values[i] : 0),
        color: se.color,
        shape: se.type === "bar" ? "rect" : se.type === "dot" ? "dot" : "line",
      }));
  }

  onKey(e) {
    const n = this.geom?.xs.length || 0;
    if (!n) return;
    let i = this.hover;
    if (e.key === "ArrowRight") i = i == null ? 0 : Math.min(n - 1, i + 1);
    else if (e.key === "ArrowLeft") i = i == null ? n - 1 : Math.max(0, i - 1);
    else if (e.key === "Home") i = 0;
    else if (e.key === "End") i = n - 1;
    else if (e.key === "Escape") i = null;
    else return;
    e.preventDefault();
    this.emitHover(i, true);
  }

  renderTable() {
    const spec = this.spec;
    if (!spec) return;
    const cols = spec.tableColumns || [
      { label: "Date", value: (i) => dateFromDay(spec.x[i]) },
      ...spec.series.map((se) => ({ label: se.label, value: (i) => (isNum(se.values[i]) ? (se.format || ((v) => num(v, 2)))(se.values[i]) : "–"), num: true })),
    ];
    const rows = spec.x.map((_, i) => i).filter((i) => spec.series.some((se) => isNum(se.values[i])));
    this.tableWrap.replaceChildren(
      h(
        "table",
        { class: "data-table" },
        h("thead", {}, h("tr", {}, ...cols.map((c) => h("th", { class: c.num ? "num" : "", text: c.label })))),
        h("tbody", {}, ...rows.map((i) => h("tr", {}, ...cols.map((c) => h("td", { class: c.num ? "num" : "", text: c.value(i) }))))),
      ),
    );
  }
}

/** A column with a rounded top (the data end) and a square foot on the baseline. */
function barPath(x, y0, w, y1) {
  const up = y1 < y0;
  const hgt = Math.abs(y0 - y1);
  const r = Math.min(4, w / 2, hgt);
  if (up) {
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  }
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}

/** Right-margin labels: keep 14px apart, draw a leader when a label moves. */
function placeRightLabels(root, labels, xEdge, top, bottom) {
  if (!labels.length) return;
  const gap = 15;
  const sorted = labels.map((l) => ({ ...l, ty: l.y })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) sorted[i].ty = Math.max(sorted[i].ty, sorted[i - 1].ty + gap);
  const overflow = sorted[sorted.length - 1].ty - (bottom + 4);
  if (overflow > 0) for (const l of sorted) l.ty -= overflow;
  for (let i = sorted.length - 2; i >= 0; i--) sorted[i].ty = Math.min(sorted[i].ty, sorted[i + 1].ty - gap);
  for (const l of sorted) l.ty = Math.max(l.ty, top + 2);
  const g = s("g", { class: "end-labels" }, root);
  for (const l of sorted) {
    if (Math.abs(l.ty - l.y) > 1.5) s("path", { d: `M${xEdge + 2},${l.y}L${xEdge + 6},${l.y}L${xEdge + 10},${l.ty}`, class: "leader" }, g);
    if (l.kind === "series") s("line", { x1: xEdge + 12, x2: xEdge + 22, y1: l.ty, y2: l.ty, class: "label-key", style: `--c:${l.color}` }, g);
    const t = s("text", { x: xEdge + (l.kind === "series" ? 26 : 12), y: l.ty + 4, class: l.kind === "ref" ? "ref-label" : "end-label" }, g);
    t.textContent = l.text;
  }
}

// ---------------------------------------------------------------------------
// XY chart — stage curves (x: area or volume, y: level)

export class XYChart extends ChartBase {
  update(spec) {
    this.spec = spec;
    this.setHead(spec);
    this.renderLegend([]);
    if (this.tableOpen) this.renderTable();
    else this.draw();
  }

  draw() {
    const spec = this.spec;
    if (!spec || this.tableOpen) return;
    const W = this.body.clientWidth;
    this.lastWidth = W;
    if (!W) return;
    const H = spec.height || 220;
    const m = { top: 12, right: W < 420 ? 12 : 96, bottom: 34, left: 56 };
    const pw = Math.max(40, W - m.left - m.right);
    const ph = H - m.top - m.bottom;
    const pts = spec.points.filter((p) => isNum(p.x) && isNum(p.y));
    if (!pts.length) {
      this.body.querySelector("svg")?.remove();
      this.emptyEl ??= h("p", { class: "chart-note" });
      this.emptyEl.textContent = spec.emptyText || "Nothing to plot yet.";
      if (!this.emptyEl.isConnected) this.body.prepend(this.emptyEl);
      return;
    }
    this.emptyEl?.remove();
    const xsc = niceScale(0, Math.max(1, ...pts.map((p) => p.x)), Math.max(3, Math.floor(pw / 80)));
    const ys = [...pts.map((p) => p.y), ...(spec.refLines || []).map((r) => r.y)];
    const ysc = niceScale(Math.min(...ys), Math.max(...ys), 5);
    const X = lin(xsc.min, xsc.max, m.left, m.left + pw);
    const Y = lin(ysc.min, ysc.max, m.top + ph, m.top);
    this.geom = { X, Y, pts };
    const root = s("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "chart-svg", "aria-hidden": "true" });
    const grid = s("g", {}, root);
    for (const t of ysc.ticks) {
      s("line", { x1: m.left, x2: m.left + pw, y1: Y(t), y2: Y(t), class: "grid-line" }, grid);
      const tx = s("text", { x: m.left - 8, y: Y(t) + 4, class: "tick", "text-anchor": "end" }, grid);
      tx.textContent = num(t, ysc.digits);
    }
    s("line", { x1: m.left, x2: m.left + pw, y1: m.top + ph, y2: m.top + ph, class: "axis-line" }, grid);
    for (const t of xsc.ticks) {
      s("line", { x1: X(t), x2: X(t), y1: m.top + ph, y2: m.top + ph + 4, class: "axis-line" }, grid);
      const tx = s("text", { x: X(t), y: m.top + ph + 17, class: "tick", "text-anchor": "middle" }, grid);
      tx.textContent = num(t, xsc.digits);
    }
    const xl = s("text", { x: m.left + pw, y: H - 2, class: "tick axis-title", "text-anchor": "end" }, grid);
    xl.textContent = spec.xLabel || "";
    const labels = [];
    for (const r of spec.refLines || []) {
      s("line", { x1: m.left, x2: m.left + pw, y1: Y(r.y), y2: Y(r.y), class: "ref-line" }, root);
      labels.push({ y: Y(r.y), text: r.label, kind: "ref" });
    }
    if (m.right > 60) placeRightLabels(root, labels, m.left + pw, m.top, m.top + ph);
    if (pts.length > 1) s("path", { d: `M${pts.map((p) => `${X(p.x)},${Y(p.y)}`).join("L")}`, class: "line", style: `--c:${spec.color}` }, root);
    for (const p of pts) s("circle", { cx: X(p.x), cy: Y(p.y), r: 4, class: `dot${p.computed ? " hollow" : ""}`, style: `--c:${spec.color}` }, root);
    const cross = s("g", { visibility: "hidden" }, root);
    const ring = s("circle", { r: 7, class: "cross-ring", style: `--c:${spec.color}` }, cross);
    const hit = s("rect", { x: m.left - 8, y: m.top - 8, width: pw + 16, height: ph + 16, class: "hit" }, root);
    const showAt = (k) => {
      if (k == null) {
        cross.setAttribute("visibility", "hidden");
        this.hideTooltip();
        return;
      }
      const p = pts[k];
      ring.setAttribute("cx", X(p.x));
      ring.setAttribute("cy", Y(p.y));
      cross.setAttribute("visibility", "visible");
      this.showTooltip(X(p.x), spec.tooltip(p), spec.tooltipHeading(p));
      this.hover = k;
    };
    hit.addEventListener("pointermove", (e) => {
      const r = this.body.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      let best = null;
      let bd = Infinity;
      pts.forEach((p, k) => {
        const d = Math.hypot(X(p.x) - px, Y(p.y) - py);
        if (d < bd) (bd = d), (best = k);
      });
      showAt(bd < 40 ? best : null);
    });
    hit.addEventListener("pointerleave", () => showAt(null));
    this.body.onkeydown = (e) => {
      if (!pts.length) return;
      let k = this.hover ?? -1;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") k = Math.min(pts.length - 1, k + 1);
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") k = Math.max(0, k - 1);
      else if (e.key === "Escape") k = null;
      else return;
      e.preventDefault();
      showAt(k);
    };
    this.body.querySelector("svg")?.remove();
    this.body.prepend(root);
  }

  renderTable() {
    const spec = this.spec;
    if (!spec) return;
    const cols = spec.tableColumns;
    this.tableWrap.replaceChildren(
      h(
        "table",
        { class: "data-table" },
        h("thead", {}, h("tr", {}, ...cols.map((c) => h("th", { class: c.num ? "num" : "", text: c.label })))),
        h("tbody", {}, ...spec.points.map((p) => h("tr", {}, ...cols.map((c) => h("td", { class: c.num ? "num" : "", text: c.value(p) }))))),
      ),
    );
  }
}
