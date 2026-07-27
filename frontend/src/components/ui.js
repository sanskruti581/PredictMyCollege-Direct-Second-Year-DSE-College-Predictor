/**
 * ui.js
 * ------
 * Minimal DOM rendering helpers. Kept separate from main.js so the
 * wiring/orchestration logic and the "how things look" logic don't
 * tangle together. Swap this file out if you later move to
 * React/Vue/Svelte — predict.js and loadData.js don't need to change.
 */

export function populateFilters(meta) {
  const categorySelect = document.getElementById("category");
  meta.categories.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    categorySelect.appendChild(opt);
  });

  const branchList = document.getElementById("branch-list");
  const canonicalLabels = meta.canonical_branch_labels || {};
  (meta.canonical_branches || []).forEach((id) => {
    const opt = document.createElement("option");
    opt.value = canonicalLabels[id] || id;
    branchList.appendChild(opt);
  });

  meta.branches.forEach((b) => {
    const opt = document.createElement("option");
    opt.value = b;
    branchList.appendChild(opt);
  });

  const yearSelect = document.getElementById("year");
  meta.years
    .slice()
    .reverse()
    .forEach((y) => {
      const opt = document.createElement("option");
      opt.value = y;
      opt.textContent = y;
      yearSelect.appendChild(opt);
    });
}

export function renderResults(results, container) {
  container.innerHTML = "";

  if (results.length === 0) {
    container.innerHTML = `<p class="empty">No matches found. Try a different category, or remove the branch filter.</p>`;
    return;
  }


  const card = document.createElement("section");
  card.className = "results-card";
  card.innerHTML = `
    <div class="results-card-header">
      <h2>🎓 Predicted Colleges &mdash; ${results.length} match${results.length !== 1 ? 'es' : ''} found</h2>
      <p class="results-banner">Cutoff predictions are derived from official DSE CAP Round I merit lists.</p>
    </div>
    <div class="results-table-wrap">
      <div class="table-scroll"></div>
    </div>
  `;

  const table = document.createElement("table");
  table.className = "results-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>SL.NO</th>
        <th>INSTITUTE &amp; BRANCH</th>
        <th>TYPE</th>
        <th>CHANCE</th>
        <th>QUOTA</th>
        <th>CLOSING RANK</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");

  results.forEach((r, index) => {
    const type = extractCollegeType(r.college_name);
    const tr = document.createElement("tr");
    tr.className = `tier-${r.tier}`;
    tr.innerHTML = `
      <td>
        <span class="sl-badge sl-badge-${index % 2 === 0 ? "amber" : "blue"}">${index + 1}</span>
      </td>
      <td class="institute-cell">
        <span class="institute-name">${escapeHtml(type.name)}</span>
        <span class="branch-name">${escapeHtml(r.branch)}</span>
        ${renderStageBadge(r)}
      </td>
      <td><span class="type-badge">${escapeHtml(type.type)}</span></td>
      <td>${renderChance(r)}</td>
      <td><span class="quota-badge">${escapeHtml(r.category)}</span></td>
      <td>${renderTrend(r)}</td>
    `;
    tbody.appendChild(tr);
  });

  card.querySelector(".table-scroll").appendChild(table);
  container.appendChild(card);
}

export function renderError(message, container) {
  container.innerHTML = `<p class="error">${escapeHtml(message)}</p>`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function renderStageBadge(record) {
  const stage = record.stage || "I";
  const label = stage === "II" ? "Stage II" : "Stage I";
  const title =
    stage === "II"
      ? "Filled in Stage-II - seats from unfilled reserved quota"
      : "Filled in normal Stage-I allotment";
  const className = stage === "II" ? "stage-badge stage-badge-ii" : "stage-badge stage-badge-i";
  return `<span class="${className}" title="${escapeHtml(title)}">${escapeHtml(label)}</span>`;
}

function renderTrend(record) {
  const iconByTrend = {
    rising_difficulty: "&#9650;",
    falling_difficulty: "&#9660;",
    stable: "&#8212;",
  };
  const labelByTrend = {
    rising_difficulty: "Cutoff rising",
    falling_difficulty: "Cutoff falling",
    stable: "Stable",
  };
  const cutoffHistory = record.cutoffHistory || [];
  const history = cutoffHistory
    .slice(-3)
    .map((p) => `${escapeHtml(p.year)}: ${formatTrendPercentile(p.percentile)}`)
    .join(", ");
  const hasTrendData = cutoffHistory.length >= 2;
  const trend = hasTrendData ? record.trend || "stable" : "no_signal";
  const trendLabel = hasTrendData ? labelByTrend[trend] || "Stable" : "No trend data";
  const trendIcon = hasTrendData ? iconByTrend[trend] || "&#8212;" : "&middot;";

  return `
    <div class="closing-rank">
      <span class="rank-value">${formatRank(record.rank)}</span>
      <span class="percentile-value">${formatPercentile(record.percentile)}</span>
      <span class="trend trend-${trend}" title="${escapeHtml(trendLabel)}">
        <span class="trend-icon">${trendIcon}</span>
        <span class="trend-history">${escapeHtml(trendLabel)}${history ? `: ${history}` : ""}</span>
      </span>
    </div>
  `;
}

function renderChance(record) {
  const chance = {
    reach: { label: "Low", className: "low" },
    moderate: { label: "Good", className: "good" },
    safe: { label: "High", className: "high" },
  }[record.tier] || { label: record.tier || "-", className: "unknown" };

  const margin = Number.isFinite(record.margin) ? `${formatSigned(record.margin)} pts above cutoff` : "";
  return `
    <span class="chance-pill chance-${chance.className}">${escapeHtml(chance.label)}</span>
    ${margin ? `<span class="chance-margin">${margin}</span>` : ""}
  `;
}

function extractCollegeType(collegeName) {
  const name = collegeName || "";
  const match = name.match(/\s*\(([^()]*)\)\s*$/);
  if (!match) return { name, type: "-" };
  return {
    name: name.slice(0, match.index).trim(),
    type: match[1].trim() || "-",
  };
}

function formatRank(rank) {
  const value = Number(rank);
  return Number.isFinite(value) ? value.toLocaleString() : "-";
}

function formatPercentile(percentile) {
  const value = Number(percentile);
  return Number.isFinite(value) ? `${value.toFixed(2)}%ile` : "-";
}

function formatTrendPercentile(percentile) {
  const value = Number(percentile);
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : "-";
}

function formatSigned(value) {
  return value >= 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}
