const AIResponseEntityExtractionService = require('./AIResponseEntityExtractionService');
const AIResponseSemanticJudgmentService = require('./AIResponseSemanticJudgmentService');
const { createSourceMap, SOURCE_MAP_VERSION } = require('./AIAnalysisSourceMapService');
const { buildEntityCatalog } = require('./AIEntityCatalogService');
const { ENTITY_PROMPT_REVISION } = require('./AIResponseEntityExtractionService');
const { SEMANTIC_PROMPT_REVISION } = require('./AIResponseSemanticJudgmentService');
const { SCOPED_METRIC_SEMANTICS } = require('./GeoMetricSemanticsService');
const {
  buildRegistrySnapshot,
  withRegistryMatches
} = require('./AICompetitorRegistryResolverService');

const ANALYSIS_METHOD = 'ai_structured_v5';
const STRUCTURE_VERSION = 'geo_metric_input_v5';
const CONTRACT_REVISION = 'three_track_partial_v1';

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

function mentionCount(entity) {
  return new Set(entity?.mentions?.map((mention) => mention.source_id) || []).size;
}

function sourceOrdinal(text) {
  const normalized = String(text || '').replace(/^[\s#*_>\-|]+/u, '');
  const match = normalized.match(/^(\d{1,3})\s*[.、．)]/u);
  return match ? Number(match[1]) : null;
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
  const evidence = recommendation.evidence_source_ids.map((sourceId, index) => ({
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

function targetRank({ sourceMap, targetEntity, semantic, targetEntityId }) {
  const sourceById = new Map(sourceMap.segments.map((segment) => [segment.source_id, segment.text]));
  const targetSourceIds = new Set(targetEntity?.mentions?.map((mention) => mention.source_id) || []);
  for (const group of semantic.candidate_groups) {
    if (!group.entries.includes(targetEntityId) || group.entries.length < 2) continue;
    const explicitOrdinal = group.evidence_source_ids
      .filter((sourceId) => targetSourceIds.has(sourceId))
      .map((sourceId) => sourceOrdinal(sourceById.get(sourceId)))
      .find((ordinal) => ordinal !== null);
    if (explicitOrdinal !== undefined) return explicitOrdinal;
    if (group.ordered) return group.entries.indexOf(targetEntityId) + 1;
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
      return {
        entity_id: entity.entity_id,
        name: entity.name,
        relation: relation.relation,
        reason: relation.reason,
        evidence_source_ids: relation.evidence_source_ids,
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
    targetEntityId: catalog.target_entity_id
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
  const semanticAvailable = !semantic?.degraded;
  const targetAppears = brandMentioned;
  const recommendationField = targetAppears
    ? (semanticAvailable
      ? { status: 'assessed', value: targetRecommended }
      : { status: 'unresolved', value: null })
    : { status: 'not_applicable', value: null };
  const rankField = targetAppears
    ? (semanticAvailable
      ? { status: 'assessed', value: calculatedTargetRank }
      : { status: 'unresolved', value: null })
    : { status: 'not_applicable', value: null };
  const sentimentField = targetAppears
    ? (semanticAvailable
      ? (semantic.sentiment.status === 'assessed'
        ? { status: 'assessed', value: semantic.sentiment.label }
        : { status: 'unresolved', value: null })
      : { status: 'unresolved', value: null })
    : { status: 'not_applicable', value: null };
  const semanticsFieldStatuses = [
    recommendationField.status,
    rankField.status,
    sentimentField.status
  ];
  const targetSemanticsStatus = !targetAppears
    ? 'complete'
    : (semanticsFieldStatuses.every((status) => (
      status === 'assessed' || status === 'not_applicable'
    ))
      ? 'complete'
      : 'partial');
  const competitionStatus = !semanticAvailable
    ? 'unavailable'
    : (unresolvedEntityIds.length || quarantinedItems.length ? 'partial' : 'complete');
  const relationEvidenceSourceIds = (Array.isArray(semantic.competitor_relations)
    ? semantic.competitor_relations
    : []).flatMap((relation) => relation.evidence_source_ids || []);
  const relationEntities = (Array.isArray(semantic.competitor_relations)
    ? semantic.competitor_relations
    : []).map((relation) => relation.entity_id);

  const targetFact = {
    status: 'complete',
    brand_mentioned: brandMentioned,
    brand_mentions: targetMentions,
    mentions: catalog.target_mentions || []
  };
  const targetSemantics = {
    status: targetSemanticsStatus,
    recommendation: {
      status: recommendationField.status,
      value: recommendationField.value,
      evidence_source_ids: targetRecommended && targetRecommendation
        ? targetRecommendation.evidence_source_ids
        : []
    },
    rank: {
      status: rankField.status,
      value: rankField.value,
      evidence_source_ids: calculatedTargetRank !== null
        ? (() => {
          const group = (semantic.candidate_groups || []).find((item) => (
            item.entries?.includes(catalog.target_entity_id)
          ));
          return group ? group.evidence_source_ids : [];
        })()
        : []
    },
    sentiment: {
      status: sentimentField.status,
      value: sentimentField.value,
      evidence_source_ids: semantic.sentiment?.evidence_source_ids || []
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
    let extracted;
    let semanticResult;
    try {
      extracted = await this.entityExtractionService.extract({
        answer,
        sourceMap,
        validateMentions: (mentions) => buildEntityCatalog({
          answer,
          sourceMap,
          extractedMentions: mentions,
          targetBrand
        })
      });
      const catalog = extracted.validated || buildEntityCatalog({
        answer,
        sourceMap,
        extractedMentions: extracted.mentions,
        targetBrand
      });
      const registryCatalog = withRegistryMatches(catalog, registrySnapshot);
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
      const calculated = calculate({
        sourceMap,
        catalog: registryCatalog,
        semantic: semanticResult.structured,
        diagnostics: [extracted.diagnostics, semanticResult.diagnostics],
        registrySnapshot,
        quarantinedItems: extracted.diagnostics?.quarantined_items || []
      });
      const model = extracted.diagnostics?.model
        || semanticResult.diagnostics?.model
        || 'deepseek-v4-flash';
      return {
        ...calculated,
        analysis_method: ANALYSIS_METHOD,
        analysis_prompt_revision: `${ENTITY_PROMPT_REVISION}+${SEMANTIC_PROMPT_REVISION}`,
        analysis_platform: extracted.diagnostics?.platform
          || semanticResult.diagnostics?.platform
          || 'deepseek',
        analysis_model: model,
        analysis_attempts: totalAttempts([
          extracted.diagnostics,
          semanticResult.diagnostics
        ])
      };
    } catch (error) {
      if (error instanceof AIResponseAnalysisV5Error) throw error;
      throw new AIResponseAnalysisV5Error(
        error?.message || 'AI 结构化分析失败',
        error?.code || 'invalid_analysis_output',
        error?.details || {}
      );
    }
  }
}

module.exports = new AIResponseAnalysisV5Service();
module.exports.AIResponseAnalysisV5Service = AIResponseAnalysisV5Service;
module.exports.AIResponseAnalysisV5Error = AIResponseAnalysisV5Error;
module.exports.ANALYSIS_METHOD = ANALYSIS_METHOD;
module.exports.STRUCTURE_VERSION = STRUCTURE_VERSION;
module.exports.CONTRACT_REVISION = CONTRACT_REVISION;
module.exports.calculate = calculate;
