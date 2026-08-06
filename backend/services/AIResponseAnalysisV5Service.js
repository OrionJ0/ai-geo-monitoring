const AIResponseEntityExtractionService = require('./AIResponseEntityExtractionService');
const AIResponseSemanticJudgmentService = require('./AIResponseSemanticJudgmentService');
const { createSourceMap, SOURCE_MAP_VERSION } = require('./AIAnalysisSourceMapService');
const { buildEntityCatalog, buildTargetMentions } = require('./AIEntityCatalogService');
const { ENTITY_PROMPT_REVISION } = require('./AIResponseEntityExtractionService');
const { SEMANTIC_PROMPT_REVISION } = require('./AIResponseSemanticJudgmentService');
const { SCOPED_METRIC_SEMANTICS } = require('./GeoMetricSemanticsService');
const {
  buildRegistrySnapshot,
  withRegistryMatches
} = require('./AICompetitorRegistryResolverService');

const ANALYSIS_METHOD = 'ai_structured_v5';
const STRUCTURE_VERSION = 'geo_metric_input_v5';
const CONTRACT_REVISION = 'three_track_partial_v2';

class AIResponseAnalysisV5Error extends Error {
  constructor(message, code = 'invalid_analysis_output', details = {}) {
    super(message);
    this.name = 'AIResponseAnalysisV5Error';
    this.code = code;
    this.details = details;
  }
}

function targetBrandInput(brand = {}) {
  const aliases = [
    ...(Array.isArray(brand.aliases) ? brand.aliases : []),
    ...(Array.isArray(brand.brand_aliases) ? brand.brand_aliases : [])
  ];
  return {
    name: String(brand.name || '').trim(),
    aliases: [...new Set(aliases.map((value) => String(value || '').trim()).filter(Boolean))]
  };
}

function totalAttempts(stages) {
  return stages.reduce((total, stage) => total + Math.max(0, Number(stage?.attempt_count) || 0), 0);
}

function combinedUsage(stages) {
  return stages.reduce((usage, stage) => {
    ['prompt_tokens', 'completion_tokens', 'total_tokens'].forEach((field) => {
      usage[field] += Math.max(0, Number(stage?.usage?.[field]) || 0);
    });
    return usage;
  }, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
}

const RECOMMENDATION_CUE = /(?:首选|推荐|建议|选择|考虑|考察|联系|值得|优先|可选|备选|关注|专业厂家|最突出|黄金方案|采购参考)/u;
const ENTITY_GROUP_CUE = /(?:品牌|厂家|厂商|企业)/u;

// semantic_evidence_v2：语义断言的最终证据包由程序投影的 occurrence 证据与
// 模型返回的 semantic context 组成。读取时优先取 v2 字段，兼容 v1 单数组。
function semanticContextOf(item) {
  return item?.semantic_context_source_ids || item?.evidence_source_ids || [];
}

function occurrenceSourceIds(entity) {
  return [...new Set((entity?.mentions || []).map((mention) => mention.source_id))];
}

// 竞品提及按真实 occurrence 计数（与目标事实轨一致）；
// 同一片段出现两次只算一次的旧行为会扭曲 SOV 分母。
function mentionCount(entity) {
  return Array.isArray(entity?.mentions) ? entity.mentions.length : 0;
}

function sourceLineNumber(sourceId) {
  const match = String(sourceId || '').match(/^L(\d+)$/u);
  return match ? Number(match[1]) : null;
}

function hasTargetSurface(text, targetEntity) {
  return Boolean(targetEntity?.surface_forms?.some(
    (surfaceForm) => String(text || '').includes(surfaceForm)
  ));
}

function isGroundedTargetRecommendation(recommendation, targetEntity) {
  if (!recommendation || !targetEntity) return false;
  // semantic_evidence_v2：推荐以封闭 entity_id 引用目标，semantic context 由模型
  // 提供并通过阶段 2 校验，程序不再要求推荐片段重复目标表面词。
  if (Array.isArray(recommendation.semantic_context_source_ids)
    && recommendation.semantic_context_source_ids.length > 0) {
    return true;
  }
  // 历史 v1 风格输入兼容：保留文本启发式
  const evidence = semanticContextOf(recommendation).map((sourceId, index) => ({
    source_id: sourceId,
    line: sourceLineNumber(sourceId),
    text: String(recommendation.evidence?.[index] || '')
  }));
  if (evidence.some((item) => (
    RECOMMENDATION_CUE.test(item.text) && hasTargetSurface(item.text, targetEntity)
  ))) return true;

  const targetLines = evidence.filter((item) => hasTargetSurface(item.text, targetEntity));
  const groupCueLines = evidence.filter((item) => (
    RECOMMENDATION_CUE.test(item.text) && ENTITY_GROUP_CUE.test(item.text)
  ));
  return groupCueLines.some((cue) => targetLines.some((target) => (
    cue.line !== null && target.line !== null && Math.abs(cue.line - target.line) <= 1
  )));
}

// 明确排序声明：数字编号、表格顺序、梯队内顺序不构成排名（AI 真值裁决规则），
// 只有"排名第X / 第X名 / 首选 / 优先推荐"等明确排序表达才产生排名。
const EXPLICIT_RANK_RE = /(?:排名第?\s*(\d+)|第\s*(\d+)\s*名|位列第?\s*(\d+)|排行第?\s*(\d+)|首选|第一优先|优先推荐)/u;

function targetRank({ sourceMap, targetEntity, semantic, targetEntityId, entities = [] }) {
  const sourceById = new Map(sourceMap.segments.map((segment) => [segment.source_id, segment.text]));
  const targetSurfaces = [targetEntity?.name, ...(Array.isArray(targetEntity?.surface_forms) ? targetEntity.surface_forms : [])]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const otherSurfaces = (Array.isArray(entities) ? entities : [])
    .filter((entity) => entity?.entity_id !== targetEntityId)
    .flatMap((entity) => [entity?.name, ...(Array.isArray(entity?.surface_forms) ? entity.surface_forms : [])])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  for (const group of semantic.candidate_groups) {
    if (!group.entries.includes(targetEntityId) || group.entries.length < 2) continue;
    const contextTexts = semanticContextOf(group)
      .map((sourceId) => sourceById.get(sourceId) || '');
    const explicitRank = explicitRankForTarget(contextTexts, targetSurfaces, otherSurfaces);
    if (explicitRank !== null) return explicitRank;
    if (group.ordered) return group.entries.indexOf(targetEntityId) + 1;
  }
  return null;
}

// 第三轮 P1：排序表达必须与目标相关，才能把目标赋为该排名。
// "首选海康威视，广拓备选"这类"排序词修饰的是其他品牌"的文本，不得让目标
// 拿到 rank=1——此前只要语义上下文出现"首选"就给组内目标 rank=1。
// - 首选型（首选/第一优先/优先推荐，无数字）：目标名必须紧邻排序词
//   （前或后，允许"是/为/："等连接词），否则该排序与目标无关
// - 数字型（排名第X/第X名/位列/排行）：排序表达直接修饰目标 -> 返回该名次；
//   修饰的是其他实体 -> 该名次不属于目标；无修饰对象（独立声明如
//   "综合排名第2名"）-> 组内目标获得该名次
function explicitRankForTarget(contextTexts, targetSurfaces, otherSurfaces) {
  if (!targetSurfaces.length) return null;
  for (const text of contextTexts) {
    let offset = 0;
    while (offset < text.length) {
      const match = EXPLICIT_RANK_RE.exec(text.slice(offset));
      if (!match) break;
      const matchStart = offset + match.index;
      const matchEnd = matchStart + match[0].length;
      // 数字型匹配才有捕获组；首选型（首选/第一优先/优先推荐）digits 为空，
      // 必须保持 null——Number(undefined) 是 NaN，会误入数字分支返回 NaN
      const digits = match[1] || match[2] || match[3] || match[4];
      const rankNumber = digits ? Number(digits) : null;
      const before = text.slice(Math.max(0, matchStart - 12), matchStart);
      const after = text.slice(matchEnd, Math.min(text.length, matchEnd + 12));
      const leadingConnector = /^(?:的|是|为|：|:)*/u.exec(after)[0];
      const trailingConnector = /(?:的|是|为|：|:)*$/u.exec(before)[0];
      const targetAfter = after.slice(leadingConnector.length);
      const targetBefore = before.slice(0, before.length - trailingConnector.length);
      const mentionsTarget = targetSurfaces.some((surface) => (
        targetAfter.startsWith(surface) || targetBefore.endsWith(surface)
      ));
      if (mentionsTarget) return rankNumber || 1;
      if (rankNumber !== null) {
        const mentionsOther = (otherSurfaces || []).some((surface) => (
          targetAfter.startsWith(surface) || targetBefore.endsWith(surface)
        ));
        if (!mentionsOther) return rankNumber;
      }
      offset = matchEnd;
    }
  }
  return null;
}

function calculate({
  sourceMap,
  catalog,
  semantic,
  diagnostics,
  registrySnapshot = null,
  quarantinedItems = []
}) {
  const entityById = new Map(catalog.entities.map((entity) => [entity.entity_id, entity]));
  const targetEntity = catalog.target_entity_id
    ? entityById.get(catalog.target_entity_id) || null
    : null;
  const relationById = new Map(
    semantic.competitor_relations.map((relation) => [relation.entity_id, relation])
  );
  const unresolvedEntityIds = catalog.entities
    .map((entity) => entity.entity_id)
    .filter((entityId) => (
      entityId !== catalog.target_entity_id && !relationById.has(entityId)
    ));
  const competitionEntities = catalog.entities
    .filter((entity) => (
      entity.entity_id !== catalog.target_entity_id && relationById.has(entity.entity_id)
    ))
    .map((entity) => {
      const relation = relationById.get(entity.entity_id);
      const semanticSourceIds = semanticContextOf(relation);
      return {
        entity_id: entity.entity_id,
        name: entity.name,
        relation: relation.relation,
        reason: relation.reason,
        semantic_context_source_ids: semanticSourceIds,
        entity_occurrence_source_ids: occurrenceSourceIds(entity),
        evidence_source_ids: semanticSourceIds,
        evidence: relation.evidence,
        mentions: mentionCount(entity),
        surface_forms: entity.surface_forms
      };
    });
  const targetMentions = Array.isArray(catalog.target_mentions)
    ? catalog.target_mentions.length
    : mentionCount(targetEntity);
  // 目标是否出现由确定性 target_mentions 扫描决定，不依赖开放实体召回
  const brandMentioned = Array.isArray(catalog.target_mentions)
    ? catalog.target_mentions.length > 0
    : Boolean(targetEntity);
  const competitorMentions = competitionEntities
    .filter((entity) => entity.relation === 'competitor')
    .reduce((total, entity) => total + entity.mentions, 0);
  const denominator = targetMentions + competitorMentions;
  const sovValue = denominator > 0
    ? Number(((targetMentions / denominator) * 100).toFixed(2))
    : null;
  const calculatedTargetRank = targetRank({
    sourceMap,
    targetEntity,
    semantic,
    targetEntityId: catalog.target_entity_id,
    entities: catalog.entities
  });
  const targetRecommendation = semantic.recommendations.find(
    (recommendation) => recommendation.entity_id === catalog.target_entity_id
  );
  const targetRecommended = isGroundedTargetRecommendation(targetRecommendation, targetEntity);
  // 程序不得覆盖模型语义判断：情绪标签只来自阶段 2 的 assessed 结果，
  // 目标未出现时使用 neutral 兼容占位（真实状态见 analysis_structure.sentiment.status）。
  const sentimentLabel = semantic.sentiment.status === 'assessed'
    ? semantic.sentiment.label
    : 'neutral';

  // ---- 三轨字段级状态派生 ----
  // target_mapping 与 target_fact 独立：映射歧义只关闭需要唯一实体 ID 的目标语义，
  // 目标 presence/count 由确定性 target_mentions 扫描决定，不清空、不失败。
  const mappingStatus = catalog.target_mapping?.status
    || (catalog.target_entity_id ? 'resolved' : 'not_applicable');
  const mappingAmbiguous = mappingStatus === 'ambiguous';
  const semanticAvailable = !semantic?.degraded;
  const targetAppears = brandMentioned;
  // 映射歧义（多个实体命中）或阶段 1 失败（无实体可映射）都使目标语义 unavailable
  const semanticsUnavailable = targetAppears
    && (mappingAmbiguous || mappingStatus === 'unavailable');
  const recommendationField = !targetAppears
    ? { status: 'not_applicable', value: null }
    : (semanticsUnavailable
      ? { status: 'unavailable', value: null }
      : (semanticAvailable
        ? { status: 'assessed', value: targetRecommended }
        : { status: 'unresolved', value: null }));
  const rankField = !targetAppears
    ? { status: 'not_applicable', value: null }
    : (semanticsUnavailable
      ? { status: 'unavailable', value: null }
      : (semanticAvailable
        ? { status: 'assessed', value: calculatedTargetRank }
        : { status: 'unresolved', value: null }));
  const sentimentField = !targetAppears
    ? { status: 'not_applicable', value: null }
    : (semanticsUnavailable
      ? { status: 'unavailable', value: null }
      : (semanticAvailable
        ? (semantic.sentiment.status === 'assessed'
          ? { status: 'assessed', value: semantic.sentiment.label }
          : { status: 'unresolved', value: null })
        : { status: 'unresolved', value: null }));
  const semanticsFieldStatuses = [
    recommendationField.status,
    rankField.status,
    sentimentField.status
  ];
  const targetSemanticsStatus = !targetAppears
    ? 'complete'
    : (semanticsUnavailable
      ? 'unavailable'
      : (semanticsFieldStatuses.every((status) => (
        status === 'assessed' || status === 'not_applicable'
      ))
        ? 'complete'
        : 'partial'));
  const competitionStatus = !semanticAvailable
    ? 'unavailable'
    : (unresolvedEntityIds.length || quarantinedItems.length ? 'partial' : 'complete');
  const relationEvidenceSourceIds = (Array.isArray(semantic.competitor_relations)
    ? semantic.competitor_relations
    : []).flatMap((relation) => semanticContextOf(relation));
  const relationEntities = (Array.isArray(semantic.competitor_relations)
    ? semantic.competitor_relations
    : []).map((relation) => relation.entity_id);

  const targetFact = {
    status: mappingStatus === 'invalid_input' ? 'invalid_input' : 'complete',
    brand_mentioned: brandMentioned,
    brand_mentions: targetMentions,
    mentions: catalog.target_mentions || []
  };
  const targetSemantics = {
    status: targetSemanticsStatus,
    recommendation: {
      status: recommendationField.status,
      value: recommendationField.value,
      evidence: targetRecommended && targetRecommendation
        ? {
            entity_occurrence_source_ids: occurrenceSourceIds(targetEntity),
            semantic_context_source_ids: semanticContextOf(targetRecommendation)
          }
        : { entity_occurrence_source_ids: [], semantic_context_source_ids: [] }
    },
    rank: {
      status: rankField.status,
      value: rankField.value,
      evidence: calculatedTargetRank !== null
        ? (() => {
          const group = (semantic.candidate_groups || []).find((item) => (
            item.entries?.includes(catalog.target_entity_id)
          ));
          return {
            entity_occurrence_source_ids: occurrenceSourceIds(targetEntity),
            semantic_context_source_ids: group ? semanticContextOf(group) : []
          };
        })()
        : { entity_occurrence_source_ids: [], semantic_context_source_ids: [] }
    },
    sentiment: {
      status: sentimentField.status,
      value: sentimentField.value,
      evidence: sentimentField.status === 'assessed'
        ? {
            entity_occurrence_source_ids: occurrenceSourceIds(targetEntity),
            semantic_context_source_ids: semanticContextOf(semantic.sentiment)
          }
        : { entity_occurrence_source_ids: [], semantic_context_source_ids: [] }
    }
  };
  const competitionAnalysis = {
    status: competitionStatus,
    scope: 'open_discovery',
    completeness: 'not_proven',
    entities: catalog.entities.map((entity) => entity.entity_id),
    relations: relationEntities,
    relation_evidence_source_ids: relationEvidenceSourceIds,
    unresolved_entity_ids: unresolvedEntityIds,
    quarantined_items: quarantinedItems
  };
  const sov = {
    status: 'observed_only',
    scope: 'open_discovery',
    completeness: 'not_proven',
    numerator: targetMentions,
    denominator,
    value: sovValue
  };

  const stages = diagnostics.filter(Boolean);
  const snapshotMeta = registrySnapshot
    ? {
        version: registrySnapshot.version,
        sha256: registrySnapshot.sha256,
        entry_count: registrySnapshot.entry_count
      }
    : { version: 'competitor_registry_snapshot_v1', sha256: null, entry_count: 0 };
  const analysisStructure = {
    schema_version: STRUCTURE_VERSION,
    contract_revision: CONTRACT_REVISION,
    source_map_version: SOURCE_MAP_VERSION,
    answer_sha256: sourceMap.answer_sha256,
    competitor_registry_snapshot: snapshotMeta,
    target_fact: targetFact,
    target_mapping: catalog.target_mapping || {
      status: catalog.target_entity_id ? 'resolved' : 'not_applicable',
      target_entity_id: catalog.target_entity_id,
      candidate_entity_ids: []
    },
    target_semantics: targetSemantics,
    competition_analysis: competitionAnalysis,
    sov,
    entities: catalog.entities.map((entity) => ({
      entity_id: entity.entity_id,
      name: entity.name,
      type: entity.type,
      surface_forms: entity.surface_forms,
      registry_match: entity.registry_match || null
    })),
    mentions: catalog.entities.flatMap((entity) => entity.mentions.map((mention) => ({
      entity_id: entity.entity_id,
      ...mention
    }))),
    target_mentions: catalog.target_mentions || [],
    target_entity_id: catalog.target_entity_id,
    competition_scope: 'open_discovery',
    competition_completeness: 'not_proven',
    competition_analysis_status: competitionStatus,
    unresolved_entity_ids: unresolvedEntityIds,
    competitor_relations: semantic.competitor_relations,
    candidate_groups: semantic.candidate_groups,
    recommendations: semantic.recommendations,
    sentiment: semantic.sentiment,
    claims: {
      status: 'not_collected',
      items: []
    },
    diagnostics: {
      entity_prompt_revision: ENTITY_PROMPT_REVISION,
      semantic_prompt_revision: SEMANTIC_PROMPT_REVISION,
      model: stages.find((stage) => stage.model)?.model || 'deepseek-v4-flash',
      attempt_count: totalAttempts(stages),
      usage: combinedUsage(stages),
      stages
    }
  };

  return {
    metric_semantics_version: SCOPED_METRIC_SEMANTICS,
    brand_mentioned: brandMentioned,
    brand_mentions: targetMentions,
    brand_position: calculatedTargetRank,
    brand_rank: calculatedTargetRank,
    brand_recommended: targetRecommended,
    visibility_score: targetMentions,
    answer_competitor_share: sovValue,
    sov_numerator: targetMentions,
    sov_denominator: denominator,
    sov_status: 'observed_only',
    sov_scope: 'open_discovery',
    sov_completeness: 'not_proven',
    competition_entities: competitionEntities,
    competition_scope: 'open_discovery',
    competition_completeness: 'not_proven',
    competition_analysis_status: competitionStatus,
    sentiment: sentimentLabel,
    sentiment_reason: semantic.sentiment.reason || null,
    sentiment_risk_terms: semantic.sentiment.risk_terms || [],
    analysis_structure: analysisStructure
  };
}

/**
 * 阶段 1 失败时的降级实体目录：确定性目标事实仍由程序扫描保留，
 * 开放竞品轨为空；target_mapping 在目标出现但无实体可映射时为 unavailable。
 */
function buildDegradedCatalog({ sourceMap, targetBrand }) {
  const targetAliases = [targetBrand?.name, ...(Array.isArray(targetBrand?.aliases) ? targetBrand.aliases : [])]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const targetMentions = targetAliases.length
    ? buildTargetMentions(sourceMap, targetBrand)
    : [];
  return {
    entities: [],
    target_entity_id: null,
    target_mentions: targetMentions,
    target_mapping: {
      status: targetAliases.length === 0
        ? 'invalid_input'
        : (targetMentions.length ? 'unavailable' : 'not_applicable'),
      target_entity_id: null,
      candidate_entity_ids: []
    }
  };
}

function buildDegradedSemantic(catalog, error) {
  const targetAppears = Boolean(catalog?.target_entity_id);
  const nonTargetIds = (Array.isArray(catalog?.entities) ? catalog.entities : [])
    .map((entity) => entity.entity_id)
    .filter((entityId) => entityId !== catalog.target_entity_id);
  return {
    structured: {
      degraded: true,
      semantic_error: {
        code: String(error?.code || 'analysis_semantic_output_invalid'),
        message: String(error?.message || '语义判断不可用').slice(0, 200)
      },
      competitor_relations: [],
      unresolved_entity_ids: nonTargetIds,
      candidate_groups: [],
      recommendations: [],
      sentiment: {
        status: targetAppears ? 'unresolved' : 'not_applicable',
        label: null,
        reason: targetAppears ? '目标语义判断不可用' : '目标未出现',
        evidence_source_ids: [],
        evidence: [],
        risk_terms: []
      }
    },
    diagnostics: {
      stage: 'semantic_judge',
      attempt_count: Number(error?.details?.attempt_count) || 2,
      platform: String(error?.details?.platform || 'deepseek'),
      model: String(error?.details?.model || 'deepseek-v4-flash'),
      degraded: true,
      error_code: String(error?.code || 'analysis_semantic_output_invalid')
    }
  };
}

class AIResponseAnalysisV5Service {
  constructor(options = {}) {
    this.entityExtractionService = options.entityExtractionService
      || AIResponseEntityExtractionService;
    this.semanticJudgmentService = options.semanticJudgmentService
      || AIResponseSemanticJudgmentService;
  }

  async analyze({ question, responseText, brand, competitors }) {
    const normalizedQuestion = String(question || '').trim();
    const answer = String(responseText || '');
    if (!normalizedQuestion || !answer.trim()) {
      throw new AIResponseAnalysisV5Error(
        '当前问题和原回答不能为空',
        'analysis_context_missing'
      );
    }
    const sourceMap = createSourceMap(answer);
    const targetBrand = targetBrandInput(brand);
    // 竞品注册表快照在阶段 1 之后、阶段 2 之前做纯程序身份归一；
    // 阶段 1 请求不接收注册表，匹配不改变 occurrence，也不增加模型调用。
    const registrySnapshot = buildRegistrySnapshot(competitors);
    let entityDiagnostics;
    let catalog;
    let semanticResult;
    try {
      const extracted = await this.entityExtractionService.extract({
        answer,
        sourceMap,
        validateMentions: (mentions) => buildEntityCatalog({
          answer,
          sourceMap,
          extractedMentions: mentions,
          targetBrand
        })
      });
      catalog = extracted.validated || buildEntityCatalog({
        answer,
        sourceMap,
        extractedMentions: extracted.mentions,
        targetBrand
      });
      entityDiagnostics = extracted.diagnostics;
    } catch (error) {
      // 阶段 1 达到上限：确定性目标事实仍由程序扫描保留（target_fact 不丢），
      // 无实体可给阶段 2 -> 目标语义与开放竞品轨 unavailable，不抛整条错误。
      catalog = buildDegradedCatalog({ sourceMap, targetBrand });
      entityDiagnostics = {
        stage: 'entity_extract',
        attempt_count: Number(error?.details?.attempt_count) || 2,
        platform: String(error?.details?.platform || 'deepseek'),
        model: String(error?.details?.model || 'deepseek-v4-flash'),
        degraded: true,
        error_code: String(error?.code || 'analysis_entity_output_invalid'),
        message: String(error?.message || '实体抽取不可用').slice(0, 200)
      };
    }
    const registryCatalog = withRegistryMatches(catalog, registrySnapshot);
    if (catalog.entities.length) {
      try {
        semanticResult = await this.semanticJudgmentService.judge({
          question: normalizedQuestion,
          sourceMap,
          // 阶段 2 使用匹配前的 grounded 投影；buildSemanticPrompt 只取
          // entity_id/name/type/surface_forms/source_ids，不含注册表身份
          catalog: registryCatalog
        });
      } catch (semanticError) {
        // 阶段 2 达到上限后按字段降级：目标事实不被清空，
        // 已发现竞品进入 unresolved，不回退 v4 或 Pro。
        semanticResult = buildDegradedSemantic(registryCatalog, semanticError);
      }
    } else {
      // 阶段 1 失败：不调用阶段 2，直接按阶段 1 错误降级语义轨
      const stageOneError = new Error(entityDiagnostics?.message || '实体抽取不可用');
      stageOneError.code = entityDiagnostics?.error_code || 'analysis_entity_output_invalid';
      stageOneError.details = entityDiagnostics || {};
      semanticResult = buildDegradedSemantic(registryCatalog, stageOneError);
    }
    const calculated = calculate({
      sourceMap,
      catalog: registryCatalog,
      semantic: semanticResult.structured,
      diagnostics: [entityDiagnostics, semanticResult.diagnostics],
      registrySnapshot,
      quarantinedItems: entityDiagnostics?.quarantined_items || []
    });
    const model = entityDiagnostics?.model
      || semanticResult.diagnostics?.model
      || 'deepseek-v4-flash';
    return {
      ...calculated,
      analysis_method: ANALYSIS_METHOD,
      analysis_prompt_revision: `${ENTITY_PROMPT_REVISION}+${SEMANTIC_PROMPT_REVISION}`,
      analysis_platform: entityDiagnostics?.platform
        || semanticResult.diagnostics?.platform
        || 'deepseek',
      analysis_model: model,
      analysis_attempts: totalAttempts([
        entityDiagnostics,
        semanticResult.diagnostics
      ])
    };
  }
}

module.exports = new AIResponseAnalysisV5Service();
module.exports.AIResponseAnalysisV5Service = AIResponseAnalysisV5Service;
module.exports.AIResponseAnalysisV5Error = AIResponseAnalysisV5Error;
module.exports.ANALYSIS_METHOD = ANALYSIS_METHOD;
module.exports.STRUCTURE_VERSION = STRUCTURE_VERSION;
module.exports.CONTRACT_REVISION = CONTRACT_REVISION;
module.exports.calculate = calculate;
