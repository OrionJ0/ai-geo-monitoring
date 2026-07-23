const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AIResponseAnalysisService
} = require('../services/AIResponseAnalysisService');

test('exposes the same versioned prompt template used by runtime analysis', () => {
  const service = new AIResponseAnalysisService();
  const definition = service.getPromptDefinition();

  assert.equal(definition.version, 'ai_structured_v2');
  assert.match(definition.template, /你是 GEO 回答结构化器/);
  assert.match(definition.template, /\{\{目标品牌\}\}/);
  assert.match(definition.template, /\{\{待分析的 AI 回答\}\}/);
  assert.match(definition.template, /全部品牌或公司实体/);
  assert.match(definition.template, /target_entity_name/);
  assert.match(definition.template, /competitor_matches/);
  assert.match(definition.template, /不要返回 mention_count、recommended、rank、比例、分数/);
  assert.doesNotMatch(definition.template, /逐字原文/);
  assert.deepEqual(definition.runtime_fields, [
    '目标品牌',
    '品牌别名',
    '已配置竞品',
    '待分析的 AI 回答'
  ]);
});

test('structures all entities and relations, then computes target metrics outside the model', async () => {
  const responseText = [
    '1. 海康威视：综合安防能力强。',
    '2. 大华股份：项目覆盖广。',
    '3. 上海广拓（GATO）：在张力式电子围栏领域经验丰富，是专业领域的头部选择。'
  ].join('\n');
  const service = new AIResponseAnalysisService({
    configService: {
      getAnalysisPlatform: async () => ({
        code: 'analysis-ai',
        default_model: 'analysis-model'
      })
    },
    requestService: {
      queryConfig: async () => ({
        success: true,
        text: JSON.stringify({
          entities: [
            { name: '海康威视', type: 'company' },
            { name: '大华股份', type: 'company' },
            { name: '上海广拓', type: 'company' }
          ],
          mentions: [
            { entity_name: '海康威视', surface_forms: ['海康威视'] },
            { entity_name: '大华股份', surface_forms: ['大华股份'] },
            { entity_name: '上海广拓', surface_forms: ['上海广拓', 'GATO'] }
          ],
          target_entity_name: '上海广拓',
          competitor_matches: [],
          candidate_lists: [{
            ordered: true,
            entries: ['海康威视', '大华股份', '上海广拓']
          }],
          recommendations: [{
            entity_name: '上海广拓',
            kind: 'explicit'
          }],
          claims: [{
            subject_name: '上海广拓',
            predicate: '领域经验',
            value: '张力式电子围栏领域经验丰富'
          }],
          sentiment: {
            label: 'positive',
            reason: '列为专业头部选择',
            risk_terms: []
          }
        })
      })
    }
  });

  const result = await service.analyze({
    responseText,
    brand: { name: '上海广拓', aliases: ['广拓', 'GATO'] },
    competitors: []
  });

  assert.equal(result.brand_mentioned, true);
  assert.equal(result.brand_mentions, 1);
  assert.equal(result.brand_recommended, true);
  assert.equal(result.brand_rank, 3);
  assert.equal(result.share_of_voice, 0, 'SOV is not calculated without competitors');
  assert.equal(result.analysis_method, 'ai_structured_v2');
  assert.equal(result.analysis_platform, 'analysis-ai');
  assert.equal(result.analysis_model, 'analysis-model');
  assert.deepEqual(result.analysis_structure.entities.map((item) => item.name), [
    '海康威视',
    '大华股份',
    '上海广拓'
  ]);
  assert.deepEqual(result.analysis_structure.candidate_lists[0].entries, [
    '海康威视',
    '大华股份',
    '上海广拓'
  ]);
  assert.equal(result.analysis_structure.target_entity_name, '上海广拓');
  assert.deepEqual(result.analysis_structure.competitor_matches, []);
  assert.equal(result.analysis_structure.claims[0].predicate, '领域经验');
  assert.equal(result.analysis_evidence, undefined);
});

test('rejects a structured mention when its short surface form is not in the original answer', async () => {
  const service = new AIResponseAnalysisService({
    configService: {
      getAnalysisPlatform: async () => ({ code: 'analysis-ai', default_model: 'analysis-model' })
    },
    requestService: {
      queryConfig: async () => ({
        success: true,
        text: JSON.stringify({
          entities: [{ name: '广拓', type: 'brand' }],
          mentions: [{ entity_name: '广拓', surface_forms: ['GATO'] }],
          target_entity_name: '广拓',
          competitor_matches: [],
          candidate_lists: [],
          recommendations: [],
          claims: [],
          sentiment: { label: 'positive', reason: '', risk_terms: [] }
        })
      })
    }
  });

  await assert.rejects(
    service.analyze({
      responseText: '回答只在背景信息中提到广拓，没有给出推荐或厂商排名。',
      brand: { name: '广拓' },
      competitors: []
    }),
    /无法在原回答中定位/
  );
});

test('computes SOV from structured mention counts only when competitors are configured', async () => {
  const responseText = '海康出现两次：海康。广拓出现一次。';
  const service = new AIResponseAnalysisService({
    configService: {
      getAnalysisPlatform: async () => ({ code: 'analysis-ai', default_model: 'analysis-model' })
    },
    requestService: {
      queryConfig: async () => ({
        success: true,
        text: JSON.stringify({
          entities: [
            { name: '海康', type: 'brand' },
            { name: '广拓', type: 'brand' }
          ],
          mentions: [
            { entity_name: '海康', surface_forms: ['海康'] },
            { entity_name: '海康', surface_forms: ['海康'] },
            { entity_name: '广拓', surface_forms: ['广拓'] }
          ],
          target_entity_name: '广拓',
          competitor_matches: [{ configured_name: '海康', entity_name: '海康' }],
          candidate_lists: [],
          recommendations: [],
          claims: [],
          sentiment: { label: 'neutral', reason: '客观列举', risk_terms: [] }
        })
      })
    }
  });

  const result = await service.analyze({
    responseText,
    brand: { name: '广拓' },
    competitors: [{ id: 8, name: '海康' }]
  });

  assert.equal(result.share_of_voice, 33.33);
  assert.equal(result.visibility_score, 1);
  assert.deepEqual(result.competitor_mentions[0], {
    id: 8,
    name: '海康',
    mentioned: true,
    mentions: 2,
    recommended: false,
    position: null,
    rank: null,
    surface_forms: ['海康', '海康']
  });
});

test('requires the analysis model to map the target explicitly instead of guessing by name similarity', async () => {
  const service = new AIResponseAnalysisService({
    configService: {
      getAnalysisPlatform: async () => ({ code: 'analysis-ai', default_model: 'analysis-model' })
    },
    requestService: {
      queryConfig: async () => ({
        success: true,
        text: JSON.stringify({
          entities: [{ name: '广拓智能', type: 'company' }],
          mentions: [{ entity_name: '广拓智能', surface_forms: ['广拓智能'] }],
          target_entity_name: '不存在的实体',
          competitor_matches: [],
          candidate_lists: [],
          recommendations: [],
          claims: [],
          sentiment: { label: 'neutral', reason: '', risk_terms: [] }
        })
      })
    }
  });

  await assert.rejects(
    service.analyze({
      responseText: '广拓智能提供另一类解决方案。',
      brand: { name: '广拓', aliases: ['GATO'] },
      competitors: []
    }),
    /target_entity_name 必须引用 entities.name/
  );
});

test('rejects entity rows that do not have a validated mention in the answer', async () => {
  const service = new AIResponseAnalysisService({
    configService: {
      getAnalysisPlatform: async () => ({ code: 'analysis-ai', default_model: 'analysis-model' })
    },
    requestService: {
      queryConfig: async () => ({
        success: true,
        text: JSON.stringify({
          entities: [
            { name: '广拓', type: 'brand' },
            { name: '海康威视', type: 'company' }
          ],
          mentions: [{ entity_name: '广拓', surface_forms: ['广拓'] }],
          target_entity_name: '广拓',
          competitor_matches: [],
          candidate_lists: [],
          recommendations: [],
          claims: [],
          sentiment: { label: 'neutral', reason: '', risk_terms: [] }
        })
      })
    }
  });

  await assert.rejects(
    service.analyze({
      responseText: '这里只提到了广拓。',
      brand: { name: '广拓' },
      competitors: []
    }),
    /entities\[1\] 没有对应提及/
  );
});
