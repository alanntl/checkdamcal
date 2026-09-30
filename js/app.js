// CheckDamCal — the page: a guided, step-by-step front end on the engine.
//
//   Start here → 1 Your check dam → 2 Pond survey → 3 Daily readings
//   → 4 Results → 5 Infiltration rate (optional) → Report (PDF) · Learn
//
// Start here offers two ways in: drop a file and go straight to the report,
// or enter the data step by step. Opened with ?embed inside OurWater, the
// host page sends the data (see "Embedded in OurWater" at the end).
//
// Easy view shows the essentials in plain words; Advanced adds every setting
// and table from the workbook (elements marked .adv). Inputs live in
// state.project and are saved to this browser; results are derived by
// recompute() from the pure engine and re-rendered in place.

import * as E from "./engine.js";
import * as F from "./format.js";
import { h } from "./dom.js";
import { TimeChart, XYChart } from "./charts.js";
import { drawSection, drawExplainer, diagramStage } from "./section.js";
import { readFile, exportResults, saveProjectFile, checkProject, toIsoDate, downloadBytes } from "./io.js";
import { reportModel, buildReportPdf, reportFileName } from "./report.js";
import { createLearn } from "./learn.js";
import { badgaonExample } from "./example.js";

const STORE_KEY = "checkdamcal.project.v1";
const PREFS_KEY = "checkdamcal.prefs.v1";
const TABS = ["start", "dam", "survey", "readings", "balance", "recession", "report", "learn"];
const STEP_NAME = {
  start: "Start here",
  dam: "Step 1 · Your check dam",
  survey: "Step 2 · Pond survey",
  readings: "Step 3 · Daily readings",
  balance: "Step 4 · Results",
  recession: "Step 5 · Infiltration rate",
  report: "Report",
  learn: "Learn",
};
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const $ = (sel, root = document) => root.querySelector(sel);
// Inside a page of the same site (OurWater) with ?embed: the host sends the
// data and the theme, and hears when the dam's setup changes.
const EMBED_MODE = new URLSearchParams(location.search).get("embed");
const EMBED = EMBED_MODE != null && window.parent !== window;
// ?embed=focus: no header, tabs or status bar of its own. The host page shows
// one panel at a time (message "goto"), gets told the state after every change
// (message "state") and the content height (message "size"), so the page
// scrolls as one and the host can draw its own steps and buttons.
const FOCUS = EMBED && EMBED_MODE === "focus";

const state = {
  project: null,
  isExample: false,
  results: null,
  example: null, // results of the Badgaon example, for the Start page
  tab: "start",
  mode: "easy",
  day: null, // day shown in the dam section when nothing is hovered
  hover: null,
  highlightRun: null,
  playTimer: null,
  notices: { start: [], dam: [], survey: [], readings: [], balance: [], recession: [], report: [] },
};
const ui = {}; // element and chart references, filled by the build* functions

// ---------------------------------------------------------------------------
// Storage (per-browser convenience only; the project file is the real save)

function readStore(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or full storage: the page still works, it just won't remember */
  }
}
function setPref(patch) {
  writeStore(PREFS_KEY, { ...(readStore(PREFS_KEY) || {}), ...patch });
}
let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeStore(STORE_KEY, { project: state.project, isExample: state.isExample }), 400);
}

// ---------------------------------------------------------------------------
// Theme and view mode

// Light unless the visitor picks otherwise. Only a click is saved (as
// themeChoice), so the default is never stored as if it had been chosen.
function applyTheme(choice, save = true) {
  const root = document.documentElement;
  if (choice === "light" || choice === "dark") root.setAttribute("data-theme", choice);
  else root.removeAttribute("data-theme");
  document.querySelectorAll("[data-theme-choice]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeChoice === (choice || "system"))));
  if (save) setPref({ themeChoice: choice });
}

function applyMode(mode) {
  state.mode = mode === "advanced" ? "advanced" : "easy";
  document.documentElement.setAttribute("data-mode", state.mode);
  document.querySelectorAll("[data-mode-choice]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.modeChoice === state.mode)));
  setPref({ mode: state.mode });
  if (state.results) renderStatus();
}

// ---------------------------------------------------------------------------
// Small UI helpers

const ICONS = {
  info: "M9 1a8 8 0 1 0 0 16A8 8 0 0 0 9 1Zm0 3.2a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2ZM10.3 13.5H7.7v-1.3h.6V9.3h-.6V8h2v4.2h.6v1.3Z",
  warn: "M9 1.5 17 15.5H1L9 1.5Zm-.9 5v4.6h1.8V6.5H8.1Zm0 5.9v1.7h1.8v-1.7H8.1Z",
  error: "M9 1a8 8 0 1 0 0 16A8 8 0 0 0 9 1Zm-.9 4h1.8v5.4H8.1V5Zm0 6.8h1.8v1.8H8.1v-1.8Z",
  ok: "M9 1a8 8 0 1 0 0 16A8 8 0 0 0 9 1Zm-1.3 11.6L4.3 9.2l1.3-1.3 2.1 2.1 4.7-4.7 1.3 1.3-6 6Z",
  need: "M3 2h9l3 3v11H3V2Zm2 4v1.6h8V6H5Zm0 3.2v1.6h8V9.2H5Zm0 3.2V14h5v-1.6H5Z",
};
function icon(kind) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 18 18");
  svg.setAttribute("class", "notice-icon");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", ICONS[kind] || ICONS.info);
  p.setAttribute("fill", "currentColor");
  svg.append(p);
  return svg;
}
const KIND_LABEL = { info: "Note", warn: "Check", error: "Problem", ok: "OK" };

/** A notice box: kind info|warn|error; body is a string or nodes. */
function notice(kind, title, body, { actions = [], onClose } = {}) {
  return h(
    "div",
    { class: `notice ${kind === "info" ? "" : kind}`, role: kind === "error" ? "alert" : "status" },
    icon(kind),
    h(
      "div",
      { class: "notice-body" },
      h("span", { class: "visually-hidden", text: `${KIND_LABEL[kind]}: ` }),
      title ? h("strong", { text: title }) : null,
      title && body ? " " : null,
      body,
      actions.length ? h("div", { class: "notice-actions" }, actions) : null,
    ),
    onClose ? h("button", { class: "notice-close", type: "button", "aria-label": "Dismiss", text: "×", onclick: onClose }) : null,
  );
}

function addNotice(panel, n) {
  state.notices[panel].push(n);
  renderNotices(panel, ui[`noticeExtra_${panel}`] || []);
}
function renderNotices(panel, extra = []) {
  const host = ui[`notices_${panel}`];
  if (!host) return;
  host.replaceChildren(
    ...extra,
    ...state.notices[panel].map((n, i) =>
      notice(n.kind, n.title, n.body, {
        actions: n.actions ? n.actions() : [],
        onClose: () => {
          state.notices[panel].splice(i, 1);
          renderNotices(panel, ui[`noticeExtra_${panel}`] || []);
        },
      }),
    ),
  );
}

/** The top of a step: where you are, why it matters, what you need, and its lesson. */
function stepHead({ kicker, title, why, need, lesson }) {
  return h(
    "div",
    { class: "step-head" },
    kicker ? h("div", { class: "step-kicker", text: kicker }) : null,
    h("h2", { text: title }),
    why ? h("p", { class: "step-why", text: why }) : null,
    need ? h("div", { class: "step-need" }, icon("need"), h("div", {}, h("strong", { text: "You’ll need: " }), need)) : null,
    lesson ? h("div", {}, learnLink(lesson.n, lesson.label)) : null,
  );
}

/** A link into a Learn lesson (optionally following a given day). */
function learnLink(lesson, label, day) {
  return h("button", {
    class: "btn-link learn-link",
    type: "button",
    text: label,
    onclick: () => {
      goTab("learn");
      ui.learn?.open({ lesson, day });
    },
  });
}

/** Back / Next at the foot of a step. */
function stepFoot(back, next) {
  return h(
    "div",
    { class: "step-foot" },
    back ? h("button", { class: "btn", type: "button", text: `Back: ${back.label}`, onclick: () => goTab(back.tab) }) : null,
    h("span", { class: "spacer" }),
    next ? h("button", { class: "btn btn-primary", type: "button", text: `Next: ${next.label}`, onclick: () => goTab(next.tab) }) : null,
  );
}

function card(title, lead, ...children) {
  return h(
    "section",
    { class: "card" },
    title || lead ? h("div", { class: "card-head" }, title ? h("h3", { text: title }) : null, lead ? h("p", { text: lead }) : null) : null,
    ...children,
  );
}

/** Display a stored number in an input without float noise (0.005 × 1000 → "5"). */
function inputText(v, scale = 1) {
  if (!isNum(v)) return "";
  return String(+(v * scale).toPrecision(12));
}

function goTab(name) {
  if (location.hash !== `#${name}`) location.hash = name;
  else showTab(name);
  window.scrollTo({ top: 0 });
}

/**
 * Ask before replacing data. Resolves on the button press itself (the form's
 * submit event) rather than on the dialog's close event, which a browser may
 * hold back while the page is in a hidden tab or pane.
 */
function confirmDialog({ title, body, ok }) {
  const dlg = $("#confirm-dialog");
  $("#confirm-title").textContent = title;
  $("#confirm-body").textContent = body;
  $("#confirm-ok").textContent = ok;
  return dialogChoice(dlg).then((value) => value === "ok");
}

/** The value of the button that closed a <form method="dialog"> dialog ("" for Escape). */
function dialogChoice(dlg) {
  const form = dlg.querySelector("form");
  return new Promise((resolve) => {
    const done = (value) => {
      form.removeEventListener("submit", onSubmit);
      dlg.removeEventListener("cancel", onCancel);
      resolve(value);
    };
    const onSubmit = (e) => done(e.submitter?.value || "");
    const onCancel = () => done("");
    form.addEventListener("submit", onSubmit);
    dlg.addEventListener("cancel", onCancel);
    dlg.returnValue = "";
    dlg.showModal();
  });
}

// ---------------------------------------------------------------------------
// Compute + render loop

function recompute() {
  const p = state.project;
  const wb = E.computeWaterBalance(p);
  const rec = E.computeRecession(p.readings, {
    gaugeCtf: E.gaugeCtfCm(p.params),
    evaporationCm: isNum(p.params.evaporation) ? p.params.evaporation * 100 : NaN,
    ...p.recession,
  });
  const sens = wb.ok ? E.runSensitivity(p, wb) : [];
  state.results = { wb, rec, sens };
  if (wb.ok) {
    const n = wb.days.length;
    if (!isNum(state.day) || state.day >= n) {
      let best = 0;
      wb.days.forEach((d, i) => {
        if (d.level > wb.days[best].level) best = i;
      });
      state.day = best;
    }
  }
}

let updateTimer = null;
/** Inputs changed: recalculate and refresh everything that shows results. */
function update({ immediate = false, readingsGrid = false } = {}) {
  state.isExample = false;
  clearTimeout(updateTimer);
  const run = () => {
    recompute();
    renderAll({ readingsGrid });
    saveSoon();
    announceSetup();
  };
  if (immediate) run();
  else updateTimer = setTimeout(run, 180);
}

function renderAll({ readingsGrid = false } = {}) {
  $("#site-name").value = state.project.site?.name || "";
  document.title = state.project.site?.name ? `${state.project.site.name} · CheckDamCal` : "CheckDamCal";
  renderStatus();
  updateDam();
  updateSurvey();
  if (readingsGrid) renderReadingsGrid();
  updateReadingsDerived();
  updateBalance();
  updateRecession();
  updateReport();
  if (state.tab === "learn") ui.learn?.update();
  announceState();
}

/** Problems from the engine, grouped by the step that fixes them. */
function problemsBy(area) {
  return (state.results.wb.problems || []).filter((q) => q.area === area);
}
function pendingChecks() {
  const { wb } = state.results;
  return wb.ok ? wb.days.filter((d, i) => d.qaSuggestedLevel != null && state.project.readings[i]?.level == null).length : 0;
}

/** The status bar says what to do next; Advanced also shows the headline numbers. */
function renderStatus() {
  const { wb, rec } = state.results;
  const host = $("#status");
  const dam = problemsBy("dam");
  const survey = problemsBy("survey");
  const readings = problemsBy("readings");
  const checks = pendingChecks();

  // States: done ✓, "check" (amber: readings worth a second look), "problem"
  // (red: something entered is wrong), or no state (plain number: not filled
  // in yet — not an error, just the next thing to do).
  const surveyStarted = state.project.stage.some((r) => r && isNum(r.rl));
  setStepState("dam", dam.length ? null : "done", dam.length ? `${dam.length} to fill in` : "complete");
  setStepState("survey", survey.length ? (surveyStarted ? "problem" : null) : "done", survey.length ? (surveyStarted ? "to fix" : "to fill in") : "complete");
  setStepState(
    "readings",
    !state.project.readings.length ? null : readings.length ? "problem" : checks ? "check" : "done",
    !state.project.readings.length ? "to fill in" : readings.length ? `${readings.length} to fix` : checks ? `${checks} to check` : "complete",
  );
  setStepState("balance", wb.ok ? "done" : null, wb.ok ? "ready" : "not ready yet");
  setStepState("recession", rec.ok && rec.runs?.length ? "done" : null, rec.ok && rec.runs?.length ? "ready" : "not ready yet");
  setStepState("report", wb.ok ? "done" : null, wb.ok ? "ready to download" : "not ready yet");

  const go = (tab, label) => h("button", { class: "btn-link", type: "button", text: label, onclick: () => goTab(tab) });
  const line = (...children) => h("div", { class: "status-next" }, ...children);
  if (!wb.ok) {
    let msg;
    if (dam.length) msg = line(h("strong", { text: "Next: " }), "enter your check dam’s levels in Step 1.", go("dam", "Go to Step 1"));
    else if (survey.length) msg = line(h("strong", { text: "Next: " }), "enter the pond survey in Step 2.", go("survey", "Go to Step 2"));
    else if (!state.project.readings.length) msg = line(h("strong", { text: "Next: " }), "add your daily readings in Step 3.", go("readings", "Go to Step 3"));
    else msg = line(h("strong", { text: `Step 3 has ${readings.length} problem${readings.length === 1 ? "" : "s"} to fix. ` }), go("readings", "Go to Step 3"));
    host.replaceChildren(msg);
    return;
  }
  const t = wb.totals;
  const parts = [
    h(
      "span",
      { class: "status-ok" },
      h("strong", { text: `${F.num(t.rechargeWithEnd)} m³` }),
      ` soaked into the ground (${F.pct(wb.ratios.rechargeToInflow)} of the water that flowed in).`,
    ),
  ];
  if (state.tab !== "balance") parts.push(go("balance", "See the results"));
  if (state.tab !== "report") parts.push(go("report", "Get the PDF report"));
  if (checks && state.tab !== "readings") parts.push(h("span", { text: `${checks} reading${checks === 1 ? "" : "s"} to check in Step 3.` }));
  if (state.mode === "advanced") {
    parts.push(
      h(
        "span",
        { class: "muted" },
        `Inflow ${F.num(t.inflow)} m³ · spill ${F.num(t.spill)} m³ · dry-weather infiltration ${F.num(wb.mdwir * 1000, 1)} mm/day`,
        rec.ok && rec.pooled ? ` · from recessions ${F.num(rec.pooled.infiltrationMm, 1)} mm/day` : "",
      ),
    );
  }
  host.replaceChildren(line(...parts));
}

function setStepState(tab, st, label) {
  const btn = $(`#tab-${tab}`);
  if (!btn) return;
  if (st) btn.dataset.state = st;
  else delete btn.dataset.state;
  const n = btn.querySelector(".step-n");
  const num = { dam: "1", survey: "2", readings: "3", balance: "4", recession: "5" }[tab];
  // The report's marker is a document icon, not a number: its state shows as colour only.
  if (n && num) n.textContent = st === "done" ? "✓" : st === "problem" || st === "check" ? "!" : num;
  btn.setAttribute("aria-label", `${STEP_NAME[tab]}, ${label}`);
}

// ---------------------------------------------------------------------------
// Tabs / steps

function tabFromHash() {
  const t = location.hash.replace("#", "");
  if (t === "method") return "learn";
  return TABS.includes(t) ? t : null;
}

function showTab(name) {
  state.tab = name;
  for (const t of TABS) {
    const on = t === name;
    $(`#tab-${t}`).setAttribute("aria-selected", String(on));
    $(`#tab-${t}`).tabIndex = on ? 0 : -1;
    $(`#panel-${t}`).hidden = !on;
  }
  // On a phone the step strip scrolls sideways: keep the current step in view.
  const strip = $(".tabs");
  const btn = $(`#tab-${name}`);
  if (btn.offsetLeft < strip.scrollLeft || btn.offsetLeft + btn.offsetWidth > strip.scrollLeft + strip.clientWidth) {
    strip.scrollLeft = btn.offsetLeft - (strip.clientWidth - btn.offsetWidth) / 2;
  }
  setPref({ tab: name });
  if (name === "balance") renderDay();
  if (name === "start") drawExplainer(ui.explainerHost);
  if (name === "dam") renderDamDiagram();
  if (name === "learn") ui.learn?.update();
  else ui.learn?.stop();
  if (state.results) renderStatus();
  stopPlay();
  announceState();
  if (FOCUS) window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------------
// Start here

function buildStart() {
  const panel = $("#panel-start");
  ui.notices_start = h("div", { class: "notices" });
  ui.explainerHost = h("div", { class: "explainer-host" });
  new ResizeObserver(() => state.tab === "start" && drawExplainer(ui.explainerHost)).observe(ui.explainerHost);

  const ex = state.example;
  const need = h(
    "ol",
    { class: "order-list" },
    h(
      "li",
      {},
      h("h4", {}, "Your check dam’s levels ", h("span", { class: "when", text: "· measured once" })),
      h("p", { text: "The height of the gauge board’s 0 cm mark, the height of the spillway (where water flows over the dam) and the spillway’s length." }),
      h("p", { class: "why" }, h("strong", { text: "Why first: " }), "they turn a gauge reading in centimetres into a water level, and tell the calculator when the dam overflows."),
    ),
    h(
      "li",
      {},
      h("h4", {}, "A survey of the pond ", h("span", { class: "when", text: "· measured once" })),
      h("p", { text: "The area of the water surface at several levels, from the lowest point of the pond up past the spillway, for example from a dumpy-level survey." }),
      h("p", { class: "why" }, h("strong", { text: "Why: " }), "it turns a water level into a volume of water, so each day’s level tells us how much water the pond holds."),
    ),
    h(
      "li",
      {},
      h("h4", {}, "Daily readings ", h("span", { class: "when", text: "· every day of the season" })),
      h("p", { text: "The gauge-board reading in centimetres and the rainfall in millimetres." }),
      h("p", { class: "why" }, h("strong", { text: "Why: " }), "a rise after rain shows water flowing in; a fall on a dry day shows water soaking into the ground or evaporating."),
    ),
  );

  const get = (_color, title, text, example) =>
    h("div", { class: "get-item" }, h("h4", { text: title }), h("p", { text }), example ? h("p", { class: "ex", text: example }) : null);
  const getGrid = h(
    "div",
    { class: "get-grid" },
    get(
      "var(--c-recharge)",
      "Water that soaked into the ground",
      "Groundwater recharge, in cubic metres: the benefit of the check dam.",
      ex ? `Badgaon 2014: ${F.num(ex.wb.totals.rechargeWithEnd)} m³, ${F.pct(ex.wb.ratios.rechargeToInflow)} of what flowed in.` : "",
    ),
    get(
      "var(--c-evap)",
      "Where the rest went",
      "How much evaporated and how much spilled over the dam.",
      ex ? `Badgaon 2014: ${F.pct(ex.wb.totals.evaporationWithEnd / ex.wb.totals.inflow)} evaporated, ${F.pct(ex.wb.totals.spill / ex.wb.totals.inflow)} spilled.` : "",
    ),
    get(
      "var(--c-water)",
      "How fast water soaks in",
      "The infiltration rate, in millimetres per day, from the dry spells.",
      ex ? `Badgaon 2014: ${F.num(ex.wb.mdwir * 1000, 1)} mm per day.` : "",
    ),
    get("var(--c-spill)", "The season in charts", "Rain, water level and running totals day by day, and a spreadsheet of every number to download.", ""),
  );

  panel.append(
    ui.notices_start,
    h(
      "div",
      { class: "start-hero" },
      h("h2", { text: "How much water did your check dam put into the ground?" }),
      h("p", {
        text: "A check dam holds back the water that runs down a stream after rain. That water then does one of three things: it soaks into the ground and refills the groundwater that wells draw on, it evaporates into the air, or it spills over the top of the dam. CheckDamCal works out how much went each way, from readings you take at the dam.",
      }),
    ),
    waysIn(),
    h(
      "div",
      { class: "stack" },
      card(null, null, ui.explainerHost),
      h(
        "div",
        { class: "grid-2" },
        card(
          "What you need, in this order",
          null,
          need,
          h("p", { class: "muted", style: "margin-top:14px;font-size:14px", text: "The results appear by themselves once all three are in." }),
        ),
        card(
          "What you get",
          null,
          getGrid,
          h("p", {
            class: "muted",
            style: "margin-top:12px;font-size:13.5px",
            text: "Easy view keeps to the essentials. Switch to Advanced at the top for every setting and table from the original spreadsheet.",
          }),
        ),
      ),
      formatCard(),
    ),
  );
}

/** The two ways in: a file straight to the report, or the steps one by one. */
function waysIn() {
  const fromFile = h(
    "section",
    { class: "way way-file", "aria-labelledby": "way-file-title" },
    h("h3", { id: "way-file-title", text: "Have the data in a file? Get the report." }),
    h("p", {
      text: "Open the MyCheckDam spreadsheet, a filled-in CheckDamCal template or a saved project. The results and a PDF report are ready as soon as the file is read. The file stays on this device.",
    }),
    h(
      "div",
      { class: "drop-zone" },
      h("span", { class: "drop-hint", text: "Drop the file here, or" }),
      h("button", { class: "btn btn-primary", type: "button", text: "Choose a file", onclick: () => $("#file-input").click() }),
    ),
    h(
      "p",
      { class: "way-foot" },
      "No file yet? Start from the ",
      h("a", { href: `${EXAMPLES}checkdamcal-template.xlsx`, download: "", text: "blank template" }),
      ", or try ",
      h("a", { href: `${EXAMPLES}checkdamcal-badgaon-2014.xlsx`, download: "", text: "the example file" }),
      ".",
    ),
  );
  const bySteps = h(
    "section",
    { class: "way way-steps", "aria-labelledby": "way-steps-title" },
    h("h3", { id: "way-steps-title", text: "Or enter it step by step" }),
    h("p", {
      text: "Type in your check dam’s levels, the pond survey and the daily readings. Each step says what it needs and why, and the results build up as you go.",
    }),
    h(
      "div",
      { class: "way-actions" },
      h("button", { class: "btn", type: "button", text: "Start with my own check dam", onclick: () => menuAction("new-site") }),
      h("button", { class: "btn", type: "button", text: "Walk through the example", onclick: walkExample }),
    ),
    h("p", { class: "way-foot" }, "New to this? ", learnLink(1, "See how it works, one picture at a time")),
  );
  return h("div", { class: "ways" }, fromFile, bySteps);
}

/** A small table of example rows; numCols are right-aligned (default: all but the first). */
function miniTable(headers, rows, more, numCols) {
  const isNumCol = (i) => (numCols ? numCols.includes(i) : i > 0);
  return h(
    "div",
    { class: "table-scroll" },
    h(
      "table",
      { class: "data-table" },
      h("thead", {}, h("tr", {}, headers.map((c, i) => h("th", { class: isNumCol(i) ? "num" : "", text: c })))),
      h(
        "tbody",
        {},
        rows.map((r) => h("tr", {}, r.map((c, i) => h("td", { class: isNumCol(i) ? "num" : "", text: c == null ? "" : String(c) })))),
        more ? h("tr", {}, h("td", { class: "muted", colspan: String(headers.length), text: more })) : null,
      ),
    ),
  );
}

const EXAMPLES = "examples/";
const fileLink = (href, label) => h("a", { class: "btn btn-sm", href, download: "", text: label });

/** "What to import": the three tables, with real example rows and files. */
function formatCard() {
  const ex = badgaonExample();
  const p = ex.params;
  return h(
    "section",
    { class: "card", id: "data-formats" },
    h(
      "div",
      { class: "card-head" },
      h("h3", { text: "Your data: what to import" }),
      h("p", { text: "Type it in, or import a file. The easiest is the template: one workbook with three sheets, one for each kind of data." }),
    ),
    h(
      "div",
      { class: "format-grid" },
      h(
        "div",
        { class: "format-item" },
        h("h4", { text: "1 · Check dam (measured once)" }),
        h("p", { text: "Sheet “Check dam”: one row per item. Heights in metres from the same reference point." }),
        miniTable(["Item", "Value", "Unit"], [
          ["Gauge zero level", p.gaugeZeroRl, "m"],
          ["Spillway level", p.ctfRl, "m"],
          ["Spillway length", p.weirLength, "m"],
          ["Evaporation", p.evaporation * 1000, "mm/day"],
          ["Catchment area", p.catchmentHa, "ha"],
        ], null, [1]),
        h("div", { class: "downloads" }, fileLink(`${EXAMPLES}badgaon-2014-check-dam.csv`, "Example (.csv)")),
      ),
      h(
        "div",
        { class: "format-item" },
        h("h4", { text: "2 · Pond survey (measured once)" }),
        h("p", { text: "Sheet “Pond survey”: the water area at each level, from the lowest point (area 0) to above the spillway. Volume is optional." }),
        miniTable(["Level (m)", "Water area (m²)", "Volume (m³)"], ex.stage.slice(0, 4).map((r) => [r.rl, F.trim(r.area, 1), F.trim(r.volume, 1)]), `… ${ex.stage.length} levels in all`),
        h("div", { class: "downloads" }, fileLink(`${EXAMPLES}badgaon-2014-pond-survey.csv`, "Example (.csv)")),
      ),
      h(
        "div",
        { class: "format-item" },
        h("h4", { text: "3 · Daily readings (every day)" }),
        h("p", { text: "Sheet “Daily readings”: one row per day, no gaps. Leave rainfall blank on dry days." }),
        miniTable(["Date", "Gauge reading (cm)", "Rainfall (mm)"], ex.readings.slice(0, 5).map((r) => [r.date, r.gauge, r.rain]), `… ${ex.readings.length} days in all`),
        h("div", { class: "downloads" }, fileLink(`${EXAMPLES}badgaon-2014-daily-readings.csv`, "Example (.csv)")),
      ),
    ),
    h(
      "div",
      { class: "downloads" },
      h("a", { class: "btn btn-sm btn-primary", href: `${EXAMPLES}checkdamcal-template.xlsx`, download: "", text: "Blank template (.xlsx)" }),
      fileLink(`${EXAMPLES}checkdamcal-badgaon-2014.xlsx`, "Template filled with the Badgaon example (.xlsx)"),
    ),
    h(
      "ul",
      { class: "muted", style: "font-size:13.5px;margin:14px 0 0;padding-left:20px;display:grid;gap:4px" },
      h("li", { text: "Dates like 2014-07-16 or 16/07/2014. Numbers without units in the cells: the units are in the column names." }),
      h("li", { text: "A missed day: keep its row and leave the gauge blank; the level is filled in from the days either side." }),
      h("li", { text: "A reading you know is wrong: type the correct level in metres in an optional “Level override (m)” column." }),
      h("li", { text: "Already using the MyCheckDam spreadsheet? Import it as it is: every sheet is read." }),
    ),
  );
}

function walkExample() {
  if (!state.isExample) {
    if (state.project.readings.length) {
      confirmDialog({
        title: "Load the Badgaon example?",
        body: "It replaces the check dam, survey and readings on this device. Save your project first (More → Save project) if you want to keep it.",
        ok: "Load example",
      }).then((ok) => ok && (loadExample(), goTab("dam")));
      return;
    }
    loadExample();
  }
  goTab("dam");
}

// ---------------------------------------------------------------------------
// Step 1 · Your check dam

const ESSENTIAL_FIELDS = [
  {
    key: "gaugeZeroRl",
    label: "Level of the gauge board’s 0 cm mark",
    unit: "m",
    help: "Find the zero on the measuring staff in the pond and give its height.",
    placeholder: "e.g. 98.43",
  },
  {
    key: "ctfRl",
    label: "Level of the spillway",
    unit: "m",
    help: "The top of the overflow section. When the water is higher, it spills over the dam.",
    placeholder: "e.g. 100",
  },
  { key: "weirLength", label: "Length of the spillway", unit: "m", help: "How wide the overflow section is, across the stream.", min: 0, placeholder: "e.g. 12.7" },
];
const ADVANCED_FIELDS = [
  { key: "weirCoefficient", label: "Weir coefficient C₁", unit: "", help: "Spill Q = C₁ · L₁ · H^a₁ in m³/s. The workbook uses 1.6.", min: 0 },
  { key: "weirExponent", label: "Weir exponent a₁", unit: "", help: "1.5 for a broad-crested weir.", min: 0 },
];

function numberField({ key, label, unit, help, scale = 1, min, positive, optional, placeholder, get, set }) {
  const id = `f-${key}`;
  const err = h("div", { class: "field-error", hidden: true });
  const input = h("input", { id, type: "text", inputmode: "decimal", autocomplete: "off", value: inputText(get(), scale), placeholder: placeholder || "" });
  const wrap = unit ? h("div", { class: "input-unit" }, input, h("span", { class: "u", text: unit })) : input;
  const helpEl = h("div", { class: "help", text: help || "" });
  input.addEventListener("input", () => {
    const v = F.parseNum(input.value);
    let msg = "";
    if (v == null && !optional) msg = "Enter a number.";
    else if (Number.isNaN(v)) msg = "That isn’t a number.";
    else if (v != null && positive && !(v > 0)) msg = "Must be more than 0.";
    else if (v != null && isNum(min) && v < min) msg = `Must be ${min} or more.`;
    err.textContent = msg;
    err.hidden = !msg;
    (unit ? wrap : input).classList.toggle("invalid", !!msg);
    if (!msg || (v == null && !optional)) {
      set(v == null ? null : v / scale);
      update();
    }
  });
  ui[`field_${key}`] = { input, helpEl, scale, get };
  return h("div", { class: "field" }, h("label", { for: id, text: label }), wrap, helpEl, err);
}

function buildDam() {
  const panel = $("#panel-dam");
  ui.notices_dam = h("div", { class: "notices" });
  const P = () => state.project.params;

  const essentials = h(
    "div",
    { class: "field-stack" },
    ESSENTIAL_FIELDS.map((f) => numberField({ ...f, get: () => P()[f.key], set: (v) => (P()[f.key] = v) })),
    numberField({
      key: "evaporation",
      label: "Evaporation",
      unit: "mm per day",
      help: "Water lost to the air from the pond each day. The Badgaon example uses 5 mm per day.",
      scale: 1000,
      min: 0,
      placeholder: "e.g. 5",
      get: () => P().evaporation,
      set: (v) => (P().evaporation = v),
    }),
    numberField({
      key: "catchmentHa",
      label: "Catchment area (optional)",
      unit: "hectares",
      help: "The land that drains into the check dam. Only used to show how much of the rain reached the dam.",
      min: 0,
      optional: true,
      placeholder: "e.g. 338",
      get: () => P().catchmentHa,
      set: (v) => (P().catchmentHa = v),
    }),
    h("div", { class: "adv form-grid" }, ADVANCED_FIELDS.map((f) => numberField({ ...f, get: () => P()[f.key], set: (v) => (P()[f.key] = v) }))),
  );
  ui.damDiagram = h("div", { class: "section-host" });
  ui.damDiagramCaption = h("p", { class: "diagram-caption" });
  new ResizeObserver(() => state.tab === "dam" && renderDamDiagram()).observe(ui.damDiagram);

  // Advanced: the workbook's assumptions.
  const rateInput = h("input", { type: "text", inputmode: "decimal", "aria-label": "Fixed infiltration rate in mm per day" });
  const rateBox = h("span", { class: "input-unit inline-input" }, rateInput, h("span", { class: "u", text: "mm/day" }));
  const rateChoices = [
    ["seasonMean", "Season mean dry-weather rate", "As in the workbook (cell M10)."],
    ["periodMean", "Mean rate of each period", "Uses the periods below."],
    ["fixed", "A fixed rate", ""],
  ].map(([value, label, help]) =>
    h(
      "label",
      { class: "choice" },
      h("input", { type: "radio", name: "wetDayRate", value }),
      h("span", {}, label, help ? h("span", { class: "help", text: help }) : null, value === "fixed" ? rateBox : null),
    ),
  );
  const rateSet = h("fieldset", {}, h("legend", { text: "Infiltration on days above the spillway or with a rising level" }), rateChoices);
  rateSet.addEventListener("change", (e) => {
    if (e.target.name !== "wetDayRate") return;
    P().wetDayRate = e.target.value;
    if (e.target.value === "fixed" && !isNum(P().wetDayRateValue)) {
      P().wetDayRateValue = state.results?.wb?.mdwir ?? 0.03;
      rateInput.value = inputText(P().wetDayRateValue, 1000);
    }
    update({ immediate: true });
  });
  rateInput.addEventListener("input", () => {
    const v = F.parseNum(rateInput.value);
    rateBox.classList.toggle("invalid", !(isNum(v) && v >= 0));
    if (isNum(v) && v >= 0) {
      P().wetDayRateValue = v / 1000;
      P().wetDayRate = "fixed";
      rateSet.querySelector('input[value="fixed"]').checked = true;
      update();
    }
  });

  const initInput = h("input", { type: "text", inputmode: "decimal", "aria-label": "Water level the day before the first reading, m" });
  const initBox = h("span", { class: "input-unit inline-input" }, initInput, h("span", { class: "u", text: "m" }));
  const initSet = h(
    "fieldset",
    {},
    h("legend", { text: "Water in the check dam before the first day" }),
    h("label", { class: "choice" }, h("input", { type: "radio", name: "initial", value: "empty" }), h("span", {}, "None — it was empty", h("span", { class: "help", text: "As in the workbook." }))),
    h("label", { class: "choice" }, h("input", { type: "radio", name: "initial", value: "level" }), h("span", {}, "Water at this level on the day before", initBox)),
  );
  initSet.addEventListener("change", (e) => {
    if (e.target.name !== "initial") return;
    if (e.target.value === "empty") P().initialLevel = null;
    else {
      const v = F.parseNum(initInput.value);
      P().initialLevel = isNum(v) ? v : P().gaugeZeroRl;
      initInput.value = inputText(P().initialLevel);
    }
    update({ immediate: true });
  });
  initInput.addEventListener("input", () => {
    const v = F.parseNum(initInput.value);
    initBox.classList.toggle("invalid", !isNum(v));
    if (isNum(v)) {
      P().initialLevel = v;
      initSet.querySelector('input[value="level"]').checked = true;
      update();
    }
  });

  const splitBox = h("input", { type: "checkbox", id: "f-split" });
  splitBox.addEventListener("change", () => {
    P().splitRemaining = splitBox.checked;
    update({ immediate: true });
  });
  const splitField = h(
    "label",
    { class: "choice", for: "f-split" },
    splitBox,
    h("span", {}, "Share the water left on the last day between recharge and evaporation", h("span", { class: "help", text: "In proportion to their rates, as in the workbook (cells AH131–AJ135)." })),
  );

  ui.periodChips = h("div", { class: "chips" });
  const periodsField = h(
    "div",
    { class: "field" },
    h("span", { class: "label", text: "Infiltration periods" }),
    h("div", { class: "help", text: "Split the season to see how the dry-weather infiltration rate changes. The first period starts on the first day; add the start date of each later period." }),
    ui.periodChips,
  );
  ui.rateSet = rateSet;
  ui.rateInput = rateInput;
  ui.initSet = initSet;
  ui.initInput = initInput;
  ui.splitBox = splitBox;

  panel.append(
    stepHead({
      kicker: "Step 1 of 4",
      title: "Your check dam",
      why: "These few numbers let the calculator turn a gauge reading into a water level, and know when water is spilling over the dam. You measure them once.",
      need: "the heights of the gauge board’s zero and of the spillway, measured from the same reference point, for example with a dumpy level. Any reference works: the Badgaon example calls the spillway 100 m.",
      lesson: { n: 0, label: "Learn how a gauge reading becomes a water level (Lesson 1)" },
    }),
    ui.notices_dam,
    h(
      "div",
      { class: "stack" },
      card(null, null, h("div", { class: "dam-layout" }, essentials, h("div", {}, ui.damDiagram, ui.damDiagramCaption))),
      h(
        "section",
        { class: "card adv" },
        h("div", { class: "card-head" }, h("h3", { text: "Assumptions" }), h("p", { text: "The workbook’s choices, kept as its defaults." })),
        h("div", { class: "stack" }, rateSet, initSet, splitField, periodsField),
      ),
    ),
    stepFoot({ tab: "start", label: "Start here" }, { tab: "survey", label: "Pond survey" }),
  );
}

function renderDamDiagram() {
  if (!ui.damDiagram || state.tab !== "dam") return;
  const p = E.normaliseParams(state.project.params);
  const hasLevels = isNum(p.gaugeZeroRl) && isNum(p.ctfRl) && p.ctfRl > p.gaugeZeroRl;
  const table = E.buildStageTable(state.project.stage);
  const useSurvey = hasLevels && !table.errors.length;
  const stage = useSurvey ? table : diagramStage(p);
  const gz = hasLevels ? p.gaugeZeroRl : stage.rows[1].rl;
  const ctf = hasLevels ? p.ctfRl : stage.rows[3].rl;
  drawSection(ui.damDiagram, {
    stage,
    params: { gaugeZeroRl: gz, ctfRl: ctf },
    level: gz + (ctf - gz) * 0.6,
    levelMax: ctf,
    gauge: 1,
    spill: 0,
    diagram: true,
    numbers: hasLevels,
  });
  ui.damDiagramCaption.textContent = useSurvey
    ? "Section through your check dam, drawn from your levels and pond survey. Not to scale across."
    : "Where the two levels are. The pond’s shape is illustrative until you enter the survey in Step 2.";
}

function updateDam() {
  const p = state.project.params;
  for (const key of [...ESSENTIAL_FIELDS, ...ADVANCED_FIELDS].map((f) => f.key).concat(["evaporation", "catchmentHa"])) {
    const ref = ui[`field_${key}`];
    if (ref && document.activeElement !== ref.input) ref.input.value = inputText(ref.get(), ref.scale);
  }
  const ctfCm = E.gaugeCtfCm(p);
  ui.field_ctfRl.helpEl.textContent = `The top of the overflow section. When the water is higher, it spills over the dam.${isNum(ctfCm) ? ` On your gauge board that is ${F.trim(ctfCm, 1)} cm.` : ""}`;
  ui.rateSet.querySelector(`input[value="${p.wetDayRate}"]`).checked = true;
  if (document.activeElement !== ui.rateInput) ui.rateInput.value = inputText(p.wetDayRateValue, 1000);
  if (!isNum(p.wetDayRateValue) && state.results.wb.ok) ui.rateInput.placeholder = F.num(state.results.wb.mdwir * 1000, 1);
  ui.initSet.querySelector(`input[value="${isNum(p.initialLevel) ? "level" : "empty"}"]`).checked = true;
  if (document.activeElement !== ui.initInput) ui.initInput.value = inputText(p.initialLevel);
  ui.splitBox.checked = !!p.splitRemaining;
  renderPeriodChips();
  const dam = problemsBy("dam");
  renderNotices(
    "dam",
    (ui.noticeExtra_dam = dam.length && state.project.readings.length ? [notice("warn", "Still to fill in:", h("ul", {}, dam.map((q) => h("li", { text: q.text }))))] : []),
  );
  renderDamDiagram();
}

function renderPeriodChips() {
  const p = state.project.params;
  if (ui.periodChips.contains(document.activeElement)) return;
  const starts = p.periodStarts || [];
  ui.periodChips.replaceChildren(
    ...starts.map((d, i) =>
      h(
        "span",
        { class: "chip" },
        h("input", {
          type: "date",
          value: d,
          "aria-label": `Start of period ${i + 2}`,
          onchange: (e) => {
            const v = e.target.value;
            if (v) p.periodStarts[i] = v;
            p.periodStarts.sort();
            update({ immediate: true });
          },
        }),
        h("button", {
          type: "button",
          "aria-label": `Remove period starting ${F.date(d)}`,
          text: "×",
          onclick: () => {
            p.periodStarts.splice(i, 1);
            update({ immediate: true });
          },
        }),
      ),
    ),
    h("button", {
      class: "btn btn-sm",
      type: "button",
      text: "Add period",
      onclick: () => {
        const days = state.project.readings.map((r) => r.date).filter(Boolean).sort();
        if (!days.length) return;
        const last = starts[starts.length - 1] || days[0];
        const next = E.isoFromDayNumber(Math.min(E.dayNumber(days[days.length - 1]), E.dayNumber(last) + 30));
        p.periodStarts = [...starts, next].sort();
        update({ immediate: true });
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Step 2 · Pond survey

function buildSurvey() {
  const panel = $("#panel-survey");
  ui.notices_survey = h("div", { class: "notices" });
  ui.stageBody = h("tbody");
  ui.stageErrors = h("div", { class: "notices" });
  const stageTable = h(
    "div",
    { class: "table-scroll" },
    h(
      "table",
      { class: "edit-table", style: "max-width:560px" },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          h("th", { text: "Water level (m)" }),
          h("th", { text: "Water area (m²)" }),
          h("th", { class: "adv", text: "Volume (m³)" }),
          h("th", { "aria-label": "Remove" }),
        ),
      ),
      ui.stageBody,
    ),
  );
  ui.stageBody.addEventListener("input", (e) => {
    const inp = e.target;
    const row = +inp.dataset.row;
    const field = inp.dataset.field;
    const v = F.parseNum(inp.value);
    inp.classList.toggle("invalid", Number.isNaN(v));
    if (Number.isNaN(v)) return;
    state.project.stage[row][field] = v;
    update();
  });
  ui.stageBody.addEventListener("click", (e) => {
    const b = e.target.closest("[data-del]");
    if (!b) return;
    state.project.stage.splice(+b.dataset.del, 1);
    renderStageRows();
    update({ immediate: true });
  });
  ui.stageBody.addEventListener("paste", (e) => onGridPaste(e, "stage"));
  const stageActions = h(
    "div",
    { class: "toolbar", style: "margin-top:10px" },
    h("button", {
      class: "btn btn-sm",
      type: "button",
      text: "Add a level",
      onclick: () => {
        const last = state.project.stage[state.project.stage.length - 1];
        state.project.stage.push({ rl: last && isNum(last.rl) ? +(last.rl + 0.5).toFixed(3) : null, area: null, volume: null });
        renderStageRows();
        const inputs = ui.stageBody.querySelectorAll('input[data-field="area"]');
        inputs[inputs.length - 1]?.focus();
      },
    }),
    h("span", { class: "toolbar-note", text: "Tip: copy the columns from a spreadsheet and paste them into the first box." }),
  );
  ui.areaChart = new XYChart(h("div"), { title: "Water area at each level" });
  ui.volumeChart = new XYChart(h("div"), { title: "Water stored at each level" });
  panel.append(
    stepHead({
      kicker: "Step 2 of 4",
      title: "Pond survey",
      why: "The survey tells the calculator how much water the pond holds at each level. With it, every day’s water level becomes a volume of water.",
      need: "the area of the water surface at several levels, from the lowest point of the pond (area 0) up to a little above the spillway. A dumpy-level survey done once, in the dry season, is enough.",
      lesson: { n: 1, label: "Learn how the survey turns a level into water (Lesson 2)" },
    }),
    ui.notices_survey,
    card(
      null,
      null,
      ui.stageErrors,
      h(
        "div",
        { class: "grid-2" },
        h(
          "div",
          {},
          stageTable,
          stageActions,
          h("p", {
            class: "muted",
            style: "font-size:13.5px;margin-top:10px",
            text: "Start with the lowest point, where the area is 0. Include a level above the spillway so days when the dam overflows are covered.",
          }),
          (ui.volumeNote = h("p", { class: "muted easy-only", style: "font-size:13.5px;margin-top:6px" })),
          h("p", { class: "muted adv", style: "font-size:13px;margin-top:6px", text: "Advanced: type a volume to use your own; leave it blank to calculate it (cone rule for the lowest step, trapezoids above)." }),
          h(
            "p",
            { class: "muted", style: "font-size:13.5px;margin-top:10px" },
            "Have the survey in a spreadsheet? Import it with columns “Level (m)” and “Water area (m²)”. ",
            h("a", { href: `${EXAMPLES}badgaon-2014-pond-survey.csv`, download: "", text: "Example file" }),
            " · ",
            h("a", { href: "#start", text: "All data formats" }),
          ),
        ),
        h("div", { class: "stack" }, ui.areaChart.root, ui.volumeChart.root),
      ),
    ),
    stepFoot({ tab: "dam", label: "Your check dam" }, { tab: "readings", label: "Daily readings" }),
  );
  renderStageRows();
}

function renderStageRows() {
  const rows = state.project.stage;
  ui.stageBody.replaceChildren(
    ...rows.map((r, i) =>
      h(
        "tr",
        {},
        h("td", {}, h("input", { type: "text", inputmode: "decimal", "data-row": i, "data-field": "rl", value: inputText(r.rl), "aria-label": `Water level, row ${i + 1}` })),
        h("td", {}, h("input", { type: "text", inputmode: "decimal", "data-row": i, "data-field": "area", value: inputText(r.area), "aria-label": `Water area, row ${i + 1}` })),
        h("td", { class: "adv" }, h("input", { type: "text", inputmode: "decimal", "data-row": i, "data-field": "volume", value: inputText(r.volume), "aria-label": `Volume, row ${i + 1}` })),
        h("td", {}, h("button", { class: "row-del", type: "button", "data-del": i, "aria-label": `Remove row ${i + 1}`, text: "×" })),
      ),
    ),
  );
}

function updateSurvey() {
  const p = state.project.params;
  const table = E.buildStageTable(state.project.stage);
  const hasAny = state.project.stage.some((r) => r && (isNum(r.rl) || isNum(r.area)));
  ui.stageErrors.replaceChildren(...(hasAny ? table.errors.map((m) => notice("error", null, m)) : []));
  // buildStageTable drops blank rows, so walk the inputs and the table together.
  const inputs = ui.stageBody.querySelectorAll('input[data-field="volume"]');
  let k = 0;
  state.project.stage.forEach((r, i) => {
    const filled = r && (isNum(r.rl) || isNum(r.area) || isNum(r.volume));
    const row = filled && !table.errors.length ? table.rows[k++] : null;
    if (inputs[i]) inputs[i].placeholder = row?.volumeComputed ? `${F.num(row.volume, 1)} (calculated)` : "";
  });
  const entered = state.project.stage.filter((r) => r && isNum(r.volume)).length;
  ui.volumeNote.textContent = entered
    ? `This survey also has ${entered} measured volume${entered === 1 ? "" : "s"}, which are used as given. Switch to Advanced to see or change them.`
    : "You only need the areas: the volume of water at each level is worked out from them.";
  const refLines = [];
  if (isNum(p.ctfRl)) refLines.push({ y: p.ctfRl, label: `Spillway ${F.trim(p.ctfRl, 2)} m` });
  if (isNum(p.gaugeZeroRl)) refLines.push({ y: p.gaugeZeroRl, label: `Gauge zero ${F.trim(p.gaugeZeroRl, 2)} m` });
  const common = {
    height: 230,
    refLines,
    color: "var(--c-water)",
    tooltipHeading: (pt) => `Water level ${F.num(pt.y, 2)} m`,
    emptyText: "The curve appears once the table has two or more levels with their areas.",
  };
  const rows = table.rows;
  ui.areaChart.update({
    ...common,
    title: "Water area at each level",
    unit: "m²",
    xLabel: "Water area (m²)",
    points: rows.map((r) => ({ x: r.area, y: r.rl })),
    tooltip: (pt) => [{ label: "water area", value: `${F.num(pt.x)} m²`, color: "var(--c-water)" }],
    tableColumns: [
      { label: "Water level (m)", value: (pt) => F.num(pt.y, 2), num: true },
      { label: "Water area (m²)", value: (pt) => F.num(pt.x), num: true },
    ],
  });
  ui.volumeChart.update({
    ...common,
    title: "Water stored at each level",
    unit: "m³",
    xLabel: "Water stored (m³)",
    points: rows.map((r) => ({ x: r.volume, y: r.rl, computed: r.volumeComputed })),
    note: rows.some((r) => r.volumeComputed) ? "Worked out from the areas. Hollow points are calculated volumes." : "",
    tooltip: (pt) => [{ label: pt.computed ? "stored (calculated)" : "stored", value: `${F.num(pt.x)} m³`, color: "var(--c-water)" }],
    tableColumns: [
      { label: "Water level (m)", value: (pt) => F.num(pt.y, 2), num: true },
      { label: "Water stored (m³)", value: (pt) => F.num(pt.x), num: true },
      { label: "Source", value: (pt) => (pt.computed ? "calculated" : "entered") },
    ],
  });
}

// ---------------------------------------------------------------------------
// Step 3 · Daily readings

const READING_FIELDS = ["date", "gauge", "rain", "level"];

function buildReadings() {
  const panel = $("#panel-readings");
  ui.notices_readings = h("div", { class: "notices" });
  ui.readingsSub = h("span", { class: "toolbar-note" });
  ui.checks = h("div");
  const checksCard = card("Checks on your readings", null, ui.checks);

  ui.gridBody = h("tbody");
  ui.gridBody.addEventListener("input", onGridInput);
  ui.gridBody.addEventListener("change", onGridChange);
  ui.gridBody.addEventListener("keydown", onGridKey);
  ui.gridBody.addEventListener("paste", (e) => onGridPaste(e, "readings"));
  ui.gridBody.addEventListener("click", onGridClick);
  const grid = h(
    "div",
    { class: "table-scroll tall" },
    h(
      "table",
      { class: "edit-table" },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          h("th", { class: "col-date", text: "Date" }),
          h("th", { class: "col-num", text: "Gauge reading (cm)" }),
          h("th", { class: "col-num", text: "Rainfall (mm)" }),
          h("th", { class: "col-num adv", text: "Level override (m)" }),
          h("th", { class: "num", text: "Water level (m)" }),
          h("th", { text: "Notes" }),
          h("th", { "aria-label": "Remove" }),
        ),
      ),
      ui.gridBody,
    ),
  );
  const toolbar = h(
    "div",
    { class: "toolbar" },
    h("button", { class: "btn btn-sm", type: "button", text: "Import a spreadsheet", onclick: () => $("#file-input").click() }),
    h("button", { class: "btn btn-sm", type: "button", text: "Paste readings", onclick: openPasteReadings }),
    h("button", { class: "btn btn-sm", type: "button", text: "Add a day", onclick: addDay }),
    h("button", { class: "btn btn-sm", type: "button", text: "Fill missing dates", onclick: fillMissingDates }),
    h("a", { class: "btn btn-sm btn-ghost", href: `${EXAMPLES}badgaon-2014-daily-readings.csv`, download: "", text: "Example file (.csv)" }),
    h("span", { class: "spacer" }),
    ui.readingsSub,
    h("button", {
      class: "btn btn-sm btn-ghost",
      type: "button",
      text: "Clear all",
      onclick: async () => {
        if (!state.project.readings.length) return;
        const ok = await confirmDialog({ title: "Clear all readings?", body: "This removes every daily reading from this site. The check dam and survey are kept.", ok: "Clear readings" });
        if (!ok) return;
        state.project.readings = [];
        update({ immediate: true, readingsGrid: true });
      },
    }),
  );
  const tableCard = card(
    null,
    null,
    toolbar,
    h("p", {
      class: "toolbar-note",
      style: "margin:-4px 0 10px",
      text: "Missed a day? Add the date and leave the gauge blank: the level is filled in from the days either side. The water level column shows what the calculator uses.",
    }),
    h("p", {
      class: "toolbar-note adv",
      style: "margin:-4px 0 10px",
      text: "Level override: type a level only to correct a reading or fill a gap.",
    }),
    grid,
  );
  panel.append(
    stepHead({
      kicker: "Step 3 of 4",
      title: "Daily readings",
      why: "The daily readings show what happened to the water. A rise after rain means water flowed in. A fall on a dry day means water soaked into the ground or evaporated.",
      need: "a row for every day of the season: the gauge-board reading in centimetres and the rainfall in millimetres. Leave the rainfall blank on dry days.",
      lesson: { n: 2, label: "Learn what the readings tell us about one day (Lesson 3)" },
    }),
    ui.notices_readings,
    h("div", { class: "stack" }, checksCard, tableCard),
    stepFoot({ tab: "survey", label: "Pond survey" }, { tab: "balance", label: "See the results" }),
  );
  renderReadingsGrid();
}

function renderReadingsGrid() {
  const rows = state.project.readings;
  ui.gridBody.replaceChildren(
    ...rows.map((r, i) =>
      h(
        "tr",
        { "data-row": i },
        h("td", {}, h("input", { type: "date", "data-row": i, "data-field": "date", value: r.date || "", "aria-label": `Date, row ${i + 1}` })),
        ...["gauge", "rain", "level"].map((f) =>
          h(
            "td",
            { class: f === "level" ? "adv" : "" },
            h("input", {
              type: "text",
              inputmode: "decimal",
              autocomplete: "off",
              "data-row": i,
              "data-field": f,
              value: inputText(r[f]),
              "aria-label": `${{ gauge: "Gauge reading in cm", rain: "Rainfall in mm", level: "Level override in m" }[f]}, ${F.date(r.date)}`,
            }),
          ),
        ),
        h("td", { class: "derived num" }),
        h("td", { class: "derived row-note" }),
        h("td", {}, h("button", { class: "row-del", type: "button", "data-del": i, "aria-label": `Remove ${F.date(r.date)}`, text: "×" })),
      ),
    ),
  );
}

function onGridInput(e) {
  const inp = e.target;
  const i = +inp.dataset.row;
  const field = inp.dataset.field;
  if (!field || field === "date") return;
  const v = F.parseNum(inp.value);
  const bad = Number.isNaN(v) || (field !== "level" && isNum(v) && v < 0);
  inp.classList.toggle("invalid", bad);
  if (bad) return;
  // Typing over a dry-day rule replaces it with a fixed level; clearing it
  // returns the day to its gauge reading.
  state.project.readings[i][field] = v;
  if (field === "level") inp.placeholder = "";
  update();
}

function onGridChange(e) {
  const inp = e.target;
  if (inp.dataset.field !== "date") return;
  const i = +inp.dataset.row;
  const v = inp.value;
  if (!v) {
    inp.classList.add("invalid");
    return;
  }
  inp.classList.remove("invalid");
  state.project.readings[i].date = v;
  sortReadings();
  update({ immediate: true, readingsGrid: true });
}

function onGridKey(e) {
  const inp = e.target;
  if (!inp.dataset?.field) return;
  let d = 0;
  if (e.key === "Enter" || (e.key === "ArrowDown" && inp.type !== "date")) d = 1;
  else if (e.key === "ArrowUp" && inp.type !== "date") d = -1;
  if (!d) return;
  e.preventDefault();
  const next = ui.gridBody.querySelector(`input[data-row="${+inp.dataset.row + d}"][data-field="${inp.dataset.field}"]`);
  next?.focus();
  next?.select?.();
}

function onGridClick(e) {
  const del = e.target.closest("[data-del]");
  if (del && ui.gridBody.contains(del)) {
    state.project.readings.splice(+del.dataset.del, 1);
    update({ immediate: true, readingsGrid: true });
    return;
  }
  const use = e.target.closest("[data-use-level]");
  if (use) {
    // Apply the dry-day rule rather than a frozen number, as the workbook's
    // D = AC formula does, so the level follows any change in evaporation.
    const i = +use.dataset.useLevel;
    state.project.readings[i].level = E.DRY_DAY_RULE;
    const inp = ui.gridBody.querySelector(`input[data-row="${i}"][data-field="level"]`);
    if (inp) inp.value = "";
    update({ immediate: true });
    return;
  }
  const clear = e.target.closest("[data-clear-level]");
  if (clear) {
    state.project.readings[+clear.dataset.clearLevel].level = null;
    update({ immediate: true });
  }
}

/** Paste a block of cells from a spreadsheet, starting at the focused cell. */
function onGridPaste(e, target) {
  const inp = e.target;
  if (!inp.dataset?.field) return;
  const text = e.clipboardData?.getData("text/plain") ?? "";
  if (!/[\t\n]/.test(text.trim())) return; // a single value: let the input handle it
  e.preventDefault();
  const matrix = text
    .replace(/\r/g, "")
    .split("\n")
    .filter((l, i, a) => l.trim() !== "" || i < a.length - 1)
    .map((l) => l.split("\t"));
  const r0 = +inp.dataset.row;
  if (target === "stage") {
    const fields = ["rl", "area", "volume"];
    const c0 = fields.indexOf(inp.dataset.field);
    let written = 0; // rows written so far — a skipped header row doesn't count
    matrix.forEach((cells, k) => {
      if (cells.every((c) => c.trim() === "")) return;
      const nums = cells.map(F.parseNum);
      if (k === 0 && nums.every((v) => !isNum(v))) return; // header row
      const row = (state.project.stage[r0 + written] ||= { rl: null, area: null, volume: null });
      written += 1;
      cells.forEach((_, j) => {
        const f = fields[c0 + j];
        if (f && !Number.isNaN(nums[j])) row[f] = nums[j];
      });
    });
    renderStageRows();
    update({ immediate: true });
    return;
  }
  const c0 = READING_FIELDS.indexOf(inp.dataset.field);
  const rows = state.project.readings;
  let skipped = 0;
  let k = 0;
  for (const cells of matrix) {
    const row = r0 + k;
    const values = {};
    cells.forEach((cellText, j) => {
      const f = READING_FIELDS[c0 + j];
      if (!f) return;
      if (f === "date") values.date = toIsoDate(cellText.trim());
      else values[f] = F.parseNum(cellText);
    });
    if (k === 0 && "date" in values && !values.date && cells.some((c) => c.trim() && Number.isNaN(F.parseNum(c)))) {
      continue; // header row
    }
    if (Object.values(values).some((v) => Number.isNaN(v))) {
      skipped++;
      k++;
      continue;
    }
    if (!rows[row]) {
      const prev = rows[row - 1];
      rows[row] = { date: prev?.date ? E.isoFromDayNumber(E.dayNumber(prev.date) + 1) : null, time: null, gauge: null, rain: null, level: null };
    }
    Object.assign(rows[row], values);
    k++;
  }
  sortReadings();
  update({ immediate: true, readingsGrid: true });
  if (skipped) addNotice("readings", { kind: "warn", title: `${skipped} pasted row(s) were skipped`, body: "They contained text where a number was expected." });
}

function sortReadings() {
  state.project.readings.sort((a, b) => ((a.date || "9999") < (b.date || "9999") ? -1 : (a.date || "9999") > (b.date || "9999") ? 1 : 0));
}

function addDay() {
  const rows = state.project.readings;
  const last = rows[rows.length - 1];
  const date = last?.date ? E.isoFromDayNumber(E.dayNumber(last.date) + 1) : new Date().toISOString().slice(0, 10);
  rows.push({ date, time: null, gauge: null, rain: null, level: null });
  update({ immediate: true, readingsGrid: true });
  const inp = ui.gridBody.querySelector(`input[data-row="${rows.length - 1}"][data-field="gauge"]`);
  inp?.scrollIntoView({ block: "center" });
  inp?.focus();
}

function fillMissingDates() {
  const rows = state.project.readings.filter((r) => r.date);
  if (rows.length < 2) return;
  const have = new Set(rows.map((r) => r.date));
  const first = E.dayNumber(rows[0].date);
  const last = E.dayNumber(rows[rows.length - 1].date);
  let added = 0;
  for (let d = first; d <= last; d++) {
    const iso = E.isoFromDayNumber(d);
    if (!have.has(iso)) {
      state.project.readings.push({ date: iso, time: null, gauge: null, rain: null, level: null });
      added++;
    }
  }
  sortReadings();
  update({ immediate: true, readingsGrid: true });
  addNotice("readings", {
    kind: "info",
    title: added ? `Added ${added} missing day(s).` : "No days were missing.",
    body: added ? "Their gauge readings are blank, so their levels are filled in from the days either side. Enter the readings if you have them." : "",
  });
}

function updateReadingsDerived() {
  const { wb } = state.results;
  const rows = state.project.readings;
  ui.readingsSub.textContent = rows.length ? `${rows.length} days · ${F.dateRange(rows[0].date, rows[rows.length - 1].date)}` : "No readings yet";
  const levels = E.resolveLevels(rows, state.project.params);
  const trs = ui.gridBody.children;
  for (let i = 0; i < trs.length; i++) {
    const tr = trs[i];
    const r = rows[i];
    if (!r) continue;
    const lv = levels[i];
    const d = wb.ok ? wb.days[i] : null;
    tr.children[4].textContent = isNum(lv.level) ? F.num(lv.level, 3) : "–";
    const levelInput = tr.children[3].firstChild;
    if (document.activeElement !== levelInput) levelInput.placeholder = lv.source === "rule" ? `${F.num(lv.level, 3)} (rule)` : "";
    const note = tr.children[5];
    note.replaceChildren();
    tr.classList.toggle("flag-override", lv.source === "override" || lv.source === "rule");
    tr.classList.toggle("flag-interp", lv.source === "interpolated");
    let warn = false;
    if (lv.source === "rule") {
      note.append("Corrected: yesterday’s level minus 1.1 × evaporation. ", h("button", { class: "btn-link", type: "button", "data-clear-level": i, text: "Use the gauge" }));
    } else if (lv.source === "override" && lv.gaugeLevel != null) note.append(`Corrected; the gauge gives ${F.num(lv.gaugeLevel, 3)} m. `);
    else if (lv.source === "override") note.append("Level entered; no gauge reading. ");
    else if (lv.source === "interpolated") note.append("No reading; filled in from the days either side. ");
    else if (lv.source === "missing") note.append("No reading or level. ");
    if (d && d.qaSuggestedLevel != null && r.level == null) {
      warn = true;
      note.append(`Level did not fall on a dry day. `, h("button", { class: "btn-link", type: "button", "data-use-level": i, text: `Use ${F.num(d.qaSuggestedLevel, 3)} m` }));
    }
    tr.classList.toggle("flag-warn", warn);
  }
  renderChecks(levels);
}

function renderChecks(levels) {
  const { wb } = state.results;
  const rows = state.project.readings;
  const items = [];
  const li = (kind, ...content) => h("li", {}, icon(kind), h("span", { class: "visually-hidden", text: `${KIND_LABEL[kind]}: ` }), h("div", {}, ...content));
  if (!rows.length) {
    ui.checks.replaceChildren(
      notice("info", "No readings yet.", "Import a spreadsheet, paste columns from one, or add days one by one.", {
        actions: [
          h("button", { class: "btn btn-sm btn-primary", type: "button", text: "Import a spreadsheet", onclick: () => $("#file-input").click() }),
          h("button", { class: "btn btn-sm", type: "button", text: "Paste readings", onclick: openPasteReadings }),
        ],
      }),
    );
    return;
  }
  for (const q of problemsBy("readings")) items.push(li("error", q.text));
  const negRain = rows.filter((r) => isNum(r.rain) && r.rain < 0).length;
  if (negRain) items.push(li("error", `${negRain} day(s) have negative rainfall.`));
  if (wb.ok) {
    const suggest = wb.days.map((d, i) => ({ d, i })).filter(({ d, i }) => d.qaSuggestedLevel != null && rows[i].level == null);
    if (suggest.length) {
      items.push(
        li(
          "warn",
          h("strong", { text: `${suggest.length} day(s) where the level did not fall although it hardly rained. ` }),
          "On a dry day the water should drop by at least the evaporation, so the reading may be wrong. If so, use the suggested level (yesterday’s level minus 1.1 × evaporation): ",
          ...suggest.flatMap(({ d, i }, k) => [
            k ? ", " : "",
            h("button", { class: "btn-link", type: "button", "data-use-level": i, text: `${F.date(d.date)} → ${F.num(d.qaSuggestedLevel, 3)} m` }),
          ]),
          ". If the reading is right, leave it.",
        ),
      );
    }
    for (const w of wb.warnings) items.push(li("warn", w));
  }
  const overrides = levels.map((l, i) => ({ l, i })).filter(({ l }) => l.source === "override" || l.source === "rule");
  if (overrides.length) {
    items.push(
      li(
        "info",
        `${overrides.length} day(s) use a corrected level: `,
        overrides
          .slice(0, 8)
          .map(({ l, i }) => `${F.date(rows[i].date)} (${l.gaugeLevel != null ? `${F.num(l.gaugeLevel, 3)} → ` : ""}${F.num(l.level, 3)} m${l.source === "rule" ? ", dry-day rule" : ""})`)
          .join(", ") + (overrides.length > 8 ? ", …" : "."),
      ),
    );
  }
  const interp = levels.filter((l) => l.source === "interpolated").length;
  if (interp) items.push(li("info", `${interp} day(s) have no reading and were filled in from the days either side.`));
  ui.checks.replaceChildren(items.length ? h("ul", { class: "checks" }, items) : h("p", { class: "check-ok" }, icon("ok"), `No problems found in ${rows.length} days.`));
  ui.checks.onclick = onGridClick;
}

// Paste dialog (replace all readings)
function openPasteReadings() {
  const dlg = $("#paste-dialog");
  const ta = $("#paste-text");
  const fb = $("#paste-feedback");
  ta.value = "";
  fb.textContent = "";
  const ask = () => {
    const choice = dialogChoice(dlg);
    ta.focus();
    choice.then((value) => {
      if (value !== "ok") return;
      const res = parsePastedReadings(ta.value);
      if (res.error) {
        fb.textContent = res.error;
        ask(); // keep the text so it can be fixed
        return;
      }
      state.project.readings = res.readings;
      sortReadings();
      update({ immediate: true, readingsGrid: true });
      addNotice("readings", { kind: "info", title: `Pasted ${res.readings.length} days.`, body: F.dateRange(res.readings[0].date, res.readings[res.readings.length - 1].date) });
    });
  };
  ask();
}

function parsePastedReadings(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (!lines.length) return { error: "Nothing was pasted." };
  const sep = lines.some((l) => l.includes("\t")) ? "\t" : lines.some((l) => l.includes(";")) ? ";" : ",";
  const readings = [];
  for (let n = 0; n < lines.length; n++) {
    const cells = lines[n].split(sep).map((c) => c.trim());
    const date = toIsoDate(cells[0]);
    if (!date) {
      if (n === 0) continue; // header
      return { error: `Line ${n + 1}: “${cells[0]}” is not a date (use 2014-07-16 or 16/07/2014).` };
    }
    const [gauge, rain, level] = [cells[1], cells[2], cells[3]].map(F.parseNum);
    if ([gauge, rain, level].some((v) => Number.isNaN(v))) return { error: `Line ${n + 1} has text where a number was expected.` };
    readings.push({ date, time: null, gauge, rain, level });
  }
  if (!readings.length) return { error: "No dated rows were found." };
  return { readings };
}

// ---------------------------------------------------------------------------
// Step 4 · Results

const FRAME = { left: 64, right: 156 };

function buildBalance() {
  const panel = $("#panel-balance");
  ui.notices_balance = h("div", { class: "notices" });
  ui.balanceLead = h("p", { class: "step-why" });
  const head = h(
    "div",
    { class: "step-head" },
    h("div", { class: "step-kicker", text: "Step 4 of 4" }),
    h("h2", { text: "Where the water went" }),
    ui.balanceLead,
    h("div", {}, learnLink(4, "Learn how these numbers are worked out (Lessons 3–5)")),
  );

  // Hero: recharge + where the inflow went
  ui.heroValue = h("div", { class: "hero-figure" });
  ui.heroSentence = h("p", { class: "hero-sentence" });
  ui.partition = h("div", { class: "partition", role: "img" });
  ui.splitList = h("ul", { class: "split-list" });
  ui.per100 = h("p", { class: "per100" });
  ui.splitNote = h("p", { class: "split-note" });
  const heroCard = h(
    "section",
    { class: "card" },
    h("div", { class: "hero-figure-label", text: "Soaked into the ground (groundwater recharge)" }),
    ui.heroValue,
    ui.heroSentence,
    ui.partition,
    ui.splitList,
    ui.per100,
    ui.splitNote,
  );

  // Dam section + day scrubber
  ui.sectionHost = h("div", { class: "section-host" });
  ui.dayRange = h("input", { type: "range", min: 0, max: 0, value: 0, "aria-label": "Day shown in the drawing" });
  ui.dayRange.addEventListener("input", () => {
    stopPlay();
    state.day = +ui.dayRange.value;
    renderDay();
    for (const c of ui.balanceCharts) c.setHover(state.day, false);
  });
  ui.playBtn = h("button", { class: "btn btn-sm", type: "button", text: "Play the season", onclick: togglePlay });
  ui.readout = h("dl", { class: "day-readout" });
  ui.dayTitle = h("div", { class: "day-date" });
  ui.explainDay = h("button", {
    class: "btn btn-sm",
    type: "button",
    text: "Explain this day",
    onclick: () => {
      goTab("learn");
      ui.learn?.open({ lesson: 2, day: state.hover ?? state.day });
    },
  });
  const sectionCard = h(
    "section",
    { class: "card section-card" },
    h("div", { class: "card-head", style: "margin-bottom:0" }, h("h3", { text: "The check dam on" }), ui.dayTitle),
    ui.sectionHost,
    h("div", { class: "scrubber" }, ui.playBtn, ui.dayRange),
    ui.readout,
    h("div", {}, ui.explainDay),
  );
  new ResizeObserver(() => renderDay()).observe(ui.sectionHost);

  ui.howto = h("ul", { class: "howto" });
  const howtoCard = h("section", { class: "card easy-only" }, h("div", { class: "card-head" }, h("h3", { text: "How to read these results" })), ui.howto);

  ui.kpis = h("div", { class: "kpis" });

  // Chart stack with a shared crosshair
  const onHover = (i, source) => {
    state.hover = i;
    for (const c of ui.balanceCharts) if (c !== source) c.setHover(i, false);
    renderDay();
  };
  ui.rainChart = new TimeChart(h("div"), { title: "Rainfall" }, { onHover });
  ui.levelChart = new TimeChart(h("div"), { title: "Water level in the pond" }, { onHover });
  ui.cumChart = new TimeChart(h("div"), { title: "Where the water went, day by day" }, { onHover });
  ui.rateChart = new TimeChart(h("div", { class: "adv" }), { title: "Dry-weather infiltration rate" }, { onHover });
  ui.balanceCharts = [ui.rainChart, ui.levelChart, ui.cumChart, ui.rateChart];
  const chartsCard = card(
    "Through the season",
    "Move over a chart, or tap it and use the arrow keys, to read a day. The drawing above follows.",
    h("div", { class: "chart-stack" }, ui.balanceCharts.map((c) => c.root)),
  );

  ui.periodsHost = h("div");
  ui.sensHost = h("div");
  ui.dailyHost = h("div", { class: "table-scroll tall" });
  const periodsCard = card("Infiltration by period", "Mean dry-weather infiltration rate in each part of the season.", ui.periodsHost);
  const sensCard = card("Sensitivity", "Each input changed by ±20 %, the others held.", ui.sensHost);
  ui.dailyDetails = h("details", {}, h("summary", { class: "btn btn-sm", text: "Show the daily table" }), h("div", { style: "margin-top:12px" }, ui.dailyHost));
  ui.dailyDetails.addEventListener("toggle", () => ui.dailyDetails.open && renderDailyTable());
  const dailyCard = h(
    "section",
    { class: "card" },
    h("div", { class: "card-head" }, h("h3", { text: "All the numbers" }), h("p", { text: "Download every daily value and total as a spreadsheet." })),
    h("div", { class: "toolbar" }, h("button", { class: "btn btn-sm btn-primary", type: "button", text: "Download results (.xlsx)", onclick: doExport })),
    h("div", { class: "adv" }, ui.dailyDetails),
  );

  ui.balanceResults = h(
    "div",
    { class: "stack" },
    h("div", { class: "hero" }, heroCard, sectionCard),
    howtoCard,
    ui.kpis,
    chartsCard,
    h("div", { class: "grid-2 adv" }, periodsCard, sensCard),
    dailyCard,
  );
  panel.append(head, ui.notices_balance, ui.balanceResults, stepFoot({ tab: "readings", label: "Daily readings" }, { tab: "recession", label: "Infiltration rate (optional)" }));
}

function updateBalance() {
  const { wb } = state.results;
  const extra = [];
  if (!wb.ok) {
    const next = problemsBy("dam").length ? "dam" : problemsBy("survey").length ? "survey" : "readings";
    const label = { dam: "Step 1 · Your check dam", survey: "Step 2 · Pond survey", readings: "Step 3 · Daily readings" }[next];
    extra.push(
      notice("info", "The results will appear here once Steps 1–3 are complete.", h("ul", {}, wb.errors.map((m) => h("li", { text: m }))), {
        actions: [h("button", { class: "btn btn-sm btn-primary", type: "button", text: `Go to ${label}`, onclick: () => goTab(next) })],
      }),
    );
  } else {
    for (const w of wb.warnings) extra.push(notice("warn", null, w));
  }
  ui.noticeExtra_balance = extra;
  renderNotices("balance", extra);
  ui.balanceResults.hidden = !wb.ok;
  if (!wb.ok) {
    ui.balanceLead.textContent = "";
    return;
  }
  const days = wb.days;
  const t = wb.totals;
  const first = days[0].date;
  const last = days[days.length - 1].date;
  ui.balanceLead.textContent = `From ${F.date(first)} to ${F.date(last)} (${days.length} days), ${F.num(t.inflow)} m³ of water flowed into the pond. Here is what happened to it.`;

  // Hero
  ui.heroValue.replaceChildren(F.num(t.rechargeWithEnd), h("span", { class: "unit", text: "m³" }));
  ui.heroSentence.textContent = `That is ${F.num(t.rechargeWithEnd / 1000, 1)} million litres, ${F.pct(wb.ratios.rechargeToInflow)} of the water that flowed in: the benefit of the check dam, refilling the groundwater that wells draw on.`;
  const parts = [
    { key: "recharge", label: "Soaked into the ground", value: t.rechargeWithEnd, color: "var(--c-recharge)" },
    { key: "evap", label: "Evaporated", value: t.evaporationWithEnd, color: "var(--c-evap)" },
    { key: "spill", label: "Spilled over the dam", value: t.spill, color: "var(--c-spill)" },
  ];
  if (t.storageLeft > 0) parts.push({ key: "left", label: "Still in the pond", value: t.storageLeft, color: "var(--c-other)" });
  const whole = parts.reduce((a, p) => a + p.value, 0);
  ui.partition.replaceChildren(...parts.filter((p) => p.value > 0).map((p) => h("span", { style: `--c:${p.color};flex:${p.value / whole}`, title: `${p.label}: ${F.num(p.value)} m³` })));
  ui.partition.setAttribute("aria-label", parts.map((p) => `${p.label} ${F.pct(p.value / whole)}`).join(", "));
  ui.splitList.replaceChildren(
    ...parts.map((p) =>
      h(
        "li",
        {},
        h("span", { class: "split-key", style: `--c:${p.color}` }),
        h("span", { text: p.label }),
        h("span", { class: "v", text: `${F.num(p.value)} m³` }),
        h("span", { class: "p", text: F.pct(p.value / whole) }),
      ),
    ),
  );
  const share = (v) => F.num((v / whole) * 100, 1);
  ui.per100.replaceChildren(
    "Of every 100 litres that flowed in, ",
    h("strong", { text: share(t.rechargeWithEnd) }),
    " soaked into the ground, ",
    h("strong", { text: share(t.evaporationWithEnd) }),
    " evaporated and ",
    h("strong", { text: share(t.spill) }),
    t.storageLeft > 0 ? [" spilled over the dam; ", h("strong", { text: share(t.storageLeft) }), " is still in the pond."] : " spilled over the dam.",
  );
  const init = t.initialStorage > 0 ? ` It also includes the ${F.num(t.initialStorage)} m³ already in the pond before the first day.` : "";
  ui.splitNote.textContent = wb.endOfSeason.applied
    ? `The ${F.num(wb.endOfSeason.remaining)} m³ still in the pond on ${F.date(last)} is counted too, as it will soak in or evaporate: ${F.num(wb.endOfSeason.recharge)} m³ and ${F.num(wb.endOfSeason.evaporation)} m³.${init} Balance check: ${F.num(t.balance, 2)} m³.`
    : `The ${F.num(wb.endOfSeason.remaining)} m³ still in the pond on ${F.date(last)} is shown separately.${init} Balance check: ${F.num(t.balance, 2)} m³.`;

  // How to read (Easy)
  const hl = (color, strong, text) => h("li", {}, h("span", { class: "key", style: `--c:${color}` }), h("span", {}, h("strong", { text: strong }), ` ${text}`));
  ui.howto.replaceChildren(
    hl("var(--c-recharge)", "Soaked into the ground", "is the check dam’s benefit: this water refills the groundwater that wells draw on."),
    hl("var(--c-evap)", "Evaporated", "is water lost to the air from the pond’s surface."),
    hl("var(--c-spill)", "Spilled over the dam", "flowed on downstream when the pond was full. A large share means the pond filled and overflowed often."),
    h(
      "li",
      {},
      h("span", { class: "key", style: "--c:transparent" }),
      h("span", {}, h("strong", { text: "The balance check" }), ` is ${F.num(t.balance, 2)} m³. Zero means every drop that flowed in is accounted for.`),
    ),
  );

  // KPIs
  const kpi = (label, value, unit, note, cls) =>
    h(
      "div",
      { class: `kpi ${cls || ""}` },
      h("div", { class: "kpi-label", text: label }),
      h("div", { class: "kpi-value" }, value, unit ? h("span", { class: "unit", text: unit }) : null),
      note ? h("div", { class: "kpi-note", text: note }) : null,
    );
  ui.kpis.replaceChildren(
    kpi("Rain", F.num(t.rain, 1), "mm", `on ${wb.counts.rainDays} days`),
    kpi("Flowed into the pond", F.num(t.inflow), "m³", isNum(wb.ratios.runoffCoefficient) ? `${F.pct(wb.ratios.runoffCoefficient)} of the rain on the catchment` : ""),
    kpi("Water soaks in at", F.num(wb.mdwir * 1000, 1), "mm/day", `on dry days (${wb.counts.dryDays} of them)`),
    kpi("Kept by the dam", F.pct(wb.ratios.captured), "", "of the inflow did not spill", "adv"),
    kpi("Evaporation ÷ recharge", F.num(wb.ratios.evaporationToRecharge, 2), "", "for every m³ recharged", "adv"),
  );

  // Charts
  const x = days.map((d) => E.dayNumber(d.date));
  const base = { x, domain: [x[0], x[x.length - 1]], frame: FRAME, padDomain: true };
  const p = wb.params;
  ui.rainChart.update({
    ...base,
    title: "Rainfall",
    unit: `mm per day · ${F.num(t.rain, 1)} mm in total`,
    height: 110,
    series: [{ key: "rain", label: "Rainfall", type: "bar", color: "var(--c-rain)", values: days.map((d) => d.rain || null), format: (v) => `${F.num(v, 1)} mm` }],
    yFormat: (v) => F.num(v),
  });
  const gaugeDiff = days.map((d) => (d.gaugeLevel != null && Math.abs(d.gaugeLevel - d.level) > 1e-9 ? d.gaugeLevel : null));
  const interp = days.map((d) => (d.levelSource === "interpolated" ? d.level : null));
  const levelSeries = [{ key: "level", label: "Water level", type: "line", area: true, color: "var(--c-water)", values: days.map((d) => d.level), format: (v) => `${F.num(v, 3)} m` }];
  if (gaugeDiff.some(isNum)) levelSeries.push({ key: "gauge", label: "Gauge reading before correction", type: "dot", color: "var(--c-other)", values: gaugeDiff, format: (v) => `${F.num(v, 3)} m` });
  if (interp.some(isNum)) levelSeries.push({ key: "interp", label: "Day without a reading", type: "dot", color: "var(--c-other)", values: interp, format: (v) => `${F.num(v, 3)} m` });
  ui.levelChart.update({
    ...base,
    title: "Water level in the pond",
    unit: "m",
    height: 190,
    series: levelSeries,
    refLines: [
      { y: p.ctfRl, label: `Spillway ${F.trim(p.ctfRl, 2)} m` },
      { y: p.gaugeZeroRl, label: `Gauge zero ${F.trim(p.gaugeZeroRl, 2)} m` },
    ],
    yMin: Math.min(p.gaugeZeroRl, ...days.map((d) => d.level)) - 0.1,
    yFormat: (v) => F.num(v, 1),
    tooltip: (i) => {
      const d = days[i];
      const rows = [
        { label: "water level", value: `${F.num(d.level, 3)} m`, color: "var(--c-water)" },
        { label: "gauge", value: d.gauge != null ? `${F.num(d.gauge)} cm` : "none", color: "transparent" },
        { label: "in the pond", value: `${F.num(d.volume)} m³`, color: "transparent" },
      ];
      if (gaugeDiff[i] != null) rows.push({ label: "gauge before correction", value: `${F.num(gaugeDiff[i], 3)} m`, color: "var(--c-other)", shape: "dot" });
      if (d.levelSource === "interpolated") rows.push({ label: "no reading", value: "filled in", color: "var(--c-other)", shape: "dot" });
      return rows;
    },
  });
  const cumSeries = [
    { key: "inflow", label: "Flowed in", type: "line", color: "var(--c-water)", values: days.map((d) => d.cumInflow), endLabel: true },
    { key: "spill", label: "Spilled", type: "line", color: "var(--c-spill)", values: days.map((d) => d.cumSpill), endLabel: true },
    { key: "recharge", label: "Soaked in", type: "line", color: "var(--c-recharge)", values: days.map((d) => d.cumRecharge), endLabel: true },
    { key: "evap", label: "Evaporated", type: "line", color: "var(--c-evap)", values: days.map((d) => d.cumEvaporation), endLabel: true },
  ].map((se) => ({ ...se, format: (v) => `${F.num(v)} m³` }));
  ui.cumChart.update({
    ...base,
    title: "Where the water went, day by day",
    unit: "m³, running totals",
    height: 250,
    yZero: true,
    series: cumSeries,
    yFormat: (v) => (Math.abs(v) >= 1000 ? `${F.num(v / 1000)}k` : F.num(v)),
    note: wb.endOfSeason.applied ? `Totals up to ${F.date(last)}. The figure at the top also counts the ${F.num(wb.endOfSeason.remaining)} m³ still in the pond that day.` : "",
    tooltip: (i) => [
      ...cumSeries.map((se) => ({ label: se.label.toLowerCase(), value: `${F.num(se.values[i])} m³`, color: se.color })),
      { label: "in the pond that day", value: `${F.num(days[i].volume)} m³`, color: "transparent" },
    ],
  });
  ui.rateChart.update({
    ...base,
    title: "Dry-weather infiltration rate",
    unit: "mm per day, on days the level fell below the spillway",
    height: 140,
    series: [{ key: "rate", label: "Infiltration rate", type: "bar", color: "var(--c-recharge)", values: days.map((d) => (d.dryRate > 0 ? d.dryRate * 1000 : null)), format: (v) => `${F.num(v, 1)} mm/day` }],
    refLines: [{ y: wb.mdwir * 1000, label: `Mean ${F.num(wb.mdwir * 1000, 1)} mm/day` }],
    yFormat: (v) => F.num(v),
  });

  // Day scrubber
  ui.dayRange.max = String(days.length - 1);
  ui.dayRange.value = String(state.day);
  renderDay();

  // Periods (Advanced)
  ui.periodsHost.replaceChildren(
    h(
      "div",
      { class: "table-scroll" },
      h(
        "table",
        { class: "data-table" },
        h("thead", {}, h("tr", {}, h("th", { text: "Period" }), h("th", { text: "Dates" }), h("th", { class: "num", text: "Dry days" }), h("th", { class: "num", text: "Mean rate (mm/day)" }))),
        h(
          "tbody",
          {},
          wb.periods.map((q, i) =>
            h(
              "tr",
              {},
              h("td", { text: String(i + 1) }),
              h("td", { text: F.dateRange(q.start, q.end) }),
              h("td", { class: "num", text: `${q.dryDays} of ${q.days}` }),
              h("td", { class: "num", text: q.mdwir == null ? "–" : F.num(q.mdwir * 1000, 1) }),
            ),
          ),
        ),
        h(
          "tfoot",
          {},
          h(
            "tr",
            {},
            h("td", { text: "Season" }),
            h("td", { text: F.dateRange(first, last) }),
            h("td", { class: "num", text: `${wb.counts.dryDays} of ${days.length}` }),
            h("td", { class: "num", text: F.num(wb.mdwir * 1000, 1) }),
          ),
        ),
      ),
    ),
    h("p", { class: "muted", style: "font-size:13px;margin-top:8px" }, "Set the period start dates in ", h("a", { href: "#dam", text: "Step 1" }), " (Advanced)."),
  );

  // Sensitivity (Advanced)
  const sens = state.results.sens.filter((r) => r.ok);
  ui.sensHost.replaceChildren(
    h(
      "div",
      { class: "table-scroll" },
      h(
        "table",
        { class: "data-table" },
        h(
          "thead",
          {},
          h("tr", {}, h("th", { text: "Input" }), h("th", { class: "num", text: "Value" }), h("th", { class: "num", text: "Recharge" }), h("th", { class: "num", text: "Evaporation" }), h("th", { class: "num", text: "Spill" })),
        ),
        h(
          "tbody",
          {},
          sens.map((r) =>
            h(
              "tr",
              {},
              h("td", { text: `${r.key === "weir" ? "Weir coefficient" : r.key === "evaporation" ? "Evaporation" : "Infiltration, wet days"} ${F.signedPct(r.factor - 1, 0)}` }),
              h("td", { class: "num", text: r.key === "weir" ? F.num(r.value, 2) : `${F.num(r.value * 1000, 1)} mm/d` }),
              h("td", { class: "num", text: F.signedPct(r.change.recharge) }),
              h("td", { class: "num", text: F.signedPct(r.change.evaporation) }),
              h("td", { class: "num", text: F.signedPct(r.change.spill) }),
            ),
          ),
        ),
      ),
    ),
  );
  if (ui.dailyDetails.open) renderDailyTable();
}

function renderDay() {
  const { wb } = state.results || {};
  if (!wb?.ok || state.tab !== "balance") return;
  const i = state.hover ?? state.day ?? 0;
  const d = wb.days[i];
  if (!d) return;
  if (state.hover == null) ui.dayRange.value = String(state.day);
  const levelMax = Math.max(...wb.days.map((x) => x.level));
  drawSection(ui.sectionHost, { stage: wb.stage, params: wb.params, level: d.level, levelMax, gauge: d.gauge, spill: d.spill });
  ui.dayTitle.textContent = `${F.date(d.date)} · day ${i + 1} of ${wb.days.length}`;
  const item = (label, value) => h("div", {}, h("dt", { text: label }), h("dd", { text: value }));
  ui.readout.replaceChildren(
    item("Water level", `${F.num(d.level, 3)} m${d.gauge != null ? ` · gauge ${F.num(d.gauge)} cm` : ""}`),
    item("In the pond", `${F.num(d.volume)} m³`),
    item("Rain that day", `${F.num(d.rain, 1)} mm`),
    item("Flowed in that day", `${F.num(d.inflow)} m³`),
    item("Soaked in that day", `${F.num(d.dryRecharge + d.wetRecharge)} m³`),
    item("Spilled that day", `${F.num(d.spill)} m³`),
  );
}

function togglePlay() {
  if (state.playTimer) return stopPlay();
  const { wb } = state.results;
  if (!wb.ok) return;
  if (state.day >= wb.days.length - 1) state.day = 0;
  state.hover = null;
  ui.playBtn.textContent = "Pause";
  const step = matchMedia("(prefers-reduced-motion: reduce)").matches ? 7 : 1;
  state.playTimer = setInterval(() => {
    state.day = Math.min(wb.days.length - 1, state.day + step);
    renderDay();
    for (const c of ui.balanceCharts) c.setHover(state.day, false);
    if (state.day >= wb.days.length - 1) stopPlay();
  }, 70);
}

function stopPlay() {
  if (!state.playTimer) return;
  clearInterval(state.playTimer);
  state.playTimer = null;
  ui.playBtn.textContent = "Play the season";
}

function renderDailyTable() {
  const { wb } = state.results;
  if (!wb.ok) return;
  const cols = [
    ["Date", (d) => F.date(d.date)],
    ["Gauge (cm)", (d) => (d.gauge == null ? "–" : F.num(d.gauge))],
    ["Level (m)", (d) => F.num(d.level, 3)],
    ["Area (m²)", (d) => F.num(d.area)],
    ["Stored (m³)", (d) => F.num(d.volume)],
    ["Rain (mm)", (d) => F.num(d.rain, 1)],
    ["Evaporation (m³)", (d) => F.num(d.evaporation, 1)],
    ["Dry-weather rate (mm/d)", (d) => (d.dryRate > 0 ? F.num(d.dryRate * 1000, 1) : "–")],
    ["Recharge (m³)", (d) => F.num(d.dryRecharge + d.wetRecharge, 1)],
    ["Spill (m³)", (d) => F.num(d.spill, 1)],
    ["Inflow (m³)", (d) => F.num(d.inflow, 1)],
    ["Total inflow (m³)", (d) => F.num(d.cumInflow)],
    ["Total recharge (m³)", (d) => F.num(d.cumRecharge)],
    ["Total evaporation (m³)", (d) => F.num(d.cumEvaporation)],
    ["Total spill (m³)", (d) => F.num(d.cumSpill)],
    ["Check = stored (m³)", (d) => F.num(d.balance)],
  ];
  const t = wb.totals;
  const foot = ["Total", "", "", "", "", F.num(t.rain, 1), F.num(t.evaporation, 1), F.num(wb.mdwir * 1000, 1), F.num(t.recharge, 1), F.num(t.spill, 1), F.num(t.inflow, 1), "", "", "", "", ""];
  ui.dailyHost.replaceChildren(
    h(
      "table",
      { class: "data-table" },
      h("thead", {}, h("tr", {}, cols.map(([l], i) => h("th", { class: i ? "num" : "", text: l })))),
      h("tbody", {}, wb.days.map((d) => h("tr", {}, cols.map(([, f], i) => h("td", { class: i ? "num" : "", text: f(d) }))))),
      h("tfoot", {}, h("tr", {}, foot.map((v, i) => h("td", { class: i ? "num" : "", text: v })))),
    ),
  );
}

// ---------------------------------------------------------------------------
// Step 5 · Infiltration rate from the gauge alone (optional)

function buildRecession() {
  const panel = $("#panel-recession");
  ui.notices_recession = h("div", { class: "notices" });

  const R = () => state.project.recession;
  const dateInput = (key, label) => {
    const inp = h("input", { type: "date", id: `rec-${key}` });
    inp.addEventListener("change", () => {
      R()[key] = inp.value || null;
      update({ immediate: true });
    });
    ui[`rec_${key}`] = inp;
    return h("div", { class: "field" }, h("label", { for: `rec-${key}`, text: label }), inp);
  };
  const numInput = (key, label, unit, help, integer) => {
    const inp = h("input", { type: "text", inputmode: "decimal", id: `rec-${key}` });
    const wrap = h("div", { class: "input-unit" }, inp, h("span", { class: "u", text: unit }));
    inp.addEventListener("input", () => {
      const v = F.parseNum(inp.value);
      const ok = isNum(v) && v >= 0 && (!integer || (Number.isInteger(v) && v >= 3));
      wrap.classList.toggle("invalid", !ok);
      if (ok) {
        R()[key] = v;
        update();
      }
    });
    ui[`rec_${key}`] = inp;
    return h("div", { class: "field" }, h("label", { for: `rec-${key}`, text: label }), wrap, h("div", { class: "help", text: help }));
  };
  ui.recFixed = h("p", { class: "muted", style: "font-size:13px;margin-top:12px" });
  const controls = h(
    "section",
    { class: "card adv" },
    h("div", { class: "card-head" }, h("h3", { text: "Settings" }), h("p", { text: "The workbook’s thresholds. Leave the dates blank to use every reading." })),
    h(
      "div",
      { class: "form-grid" },
      dateInput("from", "From"),
      dateInput("to", "To"),
      numInput("rainThreshold", "A wet day has more than", "mm", "Rainfall that breaks a dry spell. Workbook: 0.1 mm.", false),
      numInput("riseThreshold", "A rise of more than", "cm", "Breaks a dry spell. Workbook: 2 cm.", false),
      numInput("minRun", "Fit spells of at least", "readings", "Workbook: 3.", true),
    ),
    ui.recFixed,
  );

  ui.recHero = h("div", { class: "hero-figure" });
  ui.recSentence = h("p", { class: "hero-sentence" });
  ui.estimates = h("dl", { class: "estimates" });
  const heroCard = h(
    "section",
    { class: "card" },
    h("div", { class: "hero-figure-label", text: "Water soaks into the ground at" }),
    ui.recHero,
    ui.recSentence,
    h("div", { class: "adv" }, h("h3", { style: "margin:20px 0 10px;font-size:15px", text: "Three estimates of the same rate" }), ui.estimates),
  );

  const onHover = (i, source) => {
    for (const c of [ui.recRainChart, ui.recChart]) if (c !== source) c.setHover(i, false);
  };
  ui.recRainChart = new TimeChart(h("div"), { title: "Rainfall" }, { onHover });
  ui.recChart = new TimeChart(h("div"), { title: "Gauge readings and the dry spells" }, { onHover });
  const chartsCard = card(
    null,
    null,
    h("p", {
      class: "muted easy-only",
      style: "font-size:14px;margin-bottom:10px",
      text: "Blue dots are the dry-spell readings; the green lines show how fast the water fell in each spell. Grey dots are other days: rain, a rise, or water above the spillway.",
    }),
    h("div", { class: "chart-stack" }, ui.recRainChart.root, ui.recChart.root),
  );

  ui.runsHost = h("div");
  const runsCard = h("section", { class: "card adv" }, h("div", { class: "card-head" }, h("h3", { text: "Dry spells" }), h("p", { text: "Select a spell to pick it out on the chart." })), ui.runsHost);
  ui.recResults = h("div", { class: "stack" }, heroCard, chartsCard, runsCard);
  panel.append(
    stepHead({
      kicker: "Step 5 · optional",
      title: "How fast water soaks into the ground",
      why: "This quick method needs only the gauge readings and rainfall, the kind of data MyWell collects, so it works even for a check dam without a pond survey. It finds dry spells, when the water only fell, measures how fast it fell, and takes away evaporation. What is left is water soaking into the ground.",
      need: "the daily readings from Step 3, and the spillway level and evaporation from Step 1.",
      lesson: { n: 5, label: "Learn how this method works, picture by picture (Lesson 6)" },
    }),
    ui.notices_recession,
    h("div", { class: "stack" }, controls, ui.recResults),
    stepFoot({ tab: "balance", label: "Results" }, null),
  );
}

function updateRecession() {
  const { rec, wb } = state.results;
  const R = state.project.recession;
  const p = state.project.params;
  for (const k of ["from", "to"]) if (document.activeElement !== ui[`rec_${k}`]) ui[`rec_${k}`].value = R[k] || "";
  for (const k of ["rainThreshold", "riseThreshold", "minRun"]) if (document.activeElement !== ui[`rec_${k}`]) ui[`rec_${k}`].value = inputText(R[k]);
  const ctfCm = E.gaugeCtfCm(p);
  ui.recFixed.replaceChildren(
    `Uses the evaporation (${isNum(p.evaporation) ? `${F.trim(p.evaporation * 1000, 2)} mm/day` : "not set"}) and spillway level (${isNum(ctfCm) ? `${F.trim(ctfCm, 1)} cm on the gauge` : "not set"}) from `,
    h("a", { href: "#dam", text: "Step 1" }),
    ". Readings of 0 cm are skipped: the water is then at or below the gauge’s zero.",
  );
  const extra = [];
  if (!state.project.readings.length) extra.push(notice("info", "Add daily readings in Step 3 first.", ""));
  else if (!rec.ok) extra.push(notice("info", "Enter the spillway and gauge-zero levels and the evaporation in Step 1 first.", ""));
  else if (!rec.runs.length) {
    extra.push(
      notice(
        "warn",
        "No dry spell long enough to use.",
        `A spell needs at least ${R.minRun} readings in a row with no rain above ${R.rainThreshold} mm, no rise above ${R.riseThreshold} cm and the water below the spillway.`,
      ),
    );
  }
  renderNotices("recession", extra);
  ui.recResults.hidden = !(rec.ok && rec.runs.length);
  if (!(rec.ok && rec.runs.length)) return;
  const P = rec.pooled;
  const pts = rec.points;
  ui.recHero.replaceChildren(F.num(P.infiltrationMm, 1), h("span", { class: "unit", text: "mm per day" }));
  ui.recSentence.textContent = `From ${P.runs} dry spell${P.runs === 1 ? "" : "s"} (${P.readings} readings, ${F.dateRange(pts[0].date, pts[pts.length - 1].date)}): the water fell ${F.num(-P.weightedSlope, 2)} cm a day on average, and ${F.num(p.evaporation * 100, 2)} cm of that was evaporation.${state.mode === "advanced" ? ` Pooled standard error ±${F.num(P.se * 10, 1)} mm/day.` : ""}`;

  const ests = [
    { label: "Gauge recessions, weighted by spell length", sub: "this step, the workbook’s MyWell method", v: P.infiltrationMm },
    wb.ok ? { label: "Water balance, mean of dry days", sub: "Step 4", v: wb.mdwir * 1000 } : null,
    { label: "Gauge recessions, simple mean of spells", sub: "each spell counts once", v: P.unweightedInfiltrationMm },
  ].filter(Boolean);
  const vmax = Math.max(...ests.map((e) => e.v), 1);
  ui.estimates.replaceChildren(
    ...ests.map((e) =>
      h(
        "div",
        { class: "estimate" },
        h("dt", {}, e.label, h("small", { text: e.sub })),
        h("dd", {}, h("span", { class: "est-bar", style: `--c:var(--c-recharge);width:${Math.max(0, (e.v / vmax) * 70)}%` }), h("span", { class: "est-value", text: `${F.num(e.v, 1)} mm/day` })),
      ),
    ),
  );

  // Charts
  const x = pts.map((q) => q.day + q.frac);
  const offset = x[0] - pts[0].t; // t -> day number
  const sel = state.highlightRun;
  const inRun = pts.map((q) => (q.run != null ? q.y : null));
  const other = pts.map((q) => (q.run == null ? q.y : null));
  const base = { x, domain: [x[0], x[x.length - 1]], frame: FRAME, padDomain: true };
  ui.recRainChart.update({
    ...base,
    title: "Rainfall",
    unit: "mm per day",
    height: 100,
    series: [{ key: "rain", label: "Rainfall", type: "bar", color: "var(--c-rain)", values: pts.map((q) => q.rain || null), format: (v) => `${F.num(v, 1)} mm` }],
    yFormat: (v) => F.num(v),
  });
  const statusOf = (q) => {
    if (q.run != null) return `dry spell ${q.run + 1}`;
    if (q.belowGauge) return "at gauge zero";
    if (q.above) return "above the spillway";
    if (q.wet) return `rain ${F.num(q.rain, 1)} mm`;
    if (q.rising) return `rose ${F.num(q.dy)} cm`;
    if (q.eligible) return "dry, spell too short";
    return "first reading";
  };
  ui.recChart.update({
    ...base,
    title: "Gauge readings and the dry spells",
    unit: "cm on the gauge",
    height: 260,
    series: [
      { key: "other", label: "Other readings", type: "dot", color: "var(--c-other)", values: other, r: 3 },
      { key: "run", label: "Dry-spell readings", type: "dot", color: "var(--c-water)", values: inRun.map((v, i) => (sel == null || pts[i].run === sel ? v : null)), r: 3.5 },
      ...(sel != null ? [{ key: "runFaded", label: "", legend: false, type: "dot", color: "var(--c-water)", faded: true, values: inRun.map((v, i) => (pts[i].run !== sel ? v : null)), r: 3.5 }] : []),
    ],
    fits: rec.runs.map((r) => ({
      x0: r.tStart + offset,
      x1: r.tEnd + offset,
      y0: r.slope * r.tStart + r.intercept,
      y1: r.slope * r.tEnd + r.intercept,
      color: "var(--c-recharge)",
      faded: sel != null && sel !== r.index,
    })),
    fitLegend: "How fast it fell",
    refLines: [{ y: E.gaugeCtfCm(p), label: `Spillway ${F.trim(E.gaugeCtfCm(p), 1)} cm` }],
    yZero: true,
    yFormat: (v) => F.num(v),
    tooltipHeading: (i) => `${F.date(pts[i].date)}${pts[i].time ? ` ${pts[i].time}` : ""}`,
    tooltip: (i) => {
      const q = pts[i];
      const rows = [{ label: statusOf(q), value: `${F.num(q.y)} cm`, color: q.run != null ? "var(--c-water)" : "var(--c-other)", shape: "dot" }];
      if (q.run != null) {
        const r = rec.runs[q.run];
        rows.push({ label: `fall in spell ${q.run + 1}`, value: `${F.num(-r.slope, 2)} cm/day`, color: "var(--c-recharge)" });
      }
      return rows;
    },
    tableColumns: [
      { label: "Date", value: (i) => F.date(pts[i].date) },
      { label: "Gauge (cm)", value: (i) => F.num(pts[i].y), num: true },
      { label: "Rain (mm)", value: (i) => F.num(pts[i].rain, 1), num: true },
      { label: "Status", value: (i) => statusOf(pts[i]) },
    ],
  });

  // Runs table (Advanced)
  ui.runsHost.replaceChildren(
    h(
      "div",
      { class: "table-scroll" },
      h(
        "table",
        { class: "data-table" },
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", { text: "Spell" }),
            h("th", { text: "Dates" }),
            h("th", { class: "num", text: "Readings" }),
            h("th", { class: "num", text: "Fall (cm/day)" }),
            h("th", { class: "num", text: "R²" }),
            h("th", { class: "num", text: "Std. error (cm/day)" }),
            h("th", { class: "num", text: "Infiltration (mm/day)" }),
          ),
        ),
        h(
          "tbody",
          {},
          rec.runs.map((r) => {
            const tr = h(
              "tr",
              { class: `clickable${sel === r.index ? " selected" : ""}`, tabindex: "0", "aria-selected": String(sel === r.index) },
              h("td", { text: String(r.index + 1) }),
              h("td", { text: F.dateRange(r.start, r.end) }),
              h("td", { class: "num", text: String(r.n) }),
              h("td", { class: "num", text: F.num(-r.slope, 2) }),
              h("td", { class: "num", text: r.r2 == null ? "–" : F.num(r.r2, 3) }),
              h("td", { class: "num", text: F.num(r.se, 3) }),
              h("td", { class: "num", text: F.num(r.infiltrationCm * 10, 1) }),
            );
            const pick = () => {
              state.highlightRun = sel === r.index ? null : r.index;
              updateRecession();
            };
            tr.addEventListener("click", pick);
            tr.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick()));
            return tr;
          }),
        ),
        h(
          "tfoot",
          {},
          h(
            "tr",
            {},
            h("td", { text: "All" }),
            h("td", { text: "weighted by n − 1" }),
            h("td", { class: "num", text: String(P.readings) }),
            h("td", { class: "num", text: F.num(-P.weightedSlope, 2) }),
            h("td", { class: "num", text: "" }),
            h("td", { class: "num", text: F.num(P.se, 3) }),
            h("td", { class: "num", text: F.num(P.infiltrationMm, 1) }),
          ),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Import / export / menu

async function onFileChosen(file) {
  let res;
  try {
    res = await readFile(file);
  } catch (err) {
    const panel = ["dam", "survey", "readings", "balance", "recession"].includes(state.tab) ? state.tab : "start";
    addNotice(panel, { kind: "error", title: `Couldn’t read ${file.name}.`, body: err?.message || String(err) });
    return;
  }
  const hasData = state.project.readings.length > 0 && !state.isExample;
  if (res.kind === "project") {
    if (hasData) {
      const ok = await confirmDialog({
        title: `Replace “${state.project.site?.name || "this site"}”?`,
        body: `Opening ${file.name} replaces the check dam, survey and readings on this device. Save the current project first if you want to keep it.`,
        ok: "Replace",
      });
      if (!ok) return;
    }
    state.project = res.project;
    state.project.site = { ...state.project.site, source: state.project.site?.source || file.name };
    state.day = null;
    state.highlightRun = null;
    resetNotices();
    renderStageRows();
    update({ immediate: true, readingsGrid: true });
    // A complete file goes straight to the report; otherwise to the first step to finish.
    const target = state.results.wb.ok ? "report" : firstIncompleteStep();
    addNotice(target, { kind: "info", title: `Imported ${file.name}.`, body: h("ul", {}, res.summary.map((l) => h("li", { text: l }))) });
    for (const w of res.warnings) addNotice(target, { kind: "warn", title: null, body: w });
    goTab(target);
  } else if (res.kind === "survey") {
    const hasSurvey = state.project.stage.some((r) => isNum(r.area) && r.area > 0);
    if (hasSurvey && !state.isExample) {
      const ok = await confirmDialog({
        title: "Replace the pond survey?",
        body: `${res.stage.length} levels from ${file.name} will replace the current survey. The check dam and readings stay as they are.`,
        ok: "Replace survey",
      });
      if (!ok) return;
    }
    state.project.stage = res.stage;
    renderStageRows();
    update({ immediate: true });
    addNotice("survey", { kind: "info", title: `Imported ${file.name}.`, body: h("ul", {}, res.summary.map((l) => h("li", { text: l }))) });
    goTab("survey");
  } else if (res.kind === "dam") {
    if (!state.isExample && isNum(state.project.params.gaugeZeroRl)) {
      const ok = await confirmDialog({
        title: "Replace the check dam’s values?",
        body: `The values in ${file.name} will replace the ones in Step 1. The survey and readings stay as they are.`,
        ok: "Replace values",
      });
      if (!ok) return;
    }
    Object.assign(state.project.params, res.params);
    update({ immediate: true });
    addNotice("dam", { kind: "info", title: `Imported ${file.name}.`, body: h("ul", {}, res.summary.map((l) => h("li", { text: l }))) });
    goTab("dam");
  } else {
    if (hasData) {
      const ok = await confirmDialog({
        title: "Replace the readings?",
        body: `${res.readings.length} rows from ${file.name} will replace the current readings. The check dam and survey stay as they are.`,
        ok: "Replace readings",
      });
      if (!ok) return;
    }
    state.project.readings = res.readings;
    update({ immediate: true, readingsGrid: true });
    addNotice("readings", { kind: "info", title: `Imported ${file.name}.`, body: h("ul", {}, res.summary.map((l) => h("li", { text: l }))) });
    for (const w of res.warnings) addNotice("readings", { kind: "warn", title: null, body: w });
    goTab("readings");
  }
}

function doExport() {
  const { wb, rec, sens } = state.results;
  if (!wb.ok) {
    addNotice("balance", { kind: "error", title: "Nothing to download yet.", body: "Complete Steps 1–3 first." });
    goTab("balance");
    return;
  }
  exportResults(state.project, wb, rec, sens);
}

/** The first step with something still to fill in or fix. */
function firstIncompleteStep() {
  if (problemsBy("dam").length) return "dam";
  if (problemsBy("survey").length) return "survey";
  return "readings";
}

// ---------------------------------------------------------------------------
// Report

/** Where the data came from, as the report says it. */
function reportSource() {
  if (state.isExample) return "the Badgaon example (MyCheckDam spreadsheet, MARVI)";
  return state.project.site?.source || "entered in CheckDamCal";
}

function downloadReport() {
  if (!state.results.wb.ok) {
    goTab("report");
    return;
  }
  try {
    const bytes = buildReportPdf(state.project, state.results, { source: reportSource() });
    downloadBytes(bytes, reportFileName(state.project));
  } catch (err) {
    addNotice("report", { kind: "error", title: "Couldn’t make the PDF.", body: err?.message || String(err) });
    goTab("report");
  }
}

function buildReport() {
  const panel = $("#panel-report");
  ui.notices_report = h("div", { class: "notices" });
  ui.reportBody = h("div", { class: "report-body" });
  panel.append(
    stepHead({
      kicker: "Report",
      title: "The report",
      why: "The results on a few pages, to share or to file: what happened to the water, the charts through the season, how each number was worked out, the checks on the data and every day’s figures.",
    }),
    ui.notices_report,
    ui.reportBody,
  );
}

function reportTable(rows) {
  return h(
    "table",
    { class: "rs-table" },
    h(
      "tbody",
      {},
      rows.map((r) =>
        h("tr", {}, h("th", { scope: "row", text: r.label }), h("td", { class: "num", text: r.value }), h("td", { class: "rs-note", text: r.note || "" })),
      ),
    ),
  );
}

function updateReport() {
  const host = ui.reportBody;
  if (!host) return;
  const m = reportModel(state.project, state.results, { source: reportSource() });
  if (!m.ok) {
    host.replaceChildren(
      h(
        "div",
        { class: "card report-empty" },
        h("h3", { text: "The report is ready once the three steps are done" }),
        h("p", { class: "muted", text: "Still to do:" }),
        h("ul", {}, m.problems.slice(0, 6).map((t) => h("li", { text: t }))),
        h("div", { class: "report-actions" }, h("button", { class: "btn btn-primary", type: "button", text: "Go to the step to finish", onclick: () => goTab(firstIncompleteStep()) })),
      ),
    );
    return;
  }
  const split = h(
    "div",
    { class: "rs-split" },
    h(
      "div",
      { class: "partition", role: "img", "aria-label": m.parts.map((q) => `${q.label} ${F.pct(q.share)}`).join(", ") },
      m.parts.filter((q) => q.value > 0).map((q) => h("span", { style: `--c:${q.color};flex:${q.share}` })),
    ),
    h(
      "ul",
      { class: "split-list" },
      m.parts.map((q) =>
        h("li", {}, h("span", { class: "split-key", style: `--c:${q.color}` }), h("span", { text: q.label }), h("span", { class: "v", text: `${F.num(q.value)} m³` }), h("span", { class: "p", text: F.pct(q.share) })),
      ),
    ),
  );
  host.replaceChildren(
    h(
      "div",
      { class: "report-actions" },
      h("button", { class: "btn btn-primary", type: "button", text: "Download the PDF report", onclick: downloadReport }),
      h("button", { class: "btn", type: "button", text: "Download the numbers (.xlsx)", onclick: doExport }),
      h("span", { class: "muted report-actions-note", text: "The PDF has everything below, plus the charts, the method, the sensitivity and every day’s numbers." }),
    ),
    h(
      "article",
      { class: "report-sheet", "aria-label": "What the report says" },
      h("p", { class: "rs-kicker", text: "Check dam water balance" }),
      h("h3", { class: "rs-title", text: m.site }),
      h("p", { class: "rs-meta", text: `${m.period.label} · ${m.period.days} days` }),
      m.source ? h("p", { class: "rs-source", text: `Data: ${m.source}` }) : null,
      h(
        "div",
        { class: "rs-headline" },
        h("p", { class: "rs-big" }, F.num(m.headline.recharge), h("span", { class: "unit", text: "m³" })),
        h("p", { text: `soaked into the ground: ${F.pct(m.headline.share)} of the ${F.num(m.headline.inflow)} m³ of water that flowed into the pond.` }),
      ),
      h("h4", { text: "Where the water went" }),
      split,
      h("h4", { text: "Key numbers" }),
      reportTable(m.keyNumbers),
      h("h4", { text: "What went in" }),
      reportTable(m.inputs),
      m.checks.length ? [h("h4", { text: "Checks on the data" }), h("ul", { class: "rs-checks" }, m.checks.map((c) => h("li", { text: c })))] : null,
    ),
  );
}

function resetNotices() {
  state.notices = { start: [], dam: [], survey: [], readings: [], balance: [], recession: [], report: [] };
}

/** A blank site: the site-specific levels start empty so nothing is borrowed from Badgaon by accident. */
function newSiteProject() {
  return {
    version: 1,
    site: { name: "My check dam", notes: "" },
    params: { ...E.DEFAULT_PARAMS, gaugeZeroRl: null, ctfRl: null, weirLength: null, catchmentHa: null, periodStarts: [] },
    stage: [
      { rl: null, area: 0, volume: null },
      { rl: null, area: null, volume: null },
      { rl: null, area: null, volume: null },
    ],
    readings: [],
    recession: { ...E.DEFAULT_RECESSION },
  };
}

async function menuAction(action) {
  $("#menu").open = false;
  if (action === "export-pdf") downloadReport();
  else if (action === "export-xlsx") doExport();
  else if (action === "save-json") saveProjectFile(state.project);
  else if (action === "load-example") {
    if (!state.isExample && state.project.readings.length) {
      const ok = await confirmDialog({
        title: "Load the Badgaon example?",
        body: "It replaces the check dam, survey and readings on this device. Save the current project first if you want to keep it.",
        ok: "Load example",
      });
      if (!ok) return;
    }
    loadExample();
    goTab("balance");
  } else if (action === "new-site") {
    if (!state.isExample && (state.project.readings.length || state.project.stage.some((r) => isNum(r.area) && r.area > 0))) {
      const ok = await confirmDialog({
        title: "Start a new site?",
        body: "This clears the check dam, survey and readings on this device. Save the current project first (More → Save project) if you want to keep it.",
        ok: "Start new site",
      });
      if (!ok) return;
    }
    state.project = newSiteProject();
    state.isExample = false;
    state.day = null;
    resetNotices();
    renderStageRows();
    recompute();
    renderAll({ readingsGrid: true });
    saveSoon();
    addNotice("dam", {
      kind: "info",
      title: "A new check dam.",
      body: "Fill in the three levels below, then the pond survey (Step 2) and your daily readings (Step 3). The results appear by themselves when all three are done.",
    });
    goTab("dam");
  }
}

function loadExample() {
  state.project = badgaonExample();
  state.day = null;
  state.highlightRun = null;
  resetNotices();
  renderStageRows();
  recompute();
  renderAll({ readingsGrid: true });
  state.isExample = true;
  saveSoon();
  addNotice("balance", welcomeNotice());
}

function welcomeNotice() {
  return {
    kind: "info",
    title: "This is the Badgaon example:",
    body: "a MARVI check dam in Udaipur district, Rajasthan, over the 2014 monsoon, from the MyCheckDam spreadsheet. Use it to see how the steps work, then start your own check dam.",
    actions: () => [
      h("button", { class: "btn btn-sm", type: "button", text: "Start with my own check dam", onclick: () => menuAction("new-site") }),
      h("button", { class: "btn btn-sm btn-ghost", type: "button", text: "Import a spreadsheet", onclick: () => $("#file-input").click() }),
    ],
  };
}

function wireHeader() {
  $("#site-name").addEventListener("input", (e) => {
    state.project.site = { ...(state.project.site || {}), name: e.target.value };
    document.title = e.target.value ? `${e.target.value} · CheckDamCal` : "CheckDamCal";
    state.isExample = false;
    saveSoon();
  });
  $("#btn-import").addEventListener("click", () => $("#file-input").click());
  $("#file-input").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) onFileChosen(f);
  });
  document.querySelectorAll("[data-action]").forEach((b) => b.addEventListener("click", () => menuAction(b.dataset.action)));
  document.querySelectorAll("[data-theme-choice]").forEach((b) => b.addEventListener("click", () => applyTheme(b.dataset.themeChoice)));
  document.querySelectorAll("[data-mode-choice]").forEach((b) => b.addEventListener("click", () => applyMode(b.dataset.modeChoice)));
  document.addEventListener("click", (e) => {
    const menu = $("#menu");
    if (menu.open && !menu.contains(e.target)) menu.open = false;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") $("#menu").open = false;
  });
  // Steps: click and arrow keys (roving focus).
  const tabs = [...document.querySelectorAll(".tab")];
  tabs.forEach((t) => t.addEventListener("click", () => goTab(t.dataset.tab)));
  $(".tabs").addEventListener("keydown", (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    let j = null;
    if (e.key === "ArrowRight") j = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") j = (i - 1 + tabs.length) % tabs.length;
    if (j == null) return;
    e.preventDefault();
    tabs[j].focus();
    goTab(tabs[j].dataset.tab);
  });
  // Drop a file anywhere.
  // While a file is dragged over the page, the drop zone lights up.
  let dragDepth = 0;
  const dragging = (on) => document.body.classList.toggle("dragging", on);
  document.addEventListener("dragenter", (e) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    dragDepth += 1;
    dragging(true);
  });
  document.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dragging(false);
  });
  document.addEventListener("dragover", (e) => {
    if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
  });
  document.addEventListener("drop", (e) => {
    dragDepth = 0;
    dragging(false);
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    e.preventDefault();
    onFileChosen(f);
  });
}

// ---------------------------------------------------------------------------

function init() {
  if (EMBED) {
    document.documentElement.classList.add("embed");
    if (FOCUS) document.documentElement.classList.add("focus");
    window.addEventListener("message", onHostMessage);
  }
  const prefs = readStore(PREFS_KEY) || {};
  applyTheme(prefs.themeChoice || "light", false);
  applyMode(prefs.mode || "easy");
  const saved = readStore(STORE_KEY);
  let restored = null;
  if (saved?.project) {
    try {
      restored = checkProject(saved.project);
    } catch {
      restored = null;
    }
  }
  if (restored) {
    state.project = restored;
    state.isExample = !!saved.isExample;
  } else {
    state.project = badgaonExample();
    state.isExample = true;
  }
  // The example's results feed the "What you get" examples on the Start page.
  const ex = badgaonExample();
  state.example = { wb: E.computeWaterBalance(ex) };
  buildStart();
  buildDam();
  buildSurvey();
  buildReadings();
  buildBalance();
  buildRecession();
  buildReport();
  ui.learn = createLearn($("#learn-root"), { results: () => state.results, goTab });
  wireHeader();
  recompute();
  renderAll({ readingsGrid: true });
  if (state.isExample) addNotice("balance", welcomeNotice());
  window.addEventListener("hashchange", () => showTab(tabFromHash() || "start"));
  // First visit: Start here. Afterwards: where you left off. In focus mode
  // the host decides; until it does, the report (or the first step to finish).
  if (FOCUS) showTab(state.results.wb.ok ? "report" : firstIncompleteStep());
  else showTab(tabFromHash() || (restored && TABS.includes(prefs.tab) ? prefs.tab : "start"));
  // For checking and debugging in the browser console only.
  window.checkdamcal = { state, engine: E };
  if (FOCUS) {
    // The host sizes the frame to the content, so the page scrolls as one.
    const ro = new ResizeObserver(() => postToHost({ type: "size", height: Math.ceil(document.documentElement.scrollHeight) }));
    ro.observe(document.body);
  }
  postToHost({ type: "ready" });
}

// ---------------------------------------------------------------------------
// Embedded in OurWater
//
// Messages are accepted only from the parent page, and only when it is on
// this page's own origin: the calculator is served from the app itself.
//   host -> here: {source:"ourwater", type:"load", project, title?, summary?, warnings?, readingsNote?}
//                 {source:"ourwater", type:"file", file}          a File the user dropped on the host
//                 {source:"ourwater", type:"example"}             the Badgaon example
//                 {source:"ourwater", type:"goto", tab}           show one panel (focus mode)
//                 {source:"ourwater", type:"export", what:"pdf"|"xlsx"|"project"}
//                 {source:"ourwater", type:"explain", on}         focus mode: show the explanations
//                 {source:"ourwater", type:"theme", theme:"light"|"dark"}
//                 {source:"ourwater", type:"mode", mode:"easy"|"advanced"}
//   here -> host: {source:"checkdamcal", type:"ready"}
//                 {source:"checkdamcal", type:"state", ...}       after every change (see announceState)
//                 {source:"checkdamcal", type:"size", height}     focus mode: the content height
//                 {source:"checkdamcal", type:"setup", setup:{params, stage, recession}}
//                   (after the user changes the dam or the survey, so the host can keep it)

function postToHost(msg) {
  if (EMBED) window.parent.postMessage({ source: "checkdamcal", ...msg }, location.origin);
}

let setupTimer = null;
function announceSetup() {
  if (!EMBED) return;
  clearTimeout(setupTimer);
  setupTimer = setTimeout(() => {
    const p = state.project;
    postToHost({
      type: "setup",
      setup: {
        params: { ...p.params },
        stage: p.stage.map((r) => ({ rl: r.rl, area: r.area, volume: r.volume })),
        recession: { ...p.recession },
      },
    });
  }, 800);
}

/** What the host needs to draw its own steps and buttons. */
function announceState() {
  if (!EMBED || !state.results) return;
  const { wb, rec } = state.results;
  const t = wb.ok ? wb.totals : null;
  postToHost({
    type: "state",
    tab: state.tab,
    ok: wb.ok,
    isExample: state.isExample,
    site: state.project.site?.name || "",
    days: state.project.readings.length,
    // What still has to be filled in, by the step that fixes it.
    needs: {
      dam: problemsBy("dam").map((q) => q.text),
      survey: problemsBy("survey").map((q) => q.text),
      readings: state.project.readings.length ? problemsBy("readings").map((q) => q.text) : ["Add the daily readings."],
    },
    pendingChecks: pendingChecks(),
    headline: t
      ? {
          recharge: t.rechargeWithEnd,
          inflow: t.inflow,
          share: wb.ratios.rechargeToInflow,
          evaporation: t.evaporationWithEnd,
          spill: t.spill,
          mdwirMm: wb.mdwir * 1000,
          recessionMm: rec.ok && rec.pooled ? rec.pooled.infiltrationMm : null,
          first: wb.days[0].date,
          last: wb.days[wb.days.length - 1].date,
        }
      : null,
  });
}

function onHostMessage(e) {
  if (e.source !== window.parent || e.origin !== location.origin) return;
  const m = e.data;
  if (!m || typeof m !== "object" || m.source !== "ourwater") return;
  if (m.type === "theme") applyTheme(m.theme === "dark" ? "dark" : "light", false);
  else if (m.type === "explain") document.documentElement.classList.toggle("explain", !!m.on);
  else if (m.type === "mode") applyMode(m.mode === "advanced" ? "advanced" : "easy");
  else if (m.type === "load") loadFromHost(m);
  else if (m.type === "file" && m.file instanceof File) onFileChosen(m.file);
  else if (m.type === "example") {
    loadExample();
    goTab("report");
  } else if (m.type === "goto" && TABS.includes(m.tab)) goTab(m.tab);
  else if (m.type === "export") {
    if (m.what === "pdf") downloadReport();
    else if (m.what === "xlsx") doExport();
    else if (m.what === "project") saveProjectFile(state.project);
  }
}

function loadFromHost(m) {
  let project;
  try {
    project = checkProject(m.project);
  } catch (err) {
    addNotice("start", { kind: "error", title: "Couldn’t load the data from OurWater.", body: err?.message || String(err) });
    goTab("start");
    return;
  }
  state.project = project;
  state.isExample = false;
  state.day = null;
  state.highlightRun = null;
  resetNotices();
  renderStageRows();
  recompute();
  renderAll({ readingsGrid: true });
  saveSoon();
  const target = state.results.wb.ok ? "report" : firstIncompleteStep();
  const lines = Array.isArray(m.summary) ? m.summary.map(String) : [];
  addNotice(target, { kind: "info", title: m.title ? String(m.title) : "Loaded from OurWater.", body: lines.length ? h("ul", {}, lines.map((l) => h("li", { text: l }))) : null });
  for (const w of Array.isArray(m.warnings) ? m.warnings : []) addNotice(target, { kind: "warn", title: null, body: String(w) });
  if (m.readingsNote) addNotice("readings", { kind: "info", title: null, body: String(m.readingsNote) });
  goTab(target);
}

init();
