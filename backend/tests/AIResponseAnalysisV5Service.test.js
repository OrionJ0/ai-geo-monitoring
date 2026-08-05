const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AIResponseAnalysisV5Service,
  calculate
} = require('../services/AIResponseAnalysisV5Service');
const { createSourceMap } = require('../services/AIAnalysisSourceMapService');

test('computes v5 GEO metrics from grounded entities and closed semantic IDs', async () => {
  const responseText = '海康威视和大华股份可选。\n上海广拓为周界报警首选。';
  let extractedSourceMap;
  let judgedCatalog;
  const service = new AIResponseAnalysisV5Service({
    entityExtractionService: {
      extract: async ({ sourceMap, validateMentions }) => {
        extractedSourceMap = sourceMap;
        const mentions = [
          { source_id: 'L001', surface_form: '海康威视', canonical_name: '海康威视', entity_type: 'brand' },
          { source_id: 'L001', surface_form: '大华股份', canonical_name: '大华股份', entity_type: 'brand' },
          { source_id: 'L002', surface_form: '上海广拓', canonical_name: '上海广拓', entity_type: 'brand' }
        ];
        return {
          mentions,
          validated: validateMentions(mentions),
          diagnostics: {
            stage: 'entity_extract',
            attempt_count: 1,
            model: 'deepseek-v4-flash',
            usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
          }
        };
      }
    },
    semanticJudgmentService: {
      judge: async ({ catalog }) => {
        judgedCatalog = catalog;
        return {
          structured: {
            competitor_relations: [
              {
                entity_id: 'E001',
                relation: 'competitor',
                reason: '同一采购问题中的可选品牌',
                evidence_source_ids: ['L001'],
                evidence: ['海康威视和大华股份可选。']
              },
              {
                entity_id: 'E002',
                relation: 'competitor',
                reason: '同一采购问题中的可选品牌',
                evidence_source_ids: ['L001'],
                evidence: ['海康威视和大华股份可选。']
              }
            ],
            candidate_groups: [{
              ordered: true,
              entries: ['E003', 'E001', 'E002'],
              reason: '回答明确将目标品牌作为首选',
              evidence_source_ids: ['L001', 'L002'],
              evidence: ['海康威视和大华股份可选。', '上海广拓为周界报警首选。']
            }],
            recommendations: [{
              entity_id: 'E003',
              kind: 'explicit',
              evidence_source_ids: ['L002'],
              evidence: ['上海广拓为周界报警首选。']
            }],
            sentiment: {
              status: 'assessed',
              label: 'positive',
              reason: '明确首选目标品牌',
              evidence_source_ids: ['L002'],
              evidence: ['上海广拓为周界报警首选。'],
              risk_terms: []
            }
          },
          diagnostics: {
            stage: 'semantic_judge',
            attempt_count: 1,
            model: 'deepseek-v4-flash',
            usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 }
          }
        };
      }
    }
  });

  const result = await service.analyze({
    question: '大型园区安防有哪些厂家？',
    responseText,
    brand: { name: '广拓', aliases: ['上海广拓'] }
  });

  assert.equal(extractedSourceMap.answer_sha256, result.analysis_structure.answer_sha256);
  assert.equal(judgedCatalog.target_entity_id, 'E003');
  assert.equal(result.analysis_method, 'ai_structured_v5');
  assert.equal(result.analysis_model, 'deepseek-v4-flash');
  assert.equal(result.brand_mentioned, true);
  assert.equal(result.brand_mentions, 1);
  assert.equal(result.brand_rank, 1);
  assert.equal(result.brand_recommended, true);
  assert.equal(result.sov_numerator, 1);
  assert.equal(result.sov_denominator, 3);
  assert.equal(result.answer_competitor_share, 33.33);
  assert.equal(result.sentiment, 'positive');
  assert.equal(result.analysis_attempts, 2);
  assert.deepEqual(result.analysis_structure.claims, {
    status: 'not_collected',
    items: []
  });
});

test('counts one mention per source line and derives recommendation and rank from grounded wording', () => {
  const answer = [
    '1. 上海广拓（GATO）',
    '2. 海康威视',
    '品牌表：上海广拓',
    '大型项目选择上海广拓。'
  ].join('\n');
  const sourceMap = createSourceMap(answer);
  const catalog = {
    target_entity_id: 'E001',
    entities: [
      {
        entity_id: 'E001',
        name: '上海广拓',
        type: 'company',
        surface_forms: ['上海广拓', 'GATO'],
        mentions: [
          { source_id: 'L001', start: 3, end: 7, surface_form: '上海广拓' },
          { source_id: 'L001', start: 8, end: 12, surface_form: 'GATO' },
          { source_id: 'L003', start: 25, end: 29, surface_form: '上海广拓' },
          { source_id: 'L004', start: 35, end: 39, surface_form: '上海广拓' }
        ]
      },
      {
        entity_id: 'E002',
        name: '海康威视',
        type: 'company',
        surface_forms: ['海康威视'],
        mentions: [{ source_id: 'L002', start: 15, end: 19, surface_form: '海康威视' }]
      }
    ]
  };
  const semantic = {
    competitor_relations: [{
      entity_id: 'E002', relation: 'competitor', reason: '同类厂家', evidence_source_ids: ['L002'], evidence: ['2. 海康威视']
    }],
    candidate_groups: [{
      ordered: false,
      entries: ['E001', 'E002'],
      reason: '编号列表',
      evidence_source_ids: ['L001', 'L002'],
      evidence: ['1. 上海广拓（GATO）', '2. 海康威视']
    }],
    recommendations: [{
      entity_id: 'E001', kind: 'explicit', evidence_source_ids: ['L004'], evidence: ['大型项目选择上海广拓。']
    }],
    sentiment: {
      status: 'assessed', label: 'neutral', reason: '模型输出中性', evidence_source_ids: ['L001'], evidence: ['1. 上海广拓（GATO）'], risk_terms: []
    }
  };

  const result = calculate({ sourceMap, catalog, semantic, diagnostics: [] });

  assert.equal(result.brand_mentions, 3);
  assert.equal(result.brand_rank, 1);
  assert.equal(result.brand_recommended, true);
  // 程序不覆盖模型语义判断：模型返回 neutral，即使目标被推荐也保持 neutral
  assert.equal(result.sentiment, 'neutral');
  assert.equal(result.sov_denominator, 4);
});

test('does not treat a numbered selection step as brand rank', () => {
  const answer = [
    '候选品牌：上海广拓、海康威视。',
    '3. 大型项目选择上海广拓。'
  ].join('\n');
  const sourceMap = createSourceMap(answer);
  const catalog = {
    target_entity_id: 'E001',
    entities: [
      {
        entity_id: 'E001', name: '上海广拓', type: 'company', surface_forms: ['上海广拓'],
        mentions: [
          { source_id: 'L001', start: 5, end: 9, surface_form: '上海广拓' },
          { source_id: 'L002', start: 20, end: 24, surface_form: '上海广拓' }
        ]
      },
      {
        entity_id: 'E002', name: '海康威视', type: 'company', surface_forms: ['海康威视'],
        mentions: [{ source_id: 'L001', start: 10, end: 14, surface_form: '海康威视' }]
      }
    ]
  };
  const semantic = {
    competitor_relations: [{ entity_id: 'E002', relation: 'competitor', reason: '同类', evidence_source_ids: ['L001'], evidence: [sourceMap.segments[0].text] }],
    candidate_groups: [{ ordered: false, entries: ['E001', 'E002'], reason: '并列', evidence_source_ids: ['L001'], evidence: [sourceMap.segments[0].text] }],
    recommendations: [{ entity_id: 'E001', kind: 'explicit', evidence_source_ids: ['L002'], evidence: [sourceMap.segments[1].text] }],
    sentiment: { status: 'assessed', label: 'neutral', reason: '模型输出中性', evidence_source_ids: ['L002'], evidence: ['上海广拓的综合能力较强。'], risk_terms: [] }
  };

  const result = calculate({ sourceMap, catalog, semantic, diagnostics: [] });

  assert.equal(result.brand_rank, null);
  assert.equal(result.brand_recommended, true);
});

test('does not transfer a product-category recommendation cue onto a listed brand', () => {
  const sourceMap = createSourceMap([
    '1. 张力式电子围栏（优先推荐）',
    '- 上海广拓：行业品牌'
  ].join('\n'));
  const catalog = {
    target_entity_id: 'E001',
    target_mentions: [{ source_id: 'L002', start: 20, end: 24, surface_form: '上海广拓' }],
    entities: [{
      entity_id: 'E001', name: '上海广拓', type: 'company', surface_forms: ['上海广拓'],
      mentions: [{ source_id: 'L002', start: 20, end: 24, surface_form: '上海广拓' }]
    }]
  };
  const semantic = {
    competitor_relations: [],
    candidate_groups: [],
    recommendations: [{
      entity_id: 'E001', kind: 'explicit', evidence_source_ids: ['L001', 'L002'],
      evidence: [sourceMap.segments[0].text, sourceMap.segments[1].text]
    }],
    sentiment: { status: 'assessed', label: 'positive', reason: '正面', evidence_source_ids: ['L002'], evidence: [sourceMap.segments[1].text], risk_terms: [] }
  };

  const result = calculate({ sourceMap, catalog, semantic, diagnostics: [] });

  assert.equal(result.brand_recommended, false);
  assert.equal(result.sentiment, 'positive');
});

test('accepts an adjacent brand-list recommendation without transferring distant cues', () => {
  const sourceMap = createSourceMap([
    '以下是三个市场口碑良好的品牌，可根据实际需求选择：',
    '1. 广拓Gato',
    '产品稳定，适合工业园区。'
  ].join('\n'));
  const catalog = {
    target_entity_id: 'E001',
    target_mentions: [{ source_id: 'L002', start: 27, end: 29, surface_form: '广拓' }],
    entities: [{
      entity_id: 'E001', name: '广拓Gato', type: 'brand', surface_forms: ['广拓Gato', '广拓'],
      mentions: [{ source_id: 'L002', start: 27, end: 29, surface_form: '广拓' }]
    }]
  };
  const semantic = {
    competitor_relations: [],
    candidate_groups: [],
    recommendations: [{
      entity_id: 'E001', kind: 'explicit', evidence_source_ids: ['L001', 'L002'],
      evidence: [sourceMap.segments[0].text, sourceMap.segments[1].text]
    }],
    sentiment: { status: 'assessed', label: 'positive', reason: '正面', evidence_source_ids: ['L002'], evidence: [sourceMap.segments[1].text], risk_terms: [] }
  };

  const result = calculate({ sourceMap, catalog, semantic, diagnostics: [] });

  assert.equal(result.brand_recommended, true);
});

test('treats purchase-reference wording on the target line as an explicit recommendation cue', () => {
  const sourceMap = createSourceMap('上海广拓是核心代表企业，以下信息供你采购参考。');
  const catalog = {
    target_entity_id: 'E001',
    target_mentions: [{ source_id: 'L001', start: 0, end: 4, surface_form: '上海广拓' }],
    entities: [{
      entity_id: 'E001', name: '上海广拓', type: 'company', surface_forms: ['上海广拓'],
      mentions: [{ source_id: 'L001', start: 0, end: 4, surface_form: '上海广拓' }]
    }]
  };
  const semantic = {
    competitor_relations: [],
    candidate_groups: [],
    recommendations: [{
      entity_id: 'E001', kind: 'explicit', evidence_source_ids: ['L001'],
      evidence: [sourceMap.segments[0].text]
    }],
    sentiment: { status: 'assessed', label: 'positive', reason: '正面', evidence_source_ids: ['L001'], evidence: [sourceMap.segments[0].text], risk_terms: [] }
  };

  const result = calculate({ sourceMap, catalog, semantic, diagnostics: [] });

  assert.equal(result.brand_recommended, true);
});

test('computes target metrics when competitor enrichment is partial', () => {
  const sourceMap = createSourceMap('上海广拓为首选。\n海康威视可选。\n大华股份可选。');
  const catalog = {
    target_entity_id: 'E001',
    target_mentions: [{ source_id: 'L001', start: 0, end: 4, surface_form: '上海广拓' }],
    entities: [
      {
        entity_id: 'E001', name: '上海广拓', type: 'company', surface_forms: ['上海广拓'],
        mentions: [{ source_id: 'L001', start: 0, end: 4, surface_form: '上海广拓' }]
      },
      {
        entity_id: 'E002', name: '海康威视', type: 'company', surface_forms: ['海康威视'],
        mentions: [{ source_id: 'L002', start: 9, end: 13, surface_form: '海康威视' }]
      },
      {
        entity_id: 'E003', name: '大华股份', type: 'company', surface_forms: ['大华股份'],
        mentions: [{ source_id: 'L003', start: 17, end: 21, surface_form: '大华股份' }]
      }
    ]
  };
  const semantic = {
    competitor_relations: [{
      entity_id: 'E002', relation: 'competitor', reason: '同类厂商',
      evidence_source_ids: ['L002'], evidence: ['海康威视可选。']
    }],
    unresolved_entity_ids: ['E003'],
    candidate_groups: [],
    recommendations: [{
      entity_id: 'E001', kind: 'explicit', evidence_source_ids: ['L001'], evidence: ['上海广拓为首选。']
    }],
    sentiment: {
      status: 'assessed', label: 'positive', reason: '明确首选',
      evidence_source_ids: ['L001'], evidence: ['上海广拓为首选。'], risk_terms: []
    }
  };

  const result = calculate({ sourceMap, catalog, semantic, diagnostics: [] });

  assert.equal(result.brand_mentioned, true);
  assert.equal(result.brand_recommended, true);
  assert.equal(result.competition_analysis_status, 'partial');
  assert.equal(result.competition_scope, 'open_discovery');
  assert.equal(result.competition_completeness, 'not_proven');
  assert.deepEqual(result.analysis_structure.unresolved_entity_ids, ['E003']);
  assert.deepEqual(result.competition_entities.map((entity) => entity.entity_id), ['E002']);
  assert.equal(result.sov_denominator, 2);
});
