# Example data for CheckDamCal

The Badgaon check dam (Udaipur, Rajasthan), monsoon 2014 — the worked example of
the MyCheckDam spreadsheet — in the formats the tool imports. Open any of them
with **Import** in the tool.

| File | What it is |
|---|---|
| `checkdamcal-template.xlsx` | **Blank template** to fill in: sheets *Check dam*, *Pond survey*, *Daily readings* (and *Read me*) |
| `checkdamcal-badgaon-2014.xlsx` | The same template, filled in with the Badgaon example |
| `badgaon-2014-check-dam.csv` | Step 1 on its own: Item, Value, Unit, Notes |
| `badgaon-2014-pond-survey.csv` | Step 2 on its own: Level (m), Water area (m²), Volume (m³, optional) |
| `badgaon-2014-daily-readings.csv` | Step 3 on its own: Date, Gauge reading (cm), Rainfall (mm), Level override (m, optional) |

Rules of thumb: one row per day with no gaps; leave rainfall blank on dry days;
a blank gauge reading is filled in from the days either side; dates as
`2014-07-16` or `16/07/2014`. In *Level override*, a number replaces that day's
level and `dry-day rule` means "yesterday's level minus 1.1 × evaporation".

Regenerate after changing `js/example.js`: `node scripts/make-examples.mjs`.
