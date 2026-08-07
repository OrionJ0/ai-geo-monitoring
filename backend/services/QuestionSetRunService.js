const crypto = require('node:crypto');
const { Op } = require('sequelize');
const {
  BrandProject,
  QuestionSetRun,
  QuestionRecord,
  ResultDetail,
  VisibilityMetric
} = require('../models');
const QuestionSetRunCsvService = require('./QuestionSetRunCsvService');
const { repairMojibakeText } = require('./WebSourceText');
const CitationMetricSemanticsService = require('./CitationMetricSemanticsService');
const GeoMetricSemanticsService = require('./GeoMetricSemanticsService');
const WebCaptureAnswerQualityService = require('./WebCaptureAnswerQualityService');
const {
  CURRENT_METRIC_SEMANTICS,
  LEGACY_METRIC_SEMANTICS,
  SCOPED_METRIC_SEMANTICS,
  V5_ANALYSIS_CONTRACT
} = require('./GeoMetricSemanticsService');

const SCHEMA_VERSION = 'question_set_run_v1';
const STRUCTURED_ANALYSIS_METHODS = new Set([
  'ai_structured_v1',
  'ai_structured_v2',
  'ai_structured_v3',
  'ai_structured_v4',
  V5_ANALYSIS_CONTRACT
]);
const CSV_INTEGRITY_KEY_ID = 'question-set-run-csv-hmac-v1';

function csvExportError({ code, status, message, cause = null }) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.status = status;
  return error;
}

function parseEncodedIntegrityRoot(rawKey, label) {
  const value = String(rawKey || '').trim();
  let decoded = null;
  if (/^[a-f0-9]{64}$/i.test(value)) {
    decoded = Buffer.from(value, 'hex');
  } else if (/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    decoded = Buffer.from(value, 'base64');
  }
  if (!decoded || decoded.length !== 32) {
    throw new Error(`${label} 必须是 32 字节 Base64 或 64 位十六进制随机材料`);
  }
  return decoded;
}

function previousCsvIntegrityRoots() {
  const raw = String(process.env.CSV_REPORT_INTEGRITY_PREVIOUS_KEYS || '').trim();
  if (!raw) return [];
  let values;
  try {
    values = JSON.parse(raw);
  } catch {
    throw new Error('CSV_REPORT_INTEGRITY_PREVIOUS_KEYS 必须是 JSON 数组');
  }
  if (!Array.isArray(values)) {
    throw new Error('CSV_REPORT_INTEGRITY_PREVIOUS_KEYS 必须是 JSON 数组');
  }
  return values.map((entry, index) => {
    const label = `CSV_REPORT_INTEGRITY_PREVIOUS_KEYS[${index}]`;
    if (typeof entry === 'string') return parseEncodedIntegrityRoot(entry, label);
    if (
      entry
      && typeof entry === 'object'
      && !Array.isArray(entry)
      && entry.type === 'raw_utf8'
      && typeof entry.value === 'string'
      && Buffer.byteLength(entry.value, 'utf8') >= 32
    ) {
      return Buffer.from(entry.value, 'utf8');
    }
    throw new Error(`${label} 必须是编码密钥字符串或 {"type":"raw_utf8","value":"..."}`);
  });
}

function csvIntegrityKeys() {
  const roots = [];
  if (String(process.env.CSV_REPORT_INTEGRITY_KEY || '').trim()) {
    roots.push(parseEncodedIntegrityRoot(
      process.env.CSV_REPORT_INTEGRITY_KEY,
      'CSV_REPORT_INTEGRITY_KEY'
    ));
  }
  if (String(process.env.CONFIG_ENCRYPTION_KEY || '').trim()) {
    roots.push(parseEncodedIntegrityRoot(
      process.env.CONFIG_ENCRYPTION_KEY,
      'CONFIG_ENCRYPTION_KEY'
    ));
  }
  const jwtSecret = String(process.env.JWT_SECRET || '').trim();
  if (jwtSecret) {
    if (Buffer.byteLength(jwtSecret, 'utf8') < 32) {
      throw new Error('JWT_SECRET 至少需要 32 字节才能派生 CSV 完整性密钥');
    }
    roots.push(Buffer.from(jwtSecret, 'utf8'));
  }
  roots.push(...previousCsvIntegrityRoots());
  const seen = new Set();
  return roots
    .filter((root) => {
      const key = root.toString('hex');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((rootKey) => crypto
      .createHmac('sha256', rootKey)
      .update(CSV_INTEGRITY_KEY_ID)
      .digest('hex'));
}

// 专用覆盖密钥和历史密钥环在模块加载时即 fail-closed；正式启动不会带着弱值运行。
if (
  String(process.env.CSV_REPORT_INTEGRITY_KEY || '').trim()
  || String(process.env.CSV_REPORT_INTEGRITY_PREVIOUS_KEYS || '').trim()
) csvIntegrityKeys();

function isV5Metric(row) {
  return String(row?.metric_semantics_version || '') === SCOPED_METRIC_SEMANTICS
    || String(row?.analysis_method || '') === V5_ANALYSIS_CONTRACT;
}

function v5Structure(row) {
  return row?.analysis_structure && typeof row.analysis_structure === 'object'
    && !Array.isArray(row.analysis_structure)
    ? row.analysis_structure
    : {};
}

function v5FieldStatus(row, field) {
  return String(v5Structure(row)?.target_semantics?.[field]?.status || '');
}

function v5TargetFactComplete(row) {
  return v5Structure(row)?.target_fact?.status === 'complete';
}

function plain(row) {
  return row && typeof row.toJSON === 'function' ? row.toJSON() : row;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function percent(count, total) {
  if (!total) return 0;
  return Number(((count / total) * 100).toFixed(2));
}

function nullablePercent(count, total) {
  return total > 0 ? percent(count, total) : null;
}

function ownedCitationCount(row) {
  if (row.owned_citation_count !== undefined && row.owned_citation_count !== null) {
    return finiteNumber(row.owned_citation_count);
  }
  const sources = Array.isArray(row.citation_sources) ? row.citation_sources : [];
  return sources.filter((source) => source?.owned === true).length;
}

function normalizeAnalysisDiagnostics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  ['status', 'error_code', 'error_detail', 'stage', 'platform', 'model', 'finish_reason'].forEach((field) => {
    if (value[field] !== undefined && value[field] !== null) {
      result[field] = String(value[field]).slice(0, 300);
    }
  });
  ['attempt_count', 'output_length'].forEach((field) => {
    const number = Number(value[field]);
    if (Number.isFinite(number) && number >= 0) result[field] = number;
  });
  const usage = {};
  ['prompt_tokens', 'completion_tokens', 'total_tokens'].forEach((field) => {
    const number = Number(value?.usage?.[field]);
    if (Number.isFinite(number) && number >= 0) usage[field] = number;
  });
  if (Object.keys(usage).length) result.usage = usage;
  return Object.keys(result).length ? result : null;
}

function normalizeFailure(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const stage = String(value.stage || '').trim().slice(0, 80);
  const errorCode = String(value.error_code || '').trim().slice(0, 80);
  if (!stage || !errorCode) return null;
  return {
    stage,
    error_code: errorCode
  };
}

function normalizeCitationSemantics(row) {
  const eligible = CitationMetricSemanticsService.isCoreKpiEligible(row);
  const rawSources = normalizeMetricCitationSources(row?.citation_sources);
  const rawCount = finiteNumber(row?.citation_count);
  if (eligible) {
    const ownedCount = row?.owned_citation_count !== undefined && row?.owned_citation_count !== null
      ? finiteNumber(row.owned_citation_count)
      : rawSources.filter((source) => source?.owned === true).length;
    const competitorCount = row?.competitor_citation_count !== undefined && row?.competitor_citation_count !== null
      ? finiteNumber(row.competitor_citation_count)
      : rawSources.filter((source) => source?.competitor_owned === true).length;
    return {
      ...row,
      citation_count: rawCount,
      owned_citation_count: ownedCount,
      competitor_citation_count: competitorCount,
      citation_sources: rawSources,
      citation_evidence_status: 'explicit'
    };
  }
  if (
    CitationMetricSemanticsService.semanticsVersion(row)
      === 'imported-citation-unverified-v1'
  ) {
    return {
      ...row,
      citation_count: 0,
      owned_citation_count: 0,
      competitor_citation_count: 0,
      citation_sources: [],
      citation_evidence_status: 'legacy_unverified',
      legacy_citation_count: finiteNumber(row.legacy_citation_count),
      legacy_citation_sources: normalizeMetricCitationSources(row.legacy_citation_sources)
    };
  }
  if (row?.has_metrics === false) {
    return {
      ...row,
      citation_count: 0,
      owned_citation_count: 0,
      competitor_citation_count: 0,
      citation_sources: [],
      citation_evidence_status: CitationMetricSemanticsService.evidenceStatus(row) === 'unavailable'
        ? 'unavailable'
        : 'none'
    };
  }
  if (
    CitationMetricSemanticsService.semanticsVersion(row)
      === CitationMetricSemanticsService.SEMANTICS_VERSION
    && CitationMetricSemanticsService.evidenceStatus(row) === 'unavailable'
  ) {
    return {
      ...row,
      citation_count: 0,
      owned_citation_count: 0,
      competitor_citation_count: 0,
      citation_sources: [],
      citation_evidence_status: 'unavailable'
    };
  }
  return {
    ...row,
    citation_count: 0,
    owned_citation_count: 0,
    competitor_citation_count: 0,
    citation_sources: [],
    citation_evidence_status: 'legacy_unverified',
    ...(rawCount > 0 || rawSources.length
      ? {
          legacy_citation_count: rawCount || rawSources.length,
          legacy_citation_sources: rawSources
        }
      : {})
  };
}

function downgradeImportedCitationEvidence(row) {
  if (
    CitationMetricSemanticsService.semanticsVersion(row)
      !== CitationMetricSemanticsService.SEMANTICS_VERSION
    || CitationMetricSemanticsService.evidenceStatus(row) === 'unavailable'
  ) {
    return row;
  }
  const sources = Array.isArray(row.citation_sources) ? row.citation_sources : [];
  return {
    ...row,
    citation_count: 0,
    owned_citation_count: 0,
    competitor_citation_count: 0,
    citation_sources: [],
    legacy_citation_count: finiteNumber(row.citation_count) || sources.length,
    legacy_citation_sources: sources,
    analysis_structure: {
      ...(plain(row.analysis_structure) || {}),
      citations: {
        semantics_version: 'imported-citation-unverified-v1',
        evidence_status: 'unverified'
      }
    }
  };
}

function downgradeUnverifiedImportedMetrics(row) {
  const citationRow = downgradeImportedCitationEvidence(row);
  return {
    ...citationRow,
    has_metrics: false,
    brand_mentioned: false,
    brand_mentions: 0,
    brand_rank: null,
    brand_recommended: false,
    sentiment: '',
    sentiment_reason: '',
    share_of_voice: null,
    answer_competitor_share: null,
    sov_numerator: null,
    sov_denominator: null,
    competitor_mentions: [],
    competition_entities: [],
    analysis_method: row.analysis_method,
    analysis_evidence: {},
    analysis_structure: row.status === 'failed'
      ? (citationRow.analysis_structure?.citations
          ? { citations: citationRow.analysis_structure.citations }
          : {})
      : {
          ...(citationRow.analysis_structure?.citations
            ? { citations: citationRow.analysis_structure.citations }
            : {}),
          imported_unverified: {
            analysis_method: row.analysis_method,
            metric_semantics_version: row.metric_semantics_version,
            analysis_structure: row.analysis_structure,
            analysis_evidence: row.analysis_evidence
          }
        }
  };
}

function deriveStatus(rows, pausedAt = null) {
  const total = rows.length;
  const pending = rows.filter((row) => row.status === 'pending').length;
  const completed = rows.filter((row) => row.status === 'completed').length;
  const failed = rows.filter((row) => row.status === 'failed').length;
  if (pausedAt && pending > 0) return 'paused';
  if (pending > 0 || total === 0) return 'running';
  if (completed === total) return 'completed';
  if (failed === total) return 'failed';
  return 'partial';
}

function deriveExecutionState(row, now = new Date()) {
  const status = String(row?.status || 'pending');
  if (status === 'completed' || status === 'failed') return status;
  const expiresAt = new Date(row?.lease_expires_at || 0).getTime();
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const hasActiveLease = Boolean(
    row?.execution_token
    && row?.execution_started_at
    && row?.lease_owner
    && Number.isFinite(expiresAt)
    && Number.isFinite(nowMs)
    && expiresAt > nowMs
  );
  return hasActiveLease ? 'executing' : 'queued';
}

function deriveControlState({
  source,
  integrityStatus,
  pausedAt,
  executionSummary
}) {
  if (
    source === 'imported'
    || integrityStatus === 'snapshot_only'
    || integrityStatus === 'missing_records'
  ) return 'read_only';
  const pending = Number(executionSummary?.pending) || 0;
  if (pending <= 0) return 'terminal';
  if (!pausedAt) return 'running';
  return Number(executionSummary?.executing) > 0 ? 'pausing' : 'paused';
}

function deriveCapabilities({ source, status, summary, integrityStatus }) {
  const blockedReason = source === 'imported'
    ? 'imported_report_read_only'
    : integrityStatus === 'snapshot_only'
      ? 'snapshot_only_report'
      : integrityStatus === 'missing_records'
        ? 'run_records_missing'
        : null;
  if (blockedReason) {
    return {
      can_pause: false,
      pause_disabled_reason: blockedReason,
      can_resume: false,
      resume_disabled_reason: blockedReason,
      can_retry: false,
      retry_disabled_reason: blockedReason
    };
  }

  const pending = Number(summary?.pending) || 0;
  const failed = Number(summary?.failed) || 0;
  const canPause = status === 'running' && pending > 0;
  const canResume = status === 'paused' && pending > 0;
  const canRetry = !['running', 'paused'].includes(status) && failed > 0;
  return {
    can_pause: canPause,
    pause_disabled_reason: canPause
      ? null
      : (status !== 'running' ? 'not_running' : 'no_pending_records'),
    can_resume: canResume,
    resume_disabled_reason: canResume
      ? null
      : (status !== 'paused' ? 'not_paused' : 'no_pending_records'),
    can_retry: canRetry,
    retry_disabled_reason: canRetry
      ? null
      : (['running', 'paused'].includes(status) ? 'run_not_terminal' : 'no_failed_records')
  };
}

function summarize(rows) {
  const completedRows = rows.filter((row) => row.status === 'completed');
  const currentScopeRows = rows.filter((row) => (
    row.metric_semantics_version === CURRENT_METRIC_SEMANTICS
    || row.metric_semantics_version === SCOPED_METRIC_SEMANTICS
  ));
  const usesCurrentSemantics = currentScopeRows.length > 0;
  const metricRows = completedRows.filter((row) => (
    row.has_metrics
    && row.capture_quality?.status !== 'invalid'
    && (
      !usesCurrentSemantics
      || row.metric_semantics_version === CURRENT_METRIC_SEMANTICS
      || row.metric_semantics_version === SCOPED_METRIC_SEMANTICS
    )
  ));
  const acquiredRows = usesCurrentSemantics
    ? currentScopeRows.filter((row) => (
        String(row.answer || '').trim()
        && row.capture_quality?.status !== 'invalid'
      ))
    : [];
  const invalidCaptureRows = usesCurrentSemantics
    ? currentScopeRows.filter((row) => row.capture_quality?.status === 'invalid')
    : [];
  const citationRows = usesCurrentSemantics
    ? acquiredRows.filter((row) => row.citation_evidence_status === 'explicit')
    : metricRows.filter((row) => row.citation_evidence_status === 'explicit');
  const rankedRows = metricRows.filter((row) => {
    if (isV5Metric(row)) {
      const rank = v5Structure(row)?.target_semantics?.rank;
      return rank?.status === 'assessed' && finiteNumber(rank?.value) > 0;
    }
    return finiteNumber(row.brand_rank) > 0;
  });
  const sovCalculableRows = usesCurrentSemantics
    ? metricRows.filter((row) => {
      if (isV5Metric(row)) {
        const sov = v5Structure(row)?.sov;
        return sov?.status === 'observed_only' && finiteNumber(sov?.denominator) > 0;
      }
      return row.answer_competitor_share !== null
        && row.answer_competitor_share !== undefined
        && Number.isFinite(Number(row.answer_competitor_share));
    })
    : [];
  const legacySovRows = usesCurrentSemantics
    ? []
    : metricRows.filter((row) => row.share_of_voice !== null
      && row.share_of_voice !== undefined
      && Number.isFinite(Number(row.share_of_voice)));
  const competitorBaselineCount = metricRows.reduce(
    (maximum, row) => Math.max(maximum, Array.isArray(row.competitor_mentions) ? row.competitor_mentions.length : 0),
    0
  );
  const sum = (key, list = metricRows) => list.reduce((total, row) => total + finiteNumber(row[key]), 0);
  const totalOwnedCitations = citationRows.reduce((total, row) => total + ownedCitationCount(row), 0);
  const brandMentionedAnswers = metricRows.filter((row) => {
    if (isV5Metric(row)) {
      return v5TargetFactComplete(row) && Boolean(v5Structure(row)?.target_fact?.brand_mentioned);
    }
    return row.brand_mentioned;
  }).length;
  // 推荐分母只纳入 target_semantics.recommendation.status === 'assessed' 的 v5 记录；
  // v4 无字段状态，沿用既有全部记录语义。
  const recommendationScope = metricRows.filter((row) => (
    !isV5Metric(row) || v5FieldStatus(row, 'recommendation') === 'assessed'
  ));
  const recommendedAnswers = recommendationScope.filter((row) => {
    if (isV5Metric(row)) {
      return Boolean(v5Structure(row)?.target_semantics?.recommendation?.value);
    }
    return row.brand_recommended;
  }).length;

  const common = {
    total: rows.length,
    completed: completedRows.length,
    failed: rows.filter((row) => row.status === 'failed').length,
    pending: rows.filter((row) => row.status === 'pending').length,
    valid_analyses: metricRows.length,
    valid_answers: usesCurrentSemantics ? metricRows.length : null,
    acquired_answers: usesCurrentSemantics ? acquiredRows.length : null,
    invalid_captures: usesCurrentSemantics ? invalidCaptureRows.length : null,
    analysis_coverage_rate: usesCurrentSemantics
      ? nullablePercent(metricRows.length, acquiredRows.length)
      : null,
    brand_mentioned_answers: usesCurrentSemantics ? brandMentionedAnswers : null,
    recommendation_assessed_answers: usesCurrentSemantics ? recommendationScope.length : null,
    recommended_answers: usesCurrentSemantics ? recommendedAnswers : null,
    ranked_answers: usesCurrentSemantics ? rankedRows.length : null,
    sov_calculable_answers: usesCurrentSemantics ? sovCalculableRows.length : null,
    avg_answer_competitor_share: usesCurrentSemantics
      ? (sovCalculableRows.length
          ? Number((sovCalculableRows.reduce(
              (total, row) => total + (
                isV5Metric(row)
                  ? finiteNumber(v5Structure(row)?.sov?.value)
                  : finiteNumber(row.answer_competitor_share)
              ),
              0
            ) / sovCalculableRows.length).toFixed(2))
          : null)
      : null,
    citation_valid_analyses: citationRows.length,
    citation_unverified_analyses: usesCurrentSemantics
      ? acquiredRows.length - citationRows.length
      : metricRows.length - citationRows.length,
    competitor_baseline_count: competitorBaselineCount,
    brand_mention_rate: usesCurrentSemantics
      ? nullablePercent(brandMentionedAnswers, metricRows.length)
      : percent(brandMentionedAnswers, metricRows.length),
    recommendation_rate: usesCurrentSemantics
      ? nullablePercent(recommendedAnswers, recommendationScope.length)
      : percent(recommendedAnswers, recommendationScope.length),
    citation_rate: percent(citationRows.filter((row) => finiteNumber(row.citation_count) > 0).length, citationRows.length),
    owned_citation_rate: percent(citationRows.filter((row) => ownedCitationCount(row) > 0).length, citationRows.length),
    avg_brand_rank: rankedRows.length ? Number((sum('brand_rank', rankedRows) / rankedRows.length).toFixed(2)) : null,
    total_citations: sum('citation_count', citationRows),
    total_owned_citations: totalOwnedCitations
  };
  if (usesCurrentSemantics) {
    const scopedOnly = metricRows.length > 0 && metricRows.every(isV5Metric);
    const sovSummary = {
      metric_semantics_version: scopedOnly ? SCOPED_METRIC_SEMANTICS : CURRENT_METRIC_SEMANTICS,
      kind: scopedOnly ? 'observed_competitor_mentions' : 'contextual_competitor_mentions',
      average: common.avg_answer_competitor_share,
      calculable_answers: sovCalculableRows.length
    };
    if (scopedOnly) {
      sovSummary.scope = 'open_discovery';
      sovSummary.completeness = 'not_proven';
    }
    return {
      ...common,
      sov_summary: sovSummary
    };
  }
  const legacyAverage = metricRows.length
    ? Number((sum('share_of_voice') / metricRows.length).toFixed(2))
    : 0;
  return {
    ...common,
    avg_share_of_voice: legacyAverage,
    sov_summary: {
      metric_semantics_version: LEGACY_METRIC_SEMANTICS,
      kind: 'legacy_configured_competitors',
      average: legacySovRows.length ? legacyAverage : null,
      calculable_answers: legacySovRows.length
    }
  };
}

function summarizeUnverified(rows) {
  return {
    total: rows.length,
    completed: rows.filter((row) => row.status === 'completed').length,
    failed: rows.filter((row) => row.status === 'failed').length,
    pending: rows.filter((row) => row.status === 'pending').length,
    business_metrics_status: 'unavailable',
    valid_analyses: null,
    valid_answers: null,
    acquired_answers: null,
    invalid_captures: null,
    analysis_coverage_rate: null,
    brand_mentioned_answers: null,
    recommendation_assessed_answers: null,
    recommended_answers: null,
    ranked_answers: null,
    sov_calculable_answers: null,
    avg_answer_competitor_share: null,
    citation_valid_analyses: null,
    citation_unverified_analyses: null,
    competitor_baseline_count: null,
    brand_mention_rate: null,
    recommendation_rate: null,
    citation_rate: null,
    owned_citation_rate: null,
    avg_brand_rank: null,
    total_citations: null,
    total_owned_citations: null,
    avg_share_of_voice: null,
    sov_summary: {
      status: 'unavailable',
      average: null,
      calculable_answers: null
    }
  };
}

function summarizeExecution(rows) {
  const failureStages = new Map();
  rows
    .filter((row) => row.status === 'failed')
    .forEach((row) => {
      const stage = String(
        row?.failure?.stage
        || row?.analysis_diagnostics?.stage
        || 'unknown'
      ).trim() || 'unknown';
      failureStages.set(stage, (failureStages.get(stage) || 0) + 1);
    });
  return {
    total: rows.length,
    completed: rows.filter((row) => row.status === 'completed').length,
    failed: rows.filter((row) => row.status === 'failed').length,
    pending: rows.filter((row) => row.status === 'pending').length,
    executing: rows.filter((row) => row.execution_state === 'executing').length,
    queued: rows.filter((row) => (
      row.status === 'pending' && row.execution_state !== 'executing'
    )).length,
    failure_stages: Object.fromEntries(failureStages)
  };
}

const WEB_CAPTURE_ARTIFACT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function boundedText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function safeHttpUrl(value) {
  const raw = boundedText(value, 2048);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.toString()
      : '';
  } catch {
    return '';
  }
}

function citationMarker(value) {
  return String(value || '').match(/^(?:\[|【)?[-–—]?\s*(\d+)\s*(?:\]|】)?$/);
}

function isPlaceholderCitationTitle(value) {
  return /^(?:auto[-_ ]?link|link|url|website|source|citation|网页|链接|来源|引用)$/i.test(
    String(value || '')
  );
}

function normalizeMetricCitationSources(value) {
  return (Array.isArray(value) ? value : []).map((source) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return source;
    const rawTitle = repairMojibakeText(
      boundedText(source.title, 500).replace(/\s+/g, ' ').trim()
    );
    if (!rawTitle) return source;
    const url = safeHttpUrl(source.url);
    const domain = boundedText(source.domain, 255)
      || (url ? new URL(url).hostname : '');
    const title = citationMarker(rawTitle) || isPlaceholderCitationTitle(rawTitle)
      ? (domain || url || '未知来源')
      : rawTitle;
    return { ...source, title };
  });
}

function normalizeProviderCitations(value) {
  const output = [];
  const seen = new Set();
  for (const source of Array.isArray(value) ? value : []) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    const url = safeHttpUrl(source.url);
    const sourceRole = boundedText(source.source_role, 80);
    if (!url || !['explicit_citation', 'retrieval_candidate'].includes(sourceRole)) continue;
    const key = `${sourceRole}:${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const domain = boundedText(source.domain, 255) || new URL(url).hostname;
    const rawTitle = repairMojibakeText(
      boundedText(source.title, 500).replace(/\s+/g, ' ').trim()
    );
    const marker = citationMarker(rawTitle);
    const placeholderTitle = isPlaceholderCitationTitle(rawTitle);
    const displayIndex = Number.isSafeInteger(Number(source.display_index))
      && Number(source.display_index) > 0
      ? Number(source.display_index)
      : marker
        ? Number(marker[1])
        : null;
    output.push({
      url,
      title: rawTitle && !marker && !placeholderTitle ? rawTitle : domain,
      domain,
      source_role: sourceRole,
      ...(boundedText(source.source_origin, 80)
        ? { source_origin: boundedText(source.source_origin, 80) }
        : {}),
      ...(displayIndex ? { display_index: displayIndex } : {})
    });
    if (output.length >= 200) break;
  }
  return output;
}

function normalizeWebCapture(value, fallbackRecordId) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || value.status !== 'completed'
  ) {
    return null;
  }
  const recordId = positiveInteger(value.artifact_owner_record_id)
    || positiveInteger(fallbackRecordId);
  if (!recordId) return null;
  const artifact = (kind) => {
    const id = boundedText(value.artifacts?.[kind]?.id, 64).toLowerCase();
    return WEB_CAPTURE_ARTIFACT_ID_RE.test(id)
      ? { id, mime_type: 'image/png' }
      : null;
  };
  const searchState = artifact('search_state');
  const finalAnswer = artifact('final_answer');
  if (!searchState || !finalAnswer) return null;
  return {
    schema_version: boundedText(value.schema_version, 100),
    status: 'completed',
    answer_format: value.answer_format === 'markdown_v1' ? 'markdown_v1' : 'plain_text',
    selector_version: boundedText(value.selector_version, 100),
    artifact_owner_record_id: recordId,
    captured_at: boundedText(value.captured_at || value.completed_at, 80),
    ...(value.answer_quality?.status === 'invalid'
      ? {
          answer_quality: {
            status: 'invalid',
            reason_code: boundedText(
              value.answer_quality.reason_code || 'capture_marked_invalid',
              80
            )
          }
        }
      : {}),
    capture_mode: {
      name: boundedText(value.capture_mode?.name, 40),
      observed: value.capture_mode?.observed === true
        ? true
        : value.capture_mode?.observed === false
          ? false
          : null,
      evidence_type: boundedText(value.capture_mode?.evidence_type, 100)
    },
    search: {
      requested: value.search?.requested === true,
      observed: value.search?.observed === true
        ? true
        : value.search?.observed === false
          ? false
          : null,
      evidence_type: boundedText(value.search?.evidence_type, 100),
      ...(value.search?.candidate_observation
        && typeof value.search.candidate_observation === 'object'
        && !Array.isArray(value.search.candidate_observation)
        ? {
            candidate_observation: {
              observed_count: Math.max(0, Math.trunc(finiteNumber(
                value.search.candidate_observation.observed_count
              ))),
              accepted_count: Math.max(0, Math.trunc(finiteNumber(
                value.search.candidate_observation.accepted_count
              ))),
              dropped_count: Math.max(0, Math.trunc(finiteNumber(
                value.search.candidate_observation.dropped_count
              ))),
              truncated: value.search.candidate_observation.truncated === true
            }
          }
        : {})
    },
    artifacts: {
      search_state: searchState,
      final_answer: finalAnswer
    }
  };
}

function normalizeNativeRow(record) {
  const row = plain(record);
  const detail = plain(row.resultDetail) || {};
  const metric = plain(row.visibilityMetric) || null;
  const citationAnalysis = detail.citation_analysis
    && typeof detail.citation_analysis === 'object'
    && !Array.isArray(detail.citation_analysis)
    && detail.citation_analysis.semantics_version
    ? detail.citation_analysis
    : null;
  const metricSemanticsVersion = metric?.metric_semantics_version
    || row.metric_semantics_version
    || null;
  const isCurrentScope = metricSemanticsVersion === CURRENT_METRIC_SEMANTICS
    || metricSemanticsVersion === SCOPED_METRIC_SEMANTICS;
  let sov = null;
  if (metric) {
    sov = metricSemanticsVersion === SCOPED_METRIC_SEMANTICS
      // 010 硬切 P0 修复（2026-08-06）：v2_scoped 记录的 observed_only 状态
      // 保存在 visibility_metrics.analysis_structure.sov 内（扁平列未落库，
      // VisibilityMetric 模型无 sov_status 列），读取侧从 metric 的
      // analysis_structure 兜底恢复，防止 v5 native 记录在 getReport 时
      // 抛"开放发现 SOV 状态必须为 observed_only"。
      ? GeoMetricSemanticsService.presentScopedSov({
          ...metric,
          sov_status: String(metric.sov_status || '')
            || String(metric.analysis_structure?.sov?.status || '')
        })
      : GeoMetricSemanticsService.presentSov(metric);
  }
  const analysisDiagnostics = normalizeAnalysisDiagnostics(row.result_summary?.analysis);
  const failure = normalizeFailure(row.result_summary?.failure);
  const captureQuality = WebCaptureAnswerQualityService.evaluate({
    platform: row.platform,
    responseText: detail.ai_response_original,
    webCapture: row.result_summary?.web_capture
  });
  const retry = row.result_summary?.retry && typeof row.result_summary.retry === 'object'
    ? {
        previous_record_id: Number(row.result_summary.retry.previous_record_id) || null,
        attempt: Number(row.result_summary.retry.attempt) || 0,
        kind: String(row.result_summary.retry.kind || '').slice(0, 40)
      }
    : null;
  return normalizeCitationSemantics({
    record_id: row.id,
    question_id: row.tracked_prompt_id,
    question: row.question || '',
    question_category: metric?.prompt_category || '',
    platform: row.platform || '',
    platform_name: row.platform_name || row.platform || '',
    model_name: row.model_name || '',
    status: row.status || 'pending',
    execution_state: deriveExecutionState(row),
    error_message: row.error_message || '',
    failure,
    retry,
    analysis_diagnostics: analysisDiagnostics,
    ...(captureQuality.status === 'invalid'
      ? { capture_quality: captureQuality }
      : {}),
    answer: detail.ai_response_original || '',
    answer_format: row.result_summary?.web_capture?.answer_format === 'markdown_v1'
      ? 'markdown_v1'
      : 'plain_text',
    provider_citations: normalizeProviderCitations(detail.provider_citations),
    web_capture: normalizeWebCapture(row.result_summary?.web_capture, row.id),
    has_metrics: Boolean(metric),
    analysis_contract_version: row.analysis_contract_version || null,
    brand_mentioned: Boolean(metric?.brand_mentioned),
    brand_mentions: finiteNumber(metric?.brand_mentions),
    brand_rank: STRUCTURED_ANALYSIS_METHODS.has(metric?.analysis_method)
      || (Array.isArray(metric?.competitor_mentions) && metric.competitor_mentions.length > 0)
      ? (metric?.brand_rank == null ? null : finiteNumber(metric.brand_rank))
      : null,
    brand_recommended: Boolean(metric?.brand_recommended),
    metric_semantics_version: metricSemanticsVersion,
    sov,
    ...(metricSemanticsVersion === LEGACY_METRIC_SEMANTICS
      ? { share_of_voice: metric?.share_of_voice == null ? null : finiteNumber(metric.share_of_voice) }
      : {}),
    answer_competitor_share: metric
      && isCurrentScope
      ? metric?.answer_competitor_share ?? null
      : null,
    sov_numerator: metric
      && isCurrentScope
      ? finiteNumber(metric?.sov_numerator)
      : null,
    sov_denominator: metric
      && isCurrentScope
      ? finiteNumber(metric?.sov_denominator)
      : null,
    competition_entities: isCurrentScope
      && Array.isArray(metric?.competition_entities)
      ? metric.competition_entities
      : [],
    citation_count: citationAnalysis
      ? finiteNumber(citationAnalysis.citation_count)
      : finiteNumber(metric?.citation_count),
    owned_citation_count: citationAnalysis
      ? finiteNumber(citationAnalysis.owned_citation_count)
      : finiteNumber(metric?.owned_citation_count),
    competitor_citation_count: citationAnalysis
      ? finiteNumber(citationAnalysis.competitor_citation_count)
      : finiteNumber(metric?.competitor_citation_count),
    sentiment: metric?.sentiment || '',
    sentiment_reason: metric?.sentiment_reason || '',
    analysis_method: metric?.analysis_method || 'legacy_rules_v1',
    analysis_platform: metric?.analysis_platform || '',
    analysis_model: metric?.analysis_model || '',
    analysis_structure: {
      ...(metric?.analysis_structure && typeof metric.analysis_structure === 'object'
        ? metric.analysis_structure
        : {}),
      ...(citationAnalysis?.semantics_version
        ? {
            citations: {
              semantics_version: citationAnalysis.semantics_version,
              evidence_status: citationAnalysis.evidence_status
            }
          }
        : {})
    },
    analysis_evidence: metric?.analysis_evidence && typeof metric.analysis_evidence === 'object'
      ? metric.analysis_evidence
      : {},
    competitor_mentions: Array.isArray(metric?.competitor_mentions) ? metric.competitor_mentions : [],
    citation_sources: citationAnalysis && Array.isArray(citationAnalysis.sources)
      ? citationAnalysis.sources
      : (Array.isArray(metric?.citation_sources) ? metric.citation_sources : []),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  });
}

function normalizeRowMetricSemantics(row, fallbackVersion) {
  const version = row?.metric_semantics_version
    || fallbackVersion
    || LEGACY_METRIC_SEMANTICS;
  const normalized = {
    ...row,
    metric_semantics_version: version
  };
  if (!normalized.has_metrics) {
    normalized.sov = null;
  } else if (!normalized.sov) {
    normalized.sov = GeoMetricSemanticsService.presentSov(normalized);
  }
  if (version === CURRENT_METRIC_SEMANTICS) {
    delete normalized.share_of_voice;
  }
  return normalized;
}

function normalizeStoredWebCapture(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  const webCapture = normalizeWebCapture(row.web_capture, row.record_id || row.id);
  if (!webCapture) return row;
  const isDoubaoStandard = row.platform === 'doubao-web'
    && (
      webCapture.capture_mode.name === 'standard'
      || webCapture.search.evidence_type === 'dom_standard_mode'
    );
  const hasRetrievalCandidates = (Array.isArray(row.provider_citations)
    ? row.provider_citations
    : []
  ).some((source) => source?.source_role === 'retrieval_candidate');
  return {
    ...row,
    web_capture: {
      ...webCapture,
      capture_mode: isDoubaoStandard
        ? {
            name: 'standard',
            observed: true,
            evidence_type: webCapture.capture_mode.evidence_type || 'dom_standard_mode'
          }
        : webCapture.capture_mode,
      search: isDoubaoStandard && hasRetrievalCandidates
        ? {
            ...webCapture.search,
            observed: true,
            evidence_type: 'network_retrieval_candidates'
          }
        : webCapture.search
    }
  };
}

function normalizeCaptureQuality(row) {
  const quality = WebCaptureAnswerQualityService.evaluate({
    platform: row?.platform,
    responseText: row?.answer,
    webCapture: row?.web_capture
  });
  if (quality.status !== 'invalid') return row;
  return {
    ...row,
    capture_quality: quality,
    ...(row?.web_capture
      ? {
          web_capture: {
            ...row.web_capture,
            answer_quality: quality
          }
        }
      : {})
  };
}

class QuestionSetRunService {
  async findRun({ projectId, runId, repositories = {} }) {
    const Run = repositories.QuestionSetRun || QuestionSetRun;
    return Run.findOne({ where: { id: runId, project_id: projectId } });
  }

  async findBrandProject(projectId, repositories = {}) {
    const Project = repositories.BrandProject || BrandProject;
    return Project.findByPk(projectId);
  }

  async getNativeRows(run, repositories = {}) {
    const Record = repositories.QuestionRecord || QuestionRecord;
    const records = await Record.findAll({
      where: {
        question_set_run_id: run.id,
        project_id: run.project_id,
        run_slot_index: { [Op.not]: null }
      },
      include: [
        { model: repositories.ResultDetail || ResultDetail, as: 'resultDetail', required: false },
        { model: repositories.VisibilityMetric || VisibilityMetric, as: 'visibilityMetric', required: false }
      ],
      order: [['run_slot_index', 'ASC'], ['id', 'ASC']]
    });
    return records.map(normalizeNativeRow);
  }

  async getReport({ projectId, runId, repositories = {} }) {
    const stored = await this.findRun({ projectId, runId, repositories });
    if (!stored) return null;
    const run = plain(stored);
    const cachedRows = Array.isArray(run.imported_rows) ? run.imported_rows : [];
    const sourceRows = run.source === 'imported' || cachedRows.length
      ? cachedRows
      : await this.getNativeRows(run, repositories);
    const fallbackMetricSemanticsVersion = run.metric_semantics_version
      || sourceRows.find((row) => row?.metric_semantics_version)?.metric_semantics_version
      || LEGACY_METRIC_SEMANTICS;
    const rows = sourceRows
      .map((row) => ({
        ...row,
        answer_format: row?.answer_format === 'markdown_v1'
          || row?.web_capture?.answer_format === 'markdown_v1'
          ? 'markdown_v1'
          : 'plain_text',
        provider_citations: normalizeProviderCitations(row?.provider_citations),
        execution_state: ['completed', 'failed', 'executing', 'queued'].includes(row?.execution_state)
          ? row.execution_state
          : deriveExecutionState(row)
      }))
      .map(normalizeStoredWebCapture)
      .map(normalizeCaptureQuality)
      .map((row) => normalizeRowMetricSemantics(row, fallbackMetricSemanticsVersion))
      .map(normalizeCitationSemantics)
      .map((row) => {
      if (STRUCTURED_ANALYSIS_METHODS.has(row?.analysis_method)) return row;
      const hasCompetitorBaseline = Array.isArray(row?.competitor_mentions) && row.competitor_mentions.length > 0;
      return hasCompetitorBaseline ? row : { ...row, brand_rank: null };
      });
    const pausedAt = run.paused_at || null;
    const integrityStatus = run.integrity_status || 'complete';
    const status = integrityStatus === 'missing_records'
      ? 'failed'
      : deriveStatus(rows, pausedAt);
    const summary = integrityStatus === 'unverified_import'
      ? summarizeUnverified(rows)
      : summarize(rows);
    const executionSummary = summarizeExecution(rows);
    const controlState = deriveControlState({
      source: run.source,
      integrityStatus,
      pausedAt,
      executionSummary
    });
    return {
      id: run.id,
      project_id: run.project_id,
      question_set_id: run.question_set_id,
      question_set_name: run.question_set_name,
      source: run.source,
      schema_version: run.schema_version,
      analysis_contract_version: run.analysis_contract_version || null,
      metric_semantics_version: fallbackMetricSemanticsVersion,
      planned_platforms: Array.isArray(run.planned_platforms) ? run.planned_platforms : [],
      skipped_platforms: Array.isArray(run.skipped_platforms) ? run.skipped_platforms : [],
      status,
      control_state: controlState,
      started_at: run.started_at,
      completed_at: run.completed_at,
      paused_at: pausedAt,
      created_at: run.created_at,
      updated_at: run.updated_at,
      integrity: {
        status: integrityStatus,
        missing_record_count: Number(run.integrity_missing_record_count) || 0,
        error_code: run.integrity_error_code || null
      },
      capabilities: deriveCapabilities({
        source: run.source,
        status,
        summary,
        integrityStatus
      }),
      execution_summary: executionSummary,
      summary,
      rows
    };
  }

  async reconcileNativeRun({
    projectId,
    runId,
    expectedRevision = null,
    now = new Date(),
    repositories = {}
  }) {
    const Run = repositories.QuestionSetRun || QuestionSetRun;
    const stored = await this.findRun({ projectId, runId, repositories });
    if (!stored) {
      return {
        ok: false,
        reconciled: false,
        reason: 'run_not_found'
      };
    }
    const run = plain(stored);
    if (run.source !== 'native') {
      return {
        ok: false,
        reconciled: false,
        reason: 'not_native'
      };
    }
    const revision = Number(run.revision) || 0;
    const requestedRevision = expectedRevision === null || expectedRevision === undefined
      ? revision
      : Number(expectedRevision);
    if (!Number.isInteger(requestedRevision) || requestedRevision !== revision) {
      console.warn('拒绝旧 revision 收敛父运行:', {
        question_set_run_id: run.id,
        expected_revision: requestedRevision,
        actual_revision: revision,
        error_code: 'question_set_run_reconcile_stale_revision'
      });
      return {
        ok: false,
        reconciled: false,
        reason: 'stale_revision',
        revision
      };
    }

    const cachedRows = Array.isArray(run.imported_rows) ? run.imported_rows : [];
    const integrityStatus = run.integrity_status || 'complete';
    if (
      run.completed_at
      && !run.paused_at
      && (cachedRows.length > 0 || integrityStatus !== 'complete')
    ) {
      return {
        ok: true,
        reconciled: false,
        reason: 'already_terminal',
        status: integrityStatus === 'missing_records'
          ? 'failed'
          : deriveStatus(cachedRows),
        revision
      };
    }

    const rows = await this.getNativeRows(run, repositories);
    const expectedRows = Number(run.planned_record_count) || 0;
    const status = deriveStatus(rows, run.paused_at || null);
    const pending = rows.filter((row) => row.status === 'pending').length;
    if (pending > 0) {
      return {
        ok: true,
        reconciled: false,
        reason: 'pending_records',
        status,
        pending,
        revision
      };
    }

    const recordCountMatches = rows.length > 0 && rows.length === expectedRows;
    const terminalStatus = recordCountMatches ? deriveStatus(rows) : 'failed';
    const missingRecordCount = recordCountMatches
      ? 0
      : Math.max(1, Math.abs(expectedRows - rows.length));
    const integrityErrorCode = recordCountMatches
      ? null
      : (rows.length === 0
          ? 'empty_native_run'
          : 'question_set_run_record_count_mismatch');
    const [updatedRows] = await Run.update(
      {
        imported_rows: rows,
        completed_at: new Date(now),
        paused_at: null,
        integrity_status: recordCountMatches ? 'complete' : 'missing_records',
        integrity_missing_record_count: missingRecordCount,
        integrity_error_code: integrityErrorCode
      },
      {
        where: {
          id: run.id,
          project_id: run.project_id,
          revision,
          completed_at: run.completed_at || null
        }
      }
    );
    if (updatedRows !== 1) {
      const latestStored = await this.findRun({ projectId, runId, repositories });
      const latest = plain(latestStored);
      const latestRevision = Number(latest?.revision) || 0;
      if (latestRevision !== revision) {
        console.warn('拒绝旧 revision 收敛父运行:', {
          question_set_run_id: run.id,
          expected_revision: revision,
          actual_revision: latestRevision,
          error_code: 'question_set_run_reconcile_stale_revision'
        });
        return {
          ok: false,
          reconciled: false,
          reason: 'stale_revision',
          revision: latestRevision
        };
      }
      if (latest?.completed_at) {
        return {
          ok: true,
          reconciled: false,
          reason: 'already_terminal',
          status: latest.integrity_status === 'missing_records'
            ? 'failed'
            : deriveStatus(Array.isArray(latest.imported_rows) ? latest.imported_rows : []),
          revision: latestRevision
        };
      }
      const error = new Error('问题集父运行收敛写入未生效');
      error.code = 'question_set_run_reconcile_write_rejected';
      throw error;
    }
    console.log('问题集父运行已收敛:', {
      question_set_run_id: run.id,
      revision,
      status: terminalStatus,
      error_code: recordCountMatches ? null : integrityErrorCode
    });
    return {
      ok: true,
      reconciled: true,
      status: terminalStatus,
      revision,
      integrity_status: recordCountMatches ? 'complete' : 'missing_records'
    };
  }

  async reconcileIncompleteNativeRuns({
    limit = 100,
    now = new Date(),
    repositories = {}
  } = {}) {
    const Run = repositories.QuestionSetRun || QuestionSetRun;
    const Record = repositories.QuestionRecord || QuestionRecord;
    const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : 100;
    const runs = await Run.findAll({
      where: {
        source: 'native',
        completed_at: null,
        '$questionRecords.id$': null
      },
      include: [{
        model: Record,
        as: 'questionRecords',
        attributes: [],
        required: false,
        where: {
          status: 'pending',
          run_slot_index: { [Op.not]: null }
        }
      }],
      order: [['id', 'ASC']],
      limit: safeLimit,
      subQuery: false
    });
    const results = [];
    let firstError = null;
    for (const stored of runs) {
      const run = plain(stored);
      try {
        results.push(await this.reconcileNativeRun({
          projectId: run.project_id,
          runId: run.id,
          expectedRevision: Number(run.revision) || 0,
          now,
          repositories
        }));
      } catch (error) {
        firstError ||= error;
        console.error('问题集父运行收敛失败:', {
          question_set_run_id: run.id,
          revision: Number(run.revision) || 0,
          error_code: error.code || 'question_set_run_reconcile_failed'
        });
      }
    }
    if (firstError) {
      const error = new Error('存在未能收敛的问题集父运行');
      error.code = 'question_set_run_reconcile_failed';
      error.cause = firstError;
      throw error;
    }
    return results;
  }

  async listReports({ projectId, questionSetId, page = 1, pageSize = 20, repositories = {} }) {
    const Run = repositories.QuestionSetRun || QuestionSetRun;
    const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
    const safePageSize = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 20));
    const where = { project_id: projectId };
    if (Number.isInteger(questionSetId) && questionSetId > 0) {
      where.question_set_id = questionSetId;
    }
    const result = await Run.findAndCountAll({
      where,
      order: [['created_at', 'DESC'], ['id', 'DESC']],
      limit: safePageSize,
      offset: (safePage - 1) * safePageSize
    });
    const brandProject = await this.findBrandProject(projectId, repositories);
    const reports = await Promise.all(result.rows.map((item) => this.getReport({
      projectId,
      runId: item.id,
      brandProject,
      repositories
    })));
    return {
      data: reports.map(({ rows, ...report }) => report),
      pagination: {
        page: safePage,
        pageSize: safePageSize,
        totalItems: result.count,
        totalPages: Math.ceil(result.count / safePageSize)
      }
    };
  }

  async exportCsv({ projectId, runId, repositories = {} }) {
    const report = await this.getReport({ projectId, runId, repositories });
    if (!report) return null;
    const storedRun = plain(await this.findRun({ projectId, runId, repositories }));
    const sourceIntegrityStatus = report.integrity?.status || 'complete';
    const storedRows = Array.isArray(storedRun?.imported_rows) ? storedRun.imported_rows : [];
    const expectedRows = Number(storedRun?.planned_record_count) || 0;
    const nativeRunNotFrozen = report.source === 'native' && (
      !storedRun?.completed_at
      || storedRows.length === 0
      || expectedRows <= 0
      || storedRows.length !== expectedRows
      || report.rows.length !== expectedRows
    );
    if (
      !['complete', 'unverified_import'].includes(sourceIntegrityStatus)
      || Number(report.execution_summary?.pending) > 0
      || ['running', 'paused'].includes(report.status)
      || nativeRunNotFrozen
    ) {
      throw csvExportError({
        code: 'CSV_EXPORT_NOT_ALLOWED',
        status: 409,
        message: '只有终态且记录完整的报告可以生成可信 CSV 签名'
      });
    }
    let integrityKeys;
    try {
      integrityKeys = csvIntegrityKeys();
    } catch (cause) {
      throw csvExportError({
        code: 'CSV_EXPORT_INTEGRITY_UNAVAILABLE',
        status: 503,
        message: 'CSV 报告完整性配置不可用',
        cause
      });
    }
    if (!integrityKeys.length) {
      throw csvExportError({
        code: 'CSV_EXPORT_INTEGRITY_UNAVAILABLE',
        status: 503,
        message: 'CSV 报告完整性密钥未配置'
      });
    }
    return QuestionSetRunCsvService.buildCsv(report, {
      integrityKey: integrityKeys[0],
      integrityKeyId: CSV_INTEGRITY_KEY_ID,
      sourceProjectId: projectId,
      sourceIntegrityStatus
    });
  }

  async importCsv({ project, user, csv, repositories = {} }) {
    const Run = repositories.QuestionSetRun || QuestionSetRun;
    const projectRow = plain(project);
    const userRow = plain(user);
    const integrityKeys = csvIntegrityKeys();
    const parsed = QuestionSetRunCsvService.parseCsv(csv, {
      integrityKeys,
      expectedProjectId: projectRow.id
    });
    const currentV5 = parsed.analysisContractVersion === V5_ANALYSIS_CONTRACT
      || parsed.metricSemanticsVersion === SCOPED_METRIC_SEMANTICS;
    if (!parsed.integrityVerified && currentV5) {
      throw new QuestionSetRunCsvService.CsvValidationError(
        'CSV_SIGNATURE_REQUIRED',
        'v5 CSV 必须携带由当前或历史完整性密钥验证通过的文件签名'
      );
    }
    if (parsed.integrityPresent && !parsed.integrityVerified) {
      throw new QuestionSetRunCsvService.CsvValidationError(
        'INVALID_CSV_SIGNATURE',
        'CSV 完整性签名无法由当前或历史密钥验证'
      );
    }
    const importedRows = parsed.integrityVerified
      ? parsed.rows
      : parsed.rows.map(downgradeUnverifiedImportedMetrics);
    const integrityStatus = parsed.integrityVerified
      ? (parsed.sourceIntegrityStatus || 'complete')
      : 'unverified_import';
    return Run.create({
      project_id: projectRow.id,
      user_id: userRow.id,
      question_set_id: null,
      question_set_name: parsed.questionSetName,
      source: 'imported',
      schema_version: parsed.schemaVersion,
      analysis_contract_version: parsed.analysisContractVersion,
      metric_semantics_version: parsed.metricSemanticsVersion,
      planned_record_count: 0,
      integrity_status: integrityStatus,
      integrity_missing_record_count: 0,
      integrity_error_code: parsed.integrityVerified ? null : 'csv_signature_missing',
      imported_rows: importedRows,
      started_at: parsed.startedAt,
      completed_at: parsed.completedAt
    });
  }
}

module.exports = new QuestionSetRunService();
module.exports.SCHEMA_VERSION = SCHEMA_VERSION;
module.exports.deriveStatus = deriveStatus;
module.exports.deriveExecutionState = deriveExecutionState;
module.exports.deriveControlState = deriveControlState;
module.exports.deriveCapabilities = deriveCapabilities;
module.exports.summarize = summarize;
module.exports.summarizeExecution = summarizeExecution;
module.exports.normalizeNativeRow = normalizeNativeRow;
