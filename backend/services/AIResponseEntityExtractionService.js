const AIPlatformRequestService = require('./AIPlatformRequestService');
const AIAnalysisConfigService = require('./AIAnalysisConfigService');

const ENTITY_PROMPT_REVISION = 'grounded_entity_catalog_v1';
const ENTITY_MAX_ATTEMPTS = 2;
const ANALYSIS_TIMEOUT_SECONDS = 120;
const ENTITY_TYPES = new Set(['brand', 'company', 'other_organization']);
const FIXED_REQUEST_OPTIONS = Object.freeze({
  temperature: 0,
  response_format: { type: 'json_object' },
  thinking: { type: 'disabled' }
});
const PROTECTED_ANALYSIS_OPTIONS = new Set([
  'model',
  'temperature',
  'response_format',
  'thinking',
  'tools',
  'tool_choice',
  'enable_search',
  'search_options',
  'web_search_options'
]);

class AIEntityExtractionError extends Error {
  constructor(message, code = 'analysis_entity_output_invalid', details = {}) {
    super(message);
    this.name = 'AIEntityExtractionError';
    this.code = code;
    this.details = details;
  }
}

function extractJsonObject(value) {
  const text = String(value || '').trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last < first) throw new AIEntityExtractionError('实体抽取未返回有效 JSON');
  try {
    return JSON.parse(text.slice(first, last + 1));
  } catch (_) {
    throw new AIEntityExtractionError('实体抽取未返回有效 JSON');
  }
}

function exactKeys(value, expected) {
  const actual = Object.keys(value || {}).sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === [...expected].sort()[index]);
}

function parseEntityOutput(outputText) {
  const parsed = extractJsonObject(outputText);
  if (!parsed || Array.isArray(parsed) || !exactKeys(parsed, ['mentions'])) {
    throw new AIEntityExtractionError('实体抽取顶层结构无效');
  }
  if (!Array.isArray(parsed.mentions)) {
    throw new AIEntityExtractionError('mentions 必须是数组');
  }
  const seen = new Set();
  const mentions = parsed.mentions.map((item, index) => {
    if (!item || Array.isArray(item) || !exactKeys(item, [
      'source_id',
      'surface_form',
      'canonical_name',
      'entity_type'
    ])) {
      throw new AIEntityExtractionError(`mentions[${index}] 结构无效`, undefined, {
        field: `mentions[${index}]`
      });
    }
    const mention = {
      source_id: String(item.source_id || '').trim(),
      surface_form: String(item.surface_form || '').trim(),
      canonical_name: String(item.canonical_name || '').trim(),
      entity_type: String(item.entity_type || '').trim()
    };
    if (!/^L\d{3,}$/u.test(mention.source_id)) {
      throw new AIEntityExtractionError(`mentions[${index}].source_id 无效`, undefined, {
        field: `mentions[${index}].source_id`
      });
    }
    if (!mention.surface_form || mention.surface_form.length > 120 || mention.surface_form.includes('\n')) {
      throw new AIEntityExtractionError(`mentions[${index}].surface_form 无效`, undefined, {
        field: `mentions[${index}].surface_form`
      });
    }
    if (!mention.canonical_name || mention.canonical_name.length > 120) {
      throw new AIEntityExtractionError(`mentions[${index}].canonical_name 无效`, undefined, {
        field: `mentions[${index}].canonical_name`
      });
    }
    if (!ENTITY_TYPES.has(mention.entity_type)) {
      throw new AIEntityExtractionError(`mentions[${index}].entity_type 无效`, undefined, {
        field: `mentions[${index}].entity_type`
      });
    }
    const key = [mention.source_id, mention.surface_form, mention.canonical_name, mention.entity_type].join('\u0000');
    if (seen.has(key)) {
      throw new AIEntityExtractionError(`mentions[${index}] 重复`, undefined, {
        field: `mentions[${index}]`
      });
    }
    seen.add(key);
    return mention;
  });
  return mentions;
}

function isGenericOrganizationMention(mention) {
  const values = [mention?.surface_form, mention?.canonical_name]
    .map((value) => String(value || '').replace(/[\s*_#]/gu, '').trim());
  return values.some((value) => (
    value.length >= 4
    && /^(?:国内|专业|综合|大型|其他|头部|核心|集成|周界|安防|脉冲|电子|振动|激光|电磁).*(?:品牌|巨头|厂商|厂家|提供商|行业|阵营|领域)$/u.test(value)
  ));
}

function filterGenericMentions(mentions) {
  const filtered = mentions.filter((mention) => !isGenericOrganizationMention(mention));
  return { mentions: filtered, dropped: mentions.length - filtered.length };
}

function effectiveRequestOptions(platform) {
  const administratorOptions = platform?.analysis_request_options
    && typeof platform.analysis_request_options === 'object'
    && !Array.isArray(platform.analysis_request_options)
    ? platform.analysis_request_options
    : {};
  const allowedOptions = Object.fromEntries(
    Object.entries(administratorOptions).filter(([key]) => !PROTECTED_ANALYSIS_OPTIONS.has(key))
  );
  return { ...allowedOptions, ...FIXED_REQUEST_OPTIONS };
}

function assertFlashPlatform(platform) {
  if (platform?.code !== 'deepseek' || platform?.default_model !== 'deepseek-v4-flash') {
    throw new AIEntityExtractionError(
      'v5 结构化分析必须使用 deepseek-v4-flash',
      'analysis_model_policy_mismatch',
      {
        platform: String(platform?.code || ''),
        model: String(platform?.default_model || '')
      }
    );
  }
  if (platform.adapter_type !== 'openai_chat_completions') {
    throw new AIEntityExtractionError(
      'v5 结构化分析需要 chat completions JSON mode',
      'analysis_model_policy_mismatch'
    );
  }
}

function buildEntityPrompt(sourceMap) {
  const input = {
    source_map_version: sourceMap?.version,
    segments: Array.isArray(sourceMap?.segments)
      ? sourceMap.segments.map(({ source_id, text }) => ({ source_id, text }))
      : []
  };
  return [
    '<source_answer>',
    JSON.stringify(input),
    '</source_answer>',
    '<task>',
    '只从 source_answer.segments 的 text 中抽取实际出现的品牌、公司和其他具名组织。',
    '不要抽取产品型号、平台名、协议名、设备类别、人物、地点或普通名词。',
    'surface_form 必须逐字复制自对应 source_id 的 text；不得补充、翻译或改写表面词。',
    '同一组织可以因不同表面词或不同 source_id 返回多行；canonical_name 用统一中文或原文标准显示名。',
    '</task>',
    '<output_contract>',
    '只输出一个 JSON 对象，不要输出 Markdown 或解释。',
    '{"mentions":[{"source_id":"L001","surface_form":"原文实体词","canonical_name":"标准显示名","entity_type":"brand|company|other_organization"}]}',
    '没有组织实体时输出 {"mentions":[]}。不得输出其他字段。',
    '</output_contract>'
  ].join('\n');
}

function buildEntityRepairPrompt(basePrompt, error) {
  return [
    basePrompt,
    '<validation_feedback>',
    `error_code=${String(error?.code || 'analysis_entity_output_invalid')}`,
    `field=${String(error?.details?.field || 'mentions')}`,
    '上一份实体抽取未通过程序校验。重新逐行检查 source_answer，只输出能在对应 text 逐字定位的组织实体。',
    '不要复述或猜测上一份无效实体，不要输出问题、目标品牌或任何 source_answer 之外的名称。',
    '</validation_feedback>'
  ].join('\n');
}

function requestDiagnostics(connection, platform, attempt) {
  const usage = connection?.data?.usage || {};
  return {
    stage: 'entity_extract',
    attempt_count: attempt,
    platform: String(platform?.code || ''),
    model: String(platform?.default_model || ''),
    finish_reason: connection?.data?.choices?.[0]?.finish_reason || null,
    output_length: String(connection?.text || '').length,
    usage: {
      prompt_tokens: Number(usage.prompt_tokens) || 0,
      completion_tokens: Number(usage.completion_tokens) || 0,
      total_tokens: Number(usage.total_tokens) || 0
    }
  };
}

function quarantineUngroundedMentions(mentions, sourceMap) {
  const segments = Array.isArray(sourceMap?.segments) ? sourceMap.segments : [];
  const sourceById = new Map(segments.map((segment) => [segment.source_id, segment]));
  const grounded = [];
  const quarantined = [];
  mentions.forEach((mention) => {
    const segment = sourceById.get(mention.source_id);
    if (segment && String(segment.text || '').includes(mention.surface_form)) {
      grounded.push(mention);
    } else {
      // 无法在对应片段精确定位的表面词进入隔离，不得重新定位到其他片段。
      quarantined.push(mention);
    }
  });
  return { mentions: grounded, quarantined };
}

class AIResponseEntityExtractionService {
  constructor(options = {}) {
    this.requestService = options.requestService || AIPlatformRequestService;
    this.configService = options.configService || AIAnalysisConfigService;
  }

  buildPrompt(sourceMap) {
    return buildEntityPrompt(sourceMap);
  }

  getPromptDefinition() {
    return {
      prompt_revision: ENTITY_PROMPT_REVISION,
      template: buildEntityPrompt({
        version: 'answer_source_lines_v1',
        segments: [{ source_id: 'L001', text: '{{待分析回答原文片段}}' }]
      }),
      request_options: { ...FIXED_REQUEST_OPTIONS },
      max_attempts: ENTITY_MAX_ATTEMPTS
    };
  }

  async extract({ answer, sourceMap, validateMentions = null }) {
    if (!String(answer || '').trim() || !Array.isArray(sourceMap?.segments)) {
      throw new AIEntityExtractionError(
        '实体抽取缺少完整回答或 source map',
        'analysis_context_missing'
      );
    }
    const platform = await this.configService.getAnalysisPlatform();
    assertFlashPlatform(platform);
    const basePrompt = buildEntityPrompt(sourceMap);
    let lastError = null;
    for (let attempt = 1; attempt <= ENTITY_MAX_ATTEMPTS; attempt += 1) {
      const prompt = attempt === 1
        ? basePrompt
        : buildEntityRepairPrompt(basePrompt, lastError);
      const connection = await this.requestService.queryConfig(platform, prompt, {
        purpose: 'analysis_entity_extract',
        retryCount: 0,
        requestOptions: effectiveRequestOptions(platform),
        disableWebSearch: true,
        omitTokenLimit: true,
        timeoutSeconds: ANALYSIS_TIMEOUT_SECONDS
      });
      const diagnostics = requestDiagnostics(connection, platform, attempt);
      if (!connection?.success) {
        throw new AIEntityExtractionError(
          connection?.error || '实体抽取请求失败',
          connection?.error_code || 'analysis_api_failed',
          diagnostics
        );
      }
      if (diagnostics.finish_reason === 'length') {
        throw new AIEntityExtractionError(
          '实体抽取输出被截断',
          'analysis_output_truncated',
          diagnostics
        );
      }
      try {
        const parsedMentions = parseEntityOutput(connection.text);
        const filtered = filterGenericMentions(parsedMentions);
        const mentions = filtered.mentions;
        const validated = typeof validateMentions === 'function'
          ? validateMentions(mentions)
          : undefined;
        return {
          mentions,
          ...(validated === undefined ? {} : { validated }),
          diagnostics: {
            ...diagnostics,
            filtered_generic_mentions: filtered.dropped
          }
        };
      } catch (error) {
        lastError = error instanceof AIEntityExtractionError
          ? error
          : new AIEntityExtractionError(
            error?.message || '实体抽取未通过程序校验',
            error?.code || 'analysis_entity_grounding_invalid',
            error?.details || {}
          );
        lastError.details = { ...diagnostics, ...lastError.details };
        if (attempt >= ENTITY_MAX_ATTEMPTS) {
          if (lastError.code !== 'analysis_entity_grounding_invalid') throw lastError;
          const filtered = filterGenericMentions(parseEntityOutput(connection.text));
          const { mentions, quarantined } = quarantineUngroundedMentions(
            filtered.mentions,
            sourceMap
          );
          const validated = typeof validateMentions === 'function'
            ? validateMentions(mentions)
            : undefined;
          return {
            mentions,
            ...(validated === undefined ? {} : { validated }),
            diagnostics: {
              ...diagnostics,
              quarantined_mentions: quarantined.length,
              quarantined_items: quarantined.map((item) => ({
                source_id: String(item?.source_id || ''),
                surface_form: String(item?.surface_form || '')
              })),
              filtered_generic_mentions: filtered.dropped
            }
          };
        }
      }
    }
    throw lastError;
  }
}

module.exports = new AIResponseEntityExtractionService();
module.exports.AIResponseEntityExtractionService = AIResponseEntityExtractionService;
module.exports.AIEntityExtractionError = AIEntityExtractionError;
module.exports.ENTITY_PROMPT_REVISION = ENTITY_PROMPT_REVISION;
module.exports.ENTITY_MAX_ATTEMPTS = ENTITY_MAX_ATTEMPTS;
module.exports.FIXED_REQUEST_OPTIONS = FIXED_REQUEST_OPTIONS;
module.exports.parseEntityOutput = parseEntityOutput;
module.exports.buildEntityPrompt = buildEntityPrompt;
module.exports.assertFlashPlatform = assertFlashPlatform;
module.exports.effectiveRequestOptions = effectiveRequestOptions;
module.exports.ANALYSIS_TIMEOUT_SECONDS = ANALYSIS_TIMEOUT_SECONDS;
module.exports.quarantineUngroundedMentions = quarantineUngroundedMentions;
module.exports.filterGenericMentions = filterGenericMentions;
