const test = require('node:test');
const assert = require('node:assert/strict');

const { AIResponseAnalysisV5Service } = require('../services/AIResponseAnalysisV5Service');
const { createSourceMap } = require('../services/AIAnalysisSourceMapService');
const { buildEntityCatalog } = require('../services/AIEntityCatalogService');
const { SCOPED_METRIC_SEMANTICS } = require('../services/GeoMetricSemanticsService');
const { AIResponseEntityExtractionService } = require('../services/AIResponseEntityExtractionService');
const { AIResponseSemanticJudgmentService } = require('../services/AIResponseSemanticJudgmentService');

const TARGET_ABSENT_ANSWER = '大工业园区安防核心是全域覆盖。\n海康威视与大华股份可选。';
const TARGET_PRESENT_ANSWER = '上海广拓为首选。\n海康威视与大华股份可选。';

function extractFor(answer, targetBrand) {
  return async ({ sourceMap, validateMentions }) => {
    const mentions = [];
    const add = (surfaceForm, canonicalName, entityType) => {
      const segment = sourceMap.segments.find((item) => item.text.includes(surfaceForm));
      if (segment) {
        mentions.push({ source_id: segment.source_id, surface_form: surfaceForm, canonical_name: canonicalName, entity_type: entityType });
      }
    };
    if (answer.includes('上海广拓')) add('上海广拓', '上海广拓', 'company');
    add('海康威视', '海康威视', 'brand');
    add('大华股份', '大华股份', 'brand');
    return { mentions, validated: validateMentions(mentions), diagnostics: { stage: 'entity_extract', attempt_count: 1, model: 'deepseek-v4-flash' } };
  };
}

function makeSemantic(targetAppears, sentimentLabel = 'positive', judgeThrows = false) {
  const service = {
    async judge({ catalog, sourceMap }) {
      if (judgeThrows) {
        const error = new Error('语义判断失败');
        error.code = 'analysis_semantic_output_invalid';
        error.details = { attempt_count: 2, model: 'deepseek-v4-flash' };
        throw error;
      }
      const sourceById = new Map(sourceMap.segments.map((segment) => [segment.source_id, segment.text]));
      const entities = catalog.entities;
      const nonTarget = entities.filter((entity) => entity.entity_id !== catalog.target_entity_id);
      const targetId = catalog.target_entity_id;
      const evidenceOf = (entity) => entity.mentions.map((mention) => mention.source_id);
      // 只返回第一个非目标实体的关系，其余进入 unresolved，符合竞品遗漏允许
      const judged = nonTarget.length ? [nonTarget[0]] : [];
      const relation = judged.map((entity) => ({
        entity_id: entity.entity_id,
        relation: 'competitor',
        reason: '同一采购场景',
        evidence_source_ids: evidenceOf(entity),
        evidence: evidenceOf(entity).map((sourceId) => sourceById.get(sourceId))
      }));
      const targetEntity = targetId ? entities.find((e) => e.entity_id === targetId) : null;
      const recommendation = targetEntity
        ? [{ entity_id: targetId, kind: 'explicit', evidence_source_ids: evidenceOf(targetEntity), evidence: evidenceOf(targetEntity).map((sourceId) => sourceById.get(sourceId)) }]
        : [];
      return {
        structured: {
          competitor_relations: relation,
          candidate_groups: targetAppears
            ? [{ ordered: true, entries: [targetId, ...nonTarget.map((entity) => entity.entity_id)], reason: '目标为首选', evidence_source_ids: nonTarget.flatMap((entity) => evidenceOf(entity)) }]
            : [],
          recommendations: recommendation,
          sentiment: {
            status: targetAppears ? 'assessed' : 'not_applicable',
            label: targetAppears ? sentimentLabel : null,
            reason: targetAppears ? '模型判定' : '目标未出现',
            evidence_source_ids: targetEntity ? evidenceOf(targetEntity) : [],
            risk_terms: []
          }
        },
        diagnostics: { stage: 'semantic_judge', attempt_count: 1, model: 'deepseek-v4-flash' }
      };
    }
  };
  return service;
}

function buildService({ answer, targetBrand, semantic, entityExtract }) {
  return new AIResponseAnalysisV5Service({
    entityExtractionService: {
      extract: entityExtract || extractFor(answer, targetBrand)
    },
    semanticJudgmentService: semantic
  });
}

test('目标未出现：target_fact complete、语义三字段 not_applicable、开放竞品 partial、scoped SOV', async () => {
  const service = buildService({
    answer: TARGET_ABSENT_ANSWER,
    targetBrand: { name: '广拓', aliases: ['上海广拓'] },
    semantic: makeSemantic(false)
  });
  const result = await service.analyze({
    question: '大工业园区用什么安防设备比较好？',
    responseText: TARGET_ABSENT_ANSWER,
    brand: { name: '广拓', aliases: ['上海广拓'] }
  });

  const structure = result.analysis_structure;
  assert.equal(structure.target_fact.status, 'complete');
  assert.equal(structure.target_fact.brand_mentioned, false);
  assert.equal(structure.target_semantics.recommendation.status, 'not_applicable');
  assert.equal(structure.target_semantics.rank.status, 'not_applicable');
  assert.equal(structure.target_semantics.sentiment.status, 'not_applicable');
  assert.equal(structure.target_semantics.status, 'complete');
  assert.equal(structure.competition_analysis.status, 'partial');
  assert.equal(structure.competition_analysis.scope, 'open_discovery');
  assert.equal(structure.competition_analysis.completeness, 'not_proven');
  assert.equal(result.metric_semantics_version, SCOPED_METRIC_SEMANTICS);
  assert.equal(result.sov_status, 'observed_only');
  assert.equal(result.sov_scope, 'open_discovery');
  assert.equal(result.sov_completeness, 'not_proven');
});

test('目标出现且语义成功：推荐/排名/情绪均为 assessed，值来自验证后事实', async () => {
  const service = buildService({
    answer: TARGET_PRESENT_ANSWER,
    targetBrand: { name: '广拓', aliases: ['上海广拓'] },
    semantic: makeSemantic(true)
  });
  const result = await service.analyze({
    question: '大型园区安防有哪些厂家？',
    responseText: TARGET_PRESENT_ANSWER,
    brand: { name: '广拓', aliases: ['上海广拓'] }
  });

  const structure = result.analysis_structure;
  assert.equal(structure.target_fact.brand_mentioned, true);
  assert.equal(structure.target_semantics.recommendation.status, 'assessed');
  assert.equal(structure.target_semantics.recommendation.value, true);
  assert.equal(structure.target_semantics.rank.status, 'assessed');
  assert.equal(structure.target_semantics.sentiment.status, 'assessed');
  assert.equal(structure.target_semantics.sentiment.value, 'positive');
  assert.equal(structure.target_semantics.status, 'complete');
});

test('阶段 2 失败降级：目标出现时语义字段 unresolved、开放竞品 unavailable、目标事实仍 complete', async () => {
  const service = buildService({
    answer: TARGET_PRESENT_ANSWER,
    targetBrand: { name: '广拓', aliases: ['上海广拓'] },
    semantic: makeSemantic(true, 'positive', true)
  });
  const result = await service.analyze({
    question: '大型园区安防有哪些厂家？',
    responseText: TARGET_PRESENT_ANSWER,
    brand: { name: '广拓', aliases: ['上海广拓'] }
  });

  const structure = result.analysis_structure;
  assert.equal(structure.target_fact.status, 'complete');
  assert.equal(structure.target_fact.brand_mentioned, true);
  assert.equal(structure.target_semantics.sentiment.status, 'unresolved');
  assert.equal(structure.target_semantics.recommendation.status, 'unresolved');
  assert.equal(structure.target_semantics.rank.status, 'unresolved');
  assert.equal(structure.target_semantics.status, 'partial');
  assert.equal(structure.competition_analysis.status, 'unavailable');
  // 顶层兼容占位不进入业务分母：真实状态见 analysis_structure
  assert.equal(result.brand_mentioned, true);
});

test('目标映射歧义：target_fact complete、target_mapping ambiguous、目标语义 unavailable、整条不失败', async () => {
  const answer = [
    '国内脉冲电子围栏成熟厂家：',
    '1. **广拓（Gato）**：上海广拓信息技术有限公司，以智能安防管理平台为核心。',
    '2. **海康威视（HIKVISION）**：杭州海康威视数字技术股份有限公司。'
  ].join('\n');
  const s55Extract = async ({ sourceMap, validateMentions }) => {
    const mentions = [
      { source_id: 'L002', surface_form: '广拓', canonical_name: '广拓', entity_type: 'brand' },
      { source_id: 'L002', surface_form: '上海广拓信息技术有限公司', canonical_name: '上海广拓信息技术有限公司', entity_type: 'company' },
      { source_id: 'L003', surface_form: '海康威视', canonical_name: '海康威视', entity_type: 'brand' }
    ];
    return {
      mentions,
      validated: validateMentions(mentions),
      diagnostics: { stage: 'entity_extract', attempt_count: 1, model: 'deepseek-v4-flash' }
    };
  };
  const service = buildService({
    answer,
    targetBrand: { name: '广拓', aliases: ['上海广拓', 'Gato'] },
    semantic: makeSemantic(false),
    entityExtract: s55Extract
  });
  const result = await service.analyze({
    question: '脉冲电子围栏国内哪几家做得比较成熟？',
    responseText: answer,
    brand: { name: '广拓', aliases: ['上海广拓', 'Gato'] }
  });

  const structure = result.analysis_structure;
  // 目标事实保留确定性扫描（广拓 + 上海广拓 = 2）
  assert.equal(structure.target_fact.status, 'complete');
  assert.equal(structure.target_fact.brand_mentioned, true);
  assert.equal(structure.target_fact.brand_mentions, 2);
  // 目标映射歧义：不任选、不自动合并、不抛整条错误
  assert.equal(structure.target_mapping.status, 'ambiguous');
  assert.equal(structure.target_mapping.target_entity_id, null);
  assert.equal(structure.target_entity_id, null);
  assert.deepEqual(
    [...structure.target_mapping.candidate_entity_ids].sort(),
    ['E001', 'E002']
  );
  // 目标语义因缺唯一实体 ID 而 unavailable
  assert.equal(structure.target_semantics.status, 'unavailable');
  assert.equal(structure.target_semantics.recommendation.status, 'unavailable');
  assert.equal(structure.target_semantics.rank.status, 'unavailable');
  assert.equal(structure.target_semantics.sentiment.status, 'unavailable');
  // 开放竞品实体保留，未解决实体全部登记
  assert.equal(structure.competition_analysis.status, 'partial');
  assert.deepEqual(structure.competition_analysis.entities, ['E001', 'E002', 'E003']);
});

test('目标未出现且阶段 2 失败：语义字段仍为 not_applicable，目标事实不被清空', async () => {
  const service = buildService({
    answer: TARGET_ABSENT_ANSWER,
    targetBrand: { name: '广拓', aliases: ['上海广拓'] },
    semantic: makeSemantic(false, 'positive', true)
  });
  const result = await service.analyze({
    question: '大工业园区用什么安防设备比较好？',
    responseText: TARGET_ABSENT_ANSWER,
    brand: { name: '广拓', aliases: ['上海广拓'] }
  });
  const structure = result.analysis_structure;
  assert.equal(structure.target_fact.status, 'complete');
  assert.equal(structure.target_fact.brand_mentioned, false);
  assert.equal(structure.target_semantics.sentiment.status, 'not_applicable');
  assert.equal(structure.target_semantics.recommendation.status, 'not_applicable');
});

test('并列候选不产生排名，只有有序组内顺序形成排名', async () => {
  const answer = '候选品牌：上海广拓、海康威视。';
  const sourceMap = createSourceMap(answer);
  const catalog = buildEntityCatalog({
    answer,
    sourceMap,
    extractedMentions: [
      { source_id: 'L001', surface_form: '上海广拓', canonical_name: '上海广拓', entity_type: 'brand' },
      { source_id: 'L001', surface_form: '海康威视', canonical_name: '海康威视', entity_type: 'brand' }
    ],
    targetBrand: { name: '广拓', aliases: ['上海广拓'] }
  });
  const { calculate } = require('../services/AIResponseAnalysisV5Service');
  const semantic = {
    competitor_relations: [{ entity_id: 'E002', relation: 'competitor', reason: '同类', evidence_source_ids: ['L001'] }],
    candidate_groups: [{ ordered: false, entries: ['E001', 'E002'], reason: '并列列举', evidence_source_ids: ['L001'] }],
    recommendations: [],
    sentiment: { status: 'assessed', label: 'neutral', reason: '中性', evidence_source_ids: ['L001'], risk_terms: [] }
  };
  const result = calculate({ sourceMap, catalog, semantic, diagnostics: [] });
  assert.equal(result.brand_rank, null);
  assert.equal(result.analysis_structure.target_semantics.rank.status, 'assessed');
  assert.equal(result.analysis_structure.target_semantics.rank.value, null);
});

function makeRealV5Service(queryResults) {
  const calls = [];
  const requestService = {
    async queryConfig(_platform, _prompt) {
      const result = queryResults.shift();
      calls.push(result);
      return result;
    }
  };
  const configService = {
    getAnalysisPlatform: async () => ({
      code: 'deepseek',
      adapter_type: 'openai_chat_completions',
      default_model: 'deepseek-v4-flash'
    })
  };
  const service = new AIResponseAnalysisV5Service({
    entityExtractionService: new AIResponseEntityExtractionService({ configService, requestService }),
    semanticJudgmentService: new AIResponseSemanticJudgmentService({ configService, requestService })
  });
  return { service, calls };
}

function response(text) {
  return {
    success: true,
    data: { choices: [{ finish_reason: 'stop' }], usage: { total_tokens: 100 } },
    text
  };
}

const GOOD_ENTITY = JSON.stringify({ mentions: [{ source_id: 'L001', surface_form: '海康威视', canonical_name: '海康威视', entity_type: 'brand' }] });
const BAD_ENTITY = JSON.stringify({ mentions: [{ source_id: 'L999', surface_form: '不存在的品牌', canonical_name: '不存在', entity_type: 'brand' }] });
const GOOD_SEMANTIC = JSON.stringify({
  competitor_relations: [],
  candidate_groups: [],
  recommendations: [],
  sentiment: { status: 'not_applicable', label: null, reason: '目标未出现', evidence_source_ids: [], risk_terms: [] }
});
const BAD_SEMANTIC = JSON.stringify({
  competitor_relations: [{ entity_id: 'E999', relation: 'competitor', reason: '未知实体', evidence_source_ids: ['L001'] }],
  candidate_groups: [],
  recommendations: [],
  sentiment: { status: 'not_applicable', label: null, reason: '目标未出现', evidence_source_ids: [], risk_terms: [] }
});

const ANSWER = '海康威视是主流品牌。';
const QUESTION = '大型园区安防有哪些厂家？';
const BRAND = { name: '广拓', aliases: [] };

test('调用计数：正常 2 次、双阶段修复 4 次；第二次仍无效按字段降级', async () => {
  // 正常路径：好实体 + 好语义 = 2 次
  const normal = makeRealV5Service([response(GOOD_ENTITY), response(GOOD_SEMANTIC)]);
  const normalResult = await normal.service.analyze({ question: QUESTION, responseText: ANSWER, brand: BRAND });
  assert.equal(normal.calls.length, 2);
  assert.equal(normalResult.analysis_attempts, 2);

  // 双阶段修复：坏实体→好实体、坏语义→好语义 = 4 次
  const repaired = makeRealV5Service([
    response(BAD_ENTITY), response(GOOD_ENTITY),
    response(BAD_SEMANTIC), response(GOOD_SEMANTIC)
  ]);
  const repairedResult = await repaired.service.analyze({ question: QUESTION, responseText: ANSWER, brand: BRAND });
  assert.equal(repaired.calls.length, 4);
  assert.equal(repairedResult.analysis_attempts, 4);
});

test('单阶段修复：阶段 1 修复（3 次）或阶段 2 修复（3 次）不突破调用预算', async () => {
  // 阶段 1 单独修复：坏实体→好实体，好语义 = 3 次
  const stageOneRepair = makeRealV5Service([
    response(BAD_ENTITY), response(GOOD_ENTITY),
    response(GOOD_SEMANTIC)
  ]);
  const stageOneResult = await stageOneRepair.service.analyze({ question: QUESTION, responseText: ANSWER, brand: BRAND });
  assert.equal(stageOneRepair.calls.length, 3);
  assert.equal(stageOneResult.analysis_attempts, 3);

  // 阶段 2 单独修复：好实体，坏语义→好语义 = 3 次
  const stageTwoRepair = makeRealV5Service([
    response(GOOD_ENTITY),
    response(BAD_SEMANTIC), response(GOOD_SEMANTIC)
  ]);
  const stageTwoResult = await stageTwoRepair.service.analyze({ question: QUESTION, responseText: ANSWER, brand: BRAND });
  assert.equal(stageTwoRepair.calls.length, 3);
  assert.equal(stageTwoResult.analysis_attempts, 3);
});

test('阶段 2 第二次仍无效时按字段降级，不回退 v4 或 Pro', async () => {
  const degraded = makeRealV5Service([
    response(GOOD_ENTITY),
    response(BAD_SEMANTIC),
    response(BAD_SEMANTIC)
  ]);
  const result = await degraded.service.analyze({ question: QUESTION, responseText: ANSWER, brand: BRAND });
  // 阶段 1 成功 + 阶段 2 两次尝试 = 3 次
  assert.equal(degraded.calls.length, 3);
  assert.equal(result.analysis_method, 'ai_structured_v5');
  assert.equal(result.analysis_model, 'deepseek-v4-flash');
  assert.equal(result.analysis_structure.target_fact.status, 'complete');
  // 目标未出现，语义字段仍为 not_applicable，竞品轨 unavailable
  assert.equal(result.analysis_structure.target_semantics.sentiment.status, 'not_applicable');
  assert.equal(result.analysis_structure.competition_analysis.status, 'unavailable');
});

test('matched 与 unmatched 的已证明竞品按相同规则进入 scoped SOV 分子分母', async () => {
  const answer = '上海广拓为首选。\n海康威视与大华股份可选。';
  const sourceMap = createSourceMap(answer);
  const catalog = buildEntityCatalog({
    answer,
    sourceMap,
    extractedMentions: [
      { source_id: 'L001', surface_form: '上海广拓', canonical_name: '上海广拓', entity_type: 'company' },
      { source_id: 'L002', surface_form: '海康威视', canonical_name: '海康威视', entity_type: 'brand' },
      { source_id: 'L002', surface_form: '大华股份', canonical_name: '大华股份', entity_type: 'brand' }
    ],
    targetBrand: { name: '广拓', aliases: ['上海广拓'] }
  });
  const { calculate } = require('../services/AIResponseAnalysisV5Service');
  const semantic = {
    competitor_relations: [
      { entity_id: 'E002', relation: 'competitor', reason: '同类', evidence_source_ids: ['L002'] },
      { entity_id: 'E003', relation: 'competitor', reason: '同类', evidence_source_ids: ['L002'] }
    ],
    candidate_groups: [{ ordered: true, entries: ['E001', 'E002', 'E003'], reason: '有顺序', evidence_source_ids: ['L001', 'L002'] }],
    recommendations: [{ entity_id: 'E001', kind: 'explicit', evidence_source_ids: ['L001'] }],
    sentiment: { status: 'assessed', label: 'positive', reason: '首选', evidence_source_ids: ['L001'], risk_terms: [] }
  };
  const result = calculate({
    sourceMap,
    catalog,
    semantic,
    diagnostics: [],
    registrySnapshot: { version: 'competitor_registry_snapshot_v1', sha256: 'x', entry_count: 1 }
  });
  // 目标 1 次 + 海康 1 次 + 大华 1 次
  assert.equal(result.sov_denominator, 3);
  assert.equal(result.sov_numerator, 1);
  assert.equal(result.metric_semantics_version, SCOPED_METRIC_SEMANTICS);
  assert.equal(result.sov_status, 'observed_only');
  assert.equal(result.analysis_structure.sov.status, 'observed_only');
});
