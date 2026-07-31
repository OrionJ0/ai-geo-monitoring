const AIPlatformRequestService = require('./AIPlatformRequestService');
const AIAnalysisConfigService = require('./AIAnalysisConfigService');
const {
  CURRENT_ANALYSIS_CONTRACT,
  CURRENT_STRUCTURE_VERSION,
  CURRENT_METRIC_SEMANTICS
} = require('./GeoMetricSemanticsService');

const ANALYSIS_METHOD = CURRENT_ANALYSIS_CONTRACT;
const STRUCTURE_VERSION = CURRENT_STRUCTURE_VERSION;
const PROMPT_REVISION = 'semantic_evidence_few_shot_v7';
const VALID_ENTITY_TYPES = new Set(['brand', 'company', 'other_organization']);
const VALID_COMPETITOR_RELATIONS = new Set(['competitor', 'non_competitor']);
const VALID_RECOMMENDATION_KINDS = new Set(['explicit']);
const VALID_SENTIMENTS = new Set(['positive', 'neutral', 'negative']);
const DEFAULT_TEMPERATURE = 0;
const ANALYSIS_REQUEST_PROFILE = Object.freeze({
  temperature: null,
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
  '待分析的 AI 回答'
]);
const EXPECTED_OUTPUT = Object.freeze({
  entities: [{
    name: '回答中的品牌、公司或其他具名组织标准名称',
    type: 'brand | company | other_organization'
  }],
  mentions: [{
    entity_name: '必须引用 entities.name',
    surface_forms: ['原回答中实际出现的实体短名称、全称或别名；程序据此计算次数和顺序']
  }],
  target_entity_name: '目标品牌对应的 entities.name；回答未提及则为 null',
  competitor_relations: [{
    entity_name: '必须精确引用非目标 entities.name',
    relation: 'competitor | non_competitor',
    reason: '当前问题和回答场景中的替代关系判断理由',
    evidence: ['支持判断且能在原回答中精确定位的原文片段']
  }],
  candidate_lists: [{
    ordered: true,
    entries: ['按回答表达的候选顺序引用 entities.name'],
    reason: '为什么该候选集合有序或无序',
    evidence: ['支持判断且能在原回答中精确定位的原文片段']
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
    reason: '回答对目标品牌整体选择倾向的判断依据',
    evidence: ['目标品牌相关且能在原回答中精确定位的原文片段；目标未提及时为空数组'],
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
    evidence: [],
    risk_terms: []
  }
});
const CHOICE_SET_EXAMPLES = Object.freeze([
  {
    focus: 'target_absent',
    input: {
      question: '企业终端安全产品有哪些可选厂商？',
      target_brand: '甲盾',
      answer: '乙卫和丙安都提供企业终端防护产品，可并列比较。'
    },
    output: {
      entities: [
        { name: '乙卫', type: 'brand' },
        { name: '丙安', type: 'brand' }
      ],
      mentions: [
        { entity_name: '乙卫', surface_forms: ['乙卫'] },
        { entity_name: '丙安', surface_forms: ['丙安'] }
      ],
      target_entity_name: null,
      competitor_relations: [
        {
          entity_name: '乙卫',
          relation: 'competitor',
          reason: '在当前问题中是企业终端安全产品的可替代选择',
          evidence: ['乙卫和丙安都提供企业终端防护产品']
        },
        {
          entity_name: '丙安',
          relation: 'competitor',
          reason: '在当前问题中是企业终端安全产品的可替代选择',
          evidence: ['乙卫和丙安都提供企业终端防护产品']
        }
      ],
      candidate_lists: [{
        ordered: false,
        entries: ['乙卫', '丙安'],
        reason: '回答明确表示两者并列，没有先后',
        evidence: ['可并列比较']
      }],
      recommendations: [],
      claims: [],
      sentiment: {
        label: 'neutral',
        reason: '回答未提及目标品牌',
        evidence: [],
        risk_terms: []
      }
    }
  },
  {
    focus: 'exhaustive_entities_neutral',
    input: {
      question: '园区周界入侵告警方案有哪些品牌可选？',
      target_brand: '甲盾',
      answer: '甲盾为华东大学部署了光纤周界方案，系统运行在云舟云；乙卫也提供同类园区周界告警产品。'
    },
    output: {
      entities: [
        { name: '甲盾', type: 'brand' },
        { name: '华东大学', type: 'other_organization' },
        { name: '云舟云', type: 'company' },
        { name: '乙卫', type: 'brand' }
      ],
      mentions: [
        { entity_name: '甲盾', surface_forms: ['甲盾'] },
        { entity_name: '华东大学', surface_forms: ['华东大学'] },
        { entity_name: '云舟云', surface_forms: ['云舟云'] },
        { entity_name: '乙卫', surface_forms: ['乙卫'] }
      ],
      target_entity_name: '甲盾',
      competitor_relations: [
        {
          entity_name: '华东大学',
          relation: 'non_competitor',
          reason: '回答中是方案使用方，不是替代供应商',
          evidence: ['甲盾为华东大学部署了光纤周界方案']
        },
        {
          entity_name: '云舟云',
          relation: 'non_competitor',
          reason: '回答中是承载平台，不是替代供应商',
          evidence: ['系统运行在云舟云']
        },
        {
          entity_name: '乙卫',
          relation: 'competitor',
          reason: '在当前问题中提供同类可替代产品',
          evidence: ['乙卫也提供同类园区周界告警产品']
        }
      ],
      candidate_lists: [],
      recommendations: [],
      claims: [],
      sentiment: {
        label: 'neutral',
        reason: '回答只陈述目标品牌的部署事实，没有表达选择倾向',
        evidence: ['甲盾为华东大学部署了光纤周界方案'],
        risk_terms: []
      }
    }
  },
  {
    focus: 'unordered_table_neutral',
    input: {
      question: '园区周界入侵告警方案有哪些品牌可选？',
      target_brand: '甲盾',
      answer: '| 品牌 | 技术路线 |\n| --- | --- |\n| 甲盾 | 光纤感知 |\n| 乙卫 | 雷达融合 |\n两者都能提供园区周界入侵告警。'
    },
    output: {
      entities: [
        { name: '甲盾', type: 'brand' },
        { name: '乙卫', type: 'brand' }
      ],
      mentions: [
        { entity_name: '甲盾', surface_forms: ['甲盾'] },
        { entity_name: '乙卫', surface_forms: ['乙卫'] }
      ],
      target_entity_name: '甲盾',
      competitor_relations: [
        {
          entity_name: '乙卫',
          relation: 'competitor',
          reason: '技术路线虽不同，但在当前问题中满足同一购买需求',
          evidence: ['两者都能提供园区周界入侵告警']
        }
      ],
      candidate_lists: [{
        ordered: false,
        entries: ['甲盾', '乙卫'],
        reason: '表格行序只用于展示并列候选，没有表达排名方向',
        evidence: ['| 甲盾 | 光纤感知 |', '| 乙卫 | 雷达融合 |']
      }],
      recommendations: [],
      claims: [],
      sentiment: {
        label: 'neutral',
        reason: '回答客观比较目标品牌的技术路线，没有给出偏好',
        evidence: ['| 甲盾 | 光纤感知 |'],
        risk_terms: []
      }
    }
  },
  {
    focus: 'numbered_ordered',
    input: {
      question: '园区周界方案品牌如何排序？',
      target_brand: '甲盾',
      answer: '按综合适配度从高到低：\n1. 甲盾：项目经验更匹配。\n2. 乙卫：集成能力较强。'
    },
    output: {
      entities: [
        { name: '甲盾', type: 'brand' },
        { name: '乙卫', type: 'brand' }
      ],
      mentions: [
        { entity_name: '甲盾', surface_forms: ['甲盾'] },
        { entity_name: '乙卫', surface_forms: ['乙卫'] }
      ],
      target_entity_name: '甲盾',
      competitor_relations: [
        {
          entity_name: '乙卫',
          relation: 'competitor',
          reason: '回答将两者放在园区周界方案的同一排序中',
          evidence: ['按综合适配度从高到低']
        }
      ],
      candidate_lists: [{
        ordered: true,
        entries: ['甲盾', '乙卫'],
        reason: '回答用编号候选清单表达了从高到低的完整次序',
        evidence: [
          '按综合适配度从高到低',
          '1. 甲盾：项目经验更匹配。',
          '2. 乙卫：集成能力较强。'
        ]
      }],
      recommendations: [],
      claims: [],
      sentiment: {
        label: 'positive',
        reason: '回答把目标品牌列在综合适配度第一位并给出匹配理由',
        evidence: ['1. 甲盾：项目经验更匹配。'],
        risk_terms: []
      }
    }
  },
  {
    focus: 'preference_set_not_full_rank',
    input: {
      question: '园区周界方案有哪些厂家可选？',
      target_brand: '甲盾',
      answer: '优先联系甲盾获取方案，同时可对比乙卫、丙安的产品。'
    },
    output: {
      entities: [
        { name: '甲盾', type: 'brand' },
        { name: '乙卫', type: 'brand' },
        { name: '丙安', type: 'brand' }
      ],
      mentions: [
        { entity_name: '甲盾', surface_forms: ['甲盾'] },
        { entity_name: '乙卫', surface_forms: ['乙卫'] },
        { entity_name: '丙安', surface_forms: ['丙安'] }
      ],
      target_entity_name: '甲盾',
      competitor_relations: [
        {
          entity_name: '乙卫',
          relation: 'competitor',
          reason: '回答把乙卫作为同一需求下的对比候选',
          evidence: ['同时可对比乙卫、丙安']
        },
        {
          entity_name: '丙安',
          relation: 'competitor',
          reason: '回答把丙安作为同一需求下的对比候选',
          evidence: ['同时可对比乙卫、丙安']
        }
      ],
      candidate_lists: [{
        ordered: false,
        entries: ['甲盾', '乙卫', '丙安'],
        reason: '回答只表达甲盾优先以及另外两家可对比，没有给三家分配完整相对名次',
        evidence: ['优先联系甲盾获取方案', '同时可对比乙卫、丙安']
      }],
      recommendations: [{ entity_name: '甲盾', kind: 'explicit' }],
      claims: [],
      sentiment: {
        label: 'positive',
        reason: '回答明确建议优先联系目标品牌',
        evidence: ['优先联系甲盾获取方案'],
        risk_terms: []
      }
    }
  },
  {
    focus: 'multi_group_local_order',
    input: {
      question: '感知系统有哪些厂家可选？',
      target_brand: '甲盾',
      answer: '第一类：\n1. 乙卫\n2. 丙安\n第二类：\n1. 甲盾\n2. 丁科'
    },
    output: {
      entities: [
        { name: '乙卫', type: 'brand' },
        { name: '丙安', type: 'brand' },
        { name: '甲盾', type: 'brand' },
        { name: '丁科', type: 'brand' }
      ],
      mentions: [
        { entity_name: '乙卫', surface_forms: ['乙卫'] },
        { entity_name: '丙安', surface_forms: ['丙安'] },
        { entity_name: '甲盾', surface_forms: ['甲盾'] },
        { entity_name: '丁科', surface_forms: ['丁科'] }
      ],
      target_entity_name: '甲盾',
      competitor_relations: [
        {
          entity_name: '乙卫',
          relation: 'competitor',
          reason: '回答在宽泛问题下把乙卫列为可选厂家',
          evidence: ['第一类：']
        },
        {
          entity_name: '丙安',
          relation: 'competitor',
          reason: '回答在宽泛问题下把丙安列为可选厂家',
          evidence: ['第一类：']
        },
        {
          entity_name: '丁科',
          relation: 'competitor',
          reason: '与目标品牌同属第二类候选厂家',
          evidence: ['第二类：']
        }
      ],
      candidate_lists: [
        {
          ordered: true,
          entries: ['乙卫', '丙安'],
          reason: '第一类中的编号候选次序',
          evidence: ['第一类：', '1. 乙卫', '2. 丙安']
        },
        {
          ordered: true,
          entries: ['甲盾', '丁科'],
          reason: '第二类中的编号候选次序；各分组分别记录候选次序，不压平成全局排名',
          evidence: ['第二类：', '1. 甲盾', '2. 丁科']
        }
      ],
      recommendations: [],
      claims: [],
      sentiment: {
        label: 'neutral',
        reason: '回答只把目标品牌列入候选，没有表达选择倾向',
        evidence: ['1. 甲盾'],
        risk_terms: []
      }
    }
  },
  {
    focus: 'broad_question_multiple_interpretations',
    input: {
      question: '感知电缆有哪些厂家可选？',
      target_brand: '甲盾',
      answer: '这个名称常见两种应用。周界探测可选甲盾和乙卫；电力监测可选丙安和丁科。你尚未限定具体应用。'
    },
    output: {
      entities: [
        { name: '甲盾', type: 'brand' },
        { name: '乙卫', type: 'brand' },
        { name: '丙安', type: 'brand' },
        { name: '丁科', type: 'brand' }
      ],
      mentions: [
        { entity_name: '甲盾', surface_forms: ['甲盾'] },
        { entity_name: '乙卫', surface_forms: ['乙卫'] },
        { entity_name: '丙安', surface_forms: ['丙安'] },
        { entity_name: '丁科', surface_forms: ['丁科'] }
      ],
      target_entity_name: '甲盾',
      competitor_relations: [
        {
          entity_name: '乙卫',
          relation: 'competitor',
          reason: '与目标品牌同属周界探测候选',
          evidence: ['周界探测可选甲盾和乙卫']
        },
        {
          entity_name: '丙安',
          relation: 'competitor',
          reason: '问题没有限定应用，回答把电力监测解释为同一宽泛购买问题的另一类候选',
          evidence: ['电力监测可选丙安和丁科']
        },
        {
          entity_name: '丁科',
          relation: 'competitor',
          reason: '问题没有限定应用，回答把电力监测解释为同一宽泛购买问题的另一类候选',
          evidence: ['电力监测可选丙安和丁科']
        }
      ],
      candidate_lists: [
        {
          ordered: false,
          entries: ['甲盾', '乙卫'],
          reason: '周界探测分组内并列可选',
          evidence: ['周界探测可选甲盾和乙卫']
        },
        {
          ordered: false,
          entries: ['丙安', '丁科'],
          reason: '电力监测分组内并列可选',
          evidence: ['电力监测可选丙安和丁科']
        }
      ],
      recommendations: [],
      claims: [],
      sentiment: {
        label: 'neutral',
        reason: '回答只并列列出目标品牌',
        evidence: ['周界探测可选甲盾和乙卫'],
        risk_terms: []
      }
    }
  },
  {
    focus: 'delivery_role_competition',
    input: {
      question: '园区周界平台谁能建设和交付？',
      target_brand: '甲盾',
      answer: '甲盾提供完整周界平台；乙集成提供系统集成与长期维保，也能承担项目交付；丙研究院参与行业标准研究。'
    },
    output: {
      entities: [
        { name: '甲盾', type: 'brand' },
        { name: '乙集成', type: 'company' },
        { name: '丙研究院', type: 'other_organization' }
      ],
      mentions: [
        { entity_name: '甲盾', surface_forms: ['甲盾'] },
        { entity_name: '乙集成', surface_forms: ['乙集成'] },
        { entity_name: '丙研究院', surface_forms: ['丙研究院'] }
      ],
      target_entity_name: '甲盾',
      competitor_relations: [
        {
          entity_name: '乙集成',
          relation: 'competitor',
          reason: '当前问题询问建设交付方，系统集成和维保能力能满足同一购买需求',
          evidence: ['乙集成提供系统集成与长期维保，也能承担项目交付']
        },
        {
          entity_name: '丙研究院',
          relation: 'non_competitor',
          reason: '回答只说明其参与标准研究，没有独立提供建设交付方案',
          evidence: ['丙研究院参与行业标准研究']
        }
      ],
      candidate_lists: [],
      recommendations: [],
      claims: [],
      sentiment: {
        label: 'neutral',
        reason: '回答只陈述目标品牌的供给能力',
        evidence: ['甲盾提供完整周界平台'],
        risk_terms: []
      }
    }
  },
  {
    focus: 'ordered_positive_alias',
    input: {
      question: '园区周界方案品牌如何排序？',
      target_brand: '上海甲盾科技',
      target_aliases: ['甲盾'],
      answer: '综合适配度：首选甲盾（上海甲盾科技），其次乙卫。甲盾的项目经验更匹配本次需求。'
    },
    output: {
      entities: [
        { name: '上海甲盾科技', type: 'company' },
        { name: '乙卫', type: 'brand' }
      ],
      mentions: [
        { entity_name: '上海甲盾科技', surface_forms: ['甲盾', '上海甲盾科技'] },
        { entity_name: '乙卫', surface_forms: ['乙卫'] }
      ],
      target_entity_name: '上海甲盾科技',
      competitor_relations: [
        {
          entity_name: '乙卫',
          relation: 'competitor',
          reason: '回答把乙卫和目标品牌放入同一方案选择集合',
          evidence: ['首选甲盾（上海甲盾科技），其次乙卫']
        }
      ],
      candidate_lists: [{
        ordered: true,
        entries: ['上海甲盾科技', '乙卫'],
        reason: '回答表达了明确的首选和其次',
        evidence: ['首选甲盾（上海甲盾科技），其次乙卫']
      }],
      recommendations: [{ entity_name: '上海甲盾科技', kind: 'explicit' }],
      claims: [],
      sentiment: {
        label: 'positive',
        reason: '回答把目标品牌作为首选并给出匹配理由',
        evidence: ['甲盾的项目经验更匹配本次需求'],
        risk_terms: []
      }
    }
  },
  {
    focus: 'negative',
    input: {
      question: '园区周界方案应该选择甲盾还是乙卫？',
      target_brand: '甲盾',
      answer: '甲盾和乙卫都能提供方案，但甲盾在本次需求下稳定性不足，不建议优先选择。'
    },
    output: {
      entities: [
        { name: '甲盾', type: 'brand' },
        { name: '乙卫', type: 'brand' }
      ],
      mentions: [
        { entity_name: '甲盾', surface_forms: ['甲盾'] },
        { entity_name: '乙卫', surface_forms: ['乙卫'] }
      ],
      target_entity_name: '甲盾',
      competitor_relations: [
        {
          entity_name: '乙卫',
          relation: 'competitor',
          reason: '回答将两者作为当前需求的替代选择',
          evidence: ['甲盾和乙卫都能提供方案']
        }
      ],
      candidate_lists: [],
      recommendations: [],
      claims: [],
      sentiment: {
        label: 'negative',
        reason: '回答明确降低选择目标品牌的意愿',
        evidence: ['甲盾在本次需求下稳定性不足，不建议优先选择'],
        risk_terms: ['稳定性不足']
      }
    }
  }
]);

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

function buildEvidenceSearchText(value) {
  const source = String(value || '');
  const positions = [];
  let text = '';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (/[\s*_`#>|~-]/u.test(character)) continue;
    text += character.toLowerCase();
    positions.push(index);
  }
  return { text, positions };
}

function locateOriginalEvidence(responseText, submittedEvidence) {
  const source = String(responseText || '');
  const submitted = String(submittedEvidence || '').trim();
  if (source.includes(submitted)) return submitted;

  const haystack = buildEvidenceSearchText(source);
  const needle = buildEvidenceSearchText(submitted).text;
  if (!needle) return null;
  const normalizedStart = haystack.text.indexOf(needle);
  if (normalizedStart < 0) return null;
  const sourceStart = haystack.positions[normalizedStart];
  const sourceEnd = haystack.positions[normalizedStart + needle.length - 1];
  if (!Number.isInteger(sourceStart) || !Number.isInteger(sourceEnd)) return null;
  return source.slice(sourceStart, sourceEnd + 1);
}

function normalizeEvidence(value, responseText, field, { required = true } = {}) {
  if (!Array.isArray(value)) {
    throw new AIResponseAnalysisError(`${field} 必须是数组`);
  }
  if (value.length > 20) {
    throw new AIResponseAnalysisError(`${field} 最多返回 20 项`);
  }
  const source = String(responseText || '');
  const seen = new Set();
  const evidence = [];
  value.forEach((item, index) => {
    const text = String(item || '').trim();
    if (!text) {
      throw new AIResponseAnalysisError(`${field}[${index}] 不能为空`);
    }
    const locatedText = locateOriginalEvidence(source, text);
    if (!locatedText) return;
    if (!seen.has(locatedText)) {
      seen.add(locatedText);
      evidence.push(locatedText);
    }
  });
  if (required && evidence.length === 0) {
    const message = value.length
      ? `${field} 无法在原回答中定位任何证据`
      : `${field} 至少包含 1 条原文证据`;
    throw new AIResponseAnalysisError(message);
  }
  return evidence;
}

function normalizeSentiment(value, responseText, targetEntityName) {
  const sentiment = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const label = String(sentiment.label || 'neutral').trim().toLowerCase();
  if (!VALID_SENTIMENTS.has(label)) {
    throw new AIResponseAnalysisError('sentiment.label 不受支持');
  }
  const targetMentioned = Boolean(targetEntityName);
  return {
    label,
    reason: boundedString(sentiment.reason, 'sentiment.reason', 120),
    evidence: normalizeEvidence(
      sentiment.evidence,
      responseText,
      'sentiment.evidence',
      { required: targetMentioned }
    ),
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

function hasUnclosedAliasBracket(value) {
  const expectedClosings = {
    '(': ')',
    '（': '）',
    '[': ']',
    '【': '】'
  };
  const stack = [];
  for (const character of String(value || '')) {
    const expectedClosing = expectedClosings[character];
    if (expectedClosing) {
      stack.push(expectedClosing);
    } else if (stack.at(-1) === character) {
      stack.pop();
    }
  }
  return stack.length > 0;
}

function normalizeMentions(value, responseText, entityMap) {
  if (!Array.isArray(value)) throw new AIResponseAnalysisError('mentions 必须是数组');
  if (value.length > 500) throw new AIResponseAnalysisError('mentions 最多返回 500 项');
  const source = String(responseText || '');
  const formsByEntity = new Map();

  value.forEach((item, index) => {
    const entity = requireEntity(entityMap, item?.entity_name, `mentions[${index}].entity_name`);
    if (!Array.isArray(item?.surface_forms)) {
      throw new AIResponseAnalysisError(`mentions[${index}].surface_forms 必须是数组`);
    }
    const suppliedSurfaceForms = item.surface_forms;
    const surfaceForms = suppliedSurfaceForms.length
      ? suppliedSurfaceForms
      : (source.includes(entity.name) ? [entity.name] : []);
    if (!surfaceForms.length) {
      throw new AIResponseAnalysisError(`mentions[${index}].surface_forms 至少包含 1 个短实体词`);
    }
    const entityKey = compact(entity.name);
    const entityForms = formsByEntity.get(entityKey) || {
      entity_name: entity.name,
      surface_forms: new Set(),
      dropped_count: 0,
      field: `mentions[${index}].surface_forms`
    };
    surfaceForms.forEach((surface, surfaceIndex) => {
      const field = `mentions[${index}].surface_forms[${surfaceIndex}]`;
      const text = String(surface || '').replace(/\s+/gu, ' ').trim();
      if (
        !text
        || text.length > 60
        || /[。！？!?；;\n\r]/u.test(text)
        || !source.includes(text)
      ) {
        entityForms.dropped_count += 1;
        return;
      }
      entityForms.surface_forms.add(text);
    });
    formsByEntity.set(entityKey, entityForms);
  });

  const normalizationWarnings = [];
  formsByEntity.forEach((entry) => {
    if (entry.surface_forms.size === 0) {
      throw new AIResponseAnalysisError(
        `${entry.field} 无法在原回答中定位任何短实体词`,
        'invalid_analysis_output',
        { field: entry.field }
      );
    }
    if (entry.dropped_count > 0 && normalizationWarnings.length < 50) {
      normalizationWarnings.push({
        code: 'unsupported_surface_form_dropped',
        entity_name: entry.entity_name,
        dropped_count: entry.dropped_count
      });
    }
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
    const continuesAliasGroup = previous
      ? hasUnclosedAliasBracket(source.slice(previous.start, occurrence.start))
      : false;
    if (
      previous
      && compact(previous.entity_name) === compact(occurrence.entity_name)
      && !repeatsSameSurface
      && (isAliasSeparator || continuesAliasGroup)
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
  return {
    mentions: mentions.map(({ entity_name, surface_forms }) => ({ entity_name, surface_forms })),
    normalization_warnings: normalizationWarnings
  };
}

function validationField(error) {
  const explicit = String(error?.details?.field || '').trim();
  if (explicit) return explicit.slice(0, 160);
  const matched = String(error?.message || '').match(
    /^([a-z_]+(?:\[\d+\])?(?:\.[a-z_]+(?:\[\d+\])?)*)/i
  );
  if (!matched) return 'root';
  const rootField = matched[1].split(/[.[]/u)[0];
  return [
    'entities',
    'mentions',
    'target_entity_name',
    'competitor_relations',
    'candidate_lists',
    'recommendations',
    'claims',
    'sentiment'
  ].includes(rootField) ? matched[1] : 'root';
}

function correctionRequirement(error) {
  const field = validationField(error);
  if (field.includes('surface_forms')) {
    return '只保留能在完整原回答中逐字定位、长度不超过 60 字且不是完整句子的实体短名称或别名。';
  }
  if (field.includes('evidence')) {
    return '重新引用完整原回答中可逐字定位的原文片段，不要概括、改写或补充。';
  }
  if (field === 'competitor_relations' || error?.code === 'analysis_relation_incomplete') {
    return '逐一覆盖全部非目标实体，引用 entities.name，并为每个关系提供合法关系、理由和原文证据。';
  }
  return '根据完整问题和回答修正该字段及其依赖字段，并重新输出完整 v4 JSON 对象。';
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
  mentionedEntityKeys,
  responseText
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
      ),
      evidence: normalizeEvidence(
        item?.evidence,
        responseText,
        `competitor_relations[${index}].evidence`
      )
    };
  });
  const byEntityName = new Map(
    normalized.map((item) => [compact(item.entity_name), item])
  );
  return expected.map((entity) => byEntityName.get(compact(entity.name)));
}

function normalizeCandidateLists(value, entityMap, mentionedEntityKeys, responseText) {
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
    return {
      ordered: item.ordered,
      entries,
      reason: boundedString(
        item?.reason,
        `candidate_lists[${index}].reason`,
        160
      ),
      evidence: normalizeEvidence(
        item?.evidence,
        responseText,
        `candidate_lists[${index}].evidence`
      )
    };
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

  buildPrompt({ question, responseText, brand }) {
    const analysisInput = {
      question: String(question || '').trim(),
      target_brand: String(brand?.name || '').trim(),
      target_aliases: Array.isArray(brand?.aliases) ? brand.aliases : [],
      target_industry: String(brand?.industry || '').trim() || null,
      target_keywords: Array.isArray(brand?.primary_keywords) ? brand.primary_keywords : [],
      answer: String(responseText || '')
    };
    const examples = CHOICE_SET_EXAMPLES.map((example) => [
      `<example focus="${example.focus}">`,
      `<input>${JSON.stringify(example.input)}</input>`,
      `<output>${JSON.stringify(example.output)}</output>`,
      '</example>'
    ].join('\n')).join('\n');

    return [
      '<analysis_input>',
      JSON.stringify(analysisInput, null, 2),
      '</analysis_input>',
      '',
      '<task>',
      '从买家阅读这条回答的视角，把回答转换为可审查的结构化分析原料；指标由程序另行计算。',
      '</task>',
      '',
      '<analysis_process>',
      '第一阶段，完整抽取：通读回答全部内容，收录实际出现的品牌、公司和其他具名组织；先不要因为它看起来不像竞品而省略。把同一实体的全称和别名归并，并保留原回答中的实际表述。',
      '第二阶段，逐一判断竞争关系：对目标实体之外的每个实体，结合当前问题表达的购买或选择需求，判断买家是否可能把它当作目标品牌的替代选择。以买家问题实际限定的范围为准；问题宽泛且回答给出多个合理应用解释时，各解释下的供应商仍是这次购买问题的候选，不要替买家擅自缩窄需求。问建设或交付方时，能承担集成、实施或维保交付的企业也可能是竞品；只参与研究、标准、采购或合作的组织不是。实体类型本身不决定竞争关系。',
      '第三阶段，独立判断候选顺序：识别回答中的同一候选集合，并判断作者是否表达了相对先后。编号候选清单如果用于组织可比较候选项，就是作者给出的显式次序；编号若只是章节或步骤则不是排名。存在多个类别时，各分组分别记录候选次序，目标排名是目标所在分组内的位置，不能压平成全局次序。不同分组、层级标题、核心厂家与其他备选不能合并成一个全局候选次序；“优先考虑一个、同时对比其他”只表达推荐偏好，不等于给全部候选分配完整名次。普通正文提及顺序、无序项目符号、并列集合和表格行序本身不代表排名；表格只有明确写出排名、名次或比较方向时才是有序候选集合。',
      '第四阶段，判断目标品牌的整体选择倾向：positive 表示回答整体增加选择目标品牌的理由或意愿；neutral 表示主要陈述事实或正反平衡、没有明显选择方向；negative 表示整体降低选择意愿。局部词语不能脱离完整语境决定标签。',
      '第五阶段，输出前静默复核：重新检查是否扫描了全部段落、是否遗漏实体或关系、候选集合是否完整、所有证据是否来自原回答、所有实体引用是否一致。不要输出复核过程。',
      '</analysis_process>',
      '',
      '<examples>',
      examples,
      '</examples>',
      '',
      '<output_contract>',
      '只输出一个 JSON 对象，不要输出 Markdown。',
      `JSON 输出骨架（按需填充数组）：${JSON.stringify(JSON_OUTPUT_SKELETON)}`,
      `字段形状（示例文本说明字段含义，不要原样复制）：${JSON.stringify(EXPECTED_OUTPUT)}`,
      'entities 收录回答中出现的品牌、公司和其他具名组织；mentions 的 entity_name 引用 entities.name，surface_forms 保留回答中实际出现的短实体词。',
      'target_entity_name 引用目标品牌对应的 entities.name，未出现则为 null；competitor_relations 覆盖目标实体之外的全部 entities，并给出 competitor 或 non_competitor、简短理由及原文 evidence。',
      'candidate_lists 记录同一候选集合及作者表达的顺序；ordered 由回答语义决定，reason 和 evidence 说明判断依据。recommendations 只记录回答明确建议的实体，kind 为 explicit。',
      'claims 记录回答中的品牌事实性声称；sentiment 只评价目标品牌，label 为 positive、neutral 或 negative，并提供目标品牌相关 evidence。目标品牌未出现时使用 neutral 作为传输占位，evidence 为空数组。',
      'evidence 中的每条文本必须能在待分析回答中精确定位，不要改写、概括或补充回答没有说过的内容。',
      '所有关系字段中的实体名称引用 entities.name。不要输出提及次数、排序、比例、分数、SOV、引用数量或来源 URL。',
      '</output_contract>'
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
    const requestParameters = platform ? this.buildRequestParameters(platform) : null;
    const requestProfile = { ...ANALYSIS_REQUEST_PROFILE };
    if (platform?.code === 'deepseek') {
      requestProfile.deepseek_thinking = String(
        requestParameters?.request_body?.thinking?.type || 'disabled'
      );
    }
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
        }
      }),
      runtime_fields: [...PROMPT_RUNTIME_FIELDS],
      expected_output: EXPECTED_OUTPUT,
      prompt_revision: PROMPT_REVISION,
      request_profile: requestProfile,
      request_parameters: requestParameters
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
    const normalizedMentions = normalizeMentions(
      parsed.mentions,
      context.responseText,
      entityMap
    );
    const mentions = normalizedMentions.mentions;
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
      ...(normalizedMentions.normalization_warnings.length
        ? { normalization_warnings: normalizedMentions.normalization_warnings }
        : {}),
      target_entity_name: targetEntityName,
      competitor_relations: normalizeCompetitorRelations(
        parsed.competitor_relations,
        entities,
        targetEntityName,
        entityMap,
        mentionedEntityKeys,
        context.responseText
      ),
      candidate_lists: normalizeCandidateLists(
        parsed.candidate_lists,
        entityMap,
        mentionedEntityKeys,
        context.responseText
      ),
      recommendations: normalizeRecommendations(
        parsed.recommendations,
        entityMap,
        mentionedEntityKeys
      ),
      claims: normalizeClaims(parsed.claims ?? [], entityMap),
      sentiment: normalizeSentiment(
        parsed.sentiment,
        context.responseText,
        targetEntityName
      )
    };
    return structured;
  }

  recalculateFromStructure(structured, responseText) {
    const entities = normalizeEntities(structured?.entities);
    const entityMap = buildEntityMap(entities);
    const normalizedMentions = normalizeMentions(
      structured?.mentions,
      responseText,
      entityMap
    );
    return this.calculate({
      ...structured,
      entities,
      mentions: normalizedMentions.mentions,
      ...(Array.isArray(structured?.normalization_warnings)
        && structured.normalization_warnings.length
        ? { normalization_warnings: structured.normalization_warnings.slice(0, 50) }
        : normalizedMentions.normalization_warnings.length
          ? { normalization_warnings: normalizedMentions.normalization_warnings }
          : {})
    });
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
        evidence: relation.evidence,
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
    const isDeepSeek = platform?.code === 'deepseek';
    const options = isDeepSeek
      ? {}
      : { temperature: DEFAULT_TEMPERATURE };
    if (platform?.adapter_type === 'openai_chat_completions') {
      options.response_format = { type: 'json_object' };
    }
    if (platform?.adapter_type === 'openai_responses') {
      options.reasoning = { effort: 'none' };
    }
    if (isDeepSeek) {
      options.thinking = { type: 'disabled' };
    }
    return {
      ...options,
      ...(platform?.analysis_request_options || {})
    };
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
    const basePrompt = this.buildPrompt({
      question: normalizedQuestion,
      responseText: normalizedResponseText,
      brand
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
          '<validation_feedback>',
          `字段路径：${validationField(lastError)}`,
          `错误类型：${lastError?.code || 'invalid_analysis_output'}`,
          `校验信息：${lastError?.message || '结构无效'}`,
          `纠正要求：${correctionRequirement(lastError)}`,
          '</validation_feedback>',
          '上一次无效输出：',
          lastInvalidOutput,
          '请重新通读当前问题和完整回答，根据校验错误重新审阅实体、关系、候选顺序、情绪和原文证据。',
          '不要复用无法在原回答定位的内容；重新输出一份完整、合法且严格符合 v4 契约的 JSON 对象，不要输出解释或 Markdown。'
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
        const calculated = this.calculate(structured);
        const result = {
          ...calculated,
          analysis_structure: {
            ...calculated.analysis_structure,
            prompt_revision: PROMPT_REVISION
          },
          analysis_method: ANALYSIS_METHOD,
          analysis_prompt_revision: PROMPT_REVISION,
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
