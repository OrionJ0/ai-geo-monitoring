const axios = require('axios');
const https = require('node:https');
const AIPlatformConfigService = require('./AIPlatformConfigService');
const AIRuntimeSettingsService = require('./AIRuntimeSettingsService');
const { validatePlatformUrl } = require('./PlatformUrlPolicyService');

let HttpsProxyAgent;
try {
  const proxyAgentModule = require('https-proxy-agent');
  HttpsProxyAgent = proxyAgentModule.HttpsProxyAgent || proxyAgentModule;
} catch (_) {
  HttpsProxyAgent = null;
}

const ERROR_MESSAGES = Object.freeze({
  authentication_failed: '平台认证失败，请管理员检查 API Key。',
  rate_limited: '平台请求过于频繁，请稍后重试。',
  timeout: '平台请求超时，请稍后重试或调整超时设置。',
  network_error: '无法连接监测平台，请检查网络或代理设置。',
  provider_error: '平台服务暂时异常，请稍后重试。',
  invalid_provider_response: '平台返回格式异常，请管理员检查平台配置。',
  config_unavailable: '监测平台配置暂不可用，请联系管理员。',
  disabled: '监测平台已被管理员停用。',
  missing_api_key: '平台未配置 API Key。',
  missing_base_url: '平台未配置 Base URL。',
  missing_model: '平台未配置默认模型。'
});

function buildRequestBody(config, question, maxTokens) {
  if (config.adapter_type === 'doubao_responses') {
    return {
      model: config.default_model,
      input: [{
        role: 'user',
        content: [{ type: 'input_text', text: question }]
      }],
      tools: [{ type: 'web_search' }],
      temperature: 0.7,
      max_output_tokens: maxTokens
    };
  }
  return {
    model: config.default_model,
    messages: [{ role: 'user', content: question }],
    temperature: 0.7,
    max_tokens: maxTokens
  };
}

function extractResponseText(adapterType, data) {
  if (adapterType === 'doubao_responses') {
    if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text;
    const parts = Array.isArray(data?.output) ? data.output : [];
    const text = parts
      .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
      .map((item) => item?.text || item?.output_text || '')
      .filter(Boolean)
      .join('\n');
    return text || null;
  }
  const content = data?.choices?.[0]?.message?.content;
  return typeof content === 'string' && content.trim() ? content : null;
}

function normalizeRequestError(error) {
  const status = Number(error?.response?.status || 0);
  const code = String(error?.code || '').toUpperCase();
  if (status === 401 || status === 403) return 'authentication_failed';
  if (status === 429) return 'rate_limited';
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') return 'timeout';
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) {
    return 'network_error';
  }
  return 'provider_error';
}

function createPinnedAgent(validation) {
  const addresses = Array.isArray(validation?.addresses) ? validation.addresses.filter(Boolean) : [];
  const hostname = String(validation?.hostname || '').toLowerCase();
  if (!addresses.length || !hostname) return new https.Agent({ keepAlive: true });

  let cursor = 0;
  return new https.Agent({
    keepAlive: true,
    lookup(requestedHost, options, callback) {
      const normalizedHost = String(requestedHost || '').toLowerCase();
      if (normalizedHost !== hostname) return callback(new Error('平台主机名与已验证地址不一致'));
      const all = typeof options === 'object' && options.all;
      const records = addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
      if (all) return callback(null, records);
      const selected = records[cursor % records.length];
      cursor += 1;
      return callback(null, selected.address, selected.family);
    }
  });
}

class AIPlatformRequestService {
  constructor(options = {}) {
    this.configService = options.configService || AIPlatformConfigService;
    this.settingsService = options.settingsService || AIRuntimeSettingsService;
    this.httpClient = options.httpClient || axios;
    this.urlValidator = options.urlValidator || validatePlatformUrl;
    this.now = options.now || Date.now;
    this.wait = options.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async queryPlatform(platformCode, question, options = {}) {
    let config;
    try {
      config = options.config || await this.configService.getPlatformByCode(platformCode);
    } catch (_) {
      return this.failure(platformCode, 'config_unavailable');
    }
    return this.queryConfig(config, question, options);
  }

  async queryConfig(config, question, options = {}) {
    const platform = config?.code || 'unknown';
    if (config?.archived_at) return this.failure(platform, 'config_unavailable');
    if (!options.allowDisabled && !config?.enabled) return this.failure(platform, 'disabled');
    if (!config?.encrypted_api_key) return this.failure(platform, 'missing_api_key');
    if (!String(config?.base_url || '').trim()) return this.failure(platform, 'missing_base_url');
    if (!String(config?.default_model || '').trim()) return this.failure(platform, 'missing_model');

    let apiKey;
    let validation;
    try {
      apiKey = this.configService.decryptApiKey(config);
      validation = await this.urlValidator(config.base_url);
    } catch (_) {
      return this.failure(platform, 'config_unavailable');
    }

    const settings = options.runtimeSettings || await this.settingsService.getSettings();
    const timeoutSeconds = config.request_timeout_seconds || settings.ai_default_timeout_seconds;
    const maxTokens = config.max_tokens || settings.ai_default_max_tokens;
    const retryCount = options.retryCount ?? settings.ai_retry_count;
    const requestBody = buildRequestBody(config, String(question || ''), maxTokens);
    const requestOptions = this.buildRequestOptions({ apiKey, timeoutSeconds, validation });
    let lastFailure = null;

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      const startedAt = this.now();
      try {
        const response = await this.httpClient.post(validation.url, requestBody, requestOptions);
        const text = extractResponseText(config.adapter_type, response?.data);
        if (!text) return this.failure(platform, 'invalid_provider_response');
        const headerTime = Number(response?.headers?.['x-response-time']);
        return {
          success: true,
          data: response.data,
          text,
          platform,
          model_name: config.default_model,
          responseTime: Number.isFinite(headerTime) && headerTime >= 0
            ? headerTime
            : Math.max(0, this.now() - startedAt)
        };
      } catch (error) {
        const errorCode = normalizeRequestError(error);
        lastFailure = this.failure(platform, errorCode);
        console.error('AI 平台调用失败:', {
          platform,
          error_code: errorCode,
          status: Number(error?.response?.status || 0) || undefined,
          network_code: String(error?.code || '').slice(0, 40) || undefined
        });
        const retryable = ['rate_limited', 'timeout', 'network_error', 'provider_error'].includes(errorCode);
        if (!retryable || attempt >= retryCount) break;
        const retryAfter = Number.parseInt(error?.response?.headers?.['retry-after'] || '0', 10);
        const delay = retryAfter > 0 ? retryAfter * 1000 : Math.min(5000, 1000 * (2 ** attempt));
        await this.wait(delay);
      }
    }
    return lastFailure || this.failure(platform, 'provider_error');
  }

  buildRequestOptions({ apiKey, timeoutSeconds, validation }) {
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.PROXY_URL;
    let httpsAgent = createPinnedAgent(validation);
    if (proxyUrl && HttpsProxyAgent) httpsAgent = new HttpsProxyAgent(proxyUrl);
    return {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      timeout: timeoutSeconds * 1000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      maxRedirects: 0,
      proxy: false,
      decompress: true,
      httpsAgent
    };
  }

  async testConnection(platformId) {
    const config = await this.configService.getPlatform(platformId);
    const connection = await this.queryConfig(config, '请只回复 OK', {
      allowDisabled: true,
      retryCount: 0
    });
    const platform = await this.configService.saveTestResult(platformId, {
      success: connection.success,
      error_code: connection.error_code,
      message: connection.success
        ? `连接成功（${connection.responseTime}ms）`
        : connection.error
    });
    return {
      platform,
      connection: connection.success
        ? {
            success: true,
            message: '连接成功',
            response_time_ms: connection.responseTime,
            model_name: connection.model_name
          }
        : {
            success: false,
            error_code: connection.error_code,
            message: connection.error
          }
    };
  }

  failure(platform, errorCode) {
    return {
      success: false,
      platform,
      error_code: errorCode,
      error: ERROR_MESSAGES[errorCode] || ERROR_MESSAGES.provider_error
    };
  }
}

const service = new AIPlatformRequestService();

module.exports = service;
module.exports.AIPlatformRequestService = AIPlatformRequestService;
module.exports.ERROR_MESSAGES = ERROR_MESSAGES;
module.exports.buildRequestBody = buildRequestBody;
module.exports.extractResponseText = extractResponseText;
module.exports.normalizeRequestError = normalizeRequestError;
module.exports.createPinnedAgent = createPinnedAgent;
