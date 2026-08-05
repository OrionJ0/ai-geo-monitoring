const test = require('node:test');
const assert = require('node:assert/strict');

const { createSourceMap } = require('../services/AIAnalysisSourceMapService');
const { buildEntityCatalog } = require('../services/AIEntityCatalogService');
const {
  AIResponseSemanticJudgmentService,
  parseSemanticOutput,
  buildSemanticPrompt
} = require('../services/AIResponseSemanticJudgmentService');

// ---- semantic_evidence_v2：语义上下文与实体出现分轨 ----

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
        semantic_context_source_ids: ['L001']
      },
      {
        entity_id: 'E002',
        relation: 'competitor',
        reason: '属于当前采购场景中的可选品牌',
        semantic_context_source_ids: ['L001']
      }
    ],
    candidate_groups: [{
      ordered: false,
      entries: ['E001', 'E002'],
      reason: '回答并列列出两个视频监控品牌',
      semantic_context_source_ids: ['L001']
    }],
    recommendations: [{
      entity_id: 'E003',
      kind: 'explicit',
      semantic_context_source_ids: ['L002']
    }],
    sentiment: {
      status: 'assessed',
      label: 'positive',
      reason: '回答明确将目标品牌作为首选',
      semantic_context_source_ids: ['L002'],
      risk_terms: []
    }
  };
}

function makeService(outputs, { collectPrompts = false } = {}) {
  const prompts = [];
  let index = 0;
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
        const output = typeof outputs === 'function'
          ? outputs(index, prompts)
          : (Array.isArray(outputs) ? outputs[index] : outputs);
        index += 1;
        if (collectPrompts) prompts.push(prompt);
        return {
          success: true,
          data: { choices: [{ finish_reason: 'stop' }] },
          text: typeof output === 'string' ? output : JSON.stringify(output)
        };
      }
    }
  });
  return { service, prompts };
}

test('v2 提示词与输出合同只使用 semantic_context_source_ids', () => {
  const context = challengeContext();
  const prompt = buildSemanticPrompt({
    question: '大型园区安防有哪些厂家？',
    sourceMap: context.sourceMap,
    catalog: context.catalog
  });
  assert.match(prompt, /semantic_context_source_ids/);
  assert.doesNotMatch(prompt, /evidence_source_ids/);
  assert.match(prompt, /"target_entity_id":"E003"/);
  assert.match(prompt, /"source_id":"L001"/);
});

test('judges semantics only through closed entity and source IDs', async () => {
  const context = challengeContext();
  const { service } = makeService(validSemanticOutput(), { collectPrompts: true });
  const result = await service.judge({
    question: '大型园区安防有哪些厂家？',
    sourceMap: context.sourceMap,
    catalog: context.catalog
  });

  assert.deepEqual(result.structured.recommendations[0], {
    entity_id: 'E003',
    kind: 'explicit',
    semantic_context_source_ids: ['L002'],
    evidence: ['周界报警首选上海广拓。']
  });
  assert.equal(result.structured.sentiment.label, 'positive');
  assert.equal(result.diagnostics.attempt_count, 1);
});

test('v2 跨片段语义上下文：关系/推荐/情绪可引用不含实体 occurrence 的片段', () => {
  const context = challengeContext();
  // L002 不含 E001（海康威视）occurrence，但语义上"首选上海广拓"支撑采购场景关系
  const output = {
    competitor_relations: [
      { entity_id: 'E001', relation: 'competitor', reason: '同一采购场景', semantic_context_source_ids: ['L002'] }
    ],
    candidate_groups: [],
    recommendations: [
      { entity_id: 'E003', kind: 'explicit', semantic_context_source_ids: ['L002'] }
    ],
    sentiment: {
      status: 'assessed',
      label: 'positive',
      reason: '回答明确将目标品牌作为首选',
      semantic_context_source_ids: ['L002'],
      risk_terms: []
    }
  };
  const parsed = parseSemanticOutput(JSON.stringify(output), {
    sourceMap: context.sourceMap,
    catalog: context.catalog
  });
  assert.deepEqual(parsed.competitor_relations[0].semantic_context_source_ids, ['L002']);
  assert.deepEqual(parsed.recommendations[0].semantic_context_source_ids, ['L002']);
  assert.deepEqual(parsed.sentiment.semantic_context_source_ids, ['L002']);
});

test('repairs only the semantic stage and cannot introduce an unknown entity', async () => {
  const context = challengeContext();
  const { service, prompts } = makeService((callIndex) => {
    if (callIndex === 0) {
      const invalid = validSemanticOutput();
      invalid.competitor_relations[0].entity_id = 'E999';
      return invalid;
    }
    return validSemanticOutput();
  }, { collectPrompts: true });

  const result = await service.judge({
    question: '大型园区安防有哪些厂家？',
    sourceMap: context.sourceMap,
    catalog: context.catalog
  });

  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /validation_feedback/);
  assert.match(prompts[1], /competitor_relations\[0\]\.entity_id/);
  assert.match(prompts[1], /<source_map>/);
  assert.match(prompts[1], /<entity_occurrence_ids>/);
  assert.match(prompts[1], /E001: L001/);
  assert.doesNotMatch(prompts[1], /E999/);
  assert.equal(result.diagnostics.attempt_count, 2);
  assert.deepEqual(
    result.structured.competitor_relations.map((relation) => relation.entity_id),
    ['E001', 'E002']
  );
});

test('keeps candidate-group semantic context without auto-appending member lines', () => {
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
  // 模型只引用分组标题 L001，v2 允许语义上下文与成员 occurrence 分轨
  const output = {
    competitor_relations: [
      { entity_id: 'E002', relation: 'competitor', reason: '同一采购场景', semantic_context_source_ids: ['L003'] },
      { entity_id: 'E003', relation: 'competitor', reason: '同一采购场景', semantic_context_source_ids: ['L005'] }
    ],
    candidate_groups: [
      { ordered: false, entries: ['E001', 'E002'], reason: '属于第一梯队', semantic_context_source_ids: ['L001'] },
      { ordered: false, entries: ['E003'], reason: '属于第二梯队', semantic_context_source_ids: ['L004'] }
    ],
    recommendations: [],
    sentiment: {
      status: 'assessed',
      label: 'neutral',
      reason: '仅做分类',
      semantic_context_source_ids: ['L001'],
      risk_terms: []
    }
  };
  const parsed = parseSemanticOutput(JSON.stringify(output), { sourceMap, catalog });
  // 程序不得自动把成员行 L002/L003 补进分组语义上下文
  assert.deepEqual(parsed.candidate_groups[0].semantic_context_source_ids, ['L001']);
  assert.deepEqual(parsed.candidate_groups[1].semantic_context_source_ids, ['L004']);
});

test('drops a redundant target relation and rejects sentiment context that references an empty-line segment', () => {
  const context = challengeContext();
  const output = validSemanticOutput();
  output.competitor_relations.unshift({
    entity_id: 'E003',
    relation: 'competitor',
    reason: '模型多余输出的目标关系',
    semantic_context_source_ids: ['L002']
  });
  // 引用无任何内容的片段 -> 明显不支持，程序不得自动补真实上下文
  const emptyTextSourceMap = {
    version: 'answer_source_lines_v1',
    answer_sha256: 'fixture',
    segments: [
      { source_id: 'L001', start: 0, end: 0, text: '' },
      { source_id: 'L002', start: 0, end: 0, text: '' }
    ]
  };
  output.sentiment.semantic_context_source_ids = ['L002'];

  assert.throws(
    () => parseSemanticOutput(JSON.stringify(output), {
      sourceMap: emptyTextSourceMap,
      catalog: context.catalog
    }),
    (error) => error?.code === 'analysis_evidence_reference_invalid'
  );

  const fixed = validSemanticOutput();
  fixed.competitor_relations.unshift({
    entity_id: 'E003',
    relation: 'competitor',
    reason: '模型多余输出的目标关系',
    semantic_context_source_ids: ['L002']
  });
  const parsed = parseSemanticOutput(JSON.stringify(fixed), {
    sourceMap: context.sourceMap,
    catalog: context.catalog
  });
  assert.deepEqual(
    parsed.competitor_relations.map((relation) => relation.entity_id),
    ['E001', 'E002']
  );
  assert.deepEqual(parsed.sentiment.semantic_context_source_ids, ['L002']);
});

test('v2 拒绝未知、空或明显不支持的 semantic context，且程序不得自动生成上下文', () => {
  const context = challengeContext();
  const unknown = {
    competitor_relations: [{ entity_id: 'E001', relation: 'competitor', reason: 'x', semantic_context_source_ids: ['L999'] }],
    candidate_groups: [],
    recommendations: [],
    sentiment: { status: 'not_applicable', label: null, reason: '目标未出现', semantic_context_source_ids: [], risk_terms: [] }
  };
  assert.throws(
    () => parseSemanticOutput(JSON.stringify(unknown), { sourceMap: context.sourceMap, catalog: context.catalog }),
    (error) => error?.code === 'analysis_evidence_reference_invalid'
  );
  const empty = {
    competitor_relations: [{ entity_id: 'E001', relation: 'competitor', reason: 'x', semantic_context_source_ids: [] }],
    candidate_groups: [],
    recommendations: [],
    sentiment: { status: 'not_applicable', label: null, reason: '目标未出现', semantic_context_source_ids: [], risk_terms: [] }
  };
  assert.throws(
    () => parseSemanticOutput(JSON.stringify(empty), { sourceMap: context.sourceMap, catalog: context.catalog }),
    (error) => error?.code === 'analysis_semantic_output_invalid'
  );
  // 引用无任何内容的片段 -> 明显不支持，程序不得自动补真实上下文
  const emptyTextSourceMap = {
    version: 'answer_source_lines_v1',
    answer_sha256: 'fixture',
    segments: [
      { source_id: 'L001', start: 0, end: 0, text: '' },
      { source_id: 'L002', start: 0, end: 0, text: '' }
    ]
  };
  const unsupported = {
    competitor_relations: [],
    candidate_groups: [],
    recommendations: [],
    sentiment: {
      status: 'assessed',
      label: 'positive',
      reason: '模型给出的情绪',
      semantic_context_source_ids: ['L002'],
      risk_terms: []
    }
  };
  assert.throws(
    () => parseSemanticOutput(JSON.stringify(unsupported), { sourceMap: emptyTextSourceMap, catalog: context.catalog }),
    (error) => error?.code === 'analysis_evidence_reference_invalid'
  );
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
      entity_id: 'E001', relation: 'competitor', reason: '同类供应商', semantic_context_source_ids: ['L001']
    }],
    candidate_groups: [],
    recommendations: [],
    sentiment: {
      status: 'assessed',
      label: 'neutral',
      reason: '模型错误地输出了情绪判断',
      semantic_context_source_ids: ['L001'],
      risk_terms: []
    }
  };

  const parsed = parseSemanticOutput(JSON.stringify(output), { sourceMap, catalog });

  assert.deepEqual(parsed.sentiment, {
    status: 'not_applicable',
    label: null,
    reason: '目标实体未在回答中出现，情绪不适用。',
    semantic_context_source_ids: [],
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

test('重复推荐合并为单条并集上下文，程序不补写模型未给出的上下文', () => {
  const answer = [
    '候选品牌：上海广拓、海康威视。',
    '周界报警首选上海广拓。',
    '综合可靠性考虑，也推荐广拓。'
  ].join('\n');
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
  const output = {
    competitor_relations: [],
    candidate_groups: [],
    recommendations: [
      { entity_id: 'E001', kind: 'explicit', semantic_context_source_ids: ['L002'] },
      { entity_id: 'E001', kind: 'explicit', semantic_context_source_ids: ['L003'] }
    ],
    sentiment: {
      status: 'assessed',
      label: 'positive',
      reason: '回答明确推荐目标品牌',
      semantic_context_source_ids: ['L002', 'L003'],
      risk_terms: []
    }
  };
  const parsed = parseSemanticOutput(JSON.stringify(output), { sourceMap, catalog });
  assert.equal(parsed.recommendations.length, 1);
  assert.deepEqual(parsed.recommendations[0].semantic_context_source_ids, ['L002', 'L003']);
  assert.deepEqual(parsed.recommendations[0].evidence, [
    '周界报警首选上海广拓。',
    '综合可靠性考虑，也推荐广拓。'
  ]);
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
