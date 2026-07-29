const { Op } = require('sequelize');
const {
  BrandProject,
  QuestionSetRun,
  QuestionRecord,
  ResultDetail,
  VisibilityMetric
} = require('../models');
const QuestionSetRunCsvService = require('./QuestionSetRunCsvService');
const CitationMetricSemanticsService = require('./CitationMetricSemanticsService');
const GeoMetricSemanticsService = require('./GeoMetricSemanticsService');
const {
  CURRENT_METRIC_SEMANTICS,
  LEGACY_METRIC_SEMANTICS
} = require('./GeoMetricSemanticsService');

const SCHEMA_VERSION = 'question_set_run_v1';
const STRUCTURED_ANALYSIS_METHODS = new Set([
  'ai_structured_v1',
  'ai_structured_v2',
  'ai_structured_v3'
]);

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
  const rawSources = Array.isArray(row?.citation_sources) ? row.citation_sources : [];
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
  const currentScopeRows = rows.filter(
    (row) => row.metric_semantics_version === CURRENT_METRIC_SEMANTICS
  );
  const usesCurrentSemantics = currentScopeRows.length > 0;
  const metricRows = completedRows.filter((row) => (
    row.has_metrics
    && (
      !usesCurrentSemantics
      || row.metric_semantics_version === CURRENT_METRIC_SEMANTICS
    )
  ));
  const acquiredRows = usesCurrentSemantics
    ? currentScopeRows.filter((row) => String(row.answer || '').trim())
    : [];
  const citationRows = usesCurrentSemantics
    ? acquiredRows.filter((row) => row.citation_evidence_status === 'explicit')
    : metricRows.filter((row) => row.citation_evidence_status === 'explicit');
  const rankedRows = metricRows.filter((row) => finiteNumber(row.brand_rank) > 0);
  const sovCalculableRows = usesCurrentSemantics
    ? metricRows.filter((row) => row.answer_competitor_share !== null
      && row.answer_competitor_share !== undefined
      && Number.isFinite(Number(row.answer_competitor_share)))
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
  const brandMentionedAnswers = metricRows.filter((row) => row.brand_mentioned).length;
  const recommendedAnswers = metricRows.filter((row) => row.brand_recommended).length;

  const common = {
    total: rows.length,
    completed: completedRows.length,
    failed: rows.filter((row) => row.status === 'failed').length,
    pending: rows.filter((row) => row.status === 'pending').length,
    valid_analyses: metricRows.length,
    valid_answers: usesCurrentSemantics ? metricRows.length : null,
    acquired_answers: usesCurrentSemantics ? acquiredRows.length : null,
    analysis_coverage_rate: usesCurrentSemantics
      ? nullablePercent(metricRows.length, acquiredRows.length)
      : null,
    brand_mentioned_answers: usesCurrentSemantics ? brandMentionedAnswers : null,
    recommended_answers: usesCurrentSemantics ? recommendedAnswers : null,
    ranked_answers: usesCurrentSemantics ? rankedRows.length : null,
    sov_calculable_answers: usesCurrentSemantics ? sovCalculableRows.length : null,
    avg_answer_competitor_share: usesCurrentSemantics
      ? (sovCalculableRows.length
          ? Number((sum('answer_competitor_share', sovCalculableRows) / sovCalculableRows.length).toFixed(2))
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
      ? nullablePercent(recommendedAnswers, metricRows.length)
      : percent(recommendedAnswers, metricRows.length),
    citation_rate: percent(citationRows.filter((row) => finiteNumber(row.citation_count) > 0).length, citationRows.length),
    owned_citation_rate: percent(citationRows.filter((row) => ownedCitationCount(row) > 0).length, citationRows.length),
    avg_brand_rank: rankedRows.length ? Number((sum('brand_rank', rankedRows) / rankedRows.length).toFixed(2)) : null,
    total_citations: sum('citation_count', citationRows),
    total_owned_citations: totalOwnedCitations
  };
  if (usesCurrentSemantics) {
    return {
      ...common,
      sov_summary: {
        metric_semantics_version: CURRENT_METRIC_SEMANTICS,
        kind: 'contextual_competitor_mentions',
        average: common.avg_answer_competitor_share,
        calculable_answers: sovCalculableRows.length
      }
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
    output.push({
      url,
      title: boundedText(source.title, 500),
      domain: boundedText(source.domain, 255) || new URL(url).hostname,
      source_role: sourceRole
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
    selector_version: boundedText(value.selector_version, 100),
    artifact_owner_record_id: recordId,
    captured_at: boundedText(value.captured_at || value.completed_at, 80),
    search: {
      requested: value.search?.requested === true,
      observed: value.search?.observed === true,
      evidence_type: boundedText(value.search?.evidence_type, 100)
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
  const sov = metric ? GeoMetricSemanticsService.presentSov(metric) : null;
  const analysisDiagnostics = normalizeAnalysisDiagnostics(row.result_summary?.analysis);
  const failure = normalizeFailure(row.result_summary?.failure);
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
    error_message: row.error_message || '',
    failure,
    retry,
    analysis_diagnostics: analysisDiagnostics,
    answer: detail.ai_response_original || '',
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
      && metricSemanticsVersion === CURRENT_METRIC_SEMANTICS
      ? metric?.answer_competitor_share ?? null
      : null,
    sov_numerator: metric
      && metricSemanticsVersion === CURRENT_METRIC_SEMANTICS
      ? finiteNumber(metric?.sov_numerator)
      : null,
    sov_denominator: metric
      && metricSemanticsVersion === CURRENT_METRIC_SEMANTICS
      ? finiteNumber(metric?.sov_denominator)
      : null,
    competition_entities: metricSemanticsVersion === CURRENT_METRIC_SEMANTICS
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
    const summary = summarize(rows);
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
      execution_summary: summarizeExecution(rows),
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
    return QuestionSetRunCsvService.buildCsv(report);
  }

  async importCsv({ project, user, csv, repositories = {} }) {
    const Run = repositories.QuestionSetRun || QuestionSetRun;
    const projectRow = plain(project);
    const userRow = plain(user);
    const parsed = QuestionSetRunCsvService.parseCsv(csv);
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
      integrity_status: 'complete',
      integrity_missing_record_count: 0,
      integrity_error_code: null,
      imported_rows: parsed.rows,
      started_at: parsed.startedAt,
      completed_at: parsed.completedAt
    });
  }
}

module.exports = new QuestionSetRunService();
module.exports.SCHEMA_VERSION = SCHEMA_VERSION;
module.exports.deriveStatus = deriveStatus;
module.exports.deriveCapabilities = deriveCapabilities;
module.exports.summarize = summarize;
module.exports.summarizeExecution = summarizeExecution;
