const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'analysis-settings-api-test-secret';

const settingsRouter = require('../routes/settings');
const User = require('../models/User');
const AIAnalysisConfigService = require('../services/AIAnalysisConfigService');
const AIResponseAnalysisService = require('../services/AIResponseAnalysisService');

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
    default_model: 'deepseek-v4-pro'
  });
  assert.equal((await api('GET', '/analysis-api/prompt', { role: 'user' })).status, 403);

  try {
    const response = await api('GET', '/analysis-api/prompt', { role: 'admin' });

    assert.equal(response.status, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.json.data.version, 'ai_structured_v4');
    assert.equal(response.json.data.prompt_revision, 'semantic_evidence_few_shot_v7');
    assert.match(response.json.data.template, /\{\{目标品牌\}\}/);
    assert.match(response.json.data.template, /\{\{当前问题\}\}/);
    assert.match(response.json.data.template, /完整抽取/);
    assert.match(response.json.data.template, /competitor_relations/);
    assert.match(response.json.data.template, /other_organization/);
    assert.match(response.json.data.template, /evidence/);
    assert.doesNotMatch(response.json.data.template, /competitor_hints|竞品提示/);
    assert.equal(response.json.data.request_profile.token_limit, null);
    assert.equal(response.json.data.request_profile.timeout_seconds, 120);
    assert.equal(response.json.data.request_profile.max_attempts, 2);
    assert.equal(response.json.data.request_profile.web_search, false);
    assert.equal(response.json.data.request_profile.deepseek_thinking, 'disabled');
    assert.deepEqual(response.json.data.request_parameters, {
      adapter_type: 'openai_chat_completions',
      request_body: {
        model: 'deepseek-v4-pro',
        messages: [{
          role: 'user',
          content: '<运行时注入完整结构化提示词>'
        }],
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' }
      },
      runtime_policy: {
        timeout_seconds: 120,
        max_attempts: 2,
        web_search: false,
        token_limit: null
      }
    });
    assert.doesNotMatch(response.json.data.template, /逐字原文/);
  } finally {
    AIAnalysisConfigService.getAnalysisPlatform = originalGetAnalysisPlatform;
  }
});

test('returns temporary analysis test input and output without a persistence contract', async () => {
  const originalAnalyze = AIResponseAnalysisService.analyze;
  let analysisInput;
  AIResponseAnalysisService.analyze = async (input) => {
    analysisInput = input;
    return {
    brand_mentioned: true,
    brand_mentions: 1,
    brand_recommended: false,
    brand_rank: 3,
    analysis_structure: {
      schema_version: 'geo_metric_input_v4',
      entities: [{ name: '广拓', type: 'brand' }]
    },
    raw_output: '{"entities":[{"name":"广拓","type":"brand"}]}'
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
    assert.equal(
      response.json.data.input.question_text,
      '周界安防厂商有哪些？'
    );
    assert.equal(response.json.data.input.brand_name, '广拓');
    assert.equal(response.json.data.input.response_text, '3. 上海广拓（GATO）');
    assert.equal(
      response.json.data.output.raw_output,
      '{"entities":[{"name":"广拓","type":"brand"}]}'
    );
  } finally {
    AIResponseAnalysisService.analyze = originalAnalyze;
  }
});
