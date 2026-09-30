// Import/export round trips, with SheetJS from the vendored browser build.
//
// The real-workbook test reads MyCheckDam.xlsx from MYCHECKDAM_XLSX (skipped
// when unset) — the workbook is project data and is not kept in the repo.
//
// Run:  MYCHECKDAM_XLSX=/path/to/MyCheckDam.xlsx node --test "test/*.test.mjs"

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Load the same xlsx.mini.min.js the page loads, as a browser global.
const sandbox = { window: {}, console };
sandbox.self = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(readFileSync(fileURLToPath(new URL("../vendor/xlsx.mini.min.js", import.meta.url)), "utf8"), sandbox);
globalThis.window = { XLSX: sandbox.XLSX || sandbox.window.XLSX };
const XLSX = globalThis.window.XLSX;

const { fromTemplate, fromTable, fromSimpleTemplate, checkProject, toIsoDate, buildResultsWorkbook, buildTemplateWorkbook, readingsCsv, surveyCsv, damCsv } =
  await import("../js/io.js");
const { badgaonExample } = await import("../js/example.js");
const { computeWaterBalance, computeRecession, runSensitivity, gaugeCtfCm } = await import("../js/engine.js");

test("the vendored SheetJS build loaded", () => {
  assert.equal(typeof XLSX.read, "function");
});

const xlsxPath = process.env.MYCHECKDAM_XLSX;
test("importing MyCheckDam.xlsx gives exactly the verified example", { skip: !xlsxPath || !existsSync(xlsxPath) }, () => {
  const wb = XLSX.read(readFileSync(xlsxPath), { type: "buffer", cellDates: false });
  const { project, summary, warnings } = fromTemplate(wb, "MyCheckDam.xlsx");
  const ex = badgaonExample();
  assert.deepEqual(warnings, []);
  assert.equal(project.readings.length, 120, summary.join("\n"));
  project.readings.forEach((r, i) => {
    const e = ex.readings[i];
    assert.equal(r.date, e.date);
    assert.equal(r.gauge, e.gauge, `gauge ${r.date}`);
    assert.equal(r.rain, e.rain, `rain ${r.date}`);
    assert.equal(r.level, e.level, `override ${r.date}`);
  });
  for (const k of ["evaporation", "gaugeZeroRl", "catchmentHa", "weirLength", "ctfRl", "weirCoefficient", "weirExponent"]) {
    assert.equal(project.params[k], ex.params[k], k);
  }
  assert.deepEqual(project.params.periodStarts, ex.params.periodStarts);
  assert.deepEqual(project.stage, ex.stage);
  assert.equal(project.recession.to, "2014-10-20");
  assert.equal(project.site.name, "Badgaon Check Dam, 2014", "named from the workbook's own description");
  assert.ok(summary.some((l) => /1 level\(s\) in column D follow the dry-day check/.test(l)));
  // ...so it computes the same numbers.
  const a = computeWaterBalance(project);
  const b = computeWaterBalance(ex);
  assert.equal(a.totals.rechargeWithEnd, b.totals.rechargeWithEnd);
  assert.equal(a.mdwir, b.mdwir);
});

test("a plain table with Date / Gauge / Rain headers is read", () => {
  const ws = XLSX.utils.aoa_to_sheet([
    ["Badgaon readings"],
    ["Date", "Gauge board (cm)", "Rainfall (mm)"],
    ["16/07/2014", 0, 2.7],
    ["2014-07-17", "0", ""],
    [41838, 140, 9.6],
    ["notes: none", null, null],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const res = fromTable(wb, "readings.xlsx");
  assert.equal(res.kind, "readings");
  assert.deepEqual(
    res.readings.map((r) => [r.date, r.gauge, r.rain]),
    [
      ["2014-07-16", 0, 2.7],
      ["2014-07-17", 0, null],
      ["2014-07-18", 140, 9.6],
    ],
  );
  assert.equal(res.warnings.length, 1);
});

test("a sheet without a date header is refused with directions", () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["a", "b"], [1, 2]]), "Sheet1");
  assert.throws(() => fromTable(wb, "x.xlsx"), /doesn’t look like CheckDamCal data.*“Date” column/);
});

test("date parsing: serials, ISO, day-first and month names; nonsense is null", () => {
  assert.equal(toIsoDate(41836), "2014-07-16");
  assert.equal(toIsoDate("2014-7-16"), "2014-07-16");
  assert.equal(toIsoDate("16/07/2014"), "2014-07-16");
  assert.equal(toIsoDate("16-Jul-14"), "2014-07-16");
  assert.equal(toIsoDate("31/02/2014"), null);
  assert.equal(toIsoDate("TOTAL"), null);
});

test("a saved project survives a JSON round trip", () => {
  const ex = badgaonExample();
  const back = checkProject(JSON.parse(JSON.stringify(ex)));
  assert.deepEqual(back.readings, ex.readings);
  assert.deepEqual(back.stage, ex.stage);
  assert.deepEqual(back.params, ex.params);
});

test("the results workbook has every sheet and the headline numbers", () => {
  const ex = badgaonExample();
  const wb = computeWaterBalance(ex);
  const rec = computeRecession(ex.readings, { gaugeCtf: gaugeCtfCm(ex.params), evaporationCm: ex.params.evaporation * 100, ...ex.recession });
  const book = buildResultsWorkbook(ex, wb, rec, runSensitivity(ex, wb));
  // (SheetJS runs in its own vm context, so copy its array before comparing.)
  assert.deepEqual([...book.SheetNames], [
    "Summary",
    "Daily water balance",
    "Infiltration by period",
    "Sensitivity",
    "Recession runs",
    "Stage table",
    "Readings",
  ]);
  // Write and read back through the real xlsx writer.
  const again = XLSX.read(XLSX.write(book, { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
  const summary = XLSX.utils.sheet_to_json(again.Sheets.Summary, { header: 1 });
  const row = summary.find((r) => r[0] === "Recharge, with the end-of-season share");
  assert.equal(row[1], wb.totals.rechargeWithEnd);
  const daily = XLSX.utils.sheet_to_json(again.Sheets["Daily water balance"], { header: 1 });
  assert.equal(daily.length, 121);
});


test("the fill-in template, filled with the example, reads back to the same project", () => {
  const ex = badgaonExample();
  const bytes = XLSX.write(buildTemplateWorkbook(ex), { type: "buffer", bookType: "xlsx" });
  const wb = XLSX.read(bytes, { type: "buffer", cellDates: false });
  assert.deepEqual([...wb.SheetNames], ["Read me", "Check dam", "Pond survey", "Daily readings"]);
  const { project, warnings } = fromSimpleTemplate(wb, "checkdamcal-badgaon-2014.xlsx");
  assert.deepEqual(warnings, []);
  for (const k of ["gaugeZeroRl", "ctfRl", "weirLength", "evaporation", "catchmentHa", "weirCoefficient", "weirExponent"]) {
    assert.equal(project.params[k], ex.params[k], k);
  }
  assert.deepEqual(project.stage, ex.stage);
  assert.deepEqual(
    project.readings.map((r) => [r.date, r.gauge, r.rain, r.level]),
    ex.readings.map((r) => [r.date, r.gauge, r.rain, r.level]),
  );
  // Dates are real Excel dates, not text.
  assert.equal(wb.Sheets["Daily readings"].A2.t, "n");
  assert.equal(computeWaterBalance(project).totals.rechargeWithEnd, computeWaterBalance(ex).totals.rechargeWithEnd);
});

test("the blank template reads back as an empty site with directions", () => {
  const bytes = XLSX.write(buildTemplateWorkbook(null), { type: "buffer", bookType: "xlsx" });
  const { project, warnings } = fromSimpleTemplate(XLSX.read(bytes, { type: "buffer" }), "template.xlsx");
  assert.equal(project.readings.length, 0);
  assert.equal(project.params.gaugeZeroRl, null);
  assert.equal(warnings.length, 3);
});

test("the example CSV files import as readings, survey and check dam", () => {
  const ex = badgaonExample();
  const read = (csv) => fromTable(XLSX.read(csv, { type: "string", raw: false }), "example.csv");
  const r = read(readingsCsv(ex));
  assert.equal(r.kind, "readings");
  assert.deepEqual(
    r.readings.map((x) => [x.date, x.gauge, x.rain, x.level]),
    ex.readings.map((x) => [x.date, x.gauge, x.rain, x.level]),
  );
  const sv = read(surveyCsv(ex));
  assert.equal(sv.kind, "survey");
  assert.deepEqual(sv.stage, ex.stage);
  const dm = read(damCsv(ex));
  assert.equal(dm.kind, "dam");
  assert.equal(dm.params.evaporation, 0.005, "mm/day in the file, m/day inside");
  assert.equal(dm.params.gaugeZeroRl, 98.43);
  assert.equal(dm.params.ctfRl, 100);
  assert.equal(dm.params.weirLength, 12.7);
});

test("the files in examples/ import cleanly and match the built-in example", () => {
  const ex = badgaonExample();
  const file = (name) => readFileSync(fileURLToPath(new URL(`../examples/${name}`, import.meta.url)));
  const table = (name) => fromTable(XLSX.read(file(name), { type: "buffer" }), name);
  const r = table("badgaon-2014-daily-readings.csv");
  assert.equal(r.kind, "readings");
  assert.equal(r.readings.length, 120);
  assert.equal(r.readings.find((x) => x.date === "2014-09-19").level, "dry-day");
  assert.equal(table("badgaon-2014-pond-survey.csv").kind, "survey");
  assert.equal(table("badgaon-2014-check-dam.csv").params.evaporation, 0.005);
  const filled = fromSimpleTemplate(XLSX.read(file("checkdamcal-badgaon-2014.xlsx"), { type: "buffer" }), "x.xlsx").project;
  assert.equal(computeWaterBalance(filled).totals.rechargeWithEnd, computeWaterBalance(ex).totals.rechargeWithEnd);
  const blank = fromSimpleTemplate(XLSX.read(file("checkdamcal-template.xlsx"), { type: "buffer" }), "t.xlsx");
  assert.equal(blank.project.readings.length, 0);
});
