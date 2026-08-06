const ANSWER_LEVEL_SOV_V1 = 'contextual_competitor_mentions_sov_v1';
const SCOPED_SOV_V2 = 'contextual_competitor_mentions_sov_v2_scoped';
const OPEN_DISCOVERY_SOV_TITLE = '开放发现 SOV（仅基于本次已发现实体，不代表完整市场）';

function isAnswerLevelSovSemantics(version) {
  return version === ANSWER_LEVEL_SOV_V1 || version === SCOPED_SOV_V2;
}

function isCurrentReportSnapshot(reportVersion, summaryVersion) {
  return reportVersion === summaryVersion && isAnswerLevelSovSemantics(reportVersion);
}

function getSovPresentationTitle(summary = {}) {
  const isScopedVersion = summary.metric_semantics_version === SCOPED_SOV_V2;
  const hasOpenDiscoveryContract = summary.kind === 'observed_competitor_mentions'
    && summary.scope === 'open_discovery'
    && summary.completeness === 'not_proven';
  return isScopedVersion || hasOpenDiscoveryContract
    ? OPEN_DISCOVERY_SOV_TITLE
    : '回答内竞品提及占比（SOV）';
}

module.exports = {
  ANSWER_LEVEL_SOV_V1,
  SCOPED_SOV_V2,
  OPEN_DISCOVERY_SOV_TITLE,
  isAnswerLevelSovSemantics,
  isCurrentReportSnapshot,
  getSovPresentationTitle
};
