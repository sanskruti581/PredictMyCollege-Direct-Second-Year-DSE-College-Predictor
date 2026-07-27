"""
build_dataset.py
------------------
Builds static per-year cutoff JSON files consumed by the frontend, plus
small lookup/meta files used to populate filter dropdowns without scanning
the full dataset client-side.

Usage:
    python build_dataset.py out/cutoffs_2023-24.json out/cutoffs_2024-25.json out/cutoffs_2025-26.json
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

from branch_aliases import CANONICAL_BRANCH_LABELS, canonical_branch_for

OUT_DIR = Path(__file__).resolve().parent.parent / "data"


def build(paths):
    all_records = []
    skipped = 0
    for p in paths:
        with open(p) as f:
            for r in json.load(f):
                if (
                    not r["college_name"] or
                    not r["branch"] or
                    not r["college_code"] or
                    r["percentile"] is None
                ):
                    skipped += 1
                    continue
                all_records.append(r)
    if skipped:
        print(f"Skipped {skipped} malformed record(s) missing college/branch/percentile "
              f"(see validate.py output for details)")

    # Assign a stable id to each record for frontend keys / linking years together
    for i, r in enumerate(all_records):
        r["id"] = i
        r["canonical_branch"] = canonical_branch_for(r["branch"])

    colleges = {}
    branches = set()
    canonical_branches = set()
    categories = set()
    years = set()

    for r in all_records:
        colleges[r["college_code"]] = r["college_name"]
        branches.add(r["branch"])
        canonical_branches.add(r["canonical_branch"])
        categories.add(r["category"])
        years.add(r["year"])

    meta = {
        "years": sorted(years),
        "branches": sorted(branches),
        "canonical_branches": sorted(canonical_branches),
        "canonical_branch_labels": {
            c: CANONICAL_BRANCH_LABELS.get(c, c)
            for c in sorted(canonical_branches)
        },
        "categories": sorted(categories),
        "college_count": len(colleges),
        "record_count": len(all_records),
    }
    colleges_out = [{"code": c, "name": n} for c, n in sorted(colleges.items())]

    OUT_DIR.mkdir(exist_ok=True)
    records_by_year = defaultdict(list)
    for r in all_records:
        records_by_year[r["year"]].append(r)

    for year, records in records_by_year.items():
        with open(OUT_DIR / f"cutoffs_{year}.json", "w") as f:
            json.dump(records, f)

    for old_path in OUT_DIR.glob("cutoffs.json"):
        old_path.unlink()

    with open(OUT_DIR / "colleges.json", "w") as f:
        json.dump(colleges_out, f)
    with open(OUT_DIR / "meta.json", "w") as f:
        json.dump(meta, f, indent=2)

    print(f"Wrote {len(all_records)} records in {len(records_by_year)} year files, "
          f"{len(colleges_out)} colleges -> {OUT_DIR}")
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    build(sys.argv[1:])
