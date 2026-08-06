const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AIAnalysisConfigService
} = require('../services/AIAnalysisConfigService');

function officialDeepSeek(overrides = {}) {
  return {
    code: 'deepseek',
    name: 'DeepSeek',
    adapter_type: 'openai_chat_completions',
    default_model: 'deepseek-v4-flash',
    enabled: true,
    builtin: true,
    archived_at: null,
    encrypted_api_key: 'encrypted-only',
    base_url: 'https://api.deepseek.com/v1/chat/completions',
    request_options: {},
    ...overrides
  };
}

test('stores only the official DeepSeek Flash analysis policy without duplicating its secret', async () => {
  const settings = new Map();
  const settingModel = {
    findOne: async ({ where }) => settings.get(where.key) || null,
    findOrCreate: async ({ where, defaults }) => {
      let row = settings.get(where.key);
      if (!row) {
        row = {
          ...defaults,
          update: async (values) => Object.assign(row, values)
        };
        settings.set(where.key, row);
        return [row, true];
      }
      return [row, false];
    }
  };
  const service = new AIAnalysisConfigService({
    settingModel,
    platformConfigService: {
      getPlatformByCode: async () => officialDeepSeek()
    }
  });

  const result = await service.setConfig({
    platform_code: 'DEEPSEEK',
    model_name: 'deepseek-v4-flash',
    request_options: {
      reasoning_effort: 'high'
    }
  });

  assert.equal(result.platform_code, 'deepseek');
  assert.equal(result.model_name, 'deepseek-v4-flash');
  assert.equal(result.configured, true);
  assert.deepEqual(result.request_options, {
    reasoning_effort: 'high'
  });
  assert.deepEqual(result.platform, {
    code: 'deepseek',
    name: 'DeepSeek',
    model_name: 'deepseek-v4-flash'
  });
  const runtimePlatform = await service.getAnalysisPlatform();
  assert.equal(runtimePlatform.default_model, 'deepseek-v4-flash');
  assert.deepEqual(runtimePlatform.analysis_request_options, {
    reasoning_effort: 'high'
  });
  assert.equal(JSON.stringify(result).includes('encrypted-only'), false);
});

test('rolls back all three analysis settings when an atomic save fails', async () => {
  const committed = new Map([
    ['ai_analysis_platform_code', 'legacy-analysis'],
    ['ai_analysis_model_name', 'deepseek-v4-pro'],
    ['ai_analysis_request_options', '{"reasoning_effort":"low"}']
  ]);
  const database = {
    async transaction(work) {
      const transaction = { staged: new Map(committed), writes: 0 };
      const result = await work(transaction);
      committed.clear();
      transaction.staged.forEach((value, key) => committed.set(key, value));
      return result;
    }
  };
  const settingModel = {
    async findOne({ where }) {
      const value = committed.get(where.key);
      return value === undefined ? null : { key: where.key, value };
    },
    async findOrCreate({ where, defaults, transaction }) {
      const key = where.key;
      const value = transaction.staged.has(key) ? transaction.staged.get(key) : defaults.value;
      const row = {
        key,
        value,
        async update(values) {
          transaction.writes += 1;
          if (transaction.writes === 2) throw new Error('injected write failure');
          transaction.staged.set(key, values.value);
          row.value = values.value;
        }
      };
      return [row, !transaction.staged.has(key)];
    }
  };
  const service = new AIAnalysisConfigService({
    settingModel,
    database,
    platformConfigService: { getPlatformByCode: async () => officialDeepSeek() }
  });

  await assert.rejects(service.setConfig({
    platform_code: 'deepseek',
    model_name: 'deepseek-v4-flash',
    request_options: { reasoning_effort: 'high' }
  }), /injected write failure/u);
  assert.deepEqual(Object.fromEntries(committed), {
    ai_analysis_platform_code: 'legacy-analysis',
    ai_analysis_model_name: 'deepseek-v4-pro',
    ai_analysis_request_options: '{"reasoning_effort":"low"}'
  });
});

test('public config reports builtin identity drift as not configured', async () => {
  const values = new Map([
    ['ai_analysis_platform_code', 'deepseek'],
    ['ai_analysis_model_name', 'deepseek-v4-flash'],
    ['ai_analysis_request_options', '{}']
  ]);
  const service = new AIAnalysisConfigService({
    settingModel: {
      findOne: async ({ where }) => (
        values.has(where.key) ? { key: where.key, value: values.get(where.key) } : null
      )
    },
    platformConfigService: {
      getPlatformByCode: async () => officialDeepSeek({ request_options: { temperature: 0.2 } })
    }
  });

  const config = await service.getPublicConfig();
  assert.equal(config.configured, false);
  assert.equal(config.unavailable_reason, 'identity_invalid');
});

test('public config falls back to the official Flash platform model without a model key', async () => {
  const settings = new Map([
    ['ai_analysis_platform_code', { key: 'ai_analysis_platform_code', value: 'deepseek' }]
  ]);
  const service = new AIAnalysisConfigService({
    settingModel: {
      findOne: async ({ where }) => settings.get(where.key) || null
    },
    platformConfigService: {
      getPlatformByCode: async () => officialDeepSeek()
    }
  });

  const result = await service.getPublicConfig();

  assert.equal(result.model_name, 'deepseek-v4-flash');
  assert.equal(result.platform.model_name, 'deepseek-v4-flash');
});

test('DeepSeek runtime uses the official Flash platform model as the single model truth', async () => {
  const settings = new Map([
    ['ai_analysis_platform_code', { key: 'ai_analysis_platform_code', value: 'deepseek' }],
    ['ai_analysis_model_name', { key: 'ai_analysis_model_name', value: 'deepseek-v4-pro' }]
  ]);
  const service = new AIAnalysisConfigService({
    settingModel: { findOne: async ({ where }) => settings.get(where.key) || null },
    platformConfigService: {
      getPlatformByCode: async () => officialDeepSeek()
    }
  });

  const runtime = await service.getAnalysisPlatform();
  assert.equal(runtime.default_model, 'deepseek-v4-flash');
});

test('rejects saving a retired DeepSeek Pro model as the analysis override', async () => {
  const service = new AIAnalysisConfigService({
    settingModel: {
      findOne: async () => null,
      findOrCreate: async () => { throw new Error('settings must not be written'); }
    },
    platformConfigService: {
      getPlatformByCode: async () => officialDeepSeek()
    }
  });

  await assert.rejects(
    service.setConfig({ platform_code: 'deepseek', model_name: 'deepseek-v4-pro' }),
    (error) => error.code === 'analysis_model_policy_mismatch'
  );
});

test('rejects a monitoring-only Web platform as the analysis provider', async () => {
  const service = new AIAnalysisConfigService({
    settingModel: {
      findOne: async () => null,
      findOrCreate: async () => {
        throw new Error('settings must not be written');
      }
    },
    platformConfigService: {
      getPlatformByCode: async () => ({
        code: 'deepseek-web',
        name: 'DeepSeek 网页版',
        adapter_type: 'deepseek_web',
        default_model: 'deepseek-web-ui',
        enabled: true,
        encrypted_api_key: null,
        base_url: 'https://chat.deepseek.com'
      })
    }
  });

  await assert.rejects(
    service.setConfig({
      platform_code: 'deepseek-web',
      model_name: 'deepseek-web-ui'
    }),
    (error) => error.code === 'analysis_platform_policy_mismatch'
  );
});

test('rejects analysis request options that would re-enable Web search', async () => {
  const service = new AIAnalysisConfigService({
    settingModel: {
      findOne: async () => null,
      findOrCreate: async () => {
        throw new Error('settings must not be written');
      }
    },
    platformConfigService: {
      getPlatformByCode: async () => officialDeepSeek()
    }
  });

  await assert.rejects(
    service.setConfig({
      platform_code: 'deepseek',
      model_name: 'deepseek-v4-flash',
      request_options: {
        tools: [{ type: 'web_search' }]
      }
    }),
    (error) => (
      error.code === 'analysis_request_options_invalid'
      && /tools/.test(error.message)
    )
  );
});

test('rejects analysis request options that would override the fixed JSON policy', async () => {
  const service = new AIAnalysisConfigService({
    settingModel: {
      findOne: async () => null,
      findOrCreate: async () => {
        throw new Error('settings must not be written');
      }
    },
    platformConfigService: {
      getPlatformByCode: async () => officialDeepSeek()
    }
  });

  await assert.rejects(
    service.setConfig({
      platform_code: 'deepseek',
      model_name: 'deepseek-v4-flash',
      request_options: { temperature: 0.5 }
    }),
    (error) => error.code === 'analysis_request_options_invalid' && /temperature/.test(error.message)
  );
});
