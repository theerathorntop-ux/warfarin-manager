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

## Hospital-branded editions

`mahachai2/` is a rebranded edition for internal use at Mahachai 2 Hospital. It does **not**
duplicate the dosing logic — its `index.html` loads the same `../css/styles.css` and `../js/*.js`
files as the root app, so any future fix to the core OPD/IPD math applies to every edition
automatically. It only adds:

- `mahachai2/css/hospital.css` — overrides the `--brand-*` CSS custom properties defined at the
  top of `css/styles.css` (colors only; layout/logic untouched) and styles the header/logo block.
- `mahachai2/img/mh2-logo.png` — the hospital's logo.
- Its own `index.html` with a `<header class="hospital-header">` (logo + hospital name) and a
  hospital line in the footer, otherwise identical markup to the root page.

To create another hospital's edition, copy the `mahachai2/` folder, swap the logo image, update
the hospital name text and `--brand-*` colors in its `hospital.css`, and update the `<title>`.

## Clinical scope note

The interaction checklist and HAS-BLED bleeding-risk calculator do not change the OPD dose. In
IPD, HAS-BLED ≥ 3, any warfarin-sensitivity factor, or a checked INR-raising drug selects the
reduced (2.5 mg) starting-dose branch.

**v2.1 changes to the dosing logic (require clinical review before use):**

- OPD trend correction applies only when the INR is out of range; a fast-rising low INR halves
  the increase (it never turns into a decrease), and a fast-falling high INR no longer weakens the
  reduction.
- Suggested regimens must move the dose in the target direction and land within 5% (or 1 mg/wk)
  of the target, relaxed to 10% / 1.5 mg only if nothing fits. Each option shows its actual %
  change. Skip-day regimens no longer get a scoring bonus.
- Day-by-day entry adds an "adjust current regimen" option that changes as few days as possible.
- Stable patient with a single INR ≤ 0.5 outside the range (CHEST 2012): keep the current dose,
  recheck in 1–2 weeks.
- New OPD bleeding field (major → emergency management; minor → advisory, recheck ≤ 1 week),
  mechanical-valve low-INR bridging advisory, and enoxaparin renal adjustment note.

Still open for the clinical team: whether the standard IPD starting dose should be 5 mg or a
lower dose (e.g. 3 mg) for this patient population.
