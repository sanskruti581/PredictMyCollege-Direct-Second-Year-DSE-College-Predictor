import { loadCutoffsForYears, loadMeta } from "./lib/loadData.js";
import { predictColleges } from "./lib/predict.js";
import { populateFilters, renderResults, renderError } from "./components/ui.js";

const form = document.getElementById("predict-form");
const resultsEl = document.getElementById("results");
const statusEl = document.getElementById("status");
let metaCache = null;

async function init() {
  statusEl.textContent = "Loading filters...";
  try {
    metaCache = await loadMeta();
    populateFilters(metaCache);
    statusEl.textContent = `Ready with ${metaCache.record_count.toLocaleString()} cutoff records across ${metaCache.years.join(", ")}.`;
  } catch (err) {
    renderError(`Could not load data: ${err.message}`, resultsEl);
    statusEl.textContent = "";
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const formData = new FormData(form);

  const percentile = parseFloat(formData.get("percentile"));
  const category = formData.get("category");
  const branch = formData.get("branch")?.trim() || null;
  const year = formData.get("year") || metaCache?.years.at(-1) || null;
  const includeStageII = formData.get("includeStageII") === "on";

  if (Number.isNaN(percentile) || percentile < 0 || percentile > 100) {
    renderError("Enter a valid percentage between 0 and 100.", resultsEl);
    return;
  }
  if (!category) {
    renderError("Select a category.", resultsEl);
    return;
  }

  try {
    statusEl.textContent = "Loading cutoff history...";
    // Simpler correct strategy: load all available years on submit so trend
    // ranking and indicators are complete on the first render.
    const cutoffs = await loadCutoffsForYears(metaCache.years);
    const results = predictColleges(cutoffs, {
      percentile,
      category,
      branch,
      year,
      stage: "I",
      includeStageII,
      canonicalBranchLabels: metaCache.canonical_branch_labels,
    });

    const stageText = includeStageII ? "Stage-I plus Stage-II opt-in" : "Stage-I only";
    statusEl.textContent = `Showing ${results.length} matches for ${year} (Round I, ${stageText}).`;
    renderResults(results, resultsEl);
  } catch (err) {
    renderError(`Could not load predictions: ${err.message}`, resultsEl);
    statusEl.textContent = "";
  }
});

init();
