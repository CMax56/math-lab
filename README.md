# Math Lab

A phone-friendly study site for 10th-grade math: practice problems with step-by-step hints, flashcards, quizzes, a make-up test list with countdowns, and a simple parent view.

- No backend, no accounts, no analytics, and no outside network calls.
- Progress is stored only in this browser on this device (or in a Home Screen install). It does not sync.
- The content is a **starter set** of typical 10th-grade topics (Geometry first, then Algebra review). It is not official class material.

You can add this site to an iPhone Home Screen from Safari (Share → Add to Home Screen). Offline use on a phone needs HTTPS hosting, such as GitHub Pages.

## Open it locally

```sh
python3 tools/validate.py
python3 -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` as a file:// page will not work.

The first time you open **Parent**, you set a 4–8 digit PIN on this device. There is no default PIN. The PIN is a courtesy lock, not real security. If it is forgotten, clearing the site's data also erases progress and the make-up list. An optional first name can be set in the parent view.

## Content

Units live in `content/units/` and are listed in `content/app.json`. To add a unit, create `content/units/<new-id>.json` and add `<new-id>` to that list. After changing app files, bump `VERSION` in `sw.js` so installed copies pick up the update.

Item JSON fields follow the existing unit files: `practice`, `flashcards`, and `quiz`, each with `hints` and a `solution`. Numeric items may include `acceptable` answers, `tolerance`, and `roundTo` (decimal places; student values are accepted if they half-up-round to the official answer).
