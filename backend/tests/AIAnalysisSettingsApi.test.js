const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'analysis-settings-api-test-secret';

const settingsRouter = require('../routes/settings');
const User = require('../models/User');
const AIAnalysisConfigService = require('../services/AIAnalysisConfigService');
const AIResponseAnalysisV5Service = require('../services/AIResponseAnalysisV5Service');

const originalFindByPk = User.findByPk;

test.before(() => {
  User.findByPk = async (id) => ({
    id,
    username: id === 1 ? 'admin' : 'user',
    role: id === 1 ? 'admin' : 'user',
    status: 'active',
    membership_level: 'free',
    membership_expires_at: null
  });
});

test.after(() => {
  User.findByPk = originalFindByPk;
});

function token(role) {
  return jwt.sign({ userId: role === 'admin' ? 1 : 2, username: role, role }, process.env.JWT_SECRET);
}

async function api(method, routePath, { role, body = {} } = {}) {
  const layer = settingsRouter.stack.find(
    (item) => item.route?.path === routePath && item.route.methods?.[method.toLowerCase()]
  );
  assert.ok(layer, `route ${method} ${routePath} should exist`);
  const req = {
    headers: role ? { authorization: `Bearer ${token(role)}` } : {},
    body,
    params: {},
    query: {}
  };
  const response = {
    statusCode: 200,
    payload: null,
    headers: {},
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
  const handlers = layer.route.stack.map((item) => item.handle);
  const dispatch = async (index) => {
    if (!handlers[index]) return;
    await handlers[index](req, response, () => dispatch(index + 1));
  };
  await dispatch(0);
  return { status: response.statusCode, json: response.payload, headers: response.headers };
}

test('lets an administrator select and read the dedicated analysis API', async () => {
  const originalSet = AIAnalysisConfigService.setConfig;
  const originalGet = AIAnalysisConfigService.getPublicConfig;
  let savedInput;
  AIAnalysisConfigService.setConfig = async (input) => {
    savedInput = input;
    return {
      platform_code: input.platform_code,
      model_name: input.model_name,
      request_options: input.request_options,
      configured: true,
      platform: {
        code: input.platform_code,
        name: '分析平台',
        model_name: input.model_name
      }
    };
  };
  AIAnalysisConfigService.getPublicConfig = async () => ({
    platform_code: 'analysis-ai',
    model_name: 'analysis-model-pro',
    configured: true,
    platform: { code: 'analysis-ai', name: '分析平台', model_name: 'analysis-model-pro' }
  });

  try {
    assert.equal((await api('GET', '/analysis-api', { role: 'user' })).status, 403);
    const updated = await api('PUT', '/analysis-api', {
      role: 'admin',
      body: {
        platform_code: 'analysis-ai',
        model_name: 'analysis-model-pro',
        request_options: { temperature: 0.2 }
      }
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.data.platform_code, 'analysis-ai');
    assert.equal(updated.json.data.model_name, 'analysis-model-pro');
    assert.deepEqual(savedInput.request_options, { temperature: 0.2 });
    const loaded = await api('GET', '/analysis-api', { role: 'admin' });
    assert.equal(loaded.json.data.configured, true);
  } finally {
    AIAnalysisConfigService.setConfig = originalSet;
    AIAnalysisConfigService.getPublicConfig = originalGet;
  }
});

test('returns the versioned runtime analysis prompt template to administrators', async () => {
  const originalGetAnalysisPlatform = AIAnalysisConfigService.getAnalysisPlatform;
  AIAnalysisConfigService.getAnalysisPlatform = async () => ({
    code: 'deepseek',
    adapter_type: 'openai_chat_completions',
    default_model: 'deepseek-v4-flash'
  });
  assert.equal((await api('GET', '/analysis-api/prompt', { role: 'user' })).status, 403);

  try {
    const response = await api('GET', '/analysis-api/prompt', { role: 'admin' });

    assert.equal(response.status, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(
      response.json.data.prompt_revision,
      'grounded_entity_catalog_v1+closed_entity_semantics_v4_evidence_roles_rev2'
    );
    assert.equal(response.json.data.stages.length, 2);
    assert.match(response.json.data.template, /<source_answer>/);
    assert.match(response.json.data.template, /<semantic_input>/);
    assert.match(response.json.data.template, /\{\{待分析回答原文片段\}\}/);
    assert.match(response.json.data.template, /只从 source_answer\.segments 的 text 中抽取/);
    assert.match(response.json.data.template, /<output_contract>/);
    assert.match(response.json.data.template, /other_organization/);
    assert.match(response.json.data.template, /\{\{目标品牌\}\}/);
    assert.doesNotMatch(response.json.data.template, /competitor_hints|竞品提示/);
    assert.deepEqual(response.json.data.request_options, {
      temperature: 0,
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' }
    });
    assert.equal(response.json.data.max_attempts, 4);
  } finally {
    AIAnalysisConfigService.getAnalysisPlatform = originalGetAnalysisPlatform;
  }
});

test('returns temporary analysis test input and output without a persistence contract', async () => {
  const originalAnalyze = AIResponseAnalysisV5Service.analyze;
  let analysisInput;
  AIResponseAnalysisV5Service.analyze = async (input) => {
    analysisInput = input;
    // 010 硬切：测试端点走 v5 分阶段分析器，输出为 v5 顶层结构
    return {
      brand_mentioned: true,
      brand_mentions: 1,
      brand_recommended: false,
      brand_rank: 3,
      sentiment: 'neutral',
      metric_semantics_version: 'contextual_competitor_mentions_sov_v2_scoped',
      analysis_structure: {
        schema_version: 'geo_metric_input_v5',
        target_fact: { target: '广拓', appeared: true, mention_count: 1 },
        target_mapping: { status: 'unavailable', target_entity_id: null, candidate_entity_ids: [] },
        entities: [{
          entity_id: 'E001',
          name: '广拓',
          type: 'brand',
          surface_forms: ['上海广拓', 'GATO'],
          registry_match: null
        }],
        mentions: [],
        competition_analysis: { competitors: [], status: 'observed_only', completeness: 'not_proven' },
        sentiment: { status: 'resolved', label: 'neutral', evidence_source_ids: [] }
      }
    };
  };

  try {
    const response = await api('POST', '/analysis-api/test', {
      role: 'admin',
      body: {
        question_text: '周界安防厂商有哪些？',
        brand_name: '广拓',
        brand_aliases: ['GATO'],
        response_text: '3. 上海广拓（GATO）'
      }
    });
    assert.equal(response.status, 200);
    assert.equal(analysisInput.question, '周界安防厂商有哪些？');
    assert.equal(Object.hasOwn(analysisInput, 'competitorHints'), false);
    assert.deepEqual(analysisInput.brand, { name: '广拓', aliases: ['GATO'] });
    assert.equal(analysisInput.responseText, '3. 上海广拓（GATO）');
    assert.equal(
      response.json.data.input.question_text,
      '周界安防厂商有哪些？'
    );
    assert.equal(response.json.data.input.brand_name, '广拓');
    assert.equal(response.json.data.input.response_text, '3. 上海广拓（GATO）');
    assert.equal(
      response.json.data.output.metric_semantics_version,
      'contextual_competitor_mentions_sov_v2_scoped'
    );
    assert.equal(response.json.data.output.analysis_structure.schema_version, 'geo_metric_input_v5');
    assert.equal(response.json.data.output.analysis_structure.entities[0].name, '广拓');
  } finally {
    AIResponseAnalysisV5Service.analyze = originalAnalyze;
  }
});

test('returns bounded retry metadata when the shared analysis queue is overloaded', async () => {
  const originalAnalyze = AIResponseAnalysisV5Service.analyze;
  AIResponseAnalysisV5Service.analyze = async () => {
    throw new AIResponseAnalysisV5Service.AIResponseAnalysisV5Error(
      'AI 分析排队超时，请稍后重试',
      'analysis_queue_timeout',
      { stage: 'analysis_queue' },
      { retryable: true, status: 503, retryAfterSeconds: 2 }
    );
  };
  try {
    const response = await api('POST', '/analysis-api/test', {
      role: 'admin',
      body: {
        question_text: '问题',
        brand_name: '品牌',
        response_text: '回答'
      }
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers['retry-after'], '2');
    assert.deepEqual(response.json.data, {
      error_code: 'analysis_queue_timeout',
      retryable: true,
      retry_after_seconds: 2
    });
  } finally {
    AIResponseAnalysisV5Service.analyze = originalAnalyze;
  }
});
