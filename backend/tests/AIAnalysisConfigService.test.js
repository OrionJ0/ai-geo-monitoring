const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AIAnalysisConfigService
} = require('../services/AIAnalysisConfigService');

test('stores a platform and independently selected model for the analysis API without duplicating its secret', async () => {
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
      getPlatformByCode: async (code) => ({
        code,
        name: '分析模型',
        default_model: 'analysis-model',
        enabled: true,
        encrypted_api_key: 'encrypted-only',
        base_url: 'https://api.example.com/v1'
      })
    }
  });

  const result = await service.setConfig({
    platform_code: 'ANALYSIS-AI',
    model_name: 'analysis-model-pro'
  });

  assert.equal(result.platform_code, 'analysis-ai');
  assert.equal(result.model_name, 'analysis-model-pro');
  assert.equal(result.configured, true);
  assert.deepEqual(result.platform, {
    code: 'analysis-ai',
    name: '分析模型',
    model_name: 'analysis-model-pro'
  });
  const runtimePlatform = await service.getAnalysisPlatform();
  assert.equal(runtimePlatform.default_model, 'analysis-model-pro');
  assert.equal(JSON.stringify(result).includes('encrypted-only'), false);
});

test('falls back to the platform default model for existing analysis settings without a model key', async () => {
  const settings = new Map([
    ['ai_analysis_platform_code', { key: 'ai_analysis_platform_code', value: 'analysis-ai' }]
  ]);
  const service = new AIAnalysisConfigService({
    settingModel: {
      findOne: async ({ where }) => settings.get(where.key) || null
    },
    platformConfigService: {
      getPlatformByCode: async () => ({
        code: 'analysis-ai',
        name: '分析模型',
        default_model: 'platform-default-model',
        enabled: true,
        encrypted_api_key: 'encrypted-only',
        base_url: 'https://api.example.com/v1'
      })
    }
  });

  const result = await service.getPublicConfig();

  assert.equal(result.model_name, 'platform-default-model');
  assert.equal(result.platform.model_name, 'platform-default-model');
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
    (error) => error.code === 'analysis_platform_unsupported'
  );
});
