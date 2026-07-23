const { AIPlatformConfig } = require('../models');
const { encryptSecret, decryptSecret } = require('./SecretEncryptionService');
const { validatePlatformUrl } = require('./PlatformUrlPolicyService');

const ADAPTER_TYPES = new Set(['doubao_responses', 'openai_chat_completions']);
const TEST_STATUSES = new Set(['untested', 'success', 'failed']);

const PRESET_PLATFORMS = Object.freeze([
  Object.freeze({
    code: 'doubao',
    name: '豆包',
    adapter_type: 'doubao_responses',
    base_url: 'https://ark.cn-beijing.volces.com/api/v3/responses',
    default_model: 'doubao-seed-1-6-250615',
    enabled: true,
    builtin: true
  }),
  Object.freeze({
    code: 'deepseek',
    name: 'DeepSeek',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.deepseek.com/v1/chat/completions',
    default_model: 'deepseek-v4-flash',
    enabled: true,
    builtin: true
  })
]);

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

function isConfigured(row) {
  return Boolean(
    row?.encrypted_api_key
    && String(row?.base_url || '').trim()
    && String(row?.default_model || '').trim()
  );
}

function getUnavailableReason(row) {
  if (!row || row.archived_at) return 'archived';
  if (!row.enabled) return 'disabled';
  if (!row.encrypted_api_key) return 'missing_api_key';
  if (!String(row.base_url || '').trim()) return 'missing_base_url';
  if (!String(row.default_model || '').trim()) return 'missing_model';
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
    configured: isConfigured(value)
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
    unavailable_reason: unavailableReason
  };
}

class AIPlatformConfigService {
  constructor(options = {}) {
    this.model = options.model || AIPlatformConfig;
    this.encryptionKeyProvider = options.encryptionKeyProvider || (() => process.env.CONFIG_ENCRYPTION_KEY);
    this.urlValidator = options.urlValidator || validatePlatformUrl;
  }

  async ensurePresets() {
    for (const preset of PRESET_PLATFORMS) {
      await this.model.findOrCreate({
        where: { code: preset.code },
        defaults: preset
      });
    }
  }

  async listAdminPlatforms({ includeArchived = false } = {}) {
    const where = includeArchived ? {} : { archived_at: null };
    const rows = await this.model.findAll({ where, order: [['builtin', 'DESC'], ['id', 'ASC']] });
    return rows.map(toAdminView);
  }

  async listCatalog() {
    const rows = await this.model.findAll({ where: { archived_at: null }, order: [['builtin', 'DESC'], ['id', 'ASC']] });
    return rows.map(toCatalogView);
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

    const values = await this.validateEditableFields(payload, { creating: true });
    let row;
    try {
      row = await this.model.create({
        code,
        ...values,
        enabled: payload.enabled === undefined ? true : Boolean(payload.enabled),
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
    const values = await this.validateEditableFields(payload, { creating: false, current: row });
    const updates = {};
    const allowed = [
      'name',
      'adapter_type',
      'base_url',
      'default_model',
      'request_timeout_seconds',
      'max_tokens',
      'enabled',
      'encrypted_api_key',
      'api_key_last4'
    ];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(values, key)) updates[key] = values[key];
    }

    const criticalFields = ['adapter_type', 'base_url', 'default_model', 'encrypted_api_key'];
    const criticalChanged = criticalFields.some((key) => (
      Object.prototype.hasOwnProperty.call(updates, key) && updates[key] !== row[key]
    ));
    if (criticalChanged) Object.assign(updates, this.untestedState());

    await row.update(updates);
    return toAdminView(row);
  }

  async setEnabled(id, enabled) {
    const row = await this.getPlatform(id);
    await row.update({ enabled: Boolean(enabled) });
    return toAdminView(row);
  }

  async clearApiKey(id) {
    const row = await this.getPlatform(id);
    await row.update({
      encrypted_api_key: null,
      api_key_last4: null,
      ...this.untestedState()
    });
    return toAdminView(row);
  }

  async archivePlatform(id) {
    const row = await this.getPlatform(id);
    if (row.builtin) throw new PlatformConfigError('预置平台不能归档');
    await row.update({ archived_at: new Date(), enabled: false });
    return toAdminView(row);
  }

  decryptApiKey(row) {
    if (!row?.encrypted_api_key) throw new PlatformConfigError('平台未配置 API Key', 'missing_api_key');
    return decryptSecret(row.encrypted_api_key, this.encryptionKeyProvider());
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
      const validated = await this.urlValidator(baseUrl);
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
      last_test_message: null
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
}

const service = new AIPlatformConfigService();

module.exports = service;
module.exports.AIPlatformConfigService = AIPlatformConfigService;
module.exports.PlatformConfigError = PlatformConfigError;
module.exports.PRESET_PLATFORMS = PRESET_PLATFORMS;
module.exports.toAdminView = toAdminView;
module.exports.toCatalogView = toCatalogView;
module.exports.getUnavailableReason = getUnavailableReason;
