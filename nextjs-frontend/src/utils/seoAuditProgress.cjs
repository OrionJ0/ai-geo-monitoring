function discoveryPercent(discoveredPages) {
  const discovered = Math.max(0, Number(discoveredPages || 0));
  return Math.min(24, 12 + Math.round(Math.log2(discovered + 1) * 3));
}

function crawlingPercent(auditedPages) {
  const audited = Math.max(0, Number(auditedPages || 0));
  return Math.min(90, 30 + Math.round((60 * audited) / (audited + 20)));
}

function calculateSeoAuditProgressPercent(progress = {}, jobStatus = '') {
  const phase = progress.phase || jobStatus || 'queued';
  if (phase === 'completed' || jobStatus === 'completed') return 100;
  if (phase === 'crawling') return crawlingPercent(progress.auditedPages);
  if (phase === 'discovering') return discoveryPercent(progress.discoveredPages);
  if (phase === 'failed' || jobStatus === 'failed') {
    return Number(progress.auditedPages || 0) > 0
      ? crawlingPercent(progress.auditedPages)
      : discoveryPercent(progress.discoveredPages);
  }
  if (phase === 'running' || jobStatus === 'running') return 12;
  return 6;
}

module.exports = { calculateSeoAuditProgressPercent };
