/**
 * loadData.js
 * ------------
 * Fetches the static JSON dataset produced by the data-pipeline and
 * caches it in memory for the session. No backend involved.
 */

const _cutoffsByYearCache = new Map();
let _metaCache = null;

export async function loadCutoffsForYear(year) {
  if (_cutoffsByYearCache.has(year)) return _cutoffsByYearCache.get(year);
  const records = await fetchJson(`cutoffs_${year}.json`);
  _cutoffsByYearCache.set(year, records);
  return records;
}

export async function loadCutoffsForYears(years) {
  const perYear = await Promise.all(years.map((year) => loadCutoffsForYear(year)));
  return perYear.flat();
}

export async function loadMeta() {
  if (_metaCache) return _metaCache;
  _metaCache = await fetchJson("meta.json");
  return _metaCache;
}

async function fetchJson(fileName) {
  const paths = [`/data/${fileName}`, `/public/data/${fileName}`];
  let lastStatus = "";

  for (const path of paths) {
    const res = await fetch(path);
    if (res.ok) return res.json();
    lastStatus = `${path}: ${res.status}`;
  }

  throw new Error(`Failed to load ${fileName} (${lastStatus})`);
}
