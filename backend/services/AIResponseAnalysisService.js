const AIPlatformRequestService = require('./AIPlatformRequestService');
const AIAnalysisConfigService = require('./AIAnalysisConfigService');
const {
  CURRENT_ANALYSIS_CONTRACT,
  CURRENT_STRUCTURE_VERSION,
  CURRENT_METRIC_SEMANTICS
} = require('./GeoMetricSemanticsService');

const ANALYSIS_METHOD = CURRENT_ANALYSIS_CONTRACT;
const STRUCTURE_VERSION = CURRENT_STRUCTURE_VERSION;
const VALID_ENTITY_TYPES = new Set(['brand', 'company']);
const VALID_COMPETITOR_RELATIONS = new Set(['competitor', 'non_competitor']);
const VALID_RECOMMENDATION_KINDS = new Set(['explicit']);
const VALID_SENTIMENTS = new Set(['positive', 'neutral', 'negative']);
const ANALYSIS_REQUEST_PROFILE = Object.freeze({
  temperature: 0,
  timeout_seconds: 120,
  max_attempts: 2,
  web_search: false,
  token_limit: null,
  json_mode: 'chat_completions_only',
  deepseek_thinking: 'disabled'
});
const RETRYABLE_REQUEST_ERROR_CODES = new Set([
  'invalid_provider_response',
  'network_error',
  'provider_error',
  'rate_limited',
  'timeout'
]);
const PROMPT_RUNTIME_FIELDS = Object.freeze([
  '当前问题',
  '目标品牌',
  '品牌别名',
  '目标品牌行业',
  '目标品牌关键词',
  '竞品提示',
  '待分析的 AI 回答'
]);
const EXPECTED_OUTPUT = Object.freeze({
  entities: [{
    name: '回答中的品牌或公司标准名称',
    type: 'brand | company'
  }],
  mentions: [{
    entity_name: '必须引用 entities.name',
    surface_forms: ['原回答中实际出现的品牌/公司短名称或别名；程序据此计算次数和顺序']
  }],
  target_entity_name: '目标品牌对应的 entities.name；回答未提及则为 null',
  competitor_relations: [{
    entity_name: '必须精确引用非目标 entities.name',
    relation: 'competitor | non_competitor',
    reason: '当前问题和回答场景中的替代关系判断理由'
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
const JSON_OUTPUT_SKELETON = Object.freeze({
  entities: [],
  mentions: [],
  target_entity_name: null,
  competitor_relations: [],
  candidate_lists: [],
  recommendations: [],
  claims: [],
  sentiment: {
    label: 'neutral',
    reason: '',
    risk_terms: []
  }
});

class AIResponseAnalysisError extends Error {
  constructor(message, code = 'invalid_analysis_output', details = {}) {
    super(message);
    this.name = 'AIResponseAnalysisError';
    this.code = code;
    this.details = details;
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

function boundedString(
  value,
  field,
  maxLength,
  { required = true, code = 'invalid_analysis_output' } = {}
) {
  const text = String(value || '').replace(/\s+/gu, ' ').trim();
  if (required && !text) throw new AIResponseAnalysisError(`${field} 不能为空`, code);
  if (text.length > maxLength) {
    throw new AIResponseAnalysisError(`${field} 超出长度限制`, code);
  }
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
  const formsByEntity = new Map();

  value.forEach((item, index) => {
    const entity = requireEntity(entityMap, item?.entity_name, `mentions[${index}].entity_name`);
    if (!Array.isArray(item?.surface_forms) || !item.surface_forms.length) {
      throw new AIResponseAnalysisError(`mentions[${index}].surface_forms 至少包含 1 个短实体词`);
    }
    const entityKey = compact(entity.name);
    const entityForms = formsByEntity.get(entityKey) || {
      entity_name: entity.name,
      surface_forms: new Set()
    };
    item.surface_forms.forEach((surface, surfaceIndex) => {
      const field = `mentions[${index}].surface_forms[${surfaceIndex}]`;
      const text = boundedString(surface, field, 60);
      if (/[。！？!?；;\n\r]/u.test(text)) {
        throw new AIResponseAnalysisError(`${field} 必须是短实体词，不能是完整句子`);
      }
      if (!source.includes(text)) {
        throw new AIResponseAnalysisError(`${field} 无法在原回答中定位`);
      }
      entityForms.surface_forms.add(text);
    });
    formsByEntity.set(entityKey, entityForms);
  });

  const candidates = [];
  formsByEntity.forEach((entry, entityKey) => {
    entry.surface_forms.forEach((surfaceForm) => {
      let start = source.indexOf(surfaceForm);
      while (start >= 0) {
        candidates.push({
          entity_key: entityKey,
          entity_name: entry.entity_name,
          surface_form: surfaceForm,
          start,
          end: start + surfaceForm.length
        });
        if (candidates.length > 5000) {
          throw new AIResponseAnalysisError('原回答中的实体表面词匹配过多');
        }
        start = source.indexOf(surfaceForm, start + Math.max(surfaceForm.length, 1));
      }
    });
  });
  candidates.sort((left, right) => (
    left.start - right.start
    || (right.end - right.start) - (left.end - left.start)
    || left.entity_name.localeCompare(right.entity_name, 'zh-CN')
  ));

  const occurrences = [];
  let coveredUntil = -1;
  candidates.forEach((candidate) => {
    if (candidate.start < coveredUntil) return;
    const surfaceForms = candidates
      .filter((item) => (
        item.start === candidate.start
        && item.entity_key === candidate.entity_key
        && item.end <= candidate.end
      ))
      .map((item) => item.surface_form)
      .filter((surfaceForm, index, rows) => rows.indexOf(surfaceForm) === index);
    occurrences.push({
      entity_name: candidate.entity_name,
      surface_forms: surfaceForms,
      start: candidate.start,
      end: candidate.end
    });
    coveredUntil = candidate.end;
  });

  const mentions = [];
  occurrences.forEach((occurrence) => {
    const previous = mentions.at(-1);
    const separator = previous ? source.slice(previous.end, occurrence.start) : '';
    const repeatsSameSurface = previous?.surface_forms.some(
      (surfaceForm) => occurrence.surface_forms.includes(surfaceForm)
    );
    const isAliasSeparator = /^(?:\s*[（(【\[]\s*|\s*\/\s*)$/u.test(separator);
    if (
      previous
      && compact(previous.entity_name) === compact(occurrence.entity_name)
      && !repeatsSameSurface
      && isAliasSeparator
    ) {
      previous.surface_forms = [...new Set([
        ...previous.surface_forms,
        ...occurrence.surface_forms
      ])];
      previous.end = occurrence.end;
      return;
    }
    mentions.push({ ...occurrence });
  });
  if (mentions.length > 500) throw new AIResponseAnalysisError('mentions 最多返回 500 项');
  return mentions.map(({ entity_name, surface_forms }) => ({ entity_name, surface_forms }));
}

function normalizeTargetEntityName(value, entityMap) {
  if (value === null) return null;
  return requireEntity(entityMap, value, 'target_entity_name').name;
}

function normalizeCompetitorRelations(
  value,
  entities,
  targetEntityName,
  entityMap,
  mentionedEntityKeys
) {
  if (!Array.isArray(value)) {
    throw new AIResponseAnalysisError(
      'competitor_relations 必须是数组',
      'analysis_relation_incomplete'
    );
  }
  const targetKey = compact(targetEntityName);
  const expected = entities.filter((entity) => compact(entity.name) !== targetKey);
  if (value.length !== expected.length) {
    throw new AIResponseAnalysisError(
      'competitor_relations 必须逐一覆盖全部非目标实体',
      'analysis_relation_incomplete'
    );
  }
  const expectedMap = new Map(
    expected.map((entity) => [compact(entity.name), entity])
  );
  const seen = new Set();
  const normalized = value.map((item, index) => {
    const entityKey = compact(item?.entity_name);
    const entity = expectedMap.get(entityKey);
    if (!entity || seen.has(entityKey)) {
      throw new AIResponseAnalysisError(
        `competitor_relations[${index}].entity_name 必须引用非目标实体且不得重复`
      );
    }
    if (!mentionedEntityKeys.has(entityKey)) {
      throw new AIResponseAnalysisError(
        `competitor_relations[${index}].entity_name 没有对应提及`
      );
    }
    requireEntity(
      entityMap,
      entity.name,
      `competitor_relations[${index}].entity_name`
    );
    const relation = String(item?.relation || '').trim().toLowerCase();
    if (!VALID_COMPETITOR_RELATIONS.has(relation)) {
      throw new AIResponseAnalysisError(
        `competitor_relations[${index}].relation 不受支持`
      );
    }
    seen.add(entityKey);
    return {
      entity_name: entity.name,
      relation,
      reason: boundedString(
        item?.reason,
        `competitor_relations[${index}].reason`,
        160,
        { code: 'analysis_relation_reason_invalid' }
      )
    };
  });
  const byEntityName = new Map(
    normalized.map((item) => [compact(item.entity_name), item])
  );
  return expected.map((entity) => byEntityName.get(compact(entity.name)));
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
    if (new Set(entries.map(compact)).size !== entries.length) {
      throw new AIResponseAnalysisError(
        `candidate_lists[${index}].entries 不能包含重复实体`
      );
    }
    if (item.ordered && entries.length < 2) {
      throw new AIResponseAnalysisError(
        `candidate_lists[${index}] 有序榜单至少需要 2 个不同实体`
      );
    }
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
      value: boundedString(item?.value, `claims[${index}].value`, 300, { required: false }),
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

  buildPrompt({ question, responseText, brand, competitorHints }) {
    const hints = (Array.isArray(competitorHints) ? competitorHints : [])
      .map((item) => ({
        name: String(item?.name || '').trim(),
        aliases: Array.isArray(item?.aliases)
          ? item.aliases.map((alias) => String(alias || '').trim()).filter(Boolean)
          : []
      }))
      .filter((item) => item.name);
    return [
      '你是 GEO 回答结构化器，只把原回答转换为结构化原料，不计算任何指标。',
      `当前问题：${String(question || '').trim()}`,
      `目标品牌：${String(brand?.name || '').trim()}`,
      `品牌别名：${(Array.isArray(brand?.aliases) ? brand.aliases : []).join('、') || '无'}`,
      `目标品牌行业：${String(brand?.industry || '').trim() || '未提供'}`,
      `目标品牌关键词：${(Array.isArray(brand?.primary_keywords) ? brand.primary_keywords : []).join('、') || '无'}`,
      `竞品提示：${hints.length ? JSON.stringify(hints) : '无'}`,
      '竞品提示只提供名称、别名和业务背景：已配置不等于本回答竞品，未配置也可以是本回答竞品。',
      '只返回一个 JSON 对象，不要 Markdown。',
      `JSON 输出骨架（按需填充数组）：${JSON.stringify(JSON_OUTPUT_SKELETON)}`,
      'entities：列出回答中出现的全部品牌或公司实体，不限于目标品牌和已配置竞品；每项只含 name、type(brand|company)。',
      'mentions：为每个实体列出原回答实际出现过的不同短名称或别名；每项只含 entity_name 和 surface_forms。',
      '每个 entities 项都必须至少有一个 mentions 项；不要返回无法用原回答短实体词定位的 entity。',
      '相同 surface form 不必按出现次数重复返回，也不必负责提及顺序；程序会用 surface_forms 扫描原回答并计算次数和顺序。',
      'surface_forms 只能放原回答实际出现的短实体词，不要复制完整句子；不要人为限制 surface_forms 数量。',
      'target_entity_name：判断 entities 中哪一项对应目标品牌；必须精确引用 entities.name，目标品牌未出现时返回 null。不要让程序再按名称相似度猜测。',
      'competitor_relations：目标实体之外的每个 entities 项都必须恰好返回一项；entity_name 精确引用 entities.name，relation 只能是 competitor 或 non_competitor，并提供非空 reason。',
      '即使 target_entity_name 为 null，也必须判断全部 entities：此时 competitor_relations 长度必须等于 entities 长度，不得返回空数组；目标实体非 null 时，长度必须等于 entities 长度减 1。',
      'competitor 表示该实体在当前问题和回答场景中能满足与目标品牌相同需求、可作为替代选择；客户、合作方、平台和机构等不可替代实体必须是 non_competitor。',
      'candidate_lists：抽取同一候选列表，entries 按回答顺序引用 entities.name 且不能重复；只有回答有明确序号或名次、并至少包含 2 个不同实体时 ordered=true，普通项目符号、单项列表或正文顺序为 false；无法精确引用 entities.name 时就省略该项。',
      'recommendations：只抽取明确建议、首选、优先或明确认可的品牌/公司；每项只含 entity_name、kind，kind 固定为 explicit；普通列举不算推荐。',
      'claims：抽取回答对品牌/公司的事实性声称，每项只含 subject_name、predicate、value、qualifier；无法精确引用 entities.name 时就省略该项；这只是待核验声明，不代表事实正确。',
      'sentiment：只判断目标品牌，返回 label(positive|neutral|negative)、reason、risk_terms。',
      '所有 entity_name、subject_name 和 entries 都必须精确引用 entities.name。',
      '不要返回 mention_count、recommended、rank、比例、分数、SOV 或任何汇总指标；程序会根据原回答扫描结果、数组关系和候选顺序统一计算。',
      '不要返回引用数量、来源 URL 或官网判断；引用由系统直接解析监测平台原始响应，避免模型猜测。',
      `原回答：\n${String(responseText || '')}`
    ].join('\n');
  }

  buildRequestParameters(platform = {}) {
    const requestBody = platform.adapter_type === 'openai_responses'
      ? {
        model: String(platform.default_model || ''),
        input: [{
          role: 'user',
          content: [{
            type: 'input_text',
            text: '<运行时注入完整结构化提示词>'
          }]
        }],
        ...this.buildAnalysisRequestOptions(platform)
      }
      : {
        model: String(platform.default_model || ''),
        messages: [{
          role: 'user',
          content: '<运行时注入完整结构化提示词>'
        }],
        ...this.buildAnalysisRequestOptions(platform)
      };
    return {
      adapter_type: String(platform.adapter_type || ''),
      request_body: requestBody,
      runtime_policy: {
        timeout_seconds: ANALYSIS_REQUEST_PROFILE.timeout_seconds,
        max_attempts: ANALYSIS_REQUEST_PROFILE.max_attempts,
        web_search: ANALYSIS_REQUEST_PROFILE.web_search,
        token_limit: ANALYSIS_REQUEST_PROFILE.token_limit
      }
    };
  }

  getPromptDefinition(platform = null) {
    return {
      version: ANALYSIS_METHOD,
      template: this.buildPrompt({
        question: '{{当前问题}}',
        responseText: '{{待分析的 AI 回答}}',
        brand: {
          name: '{{目标品牌}}',
          aliases: ['{{品牌别名}}'],
          industry: '{{目标品牌行业}}',
          primary_keywords: ['{{目标品牌关键词}}']
        },
        competitorHints: [{ name: '{{竞品提示}}' }]
      }),
      runtime_fields: [...PROMPT_RUNTIME_FIELDS],
      expected_output: EXPECTED_OUTPUT,
      request_profile: { ...ANALYSIS_REQUEST_PROFILE },
      request_parameters: platform ? this.buildRequestParameters(platform) : null
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
    if (!Object.prototype.hasOwnProperty.call(parsed, 'competitor_relations')) {
      throw new AIResponseAnalysisError(
        'competitor_relations 不能为空',
        'analysis_relation_incomplete'
      );
    }
    const targetEntityName = normalizeTargetEntityName(
      parsed.target_entity_name,
      entityMap
    );
    const structured = {
      schema_version: STRUCTURE_VERSION,
      entities,
      mentions,
      target_entity_name: targetEntityName,
      competitor_relations: normalizeCompetitorRelations(
        parsed.competitor_relations,
        entities,
        targetEntityName,
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
      claims: normalizeClaims(parsed.claims ?? [], entityMap),
      sentiment: normalizeSentiment(parsed.sentiment)
    };
    return structured;
  }

  calculate(structured) {
    const targetEntity = structured.entities.find(
      (entity) => entity.name === structured.target_entity_name
    ) || null;
    const target = entityObservations(targetEntity, structured);
    const relationMap = new Map(
      structured.competitor_relations.map((item) => [
        compact(item.entity_name),
        item
      ])
    );
    const competitionEntities = structured.entities
      .filter((entity) => compact(entity.name) !== compact(targetEntity?.name))
      .map((entity) => {
      const relation = relationMap.get(compact(entity.name));
      const observation = entityObservations(entity, structured);
      return {
        name: entity.name,
        relation: relation.relation,
        reason: relation.reason,
        mentions: observation.mentions,
        surface_forms: observation.surface_forms
      };
    });
    const competitorMentionTotal = competitionEntities
      .filter((item) => item.relation === 'competitor')
      .reduce((total, item) => total + item.mentions, 0);
    const mentionTotal = target.mentions + competitorMentionTotal;
    return {
      metric_semantics_version: CURRENT_METRIC_SEMANTICS,
      brand_mentioned: target.mentioned,
      brand_mentions: target.mentions,
      brand_position: target.list_rank,
      brand_rank: target.list_rank,
      brand_recommended: target.recommended,
      visibility_score: target.mentions,
      answer_competitor_share: mentionTotal > 0
        ? Number(((target.mentions / mentionTotal) * 100).toFixed(2))
        : null,
      sov_numerator: target.mentions,
      sov_denominator: mentionTotal,
      competition_entities: competitionEntities,
      sentiment: structured.sentiment.label,
      sentiment_reason: structured.sentiment.reason || null,
      sentiment_risk_terms: structured.sentiment.risk_terms,
      analysis_structure: structured
    };
  }

  buildAnalysisRequestOptions(platform) {
    const options = { temperature: ANALYSIS_REQUEST_PROFILE.temperature };
    if (platform?.adapter_type === 'openai_chat_completions') {
      options.response_format = { type: 'json_object' };
    }
    if (platform?.adapter_type === 'openai_responses') {
      options.reasoning = { effort: 'none' };
    }
    if (platform?.code === 'deepseek') {
      options.thinking = { type: 'disabled' };
    }
    return options;
  }

  getFinishReason(connection) {
    return connection?.data?.choices?.[0]?.finish_reason
      || connection?.data?.incomplete_details?.reason
      || null;
  }

  buildDiagnostics(connection, platform, attempt, stage) {
    const sourceUsage = connection?.data?.usage;
    const usage = {};
    const usageFields = {
      prompt_tokens: sourceUsage?.prompt_tokens ?? sourceUsage?.input_tokens,
      completion_tokens: sourceUsage?.completion_tokens ?? sourceUsage?.output_tokens,
      total_tokens: sourceUsage?.total_tokens
    };
    Object.entries(usageFields).forEach(([field, sourceValue]) => {
      const value = Number(sourceValue);
      if (Number.isFinite(value) && value >= 0) usage[field] = value;
    });
    return {
      stage,
      attempt_count: attempt,
      platform: String(platform?.code || ''),
      model: String(platform?.default_model || ''),
      finish_reason: this.getFinishReason(connection),
      output_length: String(connection?.text || '').length,
      usage
    };
  }

  assertCompleteResponse(connection) {
    const finishReason = this.getFinishReason(connection);
    if (finishReason === 'length' || connection?.data?.status === 'incomplete') {
      throw new AIResponseAnalysisError(
        'AI 分析输出因长度限制被截断',
        'analysis_output_truncated',
        { finish_reason: finishReason || 'incomplete' }
      );
    }
    return finishReason;
  }

  async analyze({
    question,
    responseText,
    brand,
    competitorHints,
    includeRawOutput = false
  }) {
    const normalizedQuestion = String(question || '').trim();
    const normalizedResponseText = String(responseText || '');
    if (!normalizedQuestion || !normalizedResponseText.trim()) {
      throw new AIResponseAnalysisError(
        '当前问题和原回答不能为空',
        'analysis_context_missing'
      );
    }
    const platform = await this.configService.getAnalysisPlatform();
    const hints = Array.isArray(competitorHints) ? competitorHints : [];
    const basePrompt = this.buildPrompt({
      question: normalizedQuestion,
      responseText: normalizedResponseText,
      brand,
      competitorHints: hints
    });
    let lastError = null;
    let lastInvalidOutput = '';

    for (let attempt = 1; attempt <= ANALYSIS_REQUEST_PROFILE.max_attempts; attempt += 1) {
      const prompt = attempt === 1 || !lastInvalidOutput
        ? basePrompt
        : [
          basePrompt,
          '',
          '上一次输出未通过结构校验。',
          `具体错误：${lastError?.message || '结构无效'}`,
          '上一次无效输出：',
          lastInvalidOutput,
          '请只修正结构问题，不改变对原回答的语义判断；重新输出一份完整、合法且严格符合约束的 JSON 对象，不要输出解释或 Markdown。'
        ].join('\n');
      const connection = await this.requestService.queryConfig(
        platform,
        prompt,
        {
          retryCount: 0,
          requestOptions: this.buildAnalysisRequestOptions(platform),
          disableWebSearch: true,
          omitTokenLimit: true,
          timeoutSeconds: ANALYSIS_REQUEST_PROFILE.timeout_seconds
        }
      );
      if (!connection?.success) {
        const requestErrorCode = connection?.error_code === 'input_too_long'
          ? 'analysis_input_too_long'
          : (connection?.error_code || 'analysis_api_failed');
        lastError = new AIResponseAnalysisError(
          connection?.error || 'AI 分析 API 调用失败',
          requestErrorCode,
          this.buildDiagnostics(connection, platform, attempt, 'request')
        );
        if (
          attempt < ANALYSIS_REQUEST_PROFILE.max_attempts
          && RETRYABLE_REQUEST_ERROR_CODES.has(lastError.code)
        ) continue;
        throw lastError;
      }

      try {
        this.assertCompleteResponse(connection);
        const structured = this.parseOutput(connection.text, {
          responseText: normalizedResponseText,
          brand
        });
        const result = {
          ...this.calculate(structured),
          analysis_method: ANALYSIS_METHOD,
          analysis_platform: platform.code,
          analysis_model: platform.default_model,
          analysis_attempts: attempt
        };
        if (includeRawOutput) result.raw_output = connection.text;
        return result;
      } catch (error) {
        lastError = error;
        if (!(error instanceof AIResponseAnalysisError)) throw error;
        lastInvalidOutput = String(connection.text || '');
        error.details = {
          ...this.buildDiagnostics(
            connection,
            platform,
            attempt,
            error.code === 'analysis_output_truncated' ? 'completion' : 'parse_or_validate'
          ),
          ...error.details
        };
        if (attempt >= ANALYSIS_REQUEST_PROFILE.max_attempts) throw error;
      }
    }

    throw lastError;
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
module.exports.ANALYSIS_REQUEST_PROFILE = ANALYSIS_REQUEST_PROFILE;
