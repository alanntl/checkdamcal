// CheckDamCal calculation engine — pure functions, no DOM.
//
// A port of the MyCheckDam.xlsx workbook (Peter Dillon's check-dam water
// balance template, as adapted for MARVI). Each function names the sheet and
// cells it reproduces so a result can be traced back to the spreadsheet:
//
//   sheet "2. Area-RL and Vol EL curves"      buildStageTable(), stageAt()
//   sheet "1 Daily & seasonal waterbalance"   computeWaterBalance()
//   sheet "Check dam calculator for MyWell"   computeRecession()
//
// Arithmetic keeps the spreadsheet's order of operations so results agree
// with Excel to floating-point precision, not just to a rounding.
//
// Units: levels are reduced levels (RL) in metres; areas m²; volumes m³;
// rainfall mm per day; evaporation and infiltration rates m/d unless a name
// says otherwise (the recession method works in cm, as the MyWell sheet does).

/** Days are consecutive calendar days; one step is one day. */
const SECONDS_PER_DAY = 24 * 60 * 60;

/** COUNTIF(...,">0.0001") threshold the workbook uses to count "positive" days. */
export const POSITIVE_EPSILON = 0.0001;

// ---------------------------------------------------------------------------
// Dates

/** "2014-07-16" -> whole days since 1970-01-01 (UTC, so no DST surprises). */
export function dayNumber(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate));
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000;
}

/** Whole days since epoch -> "2014-07-16". */
export function isoFromDayNumber(n) {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}

/** "09:00" -> 0.375 of a day; blank -> null. */
export function dayFraction(time) {
  if (time == null || time === "") return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(time).trim());
  if (!m) return NaN;
  return (+m[1] * 3600 + +m[2] * 60 + (m[3] ? +m[3] : 0)) / 86400;
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// ---------------------------------------------------------------------------
// Stage–area–volume table (sheet 2)

/**
 * Validate a stage table and fill in any blank volumes.
 *
 * Volumes follow sheet 2 rows 32–38: the segment that starts from zero area
 * (the bed) uses the cone formula V = A·h/3; every other segment uses the
 * trapezoidal rule V = (A₀ + A₁)·h/2. An entered volume is kept as entered.
 *
 * @param {{rl:number, area:number, volume?:number|null}[]} rows
 * @returns {{rows:{rl:number, area:number, volume:number, volumeComputed:boolean}[], errors:string[]}}
 */
export function buildStageTable(rows) {
  const errors = [];
  const clean = (rows || [])
    .filter((r) => r && (isNum(r.rl) || isNum(r.area) || isNum(r.volume)))
    .map((r) => ({ rl: r.rl, area: r.area, volume: isNum(r.volume) ? r.volume : null }));
  clean.forEach((r, i) => {
    if (!isNum(r.rl)) errors.push(`Pond survey row ${i + 1} needs a level (m).`);
    if (!isNum(r.area) || r.area < 0) errors.push(`Pond survey row ${i + 1} needs a water area of 0 m² or more.`);
  });
  for (let i = 1; i < clean.length; i++) {
    if (isNum(clean[i].rl) && isNum(clean[i - 1].rl) && !(clean[i].rl > clean[i - 1].rl)) {
      errors.push(`Pond survey levels must go up row by row (row ${i + 1}: ${clean[i].rl} m).`);
    }
  }
  if (clean.length < 2) errors.push("The pond survey needs at least two levels.");
  if (errors.length) return { rows: [], errors };

  const out = [];
  for (let i = 0; i < clean.length; i++) {
    const r = clean[i];
    let volume = r.volume;
    let volumeComputed = false;
    if (volume == null) {
      volumeComputed = true;
      if (i === 0) volume = 0;
      else {
        const p = out[i - 1];
        const h = r.rl - p.rl;
        volume = p.area === 0 ? p.volume + (r.area * h) / 3 : p.volume + ((p.area + r.area) * h) / 2;
      }
    }
    out.push({ rl: r.rl, area: r.area, volume, volumeComputed });
  }
  return { rows: out, errors };
}

/**
 * Area and volume at a water level, by linear interpolation in the stage
 * table — sheet 2 columns R/S/T:
 *   T = MATCH(level, RL)        (largest RL ≤ level)
 *   R = INDEX(A,T) + (level − INDEX(RL,T)) · (INDEX(A,T+1) − INDEX(A,T)) / (INDEX(RL,T+1) − INDEX(RL,T))
 *
 * Where Excel would error, this decides explicitly: below the lowest RL the
 * structure is empty (the first row's values); above the highest RL the top
 * segment is extended and `range` reports "above" so the caller can warn.
 */
export function stageAt(table, level) {
  const rows = table.rows;
  if (!isNum(level) || rows.length < 2) return { area: NaN, volume: NaN, range: "invalid" };
  const first = rows[0];
  if (level < first.rl) return { area: first.area, volume: first.volume, range: "below" };
  let t = 0;
  for (let i = 0; i < rows.length; i++) if (rows[i].rl <= level) t = i;
  const last = rows.length - 1;
  if (t === last) {
    if (level === rows[last].rl) return { area: rows[last].area, volume: rows[last].volume, range: "in" };
    t = last - 1; // extrapolate along the top segment
  }
  const a = rows[t];
  const b = rows[t + 1];
  const area = a.area + ((level - a.rl) * (b.area - a.area)) / (b.rl - a.rl);
  const volume = a.volume + ((level - a.rl) * (b.volume - a.volume)) / (b.rl - a.rl);
  return { area, volume, range: level > rows[last].rl ? "above" : "in" };
}

// ---------------------------------------------------------------------------
// Parameters

/** Defaults are the Badgaon 2014 values of the workbook. */
export const DEFAULT_PARAMS = Object.freeze({
  gaugeZeroRl: 98.43, // K6  RL of the 0 cm mark on the gauge board (m)
  ctfRl: 100, //          K9  spillway crest = cease-to-flow level, CTF (m)
  evaporation: 0.005, //  F6  open-water evaporation (m/d)
  catchmentHa: 338.31, // O7  catchment area of the structure (ha)
  weirLength: 12.7, //    I9  spillway crest length L1 (m)
  weirCoefficient: 1.6, // M9 weir coefficient C1
  weirExponent: 1.5, //   O9  weir exponent a1
  wetDayRate: "seasonMean", // infiltration on overflow / rising days: seasonMean | periodMean | fixed
  wetDayRateValue: null, //   m/d, used when wetDayRate is "fixed"
  splitRemaining: true, //    apportion water left at the end to recharge + evaporation (AH131:AJ135)
  initialLevel: null, //      m; null = the structure was empty before the first day
  periodStarts: [], //        extra period start dates (ISO) for the infiltration-by-period table
});

export function normaliseParams(params) {
  const p = { ...DEFAULT_PARAMS, ...(params || {}) };
  p.periodStarts = Array.isArray(p.periodStarts) ? [...p.periodStarts] : [];
  return p;
}

// ---------------------------------------------------------------------------
// Levels: gauge reading -> RL, overrides, gaps

/**
 * A level override that follows the workbook's dry-day data check (column AC):
 * the previous day's level minus 1.1 × evaporation. The workbook applies it as
 * a formula (D78 = AC78), so it moves when the evaporation rate changes.
 */
export const DRY_DAY_RULE = "dry-day";

/**
 * The water level used for each day (sheet 1 column D).
 *
 * Column C is RL(gauge zero) + reading × 0.01. Column D is the "adjusted &
 * infilled" level the user curates from it; here that curation is explicit:
 * an entered level override wins (a number, or DRY_DAY_RULE), otherwise the
 * gauge-derived level, and a day with neither is interpolated linearly
 * between its neighbours.
 *
 * @returns {{gaugeLevel:number|null, level:number, source:"gauge"|"override"|"rule"|"interpolated"|"missing"}[]}
 */
export function resolveLevels(readings, params) {
  const p = normaliseParams(params);
  const out = [];
  readings.forEach((r, i) => {
    const gaugeLevel = isNum(r.gauge) ? p.gaugeZeroRl + r.gauge * 0.01 : null;
    const prev = out[i - 1];
    if (isNum(r.level)) out.push({ gaugeLevel, level: r.level, source: "override" });
    else if (r.level === DRY_DAY_RULE && prev && prev.source !== "missing") {
      out.push({ gaugeLevel, level: prev.level - p.evaporation * 1.1, source: "rule" }); // AC = D₋₁ − F6·1.1
    } else if (gaugeLevel != null && r.level !== DRY_DAY_RULE) out.push({ gaugeLevel, level: gaugeLevel, source: "gauge" });
    else out.push({ gaugeLevel, level: NaN, source: "missing" });
  });
  // Interpolate interior gaps; leading/trailing gaps stay missing.
  const known = out.map((o, i) => (o.source === "missing" ? -1 : i)).filter((i) => i >= 0);
  for (let k = 0; k + 1 < known.length; k++) {
    const i0 = known[k];
    const i1 = known[k + 1];
    for (let i = i0 + 1; i < i1; i++) {
      const f = (i - i0) / (i1 - i0);
      out[i].level = out[i0].level + f * (out[i1].level - out[i0].level);
      out[i].source = "interpolated";
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Daily water balance (sheet 1)

/**
 * Daily water balance of the structure, the workbook's sheet 1.
 *
 * For each day (columns):
 *   E, F  area and volume at the day's level            (stage table)
 *   G     change in level since the previous day         D − D₋₁
 *   H     change in storage                              F − F₋₁
 *   I     evaporation                                    ½(E₋₁+E)·evap
 *   K     dry-weather net infiltration rate (m/d), only when the level is
 *         below CTF and fell by more than evaporation:   D₋₁ − D − evap + rain/1000
 *   L     dry-weather recharge                           K·½(E₋₁+E)
 *   M     recharge on every other day (overflowing, rising or steady), at
 *         the season's mean dry-weather rate MDWIR:      rate·½(E+E₋₁)
 *   N     spill over the weir                            C1·86400·L1·(D − CTF)^a1
 *   O     inflow, by closing the balance                 H + I + L + M + N
 *   P–S   cumulative spill, recharge, evaporation, inflow
 *   T     balance check                                  S − R − Q − P  (= storage)
 *   U     daily runoff coefficient                       O / (rain·catchment)
 *
 * The first day compares against an empty structure (area 0, volume 0),
 * exactly as the workbook's first row does, unless `initialLevel` is set.
 *
 * @param {{params:object, stage:object[], readings:object[]}} project
 */
/** Inputs the balance cannot run without, and what to call them in a message. */
const REQUIRED_PARAMS = [
  ["gaugeZeroRl", "the level of the gauge board’s 0 cm mark"],
  ["ctfRl", "the level of the spillway"],
  ["weirLength", "the length of the spillway"],
  ["evaporation", "the evaporation rate"],
  ["weirCoefficient", "the weir coefficient"],
  ["weirExponent", "the weir exponent"],
];

export function computeWaterBalance(project) {
  const p = normaliseParams(project.params);
  const stage = buildStageTable(project.stage);
  const readings = [...(project.readings || [])].sort((a, b) => dayNumber(a.date) - dayNumber(b.date));
  // Each problem names the input that fixes it: "dam", "survey" or "readings".
  const problems = [];
  const warnings = [];
  const fail = (area, text) => problems.push({ area, text });
  const result = (extra = {}) => ({ ok: false, errors: problems.map((q) => q.text), problems, warnings, days: [], ...extra });

  for (const [key, label] of REQUIRED_PARAMS) if (!isNum(p[key])) fail("dam", `Enter ${label}.`);
  for (const e of stage.errors) fail("survey", e);
  if (isNum(p.ctfRl) && isNum(p.gaugeZeroRl) && p.ctfRl <= p.gaugeZeroRl) {
    warnings.push("The spillway is at or below the gauge’s 0 cm mark. Check both levels: the spillway is normally higher.");
  }

  if (!readings.length) fail("readings", "Add daily readings to calculate the water balance.");
  for (let i = 1; i < readings.length; i++) {
    const gap = dayNumber(readings[i].date) - dayNumber(readings[i - 1].date);
    if (gap === 0) fail("readings", `${readings[i].date} appears twice. Keep one row per day.`);
    else if (gap > 1) {
      fail(
        "readings",
        `Readings jump from ${readings[i - 1].date} to ${readings[i].date}. The water balance needs one row for every day; add the missing days (leave the gauge blank to interpolate).`,
      );
    }
  }
  readings.forEach((r) => {
    if (!Number.isFinite(dayNumber(r.date))) fail("readings", `"${r.date}" is not a date (use YYYY-MM-DD).`);
  });
  if (problems.length) return result();

  const levels = resolveLevels(readings, p);
  const missing = levels.filter((l) => l.source === "missing").length;
  if (missing) {
    fail(
      "readings",
      `${missing} day(s) at the start or end have no gauge reading or level, so nothing can be interpolated. Enter a level for them or remove those rows.`,
    );
    return result();
  }

  // Pass 1 — everything that does not depend on the wet-day infiltration rate.
  let prev = { level: null, area: 0, volume: 0 };
  if (isNum(p.initialLevel)) {
    const s = stageAt(stage, p.initialLevel);
    prev = { level: p.initialLevel, area: s.area, volume: s.volume };
  }
  const initialStorage = prev.volume;
  const outside = [];
  const days = readings.map((r, i) => {
    const lv = levels[i];
    const D = lv.level;
    const st = stageAt(stage, D);
    if (st.range === "above" || st.range === "below") outside.push({ date: r.date, level: D, range: st.range });
    const E = st.area;
    const F = st.volume;
    const J = isNum(r.rain) ? r.rain : 0;
    const G = prev.level == null ? 0 : D - prev.level;
    const H = F - prev.volume;
    const I = 0.5 * (prev.area + E) * p.evaporation;
    let K = 0;
    if (prev.level != null && D < p.ctfRl && D < prev.level - p.evaporation) {
      K = prev.level - D - p.evaporation + J * 0.001;
    }
    const L = K * 0.5 * (prev.area + E);
    const N = D < p.ctfRl ? 0 : p.weirCoefficient * 24 * 60 * 60 * p.weirLength * Math.pow(D - p.ctfRl, p.weirExponent);
    const day = {
      date: r.date,
      gauge: isNum(r.gauge) ? r.gauge : null,
      gaugeLevel: lv.gaugeLevel,
      level: D,
      levelSource: lv.source,
      area: E,
      volume: F,
      dLevel: G,
      dStorage: H,
      evaporation: I,
      rain: J,
      dryRate: K,
      dryRecharge: L,
      wetRecharge: 0,
      spill: N,
      inflow: 0,
      prevArea: prev.area,
      qaSuggestedLevel: null,
    };
    // Data check, column AC: on a day with (almost) no rain the level should
    // fall by at least the evaporation; if it didn't, suggest yesterday's level
    // minus 1.1 × evaporation. The first row has no check (AC13 is blank).
    if (i > 0 && lv.gaugeLevel != null) {
      const C = lv.gaugeLevel;
      const prevRain = isNum(readings[i - 1].rain) ? readings[i - 1].rain : 0;
      if (C > p.gaugeZeroRl + p.evaporation && C < p.ctfRl && C > prev.level - p.evaporation && prevRain + J < 1) {
        day.qaSuggestedLevel = prev.level - p.evaporation * 1.1;
      }
    }
    prev = { level: D, area: E, volume: F };
    return day;
  });

  if (outside.some((o) => o.range === "above")) {
    const top = stage.rows[stage.rows.length - 1].rl;
    const n = outside.filter((o) => o.range === "above").length;
    warnings.push(
      `${n} day(s) are above the highest level in the stage table (${top} m); their area and volume were extended from the top two rows. Add a higher survey level to be sure.`,
    );
  }
  if (outside.some((o) => o.range === "below")) {
    const n = outside.filter((o) => o.range === "below").length;
    warnings.push(`${n} day(s) are below the lowest level in the stage table and were treated as empty.`);
  }

  // Mean dry-weather infiltration rate, MDWIR (M10 = K152 = SUM(K)/COUNTIF(K,">0.0001")).
  const sumK = sum(days.map((d) => d.dryRate));
  const dryDays = days.filter((d) => d.dryRate > POSITIVE_EPSILON).length;
  const seasonMdwir = dryDays ? sumK / dryDays : null;

  // Infiltration by period (rows 169–176). The first period starts on day 1.
  const periods = buildPeriods(days, p.periodStarts);

  let rateFor;
  let finalRate;
  if (p.wetDayRate === "fixed") {
    if (!isNum(p.wetDayRateValue) || p.wetDayRateValue < 0) {
      fail("dam", "Enter the fixed infiltration rate for overflow and rising days (m/d).");
      return result();
    }
    rateFor = () => p.wetDayRateValue;
    finalRate = p.wetDayRateValue;
  } else {
    if (seasonMdwir == null) {
      fail(
        "dam",
        "No day has a falling level below the spillway, so the dry-weather infiltration rate cannot be estimated. Choose a fixed infiltration rate instead.",
      );
      return result();
    }
    if (p.wetDayRate === "periodMean") {
      const fallback = periods.some((q) => q.mdwir == null);
      if (fallback) warnings.push("A period has no dry-weather days; the season mean rate was used for it.");
      rateFor = (i) => periods[days[i].period].mdwir ?? seasonMdwir;
      finalRate = periods[periods.length - 1].mdwir ?? seasonMdwir;
    } else {
      rateFor = () => seasonMdwir;
      finalRate = seasonMdwir;
    }
  }

  // Pass 2 — wet-day recharge, inflow and running totals.
  const hasCatchment = isNum(p.catchmentHa) && p.catchmentHa > 0;
  let P = 0;
  let Q = 0;
  let R = 0;
  let S = 0;
  days.forEach((d, i) => {
    const rate = rateFor(i);
    d.rateApplied = rate;
    d.wetRecharge = d.dryRate === 0 ? rate * (d.area + d.prevArea) * 0.5 : 0;
    d.inflow = d.dStorage + d.evaporation + d.dryRecharge + d.wetRecharge + d.spill;
    P = P + d.spill;
    Q = Q + d.dryRecharge + d.wetRecharge;
    R = R + d.evaporation;
    S = S + d.inflow;
    d.cumSpill = P;
    d.cumRecharge = Q;
    d.cumEvaporation = R;
    d.cumInflow = S;
    // T: the water that must still be in the structure. Equals the day's
    // volume when the arithmetic is right (the workbook starts empty, V₀ = 0).
    d.balance = initialStorage + S - R - Q - P;
    // U: needs the catchment area, which is optional.
    d.runoffCoefficient = hasCatchment && d.rain > 0 && d.inflow > 0 ? (1000 * d.inflow) / (d.rain * p.catchmentHa) / 10000 : 0;
  });

  // End of season (AH131:AJ135): water still stored on the last day is assumed
  // to drain away by infiltration and evaporation in proportion to their rates.
  const last = days[days.length - 1];
  const remaining = last.volume;
  const endOfSeason = {
    applied: !!p.splitRemaining,
    remaining,
    rate: finalRate,
    recharge: p.splitRemaining && finalRate + p.evaporation > 0 ? (remaining * finalRate) / (finalRate + p.evaporation) : 0,
    evaporation:
      p.splitRemaining && finalRate + p.evaporation > 0 ? (remaining * p.evaporation) / (finalRate + p.evaporation) : 0,
  };

  const totalRain = sum(days.map((d) => d.rain));
  const totals = {
    rain: totalRain, // J150 (mm)
    evaporation: R, // R150 during the record
    dryRecharge: sum(days.map((d) => d.dryRecharge)), // L150
    wetRecharge: sum(days.map((d) => d.wetRecharge)), // M150
    recharge: Q, // Q150 during the record
    spill: P, // P150
    inflow: S, // S150
    // With the end-of-season share (Q151, R151):
    rechargeWithEnd: Q + endOfSeason.recharge,
    evaporationWithEnd: R + endOfSeason.evaporation,
    // Water already stored before the first day (0 = the workbook's empty start).
    initialStorage,
    // Storage not yet accounted for; zero when the end-of-season split is on.
    storageLeft: p.splitRemaining ? 0 : remaining,
    // T150 = S150 − R151 − Q151 − P150, extended with the storage at both
    // ends: (start + inflow) − (evaporation + recharge + spill + left) = 0.
    balance:
      initialStorage + S - (R + endOfSeason.evaporation) - (Q + endOfSeason.recharge) - P - (p.splitRemaining ? 0 : remaining),
  };
  const counts = {
    days: days.length,
    rainDays: days.filter((d) => d.rain > POSITIVE_EPSILON).length, // J151
    dryDays, // K151
    wetRechargeDays: days.filter((d) => d.wetRecharge > POSITIVE_EPSILON).length, // M151
    spillDays: days.filter((d) => d.spill > POSITIVE_EPSILON).length, // N151
    inflowDays: days.filter((d) => d.inflow > POSITIVE_EPSILON).length, // O151
    runoffDays: days.filter((d) => d.runoffCoefficient * 10000 > POSITIVE_EPSILON).length, // U151
  };
  const runoffSum = sum(days.map((d) => d.runoffCoefficient * 10000)) / 10000;
  const ratios = {
    // H155 Cumulative recharge / cumulative inflow
    rechargeToInflow: S ? totals.rechargeWithEnd / S : null,
    // H156 runoff coefficient for the period = inflow / (rain depth × catchment area)
    runoffCoefficient: hasCatchment && totalRain > 0 ? S / (totalRain * 0.001 * p.catchmentHa * 10000) : null,
    // H157 share of the runoff captured (not spilled)
    captured: S ? (S - P) / S : null,
    // H158 evaporation / recharge, both including the end-of-season share.
    // (The workbook divides R150 by Q151 here, mixing the two; see the Method tab.)
    evaporationToRecharge: totals.rechargeWithEnd ? totals.evaporationWithEnd / totals.rechargeWithEnd : null,
    // U153 mean of the daily runoff coefficients on days with rain and inflow
    meanDailyRunoffCoefficient: counts.runoffDays ? runoffSum / counts.runoffDays : null,
  };

  return {
    ok: true,
    errors: [],
    problems: [],
    warnings,
    params: p,
    stage,
    days,
    mdwir: seasonMdwir,
    dryWeatherTotal: sumK,
    periods,
    endOfSeason,
    totals,
    counts,
    ratios,
    outside,
  };
}

/** Split the season at the given start dates (the first period starts on day 1). */
function buildPeriods(days, periodStarts) {
  const first = days[0].date;
  const lastDate = days[days.length - 1].date;
  const starts = [first, ...periodStarts.filter((s) => s > first && s <= lastDate)]
    .filter((s, i, a) => a.indexOf(s) === i)
    .sort();
  const periods = starts.map((start, k) => ({ index: k, start, end: null, days: 0, dryDays: 0, sumRate: 0, mdwir: null }));
  let k = 0;
  days.forEach((d) => {
    while (k + 1 < starts.length && d.date >= starts[k + 1]) k++;
    d.period = k;
    const q = periods[k];
    q.days += 1;
    q.end = d.date;
    q.sumRate += d.dryRate;
    if (d.dryRate > POSITIVE_EPSILON) q.dryDays += 1;
  });
  periods.forEach((q) => {
    q.mdwir = q.dryDays ? q.sumRate / q.dryDays : null;
  });
  return periods;
}

function sum(values) {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

// ---------------------------------------------------------------------------
// Sensitivity (rows 160–168), recomputed live instead of pasted in.

/**
 * Re-run the balance with one input changed at a time and report the change
 * in each total against the base case.
 */
export function runSensitivity(project, base = computeWaterBalance(project), change = 0.2) {
  if (!base.ok) return [];
  const p = base.params;
  const baseRate = base.endOfSeason.rate;
  const scenarios = [
    { key: "evaporation", label: "Evaporation", unit: "m/d", factor: 1 + change, patch: { evaporation: p.evaporation * (1 + change) } },
    { key: "evaporation", label: "Evaporation", unit: "m/d", factor: 1 - change, patch: { evaporation: p.evaporation * (1 - change) } },
    {
      key: "infiltration",
      label: "Infiltration rate on overflow and rising days",
      unit: "m/d",
      factor: 1 + change,
      patch: { wetDayRate: "fixed", wetDayRateValue: baseRate * (1 + change) },
    },
    {
      key: "infiltration",
      label: "Infiltration rate on overflow and rising days",
      unit: "m/d",
      factor: 1 - change,
      patch: { wetDayRate: "fixed", wetDayRateValue: baseRate * (1 - change) },
    },
    { key: "weir", label: "Weir coefficient C1", unit: "", factor: 1 + change, patch: { weirCoefficient: p.weirCoefficient * (1 + change) } },
    { key: "weir", label: "Weir coefficient C1", unit: "", factor: 1 - change, patch: { weirCoefficient: p.weirCoefficient * (1 - change) } },
  ];
  const pick = (r) => ({
    recharge: r.totals.rechargeWithEnd,
    evaporation: r.totals.evaporationWithEnd,
    spill: r.totals.spill,
    inflow: r.totals.inflow,
  });
  const b = pick(base);
  return scenarios.map((s) => {
    const r = computeWaterBalance({ ...project, params: { ...project.params, ...s.patch } });
    if (!r.ok) return { ...s, ok: false };
    const v = pick(r);
    const value =
      s.key === "evaporation" ? s.patch.evaporation : s.key === "weir" ? s.patch.weirCoefficient : s.patch.wetDayRateValue;
    const pct = (a, c) => (c ? (a - c) / c : null);
    return {
      ...s,
      ok: true,
      value,
      totals: v,
      change: {
        recharge: pct(v.recharge, b.recharge),
        evaporation: pct(v.evaporation, b.evaporation),
        spill: pct(v.spill, b.spill),
        inflow: pct(v.inflow, b.inflow),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Recession method (sheet "Check dam calculator for MyWell")

export const DEFAULT_RECESSION = Object.freeze({
  rainThreshold: 0.1, // H: rainfall above this (mm) marks a wet day
  riseThreshold: 2, //   I: a rise above this (cm) since the previous reading
  minRun: 3, //          L: only runs with at least this many readings are fitted
  from: null, //         analysis window (ISO dates, inclusive); null = all readings
  to: null,
});

/**
 * Dry-weather infiltration rate from the gauge readings alone: the method of
 * the workbook's "Check dam calculator for MyWell" sheet.
 *
 * A reading can join a dry-weather recession when, compared with the previous
 * reading, the water is not above the spillway (G), it did not rain (H), and
 * the level did not rise by more than 2 cm (I). Each unbroken run of at least
 * three such readings is fitted with a least-squares line of gauge reading (cm)
 * against time (days); its slope is the rate of fall. The slopes are pooled,
 * weighted by (n − 1), and the evaporation rate is subtracted:
 *
 *   infiltration (cm/d) = −(weighted mean slope) − evaporation
 *
 * One rule is added to the sheet's: a reading of 0 cm or less is not used,
 * because the water is then at or below the gauge's zero and its level is
 * unknown (a run of zeros would otherwise read as "no infiltration").
 *
 * @param {object[]} readings  rows with date, time?, gauge (cm), rain (mm)
 * @param {object} opts        gaugeCtf (cm), evaporationCm (cm/d), thresholds, window, dayZero?
 */
export function computeRecession(readings, opts) {
  const o = { ...DEFAULT_RECESSION, ...opts };
  const errors = [];
  if (!isNum(o.gaugeCtf)) errors.push("Set the spillway level to use the recession method.");
  if (!isNum(o.evaporationCm)) errors.push("Set the evaporation rate to use the recession method.");
  if (errors.length) return { ok: false, errors, points: [], runs: [] };

  const inWindow = (d) => (!o.from || d >= o.from) && (!o.to || d <= o.to);
  const pts = (readings || [])
    .filter((r) => isNum(r.gauge) && Number.isFinite(dayNumber(r.date)) && inWindow(r.date))
    .map((r) => {
      const frac = dayFraction(r.time);
      return {
        date: r.date,
        time: r.time || null,
        day: dayNumber(r.date),
        frac: isNum(frac) ? frac : 0,
        y: r.gauge,
        rain: isNum(r.rain) ? r.rain : 0,
      };
    })
    .sort((a, b) => a.day + a.frac - (b.day + b.frac));

  const zero = o.dayZero
    ? { day: dayNumber(String(o.dayZero).slice(0, 10)), frac: dayFraction(String(o.dayZero).slice(11)) || 0 }
    : pts.length
      ? { day: pts[0].day, frac: pts[0].frac }
      : { day: 0, frac: 0 };

  // Flags, columns E–K. The first reading has nothing to compare with (J6 = 1).
  let counter = 0;
  pts.forEach((pt, i) => {
    pt.t = pt.day - zero.day + (pt.frac - zero.frac); // E = (date − day0) + (time − time0)
    if (i === 0) {
      Object.assign(pt, { dy: 0, above: false, wet: false, rising: false, belowGauge: pt.y <= 0, eligible: false });
    } else {
      pt.dy = pt.y - pts[i - 1].y; // F
      pt.above = pt.y > o.gaugeCtf; // G
      pt.wet = pt.rain > o.rainThreshold; // H
      pt.rising = pt.dy > o.riseThreshold; // I
      pt.belowGauge = pt.y <= 0;
      pt.eligible = !pt.above && !pt.wet && !pt.rising && !pt.belowGauge; // J = 0
    }
    counter = pt.eligible ? counter + 1 : 0; // K
    pt.runPosition = counter;
    pt.run = null;
  });

  // Runs, columns L–P: maximal stretches of eligible readings, kept if long enough.
  const runs = [];
  for (let i = 0; i < pts.length; ) {
    if (!pts[i].eligible) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < pts.length && pts[j + 1].eligible) j++;
    const n = j - i + 1;
    if (n >= o.minRun) {
      const run = fitRun(pts.slice(i, j + 1));
      run.index = runs.length;
      run.infiltrationCm = -run.slope - o.evaporationCm;
      for (let k = i; k <= j; k++) pts[k].run = run.index;
      runs.push(run);
    }
    i = j + 1;
  }

  const pooled = poolRuns(runs, o.evaporationCm);
  return { ok: true, errors, options: o, points: pts, runs, pooled };
}

/** Least-squares line through one run (the per-run blocks in columns R–Y). */
function fitRun(points) {
  const n = points.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sx += p.t;
    sy += p.y;
    sxx += p.t * p.t;
    sxy += p.t * p.y;
  }
  const slope = (n * sxy - sy * sx) / (n * sxx - sx * sx); // X16
  const intercept = (sy - slope * sx) / n; // X17
  const meanX = sx / n; // S16
  const meanY = sy / n;
  let sRes = 0;
  let sXX = 0;
  let sTot = 0;
  for (const p of points) {
    const w = p.y - slope * p.t - intercept; // W
    sRes += (w * w) / (n - 2); // X
    sXX += (p.t - meanX) * (p.t - meanX); // Y
    sTot += (p.y - meanY) * (p.y - meanY);
  }
  const se = Math.sqrt(sRes) / Math.sqrt(sXX); // X18 = SEm
  const r2 = sTot > 0 ? 1 - (sRes * (n - 2)) / sTot : null;
  return {
    start: points[0].date,
    end: points[n - 1].date,
    n,
    slope,
    intercept,
    se,
    r2,
    tStart: points[0].t,
    tEnd: points[n - 1].t,
  };
}

/**
 * Pooled statistics of the runs (rows 109–121). Slopes are weighted by n − 1.
 * The pooled standard error is √(Σ(n−1)·SE² / Σ(n−1)), as the sheet's label
 * "(SEm^2)*(n-1)" describes. (The sheet's cells multiply by SEm, not SEm²;
 * see the Method tab.)
 */
export function poolRuns(runs, evaporationCm) {
  if (!runs.length) return null;
  const w = runs.map((r) => r.n - 1);
  const sw = sum(w); // X113
  const weightedSlope = sum(runs.map((r) => (r.n - 1) * r.slope)) / sw; // Y114 = X118/X113
  const se = Math.sqrt(sum(runs.map((r) => (r.n - 1) * r.se * r.se)) / sw);
  const unweightedSlope = sum(runs.map((r) => r.slope)) / runs.length; // Y121
  return {
    runs: runs.length,
    readings: sum(runs.map((r) => r.n)),
    weight: sw,
    weightedSlope,
    se,
    cov: weightedSlope ? se / Math.abs(weightedSlope) : null, // Y120
    unweightedSlope,
    infiltrationCm: -weightedSlope - evaporationCm, // AA114 (cm/d)
    infiltrationMm: (-weightedSlope - evaporationCm) * 10, // AC114 (mm/d)
    unweightedInfiltrationMm: (-unweightedSlope - evaporationCm) * 10, // AC116 (mm/d)
  };
}

/** Spillway level expressed as a gauge reading (cm), e.g. (100 − 98.43) × 100 = 157. */
export function gaugeCtfCm(params) {
  const p = normaliseParams(params);
  if (!isNum(p.ctfRl) || !isNum(p.gaugeZeroRl)) return NaN;
  return Math.round((p.ctfRl - p.gaugeZeroRl) * 100 * 1e6) / 1e6;
}
