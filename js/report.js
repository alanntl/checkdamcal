// The report: one model of what the results say, rendered twice — as the
// Report page on screen (app.js) and as a PDF (buildReportPdf, below). Both
// read the same model, so the page and the file cannot disagree.
//
// Pure: no DOM. The PDF comes back as bytes; the caller saves it.

import * as F from "./format.js";
import { dayNumber } from "./engine.js";
import { niceScale } from "./charts.js";
import { PdfDoc, A4 } from "./pdf.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const sum = (a) => a.reduce((s, v) => s + (isNum(v) ? v : 0), 0);

// Print colours: the light-theme tokens of css/styles.css.
export const REPORT_COLORS = {
  ink: "#102a33",
  ink2: "#34515a",
  muted: "#5a6d73",
  rule: "#dde6e4",
  ruleStrong: "#c3d0ce",
  accent: "#18776f",
  accentSoft: "#e1f1ee",
  paper: "#f6f9f8",
  water: "#2a78d6",
  rain: "#3987e5",
  recharge: "#1baf7a",
  evap: "#eb6834",
  spill: "#7c878c",
  other: "#b4bec1",
};
const C = REPORT_COLORS;

export const METHOD_CREDIT = "Method of the MyCheckDam workbook (water balance template by Peter Dillon, MARVI).";

/** A file-name-safe version of the site name. */
export function reportFileName(project) {
  const base = String(project?.site?.name || "check-dam")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "check-dam"}-water-balance.pdf`;
}

/**
 * Everything the report says, as plain data.
 * @param project  the CheckDamCal project
 * @param results  { wb, rec, sens } as computed by app.js
 * @param opts     { source: where the data came from, generatedAt: Date }
 */
export function reportModel(project, results, { source = "", generatedAt = new Date() } = {}) {
  const { wb, rec, sens } = results || {};
  const site = project?.site?.name || "Check dam";
  if (!wb?.ok) {
    return {
      ok: false,
      site,
      problems: [...(wb?.errors || []), ...(wb?.problems || []).map((q) => q.text)],
    };
  }
  const p = wb.params;
  const t = wb.totals;
  const e = wb.endOfSeason;
  const days = wb.days;
  const first = days[0].date;
  const last = days[days.length - 1].date;

  const parts = [
    { key: "recharge", label: "Soaked into the ground", value: t.rechargeWithEnd, color: C.recharge },
    { key: "evap", label: "Evaporated", value: t.evaporationWithEnd, color: C.evap },
    { key: "spill", label: "Spilled over the dam", value: t.spill, color: C.spill },
  ];
  if (t.storageLeft > 0) parts.push({ key: "left", label: "Still in the pond", value: t.storageLeft, color: C.other });
  const whole = sum(parts.map((q) => q.value));
  for (const q of parts) q.share = whole > 0 ? q.value / whole : 0;

  const bySource = (s) => days.filter((d) => d.levelSource === s).length;
  const counts = {
    gauge: bySource("gauge"),
    override: bySource("override"),
    rule: bySource("rule"),
    interpolated: bySource("interpolated"),
  };
  const pending = days.filter((d, i) => d.qaSuggestedLevel != null && project.readings[i]?.level == null);

  const keyNumbers = [
    { label: "Rainfall", value: `${F.num(t.rain, 1)} mm`, note: `${wb.counts.rainDays} days with rain` },
    {
      label: "Water that flowed into the pond",
      value: `${F.num(t.inflow)} m³`,
      note: isNum(wb.ratios.runoffCoefficient)
        ? `${F.pct(wb.ratios.runoffCoefficient)} of the rain that fell on the catchment`
        : "Catchment area not given, so no runoff coefficient",
    },
    {
      label: "Soaked into the ground (recharge)",
      value: `${F.num(t.rechargeWithEnd)} m³`,
      note: `${F.pct(t.rechargeWithEnd / (whole || 1))} of the water; ${F.num(t.rechargeWithEnd / 1000, 1)} million litres`,
    },
    { label: "Evaporated from the pond", value: `${F.num(t.evaporationWithEnd)} m³`, note: `${F.pct(t.evaporationWithEnd / (whole || 1))} of the water` },
    {
      label: "Spilled over the dam",
      value: `${F.num(t.spill)} m³`,
      note: `${F.pct(t.spill / (whole || 1))} of the water; the dam spilled on ${wb.counts.spillDays} day${wb.counts.spillDays === 1 ? "" : "s"}`,
    },
    {
      label: "Water in the pond on the last day",
      value: `${F.num(e.remaining)} m³`,
      note: e.applied
        ? `Shared out by rate: ${F.num(e.recharge)} m³ soaks in, ${F.num(e.evaporation)} m³ evaporates (included above)`
        : "Not shared out: shown as still in the pond",
    },
    {
      label: "Infiltration rate on dry days",
      value: `${F.num(wb.mdwir * 1000, 1)} mm/day`,
      note: `Mean of ${wb.counts.dryDays} dry days with a falling level`,
    },
  ];
  const pooled = rec?.ok && rec.runs?.length && rec.pooled ? rec.pooled : null;
  if (pooled) {
    keyNumbers.push({
      label: "Infiltration rate from the gauge alone",
      value: `${F.num(pooled.infiltrationMm, 1)} mm/day`,
      note: `${rec.runs.length} dry spell${rec.runs.length === 1 ? "" : "s"}, weighted by length (${F.num(pooled.unweightedInfiltrationMm, 1)} mm/day if each counts once)`,
    });
  }
  keyNumbers.push({
    label: "Balance check",
    value: `${F.num(t.balance, 2)} m³`,
    note: "Water in minus water out. 0 means every drop is accounted for",
  });

  const stageRows = wb.stage.rows;
  const top = stageRows[stageRows.length - 1];
  const inputs = [
    { label: "Gauge board 0 cm mark", value: `${F.trim(p.gaugeZeroRl, 3)} m`, note: "Level of the gauge's zero" },
    { label: "Spillway level", value: `${F.trim(p.ctfRl, 3)} m`, note: "Water above this spills over the dam" },
    { label: "Spillway length", value: `${F.trim(p.weirLength, 2)} m`, note: `Spill = ${F.trim(p.weirCoefficient, 3)} × length × height over the spillway^${F.trim(p.weirExponent, 2)}, in m³/s` },
    { label: "Evaporation", value: `${F.trim(p.evaporation * 1000, 2)} mm/day`, note: "From the pond's surface, the same every day" },
    {
      label: "Catchment area",
      value: isNum(p.catchmentHa) && p.catchmentHa > 0 ? `${F.trim(p.catchmentHa, 2)} ha` : "–",
      note: isNum(p.catchmentHa) && p.catchmentHa > 0 ? "Land draining to the dam" : "Not given",
    },
    {
      label: "Pond survey",
      value: `${stageRows.length} levels`,
      note: `${F.trim(stageRows[0].rl, 3)} to ${F.trim(top.rl, 3)} m; ${F.num(top.volume)} m³ at the top level`,
    },
    {
      label: "Daily readings",
      value: `${days.length} days`,
      note: [
        `${counts.gauge} from the gauge`,
        counts.override ? `${counts.override} corrected by hand` : null,
        counts.rule ? `${counts.rule} set by the dry-day rule` : null,
        counts.interpolated ? `${counts.interpolated} filled in between readings` : null,
      ]
        .filter(Boolean)
        .join(", "),
    },
  ];

  const checks = [...wb.warnings];
  if (counts.interpolated) {
    checks.push(
      `${counts.interpolated} of ${days.length} days had no gauge reading; their level was filled in along a straight line between the readings either side.`,
    );
  }
  if (pending.length) {
    const list = pending.slice(0, 6).map((d) => F.date(d.date, { year: false })).join(", ");
    checks.push(
      `${pending.length} reading${pending.length === 1 ? "" : "s"} may be wrong (the level rose on a dry day or fell faster than water can soak in): ${list}${pending.length > 6 ? ", …" : ""}. They were used as entered.`,
    );
  }

  const sensitivity = (sens || [])
    .filter((s) => s.ok)
    .map((s) => ({
      label: s.label,
      change: `${s.factor > 1 ? "+" : "−"}${F.num(Math.abs(s.factor - 1) * 100, 0)}%`,
      value: s.key === "evaporation" ? `${F.trim(s.value * 1000, 2)} mm/day` : s.key === "weir" ? F.trim(s.value, 3) : `${F.trim(s.value * 1000, 1)} mm/day`,
      recharge: F.signedPct(s.change.recharge),
      evaporation: F.signedPct(s.change.evaporation),
      spill: F.signedPct(s.change.spill),
    }));

  return {
    ok: true,
    site,
    notes: project?.site?.notes || "",
    source,
    generatedAt,
    period: { first, last, days: days.length, label: F.dateRange(first, last) },
    headline: {
      recharge: t.rechargeWithEnd,
      share: t.inflow ? t.rechargeWithEnd / t.inflow : null,
      inflow: t.inflow,
    },
    parts,
    keyNumbers,
    inputs,
    checks,
    periods: wb.periods.length > 1 ? wb.periods.map((q) => ({ ...q })) : [],
    sensitivity,
    recession: pooled
      ? {
          runs: rec.runs.map((r) => ({ start: r.start, end: r.end, n: r.n, slope: r.slope, r2: r.r2 })),
          pooled,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// PDF

const M = { l: 48, r: 48, t: 56, b: 56 };
const CW = A4.width - M.l - M.r; // content width

/** The PDF report as bytes. */
export function buildReportPdf(project, results, opts = {}) {
  const model = reportModel(project, results, opts);
  if (!model.ok) throw new Error("The results are not ready yet: " + model.problems.join(" "));
  const { wb } = results;
  const doc = new PdfDoc({ title: `${model.site}: check dam water balance`, subject: model.period.label, creationDate: model.generatedAt });

  summaryPage(doc, model);
  chartsPage(doc, model, wb);
  const y = methodPage(doc, model, wb);
  dailyPages(doc, wb, y);

  // Running header and footer, now that the page count is known.
  const total = doc.pageCount;
  for (let i = 0; i < total; i++) {
    doc.goTo(i);
    if (i > 0) {
      doc.text(model.site, M.l, 34, { size: 8.5, bold: true, color: C.ink2 });
      doc.text(`Check dam water balance · ${model.period.label}`, A4.width - M.r, 34, { size: 8.5, color: C.muted, align: "right" });
      doc.line(M.l, 41, A4.width - M.r, 41, { color: C.rule });
    }
    doc.line(M.l, A4.height - 42, A4.width - M.r, A4.height - 42, { color: C.rule });
    doc.text(`CheckDamCal · ${METHOD_CREDIT}`, M.l, A4.height - 30, { size: 7.5, color: C.muted });
    doc.text(`Page ${i + 1} of ${total}`, A4.width - M.r, A4.height - 30, { size: 7.5, color: C.muted, align: "right" });
  }
  return doc.save();
}

function heading(doc, text, y, size = 13) {
  doc.text(text, M.l, y + size, { size, bold: true, color: C.ink });
  return y + size + 10;
}

/** Label | value | note rows with hairlines; returns the y below the table. */
function keyTable(doc, rows, y) {
  const valueRight = M.l + 300;
  const noteX = valueRight + 14;
  const noteW = A4.width - M.r - noteX;
  for (const r of rows) {
    const labelLines = doc.wrap(r.label, 196, 9.5);
    const noteLines = r.note ? doc.wrap(r.note, noteW, 8.5) : [];
    const h = Math.max(labelLines.length * 12.5, noteLines.length * 11.2, 12.5) + 9;
    labelLines.forEach((line, i) => doc.text(line, M.l, y + 13 + i * 12.5, { size: 9.5, color: C.ink }));
    doc.text(r.value, valueRight, y + 13, { size: 9.5, bold: true, color: C.ink, align: "right" });
    noteLines.forEach((line, i) => doc.text(line, noteX, y + 12.5 + i * 11.2, { size: 8.5, color: C.muted }));
    y += h;
    doc.line(M.l, y, A4.width - M.r, y, { color: C.rule, width: 0.4 });
  }
  return y;
}

function summaryPage(doc, m) {
  doc.page();
  let y = M.t - 20;
  doc.text("Check dam water balance", M.l, y + 11, { size: 11, bold: true, color: C.accent });
  y += 18;
  const titleLines = doc.wrap(m.site, CW, 22, true);
  titleLines.forEach((line, i) => doc.text(line, M.l, y + 22 + i * 26, { size: 22, bold: true, color: C.ink }));
  y += titleLines.length * 26 + 10;
  const generated = F.date(m.generatedAt.toISOString().slice(0, 10));
  doc.text(`${m.period.label} · ${m.period.days} days · report made ${generated}`, M.l, y + 10, { size: 10, color: C.ink2 });
  y += 16;
  if (m.source) {
    y = doc.paragraph(`Data: ${m.source}`, M.l, y, CW, { size: 8.5, color: C.muted, lineHeight: 1.3 });
  }
  y += 12;

  // Headline
  const boxH = 74;
  doc.rect(M.l, y, CW, boxH, { fill: C.accentSoft });
  const big = `${F.num(m.headline.recharge)} m³`;
  doc.text(big, M.l + 16, y + 34, { size: 24, bold: true, color: C.ink });
  const share = isNum(m.headline.share) ? F.pct(m.headline.share) : "–";
  doc.paragraph(
    `soaked into the ground: ${share} of the ${F.num(m.headline.inflow)} m³ of water that flowed into the pond. This is the groundwater recharge from the check dam.`,
    M.l + 16,
    y + 42,
    CW - 32,
    { size: 9.5, color: C.ink2, lineHeight: 1.3 },
  );
  y += boxH + 18;

  // Where the water went: one bar split by share, 1.5 pt paper gaps between pieces.
  doc.text("Where the water went", M.l, y + 10, { size: 10, bold: true, color: C.ink });
  y += 18;
  let x = M.l;
  m.parts.forEach((q, i) => {
    const w = CW * q.share;
    const gap = i < m.parts.length - 1 ? Math.min(1.5, w * 0.25) : 0;
    if (w > 0) doc.rect(x, y, Math.max(0.5, w - gap), 16, { fill: q.color });
    x += w;
  });
  y += 26;
  const colW = CW / m.parts.length;
  m.parts.forEach((q, i) => {
    const cx = M.l + i * colW;
    doc.rect(cx, y + 2, 8, 8, { fill: q.color });
    doc.text(q.label, cx + 13, y + 9.5, { size: 8.5, bold: true, color: C.ink });
    doc.text(`${F.num(q.value)} m³ · ${F.pct(q.share)}`, cx + 13, y + 21, { size: 8.5, color: C.ink2 });
  });
  y += 40;

  y = heading(doc, "Key numbers", y, 12);
  y = keyTable(doc, m.keyNumbers, y);
  y += 20;
  y = heading(doc, "What went in", y, 12);
  keyTable(doc, m.inputs, y);
}

// --- charts --------------------------------------------------------------

function monthTicks(x0, x1) {
  const out = [];
  const d0 = new Date(x0 * 86400000);
  let y = d0.getUTCFullYear();
  let mo = d0.getUTCMonth() + 1;
  if (mo > 11) (mo = 0), (y += 1);
  const span = x1 - x0;
  const step = span > 800 ? 3 : span > 400 ? 2 : 1;
  for (let guard = 0; guard < 400; guard++) {
    const dn = Date.UTC(y, mo, 1) / 86400000;
    if (dn > x1) break;
    if (dn >= x0 && mo % step === 0) out.push({ x: dn, label: mo === 0 ? `Jan ${y}` : F.monthLabel(mo) });
    mo += 1;
    if (mo > 11) (mo = 0), (y += 1);
  }
  return out;
}

/** Axes, grid and ticks for one time chart; returns the scales. */
function timeFrame(doc, box, x0, x1, lo, hi, { title, unit, yFmt, maxTicks }) {
  doc.text(title, box.x, box.y - 8, { size: 10, bold: true, color: C.ink });
  if (unit) doc.text(unit, box.x + doc.width(title, 10, true) + 6, box.y - 8, { size: 8.5, color: C.muted });
  const sc = niceScale(lo, hi, maxTicks || Math.max(3, Math.min(6, Math.floor(box.h / 32))));
  const X = (v) => box.x + ((v - x0) / (x1 - x0 || 1)) * box.w;
  const Y = (v) => box.y + box.h - ((v - sc.min) / (sc.max - sc.min || 1)) * box.h;
  for (const tv of sc.ticks) {
    doc.line(box.x, Y(tv), box.x + box.w, Y(tv), { color: tv === 0 ? C.ruleStrong : C.rule, width: tv === 0 ? 0.6 : 0.4 });
    doc.text((yFmt || ((v) => F.num(v, sc.digits)))(tv), box.x - 5, Y(tv) + 3, { size: 7.5, color: C.muted, align: "right" });
  }
  doc.line(box.x, box.y + box.h, box.x + box.w, box.y + box.h, { color: C.ruleStrong, width: 0.6 });
  for (const tk of monthTicks(x0, x1)) {
    doc.line(X(tk.x), box.y + box.h, X(tk.x), box.y + box.h + 3, { color: C.ruleStrong, width: 0.6 });
    doc.text(tk.label, X(tk.x), box.y + box.h + 12, { size: 7.5, color: C.muted, align: "center" });
  }
  return { X, Y, sc };
}

/** A label in the right margin of a chart, level with y. */
function marginLabel(doc, b, y, text, color = C.ink2) {
  doc.text(text, b.x + b.w + 6, y + 3, { size: 7.5, color });
}

function chartsPage(doc, m, wb) {
  doc.page();
  const days = wb.days;
  const xs = days.map((d) => dayNumber(d.date));
  const x0 = xs[0] - 0.5;
  const x1 = xs[xs.length - 1] + 0.5;
  let y = M.t;
  y = heading(doc, "Through the season", y, 14);
  // Every chart has the same plot width, so a date sits at the same x in all four.
  const box = (top, h) => ({ x: M.l + 34, y: top, w: CW - 34 - 86, h });
  const barW = (b) => Math.max(0.6, Math.min(6, (b.w / days.length) * 0.7));

  // Rainfall bars
  let b = box(y + 16, 78);
  const rainMax = Math.max(1, ...days.map((d) => d.rain || 0));
  let f = timeFrame(doc, b, x0, x1, 0, rainMax, { title: "Rainfall", unit: "mm per day", yFmt: (v) => F.num(v) });
  days.forEach((d, i) => {
    if (d.rain > 0) doc.rect(f.X(xs[i]) - barW(b) / 2, f.Y(d.rain), barW(b), f.Y(0) - f.Y(d.rain), { fill: C.rain });
  });
  marginLabel(doc, b, b.y + 6, `${F.num(wb.totals.rain, 1)} mm`);
  marginLabel(doc, b, b.y + 16, "in total", C.muted);

  // Water level, with the spillway
  b = box(b.y + b.h + 46, 124);
  const levels = days.map((d) => d.level);
  const crest = wb.params.ctfRl;
  const lo = Math.min(...levels, wb.stage.rows[0].rl);
  const hi = Math.max(...levels, crest);
  f = timeFrame(doc, b, x0, x1, lo, hi, { title: "Water level in the pond", unit: "m", maxTicks: 6 });
  const levelPts = days.map((d, i) => [f.X(xs[i]), f.Y(d.level)]);
  doc.path([[levelPts[0][0], f.Y(f.sc.min)], ...levelPts, [levelPts[levelPts.length - 1][0], f.Y(f.sc.min)]], { fill: "#dbe9fa", close: true });
  doc.path(levelPts, { stroke: C.water, width: 1.2 });
  doc.line(b.x, f.Y(crest), b.x + b.w, f.Y(crest), { color: C.ink2, width: 0.6, dash: [3, 2] });
  marginLabel(doc, b, f.Y(crest), `Spillway ${F.trim(crest, 2)} m`);
  days.forEach((d, i) => {
    if (d.levelSource === "interpolated") doc.circle(f.X(xs[i]), f.Y(d.level), 1.1, { fill: C.other });
  });
  let noteY = b.y + b.h + 26;
  if (days.some((d) => d.levelSource === "interpolated")) {
    doc.circle(b.x + 3, noteY - 2.5, 1.6, { fill: C.other });
    doc.text("Grey dots: days without a reading, filled in between readings.", b.x + 9, noteY, { size: 7.5, color: C.muted });
    noteY += 10;
  }

  // Running totals, labelled at their ends
  b = box(noteY + 36, 156);
  const series = [
    { label: "Flowed in", color: C.water, v: days.map((d) => d.cumInflow) },
    { label: "Spilled", color: C.spill, v: days.map((d) => d.cumSpill) },
    { label: "Soaked in", color: C.recharge, v: days.map((d) => d.cumRecharge) },
    { label: "Evaporated", color: C.evap, v: days.map((d) => d.cumEvaporation) },
  ];
  const cumMax = Math.max(1, ...series.flatMap((s) => s.v));
  f = timeFrame(doc, b, x0, x1, 0, cumMax, { title: "Where the water went, day by day", unit: "m³, running totals", yFmt: (v) => F.num(v) });
  const ends = [];
  for (const s of series) {
    doc.path(s.v.map((v, i) => [f.X(xs[i]), f.Y(v)]), { stroke: s.color, width: 1.3 });
    ends.push({ y: f.Y(s.v[s.v.length - 1]), s });
  }
  // End labels at least 11 pt apart, top to bottom.
  ends.sort((a, c) => a.y - c.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 11);
  for (const e of ends) {
    doc.rect(b.x + b.w + 6, e.y - 4, 6, 6, { fill: e.s.color });
    doc.text(`${e.s.label} ${F.num(e.s.v[e.s.v.length - 1] / 1000, 1)}k`, b.x + b.w + 15, e.y + 2, { size: 7.5, color: C.ink2 });
  }
  doc.text("Totals up to the last day, before the water left in the pond is shared out.", b.x, b.y + b.h + 26, { size: 7.5, color: C.muted });

  // Dry-day infiltration rate
  b = box(b.y + b.h + 62, 78);
  const rates = days.map((d) => (d.dryRate > 0 ? d.dryRate * 1000 : 0));
  f = timeFrame(doc, b, x0, x1, 0, Math.max(1, ...rates, wb.mdwir * 1000), { title: "Infiltration rate on dry days", unit: "mm per day", yFmt: (v) => F.num(v) });
  days.forEach((d, i) => {
    if (rates[i] > 0) doc.rect(f.X(xs[i]) - barW(b) / 2, f.Y(rates[i]), barW(b), f.Y(0) - f.Y(rates[i]), { fill: C.recharge });
  });
  doc.line(b.x, f.Y(wb.mdwir * 1000), b.x + b.w, f.Y(wb.mdwir * 1000), { color: C.ink2, width: 0.6, dash: [3, 2] });
  marginLabel(doc, b, f.Y(wb.mdwir * 1000), `Mean ${F.num(wb.mdwir * 1000, 1)}`);
}

// --- method, checks, tables ----------------------------------------------

function ensureRoom(doc, y, need) {
  if (y + need <= A4.height - M.b) return y;
  doc.page();
  return M.t;
}

function simpleTable(doc, y, cols, rows, { size = 8.5, rowH = 15 } = {}) {
  // cols: [{ label, w, align }]
  const drawHead = (yy) => {
    let x = M.l;
    for (const c of cols) {
      doc.text(c.label, c.align === "right" ? x + c.w - 4 : x, yy + 10, { size: size - 0.5, bold: true, color: C.ink2, align: c.align === "right" ? "right" : "left" });
      x += c.w;
    }
    doc.line(M.l, yy + 15, A4.width - M.r, yy + 15, { color: C.ruleStrong, width: 0.6 });
    return yy + 17;
  };
  y = drawHead(y);
  for (const r of rows) {
    if (y + rowH > A4.height - M.b) {
      doc.page();
      y = drawHead(M.t);
    }
    let x = M.l;
    cols.forEach((c, i) => {
      doc.text(r[i] ?? "", c.align === "right" ? x + c.w - 4 : x, y + 10, { size, color: C.ink, align: c.align === "right" ? "right" : "left" });
      x += c.w;
    });
    y += rowH;
    doc.line(M.l, y - 2, A4.width - M.r, y - 2, { color: C.rule, width: 0.3 });
  }
  return y;
}

const METHOD = [
  ["Water level", "Level = the level of the gauge's 0 cm mark + the gauge reading ÷ 100."],
  ["Area and volume", "Read from the pond survey, along a straight line between the two surveyed levels either side of the day's level."],
  ["Each day", "Water that flowed in = change in the water stored + evaporation + water soaking in + spill."],
  ["Evaporation", "The average water area of the day and the day before × the evaporation rate."],
  [
    "Soaking in",
    "On a dry day with a falling level, the fall in level minus evaporation (plus any rain) is the day's infiltration rate. On other days the season's mean dry-day rate is used. Either way it is × the average water area.",
  ],
  ["Spill", "C₁ × spillway length × (level − spillway level)^a₁ × 86,400 seconds, on days above the spillway."],
  ["End of the season", "Water still in the pond on the last day is shared between soaking in and evaporation in proportion to their rates."],
];
const LIMITS = [
  "One reading a day is assumed. Days without a reading are filled in between the readings either side, so long gaps make the daily figures less certain.",
  "Evaporation is one fixed rate for the whole season.",
  "Everything that leaves the pond other than by evaporation and spill is counted as soaking in, including any seepage through or under the dam wall.",
  "Rain falling on the pond itself is part of the water that flowed in.",
];

function methodPage(doc, m, wb) {
  doc.page();
  let y = M.t;
  y = heading(doc, "How the numbers were worked out", y, 14);
  for (const [term, text] of METHOD) {
    doc.text(term, M.l, y + 10, { size: 9, bold: true, color: C.ink });
    y = doc.paragraph(text, M.l + 100, y, CW - 100, { size: 9, color: C.ink2, lineHeight: 1.35 }) + 5;
  }
  y += 8;
  y = heading(doc, "Assumptions and limits", y, 11);
  for (const text of LIMITS) {
    doc.text("•", M.l + 2, y + 9.5, { size: 9, color: C.muted });
    y = doc.paragraph(text, M.l + 14, y, CW - 14, { size: 9, color: C.ink2, lineHeight: 1.35 }) + 3;
  }

  y += 10;
  y = ensureRoom(doc, y, 60);
  y = heading(doc, "Checks on the data", y, 11);
  if (!m.checks.length) {
    y = doc.paragraph("No problems found in the readings.", M.l, y, CW, { size: 9, color: C.ink2 }) + 4;
  }
  for (const text of m.checks) {
    y = ensureRoom(doc, y, 30);
    doc.text("•", M.l + 2, y + 9.5, { size: 9, color: C.evap });
    y = doc.paragraph(text, M.l + 14, y, CW - 14, { size: 9, color: C.ink2, lineHeight: 1.35 }) + 3;
  }

  if (m.periods.length) {
    y = ensureRoom(doc, y + 12, 80);
    y = heading(doc, "Infiltration by period", y, 11);
    y = simpleTable(
      doc,
      y,
      [
        { label: "Period", w: 220 },
        { label: "Days", w: 70, align: "right" },
        { label: "Dry days", w: 80, align: "right" },
        { label: "Rate (mm/day)", w: 129, align: "right" },
      ],
      m.periods.map((q) => [F.dateRange(q.start, q.end), String(q.days), String(q.dryDays), q.mdwir == null ? "–" : F.num(q.mdwir * 1000, 1)]),
    );
  }

  if (m.sensitivity.length) {
    y = ensureRoom(doc, y + 14, 130);
    y = heading(doc, "How much the result depends on the inputs", y, 11);
    y = doc.paragraph("Each input changed on its own, everything else as entered. The figures are the change in each total.", M.l, y, CW, {
      size: 8.5,
      color: C.muted,
    });
    y = simpleTable(
      doc,
      y + 4,
      [
        { label: "Input", w: 190 },
        { label: "Change", w: 50, align: "right" },
        { label: "Value", w: 69, align: "right" },
        { label: "Soaked in", w: 64, align: "right" },
        { label: "Evaporated", w: 64, align: "right" },
        { label: "Spilled", w: 62, align: "right" },
      ],
      m.sensitivity.map((s) => [s.label, s.change, s.value, s.recharge, s.evaporation, s.spill]),
    );
  }

  if (m.recession) {
    y = ensureRoom(doc, y + 14, 110);
    y = heading(doc, "Infiltration from the gauge alone", y, 11);
    y = doc.paragraph(
      "A second estimate that needs only the gauge and the rain: a straight line through each dry spell's readings gives how fast the level fell; minus evaporation, that is the infiltration rate.",
      M.l,
      y,
      CW,
      { size: 8.5, color: C.muted },
    );
    y = simpleTable(
      doc,
      y + 4,
      [
        { label: "Dry spell", w: 200 },
        { label: "Readings", w: 70, align: "right" },
        { label: "Fall (cm/day)", w: 110, align: "right" },
        { label: "Fit (R²)", w: 119, align: "right" },
      ],
      m.recession.runs.map((r) => [
        F.dateRange(r.start, r.end),
        String(r.n),
        F.num(-r.slope, 2),
        r.r2 == null ? "–" : F.num(r.r2, 3),
      ]),
    );
    doc.text(
      `Weighted by spell length: ${F.num(m.recession.pooled.infiltrationMm, 1)} mm/day (each spell once: ${F.num(m.recession.pooled.unweightedInfiltrationMm, 1)} mm/day).`,
      M.l,
      y + 12,
      { size: 9, bold: true, color: C.ink },
    );
    y += 18;
  }
  return y;
}

function dailyPages(doc, wb, y) {
  if (y == null || y > A4.height - M.b - 220) {
    doc.page();
    y = M.t;
  } else y += 24;
  y = heading(doc, "Every day", y, 14);
  y = doc.paragraph(
    "Volumes in m³. Level marks: * corrected by hand, r set by the dry-day rule, ~ filled in between readings.",
    M.l,
    y,
    CW,
    { size: 8.5, color: C.muted },
  );
  const mark = { override: " *", rule: " r", interpolated: " ~" };
  simpleTable(
    doc,
    y + 4,
    [
      { label: "Date", w: 62 },
      { label: "Gauge (cm)", w: 50, align: "right" },
      { label: "Level (m)", w: 58, align: "right" },
      { label: "Rain (mm)", w: 46, align: "right" },
      { label: "Stored", w: 56, align: "right" },
      { label: "Flowed in", w: 56, align: "right" },
      { label: "Soaked in", w: 56, align: "right" },
      { label: "Evaporated", w: 58, align: "right" },
      { label: "Spilled", w: 57, align: "right" },
    ],
    wb.days.map((d) => [
      F.date(d.date),
      isNum(d.gauge) ? F.trim(d.gauge, 1) : "–",
      `${F.num(d.level, 3)}${mark[d.levelSource] || ""}`,
      d.rain ? F.trim(d.rain, 1) : "",
      F.num(d.volume),
      F.num(d.inflow),
      F.num(d.dryRecharge + d.wetRecharge, 1),
      F.num(d.evaporation, 1),
      d.spill ? F.num(d.spill) : "",
    ]),
    { size: 7.5, rowH: 12.6 },
  );
}
