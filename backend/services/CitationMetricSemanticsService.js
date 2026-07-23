const SEMANTICS_VERSION = 'explicit-citation-v2';

function semanticsVersion(metric) {
  return String(metric?.analysis_structure?.citations?.semantics_version || '').trim();
}

function isCoreKpiEligible(metric) {
  return semanticsVersion(metric) === SEMANTICS_VERSION;
}

function citationCount(metric, field = 'citation_count') {
  if (!isCoreKpiEligible(metric)) return 0;
  const value = Number(metric?.[field] || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function normalizeForRead(metric) {
  if (!metric || typeof metric !== 'object') return metric;
  const sources = Array.isArray(metric.citation_sources) ? metric.citation_sources : [];
  const count = Number(metric.citation_count || 0);
  const ownedCount = Number(metric.owned_citation_count || 0);
  const competitorCount = Number(metric.competitor_citation_count || 0);
  if (isCoreKpiEligible(metric)) {
    return {
      ...metric,
      citation_count: Number.isFinite(count) && count > 0 ? count : 0,
      owned_citation_count: Number.isFinite(ownedCount) && ownedCount > 0 ? ownedCount : 0,
      competitor_citation_count: Number.isFinite(competitorCount) && competitorCount > 0 ? competitorCount : 0,
      citation_evidence_status: 'explicit'
    };
  }
  return {
    ...metric,
    citation_count: 0,
    owned_citation_count: 0,
    competitor_citation_count: 0,
    citation_sources: [],
    citation_evidence_status: 'legacy_unverified',
    ...(count > 0 || sources.length
      ? {
          legacy_citation_count: Number.isFinite(count) && count > 0 ? count : sources.length,
          legacy_citation_sources: sources
        }
      : {})
  };
}

module.exports = {
  SEMANTICS_VERSION,
  semanticsVersion,
  isCoreKpiEligible,
  citationCount,
  normalizeForRead
};
