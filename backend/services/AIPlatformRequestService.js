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

const PROTECTED_REQUEST_OPTION_KEYS = new Set([
  'model',
  'messages',
  'input',
  'stream',
  'max_tokens',
  'max_output_tokens'
]);

function safeRequestOptions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !PROTECTED_REQUEST_OPTION_KEYS.has(key))
  );
}

function isResponsesAdapter(adapterType) {
  return adapterType === 'openai_responses';
}

function buildRequestBody(config, question, maxTokens) {
  const requestOptions = safeRequestOptions(config.request_options);
  if (isResponsesAdapter(config.adapter_type)) {
    return {
      tools: [{ type: 'web_search' }],
      temperature: 0.7,
      ...requestOptions,
      model: config.default_model,
      input: [{
        role: 'user',
        content: [{ type: 'input_text', text: question }]
      }],
      max_output_tokens: maxTokens
    };
  }
  return {
    temperature: 0.7,
    ...requestOptions,
    model: config.default_model,
    messages: [{ role: 'user', content: question }],
    max_tokens: maxTokens
  };
}

function resolveRequestUrl(adapterType, rawUrl) {
  const url = new URL(String(rawUrl || ''));
  const suffix = isResponsesAdapter(adapterType) ? '/responses' : '/chat/completions';
  const normalizedPath = url.pathname.replace(/\/+$/u, '');
  if (!normalizedPath.endsWith(suffix)) url.pathname = `${normalizedPath}${suffix}`;
  return url.toString();
}

function resolveModelsUrl(rawUrl) {
  const url = new URL(String(rawUrl || ''));
  let normalizedPath = url.pathname.replace(/\/+$/u, '');
  normalizedPath = normalizedPath.replace(/\/(?:chat\/completions|responses)$/u, '');
  url.pathname = `${normalizedPath}/models`;
  return url.toString();
}

function extractResponseText(adapterType, data) {
  if (isResponsesAdapter(adapterType)) {
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

function providerErrorDetails(error) {
  const data = error?.response?.data;
  const providerError = data?.error && typeof data.error === 'object' ? data.error : {};
  const message = String(
    providerError.message
    || data?.message
    || (typeof data === 'string' ? data : '')
    || ''
  ).replace(/\s+/gu, ' ').trim().slice(0, 500);
  const code = String(providerError.code || providerError.type || '').trim().slice(0, 100);
  return {
    status: Number(error?.response?.status || 0) || null,
    code: code || null,
    message: message || null
  };
}

function detectWebSearchEvidence(adapterType, data) {
  const searchCount = Number(data?.usage?.plugins?.search?.count || 0);
  if (searchCount > 0) {
    return { detected: true, type: 'provider_search_usage', count: searchCount };
  }

  if (isResponsesAdapter(adapterType)) {
    const output = Array.isArray(data?.output) ? data.output : [];
    const hasSearchItem = output.some((item) => (
      /web[_-]?search/iu.test(String(item?.type || ''))
      || (Array.isArray(item?.content) && item.content.some((part) => /web[_-]?search/iu.test(String(part?.type || ''))))
    ));
    if (hasSearchItem) return { detected: true, type: 'provider_web_search_output' };
  }
  return { detected: false, type: null };
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
    const requestConfig = options.requestOptions === undefined
      ? config
      : {
          adapter_type: config.adapter_type,
          default_model: config.default_model,
          request_options: options.requestOptions
        };
    const requestBody = buildRequestBody(requestConfig, String(question || ''), maxTokens);
    if (options.disableWebSearch) {
      delete requestBody.tools;
      delete requestBody.enable_search;
      delete requestBody.search_options;
    }
    const requestOptions = this.buildRequestOptions({ apiKey, timeoutSeconds, validation });
    let lastFailure = null;

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      const startedAt = this.now();
      try {
        const requestUrl = resolveRequestUrl(config.adapter_type, validation.url);
        const response = await this.httpClient.post(requestUrl, requestBody, requestOptions);
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
        const providerError = providerErrorDetails(error);
        lastFailure = {
          ...this.failure(platform, errorCode),
          provider_error: providerError
        };
        console.error('AI 平台调用失败:', {
          platform,
          error_code: errorCode,
          status: providerError.status || undefined,
          provider_code: providerError.code || undefined,
          provider_message: providerError.message || undefined,
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

  async listModels(platformId) {
    const config = await this.configService.getPlatform(platformId);
    if (!config?.encrypted_api_key) return this.failure(config?.code || 'unknown', 'missing_api_key');
    if (!String(config?.base_url || '').trim()) return this.failure(config?.code || 'unknown', 'missing_base_url');

    let apiKey;
    let validation;
    try {
      apiKey = this.configService.decryptApiKey(config);
      validation = await this.urlValidator(config.base_url);
    } catch (_) {
      return this.failure(config?.code || 'unknown', 'config_unavailable');
    }

    const settings = await this.settingsService.getSettings();
    const timeoutSeconds = config.request_timeout_seconds || settings.ai_default_timeout_seconds;
    try {
      const response = await this.httpClient.get(
        resolveModelsUrl(validation.url),
        this.buildRequestOptions({ apiKey, timeoutSeconds, validation })
      );
      const providerModels = Array.isArray(response?.data?.data) ? response.data.data : [];
      const providerModelIds = providerModels
        .map((item) => String(item?.id || '').trim())
        .filter(Boolean);
      if (!providerModelIds.length) return this.failure(config.code, 'invalid_provider_response');
      const models = Array.from(new Set([
        String(config.default_model || '').trim(),
        ...providerModelIds
      ].filter(Boolean))).sort((a, b) => a.localeCompare(b));
      return {
        success: true,
        platform: config.code,
        current_model: config.default_model,
        models,
        source: 'provider_api',
        persisted: false
      };
    } catch (error) {
      const errorCode = normalizeRequestError(error);
      console.error('AI 平台模型列表读取失败:', {
        platform: config.code,
        error_code: errorCode,
        status: Number(error?.response?.status || 0) || undefined
      });
      return this.failure(config.code, errorCode);
    }
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

  async testWebSearch(platformId, input) {
    const config = await this.configService.getPlatform(platformId);
    const testInput = String(
      input || '请务必使用联网搜索回答：今天（北京时间）的日期是什么？并说明你检索到的信息。'
    ).trim().slice(0, 1000);
    const connection = await this.queryConfig(
      config,
      testInput,
      { allowDisabled: true, retryCount: 0 }
    );

    let result;
    if (!connection.success) {
      result = {
        success: false,
        status: 'failed',
        error_code: connection.error_code,
        message: connection.error,
        input: testInput,
        output: null
      };
    } else {
      const evidence = detectWebSearchEvidence(config.adapter_type, connection.data);
      result = evidence.detected
        ? {
            success: true,
            status: 'success',
            evidence_type: evidence.type,
            message: '已检测到供应商返回的联网搜索调用证据',
            response_time_ms: connection.responseTime,
            model_name: connection.model_name,
            input: testInput,
            output: {
              text: connection.text,
              provider_response: connection.data
            }
          }
        : {
            success: false,
            status: 'inconclusive',
            error_code: 'search_evidence_missing',
            message: '模型调用成功，但供应商响应中没有可验证的联网搜索证据',
            response_time_ms: connection.responseTime,
            model_name: connection.model_name,
            input: testInput,
            output: {
              text: connection.text,
              provider_response: connection.data
            }
          };
    }

    const platform = await this.configService.saveWebSearchTestResult(platformId, result);
    return { platform, web_search: result };
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
module.exports.providerErrorDetails = providerErrorDetails;
module.exports.createPinnedAgent = createPinnedAgent;
module.exports.resolveModelsUrl = resolveModelsUrl;
module.exports.resolveRequestUrl = resolveRequestUrl;
module.exports.detectWebSearchEvidence = detectWebSearchEvidence;
module.exports.isResponsesAdapter = isResponsesAdapter;
