const crypto = require('node:crypto');
const SCHEMA_VERSION = 'question_set_run_v1';
const {
  CURRENT_METRIC_SEMANTICS,
  LEGACY_METRIC_SEMANTICS,
  SCOPED_METRIC_SEMANTICS,
  V1_METRIC_SEMANTICS
} = require('./GeoMetricSemanticsService');
const CitationAnalysisService = require('./CitationAnalysisService');
const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_CSV_ROWS = 5000;
const MAX_JSON_CELL_CHARS = 100000;

const REQUIRED_HEADERS = [
  'schema_version',
  'source_run_id',
  'question_set_name',
  'run_started_at',
  'run_completed_at',
  'record_id',
  'question_id',
  'question',
  'question_category',
  'platform',
  'platform_name',
  'model_name',
  'status',
  'error_message',
  'answer',
  'has_metrics',
  'brand_mentioned',
  'brand_mentions',
  'brand_rank',
  'brand_recommended',
  'share_of_voice',
  'citation_count',
  'sentiment',
  'sentiment_reason',
  'competitor_mentions_json',
  'citation_sources_json',
  'record_created_at',
  'record_updated_at'
];
const ANALYSIS_HEADERS = [
  'analysis_method',
  'analysis_platform',
  'analysis_model',
  'analysis_structure_json',
  'analysis_evidence_json'
];
const DIAGNOSTIC_HEADERS = [
  'failure_json',
  'retry_json',
  'analysis_diagnostics_json'
];
const REVERSIBILITY_HEADERS = [
  'analysis_contract_version',
  'answer_format',
  'legacy_citation_count',
  'legacy_citation_sources_json',
  'owned_citation_count',
  'competitor_citation_count',
  'competitor_baseline_json'
];
const METRIC_SEMANTICS_HEADERS = [
  'metric_semantics_version',
  'answer_competitor_share',
  'sov_numerator',
  'sov_denominator',
  'competition_entities_json'
];
const HEADERS = [
  ...REQUIRED_HEADERS,
  ...ANALYSIS_HEADERS,
  ...DIAGNOSTIC_HEADERS,
  ...REVERSIBILITY_HEADERS,
  ...METRIC_SEMANTICS_HEADERS
];
const INTEGRITY_HEADER = 'integrity_signature';
const INTEGRITY_KEY_ID_HEADER = 'integrity_key_id';
const SOURCE_PROJECT_ID_HEADER = 'source_project_id';
const SOURCE_INTEGRITY_STATUS_HEADER = 'source_integrity_status';
const INTEGRITY_ENVELOPE_HEADERS = [
  INTEGRITY_KEY_ID_HEADER,
  SOURCE_PROJECT_ID_HEADER,
  SOURCE_INTEGRITY_STATUS_HEADER,
  INTEGRITY_HEADER
];

class CsvValidationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CsvValidationError';
    this.code = code;
    this.row = Number.isInteger(details.row) ? details.row : null;
    this.column = details.column || null;
  }
}

function fieldError(code, line, column, message) {
  return new CsvValidationError(
    code,
    `第 ${line} 行 ${column} ${message}`,
    { row: line, column }
  );
}

function dateValue(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function protectFormula(value) {
  const text = String(value ?? '');
  if (text.startsWith('\t')) return `\t${text}`;
  return /^[=+\-@]/.test(text) ? `\t${text}` : text;
}

function unprotectFormula(value) {
  const text = String(value ?? '');
  if (text.startsWith('\t\t')) return text.slice(1);
  return /^\t[=+\-@]/.test(text) ? text.slice(1) : text;
}

function csvEscape(value) {
  const text = typeof value === 'string' ? protectFormula(value) : String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function v5SemanticCell(row, field, fallback) {
  if (String(row?.analysis_method || '') !== 'ai_structured_v5') return fallback;
  const semantic = row?.analysis_structure?.target_semantics?.[field];
  return semantic?.status === 'assessed' ? semantic.value : '';
}

function signatureForRows(rows, integrityKey, {
  integrityKeyId,
  sourceProjectId,
  sourceIntegrityStatus
}) {
  return crypto
    .createHmac('sha256', integrityKey)
    .update(JSON.stringify({
      headers: HEADERS,
      integrity_key_id: integrityKeyId,
      source_project_id: String(sourceProjectId),
      source_integrity_status: sourceIntegrityStatus,
      rows: rows.map((cells) => cells.map((value) => String(value ?? '')))
    }))
    .digest('hex');
}

function buildCsv(report, {
  integrityKey = null,
  integrityKeyId = null,
  sourceProjectId = null,
  sourceIntegrityStatus = null
} = {}) {
  const rows = (Array.isArray(report?.rows) ? report.rows : []).map((row) => [
    SCHEMA_VERSION,
    report.id,
    report.question_set_name,
    dateValue(report.started_at),
    dateValue(report.completed_at),
    row.record_id ?? '',
    row.question_id ?? '',
    row.question,
    row.question_category,
    row.platform,
    row.platform_name,
    row.model_name,
    row.status,
    row.error_message,
    row.answer,
    Boolean(row.has_metrics),
    Boolean(row.brand_mentioned),
    Number(row.brand_mentions || 0),
    v5SemanticCell(row, 'rank', row.brand_rank ?? '') ?? '',
    v5SemanticCell(row, 'recommendation', Boolean(row.brand_recommended)),
    row.share_of_voice == null ? '' : Number(row.share_of_voice),
    Number(row.citation_count || 0),
    v5SemanticCell(row, 'sentiment', row.sentiment),
    row.sentiment_reason,
    JSON.stringify(Array.isArray(row.competitor_mentions) ? row.competitor_mentions : []),
    JSON.stringify(Array.isArray(row.citation_sources) ? row.citation_sources : []),
    dateValue(row.created_at),
    dateValue(row.updated_at),
    row.analysis_method || 'legacy_rules_v1',
    row.analysis_platform || '',
    row.analysis_model || '',
    JSON.stringify(
      row.analysis_structure && typeof row.analysis_structure === 'object' && !Array.isArray(row.analysis_structure)
        ? row.analysis_structure
        : {}
    ),
    JSON.stringify(
      row.analysis_evidence && typeof row.analysis_evidence === 'object' && !Array.isArray(row.analysis_evidence)
        ? row.analysis_evidence
        : {}
    ),
    JSON.stringify(row.failure && typeof row.failure === 'object' && !Array.isArray(row.failure) ? row.failure : {}),
    JSON.stringify(row.retry && typeof row.retry === 'object' && !Array.isArray(row.retry) ? row.retry : {}),
    JSON.stringify(
      row.analysis_diagnostics
        && typeof row.analysis_diagnostics === 'object'
        && !Array.isArray(row.analysis_diagnostics)
        ? row.analysis_diagnostics
        : {}
    ),
    report.analysis_contract_version || '',
    row.answer_format === 'markdown_v1' ? 'markdown_v1' : 'plain_text',
    row.legacy_citation_count ?? '',
    JSON.stringify(Array.isArray(row.legacy_citation_sources) ? row.legacy_citation_sources : []),
    row.owned_citation_count ?? '',
    row.competitor_citation_count ?? '',
    JSON.stringify(Array.isArray(row.competitor_mentions) ? row.competitor_mentions : []),
    row.metric_semantics_version
      || report.metric_semantics_version
      || LEGACY_METRIC_SEMANTICS,
    row.answer_competitor_share == null ? '' : Number(row.answer_competitor_share),
    row.sov_numerator == null ? '' : Number(row.sov_numerator),
    row.sov_denominator == null ? '' : Number(row.sov_denominator),
    JSON.stringify(Array.isArray(row.competition_entities) ? row.competition_entities : [])
  ]);
  const signed = Boolean(
    integrityKey
    && integrityKeyId
    && sourceProjectId
    && sourceIntegrityStatus
  );
  const outputHeaders = signed ? [...HEADERS, ...INTEGRITY_ENVELOPE_HEADERS] : HEADERS;
  const integritySignature = signed
    ? signatureForRows(rows, integrityKey, {
        integrityKeyId,
        sourceProjectId,
        sourceIntegrityStatus
      })
    : null;
  const outputRows = signed
    ? rows.map((row) => [
        ...row,
        integrityKeyId,
        sourceProjectId,
        sourceIntegrityStatus,
        integritySignature
      ])
    : rows;
  return `\uFEFF${[outputHeaders, ...outputRows].map((row) => row.map(csvEscape).join(',')).join('\n')}`;
}

function parseCsvRows(csv) {
  const text = String(csv || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (quoted) throw new CsvValidationError('CSV_SYNTAX_ERROR', 'CSV 存在未闭合的引号');
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((item) => item.some((cell) => String(cell).trim() !== ''));
}

function parseBoolean(value, column, line) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0' || normalized === '') return false;
  throw fieldError('INVALID_FIELD', line, column, '不是有效布尔值');
}

function parseFiniteNumber(value, column, line, { nullable = false } = {}) {
  const text = String(value ?? '').trim();
  if (!text && nullable) return null;
  const parsed = Number(text || 0);
  if (!Number.isFinite(parsed)) {
    throw fieldError('INVALID_FIELD', line, column, '不是有效数字');
  }
  return parsed;
}

function parsePositiveInteger(value, column, line, { nullable = false } = {}) {
  const parsed = parseFiniteNumber(value, column, line, { nullable });
  if (parsed === null) return null;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw fieldError('INVALID_POSITIVE_INTEGER', line, column, '必须是正整数');
  }
  return parsed;
}

function parseNonNegativeInteger(value, column, line, { nullable = false } = {}) {
  const parsed = parseFiniteNumber(value, column, line, { nullable });
  if (parsed === null) return null;
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw fieldError('INVALID_NON_NEGATIVE_INTEGER', line, column, '必须是非负整数');
  }
  return parsed;
}

function parsePercentage(value, column, line) {
  const parsed = parseFiniteNumber(value, column, line, { nullable: true });
  if (parsed === null) return null;
  if (parsed < 0 || parsed > 100) {
    throw fieldError('OUT_OF_RANGE', line, column, '必须在 0 到 100 之间');
  }
  return parsed;
}

function parsePositiveNumber(value, column, line, { nullable = false } = {}) {
  const parsed = parseFiniteNumber(value, column, line, { nullable });
  if (parsed === null) return null;
  if (parsed <= 0) {
    throw fieldError('OUT_OF_RANGE', line, column, '必须是正数');
  }
  return parsed;
}

function validateJsonCellLength(value, column, line) {
  if (String(value || '').length > MAX_JSON_CELL_CHARS) {
    throw fieldError(
      'JSON_FIELD_TOO_LARGE',
      line,
      column,
      `不能超过 ${MAX_JSON_CELL_CHARS} 个字符`
    );
  }
}

function parseJsonArray(value, column, line) {
  validateJsonCellLength(value, column, line);
  try {
    const parsed = JSON.parse(value || '[]');
    if (!Array.isArray(parsed)) throw new Error('not-array');
    return parsed;
  } catch {
    throw fieldError('INVALID_FIELD', line, column, '不是有效 JSON 数组');
  }
}

function parseJsonObject(value, column, line) {
  validateJsonCellLength(value, column, line);
  try {
    const parsed = JSON.parse(value || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not-object');
    return parsed;
  } catch {
    throw fieldError('INVALID_FIELD', line, column, '不是有效 JSON 对象');
  }
}

function parseOptionalJsonObject(value, column, line) {
  const parsed = parseJsonObject(value, column, line);
  return Object.keys(parsed).length ? parsed : null;
}

function validateAnalysisContract({
  version,
  method,
  metricVersion,
  line,
  noAnalysisResult = false
}) {
  const supportedContracts = new Set([
    null,
    'geo_metric_input_v2',
    'legacy_unknown',
    'ai_structured_v1',
    'ai_structured_v2',
    'ai_structured_v3',
    'ai_structured_v4',
    'ai_structured_v5'
  ]);
  if (!supportedContracts.has(version)) {
    throw fieldError(
      'UNSUPPORTED_ANALYSIS_CONTRACT',
      line,
      'analysis_contract_version',
      '不受支持'
    );
  }
  if (method.length > 40) {
    throw fieldError(
      'INVALID_FIELD',
      line,
      'analysis_method',
      '不能超过 40 个字符'
    );
  }
  const supportedMethods = new Set([
    'legacy_rules_v1',
    'ai_structured_v1',
    'ai_structured_v2',
    'ai_structured_v3',
    'ai_structured_v4',
    'ai_structured_v5'
  ]);
  if (!supportedMethods.has(method)) {
    throw fieldError(
      'UNSUPPORTED_ANALYSIS_METHOD',
      line,
      'analysis_method',
      '不受支持'
    );
  }
  if (noAnalysisResult && method === 'legacy_rules_v1') return;
  const legacyContractByMethod = {
    legacy_rules_v1: new Set([null, 'legacy_unknown']),
    ai_structured_v1: new Set([null, 'legacy_unknown', 'ai_structured_v1']),
    ai_structured_v2: new Set([
      null,
      'legacy_unknown',
      'geo_metric_input_v2',
      'ai_structured_v2'
    ])
  };
  const historicalLegacyPair = metricVersion === LEGACY_METRIC_SEMANTICS
    && legacyContractByMethod[method]?.has(version);
  const historicalVersionedPair = metricVersion === V1_METRIC_SEMANTICS
    && ['ai_structured_v3', 'ai_structured_v4'].includes(method)
    && [null, 'legacy_unknown', method].includes(version);
  const currentV5Pair = version === 'ai_structured_v5'
    && metricVersion === SCOPED_METRIC_SEMANTICS
    && method === 'ai_structured_v5';
  if (!historicalLegacyPair && !historicalVersionedPair && !currentV5Pair) {
    throw fieldError(
      'ANALYSIS_CONTRACT_MISMATCH',
      line,
      'analysis_method',
      '与分析合同或指标语义版本不一致'
    );
  }
}

function validateNoAnalysisResult({
  line,
  brandMentioned,
  brandMentions,
  brandRank,
  brandRecommended,
  sentiment,
  shareOfVoice,
  answerCompetitorShare,
  sovNumerator,
  sovDenominator,
  competitorBaseline,
  competitionEntities,
  analysisStructure,
  analysisEvidence
}) {
  const structureKeys = Object.keys(analysisStructure);
  const citations = analysisStructure.citations;
  const citationsValid = citations === undefined || (
    plainObject(citations)
    && Object.keys(citations).every((field) => (
      ['semantics_version', 'evidence_status'].includes(field)
    ))
    && typeof citations.semantics_version === 'string'
    && citations.semantics_version.length > 0
    && citations.semantics_version.length <= 40
    && (
      citations.evidence_status === undefined
      || (
        typeof citations.evidence_status === 'string'
        && citations.evidence_status.length > 0
        && citations.evidence_status.length <= 40
      )
    )
  );
  const analysisStructureValid = structureKeys.every((field) => field === 'citations')
    && citationsValid;
  if (
    brandMentioned
    || brandMentions !== 0
    || brandRank !== null
    || brandRecommended
    || sentiment !== ''
    || shareOfVoice !== null
    || answerCompetitorShare !== null
    || sovNumerator !== null
    || sovDenominator !== null
    || competitorBaseline.length > 0
    || competitionEntities.length > 0
    || !analysisStructureValid
    || Object.keys(analysisEvidence).length > 0
  ) {
    throw fieldError(
      'FAILED_ROW_METRICS_NOT_EMPTY',
      line,
      'has_metrics',
      '失败或无指标行不得携带品牌指标、权威指标结构或分析依据'
    );
  }
}

function validateCitationEvidence({
  line,
  analysisStructure,
  citationCount,
  ownedCitationCount,
  competitorCitationCount,
  citationSources
}) {
  const citations = analysisStructure.citations;
  if (!plainObject(citations) || citations.semantics_version !== 'explicit-citation-v2') return;
  // 早期 explicit-citation-v2 快照没有写 evidence_status；仅在字段真正缺失且
  // 计数和来源完全一致时视为历史 explicit，显式 falsy 或其他状态一律拒绝。
  const evidenceStatus = Object.prototype.hasOwnProperty.call(citations, 'evidence_status')
    ? citations.evidence_status
    : 'explicit';
  const normalizedSources = CitationAnalysisService.normalizeSources(
    citationSources,
    null,
    []
  );
  const sourcesCanonical = normalizedSources.length === citationSources.length
    && normalizedSources.every((source, index) => {
      const rawSource = citationSources[index];
      if (!rawSource.url || !rawSource.domain) return true;
      return CitationAnalysisService.canonicalDomain(
        CitationAnalysisService.normalizeDomain(rawSource.domain)
      ) === source.domain;
    });
  const sourceCount = citationSources.length;
  const sourceOwnedCount = citationSources.filter((source) => source.owned === true).length;
  const sourceCompetitorCount = citationSources
    .filter((source) => source.competitor_owned === true).length;
  const explicitConsistent = evidenceStatus === 'explicit'
    && citationCount === sourceCount
    && ownedCitationCount === sourceOwnedCount
    && competitorCitationCount === sourceCompetitorCount
    && sourcesCanonical;
  const unavailableConsistent = evidenceStatus === 'unavailable'
    && citationCount === 0
    && ownedCitationCount === 0
    && competitorCitationCount === 0
    && sourceCount === 0;
  if (!explicitConsistent && !unavailableConsistent) {
    throw fieldError(
      'INVALID_CITATION_EVIDENCE',
      line,
      'citation_sources_json',
      '显式引用状态、计数和来源不一致'
    );
  }
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sameNullableNumber(left, right) {
  if (left === null || left === undefined) return right === null || right === undefined;
  if (right === null || right === undefined) return false;
  return Number(left) === Number(right);
}

function validateV5AnalysisStructure({
  structure,
  line,
  brandMentioned,
  brandMentions,
  brandRank,
  brandRecommended,
  sentiment,
  answerCompetitorShare,
  sovNumerator,
  sovDenominator
}) {
  const targetFact = structure?.target_fact;
  const targetSemantics = structure?.target_semantics;
  const recommendation = targetSemantics?.recommendation;
  const rank = targetSemantics?.rank;
  const sentimentSemantic = targetSemantics?.sentiment;
  const sov = structure?.sov;
  const fieldStatuses = new Set(['assessed', 'not_applicable', 'unresolved', 'unavailable']);
  const semanticFields = [recommendation, rank, sentimentSemantic];
  const semanticStatuses = semanticFields.map((field) => field?.status);
  const nullish = (value) => value === null || value === undefined;
  const recommendationValid = recommendation?.status === 'assessed'
    ? typeof recommendation.value === 'boolean'
    : nullish(recommendation?.value);
  const rankValid = rank?.status === 'assessed'
    ? (nullish(rank.value) || (Number.isInteger(rank.value) && rank.value > 0))
    : nullish(rank?.value);
  const sentimentValues = new Set(['positive', 'neutral', 'negative']);
  const sentimentValid = sentimentSemantic?.status === 'assessed'
    ? sentimentValues.has(sentimentSemantic.value)
    : nullish(sentimentSemantic?.value);
  const targetSemanticsStatusValid = targetFact?.brand_mentioned === false
    ? targetSemantics?.status === 'complete'
      && semanticStatuses.every((status) => status === 'not_applicable')
    : (
        (targetSemantics?.status === 'complete'
          && semanticStatuses.every((status) => status === 'assessed'))
        || (targetSemantics?.status === 'unavailable'
          && semanticStatuses.every((status) => status === 'unavailable'))
        || (targetSemantics?.status === 'partial'
          && semanticStatuses.some((status) => ['unresolved', 'unavailable'].includes(status))
          && semanticStatuses.every((status) => status !== 'not_applicable')
          && !semanticStatuses.every((status) => status === 'unavailable'))
      );
  const expectedSovValue = Number.isInteger(sov?.denominator) && sov.denominator > 0
    ? Number(((sov.numerator / sov.denominator) * 100).toFixed(2))
    : null;
  const structureValid = (
    structure?.schema_version === 'geo_metric_input_v5'
    && plainObject(targetFact)
    && targetFact.status === 'complete'
    && typeof targetFact.brand_mentioned === 'boolean'
    && Number.isInteger(targetFact.brand_mentions)
    && targetFact.brand_mentions >= 0
    && targetFact.brand_mentioned === (targetFact.brand_mentions > 0)
    && Array.isArray(targetFact.mentions)
    && plainObject(targetSemantics)
    && ['complete', 'partial', 'unavailable'].includes(targetSemantics.status)
    && semanticFields.every((field) => (
      plainObject(field) && fieldStatuses.has(field.status)
    ))
    && recommendationValid
    && rankValid
    && sentimentValid
    && targetSemanticsStatusValid
    && plainObject(sov)
    && sov.status === 'observed_only'
    && sov.scope === 'open_discovery'
    && sov.completeness === 'not_proven'
    && Number.isInteger(sov.numerator)
    && Number.isInteger(sov.denominator)
    && sov.numerator >= 0
    && sov.denominator >= sov.numerator
    && targetFact.brand_mentions === sov.numerator
    && sameNullableNumber(sov.value, expectedSovValue)
  );
  if (!structureValid) {
    throw fieldError(
      'INVALID_V5_ANALYSIS_STRUCTURE',
      line,
      'analysis_structure_json',
      '不符合 v5 权威语义结构'
    );
  }

  const assessedRecommendationValid = recommendation.status === 'assessed'
    ? recommendation.value === brandRecommended
    : brandRecommended === false;
  const assessedRankValid = rank.status === 'assessed'
    ? sameNullableNumber(rank.value, brandRank)
    : brandRank === null;
  const assessedSentimentValid = sentimentSemantic.status === 'assessed'
    ? (typeof sentimentSemantic.value === 'string' && sentimentSemantic.value === sentiment)
    : !sentiment;
  const scalarsMatch = (
    targetFact.brand_mentioned === brandMentioned
    && targetFact.brand_mentions === brandMentions
    && assessedRecommendationValid
    && assessedRankValid
    && assessedSentimentValid
    && sov.numerator === sovNumerator
    && sov.denominator === sovDenominator
    && sameNullableNumber(sov.value, answerCompetitorShare)
  );
  if (!scalarsMatch) {
    throw fieldError(
      'V5_ANALYSIS_SCALAR_MISMATCH',
      line,
      'analysis_structure_json',
      '与兼容指标列不一致'
    );
  }
}

function parseObjectArray(value, column, line) {
  const rows = parseJsonArray(value, column, line);
  rows.forEach((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw fieldError('INVALID_FIELD', line, column, '必须只包含 JSON 对象');
    }
  });
  return rows;
}

function parseCitationSources(value, column, line) {
  const sources = parseObjectArray(value, column, line);
  sources.forEach((source) => {
    for (const field of ['url', 'domain', 'title', 'source_origin', 'source_role']) {
      if (source[field] !== undefined && typeof source[field] !== 'string') {
        throw fieldError('INVALID_FIELD', line, column, `中的 ${field} 必须是字符串`);
      }
    }
    for (const field of ['owned', 'competitor_owned']) {
      if (source[field] !== undefined && typeof source[field] !== 'boolean') {
        throw fieldError('INVALID_FIELD', line, column, `中的 ${field} 必须是布尔值`);
      }
    }
    if (!source.url) return;
    try {
      const parsed = new URL(String(source.url));
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported-protocol');
    } catch {
      throw fieldError('INVALID_FIELD', line, column, '包含非网页链接');
    }
  });
  return sources;
}

function parseCompetitionEntities(
  value,
  column,
  line,
  { requireEvidence = false, answer = '' } = {}
) {
  const entities = parseObjectArray(value, column, line);
  const seen = new Set();
  entities.forEach((entity) => {
    const name = String(entity.name || '').trim();
    const relation = String(entity.relation || '').trim();
    const reason = String(entity.reason || '').replace(/\s+/gu, ' ').trim();
    const mentions = Number(entity.mentions);
    const key = name.toLowerCase();
    const evidence = entity.evidence;
    const validEvidence = (
      Array.isArray(evidence)
      && evidence.length > 0
      && evidence.every((item) => (
        typeof item === 'string'
        && item.trim()
        && String(answer).includes(item.trim())
      ))
    );
    if (
      !name
      || name.length > 120
      || seen.has(key)
      || !['competitor', 'non_competitor'].includes(relation)
      || !Number.isInteger(mentions)
      || mentions < 1
      || !reason
      || reason.length > 160
      || (requireEvidence && !validEvidence)
      || (
        entity.surface_forms !== undefined
        && (
          !Array.isArray(entity.surface_forms)
          || entity.surface_forms.some((item) => typeof item !== 'string' || !item.trim())
        )
      )
    ) {
      throw fieldError(
        'INVALID_COMPETITION_ENTITY',
        line,
        column,
        '包含无效、重复或缺少判断依据的竞争实体'
      );
    }
    seen.add(key);
  });
  return entities;
}

function parseDate(value, column, line, { nullable = true } = {}) {
  if (!value && nullable) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw fieldError('INVALID_FIELD', line, column, '不是有效时间');
  }
  return date;
}

function parseCsv(csv, {
  integrityKeys = [],
  expectedProjectId = null
} = {}) {
  if (Buffer.byteLength(String(csv || ''), 'utf8') > MAX_CSV_BYTES) {
    throw new CsvValidationError('FILE_TOO_LARGE', 'CSV 文件不能超过 5MB');
  }
  const table = parseCsvRows(csv);
  if (table.length < 2) throw new CsvValidationError('EMPTY_FILE', 'CSV 至少需要一行报告数据');
  if (table.length - 1 > MAX_CSV_ROWS) {
    throw new CsvValidationError('TOO_MANY_ROWS', `CSV 不能超过 ${MAX_CSV_ROWS} 行数据`);
  }
  const headers = table[0].map((item) => String(item).trim());
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) {
    throw new CsvValidationError('MISSING_COLUMNS', `CSV 缺少必要列：${missing.join('、')}`);
  }
  const columnIndex = new Map(headers.map((header, index) => [header, index]));
  const integrityHeaderCount = INTEGRITY_ENVELOPE_HEADERS
    .filter((header) => headers.includes(header)).length;
  if (integrityHeaderCount > 0 && integrityHeaderCount !== INTEGRITY_ENVELOPE_HEADERS.length) {
    throw new CsvValidationError(
      'MISSING_COLUMNS',
      `CSV 完整性信封列必须完整：${INTEGRITY_ENVELOPE_HEADERS.join('、')}`
    );
  }
  const hasIntegritySignature = integrityHeaderCount === INTEGRITY_ENVELOPE_HEADERS.length;
  const metricHeaderCount = METRIC_SEMANTICS_HEADERS.filter((header) => headers.includes(header)).length;
  if (metricHeaderCount > 0 && metricHeaderCount !== METRIC_SEMANTICS_HEADERS.length) {
    throw new CsvValidationError(
      'MISSING_COLUMNS',
      `CSV 新版指标列必须完整：${METRIC_SEMANTICS_HEADERS.join('、')}`
    );
  }
  const hasMetricSemanticsHeaders = metricHeaderCount === METRIC_SEMANTICS_HEADERS.length;
  const valueAt = (row, column) => unprotectFormula(row[columnIndex.get(column)] ?? '');
  const allowedStatuses = new Set(['completed', 'failed']);
  let questionSetName = '';
  let sourceRunId = null;
  let startedAt = null;
  let completedAt = null;
  let analysisContractVersion = null;
  let metricSemanticsVersion = null;

  const rows = table.slice(1).map((row, index) => {
    const line = index + 2;
    if (valueAt(row, 'schema_version') !== SCHEMA_VERSION) {
      throw fieldError('UNSUPPORTED_VERSION', line, 'schema_version', '不受支持');
    }
    const currentName = valueAt(row, 'question_set_name').trim();
    if (!currentName) throw fieldError('INVALID_FIELD', line, 'question_set_name', '不能为空');
    if (questionSetName && questionSetName !== currentName) {
      throw fieldError('MIXED_REPORTS', line, 'question_set_name', '与前序行不一致');
    }
    if (currentName.length > 120) {
      throw fieldError('INVALID_FIELD', line, 'question_set_name', '不能超过 120 个字符');
    }
    questionSetName = currentName;
    const currentSourceRunId = parsePositiveInteger(
      valueAt(row, 'source_run_id'),
      'source_run_id',
      line
    );
    if (sourceRunId !== null && sourceRunId !== currentSourceRunId) {
      throw fieldError('MIXED_REPORTS', line, 'source_run_id', '与前序行不一致');
    }
    sourceRunId = currentSourceRunId;
    const currentStartedAt = parseDate(valueAt(row, 'run_started_at'), 'run_started_at', line, { nullable: false });
    const currentCompletedAt = parseDate(valueAt(row, 'run_completed_at'), 'run_completed_at', line);
    if (currentCompletedAt && currentCompletedAt < currentStartedAt) {
      throw fieldError(
        'INVALID_DATE_ORDER',
        line,
        'run_completed_at',
        '不能早于 run_started_at'
      );
    }
    if (startedAt && startedAt.getTime() !== currentStartedAt.getTime()) {
      throw fieldError('MIXED_REPORTS', line, 'run_started_at', '与前序行不一致');
    }
    if (
      index > 0
      && ((completedAt === null) !== (currentCompletedAt === null)
        || (completedAt && completedAt.getTime() !== currentCompletedAt.getTime()))
    ) {
      throw fieldError('MIXED_REPORTS', line, 'run_completed_at', '与前序行不一致');
    }
    startedAt = currentStartedAt;
    completedAt = currentCompletedAt;
    const status = valueAt(row, 'status').trim();
    if (!allowedStatuses.has(status)) {
      throw fieldError(
        status === 'pending' ? 'NON_TERMINAL_STATUS' : 'INVALID_FIELD',
        line,
        'status',
        '只允许 completed 或 failed'
      );
    }
    const analysisMethod = valueAt(row, 'analysis_method').trim() || 'legacy_rules_v1';
    const currentAnalysisContractVersion = valueAt(row, 'analysis_contract_version').trim() || null;
    if (currentAnalysisContractVersion && currentAnalysisContractVersion.length > 40) {
      throw fieldError('INVALID_FIELD', line, 'analysis_contract_version', '不能超过 40 个字符');
    }
    if (
      index > 0
      && analysisContractVersion !== currentAnalysisContractVersion
    ) {
      throw fieldError('MIXED_REPORTS', line, 'analysis_contract_version', '与前序行不一致');
    }
    analysisContractVersion = currentAnalysisContractVersion;
    const currentMetricSemanticsVersion = hasMetricSemanticsHeaders
      ? valueAt(row, 'metric_semantics_version').trim()
      : LEGACY_METRIC_SEMANTICS;
    // 010 硬切（2026-08-06）：历史 v1（contextual_competitor_mentions_sov_v1）
    // 只读导入兼容，与当前 v2_scoped 并列接受；CURRENT 翻 v5 后不得拒绝旧 CSV。
    if (![CURRENT_METRIC_SEMANTICS, LEGACY_METRIC_SEMANTICS, SCOPED_METRIC_SEMANTICS, V1_METRIC_SEMANTICS].includes(currentMetricSemanticsVersion)) {
      throw fieldError(
        'UNSUPPORTED_METRIC_SEMANTICS',
        line,
        'metric_semantics_version',
        '不受支持'
      );
    }
    if (
      metricSemanticsVersion !== null
      && metricSemanticsVersion !== currentMetricSemanticsVersion
    ) {
      throw fieldError(
        'MIXED_METRIC_SEMANTICS',
        line,
        'metric_semantics_version',
        '同一报告不得混合指标语义版本'
      );
    }
    metricSemanticsVersion = currentMetricSemanticsVersion;
    const recordCreatedAt = parseDate(valueAt(row, 'record_created_at'), 'record_created_at', line);
    const recordUpdatedAt = parseDate(valueAt(row, 'record_updated_at'), 'record_updated_at', line);
    if (recordCreatedAt && recordUpdatedAt && recordUpdatedAt < recordCreatedAt) {
      throw fieldError(
        'INVALID_DATE_ORDER',
        line,
        'record_updated_at',
        '不能早于 record_created_at'
      );
    }
    const answerFormat = valueAt(row, 'answer_format').trim() || 'plain_text';
    if (!['plain_text', 'markdown_v1'].includes(answerFormat)) {
      throw fieldError('INVALID_FIELD', line, 'answer_format', '只允许 plain_text 或 markdown_v1');
    }
    const competitorMentions = parseObjectArray(
      valueAt(row, 'competitor_mentions_json'),
      'competitor_mentions_json',
      line
    );
    const competitorBaselineCell = valueAt(row, 'competitor_baseline_json');
    const competitorBaseline = competitorBaselineCell.trim()
      ? parseObjectArray(competitorBaselineCell, 'competitor_baseline_json', line)
      : competitorMentions;
    const hasMetrics = parseBoolean(valueAt(row, 'has_metrics'), 'has_metrics', line);
    if (status === 'failed' && hasMetrics) {
      throw fieldError(
        'FAILED_ROW_HAS_METRICS',
        line,
        'has_metrics',
        '失败行必须明确标记为无指标'
      );
    }
    const shareOfVoice = parsePercentage(valueAt(row, 'share_of_voice'), 'share_of_voice', line);
    const answerCompetitorShare = hasMetricSemanticsHeaders
      ? parsePercentage(
          valueAt(row, 'answer_competitor_share'),
          'answer_competitor_share',
          line
        )
      : null;
    const sovNumerator = hasMetricSemanticsHeaders
      ? parseNonNegativeInteger(
          valueAt(row, 'sov_numerator'),
          'sov_numerator',
          line,
          { nullable: true }
        )
      : null;
    const sovDenominator = hasMetricSemanticsHeaders
      ? parseNonNegativeInteger(
          valueAt(row, 'sov_denominator'),
          'sov_denominator',
          line,
          { nullable: true }
        )
      : null;
    const competitionEntities = hasMetricSemanticsHeaders
      ? parseCompetitionEntities(
          valueAt(row, 'competition_entities_json'),
          'competition_entities_json',
          line,
          {
            // v5 竞品实体的证据由 source_id 封闭引用，CSV 不强制 evidence 数组
            requireEvidence: currentAnalysisContractVersion === 'ai_structured_v4',
            answer: valueAt(row, 'answer')
          }
        )
      : [];
    const brandMentioned = parseBoolean(valueAt(row, 'brand_mentioned'), 'brand_mentioned', line);
    const brandMentions = parseNonNegativeInteger(
      valueAt(row, 'brand_mentions'),
      'brand_mentions',
      line
    );
    const brandRank = parsePositiveNumber(
      valueAt(row, 'brand_rank'),
      'brand_rank',
      line,
      { nullable: true }
    );
    const brandRecommended = parseBoolean(
      valueAt(row, 'brand_recommended'),
      'brand_recommended',
      line
    );
    const sentiment = valueAt(row, 'sentiment');
    const analysisStructure = parseJsonObject(
      valueAt(row, 'analysis_structure_json'),
      'analysis_structure_json',
      line
    );
    const analysisEvidence = parseJsonObject(
      valueAt(row, 'analysis_evidence_json'),
      'analysis_evidence_json',
      line
    );
    const citationCount = parseNonNegativeInteger(
      valueAt(row, 'citation_count'),
      'citation_count',
      line
    );
    const ownedCitationCount = parseNonNegativeInteger(
      valueAt(row, 'owned_citation_count'),
      'owned_citation_count',
      line,
      { nullable: true }
    );
    const competitorCitationCount = parseNonNegativeInteger(
      valueAt(row, 'competitor_citation_count'),
      'competitor_citation_count',
      line,
      { nullable: true }
    );
    const citationSources = parseCitationSources(
      valueAt(row, 'citation_sources_json'),
      'citation_sources_json',
      line
    );
    const noAnalysisResult = status === 'failed' && !hasMetrics;
    validateAnalysisContract({
      version: currentAnalysisContractVersion,
      method: analysisMethod,
      metricVersion: currentMetricSemanticsVersion,
      line,
      noAnalysisResult
    });
    if (noAnalysisResult) {
      validateNoAnalysisResult({
        line,
        brandMentioned,
        brandMentions,
        brandRank,
        brandRecommended,
        sentiment,
        shareOfVoice,
        answerCompetitorShare,
        sovNumerator,
        sovDenominator,
        competitorBaseline,
        competitionEntities,
        analysisStructure,
        analysisEvidence
      });
    }
    validateCitationEvidence({
      line,
      analysisStructure,
      citationCount,
      ownedCitationCount,
      competitorCitationCount,
      citationSources
    });
    // 010 硬切（2026-08-06）：历史 v1（contextual_competitor_mentions_sov_v1）
    // 与当前 v2_scoped 一样携带新版指标字段（v4 时代即带 competition_entities/
    // 分子分母），走同一校验；legacy（configured_competitor_sov_v1）才拒绝。
    if (
      currentMetricSemanticsVersion === CURRENT_METRIC_SEMANTICS
      || currentMetricSemanticsVersion === SCOPED_METRIC_SEMANTICS
      || currentMetricSemanticsVersion === V1_METRIC_SEMANTICS
    ) {
      if (shareOfVoice !== null) {
        throw fieldError(
          'METRIC_SEMANTICS_MISMATCH',
          line,
          'share_of_voice',
          '新版指标必须保持为空'
        );
      }
      if (!hasMetrics || status === 'failed') {
        if (
          answerCompetitorShare !== null
          || sovNumerator !== null
          || sovDenominator !== null
          || competitionEntities.length > 0
        ) {
          throw fieldError(
            'METRIC_SEMANTICS_MISMATCH',
            line,
            'answer_competitor_share',
            '失败或无指标行的新版指标单元格必须为空'
          );
        }
      } else {
        if (sovNumerator === null || sovDenominator === null || sovNumerator > sovDenominator) {
          throw fieldError(
            'INVALID_SOV_COUNTS',
            line,
            'sov_numerator',
            '分子分母必须为有效非负整数且分子不得大于分母'
          );
        }
        if (
          (sovDenominator === 0 && (sovNumerator !== 0 || answerCompetitorShare !== null))
          || (sovDenominator > 0 && answerCompetitorShare === null)
        ) {
          throw fieldError(
            'INVALID_SOV_COUNTS',
            line,
            'answer_competitor_share',
            '值与分子分母不一致'
          );
        }
        const competitorMentions = competitionEntities
          .filter((entity) => entity.relation === 'competitor')
          .reduce((total, entity) => total + Number(entity.mentions), 0);
        if (sovDenominator !== sovNumerator + competitorMentions) {
          throw fieldError(
            'INVALID_SOV_COUNTS',
            line,
            'sov_denominator',
            '与竞争实体提及次数不一致'
          );
        }
        if (
          sovDenominator > 0
          && Number(
            ((sovNumerator / sovDenominator) * 100).toFixed(2)
          ) !== answerCompetitorShare
        ) {
          throw fieldError(
            'INVALID_SOV_COUNTS',
            line,
            'answer_competitor_share',
            '与分子分母计算结果不一致'
          );
        }
      }
    } else if (
      answerCompetitorShare !== null
      || sovNumerator !== null
      || sovDenominator !== null
      || competitionEntities.length > 0
    ) {
      throw fieldError(
        'METRIC_SEMANTICS_MISMATCH',
        line,
        'metric_semantics_version',
        '历史口径不得携带新版指标字段'
      );
    }
    if (
      currentAnalysisContractVersion === 'ai_structured_v5'
      && status === 'completed'
      && hasMetrics
    ) {
      validateV5AnalysisStructure({
        structure: analysisStructure,
        line,
        brandMentioned,
        brandMentions,
        brandRank,
        brandRecommended,
        sentiment,
        answerCompetitorShare,
        sovNumerator,
        sovDenominator
      });
    }
    return {
      record_id: parsePositiveInteger(valueAt(row, 'record_id'), 'record_id', line, { nullable: true }),
      question_id: parsePositiveInteger(valueAt(row, 'question_id'), 'question_id', line, { nullable: true }),
      question: valueAt(row, 'question'),
      question_category: valueAt(row, 'question_category'),
      platform: valueAt(row, 'platform'),
      platform_name: valueAt(row, 'platform_name'),
      model_name: valueAt(row, 'model_name'),
      status,
      error_message: valueAt(row, 'error_message'),
      answer: valueAt(row, 'answer'),
      answer_format: answerFormat,
      has_metrics: hasMetrics,
      brand_mentioned: brandMentioned,
      brand_mentions: brandMentions,
      brand_rank: brandRank,
      brand_recommended: brandRecommended,
      metric_semantics_version: currentMetricSemanticsVersion,
      share_of_voice: shareOfVoice,
      answer_competitor_share: answerCompetitorShare,
      sov_numerator: sovNumerator,
      sov_denominator: sovDenominator,
      competition_entities: competitionEntities,
      citation_count: citationCount,
      owned_citation_count: ownedCitationCount,
      competitor_citation_count: competitorCitationCount,
      legacy_citation_count: parseNonNegativeInteger(
        valueAt(row, 'legacy_citation_count'),
        'legacy_citation_count',
        line,
        { nullable: true }
      ),
      sentiment,
      sentiment_reason: valueAt(row, 'sentiment_reason'),
      competitor_mentions: competitorBaseline,
      citation_sources: citationSources,
      legacy_citation_sources: parseCitationSources(
        valueAt(row, 'legacy_citation_sources_json'),
        'legacy_citation_sources_json',
        line
      ),
      created_at: recordCreatedAt,
      updated_at: recordUpdatedAt,
      analysis_method: analysisMethod,
      analysis_platform: valueAt(row, 'analysis_platform').trim(),
      analysis_model: valueAt(row, 'analysis_model').trim(),
      analysis_structure: analysisStructure,
      analysis_evidence: analysisEvidence,
      failure: parseOptionalJsonObject(valueAt(row, 'failure_json'), 'failure_json', line),
      retry: parseOptionalJsonObject(valueAt(row, 'retry_json'), 'retry_json', line),
      analysis_diagnostics: parseOptionalJsonObject(
        valueAt(row, 'analysis_diagnostics_json'),
        'analysis_diagnostics_json',
        line
      )
    };
  });

  let integrityVerified = false;
  let verifiedSourceIntegrityStatus = null;
  if (hasIntegritySignature && integrityKeys.length > 0) {
    const firstSignedRow = table[1];
    const integrityKeyId = valueAt(firstSignedRow, INTEGRITY_KEY_ID_HEADER);
    const sourceProjectId = valueAt(firstSignedRow, SOURCE_PROJECT_ID_HEADER);
    const sourceIntegrityStatus = valueAt(firstSignedRow, SOURCE_INTEGRITY_STATUS_HEADER);
    if (
      !integrityKeyId
      || !/^\d+$/.test(sourceProjectId)
      || Number(sourceProjectId) < 1
      || !['complete', 'unverified_import'].includes(sourceIntegrityStatus)
    ) {
      throw fieldError(
        'INVALID_CSV_SIGNATURE',
        2,
        INTEGRITY_KEY_ID_HEADER,
        '完整性信封无效'
      );
    }
    const signedRows = table.slice(1).map((row) => (
      HEADERS.map((header) => valueAt(row, header))
    ));
    const expectedSignatures = integrityKeys.map((integrityKey) => (
      signatureForRows(signedRows, integrityKey, {
        integrityKeyId,
        sourceProjectId,
        sourceIntegrityStatus
      })
    ));
    table.slice(1).forEach((row, index) => {
      const line = index + 2;
      const actual = valueAt(row, INTEGRITY_HEADER);
      if (
        valueAt(row, INTEGRITY_KEY_ID_HEADER) !== integrityKeyId
        || valueAt(row, SOURCE_PROJECT_ID_HEADER) !== sourceProjectId
        || valueAt(row, SOURCE_INTEGRITY_STATUS_HEADER) !== sourceIntegrityStatus
      ) {
        throw fieldError(
          'INVALID_CSV_SIGNATURE',
          line,
          INTEGRITY_HEADER,
          '完整性信封行不一致'
        );
      }
      const actualBuffer = Buffer.from(actual, 'utf8');
      const signatureMatches = expectedSignatures.some((expected) => {
        const expectedBuffer = Buffer.from(expected, 'utf8');
        return actualBuffer.length === expectedBuffer.length
          && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
      });
      if (!signatureMatches) {
        throw fieldError(
          'INVALID_CSV_SIGNATURE',
          line,
          INTEGRITY_HEADER,
          '完整性签名无效'
        );
      }
    });
    if (expectedProjectId !== null && Number(sourceProjectId) !== Number(expectedProjectId)) {
      throw fieldError(
        'CSV_PROJECT_MISMATCH',
        2,
        SOURCE_PROJECT_ID_HEADER,
        '来源项目与目标项目不一致'
      );
    }
    integrityVerified = true;
    verifiedSourceIntegrityStatus = sourceIntegrityStatus;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    questionSetName,
    analysisContractVersion,
    metricSemanticsVersion,
    startedAt,
    completedAt,
    integrityPresent: hasIntegritySignature,
    integrityVerified,
    sourceIntegrityStatus: verifiedSourceIntegrityStatus,
    rows
  };
}

module.exports = {
  SCHEMA_VERSION,
  HEADERS,
  REQUIRED_HEADERS,
  REVERSIBILITY_HEADERS,
  METRIC_SEMANTICS_HEADERS,
  MAX_CSV_BYTES,
  MAX_CSV_ROWS,
  MAX_JSON_CELL_CHARS,
  CsvValidationError,
  buildCsv,
  parseCsv
};
