// Regenerate the files in examples/ from js/example.js (the verified Badgaon
// data), with the same writers the page uses — so the downloads can't drift.
//
// Run:  node scripts/make-examples.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const sandbox = { window: {}, console };
sandbox.self = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(readFileSync(here("../vendor/xlsx.mini.min.js"), "utf8"), sandbox);
globalThis.window = { XLSX: sandbox.XLSX || sandbox.window.XLSX };
const XLSX = globalThis.window.XLSX;

const { buildTemplateWorkbook, readingsCsv, surveyCsv, damCsv } = await import("../js/io.js");
const { badgaonExample } = await import("../js/example.js");

const out = here("../examples/");
mkdirSync(out, { recursive: true });
const ex = badgaonExample();
const files = {
  "badgaon-2014-daily-readings.csv": readingsCsv(ex),
  "badgaon-2014-pond-survey.csv": surveyCsv(ex),
  "badgaon-2014-check-dam.csv": damCsv(ex),
};
// A UTF-8 byte-order mark so Excel reads m², ’ and ₁ correctly.
for (const [name, text] of Object.entries(files)) writeFileSync(out + name, "\uFEFF" + text);
const xlsx = (book) => Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true }));
writeFileSync(out + "checkdamcal-badgaon-2014.xlsx", xlsx(buildTemplateWorkbook(ex)));
writeFileSync(out + "checkdamcal-template.xlsx", xlsx(buildTemplateWorkbook(null)));
console.log(`wrote ${Object.keys(files).length + 2} files to examples/`);
