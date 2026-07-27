const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WebPlatformRegistry,
  MANAGED_WEB_DEFINITIONS,
  createManagedWebPlatformRegistry
} = require('../services/WebPlatformRegistry');
const path = require('node:path');

function definition(code, adapterType) {
  return {
    code,
    adapterType,
    displayName: code,
    defaultModel: `${code}-ui`,
    officialUrl: `https://${code}.example.com/`,
    allowedOrigins: [`https://${code}.example.com`],
    captureSchemaVersion: `${code}-capture-v1`,
    runtimeSchemaVersion: `${code}-runtime-v1`,
    selectorVersion: `${code}-selectors-v1`,
    envPrefix: code.replaceAll('-', '_').toUpperCase()
  };
}

test('managed Web registry validates identities and owns one isolated service per platform', async () => {
  const created = [];
  const closed = [];
  const reconciled = [];
  const registry = new WebPlatformRegistry({
    definitions: [
      definition('deepseek-web', 'deepseek_web'),
      definition('doubao-web', 'doubao_web')
    ],
    serviceFactory: (platformDefinition) => {
      const service = {
        platform: platformDefinition.code,
        getCaptureStore() {
          return {
            async reconcileTrash() {
              reconciled.push(platformDefinition.code);
              return platformDefinition.code === 'doubao-web' ? 2 : 1;
            }
          };
        },
        async shutdown() {
          closed.push(platformDefinition.code);
        }
      };
      created.push(service);
      return service;
    }
  });

  assert.deepEqual(
    registry.listDefinitions().map((item) => item.code),
    ['deepseek-web', 'doubao-web']
  );
  assert.equal(
    registry.validateManagedConfig({
      code: 'doubao-web',
      adapter_type: 'doubao_web'
    }).code,
    'doubao-web'
  );
  assert.throws(
    () => registry.validateManagedConfig({
      code: 'doubao-web',
      adapter_type: 'deepseek_web'
    }),
    (error) => error.code === 'managed_config_invalid'
  );
  assert.throws(
    () => registry.getService('unknown-web'),
    (error) => error.code === 'managed_web_platform_not_found'
  );

  const deepseek = registry.getService('deepseek-web');
  const doubao = registry.getService('doubao-web');
  assert.equal(registry.getService('doubao-web'), doubao);
  assert.notEqual(deepseek, doubao);
  assert.deepEqual(created.map((service) => service.platform), [
    'deepseek-web',
    'doubao-web'
  ]);

  assert.deepEqual(
    await registry.reconcileCaptureStores({ recordExists: async () => true }),
    {
      total: 3,
      platforms: {
        'deepseek-web': 1,
        'doubao-web': 2
      }
    }
  );
  assert.deepEqual(reconciled.sort(), ['deepseek-web', 'doubao-web']);

  await registry.shutdown();
  assert.deepEqual(closed.sort(), ['deepseek-web', 'doubao-web']);
});

test('default registry defines isolated DeepSeek and Doubao runtimes and rejects shared directories', () => {
  const cwd = path.resolve(__dirname, '..');
  const registry = createManagedWebPlatformRegistry({
    cwd,
    env: {},
    platform: 'darwin'
  });

  assert.deepEqual(
    registry.listDefinitions().map((item) => ({
      code: item.code,
      adapterType: item.adapterType,
      defaultModel: item.defaultModel
    })),
    [
      {
        code: 'deepseek-web',
        adapterType: 'deepseek_web',
        defaultModel: 'deepseek-web-ui'
      },
      {
        code: 'doubao-web',
        adapterType: 'doubao_web',
        defaultModel: 'doubao-web-ui'
      }
    ]
  );
  assert.notEqual(
    registry.getService('deepseek-web').runtimeConfig.profileDir,
    registry.getService('doubao-web').runtimeConfig.profileDir
  );

  assert.throws(
    () => createManagedWebPlatformRegistry({
      cwd,
      env: {
        DEEPSEEK_WEB_PROFILE_DIR: '.runtime/shared/profile',
        DOUBAO_WEB_PROFILE_DIR: '.runtime/shared/profile'
      },
      platform: 'darwin'
    }),
    (error) => error.code === 'web_runtime_config_invalid'
  );
});

test('Doubao login verification delegates the full page login check while DeepSeek keeps its existing probe', async () => {
  const deepseek = MANAGED_WEB_DEFINITIONS.find((item) => item.code === 'deepseek-web');
  const doubao = MANAGED_WEB_DEFINITIONS.find((item) => item.code === 'doubao-web');
  let checks = 0;

  assert.equal(deepseek.verifyInteractiveSession, undefined);
  await assert.rejects(
    doubao.verifyInteractiveSession({
      async verifyInteractiveLogin() {
        checks += 1;
        throw Object.assign(new Error('login required'), {
          code: 'web_login_required'
        });
      }
    }),
    { code: 'web_login_required' }
  );
  await doubao.verifyInteractiveSession({
    async verifyInteractiveLogin() {
      checks += 1;
      return { requested: true, observed: true };
    }
  });
  assert.equal(checks, 2);
});

test('each registered Web platform owns an independent FIFO with cross-platform overlap', async () => {
  const activity = [];
  const active = new Map();
  const maximum = new Map();
  const registry = new WebPlatformRegistry({
    definitions: [
      definition('deepseek-web', 'deepseek_web'),
      definition('doubao-web', 'doubao_web')
    ],
    serviceFactory: (platformDefinition) => {
      let tail = Promise.resolve();
      return {
        runExclusive(task) {
          const execution = tail.then(async () => {
            const code = platformDefinition.code;
            active.set(code, (active.get(code) || 0) + 1);
            maximum.set(code, Math.max(maximum.get(code) || 0, active.get(code)));
            activity.push(['start', code, Date.now()]);
            try {
              return await task();
            } finally {
              activity.push(['end', code, Date.now()]);
              active.set(code, active.get(code) - 1);
            }
          });
          tail = execution.catch(() => undefined);
          return execution;
        },
        async shutdown() {
          await tail;
        }
      };
    }
  });
  const pause = () => new Promise((resolve) => setTimeout(resolve, 12));
  const deepseek = registry.getService('deepseek-web');
  const doubao = registry.getService('doubao-web');

  await Promise.all([
    deepseek.runExclusive(pause),
    deepseek.runExclusive(pause),
    doubao.runExclusive(pause),
    doubao.runExclusive(pause)
  ]);

  assert.equal(maximum.get('deepseek-web'), 1);
  assert.equal(maximum.get('doubao-web'), 1);
  const firstDeepseek = activity.find(
    ([event, code]) => event === 'start' && code === 'deepseek-web'
  );
  const firstDoubao = activity.find(
    ([event, code]) => event === 'start' && code === 'doubao-web'
  );
  const firstDeepseekEnd = activity.find(
    ([event, code]) => event === 'end' && code === 'deepseek-web'
  );
  const firstDoubaoEnd = activity.find(
    ([event, code]) => event === 'end' && code === 'doubao-web'
  );
  assert.ok(firstDeepseek[2] < firstDoubaoEnd[2]);
  assert.ok(firstDoubao[2] < firstDeepseekEnd[2]);
  await registry.shutdown();
});
