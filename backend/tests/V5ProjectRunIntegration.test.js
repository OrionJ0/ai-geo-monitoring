const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_STORAGE = ':memory:';

const { sequelize, QuestionRecord } = require('../models');
const ProjectRunService = require('../services/ProjectRunService');
const AIResponseAnalysisV5Service = require('../services/AIResponseAnalysisV5Service');
const { AIResponseAnalysisV5Error } = require('../services/AIResponseAnalysisV5Service');
const {
  CURRENT_ANALYSIS_CONTRACT,
  CURRENT_METRIC_SEMANTICS,
  V5_ANALYSIS_CONTRACT,
  SCOPED_METRIC_SEMANTICS
} = require('../services/GeoMetricSemanticsService');
const {
  metricFailureDiagnostics,
  normalizeCompetitorSnapshot,
  resolveFrozenSnapshot
} = require('../services/ProjectRunService');
const migrationService = require('../services/V5SnapshotMigrationService');

const ORIGINAL_V5 = AIResponseAnalysisV5Service.analyze;

test.before(async () => {
  await sequelize.sync({ force: true });
  if (sequelize.getDialect() === 'sqlite') {
    await sequelize.query('PRAGMA foreign_keys = OFF');
  }
});

test.after(async () => {
  AIResponseAnalysisV5Service.analyze = ORIGINAL_V5;
  await sequelize.close();
});

function runUser() {
  return { id: 1 };
}

function projectData() {
  return { id: 1, name: '广拓', toJSON: () => ({ id: 1, name: '广拓' }) };
}

function target() {
  return {
    platform: 'deepseek',
    prompt: { id: 2, question: '大型园区安防有哪些厂家？' }
  };
}

const SNAPSHOT = [
  { id: 12, name: '海康威视', aliases: ['Hikvision'], website: 'hikvision.com' }
];

test('createTargetRecord 默认且唯一写 v5 契约', async () => {
  const record = await ProjectRunService.createTargetRecord({
    target: target(),
    runUser: runUser(),
    projectData: projectData(),
    keywords: ['电子围栏']
  });
  assert.equal(record.analysis_contract_version, CURRENT_ANALYSIS_CONTRACT);
  assert.equal(record.metric_semantics_version, CURRENT_METRIC_SEMANTICS);
  assert.equal(record.competitor_snapshot, null);
  await record.destroy({ force: true });
});

test('createRunEntries：运行内所有记录引用同一 v5 契约与快照', async () => {
  const entries = await ProjectRunService.createRunEntries({
    targets: [
      { platform: 'deepseek', prompt: { id: 2, question: '问题一' } },
      { platform: 'doubao', prompt: { id: 3, question: '问题二' } }
    ],
    runUser: runUser(),
    projectData: projectData(),
    keywords: ['电子围栏'],
    competitorSnapshot: SNAPSHOT
  });
  assert.equal(entries.length, 2);
  entries.forEach(({ record }) => {
    assert.equal(record.analysis_contract_version, V5_ANALYSIS_CONTRACT);
    assert.equal(record.metric_semantics_version, SCOPED_METRIC_SEMANTICS);
    assert.deepEqual(record.competitor_snapshot, SNAPSHOT);
  });
  await QuestionRecord.destroy({ where: { id: entries.map(({ record }) => record.id) }, force: true });
});

test('createTargetRecord 写 v5 契约并冻结竞品快照', async () => {
  const record = await ProjectRunService.createTargetRecord({
    target: target(),
    runUser: runUser(),
    projectData: projectData(),
    keywords: ['电子围栏'],
    competitorSnapshot: SNAPSHOT
  });
  assert.equal(record.analysis_contract_version, V5_ANALYSIS_CONTRACT);
  assert.equal(record.metric_semantics_version, SCOPED_METRIC_SEMANTICS);
  assert.deepEqual(record.competitor_snapshot, SNAPSHOT);
  await record.destroy({ force: true });
});

test('metricFailureDiagnostics 识别 AIResponseAnalysisV5Error 并输出分阶段诊断', () => {
  const error = new AIResponseAnalysisV5Error('阶段 2 输出无效', 'analysis_semantic_output_invalid', {
    stage: 'semantic_judge',
    attempt_count: 2,
    model: 'deepseek-v4-flash',
    finish_reason: 'stop',
    output_length: 128,
    usage: { total_tokens: 300 }
  });
  const diagnostics = metricFailureDiagnostics(error);
  assert.ok(diagnostics, '应识别 v5 错误');
  assert.equal(diagnostics.error_code, 'analysis_semantic_output_invalid');
  assert.equal(diagnostics.stage, 'semantic_judge');
  assert.equal(diagnostics.attempt_count, 2);
  assert.equal(diagnostics.usage.total_tokens, 300);
});

test('metricFailureDiagnostics 保留共享队列的可重试 503 语义', () => {
  const error = new AIResponseAnalysisV5Error(
    'AI 分析排队超时，请稍后重试',
    'analysis_queue_timeout',
    { stage: 'analysis_queue', active: 2, queued: 99 },
    { retryable: true, status: 503, retryAfterSeconds: 1 }
  );
  assert.deepEqual(metricFailureDiagnostics(error), {
    status: 'failed',
    error_code: 'analysis_queue_timeout',
    error_detail: 'AI 分析排队超时，请稍后重试',
    retryable: true,
    retry_after_seconds: 1,
    stage: 'analysis_queue'
  });
});

test('010 硬切：buildVisibilityMetricPayload 默认调用 v5 分析器（无 v4 分派）', async () => {
  let v5Called = false;
  AIResponseAnalysisV5Service.analyze = async () => {
    v5Called = true;
    return {
      brand_mentioned: false,
      brand_mentions: 0,
      brand_position: null,
      brand_rank: null,
      brand_recommended: false,
      visibility_score: 0,
      answer_competitor_share: null,
      sov_numerator: 0,
      sov_denominator: 0,
      sov_status: 'observed_only',
      sov_scope: 'open_discovery',
      sov_completeness: 'not_proven',
      competition_entities: [],
      competition_scope: 'open_discovery',
      competition_completeness: 'not_proven',
      competition_analysis_status: 'complete',
      sentiment: 'neutral',
      analysis_method: CURRENT_ANALYSIS_CONTRACT,
      metric_semantics_version: CURRENT_METRIC_SEMANTICS,
      analysis_platform: 'deepseek',
      analysis_model: 'deepseek-v4-flash',
      analysis_structure: {
        schema_version: 'geo_metric_input_v5',
        target_fact: { status: 'complete', brand_mentioned: false, brand_mentions: 0, mentions: [] },
        target_mapping: { status: 'not_applicable', target_entity_id: null, candidate_entity_ids: [] },
        target_semantics: {
          status: 'complete',
          recommendation: { status: 'not_applicable', value: null },
          rank: { status: 'not_applicable', value: null },
          sentiment: { status: 'not_applicable', value: null }
        },
        entities: [],
        mentions: [],
        competitor_relations: [],
        candidate_groups: [],
        recommendations: [],
        claims: { status: 'not_collected', items: [] },
        sentiment: { status: 'assessed', label: 'neutral', reason: '未提及目标品牌', risk_terms: [] },
        diagnostics: { stages: [] },
        competition_analysis: { status: 'complete', entities: [], relations: [], unresolved_entity_ids: [] },
        sov: { status: 'observed_only', scope: 'open_discovery', completeness: 'not_proven', numerator: 0, denominator: 0, value: null },
        target_entity_id: null,
        target_mentions: []
      }
    };
  };
  const payload = await ProjectRunService.buildVisibilityMetricPayload({
    record: { tracked_prompt_id: 2, user_id: 1, platform: 'deepseek', question: target().prompt.question },
    responseText: '海康威视是主流品牌。',
    project: projectData(),
    competitors: [],
    prompt: { question: target().prompt.question }
  });
  assert.ok(v5Called);
  assert.equal(payload.analysis_method, CURRENT_ANALYSIS_CONTRACT);
});

test('analysis-only 复用原记录冻结快照，不随实时竞品表变化漂移', () => {
  const originalRecord = { competitor_snapshot: [{ id: 12, name: '海康威视', aliases: [], website: '' }] };
  const liveCompetitors = [{ id: 99, name: '实时新增品牌', aliases: [], website: '' }];
  // 原记录有快照 → analysis-only 必须复用原快照
  assert.deepEqual(
    resolveFrozenSnapshot(originalRecord, liveCompetitors),
    originalRecord.competitor_snapshot
  );
  // 无记录快照 + 传入快照 → 用传入快照
  assert.deepEqual(
    resolveFrozenSnapshot({}, [], SNAPSHOT),
    SNAPSHOT
  );
  // 无记录快照 + competitors 实例 → 从实例构建
  const built = resolveFrozenSnapshot({}, [{ toJSON: () => ({ id: 12, name: '海康威视', aliases: ['Hikvision'], website: 'hk.com' }) }], []);
  assert.deepEqual(built, [{ id: 12, name: '海康威视', aliases: ['Hikvision'], website: 'hk.com' }]);
});

test('normalizeCompetitorSnapshot 从 BrandCompetitor 实例构建稳定快照', () => {
  const snapshot = normalizeCompetitorSnapshot([
    { id: 12, name: '海康威视', aliases: ['Hikvision'], website: 'hikvision.com' },
    { id: 13, name: '大华股份', aliases: ['大华'], website: 'dahua.com' }
  ]);
  assert.deepEqual(snapshot, [
    { id: 12, name: '海康威视', aliases: ['Hikvision'], website: 'hikvision.com' },
    { id: 13, name: '大华股份', aliases: ['大华'], website: 'dahua.com' }
  ]);
  assert.deepEqual(normalizeCompetitorSnapshot([], null), []);
});

test('v5 快照迁移服务：模型 sync 后列存在则无需迁移（additive 只增列）', async () => {
  const audit = await migrationService.audit({ sequelize });
  assert.deepEqual(audit.missing_columns, []);
  assert.equal(audit.migration_required, false);
});

test('buildVisibilityMetricPayload 调用唯一 v5 分析器并传入竞品快照', async () => {
  let v5Input = null;
  AIResponseAnalysisV5Service.analyze = async (input) => {
    v5Input = input;
    return {
      brand_mentioned: false,
      brand_mentions: 0,
      brand_position: null,
      brand_rank: null,
      brand_recommended: false,
      visibility_score: 0,
      answer_competitor_share: null,
      sov_numerator: 0,
      sov_denominator: 0,
      sov_status: 'observed_only',
      sov_scope: 'open_discovery',
      sov_completeness: 'not_proven',
      competition_entities: [],
      sentiment: 'neutral',
      analysis_method: V5_ANALYSIS_CONTRACT,
      metric_semantics_version: SCOPED_METRIC_SEMANTICS,
      analysis_platform: 'deepseek',
      analysis_model: 'deepseek-v4-flash',
      analysis_structure: {
        schema_version: 'geo_metric_input_v5',
        target_fact: { status: 'complete', brand_mentioned: false, brand_mentions: 0, mentions: [] },
        target_semantics: { status: 'complete' },
        competition_analysis: { status: 'unavailable' },
        sov: { status: 'observed_only', scope: 'open_discovery', completeness: 'not_proven' }
      }
    };
  };
  const payload = await ProjectRunService.buildVisibilityMetricPayload({
    record: { tracked_prompt_id: 2, user_id: 1, platform: 'deepseek', question: target().prompt.question },
    responseText: '海康威视是主流品牌。',
    project: projectData(),
    competitors: [],
    prompt: { question: target().prompt.question },
    competitorSnapshot: SNAPSHOT
  });
  assert.ok(v5Input, 'v5 分析器应被调用');
  assert.deepEqual(v5Input.competitors, SNAPSHOT, 'v5 分析器应接收冻结快照');
  assert.equal(payload.analysis_method, V5_ANALYSIS_CONTRACT);
  assert.equal(payload.metric_semantics_version, SCOPED_METRIC_SEMANTICS);
});
