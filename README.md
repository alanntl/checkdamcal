# CheckDamCal

Developed by Alan Ng ([alanntl](https://github.com/alanntl)).

A check-dam water balance calculator: the web version of **MyCheckDam.xlsx**,
the MARVI check-dam calculator (Peter Dillon's water-balance template). It works
out how much of the water a check dam held **soaked into the ground**
(groundwater recharge), **evaporated** or **spilled over the dam**, and how fast
water soaks in (the infiltration rate).

Use it at **https://alanntl.github.io/checkdamcal/**

It is a static page: no server code, no login, no build step. Everything runs in
the browser and data stays on the device unless you download it.

## Run it locally

```bash
python3 serve.py        # http://localhost:5288
```

`serve.py` is `http.server` with caching turned off, so an edited file shows on
the next reload. The live site is GitHub Pages serving the `alanntl` branch;
a push to that branch updates it in about a minute.

## Use it — the steps

| Step | You enter | Why |
|---|---|---|
| **1 · Your check dam** | Level of the gauge board's 0 cm mark, spillway level, spillway length, evaporation (catchment area optional) | Turns a gauge reading (cm) into a water level (m) and says when the dam spills |
| **2 · Pond survey** | Water-surface area at several levels, bed to above the spillway | Turns a water level into a volume of water |
| **3 · Daily readings** | Gauge reading (cm) and rainfall (mm) for every day | The daily rise and fall shows inflow, recharge and evaporation |
| **4 · Results** | — | Recharge, evaporation, spill, charts, download (.xlsx) |
| **5 · Infiltration rate** (optional) | — | Rate from dry-weather recessions: needs only the gauge and rain |
| **Report** | — | The result on a few pages: **Download the PDF report** |

**Start here** offers two ways in. *Have the data in a file?* Drop the MyCheckDam
spreadsheet, a filled-in template or a saved project, and a complete file lands
straight on the **Report** (the researcher's path: file in, PDF out). *Or enter
it step by step*, with the diagram and "what you need, in this order" below.
**Easy** view keeps to the essentials in plain words; **Advanced** adds every
setting and table from the workbook (weir coefficients, infiltration periods,
sensitivity, the daily table, recession thresholds and fits).

## The PDF report

Made in the browser by `js/report.js` + `js/pdf.js` (a small PDF writer with no
dependencies: Helvetica, WinAnsi text, vector charts), so the file is the same
in every browser and in the tests. For Badgaon it is six A4 pages:

1. The result, where the water went, key numbers, what went in (dam, survey,
   readings).
2. Rainfall, water level with the spillway, running totals, and the dry-day
   infiltration rate, on one shared date axis.
3. How the numbers were worked out, assumptions and limits, checks on the data,
   infiltration by period, and how much the result depends on each input.
4. The gauge-only (dry spell) estimate, then every day's numbers.

The Report page shows the same model on screen (`reportModel`), so the page and
the PDF cannot disagree. Text outside WinAnsi (e.g. a Devanagari site name) is
written as `?` in the PDF; the on-screen report shows it as typed.

The file is named after the site and the moment it was made, on the reader's own
clock: `badgaon-check-dam-2014-water-balance-2026-09-30-1547.pdf`. The first page
says the same ("report made 30 Sep 2026, 15:47"). The results workbook is named
the same way (`…-results-2026-09-30-1547.xlsx`), so downloads made at different
times never share a name.

## Learn — the calculation, one picture at a time

The **Learn** page is the teaching part. Pick a day (or *A rainy day*, *A dry
day*, *A spilling day*) and follow it through six lessons. Each picture builds up
in stages (Back / Next / Show all), and each equation is shown three ways: in
words, in symbols, and with that day's own numbers and units — taken from the
same engine results, so a lesson can't disagree with the results.

| Lesson | Picture | Equation |
|---|---|---|
| 1 Gauge to level | The gauge board, the water line, the height of the 0 cm mark | D = RL₀ + g ÷ 100 |
| 2 Level to water | The survey curve, the two survey points either side, the straight line between | A = A₁ + (D − h₁)(A₂ − A₁) ÷ (h₂ − h₁), same for V |
| 3 One day | The pond with the day before's line; "came in" and "where it went" bars of equal length | O = ΔS + E + R + N, with each term |
| 4 Soaking rate | The day's fall split into evaporation and soaking; the season's rates | K = (D₋₁ − D) − e + P ÷ 1000; r = ΣK ÷ n |
| 5 The season | Running totals building up (Play); the water left at the end shared out | V_end × r ÷ (r + e) and × e ÷ (r + e) |
| 6 Gauge only | A dry spell, its best-fit line and slope, minus evaporation | rate = −slope − e, pooled by (n − 1) |

Every step links to its lesson, and the Results page has **Explain this day**.
Below the lessons, *For experts* lists every formula with the workbook cells and
the differences from the spreadsheet.

## Data to import

Everything can be typed in, but a file is quicker. Examples of every format are
in [`examples/`](examples/README.md) and downloadable from the Start page:

- **`checkdamcal-template.xlsx`** — the fill-in template: sheets *Check dam*
  (Item, Value, Unit), *Pond survey* (Level (m), Water area (m²), Volume (m³)
  optional), *Daily readings* (Date, Gauge reading (cm), Rainfall (mm), Level
  override (m) optional). `checkdamcal-badgaon-2014.xlsx` is the same, filled in.
- **CSV files for each part** — `badgaon-2014-check-dam.csv`,
  `badgaon-2014-pond-survey.csv`, `badgaon-2014-daily-readings.csv`. A single
  table is recognised by its headers and fills just that step.
- **The original MyCheckDam spreadsheet**, read whole.
- **A saved project** (`.json`).

The example files are generated from `js/example.js` by
`scripts/make-examples.mjs` and checked by the tests, so they always import to
the verified Badgaon result.

Data can be typed, pasted from a spreadsheet (select cells, copy, paste into the
first box), or imported: a MyCheckDam workbook is recognised and read whole
(parameters, survey, readings, level corrections, periods, recession window);
any other sheet with a *Date* header and gauge/rain/level columns is read as
readings. Projects save to and load from `.json`.

The **Badgaon check dam, 2014** worked example from the workbook is built in.

## Tests

```bash
node --test "test/*.test.mjs"
MYCHECKDAM_XLSX=/path/to/MyCheckDam.xlsx node --test "test/*.test.mjs"   # + real-workbook import
```

The import tests also round-trip the template and every CSV, and import the
files in `examples/` as shipped.

`test/report.test.mjs` checks the PDF is well formed (every xref offset lands on
its object, every stream's length is exact, the body is ASCII) and carries the
verified numbers, and that the report model says what the results say.

`test/fixtures/badgaon-2014.json` holds the workbook's own cached cell values
(read with openpyxl). The engine tests reproduce them: every daily column G–V
of sheet 1 for all 120 days, the season totals, counts and ratios (rows
150–158), the infiltration periods (rows 173–175), the data-check suggestions
(column AC), the four regressions and pooled result of the MyWell sheet, and the
sheet's own sensitivity reruns (rows 161–167).

## Differences from the spreadsheet

Deliberate, and listed in the tool under **Learn → For experts**:

- The water left on the last day is the last day's volume (3,013.66 m³), not the
  hand-typed 3,014 m³, so the balance closes at 0 (workbook: −0.34 m³).
- Evaporation ÷ recharge uses both totals with the end-of-season share (0.167);
  the workbook's H158 mixes R150 with Q151 (0.163).
- The pooled standard error of the recession slope uses SE², as the workbook's
  label says; its cells use SE, giving 0.32 in units of √(cm/d) instead of
  0.19 cm/d.
- The sensitivity table is recalculated live. The workbook's pasted C₁ row is
  labelled 1.28 but its values are for 1.3.
- R² of each dry spell is calculated. The workbook's typed R² row (S117:W117)
  has 0.9781 for the second spell; its own chart label and the data give 0.9827.
- Levels above the survey extend its top segment with a warning (workbook:
  `#REF!`); recession readings of 0 cm are skipped (the water is at or below the
  gauge zero).
- A level correction can be a number or the workbook's dry-day rule
  (yesterday's level − 1.1 × evaporation, `D = AC`), which follows the
  evaporation rate as the workbook's formula does.

## Inside OurWater

OurWater (Advanced analytics → **Tool marketplace** → **Check dam calculator**,
open to Super Admins, Tool Admins and the people they add) serves a copy of these files from its own origin at
`/tools/checkdamcal/index.html?embed=1` and frames it. The copy is made by
`frontend/scripts/sync-checkdamcal.mjs` in the OurWater repo, which records the
commit it came from in `VERSION.txt`; change the calculator here, then copy it
again.

With `?embed=focus` and a parent page on the same origin, the calculator shows
no header, tabs or status bar of its own: the host page shows one panel at a
time, draws its own steps and buttons, and sizes the frame to the content so
its page scrolls as one. (`?embed` alone keeps the calculator's chrome and
only hides the brand and theme menu.) Both sides talk by `postMessage` and
check the origin and the sending window:

| Direction | Message | Meaning |
|---|---|---|
| here → host | `{source:"checkdamcal", type:"ready"}` | the calculator is listening |
| host → here | `{source:"ourwater", type:"load", project, title?, summary?, warnings?, readingsNote?}` | replace the project with this one; a complete one opens on the Report |
| host → here | `{source:"ourwater", type:"file", file}` / `{…, type:"example"}` | read a File the user dropped on the host; load the Badgaon example |
| host → here | `{source:"ourwater", type:"goto", tab}` / `{…, type:"export", what:"pdf"\|"xlsx"\|"project"}` | show one panel; download |
| host → here | `{source:"ourwater", type:"theme", theme}` / `{…, type:"mode", mode}` | follow the app's light/dark theme and Easy/Advanced mode |
| here → host | `{source:"checkdamcal", type:"state", tab, ok, needs, headline, …}` / `{…, type:"size", height}` | after every change: what is missing by step, the headline numbers; the content height (focus) |
| here → host | `{source:"checkdamcal", type:"setup", setup:{params, stage, recession}}` | the user changed the dam or the pond survey (debounced); OurWater saves it on the station |

## Files

```
index.html          page shell and the For-experts formula reference
css/styles.css      tokens (MyWell teal/ink), light + dark, layout
js/engine.js        the calculations — pure functions, no DOM
js/app.js           steps, inputs, results, Easy/Advanced, report page, embedding
js/report.js        the report model, and the PDF built from it
js/pdf.js           a small PDF writer (A4, Helvetica, vector drawing)
js/charts.js        SVG time and XY charts (crosshair, table view)
js/section.js       the dam section drawing and the Start-page diagram
js/io.js            import (.xlsx/.csv/.json), template and example writers, export
js/learn.js         the Learn lessons: staged pictures and equations
js/example.js       Badgaon 2014, generated from the fixture
examples/           example data files and the fill-in template
scripts/            make-examples.mjs (regenerates examples/)
vendor/             SheetJS 0.20.3 mini build (Apache-2.0)
fonts/              Nunito (OFL-1.1)
test/               node:test suites and the workbook fixture
```

Chart colours are a validated categorical set (water blue, recharge aqua,
evaporation orange; spill a recessive grey), checked for colour-vision
deficiency in both themes.
