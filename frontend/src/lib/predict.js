/**
 * predict.js
 * -----------
 * Pure functions for matching a student's percentile against the cutoff
 * dataset. No DOM/UI code here — keeps the algorithm testable and reusable
 * (e.g. if you later move this into a tiny API instead of running it
 * client-side).
 */

/**
 * @param {Array} records   loaded cutoff records, usually all years for trend ranking
 * @param {Object} input
 * @param {number} input.percentile   student's percentile/percentage (0-100)
 * @param {string} input.category     e.g. "GOPEN", "GSC", "LOPEN" ...
 * @param {string} [input.branch]     optional exact/substring branch filter
 * @param {string} [input.year]       optional year filter, defaults to latest year present
 * @param {string} [input.stage]      defaults to "I"
 * @param {boolean} [input.includeStageII] explicit opt-in for Stage-II rows
 * @param {Object} [input.canonicalBranchLabels] canonical id -> display label map
 * @param {number} [input.limit]      max results, default 50
 * @returns {Array} ranked matches, best fit first
 */
export function predictColleges(records, input) {
  const {
    percentile,
    category,
    branch = null,
    year = null,
    stage = "I",
    includeStageII = false,
    canonicalBranchLabels = {},
    limit = 50,
  } = input;

  if (percentile == null || !category) {
    throw new Error("percentile and category are required");
  }

  const targetYear = year || latestYear(records);

  const matchesBranch = buildBranchMatcher(records, branch, canonicalBranchLabels);
  const trendIndex = buildTrendIndex(records);
  const allowedStages = includeStageII ? new Set([stage, "II"]) : new Set([stage]);

  const matches = records.filter((r) => {
    if (r.year !== targetYear) return false;
    if (r.category !== category) return false;
    if (!allowedStages.has(r.stage)) return false;
    if (r.percentile == null || r.percentile > percentile) return false; // must be eligible
    if (!matchesBranch(r)) return false;
    return true;
  });

  // "Best fit" = closest cutoff BELOW the student's percentile first.
  // A cutoff far below their score means significant safety margin but
  // also likely means they could aim higher, so we surface tight matches
  // first and let the UI additionally group into safety tiers.
  matches.sort((a, b) => b.percentile - a.percentile);

  return matches.slice(0, limit).map((r) => ({
    ...r,
    ...classifyWithTrend(percentile, getTrendFromIndex(trendIndex, r)),
  }));
}

/** Safety/ambitious/reach classification based on percentile margin. */
function classifyTier(margin) {
  if (margin < 1) return "reach"; // just barely qualifies, risky in practice since cutoffs fluctuate
  if (margin < 5) return "moderate";
  return "safe";
}

/**
 * Classify the latest cutoff with a small multi-year trend adjustment.
 * Higher cutoff percentiles are harder to clear, so increasing percentiles
 * are unfavorable and decreasing percentiles are favorable for the student.
 */
export function classifyWithTrend(percentile, cutoffHistory) {
  const latest = cutoffHistory.at(-1);
  const margin = latest ? +(percentile - latest.percentile).toFixed(2) : 0;
  const baseTier = classifyTier(margin);
  const trend = classifyTrend(cutoffHistory);

  let tier = baseTier;
  if (baseTier === "reach" && trend === "falling_difficulty") {
    tier = "moderate";
  } else if (baseTier === "safe" && trend === "rising_difficulty") {
    tier = "moderate";
  }

  return {
    margin,
    tier,
    baseTier,
    trend,
    cutoffHistory,
  };
}

function classifyTrend(cutoffHistory) {
  if (cutoffHistory.length < 2) return "no_signal";
  const recent = cutoffHistory.slice(-3);
  const first = recent[0].percentile;
  const last = recent.at(-1).percentile;
  const slope = (last - first) / (recent.length - 1);

  if (slope > 0.25) return "rising_difficulty";
  if (slope < -0.25) return "falling_difficulty";
  return "stable";
}

export function latestYear(records) {
  return records.reduce((max, r) => (r.year > max ? r.year : max), records[0]?.year ?? "");
}

/**
 * Multi-year trend for a specific college+branch+category, used to show
 * "cutoff has been rising/falling" context and a rough confidence signal.
 */
export function getTrend(records, { college_code, choice_code, category }) {
  return records
    .filter(
      (r) =>
        r.college_code === college_code &&
        r.choice_code === choice_code &&
        r.category === category &&
        r.percentile != null
    )
    .sort((a, b) => a.year.localeCompare(b.year))
    .map((r) => ({ year: r.year, percentile: r.percentile }));
}

function buildTrendIndex(records) {
  const index = new Map();
  for (const r of records) {
    if (r.percentile == null) continue;
    const key = trendKey(r);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ year: r.year, percentile: r.percentile });
  }
  for (const history of index.values()) {
    history.sort((a, b) => a.year.localeCompare(b.year));
  }
  return index;
}

function getTrendFromIndex(index, record) {
  return index.get(trendKey(record)) || [{ year: record.year, percentile: record.percentile }];
}

function trendKey({ college_code, choice_code, category, stage }) {
  return `${college_code}|${choice_code}|${category}|${stage || "I"}`;
}

function buildBranchMatcher(records, branch, canonicalBranchLabels) {
  const branchNeedle = branch ? normalize(branch) : null;
  if (!branchNeedle) return () => true;

  const canonicalByRawBranch = new Map();
  const canonicalById = new Map();
  const canonicalByLabel = new Map();

  for (const [id, label] of Object.entries(canonicalBranchLabels || {})) {
    canonicalByLabel.set(normalize(label), id);
  }

  for (const r of records) {
    if (!r.canonical_branch) continue;
    canonicalById.set(normalize(r.canonical_branch), r.canonical_branch);
    canonicalByRawBranch.set(normalize(r.branch), r.canonical_branch);
  }

  const canonicalMatch =
    canonicalByLabel.get(branchNeedle) ||
    canonicalByRawBranch.get(branchNeedle) ||
    canonicalById.get(branchNeedle);

  if (canonicalMatch) {
    return (r) => r.canonical_branch === canonicalMatch;
  }

  return (r) =>
    normalize(r.branch).includes(branchNeedle) ||
    normalize(r.canonical_branch).includes(branchNeedle);
}

function normalize(s) {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}
