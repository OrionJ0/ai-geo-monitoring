const axios = require('axios');
const crypto = require('node:crypto');
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
  provider_quota_exhausted: '平台账户额度不足，请补充额度后重试。',
  rate_limited: '平台请求过于频繁，请稍后重试。',
  timeout: '平台请求超时，请稍后重试或调整超时设置。',
  network_error: '无法连接监测平台，请检查网络或代理设置。',
  provider_error: '平台服务暂时异常，请稍后重试。',
  input_too_long: '提交内容超出模型可处理范围。',
  invalid_provider_response: '平台返回格式异常，请管理员检查平台配置。',
  service_shutting_down: '服务正在安全关闭，请稍后重试。',
  config_unavailable: '监测平台配置暂不可用，请联系管理员。',
  disabled: '监测平台已被管理员停用。',
  missing_api_key: '平台未配置 API Key。',
  missing_base_url: '平台未配置 Base URL。',
  missing_model: '平台未配置默认模型。'
});

const PROVIDER_QUOTA_ERROR_CODES = new Set([
  'allocationquota.freetieronly',
  'arrearage',
  'balance_not_enough',
  'billing_not_active',
  'insufficient_quota',
  'quota_exceeded',
  'quota_exhausted'
]);
const PROVIDER_INPUT_TOO_LONG_CODES = new Set([
  'context_length_exceeded',
  'context_window_exceeded',
  'input_too_long',
  'max_context_length_exceeded',
  'prompt_too_long',
  'request_too_large',
  'too_many_tokens'
]);
const PROVIDER_INPUT_TOO_LONG_PATTERNS = Object.freeze([
  /context (?:length|window).*(?:exceed|limit|maximum)/iu,
  /maximum context (?:length|window)/iu,
  /(?:input|prompt).*(?:too long|exceed.*(?:token|context|length))/iu,
  /too many (?:input )?tokens/iu
]);

const PROTECTED_REQUEST_OPTION_KEYS = new Set([
  'model',
  'messages',
  'input',
  'stream',
  'max_tokens',
  'max_output_tokens'
]);
const AUDIT_PURPOSES = new Set([
  'analysis_entity_extract',
  'analysis_semantic_judge',
  'connection_test',
  'direct_stream',
  'evaluation_v4_baseline',
  'legacy_schedule',
  'model_listing',
  'project_monitoring',
  'prompt_generation',
  'web_search_test'
]);
const ANALYSIS_PROMPT_TEMPLATES = Object.freeze({
  analysis_entity_extract: Object.freeze({
    open: '<source_answer>',
    close: '</source_answer>',
    revision: 'grounded_entity_catalog_v1',
    fingerprints: Object.freeze({
      base: '43508380a32708aab5f3815e114dbfbd19af21ec52018f58f055e2bc76ff93af',
      repair: 'e515bc35a1d1f662d7aee4b6a930f37af33fb28e0586e0045d1db65266134ba0'
    })
  }),
  analysis_semantic_judge: Object.freeze({
    open: '<semantic_input>',
    close: '</semantic_input>',
    revision: 'closed_entity_semantics_v4_evidence_roles_rev2',
    fingerprints: Object.freeze({
      base: 'bbab0ccf31aecaa250bd24209581ef99fb9ef2c83e26c4ba90623aef741efddb',
      repair: 'a577dd874396b24b6e5f1cfec8736b988b25a3415981b8cd6ba4d48cee87da90'
    })
  })
});

function normalizeAuditPurpose(value) {
  const purpose = String(value || '').trim();
  return AUDIT_PURPOSES.has(purpose) ? purpose : 'unspecified';
}

function normalizeCorrelationId(value) {
  const correlationId = String(value || '').trim();
  return /^record-[1-9][0-9]{0,18}$/u.test(correlationId) ? correlationId : null;
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableSerialize(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function derivePromptEvidence(purpose, prompt) {
  const definition = ANALYSIS_PROMPT_TEMPLATES[purpose];
  if (!definition) {
    return {
      promptFingerprint: null,
      promptTemplateFingerprint: null,
      promptRevision: null,
      promptVariant: null
    };
  }
  const promptText = String(prompt || '');
  const prefix = `${definition.open}\n`;
  const closing = `\n${definition.close}\n`;
  if (!promptText.startsWith(prefix)) {
    return {
      promptFingerprint: crypto.createHash('sha256').update(promptText).digest('hex'),
      promptTemplateFingerprint: null,
      promptRevision: null
    };
  }
  const dynamicEnd = promptText.indexOf(closing, prefix.length);
  if (dynamicEnd < 0) {
    return {
      promptFingerprint: crypto.createHash('sha256').update(promptText).digest('hex'),
      promptTemplateFingerprint: null,
      promptRevision: null
    };
  }
  try {
    JSON.parse(promptText.slice(prefix.length, dynamicEnd));
  } catch (_) {
    return {
      promptFingerprint: crypto.createHash('sha256').update(promptText).digest('hex'),
      promptTemplateFingerprint: null,
      promptRevision: null
    };
  }
  const normalized = `${prefix}<DYNAMIC_JSON>\n${definition.close}\n${
    promptText.slice(dynamicEnd + closing.length)
  }`;
  const repairSeparator = '\n<validation_feedback>\n';
  const repairIndex = normalized.indexOf(repairSeparator);
  const baseTemplate = repairIndex >= 0 ? normalized.slice(0, repairIndex) : normalized;
  let promptVariant = 'base';
  let normalizedTemplate = baseTemplate;
  if (repairIndex >= 0) {
    promptVariant = 'repair';
    let repair = normalized.slice(repairIndex + 1)
      .replace(/^error_code=.*$/mu, 'error_code=<DYNAMIC_ERROR_CODE>')
      .replace(/^field=.*$/mu, 'field=<DYNAMIC_FIELD>');
    if (purpose === 'analysis_semantic_judge') {
      repair = repair
        .replace(/^message=.*$/mu, 'message=<DYNAMIC_MESSAGE>')
        .replace(
          /^target_entity_id=.*（非 null 时必须输出 assessed 情绪，label 为 positive\/neutral\/negative，不得返回 sentiment=not_applicable）$/mu,
          'target_entity_id=<DYNAMIC_TARGET_ID>（非 null 时必须输出 assessed 情绪，label 为 positive/neutral/negative，不得返回 sentiment=not_applicable）'
        )
        .replace(
          /<source_map>\n[\s\S]*?\n<\/source_map>/u,
          '<source_map>\n<DYNAMIC_SOURCE_MAP>\n</source_map>'
        )
        .replace(
          /<entity_occurrence_ids>\n[\s\S]*?\n<\/entity_occurrence_ids>/u,
          '<entity_occurrence_ids>\n<DYNAMIC_OCCURRENCE_IDS>\n</entity_occurrence_ids>'
        );
    }
    normalizedTemplate = `${baseTemplate}\n${repair}`;
  }
  const templateFingerprint = crypto.createHash('sha256').update(normalizedTemplate).digest('hex');
  const promptFingerprint = crypto.createHash('sha256').update(promptText).digest('hex');
  return {
    promptFingerprint,
    promptTemplateFingerprint: templateFingerprint,
    promptRevision: templateFingerprint === definition.fingerprints[promptVariant]
      ? definition.revision
      : null,
    promptVariant
  };
}

function deriveRequestPolicyEvidence({ purpose, requestBody, prompt, adapterType, model }) {
  if (!requestBody || typeof requestBody !== 'object') {
    return {
      policyRevision: null,
      policyFingerprint: null,
      policyValid: null,
      promptFingerprint: null,
      promptTemplateFingerprint: null,
      promptVariant: null
    };
  }
  const policyBody = Object.fromEntries(
    Object.entries(requestBody).filter(([key]) => !['messages', 'input'].includes(key))
  );
  const policyFingerprint = crypto.createHash('sha256').update(stableSerialize({
    adapter_type: adapterType,
    model,
    policy_body: policyBody
  })).digest('hex');
  if (!['analysis_entity_extract', 'analysis_semantic_judge'].includes(purpose)) {
    return {
      policyRevision: null,
      policyFingerprint,
      policyValid: null,
      promptFingerprint: null,
      promptTemplateFingerprint: null,
      promptVariant: null
    };
  }
  const noWebPolicy = !Object.hasOwn(policyBody, 'tools')
    && !Object.hasOwn(policyBody, 'enable_search')
    && !Object.hasOwn(policyBody, 'search_options')
    && !Object.hasOwn(policyBody, 'web_search_options');
  const fixedPolicy = policyBody.temperature === 0
    && policyBody.response_format?.type === 'json_object'
    && policyBody.thinking?.type === 'disabled'
    && !Object.hasOwn(policyBody, 'max_tokens')
    && !Object.hasOwn(policyBody, 'max_output_tokens')
    && noWebPolicy;
  const promptEvidence = derivePromptEvidence(purpose, prompt);
  const promptRevision = promptEvidence.promptRevision;
  return {
    policyRevision: promptRevision ? `${promptRevision}+fixed_json_no_web_v1` : null,
    policyFingerprint,
    policyValid: fixedPolicy && Boolean(promptRevision),
    promptFingerprint: promptEvidence.promptFingerprint,
    promptTemplateFingerprint: promptEvidence.promptTemplateFingerprint,
    promptVariant: promptEvidence.promptVariant
  };
}

function emitRequestAudit(logger, {
  platform,
  model,
  purpose,
  attempt,
  correlationId,
  requestBody,
  prompt,
  adapterType
}) {
  const normalizedPurpose = normalizeAuditPurpose(purpose);
  const policy = deriveRequestPolicyEvidence({
    purpose: normalizedPurpose,
    requestBody,
    prompt,
    adapterType,
    model
  });
  logger({
    event: 'ai_platform_request',
    platform: String(platform || ''),
    model: String(model || ''),
    purpose: normalizedPurpose,
    attempt: Math.max(1, Number(attempt) || 1),
    correlation_id: normalizeCorrelationId(correlationId),
    policy_revision: policy.policyRevision,
    policy_fingerprint: policy.policyFingerprint,
    policy_valid: policy.policyValid,
    prompt_fingerprint: policy.promptFingerprint ?? null,
    prompt_template_fingerprint: policy.promptTemplateFingerprint ?? null,
    prompt_variant: policy.promptVariant ?? null
  });
}

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
  const hasTokenLimit = Number.isFinite(Number(maxTokens)) && Number(maxTokens) > 0;
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
      ...(hasTokenLimit ? { max_output_tokens: Number(maxTokens) } : {})
    };
  }
  return {
    temperature: 0.7,
    ...requestOptions,
    model: config.default_model,
    messages: [{ role: 'user', content: question }],
    ...(hasTokenLimit ? { max_tokens: Number(maxTokens) } : {})
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
  const providerError = providerErrorDetails(error);
  const providerCode = String(providerError.code || '').trim().toLowerCase();
  if (PROVIDER_QUOTA_ERROR_CODES.has(providerCode)) return 'provider_quota_exhausted';
  if (
    status === 413
    || PROVIDER_INPUT_TOO_LONG_CODES.has(providerCode)
    || PROVIDER_INPUT_TOO_LONG_PATTERNS.some((pattern) => pattern.test(providerError.message || ''))
  ) {
    return 'input_too_long';
  }
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
  const code = String(providerError.code || providerError.type || data?.code || '').trim().slice(0, 100);
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

  const providerSearchResults = (Array.isArray(data?.choices) ? data.choices : [])
    .flatMap((choice) => (
      Array.isArray(choice?.message?.search_results)
        ? choice.message.search_results
        : []
    ))
    .filter((item) => {
      try {
        const url = new URL(String(item?.url || ''));
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch (_) {
        return false;
      }
    });
  if (providerSearchResults.length > 0) {
    return {
      detected: true,
      type: 'provider_search_results',
      count: providerSearchResults.length
    };
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
    this.auditLogger = options.auditLogger || ((event) => {
      console.info(`AI_PLATFORM_REQUEST_AUDIT ${JSON.stringify(event)}`);
    });
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
    const timeoutOverride = Number(options.timeoutSeconds);
    const maxTokensOverride = Number(options.maxTokens);
    const timeoutSeconds = Number.isFinite(timeoutOverride) && timeoutOverride > 0
      ? Math.floor(timeoutOverride)
      : (config.request_timeout_seconds || settings.ai_default_timeout_seconds);
    const maxTokens = options.omitTokenLimit === true
      ? null
      : (
        Number.isFinite(maxTokensOverride) && maxTokensOverride > 0
          ? Math.floor(maxTokensOverride)
          : (config.max_tokens || settings.ai_default_max_tokens)
      );
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
      delete requestBody.web_search_options;
    }
    const requestOptions = this.buildRequestOptions({
      apiKey,
      timeoutSeconds,
      validation,
      signal: options.signal
    });
    let lastFailure = null;

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      const startedAt = this.now();
      try {
        const requestUrl = resolveRequestUrl(config.adapter_type, validation.url);
        emitRequestAudit(this.auditLogger, {
          platform,
          model: config.default_model,
          purpose: options.purpose,
          attempt: attempt + 1,
          correlationId: options.correlationId,
          requestBody,
          prompt: question,
          adapterType: config.adapter_type
        });
        const response = await this.httpClient.post(requestUrl, requestBody, requestOptions);
        const text = extractResponseText(config.adapter_type, response?.data);
        if (!text) {
          const responseData = response?.data;
          console.error('AI 平台返回格式异常:', {
            platform,
            adapter_type: config.adapter_type,
            status: Number(response?.status || 0) || null,
            response_keys: responseData && typeof responseData === 'object' ? Object.keys(responseData).slice(0, 20) : typeof responseData,
            choices: Array.isArray(responseData?.choices) ? responseData.choices.length : null,
            content_type: typeof responseData?.choices?.[0]?.message?.content,
            provider_error: responseData?.error && typeof responseData.error === 'object'
              ? JSON.stringify(responseData.error).slice(0, 300)
              : null
          });
          lastFailure = this.failure(platform, 'invalid_provider_response');
          // 生产部署两次验收失败均源于 deepseek API 偶发返回 HTTP 200 且
          // 结构完整但 content 为空的响应（record 109/117，同配置 9 秒前
          // 成功）。空文本属于外部瞬时故障，在有限重试次数内重新请求；
          // 合同永久变化时重试后仍失败，最终记录照常 failed。
          if (attempt >= retryCount) break;
          await this.waitForRetry(Math.min(5000, 1000 * (2 ** attempt)), options.signal);
          continue;
        }
        const headerTime = Number(response?.headers?.['x-response-time']);
        const webSearchEvidence = detectWebSearchEvidence(config.adapter_type, response?.data);
        return {
          success: true,
          data: response.data,
          text,
          platform,
          model_name: config.default_model,
          citation_observation_status: (
            isResponsesAdapter(config.adapter_type)
            || webSearchEvidence.detected
          )
            ? 'observed'
            : 'unavailable',
          responseTime: Number.isFinite(headerTime) && headerTime >= 0
            ? headerTime
            : Math.max(0, this.now() - startedAt)
        };
      } catch (error) {
        if (options.signal?.aborted) {
          lastFailure = this.failure(platform, 'service_shutting_down');
          break;
        }
        const errorCode = normalizeRequestError(error);
        const providerError = providerErrorDetails(error);
        lastFailure = {
          ...this.failure(platform, errorCode),
          provider_error: {
            status: providerError.status,
            code: providerError.code
          }
        };
        console.error('AI 平台调用失败:', {
          platform,
          error_code: errorCode,
          status: providerError.status || undefined,
          provider_code: providerError.code || undefined,
          network_code: String(error?.code || '').slice(0, 40) || undefined
        });
        // 生产部署两次验收失败均源于 deepseek API 偶发返回 HTTP 200 但
        // content 为空的响应（record 109/117，同配置 9 秒前成功）。结构
        // 完整但文本缺失属于外部瞬时故障，应走有限重试；合同永久变化时
        // 重试后仍失败，最终记录照常 failed，不会掩盖真实错误。
        const retryable = [
          'rate_limited',
          'timeout',
          'network_error',
          'provider_error',
          'invalid_provider_response'
        ].includes(errorCode);
        if (!retryable || attempt >= retryCount) break;
        const retryAfter = Number.parseInt(error?.response?.headers?.['retry-after'] || '0', 10);
        const delay = retryAfter > 0 ? retryAfter * 1000 : Math.min(5000, 1000 * (2 ** attempt));
        await this.waitForRetry(delay, options.signal);
      }
    }
    return lastFailure || this.failure(platform, 'provider_error');
  }

  async waitForRetry(delay, signal) {
    if (!signal) return this.wait(delay);
    if (signal.aborted) return;
    await Promise.race([
      this.wait(delay),
      new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
    ]);
  }

  buildRequestOptions({ apiKey, timeoutSeconds, validation, signal = undefined }) {
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
      httpsAgent,
      ...(signal ? { signal } : {})
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
      emitRequestAudit(this.auditLogger, {
        platform: config.code,
        model: config.default_model,
        purpose: 'model_listing',
        attempt: 1,
        correlationId: null,
        adapterType: config.adapter_type
      });
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
      retryCount: 0,
      purpose: 'connection_test'
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
      {
        allowDisabled: true,
        retryCount: 1,
        purpose: 'web_search_test'
      }
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
            message: config.code === 'hunyuan'
              ? '模型调用成功，但 TokenHub 没有返回联网搜索证据。请检查「工具管理」是否已有可用的联网搜索免费资源包或后付费；若已开通，请稍后重试。'
              : '模型调用成功，但供应商响应中没有可验证的联网搜索证据',
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
module.exports.emitRequestAudit = emitRequestAudit;
module.exports.buildRequestBody = buildRequestBody;
module.exports.extractResponseText = extractResponseText;
module.exports.normalizeRequestError = normalizeRequestError;
module.exports.providerErrorDetails = providerErrorDetails;
module.exports.createPinnedAgent = createPinnedAgent;
module.exports.resolveModelsUrl = resolveModelsUrl;
module.exports.resolveRequestUrl = resolveRequestUrl;
module.exports.detectWebSearchEvidence = detectWebSearchEvidence;
module.exports.isResponsesAdapter = isResponsesAdapter;
module.exports.derivePromptEvidence = derivePromptEvidence;
module.exports.ANALYSIS_PROMPT_TEMPLATES = ANALYSIS_PROMPT_TEMPLATES;
