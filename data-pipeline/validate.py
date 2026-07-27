"""
validate.py
------------
Sanity-checks parsed cutoff records before they ship to the frontend.
Run after parse_cutoffs.py, before build_dataset.py.

Usage:
    python validate.py data/cutoffs_2025-26.json
"""

import json
import sys


def validate(records, source_label=""):
    issues = []

    for i, r in enumerate(records):
        if r["percentile"] is None:
            issues.append(f"[{source_label}#{i}] missing percentile: "
                           f"{r['college_code']} {r['choice_code']} {r['category']}")
        elif not (0 <= r["percentile"] <= 100):
            issues.append(f"[{source_label}#{i}] percentile out of range: {r['percentile']}")
        if r["rank"] is not None and r["rank"] <= 0:
            issues.append(f"[{source_label}#{i}] non-positive rank: {r['rank']}")
        if not r["college_name"] or not r["branch"]:
            issues.append(f"[{source_label}#{i}] missing college_name/branch")

    # duplicate (college, choice_code, category, stage) should be unique
    seen = {}
    for i, r in enumerate(records):
        key = (r["college_code"], r["choice_code"], r["category"], r["stage"])
        if key in seen:
            issues.append(f"[{source_label}#{i}] duplicate record for {key} "
                           f"(also at #{seen[key]})")
        seen[key] = i

    return issues


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    total_issues = 0
    for path in sys.argv[1:]:
        with open(path) as f:
            records = json.load(f)
        issues = validate(records, source_label=path)
        total_issues += len(issues)
        print(f"{path}: {len(records)} records, {len(issues)} issues")
        for issue in issues[:20]:
            print("  -", issue)
        if len(issues) > 20:
            print(f"  ... and {len(issues) - 20} more")

    sys.exit(1 if total_issues else 0)
