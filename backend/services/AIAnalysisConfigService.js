const { Setting } = require('../models');
const AIPlatformConfigService = require('./AIPlatformConfigService');
const {
  getUnavailableReason,
  hasPlatformCapability,
  normalizeRequestOptions
} = require('./AIPlatformConfigService');

const PLATFORM_SETTING_KEY = 'ai_analysis_platform_code';
const MODEL_SETTING_KEY = 'ai_analysis_model_name';
const REQUEST_OPTIONS_SETTING_KEY = 'ai_analysis_request_options';
const ANALYSIS_POLICY_REQUEST_OPTION_KEYS = new Set([
  'tools',
  'tool_choice',
  'enable_search',
  'search_options',
  'web_search_options'
]);

class AIAnalysisConfigError extends Error {
  constructor(message, code = 'analysis_config_unavailable', status = 400) {
    super(message);
    this.name = 'AIAnalysisConfigError';
    this.code = code;
    this.status = status;
  }
}

function normalizeAnalysisRequestOptions(value) {
  const options = normalizeRequestOptions(value);
  for (const key of Object.keys(options)) {
    if (ANALYSIS_POLICY_REQUEST_OPTION_KEYS.has(key)) {
      throw new AIAnalysisConfigError(
        `AI 分析请求参数不能覆盖系统字段 ${key}`,
        'analysis_request_options_invalid'
      );
    }
  }
  return options;
}

class AIAnalysisConfigService {
  constructor(options = {}) {
    this.settingModel = options.settingModel || Setting;
    this.platformConfigService = options.platformConfigService || AIPlatformConfigService;
  }

  async getPlatformCode() {
    const row = await this.settingModel.findOne({ where: { key: PLATFORM_SETTING_KEY } });
    return String(row?.value || '').trim().toLowerCase();
  }

  async getConfiguredModelName(platform) {
    const row = await this.settingModel.findOne({ where: { key: MODEL_SETTING_KEY } });
    return String(row?.value || platform?.default_model || '').trim();
  }

  async getRequestOptions() {
    const row = await this.settingModel.findOne({ where: { key: REQUEST_OPTIONS_SETTING_KEY } });
    if (!row?.value) return {};
    try {
      return normalizeAnalysisRequestOptions(JSON.parse(row.value));
    } catch (_) {
      throw new AIAnalysisConfigError(
        'AI 分析请求参数无效',
        'analysis_request_options_invalid',
        503
      );
    }
  }

  async getAnalysisPlatform() {
    const platformCode = await this.getPlatformCode();
    if (!platformCode) {
      throw new AIAnalysisConfigError('尚未配置 AI 分析 API', 'analysis_api_not_configured', 503);
    }
    let platform;
    try {
      platform = await this.platformConfigService.getPlatformByCode(platformCode);
    } catch (_) {
      throw new AIAnalysisConfigError('AI 分析 API 配置不存在', 'analysis_api_not_found', 503);
    }
    if (!hasPlatformCapability(platform, 'analysis')) {
      throw new AIAnalysisConfigError(
        '该平台不能用作 AI 结构化分析 API',
        'analysis_platform_unsupported',
        503
      );
    }
    const unavailableReason = getUnavailableReason(platform);
    if (unavailableReason) {
      throw new AIAnalysisConfigError('AI 分析 API 当前不可用', `analysis_api_${unavailableReason}`, 503);
    }
    const modelName = await this.getConfiguredModelName(platform);
    const requestOptions = await this.getRequestOptions();
    if (!modelName) {
      throw new AIAnalysisConfigError('AI 分析模型未配置', 'analysis_model_not_configured', 503);
    }
    const value = platform?.get ? platform.get({ plain: true }) : { ...platform };
    return {
      ...value,
      default_model: modelName,
      analysis_request_options: requestOptions
    };
  }

  async getPublicConfig() {
    const platformCode = await this.getPlatformCode();
    const requestOptions = await this.getRequestOptions();
    if (!platformCode) {
      return {
        platform_code: '',
        model_name: '',
        request_options: requestOptions,
        configured: false,
        platform: null
      };
    }
    try {
      const platform = await this.platformConfigService.getPlatformByCode(platformCode);
      if (!hasPlatformCapability(platform, 'analysis')) {
        return {
          platform_code: platformCode,
          model_name: '',
          request_options: requestOptions,
          configured: false,
          unavailable_reason: 'unsupported_platform_capability',
          platform: null
        };
      }
      const unavailableReason = getUnavailableReason(platform);
      const modelName = await this.getConfiguredModelName(platform);
      return {
        platform_code: platformCode,
        model_name: modelName,
        request_options: requestOptions,
        configured: unavailableReason === null && Boolean(modelName),
        unavailable_reason: unavailableReason,
        platform: {
          code: platform.code,
          name: platform.name,
          model_name: modelName
        }
      };
    } catch (_) {
      return {
        platform_code: platformCode,
        model_name: '',
        request_options: requestOptions,
        configured: false,
        unavailable_reason: 'platform_not_found',
        platform: null
      };
    }
  }

  async saveSetting(key, value) {
    const [row] = await this.settingModel.findOrCreate({
      where: { key },
      defaults: { key, value }
    });
    if (row.value !== value) await row.update({ value });
  }

  async setConfig(input = {}) {
    const platformCode = String(input.platform_code || '').trim().toLowerCase();
    const modelName = String(input.model_name || '').trim();
    if (!platformCode) {
      throw new AIAnalysisConfigError('请选择 AI 分析 API', 'analysis_api_required');
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(platformCode)) {
      throw new AIAnalysisConfigError('AI 分析 API 标识无效', 'analysis_api_invalid');
    }
    let platform;
    try {
      platform = await this.platformConfigService.getPlatformByCode(platformCode);
    } catch (_) {
      throw new AIAnalysisConfigError('AI 分析 API 不存在', 'analysis_api_not_found', 404);
    }
    if (!hasPlatformCapability(platform, 'analysis')) {
      throw new AIAnalysisConfigError(
        '该平台不能用作 AI 结构化分析 API',
        'analysis_platform_unsupported'
      );
    }
    const unavailableReason = getUnavailableReason(platform);
    if (unavailableReason) {
      throw new AIAnalysisConfigError('只能选择已启用且完成密钥配置的平台', `analysis_api_${unavailableReason}`);
    }
    if (!modelName) {
      throw new AIAnalysisConfigError('请选择 AI 分析模型', 'analysis_model_required');
    }
    if (modelName.length > 255) {
      throw new AIAnalysisConfigError('AI 分析模型长度不能超过 255', 'analysis_model_invalid');
    }
    let requestOptions;
    try {
      requestOptions = normalizeAnalysisRequestOptions(input.request_options);
    } catch (error) {
      throw new AIAnalysisConfigError(
        error?.message || 'AI 分析请求参数无效',
        'analysis_request_options_invalid'
      );
    }
    await this.saveSetting(PLATFORM_SETTING_KEY, platformCode);
    await this.saveSetting(MODEL_SETTING_KEY, modelName);
    await this.saveSetting(REQUEST_OPTIONS_SETTING_KEY, JSON.stringify(requestOptions));
    return this.getPublicConfig();
  }
}

const service = new AIAnalysisConfigService();

module.exports = service;
module.exports.AIAnalysisConfigService = AIAnalysisConfigService;
module.exports.AIAnalysisConfigError = AIAnalysisConfigError;
module.exports.PLATFORM_SETTING_KEY = PLATFORM_SETTING_KEY;
module.exports.MODEL_SETTING_KEY = MODEL_SETTING_KEY;
module.exports.REQUEST_OPTIONS_SETTING_KEY = REQUEST_OPTIONS_SETTING_KEY;
