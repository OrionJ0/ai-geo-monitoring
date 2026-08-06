const OFFICIAL_DEEPSEEK_PRESET = Object.freeze({
  code: 'deepseek',
  name: 'DeepSeek',
  adapter_type: 'openai_chat_completions',
  base_url: 'https://api.deepseek.com/v1/chat/completions',
  source_model: 'deepseek-v4-pro',
  target_model: 'deepseek-v4-flash'
});

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
    this.sequelize = options.sequelize || require('../config/database');
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

  async audit(options = {}) {
    const row = await this.findPreset(options.transaction || null);
    return this.inspect(row).state;
  }

  async apply() {
    return this.sequelize.transaction(async (transaction) => {
      const inspected = this.inspect(await this.findPreset(transaction));
      if (inspected.state.ready) {
        return { ...inspected.state, applied: false };
      }
      await inspected.row.update(
        { default_model: OFFICIAL_DEEPSEEK_PRESET.target_model },
        { transaction, fields: ['default_model'] }
      );
      const result = this.inspect(inspected.row).state;
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
  DeepSeekFlashConfigMigrationError,
  DeepSeekFlashConfigMigrationService,
  inspectDeepSeekFlashConfigRow
};
