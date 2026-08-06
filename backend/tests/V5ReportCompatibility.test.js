const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeNativeRow } = require('../services/QuestionSetRunService');
const QuestionSetRunCsvService = require('../services/QuestionSetRunCsvService');
const { SCOPED_METRIC_SEMANTICS, V5_ANALYSIS_CONTRACT } = require('../services/GeoMetricSemanticsService');

function csvReport(rowOverrides = {}) {
  return {
    id: 99,
    question_set_name: 'v5 CSV 兼容测试',
    analysis_contract_version: V5_ANALYSIS_CONTRACT,
    metric_semantics_version: SCOPED_METRIC_SEMANTICS,
    started_at: new Date('2026-08-05T01:00:00.000Z'),
    completed_at: new Date('2026-08-05T01:05:00.000Z'),
    rows: [{
      record_id: 11,
      question_id: 22,
      question: '周界报警厂商怎么选？',
      question_category: '购买决策',
      platform: 'deepseek',
      platform_name: 'DeepSeek',
      model_name: 'deepseek-v4-flash',
      status: 'completed',
      error_message: '',
      answer: '上海广拓可作为候选。',
      has_metrics: true,
      brand_mentioned: true,
      brand_mentions: 1,
      brand_rank: 1,
      brand_recommended: true,
      share_of_voice: null,
      answer_competitor_share: 50,
      sov_numerator: 1,
      sov_denominator: 2,
      sentiment: 'positive',
      sentiment_reason: '',
      competitor_mentions: [],
      citation_sources: [],
      legacy_citation_count: 0,
      legacy_citation_sources: [],
      created_at: new Date('2026-08-05T01:00:10.000Z'),
      updated_at: new Date('2026-08-05T01:04:00.000Z'),
      analysis_method: V5_ANALYSIS_CONTRACT,
      analysis_platform: 'deepseek',
      analysis_model: 'deepseek-v4-flash',
      metric_semantics_version: SCOPED_METRIC_SEMANTICS,
      competition_entities: [{
        entity_id: 'E002',
        name: '海康',
        relation: 'competitor',
        mentions: 1,
        reason: '提供同类周界方案',
        evidence: ['上海广拓可作为候选'],
        surface_forms: ['海康']
      }],
      analysis_structure: {
        schema_version: 'geo_metric_input_v5',
        target_fact: {
          status: 'complete',
          brand_mentioned: true,
          brand_mentions: 1,
          mentions: []
        },
        target_semantics: {
          status: 'complete',
          recommendation: { status: 'assessed', value: true },
          rank: { status: 'assessed', value: 1 },
          sentiment: { status: 'assessed', value: 'positive' }
        },
        competition_analysis: { status: 'partial', scope: 'open_discovery', completeness: 'not_proven' },
        sov: {
          status: 'observed_only',
          scope: 'open_discovery',
          completeness: 'not_proven',
          numerator: 1,
          denominator: 2,
          value: 50
        }
      },
      analysis_evidence: {},
      failure: null,
      retry: null,
      analysis_diagnostics: null,
      ...rowOverrides
    }]
  };
}

function v5Metric() {
  return {
    metric_semantics_version: SCOPED_METRIC_SEMANTICS,
    analysis_method: V5_ANALYSIS_CONTRACT,
    brand_mentioned: true,
    brand_mentions: 1,
    brand_rank: 1,
    brand_recommended: true,
    answer_competitor_share: 50,
    sov_numerator: 1,
    sov_denominator: 2,
    sov_status: 'observed_only',
    sov_scope: 'open_discovery',
    sov_completeness: 'not_proven',
    competition_entities: [{ entity_id: 'E002', name: '海康威视', relation: 'competitor', mentions: 1 }],
    sentiment: 'positive',
    analysis_structure: {
      schema_version: 'geo_metric_input_v5',
      target_fact: { status: 'complete', brand_mentioned: true, brand_mentions: 1, mentions: [] },
      target_semantics: {
        status: 'complete',
        recommendation: { status: 'assessed', value: true, evidence_source_ids: ['L001'] },
        rank: { status: 'assessed', value: 1, evidence_source_ids: ['L001'] },
        sentiment: { status: 'assessed', value: 'positive', evidence_source_ids: ['L001'] }
      },
      competition_analysis: { status: 'partial', scope: 'open_discovery', completeness: 'not_proven', unresolved_entity_ids: ['E002'], quarantined_items: [] },
      sov: { status: 'observed_only', scope: 'open_discovery', completeness: 'not_proven', numerator: 1, denominator: 2, value: 50 },
      diagnostics: { stages: [{ stage: 'entity_extract', attempt_count: 1 }] }
    }
  };
}

function v5Record() {
  return {
    id: 10,
    tracked_prompt_id: 2,
    question: '大型园区安防有哪些厂家？',
    platform: 'deepseek',
    platform_name: 'DeepSeek',
    model_name: 'deepseek-v4-flash',
    status: 'completed',
    error_message: null,
    analysis_contract_version: V5_ANALYSIS_CONTRACT,
    resultDetail: {
      ai_response_original: '上海广拓为首选。\n海康威视可选。'
    },
    visibilityMetric: v5Metric(),
    result_summary: {}
  };
}

test('API 行级透传 v5 三轨状态且 scoped SOV 不抛错、不丢失 source ID 与诊断', () => {
  const row = normalizeNativeRow(v5Record());
  // scoped SOV 通过 presentScopedSov 归一
  assert.equal(row.sov.metric_semantics_version, SCOPED_METRIC_SEMANTICS);
  assert.equal(row.sov.status, 'observed_only');
  assert.equal(row.sov.scope, 'open_discovery');
  assert.equal(row.sov.completeness, 'not_proven');
  // analysis_structure 透传三轨与分阶段诊断
  assert.equal(row.analysis_structure.target_fact.status, 'complete');
  assert.equal(row.analysis_structure.target_semantics.recommendation.status, 'assessed');
  assert.deepEqual(row.analysis_structure.target_semantics.recommendation.evidence_source_ids, ['L001']);
  assert.equal(row.analysis_structure.competition_analysis.status, 'partial');
  assert.deepEqual(row.analysis_structure.competition_analysis.unresolved_entity_ids, ['E002']);
  assert.ok(Array.isArray(row.analysis_structure.diagnostics.stages));
  // competition_entities 保留 entity_id
  assert.equal(row.competition_entities[0].entity_id, 'E002');
});

test('API 行级透传 v5 目标语义未解决时不被当作业务否定值', () => {
  const record = v5Record();
  record.visibilityMetric = {
    ...v5Metric(),
    brand_mentioned: true,
    brand_recommended: false,
    brand_rank: null,
    sentiment: 'neutral',
    analysis_structure: {
      ...v5Metric().analysis_structure,
      target_semantics: {
        status: 'partial',
        recommendation: { status: 'unresolved', value: null, evidence_source_ids: [] },
        rank: { status: 'unresolved', value: null, evidence_source_ids: [] },
        sentiment: { status: 'unresolved', value: null, evidence_source_ids: [] }
      }
    }
  };
  const row = normalizeNativeRow(record);
  // 真实状态在 analysis_structure，顶层占位不进入业务判断
  assert.equal(row.analysis_structure.target_semantics.recommendation.status, 'unresolved');
  assert.equal(row.analysis_structure.target_semantics.sentiment.status, 'unresolved');
  assert.equal(row.analysis_structure.target_semantics.status, 'partial');
});

test('历史 v4 记录继续按 v1 语义透传，不被 v5 分支破坏', () => {
  const record = v5Record();
  record.analysis_contract_version = 'ai_structured_v4';
  record.visibilityMetric = {
    ...v5Metric(),
    metric_semantics_version: 'contextual_competitor_mentions_sov_v1',
    analysis_method: 'ai_structured_v4',
    analysis_structure: { schema_version: 'geo_metric_input_v4', entities: [] }
  };
  const row = normalizeNativeRow(record);
  assert.equal(row.sov.metric_semantics_version, 'contextual_competitor_mentions_sov_v1');
  assert.equal(row.analysis_contract_version, 'ai_structured_v4');
});

test('v5 CSV 导出再导入接受 scoped 语义并保留 entity_id/source 结构', () => {
  const parsed = QuestionSetRunCsvService.parseCsv(
    QuestionSetRunCsvService.buildCsv(csvReport())
  );
  assert.equal(parsed.analysisContractVersion, V5_ANALYSIS_CONTRACT);
  assert.equal(parsed.metricSemanticsVersion, SCOPED_METRIC_SEMANTICS);
  assert.equal(parsed.rows[0].metric_semantics_version, SCOPED_METRIC_SEMANTICS);
  assert.equal(parsed.rows[0].competition_entities[0].entity_id, 'E002');
  assert.equal(parsed.rows[0].competition_entities[0].name, '海康');
});

test('未知竞品实体缺少 name 或 relation 的 v5 CSV 被明确拒绝', () => {
  const report = csvReport({
    competition_entities: [{
      entity_id: 'E002',
      relation: 'competitor',
      mentions: 1,
      reason: '缺少 name'
    }]
  });
  assert.throws(
    () => QuestionSetRunCsvService.parseCsv(QuestionSetRunCsvService.buildCsv(report)),
    (error) => error?.code === 'INVALID_COMPETITION_ENTITY'
  );
});

test('历史 v4 CSV 仍可读取（scoped 分支不破坏 v1 往返）', () => {
  const report = {
    ...csvReport(),
    analysis_contract_version: 'ai_structured_v4',
    metric_semantics_version: 'contextual_competitor_mentions_sov_v1'
  };
  report.rows[0].analysis_method = 'ai_structured_v4';
  report.rows[0].metric_semantics_version = 'contextual_competitor_mentions_sov_v1';
  report.rows[0].competition_entities = [{
    name: '海康',
    relation: 'competitor',
    mentions: 1,
    reason: '提供同类周界方案',
    evidence: ['上海广拓可作为候选'],
    surface_forms: ['海康']
  }];
  const parsed = QuestionSetRunCsvService.parseCsv(
    QuestionSetRunCsvService.buildCsv(report)
  );
  assert.equal(parsed.rows[0].metric_semantics_version, 'contextual_competitor_mentions_sov_v1');
});
