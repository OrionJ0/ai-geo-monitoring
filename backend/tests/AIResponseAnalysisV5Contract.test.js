const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AIResponseAnalysisV5Service,
  calculate
} = require('../services/AIResponseAnalysisV5Service');
const {
  buildEntityCatalog,
  buildTargetMentions
} = require('../services/AIEntityCatalogService');
const { createSourceMap } = require('../services/AIAnalysisSourceMapService');
const { parseSemanticOutput } = require('../services/AIResponseSemanticJudgmentService');

const TARGET_ABSENT_ANSWER = [
  '大工业园区安防核心是全域覆盖与统一管理。',
  '视频监控推荐海康威视、大华股份，门禁可选宇视科技。'
].join('\n');

test('目标品牌未出现时确定性扫描产生 brand_mentioned=false、次数 0，且不产生推荐/排名/有效情绪', async () => {
  const answer = TARGET_ABSENT_ANSWER;
  const sourceMap = createSourceMap(answer);
  const targetMentions = buildTargetMentions(sourceMap, { name: '广拓', aliases: ['上海广拓', 'GATO'] });
  assert.equal(targetMentions.length, 0);

  const service = new AIResponseAnalysisV5Service({
    entityExtractionService: {
      extract: async () => ({
        mentions: [
          { source_id: 'L002', surface_form: '海康威视', canonical_name: '海康威视', entity_type: 'brand' },
          { source_id: 'L002', surface_form: '大华股份', canonical_name: '大华股份', entity_type: 'brand' },
          { source_id: 'L002', surface_form: '宇视科技', canonical_name: '宇视科技', entity_type: 'brand' }
        ],
        diagnostics: { stage: 'entity_extract', attempt_count: 1, model: 'deepseek-v4-flash' }
      })
    },
    semanticJudgmentService: {
      judge: async () => ({
        structured: {
          competitor_relations: [],
          candidate_groups: [],
          recommendations: [],
          sentiment: {
            status: 'not_applicable',
            label: null,
            reason: '目标品牌未出现',
            evidence_source_ids: [],
            risk_terms: []
          }
        },
        diagnostics: { stage: 'semantic_judge', attempt_count: 1, model: 'deepseek-v4-flash' }
      })
    }
  });

  const result = await service.analyze({
    question: '大工业园区用什么安防设备比较好？',
    responseText: answer,
    brand: { name: '广拓', aliases: ['上海广拓', 'GATO'] }
  });

  assert.equal(result.brand_mentioned, false);
  assert.equal(result.brand_mentions, 0);
  assert.equal(result.brand_recommended, false);
  assert.equal(result.brand_rank, null);
  assert.equal(result.sentiment, 'neutral');
  assert.equal(result.analysis_structure.target_mentions.length, 0);
  assert.equal(result.analysis_structure.target_entity_id, null);
});

test('相同完整回答与目标别名重复运行时目标 presence、次数、位置与证据完全一致', () => {
  const answer = '上海广拓是行业品牌。\n海康威视与华为并列。';
  const brand = { name: '广拓', aliases: ['上海广拓'] };
  const sourceMapA = createSourceMap(answer);
  const sourceMapB = createSourceMap(answer);
  const first = buildTargetMentions(sourceMapA, brand);
  const second = buildTargetMentions(sourceMapB, brand);
  assert.deepEqual(first, second);
  assert.equal(first.length, 1);
  assert.equal(first[0].source_id, 'L001');
  assert.equal(first[0].surface_form, '上海广拓');
  assert.ok(Number.isInteger(first[0].start) && Number.isInteger(first[0].end));
});

test('实体目录不因模型 canonical name 或程序派生短名扩大 occurrence', () => {
  const answer = '杭州海康威视科技有限公司视频监控可选，海康与华为并列。';
  const sourceMap = createSourceMap(answer);
  const extractedMentions = [
    { source_id: 'L001', surface_form: '杭州海康威视科技有限公司', canonical_name: '杭州海康威视科技有限公司', entity_type: 'company' },
    { source_id: 'L001', surface_form: '华为', canonical_name: '华为', entity_type: 'brand' }
  ];
  const catalog = buildEntityCatalog({
    answer,
    sourceMap,
    extractedMentions,
    targetBrand: { name: '广拓', aliases: [] }
  });
  const hik = catalog.entities.find((entity) => entity.surface_forms.includes('杭州海康威视科技有限公司'));
  assert.ok(hik, '实体目录应包含海康威视科技');
  // "海康"是程序从公司全名派生的短名，模型未返回、注册表未确认，
  // 不得被派生进目录或 occurrences
  assert.ok(!hik.surface_forms.includes('海康'));
  assert.ok(!hik.mentions.some((mention) => mention.surface_form === '海康'));
  // 实体提及只覆盖已验证表面词的所有出现
  assert.ok(hik.mentions.length >= 1);
  assert.ok(hik.mentions.every((mention) => hik.surface_forms.includes(mention.surface_form)));
});

test('canonical name 不能单独产生目标命中', () => {
  const answer = '某品牌为行业头部。';
  const sourceMap = createSourceMap(answer);
  // 模型把"某品牌"归一为"广拓"，但表面词是"某品牌"，原文没有"广拓"
  const extractedMentions = [
    { source_id: 'L001', surface_form: '某品牌', canonical_name: '广拓', entity_type: 'brand' }
  ];
  const catalog = buildEntityCatalog({
    answer,
    sourceMap,
    extractedMentions,
    targetBrand: { name: '广拓', aliases: ['上海广拓'] }
  });
  // canonical name 不参与目标映射：目标 aliases 中没有"某品牌"
  assert.equal(catalog.target_entity_id, null);
  assert.equal(catalog.target_mentions.length, 0);
});

test('阶段 1 漏掉目标实体时确定性目标事实仍完成，不被清空或降级', () => {
  const answer = '上海广拓是行业品牌。\n海康威视可选。';
  const sourceMap = createSourceMap(answer);
  const extractedMentions = [
    { source_id: 'L002', surface_form: '海康威视', canonical_name: '海康威视', entity_type: 'brand' }
  ];
  const catalog = buildEntityCatalog({
    answer,
    sourceMap,
    extractedMentions,
    targetBrand: { name: '广拓', aliases: ['上海广拓'] }
  });
  // 阶段 1 漏掉目标：实体目录没有目标实体
  assert.equal(catalog.target_entity_id, null);
  // 但目标事实由程序独立扫描产生
  const targetMentions = buildTargetMentions(sourceMap, { name: '广拓', aliases: ['上海广拓'] });
  assert.equal(targetMentions.length, 1);
  assert.equal(targetMentions[0].surface_form, '上海广拓');
});

test('语义判断不自动补语义证据：证据缺少实体出现片段时该字段无效', () => {
  const answer = '海康威视是主流品牌。\n大华股份也是。';
  const sourceMap = createSourceMap(answer);
  const catalog = buildEntityCatalog({
    answer,
    sourceMap,
    extractedMentions: [
      { source_id: 'L001', surface_form: '海康威视', canonical_name: '海康威视', entity_type: 'brand' },
      { source_id: 'L002', surface_form: '大华股份', canonical_name: '大华股份', entity_type: 'brand' }
    ],
    targetBrand: { name: '广拓', aliases: [] }
  });
  const e001 = catalog.entities.find((entity) => entity.entity_id !== catalog.target_entity_id);
  const semanticOutput = {
    competitor_relations: [{
      entity_id: e001.entity_id,
      relation: 'competitor',
      reason: '同类品牌',
      evidence_source_ids: ['L002']
    }],
    candidate_groups: [],
    recommendations: [],
    sentiment: {
      status: 'not_applicable',
      label: null,
      reason: '目标未出现',
      evidence_source_ids: [],
      risk_terms: []
    }
  };
  // 如果 e001 只出现在 L001，而关系证据引用 L002（不含 e001），
  // 程序不得自动补 L001 作为"看起来相关"的证据，应判该字段无效。
  const e001SourceIds = new Set(e001.mentions.map((mention) => mention.source_id));
  if (e001SourceIds.has('L002')) {
    assert.ok(true, 'fixture 已满足证据关联，跳过自动补证据检查');
    return;
  }
  assert.throws(
    () => parseSemanticOutput(JSON.stringify(semanticOutput), { sourceMap, catalog }),
    (error) => error?.code === 'analysis_evidence_reference_invalid'
  );
});

test('calculate 不把模型中性情绪程序性覆盖为正面', () => {
  const answer = '上海广拓为首选。\n海康威视可选。';
  const sourceMap = createSourceMap(answer);
  const catalog = {
    target_entity_id: 'E001',
    target_mentions: [{ source_id: 'L001', start: 0, end: 4, surface_form: '上海广拓' }],
    entities: [{
      entity_id: 'E001',
      name: '上海广拓',
      type: 'company',
      surface_forms: ['上海广拓'],
      mentions: [{ source_id: 'L001', start: 0, end: 4, surface_form: '上海广拓' }]
    }]
  };
  const semantic = {
    competitor_relations: [],
    candidate_groups: [],
    recommendations: [{
      entity_id: 'E001',
      kind: 'explicit',
      evidence_source_ids: ['L001'],
      evidence: ['上海广拓为首选。']
    }],
    sentiment: {
      status: 'assessed',
      label: 'neutral',
      reason: '模型判定中性',
      evidence_source_ids: ['L001'],
      evidence: ['上海广拓为首选。'],
      risk_terms: []
    }
  };
  const result = calculate({ sourceMap, catalog, semantic, diagnostics: [] });
  assert.equal(result.sentiment, 'neutral');
});
