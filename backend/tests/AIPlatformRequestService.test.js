const test = require('node:test');
const assert = require('node:assert/strict');

const { AIPlatformRequestService } = require('../services/AIPlatformRequestService');
const {
  buildEntityPrompt,
  buildEntityRepairPrompt
} = require('../services/AIResponseEntityExtractionService');
const {
  buildSemanticPrompt,
  buildSemanticRepairPrompt
} = require('../services/AIResponseSemanticJudgmentService');

const runtimeSettings = {
  ai_retry_count: 0,
  ai_default_timeout_seconds: 90,
  ai_default_max_tokens: 4096,
  ai_run_concurrency: 2
};

function createService({ row, post, get, savedResults = [], auditLogger = () => {} }) {
  const configService = {
    getPlatformByCode: async () => row,
    getPlatform: async () => row,
    decryptApiKey: () => 'sk-configured',
    saveTestResult: async (id, result) => {
      savedResults.push({ id, result });
      return { id, enabled: row.enabled, test_status: result.success ? 'success' : 'failed' };
    },
    saveWebSearchTestResult: async (id, result) => {
      savedResults.push({ id, webSearch: true, result });
      return { id, enabled: row.enabled, web_search_test_status: result.status };
    }
  };
  return new AIPlatformRequestService({
    configService,
    settingsService: { getSettings: async () => runtimeSettings },
    httpClient: { post, get },
    urlValidator: async (url) => ({
      url,
      hostname: 'api.example.com',
      addresses: ['93.184.216.34'],
      allowPrivate: false
    }),
    now: (() => {
      let value = 1000;
      return () => (value += 25);
    })(),
    wait: async () => {},
    auditLogger
  });
}

test('emits a secret-free model audit for every outbound analysis request', async () => {
  const audits = [];
  const row = {
    id: 4,
    code: 'deepseek',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/v1',
    encrypted_api_key: 'encrypted-secret-canary',
    default_model: 'deepseek-v4-flash',
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    auditLogger: (event) => audits.push(event),
    post: async () => ({
      data: { choices: [{ message: { content: '{}' } }] },
      headers: {}
    })
  });

  const result = await service.queryConfig(row, 'secret prompt canary', {
    purpose: 'analysis_entity_extract',
    correlationId: 'record-42',
    retryCount: 0
  });

  assert.equal(result.success, true);
  assert.equal(audits.length, 1);
  assert.deepEqual({
    ...audits[0],
    policy_fingerprint: '<sha256>',
    prompt_fingerprint: '<sha256>'
  }, {
    event: 'ai_platform_request',
    platform: 'deepseek',
    model: 'deepseek-v4-flash',
    purpose: 'analysis_entity_extract',
    attempt: 1,
    correlation_id: 'record-42',
    policy_revision: null,
    policy_fingerprint: '<sha256>',
    policy_valid: false,
    prompt_fingerprint: '<sha256>',
    prompt_template_fingerprint: null,
    prompt_variant: null
  });
  assert.match(audits[0].policy_fingerprint, /^[a-f0-9]{64}$/u);
  assert.match(audits[0].prompt_fingerprint, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(JSON.stringify(audits), /secret prompt|encrypted-secret/u);
});

test('audits every outbound request and keeps missing correlation explicit', async () => {
  const audits = [];
  const row = {
    id: 4,
    code: 'deepseek',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/v1',
    encrypted_api_key: 'encrypted-secret-canary',
    default_model: 'deepseek-v4-flash',
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    auditLogger: (event) => audits.push(event),
    post: async () => ({
      data: { choices: [{ message: { content: '{}' } }] },
      headers: {}
    })
  });

  await service.queryConfig(row, 'generic', {
    purpose: 'prompt_generation',
    correlationId: 'record-42',
    retryCount: 0
  });
  await service.queryConfig(row, 'missing correlation', {
    purpose: 'analysis_entity_extract',
    retryCount: 0
  });

  assert.equal(audits.length, 2);
  assert.deepEqual(audits.map((event) => ({
    purpose: event.purpose,
    correlation_id: event.correlation_id,
    policy_revision: event.policy_revision,
    policy_valid: event.policy_valid,
    prompt_present: event.prompt_fingerprint !== null,
    prompt_template_fingerprint: event.prompt_template_fingerprint,
    fingerprint_valid: /^[a-f0-9]{64}$/u.test(event.policy_fingerprint)
  })), [
    {
      purpose: 'prompt_generation',
      correlation_id: 'record-42',
      policy_revision: null,
      policy_valid: null,
      prompt_present: false,
      prompt_template_fingerprint: null,
      fingerprint_valid: true
    },
    {
      purpose: 'analysis_entity_extract',
      correlation_id: null,
      policy_revision: null,
      policy_valid: false,
      prompt_present: true,
      prompt_template_fingerprint: null,
      fingerprint_valid: true
    }
  ]);
});

test('derives the v5 policy revision and fingerprint from the actual outbound bodies', async () => {
  const audits = [];
  const row = {
    code: 'deepseek',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/v1',
    encrypted_api_key: 'encrypted',
    default_model: 'deepseek-v4-flash',
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    auditLogger: (event) => audits.push(event),
    post: async () => ({
      data: { choices: [{ message: { content: '{}' } }] },
      headers: {}
    })
  });
  const fixedOptions = {
    temperature: 0,
    response_format: { type: 'json_object' },
    thinking: { type: 'disabled' }
  };

  const sourceMap = {
    version: 'answer_source_lines_v1',
    segments: [{ source_id: 'L001', text: '广拓' }]
  };
  const catalog = {
    target_entity_id: 'E001',
    entities: [{
      entity_id: 'E001',
      name: '广拓',
      type: 'brand',
      surface_forms: ['广拓'],
      mentions: [{ source_id: 'L001' }]
    }]
  };
  await service.queryConfig(row, buildEntityPrompt(sourceMap), {
    purpose: 'analysis_entity_extract',
    correlationId: 'record-42',
    retryCount: 0,
    requestOptions: fixedOptions,
    disableWebSearch: true,
    omitTokenLimit: true
  });
  await service.queryConfig(row, buildSemanticPrompt({
    question: '哪个品牌更适合？',
    sourceMap,
    catalog,
    revision: 'rev2'
  }), {
    purpose: 'analysis_semantic_judge',
    correlationId: 'record-42',
    retryCount: 0,
    requestOptions: fixedOptions,
    disableWebSearch: true,
    omitTokenLimit: true
  });

  assert.deepEqual(audits.map((event) => event.policy_revision), [
    'grounded_entity_catalog_v1+fixed_json_no_web_v1',
    'closed_entity_semantics_v4_evidence_roles_rev2+fixed_json_no_web_v1'
  ]);
  assert.deepEqual(audits.map((event) => event.policy_valid), [true, true]);
  assert.deepEqual(audits.map((event) => event.prompt_variant), ['base', 'base']);
  assert.match(audits[0].policy_fingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(audits[0].policy_fingerprint, audits[1].policy_fingerprint);
  assert.deepEqual(audits.map((event) => event.prompt_template_fingerprint), [
    '43508380a32708aab5f3815e114dbfbd19af21ec52018f58f055e2bc76ff93af',
    'bbab0ccf31aecaa250bd24209581ef99fb9ef2c83e26c4ba90623aef741efddb'
  ]);
  assert.notEqual(audits[0].prompt_fingerprint, audits[1].prompt_fingerprint);
});

test('pins entity and semantic repair prompt variants instead of hiding their rules', async () => {
  const requestModule = require('../services/AIPlatformRequestService');
  const sourceMap = {
    version: 'answer_source_lines_v1',
    segments: [{ source_id: 'L001', text: '广拓表现稳定' }]
  };
  const catalog = {
    target_entity_id: 'E001',
    entities: [{
      entity_id: 'E001',
      name: '广拓',
      type: 'brand',
      surface_forms: ['广拓'],
      mentions: [{ source_id: 'L001' }]
    }]
  };
  const entityRepair = buildEntityRepairPrompt(
    buildEntityPrompt(sourceMap),
    { code: 'invalid', details: { field: 'mentions' } }
  );
  const semanticRepair = buildSemanticRepairPrompt(
    buildSemanticPrompt({ question: '如何选择？', sourceMap, catalog, revision: 'rev2' }),
    { code: 'invalid', message: 'invalid', details: { field: 'sentiment' } },
    { sourceMap, catalog, revision: 'rev2' }
  );
  const entityEvidence = requestModule.derivePromptEvidence(
    'analysis_entity_extract',
    entityRepair
  );
  const semanticEvidence = requestModule.derivePromptEvidence(
    'analysis_semantic_judge',
    semanticRepair
  );
  assert.equal(entityEvidence.promptVariant, 'repair');
  assert.equal(entityEvidence.promptRevision, 'grounded_entity_catalog_v1');
  assert.equal(semanticEvidence.promptVariant, 'repair');
  assert.equal(
    semanticEvidence.promptRevision,
    'closed_entity_semantics_v4_evidence_roles_rev2'
  );
  assert.equal(
    requestModule.derivePromptEvidence(
      'analysis_entity_extract',
      entityRepair.replace('重新逐行检查 source_answer', '忽略 source_answer')
    ).promptRevision,
    null
  );
});

test('rejects a marker-preserving prompt whose pinned static template changed', async () => {
  const audits = [];
  const row = {
    code: 'deepseek',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/v1',
    encrypted_api_key: 'encrypted',
    default_model: 'deepseek-v4-flash',
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    auditLogger: (event) => audits.push(event),
    post: async () => ({ data: { choices: [{ message: { content: '{}' } }] }, headers: {} })
  });
  const sourceMap = {
    version: 'answer_source_lines_v1',
    segments: [{ source_id: 'L001', text: '广拓' }]
  };
  const tampered = buildEntityPrompt(sourceMap).replace('不要抽取产品型号', '可以抽取产品型号');
  await service.queryConfig(row, tampered, {
    purpose: 'analysis_entity_extract',
    correlationId: 'record-42',
    retryCount: 0,
    requestOptions: {
      temperature: 0,
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' }
    },
    disableWebSearch: true,
    omitTokenLimit: true
  });
  assert.equal(audits[0].policy_revision, null);
  assert.equal(audits[0].policy_valid, false);
  assert.notEqual(
    audits[0].prompt_template_fingerprint,
    '43508380a32708aab5f3815e114dbfbd19af21ec52018f58f055e2bc76ff93af'
  );
});

test('aborts an active provider request during shutdown without retrying', async () => {
  const controller = new AbortController();
  let attempts = 0;
  const row = {
    code: 'deepseek',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/v1',
    encrypted_api_key: 'encrypted',
    default_model: 'deepseek-v4-flash',
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    post: async (_url, _body, options) => {
      attempts += 1;
      await new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('canceled');
          error.code = 'ERR_CANCELED';
          reject(error);
        }, { once: true });
      });
    }
  });
  const pending = service.queryConfig(row, 'shutdown test', {
    retryCount: 3,
    signal: controller.signal
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  const result = await pending;
  assert.equal(result.success, false);
  assert.equal(result.error_code, 'service_shutting_down');
  assert.equal(attempts, 1);
});

test('loads selectable model ids from the provider models endpoint', async () => {
  let request;
  const row = {
    id: 3,
    code: 'deepseek',
    name: 'DeepSeek',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/v1/chat/completions',
    encrypted_api_key: 'encrypted',
    default_model: 'deepseek-v4-flash',
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    post: async () => {
      throw new Error('not used');
    },
    get: async (url, options) => {
      request = { url, options };
      return {
        data: {
          object: 'list',
          data: [
            { id: 'deepseek-v4-pro', object: 'model' },
            { id: 'deepseek-v4-flash', object: 'model' },
            { id: 'deepseek-v4-pro', object: 'model' },
            { id: '', object: 'model' }
          ]
        }
      };
    }
  });

  const result = await service.listModels(row.id);

  assert.equal(result.success, true);
  assert.equal(request.url, 'https://api.example.com/v1/models');
  assert.equal(request.options.headers.Authorization, 'Bearer sk-configured');
  assert.deepEqual(result.models, ['deepseek-v4-flash', 'deepseek-v4-pro']);
  assert.equal(result.current_model, 'deepseek-v4-flash');
  assert.equal(result.source, 'provider_api');
  assert.equal(result.persisted, false);
});

test('does not report a successful refresh when the provider returns no model ids', async () => {
  const row = {
    id: 3,
    code: 'example-ai',
    name: 'Example AI',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/v1',
    encrypted_api_key: 'encrypted',
    default_model: 'saved-model',
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    post: async () => {
      throw new Error('not used');
    },
    get: async () => ({ data: { object: 'list', data: [] } })
  });

  const result = await service.listModels(row.id);

  assert.equal(result.success, false);
  assert.equal(result.error_code, 'invalid_provider_response');
});

test('normalizes a provider context-window rejection without exposing its message', async () => {
  const row = {
    id: 3,
    code: 'example-ai',
    name: 'Example AI',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/v1',
    encrypted_api_key: 'encrypted',
    default_model: 'example-model',
    enabled: true,
    archived_at: null
  };
  let attempts = 0;
  const service = createService({
    row,
    post: async () => {
      attempts += 1;
      throw Object.assign(new Error('provider details must stay private'), {
        response: {
          status: 400,
          data: {
            error: {
              code: 'context_length_exceeded',
              message: 'Maximum context length is 128k tokens'
            }
          }
        }
      });
    }
  });

  const result = await service.queryPlatform('example-ai', '超长问题');

  assert.equal(result.success, false);
  assert.equal(result.error_code, 'input_too_long');
  assert.equal(result.error, '提交内容超出模型可处理范围。');
  assert.equal(attempts, 1);
  assert.doesNotMatch(JSON.stringify(result), /128k|provider details/);
});

test('calls an OpenAI compatible platform from the saved database configuration', async () => {
  let request;
  const row = {
    id: 3,
    code: 'example-ai',
    name: 'Example AI',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/v1/chat/completions',
    encrypted_api_key: 'encrypted',
    default_model: 'example-model',
    request_timeout_seconds: 30,
    max_tokens: 2048,
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    post: async (url, body, options) => {
      request = { url, body, options };
      return { data: { choices: [{ message: { content: 'OK' } }] }, headers: {} };
    }
  });

  const result = await service.queryPlatform('example-ai', '测试问题');

  assert.equal(result.success, true);
  assert.equal(result.text, 'OK');
  assert.equal(result.model_name, 'example-model');
  assert.equal(request.url, row.base_url);
  assert.deepEqual(request.body.messages, [{ role: 'user', content: '测试问题' }]);
  assert.equal(request.body.max_tokens, 2048);
  assert.equal(request.options.timeout, 30000);
  assert.equal(request.options.headers.Authorization, 'Bearer sk-configured');
  assert.equal(request.options.maxRedirects, 0);
});

test('calls the Hunyuan preset through TokenHub Chat Completions with web search enabled', async () => {
  let request;
  const row = {
    id: 5,
    code: 'hunyuan',
    name: '腾讯混元',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://tokenhub.tencentmaas.com/v1',
    encrypted_api_key: 'encrypted',
    default_model: 'hy3-preview',
    request_options: {
      web_search_options: { enable: true }
    },
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    post: async (url, body) => {
      request = { url, body };
      return {
        data: {
          choices: [{
            message: {
              content: '你好',
              search_results: [{
                index: 1,
                name: '腾讯云文档',
                url: 'https://cloud.tencent.com/document/product/1823/132358'
              }]
            }
          }]
        },
        headers: {}
      };
    }
  });

  const result = await service.queryPlatform('hunyuan', '你好');

  assert.equal(result.success, true);
  assert.equal(request.url, 'https://tokenhub.tencentmaas.com/v1/chat/completions');
  assert.equal(request.body.model, 'hy3-preview');
  assert.deepEqual(request.body.messages, [{ role: 'user', content: '你好' }]);
  assert.deepEqual(request.body.web_search_options, { enable: true });
  assert.equal(request.body.stream, undefined);
  assert.equal(result.citation_observation_status, 'observed');
});

test('appends the Chat Completions path to an OpenAI-compatible Base URL and merges request parameters', async () => {
  let request;
  const row = {
    id: 4,
    code: 'qwen',
    name: '千问',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/compatible-mode/v1',
    encrypted_api_key: 'encrypted',
    default_model: 'qwen3.7-plus',
    request_options: {
      enable_search: true,
      search_options: { forced_search: true },
      temperature: 0.1
    },
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    post: async (url, body) => {
      request = { url, body };
      return {
        data: {
          choices: [{ message: { content: '联网回答' } }],
          usage: { plugins: { search: { count: 1 } } }
        },
        headers: {}
      };
    }
  });

  const result = await service.queryPlatform('qwen', '查询今天的新闻');

  assert.equal(result.success, true);
  assert.equal(request.url, 'https://api.example.com/compatible-mode/v1/chat/completions');
  assert.equal(request.body.enable_search, true);
  assert.deepEqual(request.body.search_options, { forced_search: true });
  assert.equal(request.body.temperature, 0.1);
  assert.equal(request.body.model, 'qwen3.7-plus');
});

test('allows internal analysis calls to omit monitoring-only request parameters', async () => {
  let requestBody;
  const row = {
    id: 4,
    code: 'qwen',
    name: '千问',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/compatible-mode/v1',
    encrypted_api_key: 'encrypted',
    default_model: 'qwen3.7-plus',
    request_options: {
      enable_search: true,
      search_options: { forced_search: true }
    },
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    post: async (_url, body) => {
      requestBody = body;
      return { data: { choices: [{ message: { content: '{}' } }] }, headers: {} };
    }
  });

  const result = await service.queryConfig(row, '结构化回答', { requestOptions: {} });

  assert.equal(result.success, true);
  assert.equal(requestBody.model, 'qwen3.7-plus');
  assert.equal('enable_search' in requestBody, false);
  assert.equal('search_options' in requestBody, false);
});

test('allows an analysis call to override token and timeout limits without mutating platform settings', async () => {
  let request;
  const row = {
    id: 4,
    code: 'deepseek',
    name: 'DeepSeek',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/v1',
    encrypted_api_key: 'encrypted',
    default_model: 'deepseek-v4-pro',
    request_timeout_seconds: 15,
    max_tokens: 1024,
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    post: async (_url, body, options) => {
      request = { body, options };
      return { data: { choices: [{ message: { content: '{}' } }] }, headers: {} };
    }
  });

  const result = await service.queryConfig(row, '结构化回答', {
    requestOptions: {},
    maxTokens: 8192,
    timeoutSeconds: 120
  });

  assert.equal(result.success, true);
  assert.equal(request.body.max_tokens, 8192);
  assert.equal(request.options.timeout, 120000);
  assert.equal(row.max_tokens, 1024);
  assert.equal(row.request_timeout_seconds, 15);
});

test('allows analysis to omit token limits even when platform and runtime defaults define them', async () => {
  let requestBody;
  const row = {
    id: 4,
    code: 'deepseek',
    name: 'DeepSeek',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/v1',
    encrypted_api_key: 'encrypted',
    default_model: 'deepseek-v4-pro',
    max_tokens: 1024,
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    post: async (_url, body) => {
      requestBody = body;
      return { data: { choices: [{ message: { content: '{}' } }] }, headers: {} };
    }
  });

  const result = await service.queryConfig(row, '结构化回答', {
    requestOptions: {},
    omitTokenLimit: true
  });

  assert.equal(result.success, true);
  assert.equal('max_tokens' in requestBody, false);
  assert.equal('max_output_tokens' in requestBody, false);
});

test('preserves model fields when overriding request options on a Sequelize-like config row', async () => {
  let requestBody;
  const values = {
    adapter_type: 'openai_chat_completions',
    default_model: 'deepseek-v4-flash'
  };
  const row = {
    id: 4,
    code: 'deepseek',
    name: 'DeepSeek',
    base_url: 'https://api.example.com/v1/chat/completions',
    encrypted_api_key: 'encrypted',
    enabled: true,
    archived_at: null,
    get adapter_type() { return values.adapter_type; },
    get default_model() { return values.default_model; }
  };
  const service = createService({
    row,
    post: async (_url, body) => {
      requestBody = body;
      return { data: { choices: [{ message: { content: '{}' } }] }, headers: {} };
    }
  });

  const result = await service.queryConfig(row, '结构化回答', { requestOptions: {} });

  assert.equal(result.success, true);
  assert.equal(requestBody.model, 'deepseek-v4-flash');
});

test('uses the OpenAI Responses contract for Doubao without a provider-specific adapter', async () => {
  let requestBody;
  const row = {
    id: 1,
    code: 'doubao',
    name: '豆包',
    adapter_type: 'openai_responses',
    base_url: 'https://ark.example.com/api/v3/responses',
    encrypted_api_key: 'encrypted',
    default_model: 'doubao-model',
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    post: async (_url, body) => {
      requestBody = body;
      return { data: { output_text: '豆包结果' }, headers: {} };
    }
  });

  const result = await service.queryPlatform('doubao', '测试问题');

  assert.equal(result.success, true);
  assert.equal(result.text, '豆包结果');
  assert.deepEqual(requestBody.tools, [{ type: 'web_search' }]);
  assert.equal(requestBody.max_output_tokens, 4096);
});

test('uses the generic Responses contract for Qwen web search with source-capable output', async () => {
  let request;
  const row = {
    id: 6,
    code: 'qwen',
    name: '千问',
    adapter_type: 'openai_responses',
    base_url: 'https://api.example.com/compatible-mode/v1',
    encrypted_api_key: 'encrypted',
    default_model: 'qwen3.7-plus',
    request_options: {},
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    post: async (url, body) => {
      request = { url, body };
      return {
        data: {
          output_text: '带来源的联网回答',
          output: [{
            type: 'web_search_call',
            action: { sources: [{ url: 'https://example.com/source' }] }
          }]
        },
        headers: {}
      };
    }
  });

  const result = await service.queryPlatform('qwen', '查询今天的新闻');

  assert.equal(result.success, true);
  assert.equal(result.text, '带来源的联网回答');
  assert.equal(request.url, 'https://api.example.com/compatible-mode/v1/responses');
  assert.deepEqual(request.body.tools, [{ type: 'web_search' }]);
  assert.equal(request.body.input[0].content[0].text, '查询今天的新闻');
});

test('removes built-in web search tools from Responses requests used only for analysis', async () => {
  let requestBody;
  const row = {
    id: 6,
    code: 'qwen',
    name: '千问',
    adapter_type: 'openai_responses',
    base_url: 'https://api.example.com/compatible-mode/v1',
    encrypted_api_key: 'encrypted',
    default_model: 'qwen3.7-plus',
    request_options: { tools: [{ type: 'web_search' }] },
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    post: async (_url, body) => {
      requestBody = body;
      return { data: { output_text: '{}' }, headers: {} };
    }
  });

  const result = await service.queryConfig(row, '结构化回答', {
    requestOptions: {},
    disableWebSearch: true
  });

  assert.equal(result.success, true);
  assert.equal('tools' in requestBody, false);
});

test('removes TokenHub web search options from Chat requests used only for analysis', async () => {
  let requestBody;
  const row = {
    id: 7,
    code: 'hunyuan',
    name: '腾讯混元',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://tokenhub.tencentmaas.com/v1',
    encrypted_api_key: 'encrypted',
    default_model: 'hy3-preview',
    request_options: {
      web_search_options: { enable: true }
    },
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    post: async (_url, body) => {
      requestBody = body;
      return { data: { choices: [{ message: { content: '{}' } }] }, headers: {} };
    }
  });

  const result = await service.queryConfig(row, '结构化回答', {
    disableWebSearch: true
  });

  assert.equal(result.success, true);
  assert.equal('web_search_options' in requestBody, false);
});

test('normalizes provider failures without exposing raw provider data', async () => {
  const row = {
    id: 3,
    code: 'example-ai',
    name: 'Example AI',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/v1/chat/completions',
    encrypted_api_key: 'encrypted',
    default_model: 'example-model',
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    post: async () => {
      const error = new Error('request failed');
      error.response = { status: 401, data: { secret: 'must-not-leak' } };
      throw error;
    }
  });

  const result = await service.queryPlatform('example-ai', '测试问题');

  assert.equal(result.success, false);
  assert.equal(result.error_code, 'authentication_failed');
  assert.equal(result.error, '平台认证失败，请管理员检查 API Key。');
  assert.equal(JSON.stringify(result).includes('must-not-leak'), false);
});

test('classifies exhausted provider quota without retrying or exposing the provider message', async () => {
  let calls = 0;
  const row = {
    id: 4,
    code: 'qwen',
    name: '千问',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/compatible-mode/v1',
    encrypted_api_key: 'encrypted',
    default_model: 'qwen3.7-plus',
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    post: async () => {
      calls += 1;
      const error = new Error('request failed');
      error.response = {
        status: 429,
        data: {
          error: {
            code: 'insufficient_quota',
            message: 'account balance and private diagnostic details'
          }
        },
        headers: {}
      };
      throw error;
    }
  });

  const result = await service.queryPlatform('qwen', '测试问题', { retryCount: 3 });

  assert.equal(calls, 1);
  assert.equal(result.success, false);
  assert.equal(result.error_code, 'provider_quota_exhausted');
  assert.equal(result.error, '平台账户额度不足，请补充额度后重试。');
  assert.deepEqual(result.provider_error, {
    status: 429,
    code: 'insufficient_quota'
  });
  assert.equal(JSON.stringify(result).includes('private diagnostic details'), false);
});

test('retries a structurally complete but empty completion once instead of failing the run', async () => {
  let calls = 0;
  const row = {
    id: 4,
    code: 'deepseek',
    name: 'DeepSeek',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/v1',
    encrypted_api_key: 'encrypted',
    default_model: 'deepseek-v4-flash',
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    post: async () => {
      calls += 1;
      if (calls === 1) {
        // 生产实测：deepseek API 偶发返回 HTTP 200、choices 存在但 content
        // 为空字符串（record 109/117 同款），结构完整所以 extractResponseText
        // 仍返回 null → invalid_provider_response。首次应触发重试而非直接失败。
        return {
          data: {
            id: 'chatcmpl-empty',
            object: 'chat.completion',
            created: 1,
            model: 'deepseek-v4-flash',
            choices: [{ index: 0, message: { role: 'assistant', content: '' } }],
            usage: { prompt_tokens: 1, completion_tokens: 0 }
          },
          headers: {}
        };
      }
      return {
        data: { choices: [{ message: { content: '{"ok":true}' } }] },
        headers: {}
      };
    }
  });

  const result = await service.queryConfig(row, '测试问题', { retryCount: 2 });

  assert.equal(calls, 2);
  assert.equal(result.success, true);
  assert.match(result.text, /\{"ok":true\}/u);
});

test('still fails a persistent empty completion after exhausting retries', async () => {
  let calls = 0;
  const row = {
    id: 4,
    code: 'deepseek',
    name: 'DeepSeek',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/v1',
    encrypted_api_key: 'encrypted',
    default_model: 'deepseek-v4-flash',
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    post: async () => {
      calls += 1;
      return {
        data: {
          choices: [{ index: 0, message: { role: 'assistant', content: '' } }]
        },
        headers: {}
      };
    }
  });

  const result = await service.queryConfig(row, '测试问题', { retryCount: 2 });

  assert.equal(calls, 3);
  assert.equal(result.success, false);
  assert.equal(result.error_code, 'invalid_provider_response');
});

test('tests disabled platforms without changing their enabled state', async () => {
  const savedResults = [];
  const row = {
    id: 9,
    code: 'disabled-ai',
    name: 'Disabled AI',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/v1/chat/completions',
    encrypted_api_key: 'encrypted',
    default_model: 'example-model',
    enabled: false,
    archived_at: null
  };
  const service = createService({
    row,
    savedResults,
    post: async () => ({ data: { choices: [{ message: { content: 'OK' } }] }, headers: {} })
  });

  const result = await service.testConnection(row.id);

  assert.equal(result.connection.success, true);
  assert.equal(result.platform.enabled, false);
  assert.equal(savedResults[0].result.success, true);
});

test('web-search test succeeds only when the provider response contains search evidence', async () => {
  const savedResults = [];
  const row = {
    id: 10,
    code: 'qwen',
    name: '千问',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/v1',
    encrypted_api_key: 'encrypted',
    default_model: 'qwen3.7-plus',
    request_options: { enable_search: true, search_options: { forced_search: true } },
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    savedResults,
    post: async () => ({
      data: {
        choices: [{ message: { content: '已联网查询。' } }],
        usage: { plugins: { search: { count: 1 } } }
      },
      headers: {}
    })
  });

  const result = await service.testWebSearch(row.id, '请检查今天的日期');

  assert.equal(result.web_search.status, 'success');
  assert.equal(result.web_search.evidence_type, 'provider_search_usage');
  assert.equal(result.web_search.input, '请检查今天的日期');
  assert.equal(result.web_search.output.text, '已联网查询。');
  assert.deepEqual(result.web_search.output.provider_response.usage, {
    plugins: { search: { count: 1 } }
  });
  assert.equal(savedResults[0].result.status, 'success');
});

test('web-search test recognizes TokenHub Chat search_results as provider evidence', async () => {
  const savedResults = [];
  const row = {
    id: 13,
    code: 'hunyuan',
    name: '腾讯混元',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://tokenhub.tencentmaas.com/v1',
    encrypted_api_key: 'encrypted',
    default_model: 'hy3-preview',
    request_options: {
      web_search_options: { enable: true }
    },
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    savedResults,
    post: async () => ({
      data: {
        choices: [{
          message: {
            content: '已联网查询。[1]',
            search_results: [
              {
                index: 1,
                name: '腾讯云文档',
                url: 'https://cloud.tencent.com/document/product/1823/132358'
              },
              {
                index: 2,
                name: '无效来源',
                url: 'javascript:alert(1)'
              }
            ]
          }
        }]
      },
      headers: {}
    })
  });

  const result = await service.testWebSearch(row.id, '请搜索腾讯混元联网能力');

  assert.equal(result.web_search.status, 'success');
  assert.equal(result.web_search.evidence_type, 'provider_search_results');
  assert.equal(savedResults[0].result.status, 'success');
});

test('web-search test retries one transient TokenHub gateway timeout', async () => {
  const savedResults = [];
  let calls = 0;
  const row = {
    id: 14,
    code: 'hunyuan',
    name: '腾讯混元',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://tokenhub.tencentmaas.com/v1',
    encrypted_api_key: 'encrypted',
    default_model: 'hy3-preview',
    request_options: {
      web_search_options: { enable: true }
    },
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    savedResults,
    post: async () => {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error('upstream timeout'), {
          response: {
            status: 504,
            data: { error: { code: '504001' } }
          }
        });
      }
      return {
        data: {
          choices: [{
            message: {
              content: '已联网查询。[1]',
              search_results: [{
                index: 1,
                name: '腾讯云文档',
                url: 'https://cloud.tencent.com/document/product/1823/132358'
              }]
            }
          }]
        },
        headers: {}
      };
    }
  });

  const result = await service.testWebSearch(row.id);

  assert.equal(calls, 2);
  assert.equal(result.web_search.status, 'success');
});

test('web-search test gives Hunyuan administrators an actionable tool-subscription hint', async () => {
  const savedResults = [];
  const row = {
    id: 15,
    code: 'hunyuan',
    name: '腾讯混元',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://tokenhub.tencentmaas.com/v1',
    encrypted_api_key: 'encrypted',
    default_model: 'hy3-preview',
    request_options: {
      web_search_options: { enable: true }
    },
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    savedResults,
    post: async () => ({
      data: {
        choices: [{
          message: {
            content: '我目前无法使用联网搜索功能。'
          }
        }]
      },
      headers: {}
    })
  });

  const result = await service.testWebSearch(row.id);

  assert.equal(result.web_search.status, 'inconclusive');
  assert.match(result.web_search.message, /「工具管理」/);
  assert.match(result.web_search.message, /免费资源包|后付费/);
});

test('web-search test reports inconclusive when generation succeeds without provider search evidence', async () => {
  const savedResults = [];
  const row = {
    id: 11,
    code: 'doubao',
    name: '豆包',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/api/v3/chat/completions',
    encrypted_api_key: 'encrypted',
    default_model: 'doubao-model',
    request_options: {},
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    savedResults,
    post: async () => ({
      data: { choices: [{ message: { content: '今天是 2026 年 7 月 23 日。' } }] },
      headers: {}
    })
  });

  const result = await service.testWebSearch(row.id, '请检查今天的日期');

  assert.equal(result.web_search.status, 'inconclusive');
  assert.equal(result.web_search.success, false);
  assert.equal(savedResults[0].result.status, 'inconclusive');
});

test('web-search test does not treat accepted forced-search parameters as execution evidence', async () => {
  const savedResults = [];
  const row = {
    id: 12,
    code: 'qwen',
    name: '千问',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/v1',
    encrypted_api_key: 'encrypted',
    default_model: 'qwen3.7-plus',
    request_options: {
      enable_search: true,
      search_options: { forced_search: true }
    },
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    savedResults,
    post: async () => ({
      data: { choices: [{ message: { content: '已完成联网查询。' } }] },
      headers: {}
    })
  });

  const result = await service.testWebSearch(row.id);

  assert.equal(result.web_search.status, 'inconclusive');
  assert.equal(result.web_search.success, false);
  assert.equal(result.web_search.evidence_type, undefined);
  assert.equal(savedResults[0].result.status, 'inconclusive');
});
