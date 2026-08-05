const test = require('node:test');
const assert = require('node:assert/strict');

const { createSourceMap } = require('../services/AIAnalysisSourceMapService');
const { buildEntityCatalog } = require('../services/AIEntityCatalogService');
const {
  AIResponseSemanticJudgmentService,
  parseSemanticOutput
} = require('../services/AIResponseSemanticJudgmentService');

function challengeContext() {
  const answer = '视频监控：海康威视、大华股份。\n周界报警首选上海广拓。';
  const sourceMap = createSourceMap(answer);
  const catalog = buildEntityCatalog({
    answer,
    sourceMap,
    extractedMentions: [
      { source_id: 'L001', surface_form: '海康威视', canonical_name: '海康威视', entity_type: 'brand' },
      { source_id: 'L001', surface_form: '大华股份', canonical_name: '大华股份', entity_type: 'brand' },
      { source_id: 'L002', surface_form: '上海广拓', canonical_name: '上海广拓', entity_type: 'brand' }
    ],
    targetBrand: { name: '广拓', aliases: ['上海广拓'] }
  });
  return { answer, sourceMap, catalog };
}

function validSemanticOutput() {
  return {
    competitor_relations: [
      {
        entity_id: 'E001',
        relation: 'competitor',
        reason: '属于当前采购场景中的可选品牌',
        evidence_source_ids: ['L001']
      },
      {
        entity_id: 'E002',
        relation: 'competitor',
        reason: '属于当前采购场景中的可选品牌',
        evidence_source_ids: ['L001']
      }
    ],
    candidate_groups: [{
      ordered: false,
      entries: ['E001', 'E002'],
      reason: '回答并列列出两个视频监控品牌',
      evidence_source_ids: ['L001']
    }],
    recommendations: [{
      entity_id: 'E003',
      kind: 'explicit',
      evidence_source_ids: ['L002']
    }],
    sentiment: {
      status: 'assessed',
      label: 'positive',
      reason: '回答明确将目标品牌作为首选',
      evidence_source_ids: ['L002'],
      risk_terms: []
    }
  };
}

test('judges semantics only through closed entity and source IDs', async () => {
  const context = challengeContext();
  let capturedPrompt;
  const service = new AIResponseSemanticJudgmentService({
    configService: {
      getAnalysisPlatform: async () => ({
        code: 'deepseek',
        adapter_type: 'openai_chat_completions',
        default_model: 'deepseek-v4-flash'
      })
    },
    requestService: {
      queryConfig: async (_platform, prompt) => {
        capturedPrompt = prompt;
        return {
          success: true,
          data: { choices: [{ finish_reason: 'stop' }] },
          text: JSON.stringify(validSemanticOutput())
        };
      }
    }
  });

  const result = await service.judge({
    question: '大型园区安防有哪些厂家？',
    sourceMap: context.sourceMap,
    catalog: context.catalog
  });

  assert.match(capturedPrompt, /"target_entity_id":"E003"/);
  assert.match(capturedPrompt, /"entity_id":"E001"/);
  assert.match(capturedPrompt, /"source_id":"L001"/);
  assert.deepEqual(result.structured.recommendations[0], {
    entity_id: 'E003',
    kind: 'explicit',
    evidence_source_ids: ['L002'],
    evidence: ['周界报警首选上海广拓。']
  });
  assert.equal(result.structured.sentiment.label, 'positive');
  assert.equal(result.diagnostics.attempt_count, 1);
});

test('repairs only the semantic stage and cannot introduce an unknown entity', async () => {
  const context = challengeContext();
  const prompts = [];
  const invalid = validSemanticOutput();
  invalid.competitor_relations[0].entity_id = 'E999';
  const outputs = [invalid, validSemanticOutput()];
  const service = new AIResponseSemanticJudgmentService({
    configService: {
      getAnalysisPlatform: async () => ({
        code: 'deepseek',
        adapter_type: 'openai_chat_completions',
        default_model: 'deepseek-v4-flash'
      })
    },
    requestService: {
      queryConfig: async (_platform, prompt) => {
        prompts.push(prompt);
        return {
          success: true,
          data: { choices: [{ finish_reason: 'stop' }] },
          text: JSON.stringify(outputs[prompts.length - 1])
        };
      }
    }
  });

  const result = await service.judge({
    question: '大型园区安防有哪些厂家？',
    sourceMap: context.sourceMap,
    catalog: context.catalog
  });

  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /validation_feedback/);
  assert.match(prompts[1], /competitor_relations\[0\]\.entity_id/);
  assert.doesNotMatch(prompts[1], /E999/);
  assert.equal(result.diagnostics.attempt_count, 2);
  assert.deepEqual(
    result.structured.competitor_relations.map((relation) => relation.entity_id),
    ['E001', 'E002']
  );
});

test('grounds a heading-based candidate group by appending each member source line', () => {
  const answer = [
    '第一梯队（行业头部）',
    '上海广拓',
    '深圳艾礼安',
    '第二梯队',
    '广东长宇'
  ].join('\n');
  const sourceMap = createSourceMap(answer);
  const catalog = buildEntityCatalog({
    answer,
    sourceMap,
    extractedMentions: [
      { source_id: 'L002', surface_form: '上海广拓', canonical_name: '上海广拓', entity_type: 'company' },
      { source_id: 'L003', surface_form: '深圳艾礼安', canonical_name: '深圳艾礼安', entity_type: 'company' },
      { source_id: 'L005', surface_form: '广东长宇', canonical_name: '广东长宇', entity_type: 'company' }
    ],
    targetBrand: { name: '上海广拓', aliases: [] }
  });
  const output = {
    competitor_relations: [
      { entity_id: 'E002', relation: 'competitor', reason: '同一采购场景', evidence_source_ids: ['L003'] },
      { entity_id: 'E003', relation: 'competitor', reason: '同一采购场景', evidence_source_ids: ['L005'] }
    ],
    candidate_groups: [
      {
        ordered: false,
        entries: ['E001', 'E002'],
        reason: '属于第一梯队',
        evidence_source_ids: ['L001']
      },
      {
        ordered: false,
        entries: ['E003'],
        reason: '属于第二梯队',
        evidence_source_ids: ['L004']
      }
    ],
    recommendations: [],
    sentiment: {
      status: 'assessed',
      label: 'neutral',
      reason: '仅做分类',
      evidence_source_ids: ['L002'],
      risk_terms: []
    }
  };

  const parsed = parseSemanticOutput(JSON.stringify(output), { sourceMap, catalog });

  assert.deepEqual(parsed.candidate_groups[0].evidence_source_ids, ['L001', 'L002', 'L003']);
  assert.deepEqual(parsed.candidate_groups[1].evidence_source_ids, ['L004', 'L005']);
});

test('drops a redundant target relation and grounds target sentiment evidence', () => {
  const context = challengeContext();
  const output = validSemanticOutput();
  output.competitor_relations.unshift({
    entity_id: 'E003',
    relation: 'competitor',
    reason: '模型多余输出的目标关系',
    evidence_source_ids: ['L002']
  });
  output.sentiment.evidence_source_ids = ['L001'];

  const parsed = parseSemanticOutput(JSON.stringify(output), {
    sourceMap: context.sourceMap,
    catalog: context.catalog
  });

  assert.deepEqual(
    parsed.competitor_relations.map((relation) => relation.entity_id),
    ['E001', 'E002']
  );
  assert.deepEqual(parsed.sentiment.evidence_source_ids, ['L001', 'L002']);
});

test('combines semantic summary evidence with grounded entity lines for relations and recommendations', () => {
  const context = challengeContext();
  const output = validSemanticOutput();
  output.competitor_relations[0].evidence_source_ids = ['L002'];
  output.recommendations[0].evidence_source_ids = ['L001'];

  const parsed = parseSemanticOutput(JSON.stringify(output), {
    sourceMap: context.sourceMap,
    catalog: context.catalog
  });

  assert.deepEqual(parsed.competitor_relations[0].evidence_source_ids, ['L002', 'L001']);
  assert.deepEqual(parsed.recommendations[0].evidence_source_ids, ['L001', 'L002']);
});

test('normalizes sentiment to not_applicable when the target is absent', () => {
  const answer = '海康威视可作为视频监控供应商。';
  const sourceMap = createSourceMap(answer);
  const catalog = buildEntityCatalog({
    answer,
    sourceMap,
    extractedMentions: [{
      source_id: 'L001', surface_form: '海康威视', canonical_name: '海康威视', entity_type: 'company'
    }],
    targetBrand: { name: '上海广拓', aliases: ['广拓'] }
  });
  const output = {
    competitor_relations: [{
      entity_id: 'E001', relation: 'competitor', reason: '同类供应商', evidence_source_ids: ['L001']
    }],
    candidate_groups: [],
    recommendations: [],
    sentiment: {
      status: 'assessed',
      label: 'neutral',
      reason: '模型错误地输出了情绪判断',
      evidence_source_ids: ['L001'],
      risk_terms: []
    }
  };

  const parsed = parseSemanticOutput(JSON.stringify(output), { sourceMap, catalog });

  assert.deepEqual(parsed.sentiment, {
    status: 'not_applicable',
    label: null,
    reason: '目标实体未在回答中出现，情绪不适用。',
    evidence_source_ids: [],
    evidence: [],
    risk_terms: []
  });
});

test('treats missing competitor relations as unresolved enrichment instead of failing the analysis', () => {
  const context = challengeContext();
  const output = validSemanticOutput();
  output.competitor_relations = [output.competitor_relations[0]];

  const parsed = parseSemanticOutput(JSON.stringify(output), {
    sourceMap: context.sourceMap,
    catalog: context.catalog
  });

  assert.deepEqual(
    parsed.competitor_relations.map((relation) => relation.entity_id),
    ['E001']
  );
  assert.deepEqual(parsed.unresolved_entity_ids, ['E002']);
});

test('still rejects duplicate competitor relations when partial coverage is allowed', () => {
  const context = challengeContext();
  const output = validSemanticOutput();
  output.competitor_relations = [
    output.competitor_relations[0],
    { ...output.competitor_relations[0] }
  ];

  assert.throws(
    () => parseSemanticOutput(JSON.stringify(output), {
      sourceMap: context.sourceMap,
      catalog: context.catalog
    }),
    /重复/
  );
});
