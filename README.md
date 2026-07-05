# Warfarin Manager (Clinical Pro)

Decision-support tool for warfarin dosing: **OPD** maintenance dose adjustment and **IPD**
initiation & LMWH bridging. For clinician decision support only — does not replace clinical
judgement or guideline-based management.

## Running it

No install, no server, no build step. Just open `index.html` in a browser (double-click, or
drag it into a browser window). Nothing is sent over a network and no patient data is stored —
close the tab and everything is gone.

## Project layout

```
index.html          Page structure only
css/styles.css       All styling, including print stylesheet
js/
  tabletOptimizer.js  Pure: tablet-combination DP (minimizes pill-splitting burden)
  bleedingRisk.js     Pure: HAS-BLED bleeding-risk score
  opd.js              Pure dosing math (warfarinAdjustment) + OPD DOM wiring
  ipd.js              Pure dosing decision (ipdDoseDecision) + IPD DOM wiring
  interactions.js     Categorized drug/diet interaction checklist (informational only)
  ui.js               Tab switching, inline field validation, collapsible sections
  app.js              Wires everything up on page load
tests/run.js          Plain Node test script for the pure logic (no framework/npm needed)
```

Scripts are loaded as plain `<script src>` tags (not ES modules) specifically so the page keeps
working when opened directly via `file://` — ES modules hit CORS restrictions under `file://`
in Chrome, which would break the "just double-click it" deployment story on a hospital PC.

## Running tests

```
node tests/run.js
```

Covers the tablet-combination optimizer, the OPD dose-adjustment math, the IPD day-by-day dose
decision, and the HAS-BLED score — all pure functions with no DOM dependency.

## Clinical scope note

The interaction checklist and HAS-BLED bleeding-risk calculator are **informational aids only**
— they surface warnings and feed into which IPD starting-dose branch is used, but they do not
automatically change the calculated dose. The core OPD/IPD dosing algorithm is unchanged from
the original single-file version; only additive fields were introduced. Any future change to the
core dosing math should be clinically reviewed before use.
