const AIPlatformRequestService = require('./AIPlatformRequestService');
const AIAnalysisConfigService = require('./AIAnalysisConfigService');
const {
  ANALYSIS_TIMEOUT_SECONDS,
  assertFlashPlatform,
  effectiveRequestOptions
} = require('./AIResponseEntityExtractionService');

const SEMANTIC_PROMPT_REVISION = 'closed_entity_semantics_v4_evidence_roles';
// 014 最后一轮 A/B 修订版 rev2（2026-08-06 数据所有者裁决，最后一轮、严格限界）：
// 只改情绪规则 + 双字段组合示例；删除 rev1 推荐规则里孤立的"综合性较强"表述
// （rev1 的推荐示例被模型串线到情绪判级，把"不推荐"误解为"情绪中性"）。
// 不改变阶段 1、实体结构、竞品表或确定性目标事实。基线 prompt 保持不变。
const SEMANTIC_PROMPT_REVISION_REV2 = 'closed_entity_semantics_v4_evidence_roles_rev2';
const SEMANTIC_MAX_ATTEMPTS = 2;
const VALID_RELATIONS = new Set(['competitor', 'non_competitor']);
const VALID_SENTIMENTS = new Set(['positive', 'neutral', 'negative']);

/**
 * 阶段 2 规则行（按 revision 选择；revision 非 'rev2' 时与基线逐字一致）。
 * rev2 规则（S12 证据）：
 * 1. 推荐必须有明确选择、推荐、优先或行动语义；对比、列举不算推荐（不点名"综合性较强"，避免串线）。
 * 2. 情绪判断对象是回答对品牌的描述方式，不看问题是否询问情绪；
 *    推荐与情绪是两个独立判断维度：未推荐、未表达购买偏好，不等于中性评价；
 *    "综合性较强""能力突出""覆盖完整""稳定成熟"等肯定能力或优势的描述应判为 positive，
 *    即使 recommendation=false；只有纯粹陈述存在、功能、规格或名单且没有价值判断时才判 neutral。
 * 3. （repair prompt 内）明确写出 target_entity_id；非空目标不得返回 sentiment=not_applicable。
 */
function semanticRules(revision) {
  const recommendationRules = revision === 'rev2'
    ? [
        'recommendations 只记录回答对实体有明确选择、推荐、优先或行动语义的实体；',
        '仅对比优劣、并列列举不算推荐，不得写入 recommendations。',
        '正例："建议优先考虑"、"推荐选择"、"首选 X"、"X 更适合本项目"；反例："两者各有优劣"、"你的选择应取决于具体需求"。'
      ]
    : ['recommendations 只记录回答明确建议的实体。'];
  const sentimentRules = revision === 'rev2'
    ? [
        'target_entity_id 为 null 时 sentiment 必须是 not_applicable；目标出现时无论 question 是否询问情绪，',
        '都必须按回答对目标品牌的描述判断 positive、neutral 或 negative。',
        '推荐与情绪是两个相互独立的判断维度：未推荐、未表达购买偏好，不等于中性评价。',
        '"综合性较强"、"能力突出"、"覆盖完整"、"稳定成熟"等肯定能力或优势的描述，应判为 positive，即使 recommendation=false。',
        '只有纯粹陈述存在、功能、规格或名单，且没有价值判断时，才判为 neutral。',
        '组合示例：{"text": "Goodie AI 综合性较强，但应根据具体需求选择", "recommendation": false, "sentiment": "positive"}'
      ]
    : ['target_entity_id 为 null 时 sentiment 必须是 not_applicable；存在时才判断 positive、neutral 或 negative。'];
  return { recommendationRules, sentimentRules };
}

class AISemanticJudgmentError extends Error {
  constructor(message, code = 'analysis_semantic_output_invalid', details = {}) {
    super(message);
    this.name = 'AISemanticJudgmentError';
    this.code = code;
    this.details = details;
  }
}

function extractJsonObject(value) {
  const text = String(value || '').trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last < first) throw new AISemanticJudgmentError('语义判断未返回有效 JSON');
  try {
    return JSON.parse(text.slice(first, last + 1));
  } catch (_) {
    throw new AISemanticJudgmentError('语义判断未返回有效 JSON');
  }
}

function exactKeys(value, expected) {
  const actual = Object.keys(value || {}).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function nonEmptyReason(value, field) {
  const reason = String(value || '').trim();
  if (!reason || reason.length > 300) {
    throw new AISemanticJudgmentError(`${field} 无效`, undefined, { field });
  }
  return reason;
}

function stringArray(value, field, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new AISemanticJudgmentError(`${field} 必须是${allowEmpty ? '' : '非空'}数组`, undefined, { field });
  }
  const normalized = value.map((item) => String(item || '').trim());
  if (normalized.some((item) => !item) || new Set(normalized).size !== normalized.length) {
    throw new AISemanticJudgmentError(`${field} 包含空值或重复值`, undefined, { field });
  }
  return normalized;
}

function buildSemanticPrompt({ question, sourceMap, catalog, revision = null }) {
  const input = {
    question: String(question || '').trim(),
    target_entity_id: catalog.target_entity_id,
    entities: catalog.entities.map((entity) => ({
      entity_id: entity.entity_id,
      name: entity.name,
      type: entity.type,
      surface_forms: entity.surface_forms,
      source_ids: [...new Set(entity.mentions.map((mention) => mention.source_id))]
    })),
    // 空行无语义内容：不发模型，避免模型把空行当作语义上下文引用
    segments: (sourceMap.segments || [])
      .filter(({ text }) => String(text || '').trim().length > 0)
      .map(({ source_id, text }) => ({ source_id, text }))
  };
  const rules = semanticRules(revision);
  return [
    '<semantic_input>',
    JSON.stringify(input),
    '</semantic_input>',
    '<task>',
    '基于 question 的采购或选择场景，只对 entities 中的封闭实体 ID 做语义判断。不得创建或改名实体。',
    'competitor_relations 尽量覆盖能由原文证明的非目标实体；无法确定关系或证据不足的实体可以不返回，禁止猜测补齐。',
    'competitor_relations 严禁返回 target_entity_id 本身；目标品牌不是它自己的竞品。',
    'candidate_groups 按回答真实类别分组；普通并列、表格行序和正文提及顺序不是排名。',
    ...rules.recommendationRules,
    'semantic_context_source_ids 必须引用真正支持该语义结论的原文片段；它可以与实体出现的片段不同，因为回答常先列举实体、后在其他片段用简称、集合或顺序表达推荐、关系或情绪。',
    '不要只为满足存在性而引用实体列举行；如果某片段确实包含判断词或推荐、分组、比较的语义，才可引用。',
    ...rules.sentimentRules,
    '</task>',
    '<output_contract>',
    '只输出一个 JSON 对象，不要输出 Markdown 或解释。',
    '{"competitor_relations":[{"entity_id":"E001","relation":"competitor|non_competitor","reason":"简短理由","semantic_context_source_ids":["L001"]}],"candidate_groups":[{"ordered":false,"entries":["E001","E002"],"reason":"简短理由","semantic_context_source_ids":["L001"]}],"recommendations":[{"entity_id":"E001","kind":"explicit","semantic_context_source_ids":["L001"]}],"sentiment":{"status":"assessed|not_applicable","label":"positive|neutral|negative|null","reason":"简短理由","semantic_context_source_ids":["L001"],"risk_terms":[]}}',
    '不得输出 claims、实体名称、提及次数、排名数字、比例、SOV 或其他字段。',
    '</output_contract>'
  ].join('\n');
}

function buildSemanticRepairPrompt(basePrompt, error, { sourceMap, catalog, revision = null }) {
  const occurrenceByEntity = new Map((Array.isArray(catalog?.entities) ? catalog.entities : []).map((entity) => [
    entity.entity_id,
    [...new Set((entity.mentions || []).map((mention) => mention.source_id))]
  ]));
  const sourceMapSummary = (Array.isArray(sourceMap?.segments) ? sourceMap.segments : [])
    .filter(({ text }) => String(text || '').trim().length > 0)
    .map(({ source_id, text }) => `${source_id}: ${text}`)
    .join('\n');
  const occurrenceSummary = [...occurrenceByEntity.entries()]
    .map(([entityId, sourceIds]) => `${entityId}: ${sourceIds.join(', ')}`)
    .join('\n');
  const targetIdLine = revision === 'rev2'
    ? `target_entity_id=${catalog?.target_entity_id ?? 'null'}（非 null 时必须输出 assessed 情绪，label 为 positive/neutral/negative，不得返回 sentiment=not_applicable）`
    : null;
  return [
    basePrompt,
    '<validation_feedback>',
    `error_code=${String(error?.code || 'analysis_semantic_output_invalid')}`,
    `field=${String(error?.details?.field || 'semantic_output')}`,
    `message=${String(error?.message || '语义判断未通过程序校验').slice(0, 300)}`,
    '上一份语义判断未通过程序校验。保持 semantic_input 中的实体目录完全不变，只纠正失败字段后重新输出完整语义 JSON。',
    ...(targetIdLine ? [targetIdLine] : []),
    '只能引用下面 source map 中存在的 source_id。semantic_context_source_ids 必须引用真正支持该断言结论的原文片段，不要只为满足存在性而引用实体列举行。',
    '<source_map>',
    sourceMapSummary,
    '</source_map>',
    '<entity_occurrence_ids>',
    occurrenceSummary,
    '</entity_occurrence_ids>',
    'entity_occurrence_ids 只是实体在原文出现的确定性证据，不等于语义上下文。不得创建或改名实体，不得复述、沿用或猜测上一份无效值。',
    '</validation_feedback>'
  ].join('\n');
}

function validateSemanticContextSourceIds({
  value,
  field,
  sourceById
}) {
  const sourceIds = stringArray(value, field);
  sourceIds.forEach((sourceId) => {
    if (!sourceById.has(sourceId)) {
      throw new AISemanticJudgmentError(
        `${field} 引用未知 source_id`,
        'analysis_evidence_reference_invalid',
        { field }
      );
    }
  });
  // semantic_evidence_v2：不要求语义片段重复实体 occurrence，也不做固定指示词
  // 表判断——真实回答的语义表达（短名、场景词、集合表达）无法由机械词表覆盖，
  // 机械词表正是 009 阶段 2 高降级的根因之一。语义是否真正支持结论由人工真值
  // 评测约束；程序只拒绝引用无任何内容的空片段，且不得自动补写语义上下文。
  const texts = sourceIds.map((sourceId) => sourceById.get(sourceId).text);
  if (texts.every((text) => !String(text || '').trim())) {
    throw new AISemanticJudgmentError(
      `${field} 引用了无内容的原文片段`,
      'analysis_evidence_reference_invalid',
      { field }
    );
  }
  return sourceIds;
}

function parseSemanticOutput(outputText, { sourceMap, catalog }) {
  const parsed = extractJsonObject(outputText);
  if (!parsed || Array.isArray(parsed) || !exactKeys(parsed, [
    'competitor_relations',
    'candidate_groups',
    'recommendations',
    'sentiment'
  ])) {
    throw new AISemanticJudgmentError('语义判断顶层结构无效');
  }
  const sourceById = new Map(sourceMap.segments.map((segment) => [segment.source_id, segment]));
  const entityById = new Map(catalog.entities.map((entity) => [entity.entity_id, entity]));
  const expectedRelationIds = catalog.entities
    .map((entity) => entity.entity_id)
    .filter((entityId) => entityId !== catalog.target_entity_id)
    .sort();

  if (!Array.isArray(parsed.competitor_relations)) {
    throw new AISemanticJudgmentError(
      'competitor_relations 必须是数组',
      'analysis_relation_incomplete',
      { field: 'competitor_relations' }
    );
  }
  const relationItems = parsed.competitor_relations.filter((item) => (
    String(item?.entity_id || '').trim() !== catalog.target_entity_id
  ));
  const competitorRelations = relationItems.map((item, index) => {
    const field = `competitor_relations[${index}]`;
    if (!item || Array.isArray(item) || !exactKeys(item, [
      'entity_id', 'relation', 'reason', 'semantic_context_source_ids'
    ])) {
      throw new AISemanticJudgmentError(`${field} 结构无效`, 'analysis_relation_incomplete', { field });
    }
    const entityId = String(item.entity_id || '').trim();
    if (!entityById.has(entityId) || entityId === catalog.target_entity_id) {
      throw new AISemanticJudgmentError(`${field}.entity_id 无效`, 'analysis_relation_incomplete', {
        field: `${field}.entity_id`
      });
    }
    const relation = String(item.relation || '').trim();
    if (!VALID_RELATIONS.has(relation)) {
      throw new AISemanticJudgmentError(`${field}.relation 无效`, undefined, {
        field: `${field}.relation`
      });
    }
    const semanticContextSourceIds = validateSemanticContextSourceIds({
      value: item.semantic_context_source_ids,
      field: `${field}.semantic_context_source_ids`,
      sourceById,
      requiredEntityIds: [entityId],
      entityById,
    });
    return {
      entity_id: entityId,
      relation,
      reason: nonEmptyReason(item.reason, `${field}.reason`),
      semantic_context_source_ids: semanticContextSourceIds,
      evidence: semanticContextSourceIds.map((sourceId) => sourceById.get(sourceId).text)
    };
  });
  const actualRelationIds = competitorRelations.map((item) => item.entity_id).sort();
  const uniqueRelationIds = new Set(actualRelationIds);
  if (uniqueRelationIds.size !== actualRelationIds.length) {
    throw new AISemanticJudgmentError(
      '竞品关系包含重复实体',
      'analysis_relation_incomplete',
      { field: 'competitor_relations' }
    );
  }
  const unresolvedEntityIds = expectedRelationIds.filter(
    (entityId) => !uniqueRelationIds.has(entityId)
  );

  if (!Array.isArray(parsed.candidate_groups)) {
    throw new AISemanticJudgmentError('candidate_groups 必须是数组', undefined, {
      field: 'candidate_groups'
    });
  }
  const candidateGroups = parsed.candidate_groups.map((item, index) => {
    const field = `candidate_groups[${index}]`;
    if (!item || Array.isArray(item) || !exactKeys(item, [
      'ordered', 'entries', 'reason', 'semantic_context_source_ids'
    ]) || typeof item.ordered !== 'boolean') {
      throw new AISemanticJudgmentError(`${field} 结构无效`, undefined, { field });
    }
    const entries = stringArray(item.entries, `${field}.entries`);
    if (entries.length < 1 || entries.some((entityId) => !entityById.has(entityId))) {
      throw new AISemanticJudgmentError(`${field}.entries 无效`, undefined, {
        field: `${field}.entries`
      });
    }
    const semanticContextSourceIds = validateSemanticContextSourceIds({
      value: item.semantic_context_source_ids,
      field: `${field}.semantic_context_source_ids`,
      sourceById,
      requiredEntityIds: entries,
      entityById,
    });
    return {
      ordered: item.ordered && entries.length > 1,
      entries,
      reason: nonEmptyReason(item.reason, `${field}.reason`),
      semantic_context_source_ids: semanticContextSourceIds,
      evidence: semanticContextSourceIds.map((sourceId) => sourceById.get(sourceId).text)
    };
  });

  if (!Array.isArray(parsed.recommendations)) {
    throw new AISemanticJudgmentError('recommendations 必须是数组', undefined, {
      field: 'recommendations'
    });
  }
  // 同一实体可能在多个上下文片段中被明确推荐（如第一梯队与综合推荐各一次）。
  // 真实 Flash 会为此输出多条同实体推荐；程序确定性合并上下文并去重，
  // 不重复输出、不补写模型未给出的上下文。
  const recommendations = [];
  const recommendationIds = new Set();
  parsed.recommendations.forEach((item, index) => {
    const field = `recommendations[${index}]`;
    if (!item || Array.isArray(item) || !exactKeys(item, [
      'entity_id', 'kind', 'semantic_context_source_ids'
    ])) {
      throw new AISemanticJudgmentError(`${field} 结构无效`, undefined, { field });
    }
    const entityId = String(item.entity_id || '').trim();
    if (!entityById.has(entityId) || item.kind !== 'explicit') {
      throw new AISemanticJudgmentError(`${field} 无效`, undefined, { field });
    }
    const semanticContextSourceIds = validateSemanticContextSourceIds({
      value: item.semantic_context_source_ids,
      field: `${field}.semantic_context_source_ids`,
      sourceById,
      requiredEntityIds: [entityId],
      entityById,
    });
    if (recommendationIds.has(entityId)) {
      const existing = recommendations.find((recommendation) => recommendation.entity_id === entityId);
      existing.semantic_context_source_ids = [...new Set([
        ...existing.semantic_context_source_ids,
        ...semanticContextSourceIds
      ])];
      existing.evidence = existing.semantic_context_source_ids
        .map((sourceId) => sourceById.get(sourceId).text);
      return;
    }
    recommendationIds.add(entityId);
    recommendations.push({
      entity_id: entityId,
      kind: 'explicit',
      semantic_context_source_ids: semanticContextSourceIds,
      evidence: semanticContextSourceIds.map((sourceId) => sourceById.get(sourceId).text)
    });
  });

  const sentiment = parsed.sentiment;
  if (!sentiment || Array.isArray(sentiment) || !exactKeys(sentiment, [
    'status', 'label', 'reason', 'semantic_context_source_ids', 'risk_terms'
  ])) {
    throw new AISemanticJudgmentError('sentiment 结构无效', undefined, { field: 'sentiment' });
  }
  const sentimentStatus = String(sentiment.status || '').trim();
  const riskTerms = stringArray(sentiment.risk_terms, 'sentiment.risk_terms', { allowEmpty: true });
  let normalizedSentiment;
  if (catalog.target_entity_id === null) {
    normalizedSentiment = {
      status: 'not_applicable',
      label: null,
      reason: '目标实体未在回答中出现，情绪不适用。',
      semantic_context_source_ids: [],
      evidence: [],
      risk_terms: riskTerms
    };
  } else {
    const label = String(sentiment.label || '').trim();
    if (sentimentStatus !== 'assessed' || !VALID_SENTIMENTS.has(label)) {
      throw new AISemanticJudgmentError('目标出现时 sentiment 状态或标签无效', undefined, {
        field: 'sentiment'
      });
    }
    const semanticContextSourceIds = validateSemanticContextSourceIds({
      value: sentiment.semantic_context_source_ids,
      field: 'sentiment.semantic_context_source_ids',
      sourceById,
      requiredEntityIds: [catalog.target_entity_id],
      entityById,
    });
    normalizedSentiment = {
      status: 'assessed',
      label,
      reason: nonEmptyReason(sentiment.reason, 'sentiment.reason'),
      semantic_context_source_ids: semanticContextSourceIds,
      evidence: semanticContextSourceIds.map((sourceId) => sourceById.get(sourceId).text),
      risk_terms: riskTerms
    };
  }

  return {
    competitor_relations: competitorRelations,
    unresolved_entity_ids: unresolvedEntityIds,
    candidate_groups: candidateGroups,
    recommendations,
    sentiment: normalizedSentiment
  };
}

function requestDiagnostics(connection, platform, attempt) {
  const usage = connection?.data?.usage || {};
  return {
    stage: 'semantic_judge',
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

class AIResponseSemanticJudgmentService {
  constructor(options = {}) {
    this.requestService = options.requestService || AIPlatformRequestService;
    this.configService = options.configService || AIAnalysisConfigService;
    this.promptRevision = options.promptRevision || null;
  }

  buildPrompt(input) {
    return buildSemanticPrompt({ ...input, revision: this.promptRevision });
  }

  async judge({ question, sourceMap, catalog }) {
    if (!String(question || '').trim() || !Array.isArray(sourceMap?.segments) || !Array.isArray(catalog?.entities)) {
      throw new AISemanticJudgmentError(
        '语义判断缺少问题、source map 或实体目录',
        'analysis_context_missing'
      );
    }
    const platform = await this.configService.getAnalysisPlatform();
    try {
      assertFlashPlatform(platform);
    } catch (error) {
      throw new AISemanticJudgmentError(error.message, error.code, error.details);
    }
    const basePrompt = buildSemanticPrompt({ question, sourceMap, catalog, revision: this.promptRevision });
    let lastError = null;
    for (let attempt = 1; attempt <= SEMANTIC_MAX_ATTEMPTS; attempt += 1) {
      const prompt = attempt === 1
        ? basePrompt
        : buildSemanticRepairPrompt(basePrompt, lastError, { sourceMap, catalog, revision: this.promptRevision });
      const connection = await this.requestService.queryConfig(platform, prompt, {
        purpose: 'analysis_semantic_judge',
        retryCount: 0,
        requestOptions: effectiveRequestOptions(platform),
        disableWebSearch: true,
        omitTokenLimit: true,
        timeoutSeconds: ANALYSIS_TIMEOUT_SECONDS
      });
      const diagnostics = requestDiagnostics(connection, platform, attempt);
      if (!connection?.success) {
        throw new AISemanticJudgmentError(
          connection?.error || '语义判断请求失败',
          connection?.error_code || 'analysis_api_failed',
          diagnostics
        );
      }
      if (diagnostics.finish_reason === 'length') {
        throw new AISemanticJudgmentError(
          '语义判断输出被截断',
          'analysis_output_truncated',
          diagnostics
        );
      }
      try {
        return {
          structured: parseSemanticOutput(connection.text, { sourceMap, catalog }),
          diagnostics
        };
      } catch (error) {
        lastError = error instanceof AISemanticJudgmentError
          ? error
          : new AISemanticJudgmentError(error?.message || '语义判断校验失败');
        lastError.details = { ...diagnostics, ...lastError.details };
        if (attempt >= SEMANTIC_MAX_ATTEMPTS) throw lastError;
      }
    }
    throw lastError;
  }
}

module.exports = new AIResponseSemanticJudgmentService();
module.exports.AIResponseSemanticJudgmentService = AIResponseSemanticJudgmentService;
module.exports.AISemanticJudgmentError = AISemanticJudgmentError;
module.exports.SEMANTIC_PROMPT_REVISION = SEMANTIC_PROMPT_REVISION;
module.exports.SEMANTIC_PROMPT_REVISION_REV2 = SEMANTIC_PROMPT_REVISION_REV2;
module.exports.SEMANTIC_MAX_ATTEMPTS = SEMANTIC_MAX_ATTEMPTS;
module.exports.parseSemanticOutput = parseSemanticOutput;
module.exports.buildSemanticPrompt = buildSemanticPrompt;
