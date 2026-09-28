// Golden tests: the engine must reproduce MyCheckDam.xlsx cell for cell.
// Expected values are the workbook's cached results (test/fixtures), read
// with openpyxl — not recomputed here, so a formula slip on either side shows.
//
// Run:  node --test test/

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildStageTable,
  stageAt,
  computeWaterBalance,
  computeRecession,
  runSensitivity,
  gaugeCtfCm,
  resolveLevels,
  dayNumber,
} from "../js/engine.js";
import { badgaonExample } from "../js/example.js";

const fx = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/badgaon-2014.json", import.meta.url)), "utf8"));
const S = fx.summary;

/** |a − b| within a relative tolerance (or an absolute one near zero). */
function close(actual, expected, what, rel = 1e-9, abs = 1e-9) {
  const ok = Math.abs(actual - expected) <= Math.max(abs, rel * Math.abs(expected));
  assert.ok(ok, `${what}: got ${actual}, expected ${expected} (diff ${actual - expected})`);
}

// The analysis period of the workbook is rows 13–132; rows 133–148 only carry
// the drying-out tail for the level chart (no balance formulas there).
const analysisRows = fx.days.filter((d) => d.row <= 132);

test("example data is the workbook's input, not a re-typing of it", () => {
  const ex = badgaonExample();
  assert.equal(ex.readings.length, analysisRows.length);
  ex.readings.forEach((r, i) => {
    const d = analysisRows[i];
    assert.equal(r.date, d.date);
    assert.equal(r.gauge, d.gauge_cm);
    assert.equal(r.rain ?? null, d.J ?? null);
  });
  const levels = resolveLevels(ex.readings, ex.params);
  levels.forEach((l, i) => assert.equal(l.level, analysisRows[i].D, `level on ${analysisRows[i].date}`));
  assert.deepEqual(
    ex.readings.filter((r) => r.level != null).map((r) => r.date),
    ["2014-07-18", "2014-09-19"],
  );
});

test("stage table: entered volumes are kept, blank volumes follow sheet 2", () => {
  const entered = buildStageTable(fx.stage_table.map((r) => ({ rl: r.rl, area: r.area, volume: r.vol })));
  assert.deepEqual(entered.errors, []);
  entered.rows.forEach((r, i) => assert.equal(r.volume, fx.stage_table[i].vol));

  // Blank volumes: cone formula for the bed segment (D33 = C33·h/3 = 224.7),
  // then trapezoids (E34:E38) — the sheet's "cum V" column F33:F38 started
  // from a hand-rounded 225, so every later value sits 0.3 m³ lower here.
  const computed = buildStageTable(fx.stage_table.map((r) => ({ rl: r.rl, area: r.area, volume: null })));
  close(computed.rows[1].volume, 224.69999999999789, "cone volume at 98 m");
  for (let i = 2; i < computed.rows.length; i++) {
    close(computed.rows[i].volume, fx.stage_table[i].vol - (225 - 224.69999999999789), `volume at ${fx.stage_table[i].rl} m`);
  }
});

test("stage table rejects levels that do not increase", () => {
  const t = buildStageTable([
    { rl: 98, area: 0 },
    { rl: 98, area: 10 },
  ]);
  assert.ok(t.errors.length > 0);
});

test("area and volume at each day's level match columns E and F", () => {
  const table = buildStageTable(fx.stage_table.map((r) => ({ rl: r.rl, area: r.area, volume: r.vol })));
  for (const d of fx.days) {
    const s = stageAt(table, d.D);
    close(s.area, d.E, `area ${d.date}`, 1e-12);
    close(s.volume, d.F, `volume ${d.date}`, 1e-12);
  }
});

test("daily water balance reproduces every column G–V of sheet 1", () => {
  const wb = computeWaterBalance(badgaonExample());
  assert.ok(wb.ok, wb.errors.join("; "));
  assert.equal(wb.days.length, 120);
  const cols = {
    G: "dLevel",
    H: "dStorage",
    I: "evaporation",
    K: "dryRate",
    L: "dryRecharge",
    M: "wetRecharge",
    N: "spill",
    O: "inflow",
    P: "cumSpill",
    Q: "cumRecharge",
    R: "cumEvaporation",
    S: "cumInflow",
    T: "balance",
  };
  wb.days.forEach((d, i) => {
    const x = analysisRows[i];
    for (const [col, key] of Object.entries(cols)) close(d[key], x[col] ?? 0, `${col} ${x.date}`);
    close(d.rain, x.J ?? 0, `J ${x.date}`);
    close(d.runoffCoefficient * 10000, x.U, `U ${x.date}`);
    close(d.dryRate > 0 ? d.dryRecharge : 0, x.V, `V ${x.date}`);
  });
});

test("data-check suggestions match column AC", () => {
  const wb = computeWaterBalance(badgaonExample());
  const flagged = wb.days.filter((d) => d.qaSuggestedLevel != null);
  const sheetFlagged = analysisRows.filter((x) => x.AD != null && Math.abs(x.AD) > 1e-12);
  assert.deepEqual(
    flagged.map((d) => d.date),
    sheetFlagged.map((x) => x.date),
  );
  flagged.forEach((d, i) => close(d.qaSuggestedLevel, sheetFlagged[i].AC, `AC ${d.date}`));
});

test("season totals, counts and ratios match rows 150–158", () => {
  const wb = computeWaterBalance(badgaonExample());
  const t = wb.totals;
  close(t.evaporation, S.I150, "I150 evaporation");
  close(t.rain, S.J150, "J150 rain");
  close(wb.dryWeatherTotal, S.K150, "K150");
  close(t.dryRecharge, S.L150, "L150 dry-weather recharge");
  close(t.wetRecharge, S.M150, "M150 wet-day recharge");
  close(t.spill, S.N150, "N150 spill");
  close(t.inflow, S.O150, "O150 inflow");
  close(t.spill, S.P150, "P150");
  close(t.recharge, S.Q150, "Q150");
  close(t.evaporation, S.R150, "R150");
  close(t.inflow, S.S150, "S150");
  close(wb.mdwir, S.M10, "M10 mean dry-weather infiltration rate");
  close(wb.mdwir, S.K152, "K152");

  assert.equal(wb.counts.rainDays, S.J151);
  assert.equal(wb.counts.dryDays, S.K151);
  assert.equal(wb.counts.wetRechargeDays, S.M151);
  assert.equal(wb.counts.spillDays, S.N151);
  assert.equal(wb.counts.inflowDays, S.O151);
  assert.equal(wb.counts.runoffDays, S.U151);

  close(wb.ratios.runoffCoefficient, S.H156, "H156 runoff coefficient");
  close(wb.ratios.runoffCoefficient, S.U154, "U154");
  close(wb.ratios.captured, S.H157, "H157 captured share");
  close(wb.ratios.meanDailyRunoffCoefficient, S.U153, "U153 mean daily runoff coefficient");
});

test("end-of-season split: same formula as AJ133/AJ134, applied to the exact final volume", () => {
  const wb = computeWaterBalance(badgaonExample());
  const e = wb.endOfSeason;
  close(e.rate, S.AH133, "AH133 = M10");
  // The sheet types the remaining volume by hand (AH131 = 3014); the last
  // day's volume F132 is 3013.6575. Same formula on the sheet's 3014:
  close((S.AH131 * e.rate) / (e.rate + 0.005), S.AJ133, "AJ133 recharge share");
  close((S.AH131 * 0.005) / (e.rate + 0.005), S.AJ134, "AJ134 evaporation share");
  // ...and on the exact volume, which is what the tool uses:
  close(e.remaining, analysisRows.at(-1).F, "remaining volume = F132");
  close(e.recharge + e.evaporation, e.remaining, "split closes");
  // Totals therefore differ from Q151/R151 only by the 0.34 m³ hand-rounding.
  close(wb.totals.rechargeWithEnd, S.Q151, "Q151", 0, 0.35);
  close(wb.totals.evaporationWithEnd, S.R151, "R151", 0, 0.35);
  close(wb.ratios.rechargeToInflow, S.H155, "H155", 1e-5);
  close(wb.totals.balance, 0, "T150 closes exactly (sheet: −0.34 from the rounding)");
  close(S.T150, -0.3425000000570435, "sheet's residual is the rounding");
});

test("evaporation/recharge ratio: the sheet's H158 mixes R150 with Q151", () => {
  const wb = computeWaterBalance(badgaonExample());
  // What the sheet computes (evaporation without, recharge with the end share):
  close(wb.totals.evaporation / wb.totals.rechargeWithEnd, S.H158, "H158 as the sheet has it", 1e-5);
  // What the tool reports (both with the end share, R151/Q151):
  close(wb.ratios.evaporationToRecharge, S.R151 / S.Q151, "consistent ratio", 1e-5);
});

test("infiltration by period matches rows 173–175", () => {
  const wb = computeWaterBalance(badgaonExample());
  assert.equal(wb.periods.length, 4);
  const cols = ["L", "M", "N", "O"];
  wb.periods.forEach((q, i) => {
    assert.equal(q.dryDays, S[`${cols[i]}173`], `dry days, period ${i + 1}`);
    close(q.sumRate, S[`${cols[i]}174`], `sum of rates, period ${i + 1}`);
    close(q.mdwir, S[`${cols[i]}175`], `MDWIR, period ${i + 1}`);
  });
});

test("sensitivity reruns reproduce the sheet's pasted results (rows 161–167)", () => {
  const ex = badgaonExample();
  const run = (patch) => computeWaterBalance({ ...ex, params: { ...ex.params, ...patch } });
  // Row 162: evaporation 0.006 m/d. The 19 Sep level is the dry-day rule
  // (D78 = AC78 = D77 − 1.1 × evaporation), so it moves with the rate here as
  // it does in the sheet — and that one day decides whether 19 Sep counts as
  // a dry day, which is why recharge falls 3.3 % rather than 2.1 %.
  assert.equal(ex.readings.find((r) => r.date === "2014-09-19").level, "dry-day");
  const e = run({ evaporation: 0.006 });
  close(e.mdwir, 0.0296, "N162 (typed to 3 s.f.)", 0, 5e-5);
  close(e.mdwir, 0.02964301075268836, "93 dry days, as in the sheet");
  close((e.totals.rechargeWithEnd - S.Q151) / S.Q151, -0.03297054686840886, "Q163 −3.30 %", 0, 1e-5);
  // The pasted row agrees to within 1 m³ in ~350 000 m³ (0.0003 %): the split
  // used the hand-typed 3014 m³, and the paste predates the current workbook.
  close(e.totals.rechargeWithEnd, 109164.25303560912, "Q162", 0, 1);
  close(e.totals.evaporationWithEnd, 22646.105185880755, "R162", 0, 1);
  close(e.totals.inflow, 349520.39470826375, "S162", 0, 1);
  close(e.totals.spill, 217710.37898677384, "P162");
  // Row 164: infiltration on wet days 0.0367 m/d (the sheet overwrote M10).
  const i = run({ wetDayRate: "fixed", wetDayRateValue: 0.0367 });
  close(i.totals.rechargeWithEnd, 118440.76586511047, "Q164", 0, 0.5);
  close(i.totals.evaporationWithEnd, 18810.341419790242, "R164", 0, 0.5);
  close(i.totals.inflow, 354961.14377167454, "S164");
  // Row 167 is labelled C1 = 1.28, but its values are C1 = 1.3 (−18.75 %,
  // P168): spill is linear in C1 and 217710.379 × 1.3/1.6 = 176889.683.
  const w = run({ weirCoefficient: 1.3 });
  close(w.totals.spill, 176889.6829267537, "P167");
  close(w.totals.inflow, 308647.40695581265, "S167");
});

test("live sensitivity table: every scenario runs and the signs make sense", () => {
  const ex = badgaonExample();
  const rows = runSensitivity(ex);
  assert.equal(rows.length, 6);
  assert.ok(rows.every((r) => r.ok));
  const evapUp = rows[0];
  assert.ok(evapUp.change.evaporation > 0.19 && evapUp.change.evaporation < 0.21);
  assert.ok(evapUp.change.recharge < 0);
  const weirDown = rows[5];
  close(weirDown.change.spill, -0.2, "spill is linear in C1", 1e-9);
});

test("recession method reproduces the MyWell sheet flags and runs", () => {
  const rc = fx.recession;
  const readings = rc.rows.map((r) => ({ date: r.date, time: r.time, gauge: r.gauge_cm, rain: r.rain_mm }));
  const res = computeRecession(readings, {
    gaugeCtf: rc.params.ctf_gauge_cm,
    evaporationCm: rc.params.evap_cm_per_d,
    dayZero: "2014-06-01T09:00",
  });
  assert.ok(res.ok);
  res.points.forEach((pt, i) => {
    const x = rc.rows[i];
    close(pt.t, x.E, `E ${x.date}`);
    if (i > 0) {
      close(pt.dy, x.F, `F ${x.date}`);
      assert.equal(+pt.above, x.G, `G ${x.date}`);
      assert.equal(+pt.wet, x.H, `H ${x.date}`);
      assert.equal(+pt.rising, x.I, `I ${x.date}`);
      assert.equal(pt.eligible, x.J === 0, `J ${x.date}`);
    }
    assert.equal(pt.runPosition, x.K, `K ${x.date}`);
    assert.equal(pt.run != null ? 1 : 0, x.P, `P ${x.date}`);
  });
  assert.equal(res.runs.length, 4);
  res.runs.forEach((run, i) => {
    const x = rc.regressions[i];
    assert.equal(run.n, x.n, `n, run ${i + 1}`);
    close(run.slope, x.m, `slope, run ${i + 1}`);
    close(run.intercept, x.c, `intercept, run ${i + 1}`);
    close(run.se, x.sem, `SE of slope, run ${i + 1}`);
  });
  // Excel's chart trendlines show these R² values (T117, U49, V117, W117):
  [0.9959, 0.9827, 0.9657, 0.9781].forEach((r2, i) => close(res.runs[i].r2, r2, `R², run ${i + 1}`, 0, 5e-5));
});

test("recession pooled result: 19.06 mm/d weighted, 43.37 unweighted", () => {
  const rc = fx.recession;
  const readings = rc.rows.map((r) => ({ date: r.date, time: r.time, gauge: r.gauge_cm, rain: r.rain_mm }));
  const res = computeRecession(readings, { gaugeCtf: 157, evaporationCm: 0.5 });
  const P = rc.pooled;
  close(res.pooled.weight, P.X113, "Σ(n−1)");
  close(res.pooled.weightedSlope, P.Y114, "weighted mean slope");
  close(res.pooled.infiltrationCm, P.AA114, "AA114 infiltration (cm/d)");
  close(res.pooled.infiltrationMm, P.AC114, "AC114 infiltration (mm/d)");
  close(res.pooled.unweightedSlope, P.Y121, "Y121 unweighted slope");
  close(res.pooled.unweightedInfiltrationMm, P.AC116, "AC116 unweighted (mm/d)");
  // Pooled SE: the tool uses SE² as the sheet's row label says. The sheet's
  // cells use SE — reproduce that to show where Y116 comes from.
  const runs = res.runs;
  const sw = runs.reduce((a, r) => a + r.n - 1, 0);
  close(Math.sqrt(runs.reduce((a, r) => a + (r.n - 1) * r.se, 0) / sw), P.Y116, "Y116 as the sheet has it");
  close(res.pooled.se, Math.sqrt(runs.reduce((a, r) => a + (r.n - 1) * r.se * r.se, 0) / sw), "pooled SE with SE²");
  assert.ok(res.pooled.se < P.Y116);
});

test("recession on the example uses the same window as the MyWell sheet", () => {
  const ex = badgaonExample();
  const res = computeRecession(ex.readings, {
    gaugeCtf: gaugeCtfCm(ex.params),
    evaporationCm: ex.params.evaporation * 100,
    ...ex.recession,
  });
  close(res.pooled.infiltrationMm, fx.recession.pooled.AC114, "19.06 mm/d");
  assert.equal(res.runs.length, 4);
});

// ---------------------------------------------------------------------------
// Behaviour beyond the workbook's own data

const tiny = (overrides = {}) => ({
  params: { gaugeZeroRl: 98.43, ctfRl: 100, evaporation: 0.005, catchmentHa: 100, ...overrides.params },
  stage: [
    { rl: 97.7, area: 0, volume: 0 },
    { rl: 98, area: 2247, volume: 225 },
    { rl: 100, area: 39000, volume: 39336.75 },
    { rl: 100.5, area: 44629.5, volume: 60244.125 },
  ],
  readings: overrides.readings || [
    { date: "2020-07-01", gauge: 100, rain: 20 },
    { date: "2020-07-02", gauge: 95, rain: 0 },
    { date: "2020-07-03", gauge: null, rain: 0 },
    { date: "2020-07-04", gauge: 85, rain: 0 },
  ],
});

test("the spillway reading converts to 157 cm exactly (no 156.99999 edge)", () => {
  assert.equal(gaugeCtfCm({ gaugeZeroRl: 98.43, ctfRl: 100 }), 157);
});

test("a reading exactly at the spillway is not 'above' it, as in the sheet", () => {
  const readings = ["2020-01-01", "2020-01-02", "2020-01-03", "2020-01-04"].map((date, i) => ({
    date,
    gauge: [160, 157, 150, 145][i],
    rain: 0,
  }));
  const res = computeRecession(readings, { gaugeCtf: 157, evaporationCm: 0.5 });
  assert.equal(res.points[1].above, false);
});

test("a missing gauge reading between two days is interpolated", () => {
  const wb = computeWaterBalance(tiny());
  assert.ok(wb.ok, wb.errors.join("; "));
  assert.equal(wb.days[2].levelSource, "interpolated");
  close(wb.days[2].level, 98.43 + 0.9, "halfway between 95 and 85 cm");
});

test("a gap in the dates is an error with the missing span named", () => {
  const wb = computeWaterBalance(
    tiny({
      readings: [
        { date: "2020-07-01", gauge: 100 },
        { date: "2020-07-05", gauge: 90 },
      ],
    }),
  );
  assert.equal(wb.ok, false);
  assert.match(wb.errors[0], /2020-07-01 to 2020-07-05/);
});

test("levels above the stage table are extrapolated with a warning", () => {
  const wb = computeWaterBalance(
    tiny({
      // Only rising days, so there is no dry-weather rate to estimate: fix it.
      params: { wetDayRate: "fixed", wetDayRateValue: 0.03 },
      readings: [
        { date: "2020-07-01", gauge: 150 },
        { date: "2020-07-02", gauge: 230 },
      ],
    }),
  );
  assert.ok(wb.ok, wb.errors.join("; "));
  assert.equal(wb.days[1].level > 100.5, true);
  assert.match(wb.warnings.join(" "), /above the highest level/);
});

test("fixed infiltration rate is used on wet days and for the end-of-season split", () => {
  const wb = computeWaterBalance(tiny({ params: { wetDayRate: "fixed", wetDayRateValue: 0.02 } }));
  assert.ok(wb.ok);
  assert.equal(wb.endOfSeason.rate, 0.02);
  const wet = wb.days.filter((d) => d.wetRecharge > 0);
  assert.ok(wet.length > 0);
  wet.forEach((d) => close(d.wetRecharge, 0.02 * (d.area + d.prevArea) * 0.5, `M ${d.date}`));
});

test("an initial level replaces the empty-structure first day", () => {
  const empty = computeWaterBalance(tiny());
  const full = computeWaterBalance(tiny({ params: { initialLevel: 98.43 + 1.05 } }));
  assert.ok(full.ok);
  // Day 1 no longer "fills" the structure from zero...
  assert.ok(full.days[0].dStorage < empty.days[0].dStorage);
  assert.ok(full.totals.initialStorage > 0);
  // ...the running check T still equals the water in the structure...
  full.days.forEach((d) => close(d.balance, d.volume, `T ${d.date}`, 1e-9, 1e-6));
  // ...and the season balance closes, with and without the end-of-season split.
  close(full.totals.balance, 0, "balance", 0, 1e-6);
  const kept = computeWaterBalance(tiny({ params: { initialLevel: 98.43 + 1.05, splitRemaining: false } }));
  close(kept.totals.balance, 0, "balance without split", 0, 1e-6);
  close(kept.totals.storageLeft, kept.days.at(-1).volume, "storage left");
});

test("recession ignores readings at gauge zero", () => {
  const readings = [0, 1, 2, 3, 4, 5].map((i) => ({
    date: `2020-01-0${i + 1}`,
    gauge: [30, 20, 10, 0, 0, 0][i],
    rain: 0,
  }));
  const res = computeRecession(readings, { gaugeCtf: 157, evaporationCm: 0.5 });
  assert.equal(res.runs.length, 0, "only two positive readings follow the first — too short to fit");
  assert.ok(res.points.slice(3).every((p) => !p.eligible));
});

test("dayNumber is timezone-proof", () => {
  assert.equal(dayNumber("2014-07-17") - dayNumber("2014-07-16"), 1);
  assert.equal(dayNumber("2014-10-27") - dayNumber("2014-10-26"), 1);
});

test("a new site with no levels says which inputs are missing, and where", () => {
  const wb = computeWaterBalance(
    tiny({ params: { gaugeZeroRl: null, ctfRl: null, weirLength: null, catchmentHa: null } }),
  );
  assert.equal(wb.ok, false);
  const dam = wb.problems.filter((q) => q.area === "dam").map((q) => q.text);
  assert.deepEqual(dam, ["Enter the level of the gauge board’s 0 cm mark.", "Enter the level of the spillway.", "Enter the length of the spillway."]);
  assert.ok(Number.isNaN(gaugeCtfCm({ gaugeZeroRl: null, ctfRl: null })), "no spillway on the gauge until both levels exist");
});

test("problems are tagged with the step that fixes them", () => {
  const wb = computeWaterBalance({ params: {}, stage: [], readings: [] });
  assert.deepEqual([...new Set(wb.problems.map((q) => q.area))].sort(), ["readings", "survey"]);
});

test("the catchment area is optional: only the runoff figures need it", () => {
  const wb = computeWaterBalance(tiny({ params: { catchmentHa: null } }));
  assert.ok(wb.ok, wb.errors.join("; "));
  assert.equal(wb.ratios.runoffCoefficient, null);
  assert.ok(wb.totals.rechargeWithEnd > 0);
});
