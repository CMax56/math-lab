# Math Lab

A phone-friendly study site for 10th-grade math: practice problems with step-by-step hints, flashcards, quizzes, a make-up test list with countdowns, and a simple parent view.

- No backend, no accounts, no analytics, and no outside network calls.
- Progress is stored only in this browser on this device (or in a Home Screen install). It does not sync.
- Topics follow the class pacing guide (Geometry, Grade 10, 2026–2027), grouped into Terms 1–4. The problems are practice written for this site, not official class material.

You can add this site to an iPhone Home Screen from Safari (Share → Add to Home Screen). Offline use on a phone needs HTTPS hosting, such as GitHub Pages.

## Open it locally

```sh
python3 tools/validate.py
python3 tools/screenshots.py   # optional: headless smoke test + phone screenshots (needs playwright)
```

To browse it, serve the folder so it appears at `/math-lab/` (the GitHub Pages path in `index.html`'s `<base>`), for example from the parent folder after naming or linking the folder `math-lab`: `python3 -m http.server 8000`, then open http://localhost:8000/math-lab/.

Opening `index.html` as a file:// page will not work.

The first time you open **Parent**, you set a 4–8 digit PIN on this device. There is no default PIN. The PIN is a courtesy lock, not real security. If it is forgotten, clearing the site's data also erases progress and the make-up list. An optional first name can be set in the parent view.

## Content

### Terms (home screen sections)

`content/app.json` has a `terms` list, one entry per term of the pacing guide:

```json
{ "id": "t2", "label": "Term 2", "dates": "Oct 12 – Dec 18, 2026",
  "start": "2026-10-12", "end": "2026-12-18",
  "units": ["parallel-perpendicular", "congruence", "triangle-relationships"] }
```

The home screen shows one collapsible section per term. The term whose dates include today is open and marked **Now**. Between terms, the next term is shown as current; after the last term, the last one. A term may also have `groups` (labels such as "Algebra Review") over some of its units. A unit that is in no term still appears, under **Other**. Each unit page shows its term and dates. `tools/validate.py` checks that every term unit exists, appears only once, and that the dates parse and are in order. Keep the `units` list in the same (pacing) order. Strands (`geometry`, `algebra`) are still kept on each unit as data.

### Units and items

Units live in `content/units/` and are listed in `content/app.json`. To add a unit, create `content/units/<new-id>.json` and add `<new-id>` to that list. After changing app files, bump `VERSION` in `sw.js` so installed copies pick up the update.

Item JSON fields follow the existing unit files: `practice`, `flashcards`, and `quiz`, each with `hints` and a `solution`. Numeric items may include `acceptable` answers, `tolerance`, and `roundTo` (decimal places; student values are accepted if they half-up-round to the official answer).

Every practice item has an inline diagram (`figure`, drawn by `js/figures.js`): triangles and polygons, transversals, coordinate grids (lines, points, segments, and `shapes` polygons for transformations), number lines, balances, bar models, fractions (`frac`), factor tiles (`chips`: x·x·x groups for the product and power rules, numerator over denominator with optional cancel strokes for the quotient rule), and solids.

A unit may have an optional `reference` card, shown at the top of its unit page: `{ "title": "...", "rows": [{ "label": "Product rule", "rule": "x<sup>a</sup> · x<sup>b</sup> = x<sup>a+b</sup>", "note": "optional" }], "foot": "optional" }`. Rules may use `<sup>`, `<sub>`, `<b>`, and `<i>` only; `tools/validate.py` checks this. The Exponent Rules unit uses it for the rules from class.

## Make-up quizzes

`content/app.json` → `makeupQuizzes` lists quizzes the teacher asked to be made up or retaken. They appear in a **Make-up Quizzes** section at the top of the home screen with no setup, and each card links to a focused prep unit (`prepUnit`, for example `makeup-transversal`). Prep units use the `makeup` strand, are not part of any term, and may list `related` regular units.

On first load each quiz is also added once to the device's make-up list (no due date). Seeding never overwrites or duplicates a saved entry, and a quiz deleted from the list is not added back (its id is remembered in `seededMakeups`, which survives "reset progress").
