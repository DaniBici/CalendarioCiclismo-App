const OPERATIONS_STALE_AFTER_MS = Object.freeze({
  results: 3 * 60 * 1000,
  cx_results: 3 * 60 * 1000,
  broadcasts: 45 * 60 * 1000,
});

export function operationRunStatus(job, run, catalog, now = Date.now()) {
  if (job === 'uci_catalog' && catalog?.overdue) return 'error';
  const status = run?.status || 'unknown';
  const staleAfter = OPERATIONS_STALE_AFTER_MS[job];
  if (!staleAfter || !run?.startedAt || status === 'pending') return status;
  const startedAt = new Date(run.startedAt).getTime();
  return Number.isFinite(startedAt) && now - startedAt > staleAfter ? 'stale' : status;
}

export function selectOperationHistory(runs, perJob = 3) {
  const selected = [];
  const counts = new Map();
  for (const run of Array.isArray(runs) ? runs : []) {
    const count = counts.get(run.job) || 0;
    if (count >= perJob) continue;
    selected.push(run);
    counts.set(run.job, count + 1);
  }
  return selected;
}

export function shortOperationRevision(revision) {
  const value = String(revision || '').trim();
  return value ? value.slice(0, 12) : '';
}

export function operationSourceCatalog(configuredSources, sourceRuns) {
  const catalog = [...configuredSources];
  const known = new Set(catalog.map((source) => source.id));
  for (const row of Array.isArray(sourceRuns) ? sourceRuns : []) {
    const id = String(row?.source || '').trim();
    if (!id || known.has(id)) continue;
    catalog.push({ id, label: id.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') });
    known.add(id);
  }
  return catalog;
}
