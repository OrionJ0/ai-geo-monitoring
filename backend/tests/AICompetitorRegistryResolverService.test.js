const test = require('node:test');
const assert = require('node:assert/strict');

const { createSourceMap } = require('../services/AIAnalysisSourceMapService');
const { buildEntityCatalog } = require('../services/AIEntityCatalogService');
const { buildEntityPrompt } = require('../services/AIResponseEntityExtractionService');
const { buildSemanticPrompt } = require('../services/AIResponseSemanticJudgmentService');
const {
  SNAPSHOT_VERSION,
  buildRegistrySnapshot,
  projectForSemantic,
  resolveEntityRegistry,
  withRegistryMatches
} = require('../services/AICompetitorRegistryResolverService');

const EMPTY_REGISTRY = [];
const NORMAL_REGISTRY = [
  { id: 12, name: '海康威视', aliases: ['海康', 'Hikvision'], website: 'hikvision.com' },
  { id: 13, name: '大华股份', aliases: ['大华', 'Dahua'], website: 'dahua.com' }
];
const CONFLICT_REGISTRY = [
  { id: 12, name: '海康威视', aliases: ['海康', 'Hikvision'], website: 'hikvision.com' },
  { id: 99, name: '杭州海康威视科技有限公司', aliases: ['Hikvision'], website: 'hk.com' }
];

function buildCatalog(answer, targetBrand = { name: '广拓', aliases: [] }) {
  const sourceMap = createSourceMap(answer);
  const catalog = buildEntityCatalog({
    answer,
    sourceMap,
    extractedMentions: [
      { source_id: 'L001', surface_form: '海康威视', canonical_name: '海康威视', entity_type: 'brand' },
      { source_id: 'L001', surface_form: '大华股份', canonical_name: '大华股份', entity_type: 'brand' },
      { source_id: 'L002', surface_form: '宇视科技', canonical_name: '宇视科技', entity_type: 'brand' }
    ],
    targetBrand
  });
  return { sourceMap, catalog };
}

test('空注册表生成合法稳定快照，匹配返回 unmatched 且完整分析不失败', () => {
  const snapshot = buildRegistrySnapshot(EMPTY_REGISTRY);
  assert.equal(snapshot.version, SNAPSHOT_VERSION);
  assert.deepEqual(snapshot.entries, []);
  assert.equal(snapshot.entry_count, 0);
  assert.ok(snapshot.sha256.length === 64);
  // 空快照重复生成哈希稳定
  assert.equal(buildRegistrySnapshot(EMPTY_REGISTRY).sha256, snapshot.sha256);
});

test('唯一名称/别名命中返回 matched；零命中返回 unmatched；多身份命中返回 ambiguous', () => {
  const snapshot = buildRegistrySnapshot(NORMAL_REGISTRY);
  const entity = { entity_id: 'E001', surface_forms: ['Hikvision', '海康威视'] };
  const matched = resolveEntityRegistry(entity, snapshot);
  assert.equal(matched.status, 'matched');
  assert.equal(matched.competitor_id, 12);
  assert.equal(matched.registry_name, '海康威视');

  const unknown = resolveEntityRegistry({ entity_id: 'E003', surface_forms: ['宇视科技'] }, snapshot);
  assert.equal(unknown.status, 'unmatched');
  assert.deepEqual(unknown.candidate_competitor_ids, []);

  const conflictSnapshot = buildRegistrySnapshot(CONFLICT_REGISTRY);
  const ambiguous = resolveEntityRegistry({ entity_id: 'E001', surface_forms: ['Hikvision'] }, conflictSnapshot);
  assert.equal(ambiguous.status, 'ambiguous');
  assert.ok(ambiguous.candidate_competitor_ids.length >= 2);
});

test('匹配只使用已验证 surface_forms，不扫描注册别名的额外出现位置', () => {
  const answer = '海康威视是主流品牌。\n宇视科技也是。';
  const sourceMap = createSourceMap(answer);
  // 注册表 name 与实体表面词不一致，只有注册别名"海康"；"海康"不是已验证表面词
  const snapshot = buildRegistrySnapshot([{ id: 12, name: '海康威视有限公司', aliases: ['海康'], website: '' }]);
  const catalog = buildEntityCatalog({
    answer,
    sourceMap,
    extractedMentions: [
      { source_id: 'L001', surface_form: '海康威视', canonical_name: '海康威视', entity_type: 'brand' },
      { source_id: 'L002', surface_form: '宇视科技', canonical_name: '宇视科技', entity_type: 'brand' }
    ],
    targetBrand: { name: '广拓', aliases: [] }
  });
  // 实体 surface_form='海康威视' 与注册表 name/aliases（海康威视有限公司/海康）都不相等，
  // 不得因回答包含"海康"而用未注册别名扫描制造命中
  const hik = catalog.entities.find((entity) => entity.surface_forms.includes('海康威视'));
  const match = resolveEntityRegistry(hik, snapshot);
  assert.equal(match.status, 'unmatched');
});

test('注册表匹配前后的 occurrence、source ID、绝对位置、表面词与提及次数深度相等', () => {
  const answer = '海康威视与大华股份可选。\n宇视科技也是。';
  const { sourceMap, catalog } = buildCatalog(answer);
  const before = JSON.stringify(catalog.entities);
  const after = withRegistryMatches(catalog, buildRegistrySnapshot(NORMAL_REGISTRY)).entities;
  // 只附加 registry_match，其它字段深度不变
  after.forEach((entity) => {
    const { registry_match: _match, ...rest } = entity;
    assert.ok(_match, '应附加 registry_match');
  });
  const stripped = after.map(({ registry_match: _m, ...rest }) => rest);
  assert.equal(JSON.stringify(stripped), before);
});

test('表内+表外品牌同时进入相同阶段 2 合同，表外实体不被删除或降级', () => {
  const answer = '海康威视与大华股份可选。\n宇视科技也是。';
  const { sourceMap, catalog } = buildCatalog(answer);
  const resolved = withRegistryMatches(catalog, buildRegistrySnapshot(NORMAL_REGISTRY));
  // 宇视科技不在注册表，仍保留为 unmatched 实体
  const uniview = resolved.entities.find((entity) => entity.surface_forms.includes('宇视科技'));
  assert.ok(uniview, '表外实体必须保留');
  assert.equal(uniview.registry_match.status, 'unmatched');
  // 表内品牌 matched
  const hik = resolved.entities.find((entity) => entity.surface_forms.includes('海康威视'));
  assert.equal(hik.registry_match.status, 'matched');
});

test('表内但原回答未出现的品牌不能进入实体目录或结果', () => {
  const answer = '宇视科技是唯一提到的品牌。';
  const sourceMap = createSourceMap(answer);
  const catalog = buildEntityCatalog({
    answer,
    sourceMap,
    extractedMentions: [
      { source_id: 'L001', surface_form: '宇视科技', canonical_name: '宇视科技', entity_type: 'brand' }
    ],
    targetBrand: { name: '广拓', aliases: [] }
  });
  const resolved = withRegistryMatches(catalog, buildRegistrySnapshot([
    { id: 12, name: '海康威视', aliases: ['海康'], website: '' }
  ]));
  // 海康威视在注册表但原回答未出现，不得制造实体
  assert.equal(resolved.entities.length, 1);
  assert.ok(!resolved.entities.some((entity) => entity.surface_forms.includes('海康威视')));
});

test('同一 source map 搭配空、正常、冲突注册表时阶段 1 请求字节级一致', () => {
  const answer = '海康威视与大华股份可选。\n宇视科技也是。';
  const { sourceMap } = buildCatalog(answer);
  const prompts = [
    buildEntityPrompt(sourceMap),
    buildEntityPrompt(sourceMap),
    buildEntityPrompt(sourceMap)
  ];
  assert.equal(prompts[0], prompts[1]);
  assert.equal(prompts[1], prompts[2]);
  // 阶段 1 请求不含任何注册表身份字段；source map 原文含品牌名是正常的
  assert.doesNotMatch(prompts[0], /competitor_id|registry_match|matched_term|registry_name|"aliases"/);
});

test('同一 grounded 实体目录搭配空、正常、冲突注册表时阶段 2 投影字节级一致', () => {
  const answer = '海康威视与大华股份可选。\n宇视科技也是。';
  const { sourceMap, catalog } = buildCatalog(answer);
  const question = '大型园区安防有哪些厂家？';
  const projections = [
    buildSemanticPrompt({ question, sourceMap, catalog }),
    buildSemanticPrompt({ question, sourceMap, catalog: withRegistryMatches(catalog, buildRegistrySnapshot(EMPTY_REGISTRY)) }),
    buildSemanticPrompt({ question, sourceMap, catalog: withRegistryMatches(catalog, buildRegistrySnapshot(NORMAL_REGISTRY)) }),
    buildSemanticPrompt({ question, sourceMap, catalog: withRegistryMatches(catalog, buildRegistrySnapshot(CONFLICT_REGISTRY)) })
  ];
  assert.equal(projections[0], projections[1]);
  assert.equal(projections[1], projections[2]);
  assert.equal(projections[2], projections[3]);
  assert.doesNotMatch(projections[0], /registry|competitor_id|matched_term|registry_match/);
});

test('阶段 2 实体投影只含 entity_id、name、type、surface_forms、source_ids，不含注册表身份', () => {
  const answer = '海康威视与大华股份可选。\n宇视科技也是。';
  const { catalog } = buildCatalog(answer);
  const projection = projectForSemantic(withRegistryMatches(catalog, buildRegistrySnapshot(NORMAL_REGISTRY)));
  projection.forEach((entity) => {
    assert.deepEqual(Object.keys(entity).sort(), ['entity_id', 'name', 'source_ids', 'surface_forms', 'type']);
  });
});

test('v5 编排器：空、正常、冲突注册表都不增加模型调用（正常仍 2 次），快照写入结构', async () => {
  const { AIResponseAnalysisV5Service } = require('../services/AIResponseAnalysisV5Service');
  const answer = '海康威视与大华股份可选。\n宇视科技也是。';
  const makeService = (competitors) => {
    let calls = 0;
    const service = new AIResponseAnalysisV5Service({
      entityExtractionService: {
        extract: async ({ sourceMap, validateMentions }) => {
          calls += 1;
          const mentions = [
            { source_id: 'L001', surface_form: '海康威视', canonical_name: '海康威视', entity_type: 'brand' },
            { source_id: 'L001', surface_form: '大华股份', canonical_name: '大华股份', entity_type: 'brand' },
            { source_id: 'L002', surface_form: '宇视科技', canonical_name: '宇视科技', entity_type: 'brand' }
          ];
          return { mentions, validated: validateMentions(mentions), diagnostics: { stage: 'entity_extract', attempt_count: 1, model: 'deepseek-v4-flash' } };
        }
      },
      semanticJudgmentService: {
        judge: async ({ catalog }) => {
          calls += 1;
          const nonTarget = catalog.entities.filter((entity) => entity.entity_id !== catalog.target_entity_id);
          return {
            structured: {
              competitor_relations: nonTarget.map((entity) => ({ entity_id: entity.entity_id, relation: 'competitor', reason: '同类', evidence_source_ids: entity.mentions.map((mention) => mention.source_id) })),
              candidate_groups: [],
              recommendations: [],
              sentiment: { status: 'not_applicable', label: null, reason: '目标未出现', evidence_source_ids: [], risk_terms: [] }
            },
            diagnostics: { stage: 'semantic_judge', attempt_count: 1, model: 'deepseek-v4-flash' }
          };
        }
      },
      _getCalls: () => calls
    });
    service._getCalls = () => calls;
    return service;
  };

  for (const competitors of [EMPTY_REGISTRY, NORMAL_REGISTRY, CONFLICT_REGISTRY]) {
    const service = makeService(competitors);
    const result = await service.analyze({
      question: '大型园区安防有哪些厂家？',
      responseText: answer,
      brand: { name: '广拓', aliases: [] },
      competitors
    });
    assert.equal(service._getCalls(), 2, '注册表命中/未命中/歧义都不增加模型调用');
    assert.equal(result.analysis_attempts, 2);
    assert.equal(result.analysis_structure.competitor_registry_snapshot.version, 'competitor_registry_snapshot_v1');
    assert.equal(result.analysis_structure.competitor_registry_snapshot.entry_count, competitors.length);
    const entity = result.analysis_structure.entities.find((item) => item.surface_forms.includes('海康威视'));
    assert.ok(entity.registry_match, '实体应附加 registry_match 身份元数据');
  }
});
