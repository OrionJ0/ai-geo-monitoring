const AIPlatformRequestService = require('./AIPlatformRequestService');
const AIAnalysisConfigService = require('./AIAnalysisConfigService');
const {
  ANALYSIS_TIMEOUT_SECONDS,
  assertFlashPlatform,
  effectiveRequestOptions
} = require('./AIResponseEntityExtractionService');

const SEMANTIC_PROMPT_REVISION = 'closed_entity_semantics_v3';
const SEMANTIC_MAX_ATTEMPTS = 2;
const VALID_RELATIONS = new Set(['competitor', 'non_competitor']);
const VALID_SENTIMENTS = new Set(['positive', 'neutral', 'negative']);

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

function buildSemanticPrompt({ question, sourceMap, catalog }) {
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
    segments: sourceMap.segments.map(({ source_id, text }) => ({ source_id, text }))
  };
  return [
    '<semantic_input>',
    JSON.stringify(input),
    '</semantic_input>',
    '<task>',
    '基于 question 的采购或选择场景，只对 entities 中的封闭实体 ID 做语义判断。不得创建或改名实体。',
    'competitor_relations 尽量覆盖能由原文证明的非目标实体；无法确定关系或证据不足的实体可以不返回，禁止猜测补齐。',
    'competitor_relations 严禁返回 target_entity_id 本身；目标品牌不是它自己的竞品。',
    'candidate_groups 按回答真实类别分组；普通并列、表格行序和正文提及顺序不是排名。',
    'recommendations 只记录回答明确建议的实体。所有证据只能引用 segments 中的 source_id。',
    'candidate_groups 的证据应同时引用分组标题和每个成员出现的片段；单成员类别也可以记录。',
    'target_entity_id 为 null 时 sentiment 必须是 not_applicable；存在时才判断 positive、neutral 或 negative。',
    '</task>',
    '<output_contract>',
    '只输出一个 JSON 对象，不要输出 Markdown 或解释。',
    '{"competitor_relations":[{"entity_id":"E001","relation":"competitor|non_competitor","reason":"简短理由","evidence_source_ids":["L001"]}],"candidate_groups":[{"ordered":false,"entries":["E001","E002"],"reason":"简短理由","evidence_source_ids":["L001"]}],"recommendations":[{"entity_id":"E001","kind":"explicit","evidence_source_ids":["L001"]}],"sentiment":{"status":"assessed|not_applicable","label":"positive|neutral|negative|null","reason":"简短理由","evidence_source_ids":["L001"],"risk_terms":[]}}',
    '不得输出 claims、实体名称、提及次数、排名数字、比例、SOV 或其他字段。',
    '</output_contract>'
  ].join('\n');
}

function buildSemanticRepairPrompt(basePrompt, error) {
  return [
    basePrompt,
    '<validation_feedback>',
    `error_code=${String(error?.code || 'analysis_semantic_output_invalid')}`,
    `field=${String(error?.details?.field || 'semantic_output')}`,
    '上一份语义判断未通过程序校验。保持 semantic_input 中的实体目录完全不变，只纠正失败字段后重新输出完整语义 JSON。',
    '不得引用目录之外的实体 ID 或 source ID，不得复述、沿用或猜测上一份无效值。',
    '</validation_feedback>'
  ].join('\n');
}

function validateEvidenceSourceIds({
  value,
  field,
  sourceById,
  requiredEntityIds,
  entityById
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
  requiredEntityIds.forEach((entityId) => {
    const entity = entityById.get(entityId);
    const entitySourceIds = new Set(entity?.mentions?.map((mention) => mention.source_id) || []);
    if (!sourceIds.some((sourceId) => entitySourceIds.has(sourceId))) {
      // 程序不得为模型自动补一条"看起来相关"的原文片段作为证据；
      // 证据缺失时该字段判为无效，由上层标记 unresolved/invalid。
      throw new AISemanticJudgmentError(
        `${field} 没有引用包含实体 ${entityId} 的原文片段`,
        'analysis_evidence_reference_invalid',
        { field }
      );
    }
  });
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
      'entity_id', 'relation', 'reason', 'evidence_source_ids'
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
    const evidenceSourceIds = validateEvidenceSourceIds({
      value: item.evidence_source_ids,
      field: `${field}.evidence_source_ids`,
      sourceById,
      requiredEntityIds: [entityId],
      entityById,
    });
    return {
      entity_id: entityId,
      relation,
      reason: nonEmptyReason(item.reason, `${field}.reason`),
      evidence_source_ids: evidenceSourceIds,
      evidence: evidenceSourceIds.map((sourceId) => sourceById.get(sourceId).text)
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
      'ordered', 'entries', 'reason', 'evidence_source_ids'
    ]) || typeof item.ordered !== 'boolean') {
      throw new AISemanticJudgmentError(`${field} 结构无效`, undefined, { field });
    }
    const entries = stringArray(item.entries, `${field}.entries`);
    if (entries.length < 1 || entries.some((entityId) => !entityById.has(entityId))) {
      throw new AISemanticJudgmentError(`${field}.entries 无效`, undefined, {
        field: `${field}.entries`
      });
    }
    const evidenceSourceIds = validateEvidenceSourceIds({
      value: item.evidence_source_ids,
      field: `${field}.evidence_source_ids`,
      sourceById,
      requiredEntityIds: entries,
      entityById,
    });
    return {
      ordered: item.ordered && entries.length > 1,
      entries,
      reason: nonEmptyReason(item.reason, `${field}.reason`),
      evidence_source_ids: evidenceSourceIds,
      evidence: evidenceSourceIds.map((sourceId) => sourceById.get(sourceId).text)
    };
  });

  if (!Array.isArray(parsed.recommendations)) {
    throw new AISemanticJudgmentError('recommendations 必须是数组', undefined, {
      field: 'recommendations'
    });
  }
  const recommendationIds = new Set();
  const recommendations = parsed.recommendations.map((item, index) => {
    const field = `recommendations[${index}]`;
    if (!item || Array.isArray(item) || !exactKeys(item, [
      'entity_id', 'kind', 'evidence_source_ids'
    ])) {
      throw new AISemanticJudgmentError(`${field} 结构无效`, undefined, { field });
    }
    const entityId = String(item.entity_id || '').trim();
    if (!entityById.has(entityId) || recommendationIds.has(entityId) || item.kind !== 'explicit') {
      throw new AISemanticJudgmentError(`${field} 无效`, undefined, { field });
    }
    recommendationIds.add(entityId);
    const evidenceSourceIds = validateEvidenceSourceIds({
      value: item.evidence_source_ids,
      field: `${field}.evidence_source_ids`,
      sourceById,
      requiredEntityIds: [entityId],
      entityById,
    });
    return {
      entity_id: entityId,
      kind: 'explicit',
      evidence_source_ids: evidenceSourceIds,
      evidence: evidenceSourceIds.map((sourceId) => sourceById.get(sourceId).text)
    };
  });

  const sentiment = parsed.sentiment;
  if (!sentiment || Array.isArray(sentiment) || !exactKeys(sentiment, [
    'status', 'label', 'reason', 'evidence_source_ids', 'risk_terms'
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
      evidence_source_ids: [],
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
    const evidenceSourceIds = validateEvidenceSourceIds({
      value: sentiment.evidence_source_ids,
      field: 'sentiment.evidence_source_ids',
      sourceById,
      requiredEntityIds: [catalog.target_entity_id],
      entityById,
    });
    normalizedSentiment = {
      status: 'assessed',
      label,
      reason: nonEmptyReason(sentiment.reason, 'sentiment.reason'),
      evidence_source_ids: evidenceSourceIds,
      evidence: evidenceSourceIds.map((sourceId) => sourceById.get(sourceId).text),
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
  }

  buildPrompt(input) {
    return buildSemanticPrompt(input);
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
    const basePrompt = buildSemanticPrompt({ question, sourceMap, catalog });
    let lastError = null;
    for (let attempt = 1; attempt <= SEMANTIC_MAX_ATTEMPTS; attempt += 1) {
      const prompt = attempt === 1
        ? basePrompt
        : buildSemanticRepairPrompt(basePrompt, lastError);
      const connection = await this.requestService.queryConfig(platform, prompt, {
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
module.exports.SEMANTIC_MAX_ATTEMPTS = SEMANTIC_MAX_ATTEMPTS;
module.exports.parseSemanticOutput = parseSemanticOutput;
module.exports.buildSemanticPrompt = buildSemanticPrompt;
