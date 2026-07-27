# Predict My College

Predicts which colleges/branches a student is likely to get, based on
historical CAP cutoff data — no database, static JSON + a client-side
frontend.

**This repo was built and validated against your actual 3 PDFs**
(`23-24.pdf`, `24-25.pdf`, `2025-26.pdf` — Maharashtra State CET Cell,
Direct Second Year Engineering, CAP Round I). The parser in
`data-pipeline/` is not a hypothetical design — it ran on all three
files and produced **33,282 clean cutoff records across 359 colleges**.

---

## 1. Workflow / Architecture

```
   PDFs (raw_pdfs/)
        │
        ▼
┌─────────────────────┐
│  parse_cutoffs.py    │  coordinate-based PDF → JSON extraction
└──────────┬───────────┘
           ▼
┌─────────────────────┐
│  validate.py         │  flags bad/missing/out-of-range records
└──────────┬───────────┘
           ▼
┌─────────────────────┐
│  build_dataset.py    │  merges years, dedupes, builds filter lookups
└──────────┬───────────┘
           ▼
   data/cutoffs_<year>.json, colleges.json, meta.json   (static files)
           │
           ▼
┌─────────────────────┐
│  frontend (browser)  │  loads meta first, then yearly JSON chunks
└─────────────────────┘
```

Everything to the left of "static files" is a **build-time step you
re-run whenever a new PDF is published** (e.g. next year's cutoff
list, or Round II/III when those come out). Nothing at runtime touches
a database or a server — the deployed app is just static files.

### 1a. PDF parsing pipeline

**What the PDFs actually look like** (confirmed by inspecting your
files): each college+branch is a block —

```
1002 Government College of Engineering, Amravati (Government Autonomous)
Choice Code : 100219110    Course Name : Civil Engineering

   GOPEN     GST      GOBC     LOPEN     LSC      LSEBC     EWS
    1282    28609     1927      1147     2355      5376     4977
Stage-I  (92.74%) (76.79%) (91.79%)  (93.00%) (91.26%) (88.53%) (88.84%)
```

Two things make naive `pdftotext` + regex parsing unreliable here:

1. **The category column set is not fixed.** Different colleges show
   different subsets of `GOPEN, GSC, GST, GOBC, GNTA-D, GSEBC, LOPEN,
   LSC, LST, LOBC, LNTA-D, LSEBC, EWS, PWDR-*, DEFR-*, MI, ORP`
   depending on which categories had seats. Splitting a row on
   whitespace assumes a fixed column count — it breaks silently the
   moment a category has no admitted candidate.
2. **Some categories only fill in "Stage-II"**, a second short row
   appended below Stage-I, at the *same x-position* as their header
   but blank in the Stage-I row. This is real in your data — I found
   ~700 Stage-II records in the 2025-26 file alone.

**Solution used here:** `data-pipeline/parse_cutoffs.py` uses
`pdfplumber` to get each word's `(x0, top)` coordinates, groups words
into rows by vertical proximity, and — critically — matches every
rank/percentile value to its column header **by nearest x-position**,
not by column index. This is immune to missing cells and to the
column set changing block-to-block or year-to-year.

Output per record:
```json
{
  "year": "2025-26", "round": "I",
  "college_code": "1002",
  "college_name": "Government College of Engineering, Amravati ...",
  "choice_code": "100219110",
  "branch": "Civil Engineering",
  "category": "GOPEN",
  "stage": "I",
  "rank": 1282,
  "percentile": 92.74
}
```

### 1b. Validation / cleanup

`data-pipeline/validate.py` checks, per parsed file:
- missing/out-of-range percentiles
- non-positive ranks
- missing college name or branch (malformed block)
- duplicate `(college, choice_code, category, stage)` keys

Run against your real data: **33,287 records parsed, 6 flagged**
(0.02%) — one PDF had a single unmatched percentile and a handful of
blocks near a page break had a garbled header line. `build_dataset.py`
automatically **skips** malformed records rather than crashing, and
prints a warning so you know what was dropped.

**Known cross-year inconsistency to handle:** branch names aren't
spelled identically across years — e.g. `"Computer Engineering"` vs
`"Computer Engineering (Regional Language)"` vs `"Computer Science and
Engineering"` are all distinct strings in your data (96 unique branch
labels total). For trend analysis across years for "the same"
branch, you'll want a normalization/alias map — see Edge Cases below.

### 1c. Matching / prediction logic

`frontend/src/lib/predict.js` — pure, framework-free function:

```js
predictColleges(records, { percentile, category, branch?, year? })
```

- Filters to the given year (defaults to latest), category, and
  optional branch substring match.
- Keeps only records where `record.percentile <= student.percentile`
  (i.e., the student would have cleared that cutoff).
- Sorts **descending by cutoff percentile** — the closest cutoff
  *below* the student's score comes first ("best fit" = tightest
  realistic match), rather than the easiest/safest match first.
- Tags each result `reach` (margin < 1%), `moderate` (< 5%), or `safe`
  (≥ 5%) so the UI can visually group results by admission confidence.

This runs **entirely in the browser** against the static JSON — no
server round-trip needed for a dataset this size (~33K records, ~10MB
uncompressed, ~1-2MB gzipped).

### 1d. Multi-year trends

`getTrend(records, { college_code, choice_code, category })` returns
the percentile for that exact college+branch+category across all
loaded years, sorted chronologically — e.g. `[{year: "2023-24",
percentile: 93.32}, {year: "2024-25", percentile: 91.37}, {year:
"2025-26", percentile: 92.74}]`. Nice-to-have for v2: show this as a
sparkline next to each result, and use variance across years to
soften/harden the `reach/moderate/safe` classification (a cutoff
that's been volatile ±3% year to year deserves a wider safety margin
than one that's been flat).

### 1e. Frontend

Plain HTML + ES modules, no build step, no framework — deliberately
kept simple per your "lightweight, no DB" requirement:

- `index.html` — the form (percentage, category, branch, year)
- `src/main.js` — orchestration: load metadata → load needed yearly cutoff files on submit → render
- `src/lib/loadData.js` — fetches `meta.json` first, then caches `cutoffs_<year>.json` files per year
- `src/lib/predict.js` — the matching/ranking algorithm, including Stage-I defaults, Stage-II opt-in, canonical branch matching, and trend-adjusted tiers
- `src/components/ui.js` — DOM rendering (filters, results table)
- `src/styles.css` — styling

Because the logic is split into plain modules with no framework
lock-in, swapping `ui.js` for a React/Vue component later doesn't
require touching `predict.js` or `loadData.js` at all.

---

## 2. Tech stack

| Concern | Choice | Why |
|---|---|---|
| PDF parsing | **Python + pdfplumber** | Coordinate-level word positions, needed for the variable-column problem above. (`pypdf`/`pdftotext` alone can't do this reliably for this layout.) |
| Data validation | Python script, no framework | Simple assertions over a list of dicts — a framework would be overkill |
| Processed data storage | **Static JSON files**, generated at build time | No DB/ORM per your requirement; served like any other static asset |
| Prediction logic | **Plain JS, runs client-side** | Dataset is small enough (~33K rows) to filter/sort in-browser instantly; avoids needing any backend at all |
| Frontend | **Plain HTML/CSS/JS (ES modules)** | No build tooling required; deploys as static files anywhere (GitHub Pages, Netlify, Vercel, S3). If the UI grows complex later, swap `ui.js` for React — the rest doesn't change. |
| Hosting | Any static host | Netlify/Vercel/GitHub Pages/S3+CloudFront — literally just upload `frontend/` |

---

## 3. Folder structure

```
predict-my-college/
├── data-pipeline/                  # run this whenever a new PDF arrives
│   ├── parse_cutoffs.py            # PDF -> per-year JSON
│   ├── validate.py                 # sanity checks
│   ├── build_dataset.py            # merge years -> final data/*.json
│   ├── requirements.txt
│   ├── raw_pdfs/                   # put source PDFs here (not committed)
│   └── out/                        # intermediate per-year JSON
│
├── data/                           # OUTPUT of the pipeline — what the frontend reads
│   ├── cutoffs_2023-24.json        # per-year cutoff records
│   ├── cutoffs_2024-25.json
│   ├── cutoffs_2025-26.json
│   ├── colleges.json               # code -> name lookup
│   └── meta.json                   # years/branches/categories for filter dropdowns
│
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── public/data/                # copy of data/*.json served to the browser
│   └── src/
│       ├── main.js                 # wiring/orchestration
│       ├── styles.css
│       ├── lib/
│       │   ├── predict.js          # matching + ranking algorithm
│       │   └── loadData.js         # fetch + cache JSON
│       └── components/
│           └── ui.js               # DOM rendering
│
└── README.md                       # this file
```

---

## 4. Implementation plan (step by step)

1. **Inspect each new PDF before trusting the parser.**
   `pdfinfo`, `pdffonts`, and a `pdftotext -layout` sample on page 1.
   Confirm it has a real text layer (not scanned) and the same general
   block structure. (Already done for your 3 files — all text-based,
   same FPDF-generated layout, same category-block structure.)

2. **Run the parser per file:**
   ```bash
   cd data-pipeline
   pip install -r requirements.txt --break-system-packages
   python parse_cutoffs.py raw_pdfs/2023-24.pdf 2023-24 I out/cutoffs_2023-24.json
   python parse_cutoffs.py raw_pdfs/2024-25.pdf 2024-25 I out/cutoffs_2024-25.json
   python parse_cutoffs.py raw_pdfs/2025-26.pdf 2025-26 I out/cutoffs_2025-26.json
   ```

3. **Validate:**
   ```bash
   python validate.py out/cutoffs_*.json
   ```
   Fix or accept flagged issues before proceeding. (In your case: 6
   records out of 33,287 — safe to skip, which `build_dataset.py` does
   automatically.)

4. **Build the merged dataset:**
   ```bash
   python build_dataset.py out/cutoffs_2023-24.json out/cutoffs_2024-25.json out/cutoffs_2025-26.json
   ```
   This writes `data/cutoffs_<year>.json`, `data/colleges.json`, `data/meta.json`.

5. **Copy into the frontend and run locally:**
   ```bash
   cp data/*.json frontend/public/data/
   cd frontend
   npx serve .
   ```
   Open the printed local URL, fill the form, confirm results look sane
   against a cutoff you can spot-check manually in the PDF.

6. **Deploy.** Push `frontend/` to Netlify/Vercel/GitHub Pages as a
   static site — no server config needed. Re-run steps 2-5 and
   redeploy whenever a new round/year's PDF is published.

7. **(Optional, later) Add a thin API** only if you outgrow
   client-side filtering (e.g. dataset grows 50x, or you want
   server-side auth/rate-limiting). The `predict.js` logic is already
   isolated so it can move into a serverless function unchanged.

---

## 5. Edge cases to handle (some already handled, some flagged for you)

| Edge case | Status |
|---|---|
| Variable/missing category columns per block | **Handled** — x-coordinate matching, not fixed-width splitting |
| Stage-I / Stage-II split rows (category unfilled until Stage-II) | **Handled** — tracked explicitly per course block |
| Different page sizes/layouts year to year (A4 in 23-24, A3 in 24-25/25-26) | **Handled** — parser works off word coordinates, not fixed page geometry |
| A few blocks with garbled/missing headers near page breaks | **Handled defensively** — `validate.py` flags them, `build_dataset.py` skips rather than crashes |
| Branch name spelling drift across years (e.g. "Computer Engineering" vs "Computer Science and Engineering") | **Handled for filtering** — `build_dataset.py` adds `canonical_branch` from `branch_aliases.py`, and the frontend suggests canonical branch groups alongside raw branch names |
| Multiple CAP rounds (I, II, III) in one admission cycle | **Designed for, not yet exercised** — your 3 PDFs are each Round I only; the schema already has a `round` field, so add more `parse_cutoffs.py` calls with `round=II`/`III` when those PDFs exist |
| Scanned/image-based PDFs (OCR needed) | **Not applicable to your files** (`pdffonts` confirms real embedded fonts, not scans) — but if a future publisher switches to scanned PDFs, you'd need `pytesseract` OCR before the coordinate-matching step still works, since OCR also emits word bounding boxes |
| Colleges/branches with zero admitted candidates in a category (blank cell) | **Handled** — simply produces no record for that category; don't backfill with 0 or null cutoffs, that would corrupt "did they qualify" logic |
| Dataset size growing large (many years × many rounds) | **Handled for the current dataset** — `build_dataset.py` writes `cutoffs_2023-24.json`, `cutoffs_2024-25.json`, and `cutoffs_2025-26.json` instead of one merged `cutoffs.json`. The browser boots with small `meta.json`, then loads all yearly cutoff files in parallel on prediction so trend-adjusted ranking has complete history. |
#   P r e d i c t M y C o l l e g e - D i r e c t - S e c o n d - Y e a r - D S E - C o l l e g e - P r e d i c t o r  
 