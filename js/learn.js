// Learn: follow one day through the calculation, a picture at a time.
//
// Six lessons, each with a picture that builds up in stages (Back / Next),
// and the equation three ways — in words, in symbols, and with the day's own
// numbers and units. Every number shown comes from the engine's results for
// the data that is open, so the lesson and the results can't disagree.

import * as E from "./engine.js";
import * as F from "./format.js";
import { h, s } from "./dom.js";
import { TimeChart } from "./charts.js";
import { drawSection } from "./section.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function text(parent, x, y, str, cls = "sec-label", anchor = "start") {
  const t = s("text", { x, y, class: cls, "text-anchor": anchor }, parent);
  t.textContent = str;
  return t;
}

/** An SVG sized to its host; returns [svg, W, H]. */
function canvas(host, ratio, min, max, label) {
  const W = Math.max(280, host.clientWidth || 600);
  const H = Math.round(Math.min(max, Math.max(min, W * ratio)));
  const svg = s("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "learn-svg", role: "img", "aria-label": label });
  host.replaceChildren(svg);
  return [svg, W, H];
}

/** Mark what a stage adds, so it can fade in. */
const enter = (el, on) => {
  if (on) el.classList.add("enter");
  return el;
};

// ---------------------------------------------------------------------------
// Numbers for one day

function dayView(wb, i) {
  const d = wb.days[i];
  const p = wb.params;
  const prev = i > 0 ? wb.days[i - 1] : null;
  const prevLevel = prev ? prev.level : isNum(p.initialLevel) ? p.initialLevel : null;
  return {
    i,
    d,
    p,
    prev,
    prevLevel,
    prevVolume: d.volume - d.dStorage,
    prevArea: d.prevArea,
    avgArea: 0.5 * (d.prevArea + d.area),
    recharge: d.dryRecharge + d.wetRecharge,
    rate: d.rateApplied,
  };
}

/** The survey rows either side of a level (the MATCH/INDEX pair of the workbook). */
function bracket(rows, level) {
  let t = 0;
  for (let k = 0; k < rows.length; k++) if (rows[k].rl <= level) t = k;
  if (t >= rows.length - 1) t = rows.length - 2;
  return [rows[t], rows[t + 1], t];
}

/** Good days to follow: a rainy day, a dry day, a spilling day. */
export function quickPicks(wb) {
  const days = wb.days;
  let rainy = null;
  let spill = null;
  days.forEach((d, i) => {
    if (i > 0 && d.spill === 0 && d.rain > 1 && d.dStorage > 0 && d.levelSource === "gauge" && (rainy == null || d.inflow > days[rainy].inflow)) rainy = i;
    if (d.spill > 0 && (spill == null || d.spill > days[spill].spill)) spill = i;
  });
  const dryDays = days.map((d, i) => i).filter((i) => i > 0 && days[i].dryRate > 0 && days[i].rain === 0 && days[i].levelSource === "gauge" && days[i - 1].levelSource === "gauge");
  let dry = null;
  if (dryDays.length) {
    const sorted = [...dryDays].sort((a, b) => days[a].dryRate - days[b].dryRate);
    dry = sorted[Math.floor(sorted.length / 2)];
  }
  return { rainy, dry, spill };
}

// ---------------------------------------------------------------------------
// Equation box

/**
 * rows: [{ key, color?, words, symbols, numbers }] — one line per term.
 * The first row is the main equation; the rest explain its terms.
 */
function equationBox(dateLabel, rows, note) {
  return h(
    "div",
    { class: "eq-box" },
    rows.map((r, k) =>
      h(
        "div",
        { class: `eq${k === 0 ? " eq-main" : ""}` },
        r.color ? h("span", { class: "eq-key", style: `--c:${r.color}` }) : h("span", { class: "eq-key blank" }),
        h(
          "div",
          { class: "eq-lines" },
          h("div", { class: "eq-words" }, h("span", { class: "eq-tag", text: "In words" }), r.words),
          h("div", { class: "eq-symbols" }, h("span", { class: "eq-tag", text: "Symbols" }), h("code", { text: r.symbols })),
          h("div", { class: "eq-numbers" }, h("span", { class: "eq-tag", text: dateLabel }), h("code", { text: r.numbers })),
        ),
      ),
    ),
    note ? h("p", { class: "eq-note", text: note }) : null,
  );
}

// ---------------------------------------------------------------------------
// Lessons

const LESSONS = [
  { id: "level", short: "Gauge to level", title: "From a gauge reading to a water level" },
  { id: "volume", short: "Level to water", title: "From a water level to the water in the pond" },
  { id: "balance", short: "One day", title: "One day’s water balance" },
  { id: "soak", short: "Soaking rate", title: "How fast water soaks into the ground" },
  { id: "season", short: "The season", title: "Adding up the season" },
  { id: "spell", short: "Gauge only", title: "The soaking rate from the gauge alone" },
];

// Lesson 1 — gauge reading to water level ------------------------------------

function lessonLevel(v) {
  const { d, p } = v;
  const g = d.gauge;
  const gz = p.gaugeZeroRl;
  const fromGauge = g == null ? null : gz + g * 0.01;
  const corrected = d.levelSource !== "gauge";
  const stages = [
    `This is the gauge board in the pond. Its 0 cm mark is at a known height: ${F.trim(gz, 3)} m.`,
    g == null
      ? `There is no reading on ${F.date(d.date)}: the level was filled in from the days either side.`
      : `On ${F.date(d.date)} the water reached ${F.num(g)} cm on the board.`,
    g == null
      ? `The level used for this day is ${F.num(d.level, 3)} m.`
      : `${F.num(g)} cm is ${F.num(g / 100, 2)} m above the 0 cm mark, so the water level is ${F.trim(gz, 3)} + ${F.num(g / 100, 2)} = ${F.num(fromGauge, 2)} m.`,
  ];
  if (corrected && g != null) stages.push(`This day’s level was corrected in the data (Step 3) to ${F.num(d.level, 3)} m; the calculation uses the corrected level.`);
  const draw = (host, stage) => {
    const [svg, W, H] = canvas(host, 0.55, 260, 360, "Gauge board with the day’s water level");
    const maxCm = Math.max(200, Math.ceil(((g ?? 0) + 40) / 50) * 50);
    const top = 20;
    const bottom = H - 40;
    const Y = (cm) => bottom - (cm / maxCm) * (bottom - top);
    const bx = Math.round(W * 0.34);
    const bw = 40;
    // Water behind the board, from below the 0 mark up to the reading.
    const shownCm = g ?? Math.max(0, (d.level - gz) * 100);
    if (stage >= 2) {
      enter(s("rect", { x: 0, y: Y(shownCm), width: W, height: H - Y(shownCm), class: "sec-water" }, svg), stage === 2);
      enter(s("line", { x1: 0, x2: W, y1: Y(shownCm), y2: Y(shownCm), class: "sec-surface" }, svg), stage === 2);
    }
    s("rect", { x: bx, y: top - 6, width: bw, height: bottom - top + 6, class: "sec-gauge" }, svg);
    const marks = s("g", { class: "sec-gauge-mark" }, svg);
    for (let cm = 0; cm < maxCm; cm += 10) s("rect", { x: cm % 20 ? bx + bw / 2 : bx, y: Y(cm + 5), width: bw / 2, height: Y(cm) - Y(cm + 5) }, marks);
    const sc = s("g", { class: "sec-scale" }, svg);
    for (let cm = 0; cm <= maxCm; cm += 50) {
      s("line", { x1: bx - 6, x2: bx, y1: Y(cm), y2: Y(cm) }, sc);
      text(sc, bx - 10, Y(cm) + 4, `${cm} cm`, "sec-tick", "end");
    }
    // Stage 1: the height of the 0 mark.
    s("line", { x1: bx + bw, x2: bx + bw + 30, y1: Y(0), y2: Y(0), class: "leader" }, svg);
    text(svg, bx + bw + 34, Y(0) + 4, `0 cm is at ${F.trim(gz, 3)} m`, "sec-label sec-label-strong");
    if (stage >= 2 && g != null) {
      const t = enter(s("g", {}, svg), stage === 2);
      s("path", { d: `M${bx - 44},${Y(g)} l-9,-6 v12 z`, class: "sec-pointer" }, t);
      text(t, bx - 58, Y(g) + 4, `${F.num(g)} cm`, "sec-label sec-label-strong", "end");
    }
    if (stage >= 3 && g != null) {
      const t = enter(s("g", {}, svg), stage === 3);
      const x = bx + bw + 20;
      s("path", { d: `M${x},${Y(0)} h8 M${x + 4},${Y(0)} V${Y(g)} M${x},${Y(g)} h8`, class: "learn-bracket" }, t);
      text(t, x + 14, (Y(0) + Y(g)) / 2 + 4, `${F.num(g / 100, 2)} m`, "sec-label sec-label-strong");
      text(t, x + 14, Y(g) - 8, `Water level ${F.num(fromGauge, 2)} m`, "sec-label sec-label-strong");
    }
    if (stage >= 4 && corrected) {
      const t = enter(s("g", {}, svg), true);
      text(t, W - 8, 16, `Corrected to ${F.num(d.level, 3)} m`, "sec-label sec-label-strong", "end");
    }
  };
  const eq = [
    {
      words: "Water level = the height of the 0 cm mark + the gauge reading (in metres)",
      symbols: "D = RL₀ + g ÷ 100",
      numbers: g == null ? `No reading; D = ${F.num(d.level, 3)} m (filled in)` : `D = ${F.trim(gz, 3)} m + ${F.num(g)} cm ÷ 100 cm/m = ${F.num(fromGauge, 3)} m`,
    },
  ];
  const note = corrected && g != null ? `The level used for ${F.date(d.date)} is ${F.num(d.level, 3)} m: the reading was corrected in Step 3.` : null;
  return { stages, draw, eq, note, intro: "The gauge board is a measuring staff fixed in the pond. Reading it tells you how deep the water is above its 0 cm mark. Knowing how high that mark is turns the reading into a water level you can compare with the survey." };
}

// Lesson 2 — water level to area and volume -----------------------------------

function lessonVolume(v, wb, st) {
  const { d } = v;
  const rows = wb.stage.rows;
  const [a, b] = bracket(rows, d.level);
  const q = st.quantity === "volume" ? "volume" : "area";
  const unit = q === "area" ? "m²" : "m³";
  const val = q === "area" ? d.area : d.volume;
  const name = q === "area" ? "water area" : "water in the pond";
  const stages = [
    `The pond survey measured the ${q === "area" ? "water area" : "water stored"} at ${rows.length} levels.`,
    `On ${F.date(d.date)} the water was at ${F.num(d.level, 3)} m, between the survey levels ${F.trim(a.rl, 3)} m and ${F.trim(b.rl, 3)} m.`,
    "Between two survey levels we assume a straight line: the pond grows evenly from one to the next.",
    `Reading off the line at ${F.num(d.level, 3)} m gives the ${name}: ${F.num(val)} ${unit}.`,
  ];
  const draw = (host, stage) => {
    const [svg, W, H] = canvas(host, 0.5, 250, 340, `Survey curve with the day’s level: ${F.num(val)} ${unit}`);
    const m = { l: 60, r: 24, t: 28, b: 40 };
    const xs = rows.map((r) => (q === "area" ? r.area : r.volume));
    const xmax = Math.max(...xs, val) * 1.08;
    const ymin = rows[0].rl;
    const ymax = Math.max(rows[rows.length - 1].rl, d.level);
    const X = (x) => m.l + (x / xmax) * (W - m.l - m.r);
    const Y = (y) => H - m.b - ((y - ymin) / (ymax - ymin || 1)) * (H - m.t - m.b);
    const ax = s("g", {}, svg);
    s("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: "axis-line" }, ax);
    s("line", { x1: m.l, x2: m.l, y1: m.t, y2: H - m.b, class: "axis-line" }, ax);
    rows.forEach((r) => text(ax, m.l - 8, Y(r.rl) + 4, F.trim(r.rl, 2), "tick", "end"));
    text(ax, W - m.r, H - 8, `${q === "area" ? "Water area" : "Water stored"} (${unit})`, "tick axis-title", "end");
    text(ax, 4, m.t - 12, "Water level (m)", "tick axis-title", "start");
    s("polyline", { points: rows.map((r, k) => `${X(xs[k])},${Y(r.rl)}`).join(" "), class: "learn-curve" }, svg);
    rows.forEach((r, k) => s("circle", { cx: X(xs[k]), cy: Y(r.rl), r: 4, class: "dot", style: "--c:var(--c-water)" }, svg));
    if (stage >= 2) {
      const g = enter(s("g", {}, svg), stage === 2);
      s("line", { x1: m.l, x2: W - m.r, y1: Y(d.level), y2: Y(d.level), class: "ref-line" }, g);
      text(g, W - m.r, Y(d.level) - 6, `${F.num(d.level, 3)} m on ${F.date(d.date, { year: false })}`, "ref-label", "end");
      for (const [r, x] of [
        [a, q === "area" ? a.area : a.volume],
        [b, q === "area" ? b.area : b.volume],
      ]) {
        s("circle", { cx: X(x), cy: Y(r.rl), r: 7, class: "cross-ring", style: "--c:var(--accent)" }, g);
        text(g, X(x) + 11, Y(r.rl) + (r === a ? 14 : -8), `${F.trim(r.rl, 2)} m: ${F.num(x)} ${unit}`, "sec-label");
      }
    }
    if (stage >= 3) {
      const g = enter(s("g", {}, svg), stage === 3);
      s("line", { x1: X(q === "area" ? a.area : a.volume), y1: Y(a.rl), x2: X(q === "area" ? b.area : b.volume), y2: Y(b.rl), class: "learn-segment" }, g);
    }
    if (stage >= 4) {
      const g = enter(s("g", {}, svg), true);
      s("line", { x1: X(val), x2: X(val), y1: Y(d.level), y2: H - m.b, class: "learn-guide" }, g);
      s("circle", { cx: X(val), cy: Y(d.level), r: 6, class: "dot", style: "--c:var(--c-evap)" }, g);
      text(g, X(val), H - m.b + 16, `${F.num(val)} ${unit}`, "sec-label sec-label-strong", "middle");
    }
  };
  const row = (quantity) => {
    const A1 = quantity === "area" ? a.area : a.volume;
    const A2 = quantity === "area" ? b.area : b.volume;
    const res = quantity === "area" ? d.area : d.volume;
    const sym = quantity === "area" ? "A" : "V";
    const u = quantity === "area" ? "m²" : "m³";
    return {
      words: `${quantity === "area" ? "Water area" : "Water stored"} = the value at the survey level below + the share of the way up to the next level × the difference between them`,
      symbols: `${sym} = ${sym}₁ + (D − h₁) × (${sym}₂ − ${sym}₁) ÷ (h₂ − h₁)`,
      numbers: `${sym} = ${F.trim(A1, 3)} + (${F.num(d.level, 3)} − ${F.trim(a.rl, 3)}) × (${F.trim(A2, 3)} − ${F.trim(A1, 3)}) ÷ (${F.trim(b.rl, 3)} − ${F.trim(a.rl, 3)}) = ${F.num(res, 1)} ${u}`,
    };
  };
  const eq = [row(q), row(q === "area" ? "volume" : "area")];
  const note = d.level > rows[rows.length - 1].rl ? "This level is above the highest survey level, so the top straight line was extended." : null;
  return {
    stages,
    draw,
    eq,
    note,
    intro: "The survey tells us the pond’s size at a few levels. For any level in between, the calculator draws a straight line between the two nearest survey points. The area is needed for evaporation and soaking; the volume for how much water is stored.",
    toggle: true,
  };
}

// Lesson 3 — one day's balance -------------------------------------------------

function lessonBalance(v, wb, st, section) {
  const { d, p, prevLevel } = v;
  const dS = d.dStorage;
  const evap = d.evaporation;
  const rech = v.recharge;
  const spill = d.spill;
  const inflow = d.inflow;
  const dry = d.dryRate > 0;
  const stages = [
    dS >= 0
      ? `The pond held ${F.num(v.prevVolume)} m³ the day before and ${F.num(d.volume)} m³ on ${F.date(d.date, { year: false })}: ${F.num(dS)} m³ more was stored.`
      : `The pond held ${F.num(v.prevVolume)} m³ the day before and ${F.num(d.volume)} m³ on ${F.date(d.date, { year: false })}: ${F.num(-dS)} m³ came out of storage.`,
    `Some water evaporated from the pond’s surface: ${F.num(evap, 1)} m³.`,
    `Some soaked into the ground: ${F.num(rech, 1)} m³${dry ? " (from how far the level fell, Lesson 4)" : " (at the season’s average soaking rate, Lesson 4)"}.`,
    spill > 0 ? `The water was above the spillway, so ${F.num(spill)} m³ spilled over the dam.` : `The water stayed below the spillway (${F.trim(p.ctfRl, 2)} m), so nothing spilled.`,
    inflow >= 0
      ? `Everything has to add up. So the water that flowed in was ${F.num(dS)} + ${F.num(evap, 1)} + ${F.num(rech, 1)} + ${F.num(spill)} = ${F.num(inflow)} m³.`
      : `Everything has to add up: here the parts give ${F.num(inflow)} m³ of inflow, a negative number, which usually means a reading is a little off.`,
  ];
  const draw = (host, stage) => {
    // The pond on the day, with yesterday's water line.
    host.replaceChildren();
    const secHost = h("div", { class: "learn-section-host" });
    const barHost = h("div", {});
    host.append(secHost, barHost);
    if (section) drawSection(secHost, { stage: wb.stage, params: p, level: d.level, levelMax: Math.max(...wb.days.map((x) => x.level)), gauge: d.gauge, spill, prevLevel });
    const [svg, W] = canvas(barHost, 0.2, 134, 140, "Water in and water out, which must be equal");
    const parts = [];
    const inParts = [];
    const outParts = [];
    if (dS >= 0) outParts.push({ label: "Stored", value: dS, color: "var(--c-storage)", stage: 1 });
    else inParts.push({ label: "From storage", value: -dS, color: "var(--c-storage)", stage: 1 });
    outParts.push({ label: "Evaporated", value: evap, color: "var(--c-evap)", stage: 2 });
    outParts.push({ label: "Soaked in", value: rech, color: "var(--c-recharge)", stage: 3 });
    outParts.push({ label: "Spilled", value: spill, color: "var(--c-spill)", stage: 4 });
    if (inflow > 0) inParts.push({ label: "Flowed in", value: inflow, color: "var(--c-water)", stage: 5 });
    parts.push(...inParts, ...outParts);
    const total = Math.max(
      inParts.reduce((a, q) => a + q.value, 0),
      outParts.reduce((a, q) => a + q.value, 0),
      1,
    );
    const m = { l: 110, r: 16 };
    const X = (x) => m.l + (x / total) * (W - m.l - m.r);
    const row = (items, y, label) => {
      text(svg, m.l - 10, y + 17, label, "sec-label sec-label-strong", "end");
      let x0 = 0;
      for (const q of items) {
        if (q.stage > stage || q.value <= 0) {
          x0 += q.stage > stage ? 0 : q.value;
          continue;
        }
        const x = X(x0);
        const w = Math.max(1, X(x0 + q.value) - X(x0) - 2);
        const g = enter(s("g", {}, svg), q.stage === stage);
        s("rect", { x, y, width: w, height: 26, rx: 3, style: `fill:${q.color}` }, g);
        if (w > 70) text(g, x + 6, y + 17, `${q.label} ${F.num(q.value)}`, q.color === "var(--c-storage)" ? "learn-in-bar on-light" : "learn-in-bar");
        x0 += q.value;
      }
    };
    row(inParts, 22, "Came in");
    row(outParts, 72, "Where it went");
    if (stage >= 5) {
      const g = enter(s("g", {}, svg), true);
      text(g, W - m.r, 124, `Both rows are ${F.num(Math.max(inflow, 0) + Math.max(-dS, 0))} m³ long: in = out`, "sec-label sec-label-strong", "end");
    }
    // Values for the parts too small to label inside their bar, as wrapping text below.
    const small = parts.filter((q) => q.stage <= stage && q.value > 0 && X(q.value) - X(0) <= 70);
    if (small.length) barHost.append(h("p", { class: "learn-small-parts", text: small.map((q) => `${q.label} ${F.num(q.value, q.value < 100 ? 1 : 0)} m³`).join(" · ") }));
  };
  const eq = [
    {
      words: "Water that flowed in = change in storage + evaporation + soaking in + spill",
      symbols: "O = ΔS + E + R + N",
      numbers: `O = ${F.num(dS, 1)} + ${F.num(evap, 1)} + ${F.num(rech, 1)} + ${F.num(spill, 1)} = ${F.num(inflow, 1)} m³`,
    },
    {
      color: "var(--c-storage)",
      words: "Change in storage = water in the pond today − yesterday",
      symbols: "ΔS = V − V₋₁",
      numbers: `ΔS = ${F.num(d.volume, 1)} − ${F.num(v.prevVolume, 1)} = ${F.num(dS, 1)} m³`,
    },
    {
      color: "var(--c-evap)",
      words: "Evaporation = average water area × evaporation rate × 1 day",
      symbols: "E = ½ (A₋₁ + A) × e",
      numbers: `E = 0.5 × (${F.num(v.prevArea, 1)} + ${F.num(d.area, 1)}) m² × ${F.trim(p.evaporation, 4)} m/day × 1 day = ${F.num(evap, 1)} m³`,
    },
    dry
      ? {
          color: "var(--c-recharge)",
          words: "Soaking in (a dry day) = how far the water soaked down × average area",
          symbols: "R = K × ½ (A₋₁ + A)",
          numbers: `R = ${F.num(d.dryRate, 4)} m × ${F.num(v.avgArea, 1)} m² = ${F.num(rech, 1)} m³`,
        }
      : {
          color: "var(--c-recharge)",
          words: "Soaking in (rain, rising or overflowing days) = the season’s average soaking rate × average area",
          symbols: "R = r × ½ (A₋₁ + A)",
          numbers: `R = ${F.num(v.rate, 4)} m/day × ${F.num(v.avgArea, 1)} m² × 1 day = ${F.num(rech, 1)} m³`,
        },
    {
      color: "var(--c-spill)",
      words: "Spill = weir coefficient × spillway length × (height over the spillway)^1.5 × seconds in a day",
      symbols: "N = C₁ × L₁ × (D − CTF)^a₁ × 86 400",
      numbers:
        spill > 0
          ? `N = ${F.trim(p.weirCoefficient, 3)} × ${F.trim(p.weirLength, 2)} m × (${F.num(d.level, 3)} − ${F.trim(p.ctfRl, 3)} m)^${F.trim(p.weirExponent, 2)} × 86 400 s = ${F.num(spill, 1)} m³`
          : `D = ${F.num(d.level, 3)} m is below the spillway at ${F.trim(p.ctfRl, 3)} m, so N = 0`,
    },
  ];
  const note = prevLevel == null && v.i === 0 ? "The first day starts from an empty pond, as in the spreadsheet, so all the water stored on day 1 counts as inflow." : null;
  return {
    stages,
    draw,
    eq,
    note,
    intro: "Water is never lost, only moved. Every day, the water that flowed into the pond must equal the change in what it stores plus what left it: by evaporating, by soaking into the ground, or by spilling over the dam. The pond’s change is measured; the losses are worked out; the inflow is what makes the two sides equal.",
  };
}

// Lesson 4 — how fast water soaks in -------------------------------------------

function lessonSoak(v, wb) {
  const { d, p, prevLevel } = v;
  const e = p.evaporation;
  const dry = d.dryRate > 0;
  const fall = prevLevel == null ? null : prevLevel - d.level;
  const rainM = d.rain * 0.001;
  const why = !dry
    ? prevLevel == null
      ? "the first day has no day before it to compare with"
      : d.level >= p.ctfRl
        ? "the water was above the spillway, so part of the fall was spill"
        : fall <= e
          ? `the level ${fall < 0 ? "rose" : "fell by less than the evaporation"} (${F.num(fall * 1000, 0)} mm)`
          : "it doesn’t meet the conditions"
    : null;
  const stages = dry
    ? [
        `From ${F.num(prevLevel, 3)} m the day before to ${F.num(d.level, 3)} m: the level fell ${F.num(fall * 1000, 0)} mm${d.rain > 0 ? `, and ${F.num(d.rain, 1)} mm of rain fell into the pond` : ""}.`,
        `Evaporation took ${F.num(e * 1000, 1)} mm of it.`,
        `The rest, ${F.num(d.dryRate * 1000, 1)} mm, soaked into the ground: the soaking rate for ${F.date(d.date, { year: false })}.`,
        `The same is worked out for every dry day with a falling level. Their average, ${F.num(wb.mdwir * 1000, 1)} mm per day over ${wb.counts.dryDays} days, is the season’s soaking rate.`,
      ]
    : [
        `${F.date(d.date)} can’t be used to measure soaking: ${why}. Pick a dry day to follow the steps, or see the season below.`,
        `The season’s soaking rate is the average over the ${wb.counts.dryDays} dry days with a falling level: ${F.num(wb.mdwir * 1000, 1)} mm per day.`,
      ];
  const draw = (host, stage, st) => {
    host.replaceChildren();
    const barHost = h("div", {});
    const chartHost = h("div", { class: "learn-chart" });
    host.append(barHost, chartHost);
    const last = dry ? 4 : 2;
    if (dry && stage < last) {
      const [svg, W, H] = canvas(barHost, 0.42, 220, 300, "The day’s fall in level, split into evaporation and soaking in");
      const total = fall * 1000 + d.rain;
      const top = 24;
      const bottom = H - 30;
      const Y = (mm) => top + (mm / total) * (bottom - top);
      const col = (x, parts, label) => {
        text(svg, x + 45, top - 8, label, "sec-label sec-label-strong", "middle");
        let y0 = 0;
        for (const q of parts) {
          if (q.stage > stage || q.mm <= 0) continue;
          const g = enter(s("g", {}, svg), q.stage === stage);
          s("rect", { x, y: Y(y0), width: 90, height: Math.max(1, Y(y0 + q.mm) - Y(y0) - 2), rx: 3, style: `fill:${q.color}` }, g);
          text(g, x + 100, Y(y0) + Math.max(12, (Y(y0 + q.mm) - Y(y0)) / 2) + 4, `${q.label} ${F.num(q.mm, 1)} mm`, "sec-label");
          y0 += q.mm;
        }
      };
      col(W * 0.08, [
        { label: "Level fell", mm: fall * 1000, color: "var(--c-storage)", stage: 1 },
        { label: "Rain added", mm: d.rain, color: "var(--c-rain)", stage: 1 },
      ], "Water that went");
      col(W * 0.52, [
        { label: "Evaporated", mm: e * 1000, color: "var(--c-evap)", stage: 2 },
        { label: "Soaked in", mm: d.dryRate * 1000, color: "var(--c-recharge)", stage: 3 },
      ], "Where it went");
    }
    if (stage >= last - (dry ? 0 : 1)) {
      const x = wb.days.map((q) => E.dayNumber(q.date));
      if (!st.soakChart) st.soakChart = new TimeChart(h("div"), { title: "Soaking rate on dry days" });
      chartHost.append(st.soakChart.root);
      st.soakChart.update({
        x,
        domain: [x[0], x[x.length - 1]],
        frame: { left: 56, right: 140 },
        padDomain: true,
        title: "Soaking rate on each dry day",
        unit: "mm per day",
        height: 170,
        series: [{ key: "rate", label: "Soaking rate", type: "bar", color: "var(--c-recharge)", values: wb.days.map((q) => (q.dryRate > 0 ? q.dryRate * 1000 : null)), format: (val) => `${F.num(val, 1)} mm/day` }],
        refLines: [{ y: wb.mdwir * 1000, label: `Average ${F.num(wb.mdwir * 1000, 1)} mm/day` }],
        yFormat: (val) => F.num(val),
      });
      st.soakChart.setHover(v.i, false);
    }
  };
  const eq = [
    {
      words: "Soaking in on a dry day = how far the level fell − evaporation + rain that fell into the pond",
      symbols: "K = (D₋₁ − D) − e + P ÷ 1000",
      numbers: dry
        ? `K = (${F.num(prevLevel, 3)} − ${F.num(d.level, 3)}) m − ${F.trim(e, 4)} m + ${F.num(d.rain, 1)} mm ÷ 1000 = ${F.num(d.dryRate, 4)} m = ${F.num(d.dryRate * 1000, 1)} mm`
        : `Not a dry falling day, so K = 0 on ${F.date(d.date, { year: false })}`,
    },
    {
      color: "var(--c-recharge)",
      words: "The season’s soaking rate = the average of K over the dry days",
      symbols: "r = ΣK ÷ n",
      numbers: `r = ${F.num(wb.dryWeatherTotal, 3)} m ÷ ${wb.counts.dryDays} days = ${F.num(wb.mdwir, 4)} m/day = ${F.num(wb.mdwir * 1000, 1)} mm/day`,
    },
  ];
  return {
    stages,
    draw,
    eq,
    note: "A day counts as dry when the water is below the spillway and the level fell by more than the evaporation. On other days the soaking can’t be seen in the level, so the season’s average rate r is used for them.",
    intro: "On a dry day, water leaves the pond in only two ways: it evaporates or it soaks into the ground. So when the level falls, the part of the fall that evaporation can’t explain is water soaking in. That is how the soaking (infiltration) rate is measured.",
  };
}

// Lesson 5 — the season ---------------------------------------------------------

function lessonSeason(v, wb, st) {
  const t = wb.totals;
  const e = wb.endOfSeason;
  const last = wb.days[wb.days.length - 1];
  const stages = [
    "Do the same for every day, and keep a running total of each part. Press Play to watch the season add up.",
    `On the last day, ${F.date(last.date)}, ${F.num(e.remaining)} m³ was still in the pond. It will soak in or evaporate later, in proportion to their rates: ${F.num(e.recharge)} m³ soaks in and ${F.num(e.evaporation)} m³ evaporates.`,
    `The season: ${F.num(t.inflow)} m³ flowed in, and ${F.num(t.rechargeWithEnd)} m³ of it soaked into the ground.`,
  ];
  const draw = (host, stage) => {
    host.replaceChildren();
    if (stage === 1) {
      const chartHost = h("div", { class: "learn-chart" });
      const playRow = h("div", { class: "scrubber" });
      host.append(playRow, chartHost);
      if (!st.seasonChart) st.seasonChart = new TimeChart(h("div"), { title: "Running totals" });
      chartHost.append(st.seasonChart.root);
      const x = wb.days.map((q) => E.dayNumber(q.date));
      const show = (upTo) => {
        const cut = (arr) => arr.map((val, i) => (i <= upTo ? val : null));
        st.seasonChart.update({
          x,
          domain: [x[0], x[x.length - 1]],
          frame: { left: 60, right: 140 },
          padDomain: true,
          title: "Running totals",
          unit: `m³, up to ${F.date(wb.days[upTo].date)}`,
          height: 240,
          yZero: true,
          yMax: t.inflow,
          yFormat: (val) => (Math.abs(val) >= 1000 ? `${F.num(val / 1000)}k` : F.num(val)),
          series: [
            { key: "inflow", label: "Flowed in", type: "line", color: "var(--c-water)", values: cut(wb.days.map((q) => q.cumInflow)), endLabel: true },
            { key: "spill", label: "Spilled", type: "line", color: "var(--c-spill)", values: cut(wb.days.map((q) => q.cumSpill)), endLabel: true },
            { key: "recharge", label: "Soaked in", type: "line", color: "var(--c-recharge)", values: cut(wb.days.map((q) => q.cumRecharge)), endLabel: true },
            { key: "evap", label: "Evaporated", type: "line", color: "var(--c-evap)", values: cut(wb.days.map((q) => q.cumEvaporation)), endLabel: true },
          ].map((se) => ({ ...se, format: (val) => `${F.num(val)} m³` })),
        });
      };
      const range = h("input", { type: "range", min: 0, max: wb.days.length - 1, value: st.seasonDay ?? wb.days.length - 1, "aria-label": "Day to add up to" });
      const play = h("button", { class: "btn btn-sm", type: "button", text: "Play" });
      const stop = () => {
        clearInterval(st.seasonTimer);
        st.seasonTimer = null;
        play.textContent = "Play";
      };
      range.addEventListener("input", () => {
        stop();
        st.seasonDay = +range.value;
        show(st.seasonDay);
      });
      play.addEventListener("click", () => {
        if (st.seasonTimer) return stop();
        let i = +range.value >= wb.days.length - 1 ? 0 : +range.value;
        play.textContent = "Pause";
        const step = matchMedia("(prefers-reduced-motion: reduce)").matches ? 10 : 1;
        st.seasonTimer = setInterval(() => {
          i = Math.min(wb.days.length - 1, i + step);
          st.seasonDay = i;
          range.value = String(i);
          show(i);
          if (i >= wb.days.length - 1) stop();
        }, 60);
      });
      playRow.append(play, range);
      show(st.seasonDay ?? wb.days.length - 1);
      return;
    }
    const [svg, W] = canvas(host, 0.24, 160, 190, "Where the season’s water went");
    const m = { l: 16, r: 16 };
    /** One labelled stacked bar, drawn into its own group so it can fade in. */
    const bar = (parent, y, parts, label) => {
      text(parent, m.l, y - 8, label, "sec-label sec-label-strong");
      const total = parts.reduce((a, q) => a + q.value, 0) || 1;
      let x0 = m.l;
      const small = [];
      for (const q of parts) {
        const w = ((W - m.l - m.r) * q.value) / total;
        s("rect", { x: x0, y, width: Math.max(1, w - 2), height: 22, rx: 3, style: `fill:${q.color}` }, parent);
        if (w > 150) text(parent, x0 + 6, y + 15, `${q.label} ${F.num(q.value)} m³`, "learn-in-bar");
        else small.push(`${q.label} ${F.num(q.value)} m³`);
        x0 += w;
      }
      if (small.length) text(parent, W - m.r, y + 38, small.join(" · "), "sec-label sec-label-muted", "end");
    };
    bar(enter(s("g", {}, svg), stage === 2), 26, [
      { label: "Soaks in", value: e.recharge, color: "var(--c-recharge)" },
      { label: "Evaporates", value: e.evaporation, color: "var(--c-evap)" },
    ], `The ${F.num(e.remaining)} m³ still in the pond on the last day`);
    if (stage >= 3) {
      bar(enter(s("g", {}, svg), true), 106, [
        { label: "Soaked in", value: t.rechargeWithEnd, color: "var(--c-recharge)" },
        { label: "Evaporated", value: t.evaporationWithEnd, color: "var(--c-evap)" },
        { label: "Spilled", value: t.spill, color: "var(--c-spill)" },
      ], `All ${F.num(t.inflow)} m³ that flowed in during the season`);
    }
  };
  const eq = [
    {
      words: "Season total = the sum of every day",
      symbols: "Σ over all days",
      numbers: `Flowed in ${F.num(t.inflow)} · soaked in ${F.num(t.recharge)} · evaporated ${F.num(t.evaporation)} · spilled ${F.num(t.spill)} m³ (up to the last day)`,
    },
    {
      color: "var(--c-recharge)",
      words: "Share of the water left at the end that soaks in = what’s left × soaking rate ÷ (soaking rate + evaporation rate)",
      symbols: "R_end = V_end × r ÷ (r + e)",
      numbers: `R_end = ${F.num(e.remaining, 1)} m³ × ${F.num(e.rate, 4)} ÷ (${F.num(e.rate, 4)} + ${F.trim(wb.params.evaporation, 4)}) = ${F.num(e.recharge, 1)} m³`,
    },
    {
      color: "var(--c-evap)",
      words: "…and the share that evaporates",
      symbols: "E_end = V_end × e ÷ (r + e)",
      numbers: `E_end = ${F.num(e.remaining, 1)} m³ × ${F.trim(wb.params.evaporation, 4)} ÷ (${F.num(e.rate, 4)} + ${F.trim(wb.params.evaporation, 4)}) = ${F.num(e.evaporation, 1)} m³`,
    },
    {
      words: "Check: everything that came in went somewhere",
      symbols: "In = soaked + evaporated + spilled",
      numbers: `${F.num(t.inflow)} = ${F.num(t.rechargeWithEnd)} + ${F.num(t.evaporationWithEnd)} + ${F.num(t.spill)} m³ (difference ${F.num(t.balance, 2)} m³)`,
    },
  ];
  return {
    stages,
    draw,
    eq,
    note: null,
    intro: "The results are simply the daily balances added up. One detail: water still in the pond on the last day hasn’t gone anywhere yet, so it is shared between soaking in and evaporating, as it would drain away over the following days.",
  };
}

// Lesson 6 — soaking rate from the gauge alone ----------------------------------

function lessonSpell(rec, wb, st) {
  const runs = rec?.ok ? rec.runs : [];
  if (!runs.length) {
    return {
      stages: ["No dry spell of three or more readings was found in the data, so this method can’t be shown."],
      draw: (host) => host.replaceChildren(),
      eq: [],
      intro: "This method looks for dry spells in the gauge readings.",
    };
  }
  const k = Math.min(st.spell ?? pickSpell(runs), runs.length - 1);
  const run = runs[k];
  const pts = rec.points.filter((p) => p.run === k);
  const evapCm = rec.options.evaporationCm;
  const P = rec.pooled;
  const stages = [
    `Spell ${k + 1}: from ${F.date(run.start, { year: false })} to ${F.date(run.end, { year: false })}, ${run.n} readings in a row with no rain, the water below the spillway, and the level only falling.`,
    "Draw the straight line that best fits the readings (least squares: the line with the smallest total squared distance to the points).",
    `The line falls ${F.num(-run.slope, 2)} cm for every day.`,
    `Evaporation accounts for ${F.num(evapCm, 2)} cm of that each day, so ${F.num(run.infiltrationCm, 2)} cm a day soaked in: ${F.num(run.infiltrationCm * 10, 1)} mm per day.`,
    `Do the same for all ${runs.length} spells and combine them, counting longer spells more: ${F.num(P.infiltrationMm, 1)} mm per day.`,
  ];
  const draw = (host, stage) => {
    const [svg, W, H] = canvas(host, 0.5, 240, 330, `Dry spell ${k + 1} with its fitted line`);
    const m = { l: 56, r: 24, t: 30, b: 40 };
    const t0 = pts[0].t;
    const xs = pts.map((p) => p.t - t0);
    const xmax = Math.max(...xs, 1);
    const ys = pts.map((p) => p.y);
    const fitAt = (x) => run.slope * (x + t0) + run.intercept;
    const ylo = Math.min(...ys, fitAt(xmax)) - 3;
    const yhi = Math.max(...ys, fitAt(0)) + 3;
    const X = (x) => m.l + (x / xmax) * (W - m.l - m.r);
    const Y = (y) => H - m.b - ((y - ylo) / (yhi - ylo)) * (H - m.t - m.b);
    s("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: "axis-line" }, svg);
    s("line", { x1: m.l, x2: m.l, y1: m.t, y2: H - m.b, class: "axis-line" }, svg);
    text(svg, W - m.r, H - 8, "Days into the spell", "tick axis-title", "end");
    text(svg, 4, m.t - 14, "Gauge reading (cm)", "tick axis-title", "start");
    for (let dd = 0; dd <= xmax; dd += Math.max(1, Math.round(xmax / 6))) text(svg, X(dd), H - m.b + 16, String(dd), "tick", "middle");
    for (const yv of [Math.ceil(ylo), Math.round((ylo + yhi) / 2), Math.floor(yhi)]) text(svg, m.l - 8, Y(yv) + 4, String(yv), "tick", "end");
    pts.forEach((p, i) => s("circle", { cx: X(xs[i]), cy: Y(p.y), r: 4.5, class: "dot", style: "--c:var(--c-water)" }, svg));
    if (stage >= 2) enter(s("line", { x1: X(0), y1: Y(fitAt(0)), x2: X(xmax), y2: Y(fitAt(xmax)), class: "fit", style: "--c:var(--c-recharge)" }, svg), stage === 2);
    if (stage >= 3) {
      const g = enter(s("g", {}, svg), stage === 3);
      const x1 = Math.min(1, xmax);
      const xa = X(0);
      const xb = X(x1);
      s("path", { d: `M${xa},${Y(fitAt(0))} H${xb} V${Y(fitAt(x1))}`, class: "learn-bracket" }, g);
      text(g, (xa + xb) / 2, Y(fitAt(0)) - 8, "1 day", "sec-label", "middle");
      text(g, xb + 8, (Y(fitAt(0)) + Y(fitAt(x1))) / 2 + 4, `−${F.num(-run.slope, 2)} cm`, "sec-label sec-label-strong");
    }
    if (stage >= 4) {
      const g = enter(s("g", {}, svg), stage === 4);
      text(g, W - m.r, m.t + 4, `${F.num(-run.slope, 2)} − ${F.num(evapCm, 2)} = ${F.num(run.infiltrationCm, 2)} cm/day soaked in`, "sec-label sec-label-strong", "end");
    }
    if (stage >= 5) {
      const g = enter(s("g", {}, svg), true);
      text(g, W - m.r, m.t + 22, `All spells combined: ${F.num(P.infiltrationMm, 1)} mm/day`, "sec-label sec-label-strong", "end");
    }
  };
  const eq = [
    {
      words: "Soaking rate = how fast the level fell during the dry spell − evaporation",
      symbols: "rate = −slope − e",
      numbers: `rate = ${F.num(-run.slope, 3)} − ${F.num(evapCm, 2)} = ${F.num(run.infiltrationCm, 3)} cm/day = ${F.num(run.infiltrationCm * 10, 1)} mm/day`,
    },
    {
      color: "var(--c-recharge)",
      words: "All spells together, each counted by its number of readings minus one",
      symbols: "r = −(Σ (n−1)·slope ÷ Σ (n−1)) − e",
      numbers: `r = −(${runs.map((r) => `${r.n - 1}×(${F.num(r.slope, 2)})`).join(" + ")}) ÷ ${P.weight} − ${F.num(evapCm, 2)} = ${F.num(P.infiltrationCm, 3)} cm/day = ${F.num(P.infiltrationMm, 1)} mm/day`,
    },
    {
      words: "The best-fit slope (least squares), for experts",
      symbols: "slope = (n·Σxy − Σx·Σy) ÷ (n·Σx² − (Σx)²)",
      numbers: `n = ${run.n} readings, x = day, y = gauge (cm): slope = ${F.num(run.slope, 4)} cm/day, R² = ${run.r2 == null ? "–" : F.num(run.r2, 3)}`,
    },
  ];
  return {
    stages,
    draw,
    eq,
    note: "This is the method of the spreadsheet’s MyWell sheet. It needs no pond survey, so it works for any check dam with gauge and rain readings.",
    intro: "A second way to find the soaking rate. When it doesn’t rain for several days, the level in the pond falls steadily. Fit a straight line through those readings: its slope is how fast the water drops. Take away evaporation and what’s left is soaking.",
    spells: runs.map((r, i) => ({ i, label: `Spell ${i + 1} · ${r.n} readings`, selected: i === k })),
  };
}

function pickSpell(runs) {
  // A spell of readable length: closest to ten readings.
  let best = 0;
  runs.forEach((r, i) => {
    if (Math.abs(r.n - 10) < Math.abs(runs[best].n - 10)) best = i;
  });
  return best;
}

// ---------------------------------------------------------------------------
// The Learn page

/**
 * @param {HTMLElement} root  where the lessons go
 * @param {{results:()=>object, goTab:(t:string)=>void}} ctx
 */
export function createLearn(root, ctx) {
  const st = { lesson: 0, stage: 1, day: null, quantity: "area", spell: null, soakChart: null, seasonChart: null, seasonTimer: null, seasonDay: null };

  const daySelect = h("select", { class: "learn-day-select", "aria-label": "Day to follow" });
  const prevBtn = h("button", { class: "btn btn-sm", type: "button", "aria-label": "Previous day", text: "◀" });
  const nextBtn = h("button", { class: "btn btn-sm", type: "button", "aria-label": "Next day", text: "▶" });
  const picks = h("div", { class: "learn-picks" });
  const dayBar = h("div", { class: "learn-daybar" }, h("span", { class: "label", text: "Day to follow" }), prevBtn, daySelect, nextBtn, picks);
  const lessonNav = h("div", { class: "learn-nav", role: "tablist", "aria-label": "Lessons" });
  const body = h("div", { class: "learn-body" });
  root.replaceChildren(
    h(
      "div",
      { class: "step-head" },
      h("div", { class: "step-kicker", text: "Learn" }),
      h("h2", { text: "How the calculation works" }),
      h("p", {
        class: "step-why",
        text: "Follow one day through the calculation, one picture at a time. The numbers are real: they come from the data you have open, so you can check every step.",
      }),
    ),
    h("div", { class: "card learn-card" }, dayBar, lessonNav, body),
  );

  daySelect.addEventListener("change", () => setDay(+daySelect.value));
  prevBtn.addEventListener("click", () => setDay(Math.max(0, st.day - 1)));
  nextBtn.addEventListener("click", () => setDay(Math.min(ctx.results().wb.days.length - 1, st.day + 1)));

  function setDay(i) {
    st.day = i;
    render();
  }

  function stopTimers() {
    clearInterval(st.seasonTimer);
    st.seasonTimer = null;
  }

  function open({ lesson, day } = {}) {
    if (lesson != null) {
      st.lesson = lesson;
      st.stage = 1;
    }
    if (day != null) st.day = day;
    render();
  }

  function render() {
    stopTimers();
    const { wb, rec } = ctx.results();
    if (!wb.ok) {
      dayBar.hidden = true;
      lessonNav.replaceChildren();
      body.replaceChildren(
        h(
          "div",
          { class: "notice" },
          h(
            "div",
            { class: "notice-body" },
            h("strong", { text: "The lessons use the data you have open. " }),
            "Finish Steps 1–3, or load the Badgaon example from the Start page, to follow a day through the calculation.",
          ),
        ),
      );
      return;
    }
    dayBar.hidden = st.lesson >= 4;
    const n = wb.days.length;
    const qp = quickPicks(wb);
    if (st.day == null || st.day >= n) st.day = qp.rainy ?? 0;
    // Day picker
    if (daySelect.options.length !== n || daySelect.dataset.first !== wb.days[0].date) {
      daySelect.replaceChildren(...wb.days.map((d, i) => h("option", { value: String(i), text: F.date(d.date) })));
      daySelect.dataset.first = wb.days[0].date;
    }
    daySelect.value = String(st.day);
    prevBtn.disabled = st.day <= 0;
    nextBtn.disabled = st.day >= n - 1;
    picks.replaceChildren(
      ...[
        ["A rainy day", qp.rainy, "water flowed in"],
        ["A dry day", qp.dry, "the level fell"],
        ["A spilling day", qp.spill, "water went over the dam"],
      ]
        .filter(([, i]) => i != null)
        .map(([label, i, hint]) =>
          h("button", {
            class: `btn btn-sm${st.day === i ? " btn-primary" : " btn-ghost"}`,
            type: "button",
            title: `${F.date(wb.days[i].date)}: ${hint}`,
            text: label,
            onclick: () => setDay(i),
          }),
        ),
    );
    // Lesson tabs
    lessonNav.replaceChildren(
      ...LESSONS.map((L, i) =>
        h(
          "button",
          {
            class: "learn-tab",
            type: "button",
            role: "tab",
            "aria-selected": String(i === st.lesson),
            onclick: () => open({ lesson: i }),
          },
          h("span", { class: "step-n", text: String(i + 1) }),
          L.short,
        ),
      ),
    );

    const v = dayView(wb, st.day);
    const L = LESSONS[st.lesson];
    const lesson =
      L.id === "level"
        ? lessonLevel(v)
        : L.id === "volume"
          ? lessonVolume(v, wb, st)
          : L.id === "balance"
            ? lessonBalance(v, wb, st, true)
            : L.id === "soak"
              ? lessonSoak(v, wb)
              : L.id === "season"
                ? lessonSeason(v, wb, st)
                : lessonSpell(rec, wb, st);
    const total = lesson.stages.length;
    st.stage = Math.min(Math.max(1, st.stage), total);

    const visual = h("div", { class: "learn-visual", tabindex: "0", "aria-label": "Picture. Use the arrow keys for the next or previous step." });
    const caption = h("p", { class: "learn-caption", role: "status", "aria-live": "polite" });
    const counter = h("span", { class: "learn-counter" });
    const back = h("button", { class: "btn btn-sm", type: "button", text: "Back" });
    const next = h("button", { class: "btn btn-sm btn-primary", type: "button", text: "Next" });
    const all = h("button", { class: "btn btn-sm btn-ghost", type: "button", text: "Show all" });
    const drawStage = () => {
      caption.textContent = lesson.stages[st.stage - 1];
      counter.textContent = `${st.stage} of ${total}`;
      back.disabled = st.stage <= 1;
      next.disabled = st.stage >= total;
      all.disabled = st.stage >= total;
      lesson.draw(visual, st.stage, st);
    };
    back.addEventListener("click", () => {
      st.stage -= 1;
      drawStage();
    });
    next.addEventListener("click", () => {
      st.stage += 1;
      drawStage();
    });
    all.addEventListener("click", () => {
      st.stage = total;
      drawStage();
    });
    visual.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" && st.stage < total) (st.stage += 1), drawStage(), e.preventDefault();
      if (e.key === "ArrowLeft" && st.stage > 1) (st.stage -= 1), drawStage(), e.preventDefault();
    });

    const extras = [];
    if (lesson.toggle) {
      extras.push(
        h(
          "div",
          { class: "seg learn-toggle", role: "group", "aria-label": "Show area or volume" },
          ...["area", "volume"].map((q) =>
            h("button", {
              type: "button",
              "aria-pressed": String(st.quantity === q),
              text: q === "area" ? "Water area" : "Water stored",
              onclick: () => {
                st.quantity = q;
                render();
              },
            }),
          ),
        ),
      );
    }
    if (lesson.spells) {
      extras.push(
        h(
          "div",
          { class: "learn-picks" },
          ...lesson.spells.map((sp) =>
            h("button", {
              class: `btn btn-sm${sp.selected ? " btn-primary" : " btn-ghost"}`,
              type: "button",
              text: sp.label,
              onclick: () => {
                st.spell = sp.i;
                render();
              },
            }),
          ),
        ),
      );
    }

    const dateLabel = st.lesson >= 4 ? "Numbers" : F.date(wb.days[st.day].date, { year: false });
    body.replaceChildren(
      h(
        "section",
        { class: "learn-lesson", "aria-labelledby": "learn-title" },
        h("div", { class: "learn-kicker", text: `Lesson ${st.lesson + 1} of ${LESSONS.length}` }),
        h("h3", { id: "learn-title", class: "learn-title", text: L.title }),
        h("p", { class: "learn-intro", text: lesson.intro }),
        extras.length ? h("div", { class: "learn-extras" }, extras) : null,
        h(
          "div",
          { class: "learn-stage" },
          visual,
          caption,
          h("div", { class: "learn-controls" }, back, counter, next, h("span", { class: "spacer" }), all),
        ),
        lesson.eq.length ? h("h4", { class: "learn-eq-title", text: "The equation" }) : null,
        lesson.eq.length ? equationBox(dateLabel, lesson.eq, lesson.note) : null,
        h(
          "div",
          { class: "step-foot" },
          st.lesson > 0 ? h("button", { class: "btn", type: "button", text: `Back: ${LESSONS[st.lesson - 1].short}`, onclick: () => open({ lesson: st.lesson - 1 }) }) : null,
          h("span", { class: "spacer" }),
          st.lesson < LESSONS.length - 1
            ? h("button", { class: "btn btn-primary", type: "button", text: `Next lesson: ${LESSONS[st.lesson + 1].short}`, onclick: () => open({ lesson: st.lesson + 1 }) })
            : h("button", { class: "btn btn-primary", type: "button", text: "See your results", onclick: () => ctx.goTab("balance") }),
        ),
      ),
    );
    drawStage();
    // Redraw on resize (the pictures are sized to their box).
    if (!st.ro) {
      st.ro = new ResizeObserver(() => {
        const vis = body.querySelector(".learn-visual");
        if (vis && root.offsetParent !== null) {
          const W = vis.clientWidth;
          if (W && W !== st.lastW) {
            st.lastW = W;
            render();
          }
        }
      });
      st.ro.observe(root);
    }
  }

  return { update: render, open, stop: stopTimers };
}
