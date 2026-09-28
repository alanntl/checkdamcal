// Reading spreadsheets / project files, and writing results.
//
// Uses SheetJS (vendor/xlsx.mini.min.js, loaded as the global XLSX).
// Everything read from a file is data: names and labels only ever reach the
// page through textContent.

import { isoFromDayNumber, dayNumber, DEFAULT_PARAMS, DEFAULT_RECESSION, DRY_DAY_RULE } from "./engine.js";
import { dateRange, trim } from "./format.js";

const TEMPLATE_SHEET = "1 Daily & seasonal waterbalance";
const STAGE_SHEET = "2. Area-RL and Vol EL curves";
const MYWELL_SHEET = "Check dam calculator for MyWell";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const X = () => {
  if (!window.XLSX) throw new Error("The spreadsheet reader did not load. Reload the page and try again.");
  return window.XLSX;
};

/** Excel serial date (1900 system) -> ISO date. 25569 is 1970-01-01. */
export function serialToIso(v) {
  return isoFromDayNumber(Math.floor(v + 1e-9) - 25569);
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** A date cell -> ISO. Accepts serials, 2014-07-16, 16/07/2014 (day first), 16-Jul-2014. */
export function toIsoDate(v) {
  if (v == null || v === "") return null;
  if (isNum(v)) return v > 1000 && v < 100000 ? serialToIso(v) : null;
  if (v instanceof Date && !Number.isNaN(+v)) return isoFromDayNumber(Math.floor((+v - v.getTimezoneOffset() * 60000) / 86400000));
  const t = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(t);
  if (m) return iso(fullYear(+m[3]), +m[2], +m[1]);
  m = /^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-](\d{2,4})$/.exec(t);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(fullYear(+m[3]), MONTHS[m[2].toLowerCase()], +m[1]);
  return null;
}
const fullYear = (y) => (y < 100 ? 2000 + y : y);
function iso(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const out = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return Number.isFinite(dayNumber(out)) && isoFromDayNumber(dayNumber(out)) === out ? out : null;
}

function toTime(v) {
  if (v == null || v === "") return null;
  if (isNum(v)) {
    const mins = Math.round((v - Math.floor(v)) * 1440);
    return `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  }
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v).trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

const toNum = (v) => {
  if (isNum(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.replace(/,/g, "")))) return Number(v.replace(/,/g, ""));
  return null;
};
const cell = (ws, addr) => (ws && ws[addr] ? ws[addr].v : null);

// ---------------------------------------------------------------------------
// Reading

/**
 * Read a .xlsx / .xls / .csv / .json file.
 * @returns {Promise<{kind:"project"|"readings", project?:object, readings?:object[], summary:string[], warnings:string[]}>}
 */
export async function readFile(file) {
  const name = file.name || "file";
  if (/\.json$/i.test(name)) {
    const data = JSON.parse(await file.text());
    return { kind: "project", project: checkProject(data), summary: [`Opened the project saved in ${name}.`], warnings: [] };
  }
  const buf = await file.arrayBuffer();
  const wb = X().read(buf, { type: "array", cellDates: false });
  if (wb.Sheets[TEMPLATE_SHEET]) return fromTemplate(wb, name); // the original MyCheckDam workbook
  if (findSheet(wb, SIMPLE.readings) || findSheet(wb, SIMPLE.dam)) return fromSimpleTemplate(wb, name); // the fill-in template
  return fromTable(wb, name); // one table: readings, a pond survey or the check dam's levels
}

/** The MyCheckDam workbook layout (Peter Dillon's template). */
export function fromTemplate(wb, fileName = "") {
  const ws = wb.Sheets[TEMPLATE_SHEET];
  const summary = [];
  const warnings = [];
  const param = (addr, key) => {
    const v = toNum(cell(ws, addr));
    if (v == null) {
      warnings.push(`Cell ${addr} is empty; kept the default ${key} (${DEFAULT_PARAMS[key]}).`);
      return DEFAULT_PARAMS[key];
    }
    return v;
  };
  const params = {
    ...DEFAULT_PARAMS,
    evaporation: param("F6", "evaporation"),
    gaugeZeroRl: param("K6", "gaugeZeroRl"),
    catchmentHa: param("O7", "catchmentHa"),
    weirLength: param("I9", "weirLength"),
    ctfRl: param("K9", "ctfRl"),
    weirCoefficient: param("M9", "weirCoefficient"),
    weirExponent: param("O9", "weirExponent"),
  };

  // Daily rows start at 13 and run while column A holds a date.
  const all = [];
  for (let r = 13; r < 13 + 5000; r++) {
    const d = toIsoDate(cell(ws, `A${r}`));
    if (!d) break;
    all.push({
      row: r,
      date: d,
      gauge: toNum(cell(ws, `B${r}`)),
      levelD: toNum(cell(ws, `D${r}`)),
      // D = AC (same row) is the workbook's dry-day correction applied as a formula.
      levelRule: new RegExp(`^=?\\$?AC\\$?${r}$`, "i").test(String(ws[`D${r}`]?.f || "").trim()),
      rain: toNum(cell(ws, `J${r}`)),
      calculated: toNum(cell(ws, `O${r}`)) != null,
    });
  }
  if (!all.length) throw new Error(`No dates found in column A of “${TEMPLATE_SHEET}” from row 13.`);
  // The workbook only balances the rows that carry its formulas (column O).
  const calculated = all.filter((x) => x.calculated);
  const rows = calculated.length ? all.slice(0, all.indexOf(calculated[calculated.length - 1]) + 1) : all;
  const tail = all.length - rows.length;

  let typed = 0;
  let ruled = 0;
  const readings = rows.map((x) => {
    let level = null;
    if (x.levelRule) {
      level = DRY_DAY_RULE;
      ruled += 1;
    } else if (x.levelD != null) {
      const fromGauge = x.gauge != null ? params.gaugeZeroRl + x.gauge * 0.01 : null;
      if (fromGauge == null || Math.abs(fromGauge - x.levelD) > 1e-9) {
        level = x.levelD;
        typed += 1;
      }
    }
    return { date: x.date, time: null, gauge: x.gauge, rain: x.rain, level };
  });
  summary.push(`${readings.length} days, ${dateRange(readings[0].date, readings[readings.length - 1].date)}, from “${TEMPLATE_SHEET}”.`);
  if (typed) summary.push(`${typed} corrected level(s) typed in column D, kept as level overrides.`);
  if (ruled) summary.push(`${ruled} level(s) in column D follow the dry-day check (D = AC), kept as that rule.`);
  if (tail) summary.push(`${tail} later row(s) have no balance formulas in the workbook, so they were left out.`);

  // Infiltration periods: start rows in L171:O171.
  const byRow = new Map(rows.map((x) => [x.row, x.date]));
  const periodStarts = ["L", "M", "N", "O"]
    .map((c) => toNum(cell(ws, `${c}171`)))
    .filter((r) => r != null && byRow.has(r))
    .map((r) => byRow.get(r))
    .filter((d) => d > readings[0].date);
  params.periodStarts = [...new Set(periodStarts)];
  if (params.periodStarts.length) summary.push(`${params.periodStarts.length + 1} infiltration periods from row 171.`);

  // Stage table from sheet 2, I5:K… (RL, area, volume).
  let stage = [];
  const s2 = wb.Sheets[STAGE_SHEET];
  if (s2) {
    for (let r = 5; r < 60; r++) {
      const rl = toNum(cell(s2, `I${r}`));
      const area = toNum(cell(s2, `J${r}`));
      if (rl == null || area == null) break;
      stage.push({ rl, area, volume: toNum(cell(s2, `K${r}`)) });
    }
    if (stage.length) summary.push(`${stage.length} survey levels from “${STAGE_SHEET}”.`);
  }
  if (stage.length < 2) {
    warnings.push("No stage–area–volume table was found in the workbook; enter it on the Dam & survey tab.");
    stage = [];
  }

  // The MyWell sheet's data window, for the recession method.
  const recession = { ...DEFAULT_RECESSION };
  const s5 = wb.Sheets[MYWELL_SHEET];
  if (s5) {
    let first = null;
    let last = null;
    for (let r = 6; r < 6 + 5000; r++) {
      const d = toIsoDate(cell(s5, `A${r}`));
      if (!d) break;
      first ??= d;
      last = d;
    }
    if (first && first > readings[0].date) recession.from = first;
    if (last && last < readings[readings.length - 1].date) recession.to = last;
    if (recession.from || recession.to) summary.push(`Recession window ${dateRange(recession.from || readings[0].date, recession.to || readings.at(-1).date)} from “${MYWELL_SHEET}”.`);
  }

  // Name the site from the workbook's description ("Badgaon Check Dam volumetric
  // calculations…") when it has one, else from the file name.
  const notes = typeof cell(ws, "B5") === "string" ? cell(ws, "B5").trim() : "";
  const described = /^(.{1,60}?check[\s-]*dam)\b/i.exec(notes)?.[1]?.trim();
  const year = readings[0].date.slice(0, 4);
  const siteName = described ? `${described}, ${year}` : fileName.replace(/\.[^.]+$/, "") || "Imported check dam";
  const project = {
    version: 1,
    site: { name: siteName, notes },
    params,
    stage,
    readings,
    recession,
  };
  summary.push(`Parameters: evaporation ${trim(params.evaporation * 1000, 2)} mm/day, gauge zero ${trim(params.gaugeZeroRl, 3)} m, spillway ${trim(params.ctfRl, 3)} m, catchment ${trim(params.catchmentHa, 2)} ha.`);
  return { kind: "project", project, summary, warnings };
}

// ---------------------------------------------------------------------------
// Tables: readings, a pond survey, the check dam's levels.
// Each parser takes a sheet as rows of cells and finds its header row by name.

/** The fill-in template's sheet names (see buildTemplateWorkbook). */
const SIMPLE = { dam: /^check\s*dam$/i, survey: /^(pond\s*)?survey$/i, readings: /^(daily\s*)?readings$/i };
const findSheet = (wb, re) => wb.SheetNames.find((n) => re.test(n.trim()));
const rowsOf = (ws) => X().utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
const text = (c) => (c == null ? "" : String(c));

/** Daily readings: a header row with "Date", and a gauge column (cm) and/or a level column (m). */
export function readingsFromRows(aoa) {
  const hi = aoa.slice(0, 25).findIndex((row) => row.some((c) => typeof c === "string" && /date/i.test(c)));
  if (hi < 0) return null;
  const header = aoa[hi].map(text);
  const find = (re, not) => header.findIndex((c) => re.test(c) && !(not && not.test(c)));
  const col = {
    date: find(/date/i),
    time: find(/^\s*time\b|\btime\s*$/i),
    rain: find(/rain|precip/i),
    gauge: find(/gauge|staff|board|reading|\(cm\)|\bcm\b/i, /rain|mm\b|override/i),
    level: find(/level|elev|\bRL\b/i, /\(cm\)|\bcm\b|gauge|board/i),
  };
  if (col.gauge < 0 && col.level < 0) return null;
  const readings = [];
  let skipped = 0;
  for (const row of aoa.slice(hi + 1)) {
    const date = toIsoDate(row[col.date]);
    if (!date) {
      if (row.some((c) => c != null && c !== "")) skipped += 1;
      continue;
    }
    const levelCell = col.level >= 0 ? row[col.level] : null;
    readings.push({
      date,
      time: col.time >= 0 ? toTime(row[col.time]) : isNum(row[col.date]) && row[col.date] % 1 ? toTime(row[col.date]) : null,
      gauge: col.gauge >= 0 ? toNum(row[col.gauge]) : null,
      rain: col.rain >= 0 ? toNum(row[col.rain]) : null,
      level: typeof levelCell === "string" && /dry[\s-]*day/i.test(levelCell) ? DRY_DAY_RULE : toNum(levelCell),
    });
  }
  if (!readings.length) return null;
  readings.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const used = Object.entries(col)
    .filter(([, i]) => i >= 0)
    .map(([k, i]) => `${{ date: "Date", time: "Time", rain: "Rainfall (mm)", gauge: "Gauge reading (cm)", level: "Level override (m)" }[k]} ← “${header[i]}”`);
  return { readings, used, skipped };
}

/** Pond survey: a header row with a level column and an area column (volume optional). */
export function surveyFromRows(aoa) {
  const hi = aoa.slice(0, 25).findIndex((row) => row.some((c) => /area/i.test(text(c))) && row.some((c) => /level|\bRL\b|elev/i.test(text(c))));
  if (hi < 0) return null;
  const header = aoa[hi].map(text);
  const col = {
    rl: header.findIndex((c) => /level|\bRL\b|elev/i.test(c)),
    area: header.findIndex((c) => /area/i.test(c)),
    volume: header.findIndex((c) => /vol/i.test(c)),
  };
  const stage = [];
  for (const row of aoa.slice(hi + 1)) {
    const rl = toNum(row[col.rl]);
    const area = toNum(row[col.area]);
    if (rl == null && area == null) continue;
    stage.push({ rl, area, volume: col.volume >= 0 ? toNum(row[col.volume]) : null });
  }
  return stage.length ? { stage } : null;
}

/** The check dam's levels: rows of item, value and (optionally) unit. */
const DAM_ITEMS = [
  ["gaugeZeroRl", /gauge.*(zero|0\s*cm)|zero.*gauge/i, 1],
  ["ctfRl", /spillway.*(level|height|crest)|crest.*level|cease/i, 1],
  ["weirLength", /spillway.*(length|width)|crest.*length/i, 1],
  ["evaporation", /evapo/i, "evap"],
  ["catchmentHa", /catchment/i, "area"],
  ["weirCoefficient", /coefficient/i, 1],
  ["weirExponent", /exponent/i, 1],
];
export function damFromRows(aoa) {
  const params = {};
  const found = [];
  for (const row of aoa) {
    const item = text(row[0]);
    const value = toNum(row[1]);
    if (!item || value == null) continue;
    const hit = DAM_ITEMS.find(([, re]) => re.test(item));
    if (!hit || hit[0] in params) continue;
    const unit = text(row[2]).toLowerCase();
    let v = value;
    if (hit[2] === "evap") v = /\bm\s*\/\s*d|m\/day|metre/i.test(unit) && !/mm/.test(unit) ? value : value / 1000; // mm/day unless told m/day
    if (hit[2] === "area" && /km/.test(unit)) v = value * 100;
    params[hit[0]] = v;
    found.push(item);
  }
  return found.length ? { params, found } : null;
}

/** The fill-in template: sheets "Check dam", "Pond survey" and "Daily readings". */
export function fromSimpleTemplate(wb, fileName = "") {
  const summary = [];
  const warnings = [];
  const damSheet = findSheet(wb, SIMPLE.dam);
  const surveySheet = findSheet(wb, SIMPLE.survey);
  const readingsSheet = findSheet(wb, SIMPLE.readings);
  const dam = damSheet ? damFromRows(rowsOf(wb.Sheets[damSheet])) : null;
  const survey = surveySheet ? surveyFromRows(rowsOf(wb.Sheets[surveySheet])) : null;
  const rd = readingsSheet ? readingsFromRows(rowsOf(wb.Sheets[readingsSheet])) : null;
  const params = { ...DEFAULT_PARAMS, gaugeZeroRl: null, ctfRl: null, weirLength: null, catchmentHa: null, periodStarts: [], ...(dam?.params || {}) };
  if (dam) summary.push(`Check dam: ${dam.found.length} value(s) from “${damSheet}”.`);
  else warnings.push("No check dam levels were found. Enter them in Step 1.");
  if (survey) summary.push(`Pond survey: ${survey.stage.length} levels from “${surveySheet}”.`);
  else warnings.push("No pond survey was found. Enter it in Step 2.");
  if (rd) {
    summary.push(`Daily readings: ${rd.readings.length} days, ${dateRange(rd.readings[0].date, rd.readings.at(-1).date)}, from “${readingsSheet}”.`);
    if (rd.skipped) warnings.push(`${rd.skipped} row(s) in “${readingsSheet}” had no readable date and were skipped.`);
  } else warnings.push("No daily readings were found. Enter them in Step 3.");
  const project = {
    version: 1,
    site: { name: fileName.replace(/\.[^.]+$/, "") || "Imported check dam", notes: "" },
    params,
    stage: survey?.stage || [],
    readings: rd?.readings || [],
    recession: { ...DEFAULT_RECESSION },
  };
  return { kind: "project", project, summary, warnings };
}

/** A single table (a CSV, or a sheet): daily readings, a pond survey, or the check dam's levels. */
export function fromTable(wb, fileName = "") {
  for (const sheetName of wb.SheetNames) {
    const aoa = rowsOf(wb.Sheets[sheetName]);
    const rd = readingsFromRows(aoa);
    if (rd) {
      return {
        kind: "readings",
        readings: rd.readings,
        summary: [`${rd.readings.length} rows, ${dateRange(rd.readings[0].date, rd.readings.at(-1).date)}, from sheet “${sheetName}” of ${fileName}.`, `Columns: ${rd.used.join("; ")}.`],
        warnings: rd.skipped ? [`${rd.skipped} row(s) without a readable date were skipped.`] : [],
      };
    }
    const sv = surveyFromRows(aoa);
    if (sv) return { kind: "survey", stage: sv.stage, summary: [`A pond survey with ${sv.stage.length} levels, from sheet “${sheetName}” of ${fileName}.`], warnings: [] };
    const dm = damFromRows(aoa);
    if (dm) return { kind: "dam", params: dm.params, summary: [`Check dam values from ${fileName}: ${dm.found.join(", ")}.`], warnings: [] };
  }
  throw new Error(
    "This file doesn’t look like CheckDamCal data. Use one of the example files: daily readings need a “Date” column and a “Gauge reading (cm)” column; a pond survey needs “Level (m)” and “Water area (m²)” columns.",
  );
}

/** Minimal shape check for a saved project; fills gaps with defaults. */
export function checkProject(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.readings)) throw new Error("This file is not a CheckDamCal project.");
  return {
    version: 1,
    site: { name: String(data.site?.name ?? "Check dam"), notes: String(data.site?.notes ?? "") },
    params: { ...DEFAULT_PARAMS, ...(data.params || {}) },
    stage: Array.isArray(data.stage) ? data.stage.map((r) => ({ rl: toNum(r.rl), area: toNum(r.area), volume: toNum(r.volume) })) : [],
    readings: data.readings.map((r) => ({
      date: toIsoDate(r.date) || String(r.date),
      time: r.time ? String(r.time) : null,
      gauge: toNum(r.gauge),
      rain: toNum(r.rain),
      level: r.level === DRY_DAY_RULE ? DRY_DAY_RULE : toNum(r.level),
    })),
    recession: { ...DEFAULT_RECESSION, ...(data.recession || {}) },
  };
}

// ---------------------------------------------------------------------------
// Writing

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function saveProjectFile(project) {
  const blob = new Blob([JSON.stringify(project, null, 1)], { type: "application/json" });
  download(blob, `${slug(project.site?.name)}.checkdamcal.json`);
}

const slug = (s) =>
  String(s || "check-dam")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "check-dam";

// ---------------------------------------------------------------------------
// Example data and the fill-in template

const DAM_ROWS = (p) => [
  ["Gauge zero level", p?.gaugeZeroRl, "m", "Height of the gauge board’s 0 cm mark"],
  ["Spillway level", p?.ctfRl, "m", "Height of the top of the overflow section (water spills above it)"],
  ["Spillway length", p?.weirLength, "m", "Width of the overflow section, across the stream"],
  ["Evaporation", isNum(p?.evaporation) ? +(p.evaporation * 1000).toPrecision(12) : null, "mm/day", "Water lost to the air from the pond each day"],
  ["Catchment area", p?.catchmentHa, "ha", "Optional: land that drains into the check dam"],
  ["Weir coefficient", p?.weirCoefficient, "", "Advanced: C₁ in Q = C₁·L₁·H^a₁ (m³/s); the workbook uses 1.6"],
  ["Weir exponent", p?.weirExponent, "", "Advanced: a₁; 1.5 for a broad-crested weir"],
];
const READINGS_HEADER = ["Date", "Gauge reading (cm)", "Rainfall (mm)", "Level override (m)"];
const SURVEY_HEADER = ["Level (m)", "Water area (m²)", "Volume (m³)"];
const levelCell = (v) => (v === DRY_DAY_RULE ? "dry-day rule" : v);

function csvLine(cells) {
  return cells
    .map((c) => {
      if (c == null) return "";
      const t = String(c);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    })
    .join(",");
}

/** Daily readings as CSV: Date, Gauge reading (cm), Rainfall (mm), Level override (m). */
export function readingsCsv(project) {
  return [READINGS_HEADER, ...project.readings.map((r) => [r.date, r.gauge, r.rain, levelCell(r.level)])].map(csvLine).join("\n") + "\n";
}

/** Pond survey as CSV: Level (m), Water area (m²), Volume (m³). */
export function surveyCsv(project) {
  return [SURVEY_HEADER, ...project.stage.filter((r) => isNum(r.rl) || isNum(r.area)).map((r) => [r.rl, r.area, r.volume])].map(csvLine).join("\n") + "\n";
}

/** The check dam's levels as CSV: Item, Value, Unit, Notes. */
export function damCsv(project) {
  return [["Item", "Value", "Unit", "Notes"], ...DAM_ROWS(project.params)].map(csvLine).join("\n") + "\n";
}

/**
 * The fill-in template workbook: "Read me", "Check dam", "Pond survey" and
 * "Daily readings". With a project it is filled in (e.g. the Badgaon example);
 * without one, it has the headers, units and notes only.
 */
export function buildTemplateWorkbook(project = null) {
  const XL = X();
  const book = XL.utils.book_new();
  const sheet = (aoa, widths) => {
    const ws = XL.utils.aoa_to_sheet(aoa);
    ws["!cols"] = widths.map((wch) => ({ wch }));
    return ws;
  };
  XL.utils.book_append_sheet(
    book,
    sheet(
      [
        ["CheckDamCal — data template"],
        [],
        ["Fill in the three sheets, save, and open the file in CheckDamCal (https://alanntl.github.io/checkdamcal/) with the Import button."],
        ["Keep the sheet names and the header rows as they are. Leave a cell blank if you don’t have the value."],
        [],
        ["Sheet", "What goes in it", "How often"],
        ["Check dam", "The heights of the gauge board’s 0 cm mark and of the spillway, and the spillway’s length (all in metres, from the same reference point). Evaporation in mm per day. Catchment area in hectares (optional).", "Once"],
        ["Pond survey", "The water-surface area at several levels, from the lowest point of the pond (area 0) up to a little above the spillway. Volume is optional: leave it blank to have it worked out.", "Once"],
        ["Daily readings", "One row per day: the date, the gauge-board reading in cm, and the rainfall in mm (blank on dry days). Level override is optional: type a level in metres only to correct a reading.", "Every day"],
      ],
      [16, 110, 12],
    ),
    "Read me",
  );
  XL.utils.book_append_sheet(book, sheet([["Item", "Value", "Unit", "Notes"], ...DAM_ROWS(project?.params)], [20, 10, 8, 70]), "Check dam");
  const stage = project ? project.stage.filter((r) => isNum(r.rl) || isNum(r.area)) : [];
  XL.utils.book_append_sheet(book, sheet([SURVEY_HEADER, ...stage.map((r) => [r.rl, r.area, r.volume])], [12, 16, 14]), "Pond survey");
  const readings = project ? project.readings : [];
  const ws = sheet([READINGS_HEADER, ...readings.map((r) => [null, r.gauge, r.rain, levelCell(r.level)])], [12, 18, 14, 18]);
  // Real Excel dates (serial numbers shown as yyyy-mm-dd), so the column sorts and filters as dates.
  readings.forEach((r, i) => {
    const serial = dayNumber(r.date) + 25569;
    if (Number.isFinite(serial)) ws[XL.utils.encode_cell({ r: i + 1, c: 0 })] = { t: "n", v: serial, z: "yyyy-mm-dd" };
  });
  XL.utils.book_append_sheet(book, ws, "Daily readings");
  return book;
}

export function downloadText(textContent, filename, type = "text/csv") {
  // A UTF-8 byte-order mark so Excel reads m², ’ and ₁ correctly in a CSV.
  download(new Blob([type === "text/csv" ? "\uFEFF" + textContent : textContent], { type: `${type};charset=utf-8` }), filename);
}

export function downloadTemplate(project, filename) {
  X().writeFile(buildTemplateWorkbook(project), filename, { compression: true });
}

/** Build the results workbook (kept separate from the download so it can be tested). */
export function buildResultsWorkbook(project, wb, rec, sens) {
  const XL = X();
  const book = XL.utils.book_new();
  const add = (name, aoa, widths) => {
    const ws = XL.utils.aoa_to_sheet(aoa);
    if (widths) ws["!cols"] = widths.map((wch) => ({ wch }));
    XL.utils.book_append_sheet(book, ws, name);
  };
  const p = wb.params;
  const t = wb.totals;
  add(
    "Summary",
    [
      ["CheckDamCal results", project.site?.name || ""],
      ["Period", `${wb.days[0].date} to ${wb.days[wb.days.length - 1].date}`, `${wb.days.length} days`],
      [],
      ["Water balance", "Value", "Unit"],
      ["Rainfall", t.rain, "mm"],
      ["Inflow (runoff captured + spilled)", t.inflow, "m³"],
      ["Recharge, during the record", t.recharge, "m³"],
      ["Recharge, with the end-of-season share", t.rechargeWithEnd, "m³"],
      ["Evaporation, during the record", t.evaporation, "m³"],
      ["Evaporation, with the end-of-season share", t.evaporationWithEnd, "m³"],
      ["Spill over the weir", t.spill, "m³"],
      ["Stored on the last day", wb.endOfSeason.remaining, "m³"],
      ["Balance check (should be 0)", t.balance, "m³"],
      [],
      ["Rates and ratios", "Value", "Unit"],
      ["Mean dry-weather infiltration rate (water balance)", wb.mdwir, "m/d"],
      ["Recharge / inflow", wb.ratios.rechargeToInflow, "fraction"],
      ["Runoff coefficient", wb.ratios.runoffCoefficient, "fraction"],
      ["Share of inflow captured (not spilled)", wb.ratios.captured, "fraction"],
      ["Evaporation / recharge", wb.ratios.evaporationToRecharge, "fraction"],
      ["Mean daily runoff coefficient", wb.ratios.meanDailyRunoffCoefficient, "fraction"],
      ...(rec?.ok && rec.pooled
        ? [
            [],
            ["Recession method", "Value", "Unit"],
            ["Dry-weather infiltration rate, weighted", rec.pooled.infiltrationMm, "mm/d"],
            ["Dry-weather infiltration rate, unweighted", rec.pooled.unweightedInfiltrationMm, "mm/d"],
            ["Pooled standard error of the fall rate", rec.pooled.se, "cm/d"],
            ["Runs fitted", rec.pooled.runs, ""],
          ]
        : []),
      [],
      ["Parameters", "Value", "Unit"],
      ["Gauge zero", p.gaugeZeroRl, "m RL"],
      ["Spillway crest (cease to flow)", p.ctfRl, "m RL"],
      ["Evaporation", p.evaporation, "m/d"],
      ["Catchment area", p.catchmentHa, "ha"],
      ["Weir crest length L1", p.weirLength, "m"],
      ["Weir coefficient C1", p.weirCoefficient, ""],
      ["Weir exponent a1", p.weirExponent, ""],
    ],
    [52, 16, 10],
  );
  add(
    "Daily water balance",
    [
      [
        "Date",
        "Gauge (cm)",
        "Level (m RL)",
        "Level source",
        "Area (m²)",
        "Volume (m³)",
        "Change in level (m)",
        "Change in storage (m³)",
        "Evaporation (m³)",
        "Rainfall (mm)",
        "Dry-weather infiltration rate (m/d)",
        "Dry-weather recharge (m³)",
        "Recharge on other days (m³)",
        "Spill (m³)",
        "Inflow (m³)",
        "Cumulative spill (m³)",
        "Cumulative recharge (m³)",
        "Cumulative evaporation (m³)",
        "Cumulative inflow (m³)",
        "Balance check = storage (m³)",
        "Runoff coefficient",
      ],
      ...wb.days.map((d) => [
        d.date,
        d.gauge,
        d.level,
        d.levelSource,
        d.area,
        d.volume,
        d.dLevel,
        d.dStorage,
        d.evaporation,
        d.rain,
        d.dryRate,
        d.dryRecharge,
        d.wetRecharge,
        d.spill,
        d.inflow,
        d.cumSpill,
        d.cumRecharge,
        d.cumEvaporation,
        d.cumInflow,
        d.balance,
        d.runoffCoefficient,
      ]),
    ],
    [11, 9, 11, 12, 11, 11, 10, 12, 11, 9, 12, 12, 12, 11, 11, 12, 12, 12, 12, 12, 10],
  );
  add(
    "Infiltration by period",
    [
      ["Period", "From", "To", "Days", "Dry-weather days", "Mean dry-weather infiltration rate (m/d)"],
      ...wb.periods.map((q, i) => [i + 1, q.start, q.end, q.days, q.dryDays, q.mdwir]),
    ],
    [8, 12, 12, 6, 16, 30],
  );
  if (sens?.length) {
    add(
      "Sensitivity",
      [
        ["Input changed", "Change", "Value", "Recharge (m³)", "Δ recharge", "Evaporation (m³)", "Δ evaporation", "Spill (m³)", "Δ spill", "Inflow (m³)", "Δ inflow"],
        ...sens
          .filter((r) => r.ok)
          .map((r) => [
            r.label,
            r.factor - 1,
            r.value,
            r.totals.recharge,
            r.change.recharge,
            r.totals.evaporation,
            r.change.evaporation,
            r.totals.spill,
            r.change.spill,
            r.totals.inflow,
            r.change.inflow,
          ]),
      ],
      [40, 8, 10, 12, 10, 12, 10, 12, 10, 12, 10],
    );
  }
  if (rec?.ok) {
    add(
      "Recession runs",
      [
        ["Run", "From", "To", "Readings", "Fall rate (cm/d)", "R²", "Standard error (cm/d)", "Infiltration (mm/d)"],
        ...rec.runs.map((r, i) => [i + 1, r.start, r.end, r.n, -r.slope, r.r2, r.se, r.infiltrationCm * 10]),
      ],
      [6, 12, 12, 9, 14, 8, 18, 16],
    );
  }
  add(
    "Stage table",
    [["Level (m RL)", "Area (m²)", "Volume (m³)", "Volume source"], ...wb.stage.rows.map((r) => [r.rl, r.area, r.volume, r.volumeComputed ? "calculated" : "entered"])],
    [12, 12, 12, 14],
  );
  add(
    "Readings",
    [["Date", "Time", "Gauge (cm)", "Rainfall (mm)", "Level override (m)"], ...project.readings.map((r) => [r.date, r.time, r.gauge, r.rain, r.level])],
    [12, 8, 11, 13, 17],
  );
  return book;
}

export function exportResults(project, wb, rec, sens) {
  const book = buildResultsWorkbook(project, wb, rec, sens);
  X().writeFile(book, `${slug(project.site?.name)}-results.xlsx`, { compression: true });
}
