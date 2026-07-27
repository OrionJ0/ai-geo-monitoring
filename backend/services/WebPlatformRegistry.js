const path = require('node:path');
const deepseekSelectors = require('../config/deepseekWebSelectors');
const doubaoSelectors = require('../config/doubaoWebSelectors');
const {
  WebPlatformService,
  resolvePlatformWebRuntimeConfig
} = require('./WebPlatformService');
const {
  DeepSeekWebAdapter,
  DeepSeekWebPage
} = require('./DeepSeekWebAdapter');

function registryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const MANAGED_WEB_DEFINITIONS = Object.freeze([
  Object.freeze({
    code: 'deepseek-web',
    adapterType: 'deepseek_web',
    displayName: 'DeepSeek 网页版',
    defaultModel: 'deepseek-web-ui',
    officialUrl: 'https://chat.deepseek.com/',
    allowedOrigins: deepseekSelectors.allowedOrigins,
    captureSchemaVersion: 'deepseek-web-capture-v1',
    runtimeSchemaVersion: 'deepseek-web-runtime-v1',
    selectorVersion: deepseekSelectors.selectorVersion,
    envPrefix: 'DEEPSEEK_WEB',
    loginMarkers: deepseekSelectors.loginMarkers,
    verificationMarkers: deepseekSelectors.verificationMarkers,
    composer: deepseekSelectors.composer,
    pageFactory: (session) => new DeepSeekWebPage(session),
    adapterFactory: (options) => new DeepSeekWebAdapter(options)
  }),
  Object.freeze({
    code: 'doubao-web',
    adapterType: 'doubao_web',
    displayName: '豆包网页版',
    defaultModel: 'doubao-web-ui',
    officialUrl: 'https://www.doubao.com/chat/',
    allowedOrigins: doubaoSelectors.allowedOrigins,
    captureSchemaVersion: 'doubao-web-capture-v1',
    runtimeSchemaVersion: 'doubao-web-runtime-v1',
    selectorVersion: doubaoSelectors.selectorVersion,
    envPrefix: 'DOUBAO_WEB',
    loginMarkers: doubaoSelectors.loginMarkers,
    verificationMarkers: doubaoSelectors.verificationMarkers,
    composer: doubaoSelectors.composer,
    verifyInteractiveSession: (page) => page.verifyInteractiveLogin(),
    pageFactory: (session) => {
      const { DoubaoWebPage } = require('./DoubaoWebAdapter');
      return new DoubaoWebPage(session);
    },
    adapterFactory: (options) => {
      const { DoubaoWebAdapter } = require('./DoubaoWebAdapter');
      return new DoubaoWebAdapter(options);
    }
  })
]);

function isInside(child, parent) {
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

function assertRuntimeIsolation(runtimeConfigs) {
  const entries = Array.from(runtimeConfigs.entries());
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    const [leftCode, left] = entries[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const [rightCode, right] = entries[rightIndex];
      for (const leftDirectory of [left.profileDir, left.evidenceDir]) {
        for (const rightDirectory of [right.profileDir, right.evidenceDir]) {
          if (
            isInside(leftDirectory, rightDirectory)
            || isInside(rightDirectory, leftDirectory)
          ) {
            throw registryError(
              'web_runtime_config_invalid',
              `${leftCode} 与 ${rightCode} 必须使用独立运行时目录`
            );
          }
        }
      }
    }
  }
}

class WebPlatformRegistry {
  constructor({ definitions = [], serviceFactory } = {}) {
    if (typeof serviceFactory !== 'function') {
      throw new TypeError('serviceFactory 必须是函数');
    }
    this.serviceFactory = serviceFactory;
    this.definitions = new Map();
    this.services = new Map();
    this.closing = false;

    for (const definition of definitions) {
      const code = String(definition?.code || '').trim().toLowerCase();
      const adapterType = String(definition?.adapterType || '').trim();
      if (!code || !adapterType || this.definitions.has(code)) {
        throw registryError(
          'managed_config_invalid',
          '受管 Web 平台定义无效'
        );
      }
      this.definitions.set(code, Object.freeze({ ...definition, code, adapterType }));
    }
  }

  listDefinitions() {
    return Array.from(this.definitions.values());
  }

  hasDefinition(platformCode) {
    return this.definitions.has(
      String(platformCode || '').trim().toLowerCase()
    );
  }

  getDefinition(platformCode) {
    const code = String(platformCode || '').trim().toLowerCase();
    const definition = this.definitions.get(code);
    if (!definition) {
      throw registryError(
        'managed_web_platform_not_found',
        '受管 Web 平台不存在'
      );
    }
    return definition;
  }

  validateManagedConfig(config) {
    const definition = this.getDefinition(config?.code);
    if (String(config?.adapter_type || '') !== definition.adapterType) {
      throw registryError(
        'managed_config_invalid',
        `${definition.displayName} 受管平台配置无效`
      );
    }
    return definition;
  }

  getService(platformCode) {
    if (this.closing) {
      throw registryError('web_shutdown', '受管 Web 服务正在关闭');
    }
    const definition = this.getDefinition(platformCode);
    if (!this.services.has(definition.code)) {
      this.services.set(
        definition.code,
        this.serviceFactory(definition)
      );
    }
    return this.services.get(definition.code);
  }

  async reconcileCaptureStores(options) {
    const platforms = {};
    let total = 0;
    for (const definition of this.listDefinitions()) {
      try {
        const count = await this.getService(definition.code)
          .getCaptureStore()
          .reconcileTrash(options);
        platforms[definition.code] = Number(count) || 0;
        total += platforms[definition.code];
      } catch (error) {
        error.platform = definition.code;
        throw error;
      }
    }
    return { total, platforms };
  }

  async shutdown() {
    if (this.closing) return;
    this.closing = true;
    const settled = await Promise.allSettled(
      Array.from(this.services.values()).map((service) => service.shutdown())
    );
    const failed = settled.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
  }
}

function createManagedWebPlatformRegistry({
  definitions = MANAGED_WEB_DEFINITIONS,
  cwd = path.resolve(__dirname, '..'),
  env = process.env,
  platform = process.platform,
  serviceFactory
} = {}) {
  const runtimeConfigs = new Map(definitions.map((definition) => [
    definition.code,
    resolvePlatformWebRuntimeConfig(definition, { cwd, env, platform })
  ]));
  assertRuntimeIsolation(runtimeConfigs);
  return new WebPlatformRegistry({
    definitions,
    serviceFactory: serviceFactory || ((definition) => new WebPlatformService({
      definition,
      runtimeConfig: runtimeConfigs.get(definition.code)
    }))
  });
}

const registry = createManagedWebPlatformRegistry();

module.exports = registry;
module.exports.WebPlatformRegistry = WebPlatformRegistry;
module.exports.MANAGED_WEB_DEFINITIONS = MANAGED_WEB_DEFINITIONS;
module.exports.createManagedWebPlatformRegistry = createManagedWebPlatformRegistry;
module.exports.assertRuntimeIsolation = assertRuntimeIsolation;
module.exports.registryError = registryError;
