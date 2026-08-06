const { AIPlatformConfig } = require('../models');
const { Op } = require('sequelize');
const { encryptSecret, decryptSecret } = require('./SecretEncryptionService');
const { validatePlatformUrl } = require('./PlatformUrlPolicyService');
const {
  inspectDeepSeekFlashConfigRow
} = require('./DeepSeekFlashConfigMigrationService');

const ADAPTER_TYPES = new Set(['openai_responses', 'openai_chat_completions']);
const RESERVED_PLATFORM_CODES = new Set(['deepseek-web', 'doubao-web']);
const MANAGED_WEB_ADAPTER_TYPES = new Set(['deepseek_web', 'doubao_web']);
const PLATFORM_DISPLAY_ORDER = new Map([
  ['doubao-web', 0],
  ['deepseek-web', 1],
  ['doubao', 2],
  ['deepseek', 3],
  ['qwen', 4],
  ['hunyuan', 5]
]);
const TEST_STATUSES = new Set(['untested', 'success', 'failed']);
const WEB_SEARCH_TEST_STATUSES = new Set(['untested', 'success', 'failed', 'inconclusive']);
const REQUEST_OPTIONS_MAX_BYTES = 16 * 1024;
const PROTECTED_REQUEST_OPTION_KEYS = new Set([
  'model',
  'messages',
  'input',
  'stream',
  'max_tokens',
  'max_output_tokens'
]);
const UNSAFE_JSON_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const API_CAPABILITIES = Object.freeze({
  monitoring: true,
  analysis: true,
  prompt_generation: true,
  model_listing: true,
  api_key_management: true,
  connection_test: true,
  api_web_search_test: true,
  direct_stream: true,
  legacy_schedule: true,
  interactive_login: false
});
const MANAGED_WEB_CAPABILITIES = Object.freeze({
  monitoring: true,
  analysis: false,
  prompt_generation: false,
  model_listing: false,
  api_key_management: false,
  connection_test: false,
  api_web_search_test: false,
  direct_stream: false,
  legacy_schedule: false,
  interactive_login: true
});

const PRESET_PLATFORMS = Object.freeze([
  Object.freeze({
    code: 'doubao-web',
    name: '豆包网页版',
    adapter_type: 'doubao_web',
    base_url: 'https://www.doubao.com',
    default_model: 'doubao-web-ui',
    enabled: false,
    builtin: true
  }),
  Object.freeze({
    code: 'deepseek-web',
    name: 'DeepSeek 网页版',
    adapter_type: 'deepseek_web',
    base_url: 'https://chat.deepseek.com',
    default_model: 'deepseek-web-ui',
    enabled: false,
    builtin: true
  }),
  Object.freeze({
    code: 'doubao',
    name: '豆包',
    adapter_type: 'openai_responses',
    base_url: 'https://ark.cn-beijing.volces.com/api/v3',
    default_model: 'doubao-seed-2-1-turbo-260628',
    enabled: false,
    builtin: true
  }),
  Object.freeze({
    code: 'deepseek',
    name: 'DeepSeek',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.deepseek.com/v1/chat/completions',
    // 010 硬切（2026-08-06）：分析平台唯一正式模型 deepseek-v4-flash；
    // v5 分析器 assertFlashPlatform 强制该校验，Pro 不参与分析。
    default_model: 'deepseek-v4-flash',
    enabled: false,
    builtin: true
  }),
  Object.freeze({
    code: 'qwen',
    name: '千问',
    adapter_type: 'openai_responses',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    default_model: 'qwen3.7-plus',
    request_options: Object.freeze({
      search_options: Object.freeze({ forced_search: true })
    }),
    enabled: false,
    builtin: true
  }),
  Object.freeze({
    code: 'hunyuan',
    name: '腾讯混元',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://tokenhub.tencentmaas.com/v1',
    default_model: 'hy3-preview',
    request_options: Object.freeze({
      web_search_options: Object.freeze({ enable: true })
    }),
    enabled: false,
    builtin: true
  })
]);

const MANAGED_WEB_PRESETS = new Map(
  PRESET_PLATFORMS
    .filter((preset) => MANAGED_WEB_ADAPTER_TYPES.has(preset.adapter_type))
    .map((preset) => [preset.code, preset])
);

class PlatformConfigError extends Error {
  constructor(message, code = 'invalid_platform_config', status = 400) {
    super(message);
    this.name = 'PlatformConfigError';
    this.code = code;
    this.status = status;
  }
}

function cleanRequiredText(value, fieldName, maxLength) {
  const text = String(value ?? '').trim();
  if (!text) throw new PlatformConfigError(`${fieldName}不能为空`);
  if (text.length > maxLength) throw new PlatformConfigError(`${fieldName}长度不能超过 ${maxLength}`);
  return text;
}

function normalizeNullableInteger(value, fieldName, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new PlatformConfigError(`${fieldName}必须是 ${min}–${max} 之间的整数`);
  }
  return number;
}

function normalizeRequestOptions(value) {
  if (value === null || value === undefined || value === '') return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new PlatformConfigError('请求参数必须是 JSON 对象');
  }

  for (const key of Object.keys(value)) {
    if (PROTECTED_REQUEST_OPTION_KEYS.has(key)) {
      throw new PlatformConfigError(`请求参数不能覆盖系统字段 ${key}`);
    }
  }

  const visit = (node) => {
    if (node === null) return;
    if (typeof node === 'number' && !Number.isFinite(node)) {
      throw new PlatformConfigError('请求参数只能包含有效 JSON 值');
    }
    if (typeof node !== 'object') return;
    for (const key of Object.keys(node)) {
      if (UNSAFE_JSON_KEYS.has(key)) {
        throw new PlatformConfigError(`请求参数不能包含不安全字段 ${key}`);
      }
      visit(node[key]);
    }
  };
  visit(value);

  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (_) {
    throw new PlatformConfigError('请求参数必须是有效 JSON 对象');
  }
  if (Buffer.byteLength(serialized, 'utf8') > REQUEST_OPTIONS_MAX_BYTES) {
    throw new PlatformConfigError('请求参数不能超过 16 KiB');
  }
  return JSON.parse(serialized);
}

function rowValue(row, key) {
  return row?.get ? row.get(key) : row?.[key];
}

function sortPlatformsForDisplay(rows) {
  return [...rows].sort((left, right) => {
    const leftPriority = PLATFORM_DISPLAY_ORDER.get(rowValue(left, 'code'));
    const rightPriority = PLATFORM_DISPLAY_ORDER.get(rowValue(right, 'code'));
    if (leftPriority !== undefined || rightPriority !== undefined) {
      if (leftPriority === undefined) return 1;
      if (rightPriority === undefined) return -1;
      return leftPriority - rightPriority;
    }
    const builtinDifference = Number(Boolean(rowValue(right, 'builtin')))
      - Number(Boolean(rowValue(left, 'builtin')));
    if (builtinDifference) return builtinDifference;
    return Number(rowValue(left, 'id') || 0) - Number(rowValue(right, 'id') || 0);
  });
}

function getPlatformCapabilities(row) {
  return MANAGED_WEB_ADAPTER_TYPES.has(rowValue(row, 'adapter_type'))
    ? { ...MANAGED_WEB_CAPABILITIES }
    : { ...API_CAPABILITIES };
}

function hasPlatformCapability(row, capability) {
  if (!capability) return true;
  return getPlatformCapabilities(row)[String(capability)] === true;
}

function isManagedPlatform(row) {
  return MANAGED_WEB_ADAPTER_TYPES.has(rowValue(row, 'adapter_type'))
    || RESERVED_PLATFORM_CODES.has(String(rowValue(row, 'code') || '').toLowerCase());
}

function isConfigured(row) {
  const managedPreset = MANAGED_WEB_PRESETS.get(
    String(rowValue(row, 'code') || '').toLowerCase()
  );
  if (managedPreset) {
    return rowValue(row, 'adapter_type') === managedPreset.adapter_type
      && String(rowValue(row, 'base_url') || '').trim() === managedPreset.base_url
      && String(rowValue(row, 'default_model') || '').trim() === managedPreset.default_model;
  }
  return Boolean(
    rowValue(row, 'encrypted_api_key')
    && String(rowValue(row, 'base_url') || '').trim()
    && String(rowValue(row, 'default_model') || '').trim()
  );
}

function assertConfiguredForEnable(row, enabled) {
  if (!Boolean(enabled) || isConfigured(row)) return;
  throw new PlatformConfigError(
    '请先完成平台基础配置，再启用该平台',
    'platform_not_configured',
    409
  );
}

function getUnavailableReason(row) {
  if (!row || row.archived_at) return 'archived';
  if (!row.enabled) return 'disabled';
  if (!MANAGED_WEB_ADAPTER_TYPES.has(rowValue(row, 'adapter_type')) && !row.encrypted_api_key) {
    return 'missing_api_key';
  }
  if (!String(row.base_url || '').trim()) return 'missing_base_url';
  if (!String(row.default_model || '').trim()) return 'missing_model';
  if (isManagedPlatform(row) && !isConfigured(row)) return 'managed_config_invalid';
  return null;
}

function toAdminView(row) {
  const value = row?.get ? row.get({ plain: true }) : { ...row };
  const {
    encrypted_api_key: _encryptedApiKey,
    ...safe
  } = value;
  return {
    ...safe,
    configured: isConfigured(value),
    capabilities: getPlatformCapabilities(value)
  };
}

function toCatalogView(row) {
  const value = row?.get ? row.get({ plain: true }) : { ...row };
  const unavailableReason = getUnavailableReason(value);
  return {
    code: value.code,
    name: value.name,
    enabled: Boolean(value.enabled),
    configured: isConfigured(value),
    selectable: unavailableReason === null,
    unavailable_reason: unavailableReason,
    web_search_test_status: value.web_search_test_status || 'untested',
    capabilities: getPlatformCapabilities(value)
  };
}

class AIPlatformConfigService {
  constructor(options = {}) {
    this.model = options.model || AIPlatformConfig;
    this.encryptionKeyProvider = options.encryptionKeyProvider || (() => process.env.CONFIG_ENCRYPTION_KEY);
    this.urlValidator = options.urlValidator || validatePlatformUrl;
  }

  async ensurePresets() {
    const legacyRows = await this.model.findAll({
      where: { adapter_type: 'doubao_responses' }
    });
    for (const row of legacyRows) {
      await row.update({
        adapter_type: 'openai_responses',
        ...this.untestedState()
      });
    }

    for (const preset of PRESET_PLATFORMS) {
      const existing = await this.model.findOne({ where: { code: preset.code } });
      const managedPreset = MANAGED_WEB_PRESETS.get(preset.code);
      if (
        managedPreset
        && existing
        && (!existing.builtin || existing.adapter_type !== managedPreset.adapter_type)
      ) {
        throw new PlatformConfigError(
          `保留平台标识 ${preset.code} 已被其他配置占用`,
          'reserved_platform_code_conflict',
          409
        );
      }
      const [row] = await this.model.findOrCreate({
        where: { code: preset.code },
        defaults: preset
      });
      if (managedPreset) {
        await row.update({
          name: preset.name,
          adapter_type: preset.adapter_type,
          base_url: preset.base_url,
          default_model: preset.default_model,
          request_options: {},
          encrypted_api_key: null,
          api_key_last4: null,
          builtin: true
        });
        continue;
      }
      if (!row.builtin) {
        await row.update({ builtin: true });
      }
      const requestOptions = row.request_options || {};
      const isLegacyOfficialHunyuanPreset = preset.code === 'hunyuan'
        && row.name === preset.name
        && row.adapter_type === preset.adapter_type
        && row.base_url === preset.base_url
        && row.default_model === 'hy3'
        && Object.keys(requestOptions).length === 0;
      if (isLegacyOfficialHunyuanPreset) {
        await row.update({
          default_model: preset.default_model,
          request_options: JSON.parse(JSON.stringify(preset.request_options)),
          ...this.untestedState()
        });
      }
      // 010 硬切（2026-08-06）：删除 v4 时代"flash 是旧版预设、重置回 Pro"的
      // 迁移——deepseek-v4-flash 是唯一正式分析模型，无 Pro 参与路径。
      const matchesPresetIdentity = row.name === preset.name
        && row.adapter_type === preset.adapter_type
        && row.base_url === preset.base_url
        && row.default_model === preset.default_model;
      const isLegacyQwenDefault = preset.code === 'qwen'
        && matchesPresetIdentity
        && Object.keys(requestOptions).length === 0;
      if (isLegacyQwenDefault) {
        await row.update({
          request_options: JSON.parse(JSON.stringify(preset.request_options)),
          ...this.untestedState()
        });
      }
      const isLegacyUnconfiguredDeepSeekDefault = preset.code === 'deepseek'
        && matchesPresetIdentity
        && row.enabled
        && !row.encrypted_api_key;
      if (isLegacyUnconfiguredDeepSeekDefault) {
        await row.update({ enabled: false });
      }
      const isObsoleteDoubaoPreset = preset.code === 'doubao'
        && JSON.stringify(requestOptions) === JSON.stringify({
          tools: [{ type: 'web_search', max_keyword: 2 }]
        });
      if (isObsoleteDoubaoPreset) {
        await row.update({ request_options: {}, ...this.untestedState() });
      }
    }

    const deepSeek = await this.model.findOne({ where: { code: 'deepseek' } });
    let deepSeekState;
    try {
      deepSeekState = inspectDeepSeekFlashConfigRow(deepSeek);
    } catch (error) {
      throw new PlatformConfigError(
        'DeepSeek 正式配置不满足 Flash builtin 身份合同',
        'deepseek_flash_config_invalid',
        503
      );
    }
    if (!deepSeekState.ready) {
      throw new PlatformConfigError(
        'DeepSeek 正式配置尚未完成 Flash 发布迁移',
        'deepseek_flash_config_migration_required',
        503
      );
    }
  }

  async listAdminPlatforms({ includeArchived = false } = {}) {
    const where = includeArchived ? {} : { archived_at: null };
    const rows = await this.model.findAll({ where, order: [['builtin', 'DESC'], ['id', 'ASC']] });
    return sortPlatformsForDisplay(rows).map(toAdminView);
  }

  async listCatalog() {
    const rows = await this.model.findAll({ where: { archived_at: null }, order: [['builtin', 'DESC'], ['id', 'ASC']] });
    return sortPlatformsForDisplay(rows).map(toCatalogView);
  }

  async listPlatformRows(codes = null, { includeArchived = true } = {}) {
    const normalizedCodes = Array.isArray(codes)
      ? Array.from(new Set(codes.map((code) => String(code || '').trim().toLowerCase()).filter(Boolean)))
      : null;
    const where = {};
    if (normalizedCodes) where.code = { [Op.in]: normalizedCodes };
    if (!includeArchived) where.archived_at = null;
    return this.model.findAll({ where, order: [['id', 'ASC']] });
  }

  async getPlatform(id, { includeArchived = false } = {}) {
    const row = await this.model.findByPk(id);
    if (!row || (!includeArchived && row.archived_at)) {
      throw new PlatformConfigError('AI 平台不存在', 'platform_not_found', 404);
    }
    return row;
  }

  async getPlatformByCode(code, { includeArchived = false } = {}) {
    const row = await this.model.findOne({ where: { code: String(code || '').trim().toLowerCase() } });
    if (!row || (!includeArchived && row.archived_at)) {
      throw new PlatformConfigError('AI 平台不存在', 'platform_not_found', 404);
    }
    return row;
  }

  async createPlatform(payload = {}) {
    const code = cleanRequiredText(payload.code, '唯一标识', 50).toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code) || code.length < 2) {
      throw new PlatformConfigError('唯一标识只能包含小写字母、数字和连字符，长度为 2–50');
    }
    if (RESERVED_PLATFORM_CODES.has(code)) {
      throw new PlatformConfigError('该平台标识由系统保留', 'reserved_platform_code', 409);
    }

    const values = await this.validateEditableFields(payload, { creating: true });
    const enabled = payload.enabled === undefined ? false : Boolean(payload.enabled);
    assertConfiguredForEnable({ code, ...values }, enabled);
    let row;
    try {
      row = await this.model.create({
        code,
        ...values,
        enabled,
        builtin: false,
        test_status: 'untested'
      });
    } catch (error) {
      if (error?.name === 'SequelizeUniqueConstraintError') {
        throw new PlatformConfigError('唯一标识已存在', 'platform_code_exists', 409);
      }
      throw error;
    }
    return toAdminView(row);
  }

  async updatePlatform(id, payload = {}) {
    const row = await this.getPlatform(id);
    if (isManagedPlatform(row)) {
      const requestedKeys = Object.keys(payload).filter((key) => key !== 'enabled');
      if (requestedKeys.includes('api_key')) {
        throw new PlatformConfigError(
          '该平台不支持 API Key',
          'unsupported_platform_capability'
        );
      }
      if (requestedKeys.length > 0) {
        throw new PlatformConfigError(
          '受管 Web 平台只允许修改启用状态',
          'managed_platform_immutable'
        );
      }
    }
    const values = await this.validateEditableFields(payload, { creating: false, current: row });
    const updates = {};
    const allowed = [
      'name',
      'adapter_type',
      'base_url',
      'default_model',
      'request_timeout_seconds',
      'max_tokens',
      'request_options',
      'enabled',
      'encrypted_api_key',
      'api_key_last4'
    ];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(values, key)) updates[key] = values[key];
    }
    const currentValues = row?.get ? row.get({ plain: true }) : row;
    assertConfiguredForEnable(
      { ...currentValues, ...updates },
      Object.prototype.hasOwnProperty.call(updates, 'enabled') ? updates.enabled : row.enabled
    );

    const criticalFields = ['adapter_type', 'base_url', 'default_model', 'encrypted_api_key', 'request_options'];
    const criticalChanged = criticalFields.some((key) => (
      Object.prototype.hasOwnProperty.call(updates, key)
      && (
        key === 'request_options'
          ? JSON.stringify(updates[key] || {}) !== JSON.stringify(row[key] || {})
          : updates[key] !== row[key]
      )
    ));
    if (criticalChanged) Object.assign(updates, this.untestedState());

    await row.update(updates);
    return toAdminView(row);
  }

  async setEnabled(id, enabled) {
    const row = await this.getPlatform(id);
    assertConfiguredForEnable(row, enabled);
    await row.update({ enabled: Boolean(enabled) });
    return toAdminView(row);
  }

  async clearApiKey(id) {
    const row = await this.getPlatform(id);
    this.assertCapability(row, 'api_key_management');
    await row.update({
      encrypted_api_key: null,
      api_key_last4: null,
      enabled: false,
      ...this.untestedState()
    });
    return toAdminView(row);
  }

  async revealApiKey(id) {
    const row = await this.getPlatform(id);
    this.assertCapability(row, 'api_key_management');
    return {
      api_key: this.decryptApiKey(row),
      api_key_last4: row.api_key_last4
    };
  }

  async deletePlatform(id) {
    const row = await this.getPlatform(id);
    if (row.builtin) throw new PlatformConfigError('预置平台不能删除');
    await row.update({ archived_at: new Date(), enabled: false });
    return toAdminView(row);
  }

  decryptApiKey(row) {
    if (!row?.encrypted_api_key) throw new PlatformConfigError('平台未配置 API Key', 'missing_api_key');
    return decryptSecret(row.encrypted_api_key, this.encryptionKeyProvider());
  }

  assertCapability(row, capability) {
    if (!hasPlatformCapability(row, capability)) {
      throw new PlatformConfigError(
        '该平台不支持此操作',
        'unsupported_platform_capability'
      );
    }
    return row;
  }

  async requireCapability(id, capability) {
    const row = await this.getPlatform(id);
    return this.assertCapability(row, capability);
  }

  async validateEditableFields(payload, { creating, current } = {}) {
    const values = {};
    const has = (key) => Object.prototype.hasOwnProperty.call(payload, key);

    if (creating || has('name')) values.name = cleanRequiredText(payload.name, '平台名称', 100);
    if (creating || has('adapter_type')) {
      const adapterType = cleanRequiredText(payload.adapter_type, '接口类型', 50);
      if (!ADAPTER_TYPES.has(adapterType)) throw new PlatformConfigError('不支持的接口类型');
      values.adapter_type = adapterType;
    }
    if (creating || has('base_url')) {
      const baseUrl = cleanRequiredText(payload.base_url, 'Base URL', 2048);
      let validated;
      try {
        validated = await this.urlValidator(baseUrl);
      } catch (error) {
        throw new PlatformConfigError(
          error?.message || 'Base URL 校验失败',
          'invalid_platform_url'
        );
      }
      values.base_url = validated.url;
    }
    if (creating || has('default_model')) {
      values.default_model = cleanRequiredText(payload.default_model, '默认模型', 255);
    }
    if (has('request_timeout_seconds')) {
      values.request_timeout_seconds = normalizeNullableInteger(payload.request_timeout_seconds, '请求超时', 10, 180);
    }
    if (has('max_tokens')) {
      values.max_tokens = normalizeNullableInteger(payload.max_tokens, '最大 Token', 256, 32768);
    }
    if (has('request_options')) values.request_options = normalizeRequestOptions(payload.request_options);
    if (has('enabled')) values.enabled = Boolean(payload.enabled);

    const apiKey = String(payload.api_key ?? '');
    if (apiKey.trim()) {
      const secret = apiKey.trim();
      try {
        values.encrypted_api_key = encryptSecret(secret, this.encryptionKeyProvider());
      } catch (error) {
        throw new PlatformConfigError(error.message, 'encryption_unavailable', 503);
      }
      values.api_key_last4 = secret.slice(-4);
    } else if (creating) {
      values.encrypted_api_key = null;
      values.api_key_last4 = null;
    }

    if (!creating && current && has('code') && String(payload.code).trim().toLowerCase() !== current.code) {
      throw new PlatformConfigError('唯一标识创建后不能修改');
    }
    return values;
  }

  untestedState() {
    return {
      test_status: 'untested',
      last_tested_at: null,
      last_test_error_code: null,
      last_test_message: null,
      web_search_test_status: 'untested',
      last_web_search_tested_at: null,
      last_web_search_test_error_code: null,
      last_web_search_test_message: null
    };
  }

  async saveTestResult(id, result) {
    const row = await this.getPlatform(id);
    const status = result?.success ? 'success' : 'failed';
    if (!TEST_STATUSES.has(status)) throw new PlatformConfigError('连接测试状态无效');
    await row.update({
      test_status: status,
      last_tested_at: new Date(),
      last_test_error_code: result?.success ? null : String(result?.error_code || 'provider_error').slice(0, 50),
      last_test_message: String(result?.message || (result?.success ? '连接成功' : '连接失败')).slice(0, 255)
    });
    return toAdminView(row);
  }

  async saveWebSearchTestResult(id, result) {
    const row = await this.getPlatform(id);
    const status = String(result?.status || (result?.success ? 'success' : 'failed'));
    if (!WEB_SEARCH_TEST_STATUSES.has(status) || status === 'untested') {
      throw new PlatformConfigError('联网测试状态无效');
    }
    await row.update({
      web_search_test_status: status,
      last_web_search_tested_at: new Date(),
      last_web_search_test_error_code: status === 'success'
        ? null
        : String(result?.error_code || (status === 'inconclusive' ? 'search_evidence_missing' : 'provider_error')).slice(0, 50),
      last_web_search_test_message: String(result?.message || '联网能力测试已完成').slice(0, 255)
    });
    return toAdminView(row);
  }
}

const service = new AIPlatformConfigService();

module.exports = service;
module.exports.AIPlatformConfigService = AIPlatformConfigService;
module.exports.PlatformConfigError = PlatformConfigError;
module.exports.PRESET_PLATFORMS = PRESET_PLATFORMS;
module.exports.toAdminView = toAdminView;
module.exports.toCatalogView = toCatalogView;
module.exports.getUnavailableReason = getUnavailableReason;
module.exports.getPlatformCapabilities = getPlatformCapabilities;
module.exports.hasPlatformCapability = hasPlatformCapability;
module.exports.isManagedPlatform = isManagedPlatform;
module.exports.isConfigured = isConfigured;
module.exports.normalizeRequestOptions = normalizeRequestOptions;
module.exports.REQUEST_OPTIONS_MAX_BYTES = REQUEST_OPTIONS_MAX_BYTES;
