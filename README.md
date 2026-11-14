# TrendScope 📈🌍

**What's changing, where is it changing, how much, and is it *significant*?**

TrendScope is a web tool built for the NASA Space Apps Challenge. Click any
point on Earth, pick a variable measured by NASA missions and models, and
TrendScope pulls 40+ years of annual data, charts it, and runs the same trend
statistics climate scientists use to decide whether a change is real or just
noise.

**Live demo:** https://camdengoddard.github.io/SpaceApps/

## The challenge

Change in Earth's interconnected environmental system runs in consistent
directions, but the *same* process can push a variable **up in one region and
down in another**. Arctic air warms several times faster than the global
average while parts of the southeastern US barely warm at all. A warming
atmosphere makes the Mediterranean drier while the Sahel gets wetter. Aerosol
pollution dims sunlight over South Asia while clean-air laws brighten Europe.

With thousands of variables on offer, the hard parts are (1) choosing variables
that could indicate change and (2) analyzing them rigorously. TrendScope makes
both parts point-and-click.

## What it does

- **Select variables.** A curated catalog of 11 variables from NASA POWER
  (temperature, precipitation, humidity, soil moisture, solar irradiance,
  wind, pressure), each annotated with why it matters for change detection.
- **Visualize change over time.** Interactive annual time-series charts
  (1981/1984 through the last complete year) with a hover crosshair and the
  fitted trend line.
- **What and how much.** Sen's slope gives the rate of change per decade and
  the total change over the record, in physical units and percent.
- **Is it significant?** The **Mann-Kendall test** (tie-corrected, the
  standard non-parametric trend test in climate science) produces a p-value.
  Trends with p < 0.05 are flagged significant. Ordinary least-squares
  regression (with a proper t-distribution p-value and r²) cross-checks it.
- **Where is it changing?** A one-click regional scan analyzes a 5x5 grid
  (about 8° across) around your point and paints each cell on the map:
  red = increasing, blue = decreasing, filled = significant, hollow = not.
- **Compare two regions.** Side-by-side analysis on a shared axis, with a
  plain-language summary (for example, "opposite significant trends"). Four
  preset comparison stories demonstrate regional divergence instantly.

## Data & methods

| Piece | Source |
|---|---|
| Time series | [NASA POWER API](https://power.larc.nasa.gov/): MERRA-2 reanalysis + CERES/FLASHFlux solar data, any point on Earth, 1981 to present, no API key |
| Basemap | [NASA GIBS](https://earthdata.nasa.gov/gibs) Blue Marble (+ OpenStreetMap option) |
| Trend test | Mann-Kendall S statistic with tie-corrected variance, then Z, then a two-sided p-value |
| Rate estimate | Sen's (Theil-Sen) slope: median of all pairwise slopes, robust to outlier years |
| Cross-check | OLS regression; p-value from Student's t (regularized incomplete beta), r² |

All statistics are computed **live in the browser**. No build step, no API
keys, no frameworks. The statistics engine is dependency-free and unit-tested
against known critical values.

Because the POWER API does not send CORS headers, browser requests are relayed
through a tiny Cloudflare Worker that forwards GET requests to
`power.larc.nasa.gov` unchanged and adds the `Access-Control-Allow-Origin`
header. The relay adds caching but never modifies the data.

## Running locally

It's a static site. Serve the folder any way you like:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Project structure

```
index.html        app shell
css/style.css     dark theme + layout
js/stats.js       statistics engine (Mann-Kendall, Sen's slope, OLS, t/beta functions)
js/power.js       NASA POWER client + variable catalog + regional grid scan
js/chart.js       SVG time-series chart with crosshair tooltip
js/app.js         map, UI state, verdict cards, compare mode
```

## Interpreting the output

A **significant** result (p < 0.05) means a monotonic trend this consistent
would arise less than 1 time in 20 from year-to-year noise alone. It does not
by itself identify the cause. A **not significant** result does not mean
"no change". It means the record at that point can't yet distinguish a trend
from variability. Comparing nearby points (the grid scan) shows how the same
process can be unambiguous in one region and undetectable in another.

## Acknowledgements

Data courtesy of the NASA Langley Research Center POWER Project, funded
through the NASA Earth Science Directorate Applied Science Program. Basemap
imagery courtesy of NASA Global Imagery Browse Services (GIBS).
