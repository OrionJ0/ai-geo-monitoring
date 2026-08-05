const AIResponseEntityExtractionService = require('./AIResponseEntityExtractionService');
const AIResponseSemanticJudgmentService = require('./AIResponseSemanticJudgmentService');
const { createSourceMap, SOURCE_MAP_VERSION } = require('./AIAnalysisSourceMapService');
const { buildEntityCatalog } = require('./AIEntityCatalogService');
const { ENTITY_PROMPT_REVISION } = require('./AIResponseEntityExtractionService');
const { SEMANTIC_PROMPT_REVISION } = require('./AIResponseSemanticJudgmentService');
const { CURRENT_METRIC_SEMANTICS } = require('./GeoMetricSemanticsService');

const ANALYSIS_METHOD = 'ai_structured_v5';
const STRUCTURE_VERSION = 'geo_metric_input_v5';

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

function calculate({ sourceMap, catalog, semantic, diagnostics }) {
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
  const competitorMentions = competitionEntities
    .filter((entity) => entity.relation === 'competitor')
    .reduce((total, entity) => total + entity.mentions, 0);
  const denominator = targetMentions + competitorMentions;
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
  const stages = diagnostics.filter(Boolean);
  const analysisStructure = {
    schema_version: STRUCTURE_VERSION,
    source_map_version: SOURCE_MAP_VERSION,
    answer_sha256: sourceMap.answer_sha256,
    entities: catalog.entities.map((entity) => ({
      entity_id: entity.entity_id,
      name: entity.name,
      type: entity.type,
      surface_forms: entity.surface_forms
    })),
    mentions: catalog.entities.flatMap((entity) => entity.mentions.map((mention) => ({
      entity_id: entity.entity_id,
      ...mention
    }))),
    target_mentions: catalog.target_mentions || [],
    target_entity_id: catalog.target_entity_id,
    competition_scope: 'open_discovery',
    competition_completeness: 'not_proven',
    competition_analysis_status: unresolvedEntityIds.length ? 'partial' : 'complete_observed',
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
    metric_semantics_version: CURRENT_METRIC_SEMANTICS,
    brand_mentioned: Boolean(targetEntity),
    brand_mentions: targetMentions,
    brand_position: calculatedTargetRank,
    brand_rank: calculatedTargetRank,
    brand_recommended: targetRecommended,
    visibility_score: targetMentions,
    answer_competitor_share: denominator > 0
      ? Number(((targetMentions / denominator) * 100).toFixed(2))
      : null,
    sov_numerator: targetMentions,
    sov_denominator: denominator,
    competition_entities: competitionEntities,
    competition_scope: 'open_discovery',
    competition_completeness: 'not_proven',
    competition_analysis_status: unresolvedEntityIds.length ? 'partial' : 'complete_observed',
    sentiment: sentimentLabel,
    sentiment_reason: semantic.sentiment.reason || null,
    sentiment_risk_terms: semantic.sentiment.risk_terms || [],
    analysis_structure: analysisStructure
  };
}

class AIResponseAnalysisV5Service {
  constructor(options = {}) {
    this.entityExtractionService = options.entityExtractionService
      || AIResponseEntityExtractionService;
    this.semanticJudgmentService = options.semanticJudgmentService
      || AIResponseSemanticJudgmentService;
  }

  async analyze({ question, responseText, brand }) {
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
      semanticResult = await this.semanticJudgmentService.judge({
        question: normalizedQuestion,
        sourceMap,
        catalog
      });
      const calculated = calculate({
        sourceMap,
        catalog,
        semantic: semanticResult.structured,
        diagnostics: [extracted.diagnostics, semanticResult.diagnostics]
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
module.exports.calculate = calculate;
