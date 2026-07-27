"""
parse_cutoffs.py
-----------------
Parses Maharashtra State CET Cell "Provisional Cutoff List" PDFs
(Direct Second Year Engineering CAP rounds) into structured JSON.

Usage:
    python parse_cutoffs.py <input.pdf> <year_label> <round_label> <output.json>

Example:
    python parse_cutoffs.py raw_pdfs/2025-26.pdf 2025-26 I data/cutoffs_2025-26.json

Why coordinate-based parsing (not plain pdftotext/regex splitting):
    Each college/course block has a VARIABLE number of category columns
    (GOPEN, GSC, GST, GOBC, GNTA-D, GSEBC, LOPEN, LSC, LST, LOBC, LNTA-D,
    LSEBC, EWS, PWDR-*, DEFR-*, MI, ...). Some categories have NO seat
    filled in Stage-I and only appear in a separate "Stage-II" row below,
    at the SAME x-position as their column header but with gaps in
    Stage-I. Splitting on whitespace breaks silently when a cell is
    blank (misaligns every value after the gap). Matching each number to
    the nearest column header by x-coordinate is robust to blanks and to
    the changing column count/order between colleges and between years.
"""

import json
import re
import sys
from collections import defaultdict

import pdfplumber

CATEGORY_RE = re.compile(r"^[A-Z]{2,10}(-[A-Z]{2,6})?$")
RANK_RE = re.compile(r"^\d{1,7}$")
PCTL_RE = re.compile(r"^\(([\d.]+)%\)$")
COLLEGE_HEADER_RE = re.compile(r"^(\d{3,5})$")  # college code, first token on its line

X_TOLERANCE = 12  # points; how close a value's x0 must be to a header's x0


def group_rows(words, y_tol=3.5):
    """Group words into text rows by vertical proximity (sequential clustering).

    Rounding `top` to fixed buckets breaks when a row's baseline drifts by
    a couple points (common with mixed bold/regular fonts on the same
    logical row, e.g. the "Stage-I" label vs. its percentile values).
    Sequential clustering -- compare each word to the last word placed in
    the current row -- tolerates that drift while still splitting rows
    that are genuinely far apart (e.g. rank row vs. stage label below it).
    """
    ordered = sorted(words, key=lambda w: (w["top"], w["x0"]))
    rows = []
    current = []
    last_top = None
    for w in ordered:
        if last_top is not None and abs(w["top"] - last_top) > y_tol:
            rows.append(current)
            current = []
        current.append(w)
        last_top = w["top"]
    if current:
        rows.append(current)
    return [sorted(r, key=lambda w: w["x0"]) for r in rows]


def nearest_header(x0, headers):
    """Find the header word whose x0 is closest to this value's x0."""
    best, best_dist = None, None
    for h in headers:
        d = abs(h["x0"] - x0)
        if best_dist is None or d < best_dist:
            best, best_dist = h, d
    if best_dist is not None and best_dist <= X_TOLERANCE:
        return best["text"]
    return None


def parse_pdf(path, year_label, round_label):
    records = []
    current_college_code = None
    current_college_name = None
    current_choice_code = None
    current_branch = None
    pending_headers = None  # list of {"text": cat, "x0": x0}
    stage1_ranks_seen = False

    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
            rows = group_rows(words)

            for row in rows:
                texts = [w["text"] for w in row]
                line = " ".join(texts)

                # --- College header line: "1002 Government College of ..." ---
                # Must start with a short numeric code followed by WORDS, not
                # another row of pure numbers (which would be a Stage-II rank row).
                if (COLLEGE_HEADER_RE.match(texts[0]) and "Choice" not in line
                        and len(texts) > 1 and not RANK_RE.match(texts[1])):
                    current_college_code = texts[0]
                    current_college_name = " ".join(texts[1:])
                    continue

                # --- Choice Code / Course Name line ---
                if texts[:2] == ["Choice", "Code"]:
                    m = re.search(r"Choice Code\s*:\s*(\d+)", line)
                    n = re.search(r"Course Name\s*:\s*(.+)$", line)
                    current_choice_code = m.group(1) if m else None
                    current_branch = n.group(1).strip() if n else None
                    pending_headers = None
                    stage1_ranks_seen = False
                    continue

                # --- Category header row (all tokens look like category codes) ---
                if len(texts) >= 1 and all(CATEGORY_RE.match(t) for t in texts):
                    pending_headers = [{"text": w["text"], "x0": w["x0"]} for w in row]
                    stage1_ranks_seen = False
                    continue

                # --- Stage-I percentile row ---
                if texts[0] == "Stage-I" and pending_headers:
                    _attach_percentiles(row[1:], pending_headers, records,
                                         year_label, round_label, current_college_code,
                                         current_choice_code, stage="I")
                    continue

                # --- Stage-II percentile row ---
                if texts[0] == "Stage-II" and pending_headers:
                    _attach_percentiles(row[1:], pending_headers, records,
                                         year_label, round_label, current_college_code,
                                         current_choice_code, stage="II")
                    continue

                # --- Bare rank value row (Stage-I ranks, or Stage-II ranks) ---
                if pending_headers and texts and all(RANK_RE.match(t) for t in texts):
                    stage = "II" if stage1_ranks_seen else "I"
                    stage1_ranks_seen = True
                    for w in row:
                        cat = nearest_header(w["x0"], pending_headers)
                        if cat:
                            records.append(_new_record(
                                year_label, round_label, current_college_code,
                                current_college_name, current_choice_code,
                                current_branch, cat, stage, rank=int(w["text"]),
                            ))
                    continue

    return records


def _new_record(year, rnd, college_code, college_name, choice_code, branch,
                 category, stage, rank):
    return {
        "year": year,
        "round": rnd,
        "college_code": college_code,
        "college_name": college_name,
        "choice_code": choice_code,
        "branch": branch,
        "category": category,
        "stage": stage,
        "rank": rank,
        "percentile": None,
    }


def _attach_percentiles(value_words, headers, records, year, rnd, college_code,
                         choice_code, stage):
    for w in value_words:
        m = PCTL_RE.match(w["text"])
        if not m:
            continue
        cat = nearest_header(w["x0"], headers)
        if not cat:
            continue
        pctl = float(m.group(1))
        # attach to the most recent matching rank record awaiting a percentile
        for rec in reversed(records):
            if (rec["year"] == year and rec["round"] == rnd
                    and rec["college_code"] == college_code
                    and rec["choice_code"] == choice_code
                    and rec["category"] == cat
                    and rec["stage"] == stage
                    and rec["percentile"] is None):
                rec["percentile"] = pctl
                break


if __name__ == "__main__":
    if len(sys.argv) != 5:
        print(__doc__)
        sys.exit(1)
    in_pdf, year_label, round_label, out_json = sys.argv[1:5]
    recs = parse_pdf(in_pdf, year_label, round_label)
    with open(out_json, "w") as f:
        json.dump(recs, f, indent=2)
    print(f"Parsed {len(recs)} records -> {out_json}")
