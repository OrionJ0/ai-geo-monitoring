const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AIResponseAnalysisService
} = require('../services/AIResponseAnalysisService');

test('exposes the same versioned prompt template used by runtime analysis', () => {
  const service = new AIResponseAnalysisService();
  const definition = service.getPromptDefinition();

  assert.equal(definition.version, 'ai_structured_v3');
  assert.match(definition.template, /你是 GEO 回答结构化器/);
  assert.match(definition.template, /\{\{目标品牌\}\}/);
  assert.match(definition.template, /\{\{待分析的 AI 回答\}\}/);
  assert.match(definition.template, /全部品牌或公司实体/);
  assert.match(definition.template, /target_entity_name/);
  assert.match(definition.template, /competitor_relations/);
  assert.match(
    definition.template,
    /target_entity_name 为 null[\s\S]*competitor_relations 长度必须等于 entities 长度/
  );
  assert.match(definition.template, /\{\{当前问题\}\}/);
  assert.match(definition.template, /已配置不等于本回答竞品/);
  assert.match(definition.template, /JSON 输出骨架/);
  assert.match(definition.template, /"entities":\[\]/);
  assert.match(definition.template, /不必负责提及顺序/);
  assert.match(definition.template, /每个 entities 项都必须至少有一个 mentions 项/);
  assert.match(definition.template, /不要人为限制 surface_forms 数量/);
  assert.match(definition.template, /无法精确引用 entities\.name 时就省略该项/);
  assert.match(definition.template, /原回答扫描结果/);
  assert.match(definition.template, /不要返回 mention_count、recommended、rank、比例、分数/);
  assert.doesNotMatch(definition.template, /逐字原文/);
  assert.deepEqual(definition.request_profile, {
    temperature: 0,
    timeout_seconds: 120,
    max_attempts: 2,
    web_search: false,
    token_limit: null,
    json_mode: 'chat_completions_only',
    deepseek_thinking: 'disabled'
  });
  assert.deepEqual(definition.runtime_fields, [
    '当前问题',
    '目标品牌',
    '品牌别名',
    '目标品牌行业',
    '目标品牌关键词',
    '竞品提示',
    '待分析的 AI 回答'
  ]);
});

test('requests deterministic JSON output for Chat Completions analysis', async () => {
  let requestOptions;
  const service = new AIResponseAnalysisService({
    configService: {
      getAnalysisPlatform: async () => ({
        code: 'deepseek',
        adapter_type: 'openai_chat_completions',
        default_model: 'deepseek-v4-pro'
      })
    },
    requestService: {
      queryConfig: async (_platform, _prompt, options) => {
        requestOptions = options;
        return {
          success: true,
          data: { choices: [{ finish_reason: 'stop' }] },
          text: JSON.stringify({
            entities: [],
            mentions: [],
            target_entity_name: null,
            competitor_relations: [],
            candidate_lists: [],
            recommendations: [],
            claims: [],
            sentiment: { label: 'neutral', reason: '未提及目标品牌', risk_terms: [] }
          })
        };
      }
    }
  });

  const result = await service.analyze({
    question: '测试问题',
    responseText: '回答没有提到任何品牌。',
    brand: { name: '广拓' },
    competitorHints: []
  });

  assert.deepEqual(requestOptions.requestOptions, {
    temperature: 0,
    response_format: { type: 'json_object' },
    thinking: { type: 'disabled' }
  });
  assert.equal(requestOptions.maxTokens, undefined);
  assert.equal(requestOptions.omitTokenLimit, true);
  assert.equal(requestOptions.timeoutSeconds, 120);
  assert.equal(result.sov_numerator, 0);
  assert.equal(result.sov_denominator, 0);
  assert.equal(result.answer_competitor_share, null);
});

test('disables Responses reasoning for deterministic low-latency analysis', async () => {
  let requestOptions;
  const service = new AIResponseAnalysisService({
    configService: {
      getAnalysisPlatform: async () => ({
        code: 'qwen',
        adapter_type: 'openai_responses',
        default_model: 'qwen3.7-plus'
      })
    },
    requestService: {
      queryConfig: async (_platform, _prompt, options) => {
        requestOptions = options;
        return {
          success: true,
          data: { status: 'completed' },
          text: JSON.stringify({
            entities: [],
            mentions: [],
            target_entity_name: null,
            competitor_relations: [],
            candidate_lists: [],
            recommendations: [],
            claims: [],
            sentiment: { label: 'neutral', reason: '未提及目标品牌', risk_terms: [] }
          })
        };
      }
    }
  });

  await service.analyze({
    question: '测试问题',
    responseText: '回答没有提到任何品牌。',
    brand: { name: '广拓' },
    competitorHints: []
  });

  assert.deepEqual(requestOptions.requestOptions, {
    temperature: 0,
    reasoning: { effort: 'none' }
  });
  assert.equal(requestOptions.disableWebSearch, true);
});

test('retries one malformed structured response before dropping the sample', async () => {
  let attempts = 0;
  const prompts = [];
  const service = new AIResponseAnalysisService({
    configService: {
      getAnalysisPlatform: async () => ({
        code: 'deepseek',
        adapter_type: 'openai_chat_completions',
        default_model: 'deepseek-v4-pro'
      })
    },
    requestService: {
      queryConfig: async (_platform, prompt) => {
        attempts += 1;
        prompts.push(prompt);
        if (attempts === 1) {
          return {
            success: true,
            data: { choices: [{ finish_reason: 'stop' }] },
            text: '{"entities":'
          };
        }
        return {
          success: true,
          data: { choices: [{ finish_reason: 'stop' }] },
          text: JSON.stringify({
            entities: [],
            mentions: [],
            target_entity_name: null,
            competitor_relations: [],
            candidate_lists: [],
            recommendations: [],
            claims: [],
            sentiment: { label: 'neutral', reason: '未提及目标品牌', risk_terms: [] }
          })
        };
      }
    }
  });

  const result = await service.analyze({
    question: '测试问题',
    responseText: '回答没有提到任何品牌。',
    brand: { name: '广拓' },
    competitorHints: []
  });

  assert.equal(attempts, 2);
  assert.equal(result.brand_mentioned, false);
  assert.match(prompts[1], /具体错误：AI 分析 API 未返回有效 JSON/);
  assert.match(prompts[1], /上一次无效输出：\s*\{"entities":/);
  assert.match(prompts[1], /只修正结构问题，不改变对原回答的语义判断/);
});

test('reports bounded diagnostics after the final malformed response', async () => {
  const malformed = '{"entities":';
  const service = new AIResponseAnalysisService({
    configService: {
      getAnalysisPlatform: async () => ({
        code: 'deepseek',
        adapter_type: 'openai_chat_completions',
        default_model: 'deepseek-v4-pro'
      })
    },
    requestService: {
      queryConfig: async () => ({
        success: true,
        data: {
          choices: [{ finish_reason: 'stop' }],
          usage: { prompt_tokens: 120, completion_tokens: 18, total_tokens: 138 }
        },
        text: malformed
      })
    }
  });

  await assert.rejects(
    service.analyze({
      question: '测试问题',
      responseText: '回答没有提到任何品牌。',
      brand: { name: '广拓' },
      competitorHints: []
    }),
    (error) => {
      assert.equal(error.code, 'invalid_analysis_output');
      assert.deepEqual(error.details, {
        stage: 'parse_or_validate',
        attempt_count: 2,
        platform: 'deepseek',
        model: 'deepseek-v4-pro',
        finish_reason: 'stop',
        output_length: malformed.length,
        usage: { prompt_tokens: 120, completion_tokens: 18, total_tokens: 138 }
      });
      assert.equal(error.details.raw_output, undefined);
      return true;
    }
  );
});

test('normalizes Responses token usage into the shared diagnostics contract', () => {
  const service = new AIResponseAnalysisService();
  const diagnostics = service.buildDiagnostics(
    {
      data: {
        usage: { input_tokens: 120, output_tokens: 18, total_tokens: 138 }
      },
      text: '{}'
    },
    { code: 'qwen', default_model: 'qwen-model' },
    1,
    'parse_or_validate'
  );

  assert.deepEqual(diagnostics.usage, {
    prompt_tokens: 120,
    completion_tokens: 18,
    total_tokens: 138
  });
});

test('rejects a truncated provider response even when its JSON is syntactically valid', async () => {
  let attempts = 0;
  const service = new AIResponseAnalysisService({
    configService: {
      getAnalysisPlatform: async () => ({
        code: 'deepseek',
        adapter_type: 'openai_chat_completions',
        default_model: 'deepseek-v4-pro'
      })
    },
    requestService: {
      queryConfig: async () => {
        attempts += 1;
        return {
          success: true,
          data: { choices: [{ finish_reason: 'length' }] },
          text: JSON.stringify({
            entities: [],
            mentions: [],
            target_entity_name: null,
            competitor_relations: [],
            candidate_lists: [],
            recommendations: [],
            claims: [],
            sentiment: { label: 'neutral', reason: '', risk_terms: [] }
          })
        };
      }
    }
  });

  await assert.rejects(
    service.analyze({
      question: '测试问题',
      responseText: '回答没有提到任何品牌。',
      brand: { name: '广拓' },
      competitorHints: []
    }),
    (error) => {
      assert.equal(error.code, 'analysis_output_truncated');
      assert.equal(attempts, 2);
      return true;
    }
  );
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
          competitor_relations: [
            {
              entity_name: '海康威视',
              relation: 'competitor',
              reason: '提供同类综合安防方案'
            },
            {
              entity_name: '大华股份',
              relation: 'competitor',
              reason: '提供同类项目安防方案'
            }
          ],
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
    question: '有哪些可选厂商？',
    responseText,
    brand: { name: '上海广拓', aliases: ['广拓', 'GATO'] },
    competitorHints: []
  });

  assert.equal(result.brand_mentioned, true);
  assert.equal(result.brand_mentions, 1);
  assert.equal(result.brand_recommended, true);
  assert.equal(result.brand_rank, 3);
  assert.equal(result.answer_competitor_share, 33.33);
  assert.equal(result.analysis_method, 'ai_structured_v3');
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
  assert.deepEqual(
    result.analysis_structure.competitor_relations.map((item) => item.entity_name),
    ['海康威视', '大华股份']
  );
  assert.equal(result.analysis_structure.claims[0].predicate, '领域经验');
  assert.equal(result.analysis_evidence, undefined);
});

test('accepts nested surface forms that refer to the same mention occurrence', async () => {
  const responseText = '上海广拓信息技术有限公司值得关注。';
  const service = new AIResponseAnalysisService({
    configService: {
      getAnalysisPlatform: async () => ({ code: 'analysis-ai', default_model: 'analysis-model' })
    },
    requestService: {
      queryConfig: async () => ({
        success: true,
        text: JSON.stringify({
          entities: [{ name: '上海广拓信息技术有限公司', type: 'company' }],
          mentions: [{
            entity_name: '上海广拓信息技术有限公司',
            surface_forms: ['上海广拓信息技术有限公司', '上海广拓']
          }],
          target_entity_name: '上海广拓信息技术有限公司',
          competitor_relations: [],
          candidate_lists: [],
          recommendations: [],
          claims: [],
          sentiment: { label: 'positive', reason: '值得关注', risk_terms: [] }
        })
      })
    }
  });

  const result = await service.analyze({
    question: '哪些厂商值得关注？',
    responseText,
    brand: { name: '上海广拓信息技术有限公司', aliases: ['上海广拓'] },
    competitorHints: []
  });

  assert.equal(result.brand_mentioned, true);
  assert.equal(result.brand_mentions, 1);
  assert.equal(result.sov_denominator, 1);
  assert.equal(result.answer_competitor_share, 100);
});

test('rejects duplicate entities in an ordered candidate list instead of producing a false rank', () => {
  const service = new AIResponseAnalysisService();
  const output = JSON.stringify({
    entities: [
      { name: '竞品甲', type: 'brand' },
      { name: '目标品牌', type: 'brand' }
    ],
    mentions: [
      { entity_name: '竞品甲', surface_forms: ['竞品甲'] },
      { entity_name: '目标品牌', surface_forms: ['目标品牌'] }
    ],
    target_entity_name: '目标品牌',
    competitor_relations: [{
      entity_name: '竞品甲',
      relation: 'competitor',
      reason: '提供同类产品'
    }],
    candidate_lists: [{
      ordered: true,
      entries: ['竞品甲', '竞品甲', '目标品牌']
    }],
    recommendations: [],
    claims: [],
    sentiment: { label: 'neutral', reason: '客观列举', risk_terms: [] }
  });

  assert.throws(
    () => service.parseOutput(output, {
      responseText: '1. 竞品甲；2. 目标品牌。',
      brand: { name: '目标品牌' }
    }),
    /entries 不能包含重复实体/
  );
});

test('rejects a one-item ordered candidate list because rank requires a comparison set', () => {
  const service = new AIResponseAnalysisService();
  const output = JSON.stringify({
    entities: [{ name: '目标品牌', type: 'brand' }],
    mentions: [{
      entity_name: '目标品牌',
      surface_forms: ['目标品牌']
    }],
    target_entity_name: '目标品牌',
    competitor_relations: [],
    candidate_lists: [{
      ordered: true,
      entries: ['目标品牌']
    }],
    recommendations: [],
    claims: [],
    sentiment: { label: 'neutral', reason: '客观描述', risk_terms: [] }
  });

  assert.throws(
    () => service.parseOutput(output, {
      responseText: '目标品牌提供该方案。',
      brand: { name: '目标品牌' }
    }),
    /有序榜单至少需要 2 个不同实体/
  );
});

test('accepts all validated surface forms instead of rejecting an entity after eight aliases', () => {
  const service = new AIResponseAnalysisService();
  const surfaceForms = [
    '上海广拓信息技术有限公司',
    '上海广拓',
    '广拓信息',
    '广拓科技',
    '广拓公司',
    '广拓安防',
    '广拓周界',
    'GATO',
    'GATO广拓'
  ];
  const structured = service.parseOutput(JSON.stringify({
    entities: [{ name: '上海广拓信息技术有限公司', type: 'company' }],
    mentions: [{
      entity_name: '上海广拓信息技术有限公司',
      surface_forms: surfaceForms
    }],
    target_entity_name: '上海广拓信息技术有限公司',
    competitor_relations: [],
    candidate_lists: [],
    recommendations: [],
    claims: [],
    sentiment: { label: 'positive', reason: '目标品牌被正面提及', risk_terms: [] }
  }), {
    responseText: surfaceForms.join('、'),
    brand: { name: '上海广拓' }
  });

  const acceptedSurfaceForms = new Set(
    structured.mentions.flatMap((mention) => mention.surface_forms)
  );
  surfaceForms.forEach((surfaceForm) => assert.equal(acceptedSurfaceForms.has(surfaceForm), true));
});

test('derives mention order and repeated counts from the original answer instead of model row order', async () => {
  const responseText = '海康先被列出，随后是广拓，结尾再次提到海康。';
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
          competitor_relations: [{
            entity_name: '海康',
            relation: 'competitor',
            reason: '在当前回答中是同类选择'
          }],
          candidate_lists: [],
          recommendations: [],
          claims: [],
          sentiment: { label: 'neutral', reason: '客观列举', risk_terms: [] }
        })
      })
    }
  });

  const result = await service.analyze({
    question: '有哪些可选品牌？',
    responseText,
    brand: { name: '广拓' },
    competitorHints: [{ id: 8, name: '海康' }]
  });

  assert.equal(result.brand_mentions, 1);
  assert.equal(result.competition_entities[0].mentions, 2);
  assert.deepEqual(
    result.analysis_structure.mentions.map((item) => item.entity_name),
    ['海康', '广拓', '海康']
  );
});

test('treats omitted non-metric claims as an empty optional collection', async () => {
  const service = new AIResponseAnalysisService({
    configService: {
      getAnalysisPlatform: async () => ({ code: 'analysis-ai', default_model: 'analysis-model' })
    },
    requestService: {
      queryConfig: async () => ({
        success: true,
        text: JSON.stringify({
          entities: [],
          mentions: [],
          target_entity_name: null,
          competitor_relations: [],
          candidate_lists: [],
          recommendations: [],
          sentiment: { label: 'neutral', reason: '未提及目标品牌', risk_terms: [] }
        })
      })
    }
  });

  const result = await service.analyze({
    question: '测试问题',
    responseText: '回答没有提到任何品牌。',
    brand: { name: '广拓' },
    competitorHints: []
  });

  assert.deepEqual(result.analysis_structure.claims, []);
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
          competitor_relations: [],
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
      question: '测试问题',
      responseText: '回答只在背景信息中提到广拓，没有给出推荐或厂商排名。',
      brand: { name: '广拓' },
      competitorHints: []
    }),
    /无法在原回答中定位/
  );
});

test('computes SOV from structured mention counts for contextual competitors', async () => {
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
          competitor_relations: [{
            entity_name: '海康',
            relation: 'competitor',
            reason: '在当前回答中是同类选择'
          }],
          candidate_lists: [],
          recommendations: [],
          claims: [],
          sentiment: { label: 'neutral', reason: '客观列举', risk_terms: [] }
        })
      })
    }
  });

  const result = await service.analyze({
    question: '有哪些可选品牌？',
    responseText,
    brand: { name: '广拓' },
    competitorHints: [{ id: 8, name: '海康' }]
  });

  assert.equal(result.answer_competitor_share, 33.33);
  assert.equal(result.visibility_score, 1);
  assert.deepEqual(result.competition_entities[0], {
    name: '海康',
    relation: 'competitor',
    reason: '在当前回答中是同类选择',
    mentions: 2,
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
          competitor_relations: [],
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
      question: '有哪些可选品牌？',
      responseText: '广拓智能提供另一类解决方案。',
      brand: { name: '广拓', aliases: ['GATO'] },
      competitorHints: []
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
          competitor_relations: [{
            entity_name: '海康威视',
            relation: 'competitor',
            reason: '同类安防品牌'
          }],
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
      question: '有哪些可选品牌？',
      responseText: '这里只提到了广拓。',
      brand: { name: '广拓' },
      competitorHints: []
    }),
    /entities\[1\] 没有对应提及/
  );
});

test('computes answer-level SOV from contextual competitors instead of configured hints', async () => {
  const responseText = '海康提供周界方案，国家电网是采购方，广拓也提供方案，海康再次出现。';
  let submittedPrompt = '';
  const service = new AIResponseAnalysisService({
    configService: {
      getAnalysisPlatform: async () => ({
        code: 'analysis-ai',
        default_model: 'analysis-model'
      })
    },
    requestService: {
      queryConfig: async (_platform, prompt) => {
        submittedPrompt = prompt;
        return {
          success: true,
          text: JSON.stringify({
            entities: [
              { name: '海康', type: 'brand' },
              { name: '国家电网', type: 'company' },
              { name: '广拓', type: 'brand' }
            ],
            mentions: [
              { entity_name: '海康', surface_forms: ['海康'] },
              { entity_name: '国家电网', surface_forms: ['国家电网'] },
              { entity_name: '广拓', surface_forms: ['广拓'] }
            ],
            target_entity_name: '广拓',
            competitor_relations: [
              {
                entity_name: '海康',
                relation: 'competitor',
                reason: '在当前问题中提供同类周界方案'
              },
              {
                entity_name: '国家电网',
                relation: 'non_competitor',
                reason: '回答中是采购方而不是替代方案'
              }
            ],
            candidate_lists: [],
            recommendations: [],
            claims: [],
            sentiment: {
              label: 'neutral',
              reason: '客观列举',
              risk_terms: []
            }
          })
        };
      }
    }
  });

  const result = await service.analyze({
    question: '周界安防方案有哪些可选厂商？',
    responseText,
    brand: {
      name: '广拓',
      industry: '周界安防',
      primary_keywords: ['电子围栏']
    },
    competitorHints: [{ name: '国家电网' }]
  });

  assert.match(submittedPrompt, /当前问题：周界安防方案有哪些可选厂商/);
  assert.match(submittedPrompt, /国家电网/);
  assert.equal(result.analysis_method, 'ai_structured_v3');
  assert.equal(
    result.metric_semantics_version,
    'contextual_competitor_mentions_sov_v1'
  );
  assert.equal(result.brand_mentions, 1);
  assert.equal(result.sov_numerator, 1);
  assert.equal(result.sov_denominator, 3);
  assert.equal(result.answer_competitor_share, 33.33);
  assert.equal(result.share_of_voice, undefined);
  assert.deepEqual(result.competition_entities, [
    {
      name: '海康',
      relation: 'competitor',
      reason: '在当前问题中提供同类周界方案',
      mentions: 2,
      surface_forms: ['海康', '海康']
    },
    {
      name: '国家电网',
      relation: 'non_competitor',
      reason: '回答中是采购方而不是替代方案',
      mentions: 1,
      surface_forms: ['国家电网']
    }
  ]);
});

test('rejects missing question context before calling the analysis platform', async () => {
  let platformCalled = false;
  const service = new AIResponseAnalysisService({
    configService: {
      getAnalysisPlatform: async () => {
        platformCalled = true;
        return { code: 'analysis-ai', default_model: 'analysis-model' };
      }
    }
  });

  await assert.rejects(
    service.analyze({
      question: '   ',
      responseText: '广拓提供周界方案。',
      brand: { name: '广拓' },
      competitorHints: []
    }),
    (error) => error.code === 'analysis_context_missing'
  );
  assert.equal(platformCalled, false);
});

test('maps a complete-input context overflow to a stable analysis failure without retrying', async () => {
  let attempts = 0;
  const service = new AIResponseAnalysisService({
    configService: {
      getAnalysisPlatform: async () => ({
        code: 'analysis-ai',
        default_model: 'analysis-model'
      })
    },
    requestService: {
      queryConfig: async () => {
        attempts += 1;
        return {
          success: false,
          error_code: 'input_too_long',
          error: '提交内容超出模型可处理范围。'
        };
      }
    }
  });

  await assert.rejects(
    service.analyze({
      question: '有哪些可选厂商？',
      responseText: '这是必须完整提交的原回答。',
      brand: { name: '广拓' },
      competitorHints: []
    }),
    (error) => (
      error.code === 'analysis_input_too_long'
      && error.details.stage === 'request'
    )
  );
  assert.equal(attempts, 1);
});

test('uses dedicated error codes for incomplete relations and invalid reasons', () => {
  const service = new AIResponseAnalysisService();
  const base = {
    entities: [
      { name: '广拓', type: 'brand' },
      { name: '海康', type: 'brand' }
    ],
    mentions: [
      { entity_name: '广拓', surface_forms: ['广拓'] },
      { entity_name: '海康', surface_forms: ['海康'] }
    ],
    target_entity_name: '广拓',
    candidate_lists: [],
    recommendations: [],
    claims: [],
    sentiment: { label: 'neutral', reason: '', risk_terms: [] }
  };
  const context = {
    responseText: '广拓和海康都提供周界方案。',
    brand: { name: '广拓' }
  };

  assert.throws(
    () => service.parseOutput(JSON.stringify({
      ...base,
      competitor_relations: []
    }), context),
    (error) => error.code === 'analysis_relation_incomplete'
  );
  assert.throws(
    () => service.parseOutput(JSON.stringify({
      ...base,
      competitor_relations: [{
        entity_name: '海康',
        relation: 'competitor',
        reason: ''
      }]
    }), context),
    (error) => error.code === 'analysis_relation_reason_invalid'
  );
});

test('returns zero SOV when only a contextual competitor is mentioned', async () => {
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
          entities: [{ name: '海康', type: 'brand' }],
          mentions: [{ entity_name: '海康', surface_forms: ['海康'] }],
          target_entity_name: null,
          competitor_relations: [{
            entity_name: '海康',
            relation: 'competitor',
            reason: '在当前回答中提供所需方案'
          }],
          candidate_lists: [],
          recommendations: [],
          claims: [],
          sentiment: { label: 'neutral', reason: '未提及目标品牌', risk_terms: [] }
        })
      })
    }
  });

  const result = await service.analyze({
    question: '有哪些可选厂商？',
    responseText: '海康提供相关方案。',
    brand: { name: '广拓' },
    competitorHints: []
  });

  assert.equal(result.sov_numerator, 0);
  assert.equal(result.sov_denominator, 1);
  assert.equal(result.answer_competitor_share, 0);
});

test('rejects a missing competitor relation reason', async () => {
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
            { name: '广拓', type: 'brand' },
            { name: '海康', type: 'brand' }
          ],
          mentions: [
            { entity_name: '广拓', surface_forms: ['广拓'] },
            { entity_name: '海康', surface_forms: ['海康'] }
          ],
          target_entity_name: '广拓',
          competitor_relations: [{
            entity_name: '海康',
            relation: 'competitor',
            reason: ''
          }],
          candidate_lists: [],
          recommendations: [],
          claims: [],
          sentiment: { label: 'neutral', reason: '客观列举', risk_terms: [] }
        })
      })
    }
  });

  await assert.rejects(
    service.analyze({
      question: '有哪些可选厂商？',
      responseText: '广拓和海康都提供方案。',
      brand: { name: '广拓' },
      competitorHints: []
    }),
    /reason 不能为空/
  );
});

test('keeps the complete answer in the v3 analysis prompt', () => {
  const service = new AIResponseAnalysisService();
  const tailMarker = '回答尾部竞品标识';
  const responseText = `${'前'.repeat(12050)}${tailMarker}`;
  const prompt = service.buildPrompt({
    question: '有哪些可选厂商？',
    responseText,
    brand: { name: '广拓' },
    competitorHints: []
  });

  assert.match(prompt, new RegExp(tailMarker));
  assert.equal(prompt.endsWith(responseText), true);
});
