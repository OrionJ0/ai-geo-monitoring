const AIPlatformRequestService = require('./AIPlatformRequestService');
const AIAnalysisConfigService = require('./AIAnalysisConfigService');

const ANALYSIS_METHOD = 'ai_structured_v2';
const STRUCTURE_VERSION = 'geo_metric_input_v2';
const VALID_ENTITY_TYPES = new Set(['brand', 'company']);
const VALID_RECOMMENDATION_KINDS = new Set(['explicit']);
const VALID_SENTIMENTS = new Set(['positive', 'neutral', 'negative']);
const PROMPT_RUNTIME_FIELDS = Object.freeze([
  '目标品牌',
  '品牌别名',
  '已配置竞品',
  '待分析的 AI 回答'
]);
const EXPECTED_OUTPUT = Object.freeze({
  entities: [{
    name: '回答中的品牌或公司标准名称',
    type: 'brand | company'
  }],
  mentions: [{
    entity_name: '必须引用 entities.name',
    surface_forms: ['同一次提及中实际出现的品牌/公司短名称或别名']
  }],
  target_entity_name: '目标品牌对应的 entities.name；回答未提及则为 null',
  competitor_matches: [{
    configured_name: '必须精确引用已配置竞品名称',
    entity_name: '对应的 entities.name；回答未提及则为 null'
  }],
  candidate_lists: [{
    ordered: true,
    entries: ['按回答顺序引用 entities.name']
  }],
  recommendations: [{
    entity_name: '必须引用 entities.name',
    kind: 'explicit'
  }],
  claims: [{
    subject_name: '必须引用 entities.name',
    predicate: '属性或关系',
    value: '回答声称的值',
    qualifier: '可选限定条件'
  }],
  sentiment: {
    label: 'positive | neutral | negative',
    reason: '目标品牌情绪判断依据',
    risk_terms: ['风险词']
  }
});

class AIResponseAnalysisError extends Error {
  constructor(message, code = 'invalid_analysis_output') {
    super(message);
    this.name = 'AIResponseAnalysisError';
    this.code = code;
  }
}

function extractJsonObject(value) {
  const text = String(value || '').trim().replace(/^```(?:json)?/iu, '').replace(/```$/u, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

function compact(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/gu, '');
}

function boundedString(value, field, maxLength, { required = true } = {}) {
  const text = String(value || '').replace(/\s+/gu, ' ').trim();
  if (required && !text) throw new AIResponseAnalysisError(`${field} 不能为空`);
  if (text.length > maxLength) throw new AIResponseAnalysisError(`${field} 超出长度限制`);
  return text;
}

function normalizeSentiment(value) {
  const sentiment = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const label = String(sentiment.label || 'neutral').trim().toLowerCase();
  if (!VALID_SENTIMENTS.has(label)) {
    throw new AIResponseAnalysisError('sentiment.label 不受支持');
  }
  return {
    label,
    reason: boundedString(sentiment.reason, 'sentiment.reason', 120, { required: false }),
    risk_terms: (Array.isArray(sentiment.risk_terms) ? sentiment.risk_terms : [])
      .map((item, index) => boundedString(item, `sentiment.risk_terms[${index}]`, 30))
      .filter(Boolean)
      .slice(0, 10)
  };
}

function normalizeEntities(value) {
  if (!Array.isArray(value)) throw new AIResponseAnalysisError('entities 必须是数组');
  if (value.length > 100) throw new AIResponseAnalysisError('entities 最多返回 100 项');
  const seen = new Set();
  return value.map((item, index) => {
    const name = boundedString(item?.name, `entities[${index}].name`, 100);
    const type = String(item?.type || '').trim().toLowerCase();
    if (!VALID_ENTITY_TYPES.has(type)) {
      throw new AIResponseAnalysisError(`entities[${index}].type 不受支持`);
    }
    const key = compact(name);
    if (!key || seen.has(key)) {
      throw new AIResponseAnalysisError(`entities[${index}].name 重复或无效`);
    }
    seen.add(key);
    return { name, type };
  });
}

function buildEntityMap(entities) {
  return new Map(entities.map((entity) => [compact(entity.name), entity]));
}

function requireEntity(entityMap, value, field) {
  const key = compact(value);
  const entity = entityMap.get(key);
  if (!entity) throw new AIResponseAnalysisError(`${field} 必须引用 entities.name`);
  return entity;
}

function normalizeMentions(value, responseText, entityMap) {
  if (!Array.isArray(value)) throw new AIResponseAnalysisError('mentions 必须是数组');
  if (value.length > 500) throw new AIResponseAnalysisError('mentions 最多返回 500 项');
  const source = String(responseText || '');
  let cursor = 0;
  return value.map((item, index) => {
    const entity = requireEntity(entityMap, item?.entity_name, `mentions[${index}].entity_name`);
    if (!Array.isArray(item?.surface_forms) || !item.surface_forms.length || item.surface_forms.length > 8) {
      throw new AIResponseAnalysisError(`mentions[${index}].surface_forms 必须包含 1 至 8 个短实体词`);
    }
    const surfaceForms = item.surface_forms.map((surface, surfaceIndex) => {
      const field = `mentions[${index}].surface_forms[${surfaceIndex}]`;
      const text = boundedString(surface, field, 60);
      if (/[。！？!?；;\n\r]/u.test(text)) {
        throw new AIResponseAnalysisError(`${field} 必须是短实体词，不能是完整句子`);
      }
      const position = source.indexOf(text, cursor);
      if (position < 0) {
        throw new AIResponseAnalysisError(
          `mentions[${index}].surface_forms[${surfaceIndex}] 无法在原回答中定位或顺序错误`
        );
      }
      cursor = position + text.length;
      return text;
    });
    return {
      entity_name: entity.name,
      surface_forms: surfaceForms
    };
  });
}

function normalizeTargetEntityName(value, entityMap) {
  if (value === null) return null;
  return requireEntity(entityMap, value, 'target_entity_name').name;
}

function normalizeCompetitorMatches(value, competitors, entityMap, mentionedEntityKeys) {
  if (!Array.isArray(value)) throw new AIResponseAnalysisError('competitor_matches 必须是数组');
  const expected = (Array.isArray(competitors) ? competitors : [])
    .map((item) => String(item?.name || '').trim())
    .filter(Boolean);
  if (value.length !== expected.length) {
    throw new AIResponseAnalysisError('competitor_matches 必须逐一覆盖已配置竞品');
  }
  const expectedMap = new Map(expected.map((name) => [compact(name), name]));
  const seen = new Set();
  const normalized = value.map((item, index) => {
    const configuredKey = compact(item?.configured_name);
    const configuredName = expectedMap.get(configuredKey);
    if (!configuredName || seen.has(configuredKey)) {
      throw new AIResponseAnalysisError(
        `competitor_matches[${index}].configured_name 必须精确引用且不得重复`
      );
    }
    seen.add(configuredKey);
    if (item?.entity_name === null) {
      return { configured_name: configuredName, entity_name: null };
    }
    const entity = requireEntity(
      entityMap,
      item?.entity_name,
      `competitor_matches[${index}].entity_name`
    );
    if (!mentionedEntityKeys.has(compact(entity.name))) {
      throw new AIResponseAnalysisError(`competitor_matches[${index}] 没有对应提及`);
    }
    return { configured_name: configuredName, entity_name: entity.name };
  });
  const byConfiguredName = new Map(
    normalized.map((item) => [compact(item.configured_name), item])
  );
  return expected.map((name) => byConfiguredName.get(compact(name)));
}

function normalizeCandidateLists(value, entityMap, mentionedEntityKeys) {
  if (!Array.isArray(value)) throw new AIResponseAnalysisError('candidate_lists 必须是数组');
  if (value.length > 20) throw new AIResponseAnalysisError('candidate_lists 最多返回 20 项');
  return value.map((item, index) => {
    if (typeof item?.ordered !== 'boolean') {
      throw new AIResponseAnalysisError(`candidate_lists[${index}].ordered 必须是布尔值`);
    }
    if (!Array.isArray(item.entries) || !item.entries.length || item.entries.length > 100) {
      throw new AIResponseAnalysisError(`candidate_lists[${index}].entries 必须包含 1 至 100 项`);
    }
    const entries = item.entries.map((name, entryIndex) => {
      const entity = requireEntity(
        entityMap,
        name,
        `candidate_lists[${index}].entries[${entryIndex}]`
      );
      if (!mentionedEntityKeys.has(compact(entity.name))) {
        throw new AIResponseAnalysisError(
          `candidate_lists[${index}].entries[${entryIndex}] 没有对应提及`
        );
      }
      return entity.name;
    });
    return { ordered: item.ordered, entries };
  });
}

function normalizeRecommendations(value, entityMap, mentionedEntityKeys) {
  if (!Array.isArray(value)) throw new AIResponseAnalysisError('recommendations 必须是数组');
  if (value.length > 100) throw new AIResponseAnalysisError('recommendations 最多返回 100 项');
  return value.map((item, index) => {
    const entity = requireEntity(entityMap, item?.entity_name, `recommendations[${index}].entity_name`);
    const kind = String(item?.kind || '').trim().toLowerCase();
    if (!VALID_RECOMMENDATION_KINDS.has(kind)) {
      throw new AIResponseAnalysisError(`recommendations[${index}].kind 不受支持`);
    }
    if (!mentionedEntityKeys.has(compact(entity.name))) {
      throw new AIResponseAnalysisError(`recommendations[${index}] 没有对应提及`);
    }
    return { entity_name: entity.name, kind };
  });
}

function normalizeClaims(value, entityMap) {
  if (!Array.isArray(value)) throw new AIResponseAnalysisError('claims 必须是数组');
  if (value.length > 100) throw new AIResponseAnalysisError('claims 最多返回 100 项');
  return value.map((item, index) => {
    const entity = requireEntity(entityMap, item?.subject_name, `claims[${index}].subject_name`);
    return {
      subject_name: entity.name,
      predicate: boundedString(item?.predicate, `claims[${index}].predicate`, 80),
      value: boundedString(item?.value, `claims[${index}].value`, 300),
      qualifier: boundedString(item?.qualifier, `claims[${index}].qualifier`, 120, { required: false })
    };
  });
}

function entityObservations(entity, structured) {
  if (!entity) {
    return {
      mentioned: false,
      mentions: 0,
      recommended: false,
      list_rank: null,
      surface_forms: []
    };
  }
  const entityKey = compact(entity.name);
  const mentionRows = structured.mentions.filter(
    (mention) => compact(mention.entity_name) === entityKey
  );
  const orderedList = structured.candidate_lists.find(
    (list) => list.ordered && list.entries.some((name) => compact(name) === entityKey)
  );
  const listRank = orderedList
    ? orderedList.entries.findIndex((name) => compact(name) === entityKey) + 1
    : null;
  return {
    mentioned: mentionRows.length > 0,
    mentions: mentionRows.length,
    recommended: structured.recommendations.some(
      (item) => compact(item.entity_name) === entityKey
    ),
    list_rank: listRank,
    surface_forms: mentionRows.flatMap((item) => item.surface_forms)
  };
}

class AIResponseAnalysisService {
  constructor(options = {}) {
    this.configService = options.configService || AIAnalysisConfigService;
    this.requestService = options.requestService || AIPlatformRequestService;
  }

  buildPrompt({ responseText, brand, competitors }) {
    const competitorNames = (Array.isArray(competitors) ? competitors : [])
      .map((item) => String(item?.name || '').trim())
      .filter(Boolean);
    return [
      '你是 GEO 回答结构化器，只把原回答转换为结构化原料，不计算任何指标。',
      `目标品牌：${String(brand?.name || '').trim()}`,
      `品牌别名：${(Array.isArray(brand?.aliases) ? brand.aliases : []).join('、') || '无'}`,
      `已配置竞品：${competitorNames.join('、') || '无'}`,
      '只返回一个 JSON 对象，不要 Markdown。',
      'entities：列出回答中出现的全部品牌或公司实体，不限于目标品牌和已配置竞品；每项只含 name、type(brand|company)。',
      'mentions：回答中每一次品牌/公司提及各返回一项，按出现顺序排列；每项只含 entity_name 和 surface_forms。',
      '同一次提及同时出现中文名、英文名或别名时放在同一项 surface_forms 中；surface_forms 只能放原回答实际出现的短实体词，不要复制完整句子。',
      'target_entity_name：判断 entities 中哪一项对应目标品牌；必须精确引用 entities.name，目标品牌未出现时返回 null。不要让程序再按名称相似度猜测。',
      'competitor_matches：对每个已配置竞品返回一项 configured_name 和 entity_name；configured_name 必须精确照抄已配置竞品名称，对应实体必须引用 entities.name，未出现则为 null；无竞品时返回空数组。',
      'candidate_lists：抽取同一候选列表，entries 按回答顺序引用 entities.name；只有回答有明确序号或名次时 ordered=true，普通项目符号或正文顺序为 false。',
      'recommendations：只抽取明确建议、首选、优先或明确认可的品牌/公司；每项只含 entity_name、kind，kind 固定为 explicit；普通列举不算推荐。',
      'claims：抽取回答对品牌/公司的事实性声称，每项只含 subject_name、predicate、value、qualifier；这只是待核验声明，不代表事实正确。',
      'sentiment：只判断目标品牌，返回 label(positive|neutral|negative)、reason、risk_terms。',
      '所有 entity_name、subject_name 和 entries 都必须精确引用 entities.name。',
      '不要返回 mention_count、recommended、rank、比例、分数、SOV 或任何汇总指标；程序会根据数组行数和顺序统一计算。',
      '不要返回引用数量、来源 URL 或官网判断；引用由系统直接解析监测平台原始响应，避免模型猜测。',
      `原回答：\n${String(responseText || '').slice(0, 12000)}`
    ].join('\n');
  }

  getPromptDefinition() {
    return {
      version: ANALYSIS_METHOD,
      template: this.buildPrompt({
        responseText: '{{待分析的 AI 回答}}',
        brand: {
          name: '{{目标品牌}}',
          aliases: ['{{品牌别名}}']
        },
        competitors: [{ name: '{{已配置竞品}}' }]
      }),
      runtime_fields: [...PROMPT_RUNTIME_FIELDS],
      expected_output: EXPECTED_OUTPUT
    };
  }

  parseOutput(outputText, context) {
    let parsed;
    try {
      parsed = JSON.parse(extractJsonObject(outputText));
    } catch (_) {
      throw new AIResponseAnalysisError('AI 分析 API 未返回有效 JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new AIResponseAnalysisError('AI 分析 API 返回结构无效');
    }
    const entities = normalizeEntities(parsed.entities);
    const entityMap = buildEntityMap(entities);
    const mentions = normalizeMentions(parsed.mentions, context.responseText, entityMap);
    const mentionedEntityKeys = new Set(mentions.map((item) => compact(item.entity_name)));
    entities.forEach((entity, index) => {
      if (!mentionedEntityKeys.has(compact(entity.name))) {
        throw new AIResponseAnalysisError(`entities[${index}] 没有对应提及`);
      }
    });
    if (!Object.prototype.hasOwnProperty.call(parsed, 'target_entity_name')) {
      throw new AIResponseAnalysisError('target_entity_name 不能为空');
    }
    if (!Object.prototype.hasOwnProperty.call(parsed, 'competitor_matches')) {
      throw new AIResponseAnalysisError('competitor_matches 不能为空');
    }
    const structured = {
      schema_version: STRUCTURE_VERSION,
      entities,
      mentions,
      target_entity_name: normalizeTargetEntityName(parsed.target_entity_name, entityMap),
      competitor_matches: normalizeCompetitorMatches(
        parsed.competitor_matches,
        context.competitors,
        entityMap,
        mentionedEntityKeys
      ),
      candidate_lists: normalizeCandidateLists(
        parsed.candidate_lists,
        entityMap,
        mentionedEntityKeys
      ),
      recommendations: normalizeRecommendations(
        parsed.recommendations,
        entityMap,
        mentionedEntityKeys
      ),
      claims: normalizeClaims(parsed.claims, entityMap),
      sentiment: normalizeSentiment(parsed.sentiment)
    };
    return structured;
  }

  calculate(structured, brand, competitors) {
    const targetEntity = structured.entities.find(
      (entity) => entity.name === structured.target_entity_name
    ) || null;
    const target = entityObservations(targetEntity, structured);
    const competitorMatchMap = new Map(
      structured.competitor_matches.map((item) => [compact(item.configured_name), item.entity_name])
    );
    const competitorRows = (Array.isArray(competitors) ? competitors : []).map((competitor) => {
      const matchedEntityName = competitorMatchMap.get(compact(competitor?.name));
      const entity = structured.entities.find(
        (item) => item.name === matchedEntityName
      ) || null;
      const observation = entityObservations(entity, structured);
      return {
        id: competitor?.id ?? null,
        name: String(competitor?.name || '').trim(),
        mentioned: observation.mentioned,
        mentions: observation.mentions,
        recommended: observation.recommended,
        position: observation.list_rank,
        rank: observation.list_rank,
        surface_forms: observation.surface_forms
      };
    });
    const competitorMentionTotal = competitorRows.reduce((total, item) => total + item.mentions, 0);
    const mentionTotal = target.mentions + competitorMentionTotal;
    return {
      brand_mentioned: target.mentioned,
      brand_mentions: target.mentions,
      brand_position: target.list_rank,
      brand_rank: target.list_rank,
      brand_recommended: target.recommended,
      visibility_score: target.mentions,
      competitor_mentions: competitorRows,
      share_of_voice: competitorRows.length > 0 && mentionTotal > 0
        ? Number(((target.mentions / mentionTotal) * 100).toFixed(2))
        : 0,
      sentiment: structured.sentiment.label,
      sentiment_reason: structured.sentiment.reason || null,
      sentiment_risk_terms: structured.sentiment.risk_terms,
      analysis_structure: structured
    };
  }

  async analyze({ responseText, brand, competitors, includeRawOutput = false }) {
    const platform = await this.configService.getAnalysisPlatform();
    const connection = await this.requestService.queryConfig(
      platform,
      this.buildPrompt({ responseText, brand, competitors }),
      {
        retryCount: 0,
        requestOptions: {},
        disableWebSearch: true
      }
    );
    if (!connection?.success) {
      throw new AIResponseAnalysisError(
        connection?.error || 'AI 分析 API 调用失败',
        connection?.error_code || 'analysis_api_failed'
      );
    }
    const competitorRows = Array.isArray(competitors) ? competitors : [];
    const structured = this.parseOutput(connection.text, {
      responseText: String(responseText || ''),
      brand,
      competitors: competitorRows
    });
    const result = {
      ...this.calculate(structured, brand, competitorRows),
      analysis_method: ANALYSIS_METHOD,
      analysis_platform: platform.code,
      analysis_model: platform.default_model
    };
    if (includeRawOutput) result.raw_output = connection.text;
    return result;
  }
}

const service = new AIResponseAnalysisService();

module.exports = service;
module.exports.AIResponseAnalysisService = AIResponseAnalysisService;
module.exports.AIResponseAnalysisError = AIResponseAnalysisError;
module.exports.ANALYSIS_METHOD = ANALYSIS_METHOD;
module.exports.STRUCTURE_VERSION = STRUCTURE_VERSION;
module.exports.PROMPT_RUNTIME_FIELDS = PROMPT_RUNTIME_FIELDS;
module.exports.EXPECTED_OUTPUT = EXPECTED_OUTPUT;
