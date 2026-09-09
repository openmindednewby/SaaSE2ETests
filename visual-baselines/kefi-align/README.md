# kefi teachers-grid align-items BASELINE (BEFORE)

Captured 2026-09-08, live https, read-only. Six live tenant hosts x 4 widths (390/768/1024/1440).
Files: `<slug>-<width>-before.png` (fullPage screenshots), `metrics-before.json` (computed
align-items, per-row card heights, gaps, overflow), `capture.js` (the capture script).

Re-run the identical pass after the `template-1.css:512` deploy with:
    PHASE=after node capture.js
then diff `<slug>-<width>-before.png` against `<slug>-<width>-after.png` and the two JSON files.

Reference state BEFORE the change:
- csdf   -> data-template=csdf, align-items:start, row card heights differ by up to 110px (ragged bottoms).
- ubb/ubs/kucy/kizomba-union-cy/united-by-salsa -> align-items:normal (grid default = stretch),
  every card in a row identical height (spread 0px at all four widths).
The change makes the six match csdf. Expect ragged bottoms to APPEAR; that is the intended delta,
not a regression.

demo.kefi.dloizides.com has no ingress host (curl 000) and was not captured.

## Capture caveat (not a site defect)
Some PNGs are wider than the requested viewport (e.g. csdf-390 is 419px, ubb-768 is 829px).
Measured on the live pages, `documentElement.scrollWidth === window.innerWidth === 390` for all
five hosts tested, so the pages have NO horizontal overflow. The extra width is Playwright's
fullPage capture including the off-canvas mobile nav drawer (`UL.nav-links`, position:fixed,
translated off-screen). The after pass uses the same script, so the artifact is identical on
both sides and does not affect the diff.
