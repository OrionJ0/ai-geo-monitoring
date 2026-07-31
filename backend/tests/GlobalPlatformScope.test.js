const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AIPlatformConfigService,
  PlatformConfigError
} = require('../services/AIPlatformConfigService');
const { AIPlatformService } = require('../services/AIPlatformService');
const ProjectRunService = require('../services/ProjectRunService');

test('an API platform cannot be enabled before its base configuration is complete', async () => {
  let updated = false;
  const row = {
    id: 7,
    code: 'deepseek',
    name: 'DeepSeek',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.deepseek.com/v1/chat/completions',
    default_model: 'deepseek-v4-pro',
    encrypted_api_key: null,
    enabled: false,
    update: async () => {
      updated = true;
    }
  };
  const service = new AIPlatformConfigService({
    model: {
      findByPk: async () => row
    }
  });

  await assert.rejects(
    service.setEnabled(row.id, true),
    (error) => (
      error instanceof PlatformConfigError
      && error.code === 'platform_not_configured'
      && error.status === 409
    )
  );
  assert.equal(updated, false);
});

test('an incomplete API platform cannot be created in the enabled state', async () => {
  let created = false;
  const service = new AIPlatformConfigService({
    model: {
      create: async () => {
        created = true;
      }
    },
    urlValidator: async (url) => ({ url })
  });

  await assert.rejects(
    service.createPlatform({
      code: 'custom-api',
      name: '自定义 API',
      adapter_type: 'openai_chat_completions',
      base_url: 'https://api.example.com/v1/chat/completions',
      default_model: 'example-model',
      enabled: true
    }),
    (error) => (
      error instanceof PlatformConfigError
      && error.code === 'platform_not_configured'
      && error.status === 409
    )
  );
  assert.equal(created, false);
});

test('clearing an API key also disables the platform', async () => {
  let updates = null;
  const row = {
    id: 9,
    code: 'custom-api',
    adapter_type: 'openai_chat_completions',
    encrypted_api_key: 'encrypted',
    enabled: true,
    update: async (payload) => {
      updates = payload;
      Object.assign(row, payload);
    }
  };
  const service = new AIPlatformConfigService({
    model: {
      findByPk: async () => row
    }
  });

  await service.clearApiKey(row.id);

  assert.equal(updates.enabled, false);
  assert.equal(row.encrypted_api_key, null);
});

test('enabled monitoring scope includes enabled rows even when one must be reported unavailable', async () => {
  const service = new AIPlatformService({
    configService: {
      listCatalog: async () => [
        {
          code: 'deepseek',
          enabled: true,
          selectable: true,
          capabilities: { monitoring: true }
        },
        {
          code: 'qwen',
          enabled: true,
          selectable: false,
          capabilities: { monitoring: true }
        },
        {
          code: 'analysis-only',
          enabled: true,
          selectable: true,
          capabilities: { monitoring: false }
        },
        {
          code: 'doubao',
          enabled: false,
          selectable: true,
          capabilities: { monitoring: true }
        }
      ]
    },
    webPlatformRegistry: { listDefinitions: () => [] }
  });

  assert.deepEqual(
    await service.getEnabledPlatforms({ capability: 'monitoring' }),
    ['deepseek', 'qwen']
  );
});

test('run targets use every global enabled platform and ignore legacy project and prompt scopes', () => {
  const prompts = [
    {
      id: 1,
      question: '问题一',
      enabled: true,
      platforms: ['legacy-prompt-platform']
    },
    {
      id: 2,
      question: '问题二',
      enabled: false,
      platforms: ['deepseek']
    }
  ];

  assert.deepEqual(
    ProjectRunService.buildPromptTargets(
      prompts,
      ['deepseek', 'qwen'],
      ['legacy-project-platform']
    ),
    [
      { prompt: prompts[0], platform: 'deepseek' },
      { prompt: prompts[0], platform: 'qwen' }
    ]
  );
});
