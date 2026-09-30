// The report: its model (what it says) and the PDF writer (that the file is
// a well-formed PDF carrying those numbers).
//
// Run:  node --test "test/*.test.mjs"

import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import { badgaonExample } from "../js/example.js";
import { reportModel, buildReportPdf, reportFileName } from "../js/report.js";
import { PdfDoc, winAnsi } from "../js/pdf.js";

function results(project) {
  const wb = E.computeWaterBalance(project);
  const rec = E.computeRecession(project.readings, {
    gaugeCtf: E.gaugeCtfCm(project.params),
    evaporationCm: project.params.evaporation * 100,
    ...project.recession,
  });
  return { wb, rec, sens: wb.ok ? E.runSensitivity(project, wb) : [] };
}

/** Parse the xref table and check every offset points at its "n 0 obj". */
function checkStructure(bytes) {
  const text = Buffer.from(bytes).toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4\n"), "header");
  assert.ok(text.endsWith("%%EOF\n"), "trailer");
  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)[1]);
  assert.equal(text.slice(startxref, startxref + 4), "xref");
  const m = /^xref\n0 (\d+)\n/.exec(text.slice(startxref));
  const count = Number(m[1]);
  const rows = text.slice(startxref + m[0].length).split("\n").slice(0, count);
  rows.slice(1).forEach((row, i) => {
    const offset = Number(row.slice(0, 10));
    assert.ok(text.startsWith(`${i + 1} 0 obj\n`, offset), `object ${i + 1} at ${offset}`);
  });
  // Each stream's /Length is its exact byte count.
  for (const s of text.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const start = s.index + s[0].length;
    assert.equal(text.slice(start + Number(s[1]), start + Number(s[1]) + 10), "\nendstream");
  }
  // Nothing but ASCII after the binary-marker comment: text bytes are escaped.
  const body = text.slice(text.indexOf("\n", 9) + 1);
  assert.ok(!/[^\x09\x0a\x0d\x20-\x7e]/.test(body), "ASCII body");
  return { text, pages: Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(text)[1]) };
}

test("text is written in WinAnsi: symbols kept, others spelled out", () => {
  assert.deepEqual(winAnsi("m³"), [109, 0xb3]);
  assert.deepEqual(winAnsi("−3.3%"), [45, 51, 46, 51, 37]); // true minus -> hyphen
  assert.deepEqual(winAnsi("C₁"), [67, 49]);
  assert.deepEqual(winAnsi("16 Jul – 12 Nov"), [...Buffer.from("16 Jul "), 0x96, ...Buffer.from(" 12 Nov")]);
  assert.deepEqual(winAnsi("बड"), [63, 63]); // no WinAnsi code -> "?"
});

test("a blank document is a valid one-page PDF", () => {
  const doc = new PdfDoc({ title: "t" }).page();
  doc.text("Hello (world) \\ 100%", 50, 50);
  const { text, pages } = checkStructure(doc.save());
  assert.equal(pages, 1);
  assert.ok(text.includes("(Hello \\(world\\) \\\\ 100%) Tj"), "parentheses and backslash escaped");
});

test("text width follows the Helvetica metrics", () => {
  const doc = new PdfDoc();
  assert.equal(doc.width("0", 10), 5.56);
  assert.equal(doc.width("W", 10, true), 9.44);
  assert.ok(doc.width("Soaked in", 10, true) > doc.width("Soaked in", 10));
});

test("the report model carries the verified Badgaon numbers", () => {
  const p = badgaonExample();
  const m = reportModel(p, results(p), { source: "test", generatedAt: new Date("2026-09-30T00:00:00Z") });
  assert.equal(m.ok, true);
  assert.equal(m.period.label, "16 Jul – 12 Nov 2014");
  assert.equal(m.period.days, 120);
  assert.equal(Math.round(m.headline.recharge), 112886);
  assert.equal(Math.round(m.headline.inflow), 349468);
  const shares = m.parts.map((q) => Math.round(q.share * 1000) / 10);
  assert.deepEqual(shares, [32.3, 5.4, 62.3]);
  const key = Object.fromEntries(m.keyNumbers.map((r) => [r.label, r.value]));
  assert.equal(key["Rainfall"], "504.6 mm");
  assert.equal(key["Infiltration rate on dry days"], "30.6 mm/day");
  assert.equal(key["Infiltration rate from the gauge alone"], "19.1 mm/day");
  assert.equal(key["Balance check"], "0.00 m³");
  // The three readings the data checks flag, named in the report.
  assert.ok(m.checks.some((c) => c.startsWith("3 readings may be wrong") && c.includes("24 Jul, 27 Aug, 20 Sep")));
  assert.equal(m.sensitivity.length, 6);
  assert.equal(m.sensitivity[0].recharge, "−3.3%");
});

test("an incomplete project says what is missing instead of a report", () => {
  const p = badgaonExample();
  p.params.gaugeZeroRl = null;
  const m = reportModel(p, results(p));
  assert.equal(m.ok, false);
  assert.ok(m.problems.length > 0);
  assert.throws(() => buildReportPdf(p, results(p)), /not ready/);
});

test("the Badgaon PDF is well formed, six pages, and prints the headline numbers", () => {
  const p = badgaonExample();
  const bytes = buildReportPdf(p, results(p), { source: "Badgaon example", generatedAt: new Date("2026-09-30T00:00:00Z") });
  const { text, pages } = checkStructure(bytes);
  assert.equal(pages, 6);
  assert.ok(text.includes("(112,886 m\\263) Tj"), "headline");
  assert.ok(text.includes("(349,468 m\\263) Tj"), "inflow");
  assert.ok(text.includes("(30.6 mm/day) Tj"), "dry-day rate");
  assert.ok(text.includes("(Page 6 of 6) Tj"), "footer");
  assert.ok(text.includes("/Title (Badgaon check dam, 2014: check dam water balance)"));
  // One row per day in the daily table.
  assert.equal((text.match(/\(\d{1,2} (?:Jul|Aug|Sep|Oct|Nov) 2014\) Tj/g) || []).length >= 120, true);
});

test("the PDF file name comes from the site name and the moment it was made", () => {
  // Built from local-time parts, so the test means the same in every time zone.
  const when = new Date(2026, 8, 30, 15, 47, 12);
  assert.equal(reportFileName({ site: { name: "Badgaon check dam, 2014" } }, when), "badgaon-check-dam-2014-water-balance-2026-09-30-1547.pdf");
  assert.equal(reportFileName({ site: { name: "बड़गांव" } }, when), "check-dam-water-balance-2026-09-30-1547.pdf");
  assert.equal(reportFileName({}, when), "check-dam-water-balance-2026-09-30-1547.pdf");
  // Single digits are padded, so names sort by time.
  assert.equal(reportFileName({}, new Date(2027, 0, 5, 7, 4)), "check-dam-water-balance-2027-01-05-0704.pdf");
  // Without a moment it uses now, in the same shape.
  assert.match(reportFileName({}), /^check-dam-water-balance-\d{4}-\d{2}-\d{2}-\d{4}\.pdf$/);
});

test("the report prints when it was made on the reader's own clock, not UTC's", () => {
  const p = badgaonExample();
  // 00:30 local on 1 Oct. East of Greenwich the UTC date of this instant is still 30 Sep,
  // which is what the first version printed.
  const { text } = checkStructure(buildReportPdf(p, results(p), { source: "x", generatedAt: new Date(2026, 9, 1, 0, 30) }));
  assert.ok(text.includes("report made 1 Oct 2026, 00:30"), "date and time as on the reader's clock");
});
