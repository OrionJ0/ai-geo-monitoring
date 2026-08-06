const OFFICIAL_DEEPSEEK_PRESET = Object.freeze({
  code: 'deepseek',
  name: 'DeepSeek',
  adapter_type: 'openai_chat_completions',
  base_url: 'https://api.deepseek.com/v1/chat/completions',
  source_model: 'deepseek-v4-pro',
  target_model: 'deepseek-v4-flash'
});
const ANALYSIS_PLATFORM_SETTING = 'ai_analysis_platform_code';
const ANALYSIS_MODEL_SETTING = 'ai_analysis_model_name';
const ANALYSIS_REQUEST_OPTIONS_SETTING = 'ai_analysis_request_options';
const FIXED_ANALYSIS_OPTION_KEYS = new Set([
  'model',
  'messages',
  'input',
  'temperature',
  'response_format',
  'thinking',
  'max_tokens',
  'max_output_tokens',
  'tools',
  'tool_choice',
  'enable_search',
  'search_options',
  'web_search_options'
]);

class DeepSeekFlashConfigMigrationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'DeepSeekFlashConfigMigrationError';
    this.code = code;
  }
}

function value(row, key) {
  return row?.get ? row.get(key) : row?.[key];
}

function fail(message, code) {
  throw new DeepSeekFlashConfigMigrationError(message, code);
}

function hasOnlyEmptyRequestOptions(row) {
  const options = value(row, 'request_options');
  return options
    && typeof options === 'object'
    && !Array.isArray(options)
    && Object.keys(options).length === 0;
}

function inspectDeepSeekFlashConfigRow(row) {
  const identityMatches = (
    value(row, 'code') === OFFICIAL_DEEPSEEK_PRESET.code
    && value(row, 'name') === OFFICIAL_DEEPSEEK_PRESET.name
    && value(row, 'adapter_type') === OFFICIAL_DEEPSEEK_PRESET.adapter_type
    && value(row, 'base_url') === OFFICIAL_DEEPSEEK_PRESET.base_url
    && value(row, 'builtin') === true
    && value(row, 'archived_at') == null
  );
  if (!identityMatches) {
    fail(
      'DeepSeek 配置不是官方 builtin 身份，拒绝自动迁移',
      'DEEPSEEK_FLASH_CONFIG_IDENTITY_MISMATCH'
    );
  }
  if (!hasOnlyEmptyRequestOptions(row)) {
    fail(
      'DeepSeek 配置含未知请求选项，拒绝自动迁移',
      'DEEPSEEK_FLASH_CONFIG_OPTIONS_UNSAFE'
    );
  }

  const currentModel = value(row, 'default_model');
  if (
    currentModel !== OFFICIAL_DEEPSEEK_PRESET.source_model
    && currentModel !== OFFICIAL_DEEPSEEK_PRESET.target_model
  ) {
    fail(
      'DeepSeek 配置使用未知模型，拒绝自动迁移',
      'DEEPSEEK_FLASH_CONFIG_MODEL_UNSUPPORTED'
    );
  }
  const ready = currentModel === OFFICIAL_DEEPSEEK_PRESET.target_model;
  return {
    preset: OFFICIAL_DEEPSEEK_PRESET.code,
    current_model: currentModel,
    target_model: OFFICIAL_DEEPSEEK_PRESET.target_model,
    enabled: Boolean(value(row, 'enabled')),
    credential_present: Boolean(value(row, 'encrypted_api_key')),
    migration_required: !ready,
    ready
  };
}

class DeepSeekFlashConfigMigrationService {
  constructor(options = {}) {
    this.model = options.model || require('../models').AIPlatformConfig;
    this.settingModel = options.settingModel || require('../models').Setting;
    this.sequelize = options.sequelize || require('../config/database');
    this.credentialValidator = options.credentialValidator || ((row) => {
      const secret = require('./AIPlatformConfigService').decryptApiKey(row);
      return Boolean(String(secret || '').trim());
    });
  }

  async findPreset(transaction = null) {
    const options = {
      where: { code: OFFICIAL_DEEPSEEK_PRESET.code }
    };
    if (transaction) {
      options.transaction = transaction;
      options.lock = transaction.LOCK.UPDATE;
    }
    const rows = await this.model.findAll(options);
    if (rows.length !== 1) {
      fail(
        '缺少唯一的 DeepSeek builtin 配置，拒绝自动迁移',
        'DEEPSEEK_FLASH_CONFIG_MISSING'
      );
    }
    return rows[0];
  }

  inspect(row) {
    return {
      row,
      state: inspectDeepSeekFlashConfigRow(row)
    };
  }

  async findAnalysisSettings(transaction = null) {
    const find = async (key, { required = true } = {}) => {
      const options = { where: { key } };
      if (transaction) {
        options.transaction = transaction;
        options.lock = transaction.LOCK.UPDATE;
      }
      const row = await this.settingModel.findOne(options);
      if (!row && required) {
        fail(
          `缺少正式分析配置 ${key}，拒绝自动迁移`,
          'DEEPSEEK_FLASH_ANALYSIS_SETTING_MISSING'
        );
      }
      return row;
    };
    const requestOptionsQuery = { where: { key: ANALYSIS_REQUEST_OPTIONS_SETTING } };
    if (transaction) {
      requestOptionsQuery.transaction = transaction;
      requestOptionsQuery.lock = transaction.LOCK.UPDATE;
    }
    return {
      platform: await find(ANALYSIS_PLATFORM_SETTING),
      model: await find(ANALYSIS_MODEL_SETTING, { required: false }),
      requestOptions: await this.settingModel.findOne(requestOptionsQuery)
    };
  }

  inspectAnalysisRequestOptions(settings) {
    let analysisRequestOptions = {};
    if (settings.requestOptions?.value) {
      try {
        analysisRequestOptions = JSON.parse(settings.requestOptions.value);
      } catch (_) {
        fail(
          '正式分析请求参数不是有效 JSON，拒绝自动迁移',
          'DEEPSEEK_FLASH_ANALYSIS_OPTIONS_INVALID'
        );
      }
    }
    if (!analysisRequestOptions || Array.isArray(analysisRequestOptions) || typeof analysisRequestOptions !== 'object') {
      fail(
        '正式分析请求参数必须是对象，拒绝自动迁移',
        'DEEPSEEK_FLASH_ANALYSIS_OPTIONS_INVALID'
      );
    }
    const sanitized = Object.fromEntries(
      Object.entries(analysisRequestOptions)
        .filter(([key]) => !FIXED_ANALYSIS_OPTION_KEYS.has(key))
    );
    return {
      migrationRequired: Object.keys(sanitized).length !== Object.keys(analysisRequestOptions).length,
      sanitized
    };
  }

  inspectRuntime(row, settings) {
    const platformState = this.inspect(row).state;
    const platformCode = String(value(settings.platform, 'value') || '').trim().toLowerCase();
    if (platformCode !== OFFICIAL_DEEPSEEK_PRESET.code) {
      fail(
        '正式分析平台不是 DeepSeek，拒绝自动迁移',
        'DEEPSEEK_FLASH_ANALYSIS_PLATFORM_MISMATCH'
      );
    }
    const runtimeModel = String(
      value(settings.model, 'value') || platformState.current_model || ''
    ).trim();
    if (
      runtimeModel !== OFFICIAL_DEEPSEEK_PRESET.source_model
      && runtimeModel !== OFFICIAL_DEEPSEEK_PRESET.target_model
    ) {
      fail(
        '正式分析配置使用未知模型，拒绝自动迁移',
        'DEEPSEEK_FLASH_ANALYSIS_MODEL_UNSUPPORTED'
      );
    }
    if (!platformState.enabled || !platformState.credential_present) {
      fail(
        'DeepSeek 正式配置未启用或缺少凭据，拒绝发布',
        'DEEPSEEK_FLASH_CONFIG_RUNTIME_UNAVAILABLE'
      );
    }
    let credentialDecryptable = false;
    try {
      credentialDecryptable = this.credentialValidator(row) === true;
    } catch (_) {
      credentialDecryptable = false;
    }
    if (!credentialDecryptable) {
      fail(
        'DeepSeek 正式凭据无法由当前主密钥验证，拒绝发布',
        'DEEPSEEK_FLASH_CREDENTIAL_INVALID'
      );
    }
    const analysisOptions = this.inspectAnalysisRequestOptions(settings);
    const analysisOptionsMigrationRequired = analysisOptions.migrationRequired;
    const ready = platformState.current_model === OFFICIAL_DEEPSEEK_PRESET.target_model
      && !settings.model
      && !analysisOptionsMigrationRequired;
    return {
      ...platformState,
      analysis_platform_code: platformCode,
      analysis_model: runtimeModel,
      legacy_analysis_model_setting_present: Boolean(settings.model),
      analysis_options_migration_required: analysisOptionsMigrationRequired,
      migration_required: !ready,
      ready
    };
  }

  async audit(options = {}) {
    const transaction = options.transaction || null;
    const row = await this.findPreset(transaction);
    const settings = await this.findAnalysisSettings(transaction);
    return this.inspectRuntime(row, settings);
  }

  async apply() {
    return this.sequelize.transaction(async (transaction) => {
      const row = await this.findPreset(transaction);
      const settings = await this.findAnalysisSettings(transaction);
      const before = this.inspectRuntime(row, settings);
      if (before.ready) {
        return { ...before, applied: false };
      }
      if (before.current_model === OFFICIAL_DEEPSEEK_PRESET.source_model) {
        const patch = {
          default_model: OFFICIAL_DEEPSEEK_PRESET.target_model,
          test_status: 'untested',
          last_tested_at: null,
          last_test_error_code: null,
          last_test_message: null,
          web_search_test_status: 'untested',
          last_web_search_tested_at: null,
          last_web_search_test_error_code: null,
          last_web_search_test_message: null
        };
        await row.update(patch, { transaction, fields: Object.keys(patch) });
      }
      if (settings.model) {
        await settings.model.destroy({ transaction });
        settings.model = null;
      }
      if (before.analysis_options_migration_required && settings.requestOptions) {
        const analysisOptions = this.inspectAnalysisRequestOptions(settings);
        await settings.requestOptions.update(
          { value: JSON.stringify(analysisOptions.sanitized) },
          { transaction, fields: ['value'] }
        );
      }
      const result = this.inspectRuntime(row, settings);
      if (!result.ready) {
        fail(
          'DeepSeek Flash 配置迁移后复审未通过',
          'DEEPSEEK_FLASH_CONFIG_MIGRATION_INCOMPLETE'
        );
      }
      return { ...result, applied: true };
    });
  }
}

module.exports = {
  OFFICIAL_DEEPSEEK_PRESET,
  ANALYSIS_PLATFORM_SETTING,
  ANALYSIS_MODEL_SETTING,
  ANALYSIS_REQUEST_OPTIONS_SETTING,
  DeepSeekFlashConfigMigrationError,
  DeepSeekFlashConfigMigrationService,
  inspectDeepSeekFlashConfigRow
};
