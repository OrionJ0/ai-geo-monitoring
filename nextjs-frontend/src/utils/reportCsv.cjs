const defaultPlatformLabel = {
  doubao: '豆包',
  deepseek: 'DeepSeek'
};
/* eslint-disable @typescript-eslint/no-require-imports */
const {
  getSovPresentationTitle,
  isAnswerLevelSovSemantics,
  LEGACY_CONFIGURED_SOV_V1
} = require('./metricSemantics.cjs');
/* eslint-enable @typescript-eslint/no-require-imports */

function percent(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

function formatRank(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? Number(n.toFixed(2)) : '-';
}

function formatCitationRate(value, item) {
  return Number(item?.citation_eligible_checks || 0) > 0
    ? `${percent(value)}%`
    : '暂无可验证样本';
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function joinLabels(values, labelMap = {}) {
  return (Array.isArray(values) ? values : [])
    .filter(Boolean)
    .map((item) => labelMap[item] || item)
    .join('、');
}

function formatOpportunityScope(item, platformLabel = defaultPlatformLabel) {
  const platform = item?.platform ? (platformLabel[item.platform] || item.platform) : '';
  const domain = item?.domain || '';
  if (platform && domain) return `${platform} / ${domain}`;
  return platform || domain || item?.competitor || '';
}

function formatCurrentRate(value, numerator, denominator) {
  const valid = Number(denominator || 0);
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) {
    return `N/A（有效回答 ${valid}）`;
  }
  return `${percent(value)}%（${Number(numerator || 0)} / ${valid}）`;
}

function formatCurrentSov(summary) {
  const count = Number(summary?.calculable_answers || 0);
  const value = summary?.average;
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) {
    return `N/A（有效回答 ${count}）`;
  }
  return `${percent(value)}%（有效回答 ${count}）`;
}

function buildCurrentReportCsvRows({ summary, platformLabel, websiteConfigured }) {
  const platforms = Array.isArray(summary.platforms) ? summary.platforms : [];
  const competitors = Array.isArray(summary.competitors) ? summary.competitors : [];
  const categories = Array.isArray(summary.categories) ? summary.categories : [];
  const trend = Array.isArray(summary.trend) ? summary.trend : [];
  const sourceTypes = Array.isArray(summary.source_types) ? summary.source_types : [];
  const sourceDomains = Array.isArray(summary.source_domains) ? summary.source_domains : [];
  const sourceUrls = Array.isArray(summary.source_urls) ? summary.source_urls : [];
  const sourceChanges = summary.source_changes || {};
  const sourceSummary = summary.source_summary || {};
  const opportunities = Array.isArray(summary.opportunities) ? summary.opportunities : [];
  const sovTitle = getSovPresentationTitle(summary.sov_summary);

  return [
    ['整体概览'],
    ['指标', '值'],
    ['指标语义版本', summary.metric_semantics_version],
    ['总运行数', summary.total_runs || 0],
    ['已获取回答', summary.acquired_answers || 0],
    ['有效回答', summary.valid_answers || 0],
    ['分析覆盖率', formatCurrentRate(
      summary.analysis_coverage_rate,
      summary.valid_answers,
      summary.acquired_answers
    )],
    ['品牌提及率', formatCurrentRate(
      summary.brand_mention_rate,
      summary.brand_mentioned_answers,
      summary.brand_mention_assessed_answers ?? summary.valid_answers
    )],
    [sovTitle, formatCurrentSov(summary.sov_summary)],
    ['推荐率（AI 语义分析）', formatCurrentRate(
      summary.recommendation_rate,
      summary.recommended_answers,
      summary.recommendation_assessed_answers ?? summary.valid_answers
    )],
    ['负向情绪率（AI 语义分析）', formatCurrentRate(
      summary.negative_sentiment_rate,
      summary.negative_sentiment_answers,
      summary.sentiment_assessed_answers ?? summary.brand_mentioned_answers
    )],
    ['明确有序榜单平均排名', summary.avg_brand_rank == null
      ? `N/A（有效回答 ${Number(summary.ranked_answers || 0)}）`
      : `${formatRank(summary.avg_brand_rank)}（有效回答 ${Number(summary.ranked_answers || 0)}）`],
    ['引用率', formatCitationRate(summary.citation_rate, summary)],
    ['官网引用率', websiteConfigured === false
      ? '未配置官网'
      : formatCitationRate(summary.owned_citation_rate, summary)],
    ['引用源总数', sourceSummary.total_citations || 0],
    ['来源域名数', sourceSummary.source_domain_count || 0],
    [],
    ['平台表现'],
    ['平台', '有效回答', '品牌提及率', sovTitle, '引用率', '推荐率（AI 语义分析）', '明确有序榜单平均排名'],
    ...platforms.map((item) => [
      platformLabel[item.platform] || item.platform || '未知',
      item.valid_answers || 0,
      formatCurrentRate(item.brand_mention_rate, item.brand_mentioned_answers, item.brand_mention_assessed_answers ?? item.valid_answers),
      formatCurrentSov(item.sov_summary),
      formatCitationRate(item.citation_rate, item),
      formatCurrentRate(item.recommendation_rate, item.recommended_answers, item.recommendation_assessed_answers ?? item.valid_answers),
      item.avg_brand_rank == null
        ? `N/A（有效回答 ${Number(item.ranked_answers || 0)}）`
        : `${formatRank(item.avg_brand_rank)}（有效回答 ${Number(item.ranked_answers || 0)}）`
    ]),
    [],
    ['分类覆盖'],
    ['分类', '问题数', '启用问题数', '运行数', '失败数', '有效回答', '品牌提及率', sovTitle, '引用率', '推荐率（AI 语义分析）'],
    ...categories.map((item) => [
      item.category || '未分类',
      item.prompt_count || 0,
      item.enabled_prompt_count || 0,
      item.total_runs || 0,
      item.failed_runs || 0,
      item.valid_answers || 0,
      formatCurrentRate(item.brand_mention_rate, item.brand_mentioned_answers, item.brand_mention_assessed_answers ?? item.valid_answers),
      formatCurrentSov(item.sov_summary),
      formatCitationRate(item.citation_rate, item),
      formatCurrentRate(item.recommendation_rate, item.recommended_answers, item.recommendation_assessed_answers ?? item.valid_answers)
    ]),
    [],
    ['竞品提及'],
    ['竞品', '实际提及次数', '出现回答数'],
    ...competitors.map((item) => [
      item.name || '未知竞品',
      item.mentions || 0,
      item.appeared_answers || 0
    ]),
    [],
    ['趋势'],
    ['日期', '有效回答', '品牌提及率', sovTitle, '引用率', '推荐率（AI 语义分析）'],
    ...trend.map((item) => [
      item.date,
      item.valid_answers || 0,
      formatCurrentRate(item.brand_mention_rate, item.brand_mentioned_answers, item.brand_mention_assessed_answers ?? item.valid_answers),
      formatCurrentSov(item.sov_summary),
      formatCitationRate(item.citation_rate, item),
      formatCurrentRate(item.recommendation_rate, item.recommended_answers, item.recommendation_assessed_answers ?? item.valid_answers)
    ]),
    [],
    ['来源类型'],
    ['类型', '引用次数', '覆盖回答', '域名数'],
    ...sourceTypes.map((item) => [
      item.type || '未知来源',
      item.citation_count || 0,
      item.response_count || 0,
      item.domain_count || 0
    ]),
    [],
    ['Top 引用域名'],
    ['域名', '来源类型', '覆盖回答', '引用次数', '平台', '问题分类'],
    ...sourceDomains.map((item) => [
      item.domain || '',
      item.source_type || '未知来源',
      item.response_count || 0,
      item.citation_count || 0,
      joinLabels(item.platforms, platformLabel),
      joinLabels(item.categories)
    ]),
    [],
    ['Top 引用 URL'],
    ['URL', '域名', '来源类型', '覆盖回答', '引用次数', '平台', '问题分类'],
    ...sourceUrls.map((item) => [
      item.url || '',
      item.domain || '',
      item.source_type || '未知来源',
      item.response_count || 0,
      item.citation_count || 0,
      joinLabels(item.platforms, platformLabel),
      joinLabels(item.categories)
    ]),
    ...['new', 'dropped', 'retained'].flatMap((kind) => {
      const label = kind === 'new' ? '新增' : kind === 'dropped' ? '流失' : '保留';
      const domainRows = Array.isArray(sourceChanges[`${kind}_domains`])
        ? sourceChanges[`${kind}_domains`]
        : [];
      const urlRows = Array.isArray(sourceChanges[`${kind}_urls`])
        ? sourceChanges[`${kind}_urls`]
        : [];
      return [
        [],
        [`${label}引用域名`],
        ['域名', '来源类型', '引用次数', '平台', '问题分类'],
        ...domainRows.map((item) => [
          item.domain || '',
          item.source_type || '未知来源',
          item.citation_count || 0,
          joinLabels(item.platforms, platformLabel),
          joinLabels(item.categories)
        ]),
        [],
        [`${label}引用 URL`],
        ['URL', '域名', '来源类型', '引用次数', '平台', '问题分类'],
        ...urlRows.map((item) => [
          item.url || '',
          item.domain || '',
          item.source_type || '未知来源',
          item.citation_count || 0,
          joinLabels(item.platforms, platformLabel),
          joinLabels(item.categories)
        ])
      ];
    }),
    [],
    ['优化机会'],
    ['类型', '优先级', '平台/来源', '对象', '证据', '建议动作'],
    ...opportunities.map((item) => [
      item.type || '',
      item.priority || '',
      formatOpportunityScope(item, platformLabel),
      item.prompt || item.domain || item.competitor || item.prompt_category || '',
      item.evidence || '',
      item.recommendation || ''
    ])
  ];
}

function buildReportCsvRows({
  summary = {},
  platformLabel = defaultPlatformLabel,
  websiteConfigured,
  reportMetricSemanticsVersion
} = {}) {
  const summaryMetricSemanticsVersion = summary.metric_semantics_version;
  const migratedLegacySnapshot = reportMetricSemanticsVersion === LEGACY_CONFIGURED_SOV_V1
    && (summaryMetricSemanticsVersion === undefined || summaryMetricSemanticsVersion === null);
  if (reportMetricSemanticsVersion !== summaryMetricSemanticsVersion && !migratedLegacySnapshot) {
    throw new Error('项目报告与 summary 的指标语义版本不一致');
  }
  if (isAnswerLevelSovSemantics(summary.metric_semantics_version)) {
    return buildCurrentReportCsvRows({ summary, platformLabel, websiteConfigured });
  }
  const platforms = Array.isArray(summary.platforms) ? summary.platforms : [];
  const competitors = Array.isArray(summary.competitors) ? summary.competitors : [];
  const categories = Array.isArray(summary.categories) ? summary.categories : [];
  const trend = Array.isArray(summary.trend) ? summary.trend : [];
  const sourceTypes = Array.isArray(summary.source_types) ? summary.source_types : [];
  const sourceDomains = Array.isArray(summary.source_domains) ? summary.source_domains : [];
  const sourceUrls = Array.isArray(summary.source_urls) ? summary.source_urls : [];
  const sourceChanges = summary.source_changes || {};
  const sourceSummary = summary.source_summary || {};
  const newDomains = Array.isArray(sourceChanges.new_domains) ? sourceChanges.new_domains : [];
  const droppedDomains = Array.isArray(sourceChanges.dropped_domains) ? sourceChanges.dropped_domains : [];
  const retainedDomains = Array.isArray(sourceChanges.retained_domains) ? sourceChanges.retained_domains : [];
  const newUrls = Array.isArray(sourceChanges.new_urls) ? sourceChanges.new_urls : [];
  const droppedUrls = Array.isArray(sourceChanges.dropped_urls) ? sourceChanges.dropped_urls : [];
  const retainedUrls = Array.isArray(sourceChanges.retained_urls) ? sourceChanges.retained_urls : [];
  const opportunities = Array.isArray(summary.opportunities) ? summary.opportunities : [];

  return [
    ['整体概览'],
    ['指标', '值'],
    ['总运行数', summary.total_runs ?? summary.total_checks ?? 0],
    ['有效分析数', summary.total_checks || 0],
    ['完成运行数', summary.completed_runs || 0],
    ['失败运行数', summary.failed_runs || 0],
    ['失败率', `${percent(summary.failure_rate)}%`],
    ['品牌提及率', `${percent(summary.brand_mention_rate)}%`],
    ['平均声量占比（SOV）', `${percent(summary.avg_share_of_voice)}%`],
    ['引用率', formatCitationRate(summary.citation_rate, summary)],
    ['推荐率', `${percent(summary.recommendation_rate)}%`],
    ['负向情绪率', `${percent(summary.negative_sentiment_rate)}%`],
    ['平均品牌排名', formatRank(summary.avg_brand_rank)],
    ['自有来源覆盖率', formatCitationRate(summary.owned_citation_rate, summary)],
    ['引用源总数', sourceSummary.total_citations || 0],
    ['来源域名数', sourceSummary.source_domain_count || 0],
    [],
    ['平台表现'],
    ['平台', '有效分析数', '品牌提及率', '平均声量占比（SOV）', '引用率', '推荐率', '平均品牌排名'],
    ...platforms.map((item) => [
      platformLabel[item.platform] || item.platform || '未知',
      item.checks || 0,
      `${percent(item.brand_mention_rate)}%`,
      `${percent(item.avg_share_of_voice)}%`,
      formatCitationRate(item.citation_rate, item),
      `${percent(item.recommendation_rate)}%`,
      formatRank(item.avg_brand_rank),
    ]),
    [],
    ['分类覆盖'],
    ['分类', '问题数', '启用问题数', '运行数', '失败数', '失败率', '有效分析数', '品牌提及率', '平均声量占比（SOV）', '引用率', '推荐率'],
    ...categories.map((item) => [
      item.category || '未分类',
      item.prompt_count || 0,
      item.enabled_prompt_count || 0,
      item.total_runs || 0,
      item.failed_runs || 0,
      `${percent(item.failure_rate)}%`,
      item.checks || 0,
      `${percent(item.brand_mention_rate)}%`,
      `${percent(item.avg_share_of_voice)}%`,
      formatCitationRate(item.citation_rate, item),
      `${percent(item.recommendation_rate)}%`,
    ]),
    [],
    ['竞品提及'],
    ['竞品', '提及次数', '出现分析数', '可见度得分'],
    ...competitors.map((item) => [
      item.name || '未知竞品',
      item.mentions || 0,
      item.appeared_checks || 0,
      item.visibility_score || 0,
    ]),
    [],
    ['趋势'],
    ['日期', '有效分析数', '品牌提及率', '平均声量占比（SOV）', '引用率', '推荐率'],
    ...trend.map((item) => [
      item.date,
      item.checks || 0,
      `${percent(item.brand_mention_rate)}%`,
      `${percent(item.avg_share_of_voice)}%`,
      formatCitationRate(item.citation_rate, item),
      `${percent(item.recommendation_rate)}%`,
    ]),
    [],
    ['来源类型'],
    ['类型', '引用次数', '覆盖回答', '域名数'],
    ...sourceTypes.map((item) => [
      item.type || '未知来源',
      item.citation_count || 0,
      item.response_count || 0,
      item.domain_count || 0,
    ]),
    [],
    ['Top 引用域名'],
    ['域名', '来源类型', '覆盖回答', '引用次数', '平台', '问题分类'],
    ...sourceDomains.map((item) => [
      item.domain || '',
      item.source_type || '未知来源',
      item.response_count || 0,
      item.citation_count || 0,
      joinLabels(item.platforms, platformLabel),
      joinLabels(item.categories),
    ]),
    [],
    ['Top 引用 URL'],
    ['URL', '域名', '来源类型', '覆盖回答', '引用次数', '平台', '问题分类'],
    ...sourceUrls.map((item) => [
      item.url || '',
      item.domain || '',
      item.source_type || '未知来源',
      item.response_count || 0,
      item.citation_count || 0,
      joinLabels(item.platforms, platformLabel),
      joinLabels(item.categories),
    ]),
    [],
    ['新增引用域名'],
    ['域名', '来源类型', '引用次数', '平台', '问题分类'],
    ...newDomains.map((item) => [
      item.domain || '',
      item.source_type || '未知来源',
      item.citation_count || 0,
      joinLabels(item.platforms, platformLabel),
      joinLabels(item.categories),
    ]),
    [],
    ['流失引用域名'],
    ['域名', '来源类型', '引用次数', '平台', '问题分类'],
    ...droppedDomains.map((item) => [
      item.domain || '',
      item.source_type || '未知来源',
      item.citation_count || 0,
      joinLabels(item.platforms, platformLabel),
      joinLabels(item.categories),
    ]),
    [],
    ['保留引用域名'],
    ['域名', '来源类型', '引用次数', '平台', '问题分类'],
    ...retainedDomains.map((item) => [
      item.domain || '',
      item.source_type || '未知来源',
      item.citation_count || 0,
      joinLabels(item.platforms, platformLabel),
      joinLabels(item.categories),
    ]),
    [],
    ['新增引用 URL'],
    ['URL', '域名', '来源类型', '引用次数', '平台', '问题分类'],
    ...newUrls.map((item) => [
      item.url || '',
      item.domain || '',
      item.source_type || '未知来源',
      item.citation_count || 0,
      joinLabels(item.platforms, platformLabel),
      joinLabels(item.categories),
    ]),
    [],
    ['流失引用 URL'],
    ['URL', '域名', '来源类型', '引用次数', '平台', '问题分类'],
    ...droppedUrls.map((item) => [
      item.url || '',
      item.domain || '',
      item.source_type || '未知来源',
      item.citation_count || 0,
      joinLabels(item.platforms, platformLabel),
      joinLabels(item.categories),
    ]),
    [],
    ['保留引用 URL'],
    ['URL', '域名', '来源类型', '引用次数', '平台', '问题分类'],
    ...retainedUrls.map((item) => [
      item.url || '',
      item.domain || '',
      item.source_type || '未知来源',
      item.citation_count || 0,
      joinLabels(item.platforms, platformLabel),
      joinLabels(item.categories),
    ]),
    [],
    ['优化机会'],
    ['类型', '优先级', '平台/来源', '对象', '证据', '建议动作'],
    ...opportunities.map((item) => [
      item.type || '',
      item.priority || '',
      formatOpportunityScope(item, platformLabel),
      item.prompt || item.domain || item.competitor || item.prompt_category || '',
      item.evidence || '',
      item.recommendation || '',
    ]),
  ];
}

function buildReportCsv(options = {}) {
  return buildReportCsvRows(options)
    .map((row) => row.map(csvEscape).join(','))
    .join('\n');
}

module.exports = {
  buildReportCsv,
  buildReportCsvRows,
  csvEscape
};
