const test = require('node:test');
const assert = require('node:assert/strict');

const { createSourceMap } = require('../services/AIAnalysisSourceMapService');
const { buildEntityCatalog } = require('../services/AIEntityCatalogService');
const {
  AIResponseEntityExtractionService
} = require('../services/AIResponseEntityExtractionService');

test('extracts grounded entities without exposing the question or target brand', async () => {
  const answer = '海康威视提供园区安防方案。';
  const sourceMap = createSourceMap(answer);
  let capturedPrompt;
  let capturedOptions;
  const service = new AIResponseEntityExtractionService({
    configService: {
      getAnalysisPlatform: async () => ({
        code: 'deepseek',
        adapter_type: 'openai_chat_completions',
        default_model: 'deepseek-v4-flash',
        analysis_request_options: { reasoning_effort: 'high', temperature: 0.7 }
      })
    },
    requestService: {
      queryConfig: async (_platform, prompt, options) => {
        capturedPrompt = prompt;
        capturedOptions = options;
        return {
          success: true,
          data: {
            choices: [{ finish_reason: 'stop' }],
            usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
          },
          text: JSON.stringify({
            mentions: [{
              source_id: 'L001',
              surface_form: '海康威视',
              canonical_name: '海康威视',
              entity_type: 'brand'
            }]
          })
        };
      }
    }
  });

  const result = await service.extract({ answer, sourceMap });

  assert.match(capturedPrompt, /海康威视提供园区安防方案/);
  assert.doesNotMatch(capturedPrompt, /当前问题|target_brand|目标品牌|广拓/);
  assert.deepEqual(capturedOptions.requestOptions, {
    reasoning_effort: 'high',
    temperature: 0,
    response_format: { type: 'json_object' },
    thinking: { type: 'disabled' }
  });
  assert.equal(capturedOptions.disableWebSearch, true);
  assert.equal(capturedOptions.omitTokenLimit, true);
  assert.deepEqual(result.mentions, [{
    source_id: 'L001',
    surface_form: '海康威视',
    canonical_name: '海康威视',
    entity_type: 'brand'
  }]);
  assert.equal(result.diagnostics.attempt_count, 1);
  assert.equal(result.diagnostics.model, 'deepseek-v4-flash');
});

test('retries only entity extraction after a grounding failure without echoing the hallucinated target', async () => {
  const answer = '海康威视提供园区安防方案。';
  const sourceMap = createSourceMap(answer);
  const prompts = [];
  const outputs = [
    {
      mentions: [{
        source_id: 'L001',
        surface_form: '广拓',
        canonical_name: '广拓',
        entity_type: 'brand'
      }]
    },
    {
      mentions: [{
        source_id: 'L001',
        surface_form: '海康威视',
        canonical_name: '海康威视',
        entity_type: 'brand'
      }]
    }
  ];
  const service = new AIResponseEntityExtractionService({
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

  const result = await service.extract({
    answer,
    sourceMap,
    validateMentions: (mentions) => buildEntityCatalog({
      answer,
      sourceMap,
      extractedMentions: mentions,
      targetBrand: { name: '广拓' }
    })
  });

  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /validation_feedback/);
  assert.match(prompts[1], /surface_form/);
  assert.doesNotMatch(prompts[1], /广拓/);
  assert.equal(result.diagnostics.attempt_count, 2);
  assert.equal(result.validated.target_entity_id, null);
  assert.equal(result.validated.entities[0].name, '海康威视');
});

test('quarantines mention rows that are still ungrounded after the repair attempt', async () => {
  const answer = '海康威视提供园区安防方案。';
  const sourceMap = createSourceMap(answer);
  let calls = 0;
  const service = new AIResponseEntityExtractionService({
    configService: {
      getAnalysisPlatform: async () => ({
        code: 'deepseek',
        adapter_type: 'openai_chat_completions',
        default_model: 'deepseek-v4-flash'
      })
    },
    requestService: {
      queryConfig: async () => {
        calls += 1;
        return {
          success: true,
          data: { choices: [{ finish_reason: 'stop' }] },
          text: JSON.stringify({
            mentions: [
              {
                source_id: 'L999',
                surface_form: '海康威视',
                canonical_name: '海康威视',
                entity_type: 'company'
              },
              {
                source_id: 'L001',
                surface_form: 'Dahua Technology',
                canonical_name: '大华股份',
                entity_type: 'company'
              }
            ]
          })
        };
      }
    }
  });

  const result = await service.extract({
    answer,
    sourceMap,
    validateMentions: (mentions) => buildEntityCatalog({
      answer,
      sourceMap,
      extractedMentions: mentions,
      targetBrand: { name: '广拓' }
    })
  });

  assert.equal(calls, 2);
  // 两条 mention 都声称了不存在的 source_id 或片段里不存在的表面词：
  // 程序不得重新定位到其他片段，全部进入隔离
  assert.deepEqual(result.mentions, []);
  assert.equal(result.validated.entities.length, 0);
  assert.equal(result.diagnostics.quarantined_mentions, 2);
});

test('filters descriptive category headings without removing grounded companies', async () => {
  const answer = '专业周界防范品牌：上海广拓。';
  const sourceMap = createSourceMap(answer);
  const service = new AIResponseEntityExtractionService({
    configService: {
      getAnalysisPlatform: async () => ({
        code: 'deepseek',
        adapter_type: 'openai_chat_completions',
        default_model: 'deepseek-v4-flash'
      })
    },
    requestService: {
      queryConfig: async () => ({
        success: true,
        data: { choices: [{ finish_reason: 'stop' }] },
        text: JSON.stringify({ mentions: [
          { source_id: 'L001', surface_form: '专业周界防范品牌', canonical_name: '专业周界防范品牌', entity_type: 'other_organization' },
          { source_id: 'L001', surface_form: '上海广拓', canonical_name: '上海广拓', entity_type: 'company' }
        ] })
      })
    }
  });

  const result = await service.extract({ answer, sourceMap });

  assert.deepEqual(result.mentions.map((mention) => mention.surface_form), ['上海广拓']);
  assert.equal(result.diagnostics.filtered_generic_mentions, 1);
});
