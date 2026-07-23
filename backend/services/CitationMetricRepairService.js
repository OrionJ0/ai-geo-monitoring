const { Op } = require('sequelize');
const { VisibilityMetric, ResultDetail } = require('../models');
const CitationAnalysisService = require('./CitationAnalysisService');

const SEMANTICS_VERSION = 'explicit-citation-v1';

function plain(row) {
  if (typeof row?.get === 'function') return row.get({ plain: true });
  if (typeof row?.toJSON === 'function') return row.toJSON();
  return row;
}

function sourceKey(source) {
  if (source?.url) {
    try {
      return `url:${CitationAnalysisService.normalizeUrl(source.url).toLowerCase()}`;
    } catch {
      return '';
    }
  }
  const domain = CitationAnalysisService.canonicalDomain(
    CitationAnalysisService.normalizeDomain(source?.domain)
  );
  return domain ? `domain:${domain}` : '';
}

function restoreOwnership(sourceGroups, legacySources) {
  const legacyByKey = new Map(
    (Array.isArray(legacySources) ? legacySources : [])
      .map((source) => [sourceKey(source), source])
      .filter(([key]) => key)
  );
  return Object.fromEntries(
    Object.entries(sourceGroups).map(([group, sources]) => [
      group,
      sources.map((source) => {
        const legacy = legacyByKey.get(sourceKey(source));
        return {
          ...source,
          owned: legacy?.owned === true,
          competitor_owned: legacy?.competitor_owned === true
        };
      })
    ])
  );
}

function createCitationMetricRepairService({
  metricModel = VisibilityMetric,
  detailModel = ResultDetail
} = {}) {
  return {
    async repairLegacyMetrics() {
      const metricRows = await metricModel.findAll();
      const pending = metricRows.filter((row) => {
        const value = plain(row);
        return value?.analysis_structure?.citations?.semantics_version !== SEMANTICS_VERSION;
      });
      if (!pending.length) return 0;

      const recordIds = pending
        .map((row) => Number(plain(row)?.question_record_id))
        .filter((id) => Number.isInteger(id) && id > 0);
      const detailRows = await detailModel.findAll({
        where: { question_record_id: { [Op.in]: recordIds } }
      });
      const detailsByRecord = new Map(
        detailRows.map((row) => {
          const value = plain(row);
          return [Number(value.question_record_id), value];
        })
      );
      let repaired = 0;

      for (const metricRow of pending) {
        const metric = plain(metricRow);
        const detail = detailsByRecord.get(Number(metric.question_record_id));
        if (!detail) continue;
        const extracted = CitationAnalysisService.extractSources({
          responseText: detail.ai_response_original,
          aiResponse: detail.provider_citations,
          brand: {},
          competitors: []
        });
        const sourceGroups = restoreOwnership(extracted.source_groups, metric.citation_sources);
        const sources = sourceGroups.explicit_citations;
        const analysisStructure = metric.analysis_structure
          && typeof metric.analysis_structure === 'object'
          && !Array.isArray(metric.analysis_structure)
          ? metric.analysis_structure
          : {};
        const previousCitations = analysisStructure.citations
          && typeof analysisStructure.citations === 'object'
          && !Array.isArray(analysisStructure.citations)
          ? analysisStructure.citations
          : {};
        const citationPayload = {
          ...previousCitations,
          semantics_version: SEMANTICS_VERSION,
          count: sources.length,
          official_count: sources.filter((source) => source.owned).length,
          competitor_count: sources.filter((source) => source.competitor_owned).length,
          official_website_cited: sources.some((source) => source.owned),
          sources,
          source_groups: sourceGroups
        };
        await metricRow.update({
          citation_count: citationPayload.count,
          owned_citation_count: citationPayload.official_count,
          competitor_citation_count: citationPayload.competitor_count,
          citation_sources: sources,
          analysis_structure: {
            ...analysisStructure,
            citations: citationPayload
          }
        });
        repaired += 1;
      }
      return repaired;
    }
  };
}

module.exports = {
  SEMANTICS_VERSION,
  createCitationMetricRepairService
};
