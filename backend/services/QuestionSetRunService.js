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

const SCHEMA_VERSION = 'question_set_run_v1';
const STRUCTURED_ANALYSIS_METHODS = new Set(['ai_structured_v1', 'ai_structured_v2']);

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
  if (row?.has_metrics === false) {
    return {
      ...row,
      citation_count: 0,
      owned_citation_count: 0,
      competitor_citation_count: 0,
      citation_sources: [],
      citation_evidence_status: 'none'
    };
  }
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
  const metricRows = completedRows.filter((row) => row.has_metrics);
  const citationRows = metricRows.filter((row) => row.citation_evidence_status === 'explicit');
  const rankedRows = metricRows.filter((row) => finiteNumber(row.brand_rank) > 0);
  const competitorBaselineCount = metricRows.reduce(
    (maximum, row) => Math.max(maximum, Array.isArray(row.competitor_mentions) ? row.competitor_mentions.length : 0),
    0
  );
  const sum = (key, list = metricRows) => list.reduce((total, row) => total + finiteNumber(row[key]), 0);
  const totalOwnedCitations = citationRows.reduce((total, row) => total + ownedCitationCount(row), 0);

  return {
    total: rows.length,
    completed: completedRows.length,
    failed: rows.filter((row) => row.status === 'failed').length,
    pending: rows.filter((row) => row.status === 'pending').length,
    valid_analyses: metricRows.length,
    citation_valid_analyses: citationRows.length,
    citation_unverified_analyses: metricRows.length - citationRows.length,
    competitor_baseline_count: competitorBaselineCount,
    brand_mention_rate: percent(metricRows.filter((row) => row.brand_mentioned).length, metricRows.length),
    recommendation_rate: percent(metricRows.filter((row) => row.brand_recommended).length, metricRows.length),
    avg_share_of_voice: metricRows.length ? Number((sum('share_of_voice') / metricRows.length).toFixed(2)) : 0,
    citation_rate: percent(citationRows.filter((row) => finiteNumber(row.citation_count) > 0).length, citationRows.length),
    owned_citation_rate: percent(citationRows.filter((row) => ownedCitationCount(row) > 0).length, citationRows.length),
    avg_brand_rank: rankedRows.length ? Number((sum('brand_rank', rankedRows) / rankedRows.length).toFixed(2)) : null,
    total_citations: sum('citation_count', citationRows),
    total_owned_citations: totalOwnedCitations
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

function normalizeNativeRow(record) {
  const row = plain(record);
  const detail = plain(row.resultDetail) || {};
  const metric = plain(row.visibilityMetric) || null;
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
    has_metrics: Boolean(metric),
    brand_mentioned: Boolean(metric?.brand_mentioned),
    brand_mentions: finiteNumber(metric?.brand_mentions),
    brand_rank: STRUCTURED_ANALYSIS_METHODS.has(metric?.analysis_method)
      || (Array.isArray(metric?.competitor_mentions) && metric.competitor_mentions.length > 0)
      ? (metric?.brand_rank == null ? null : finiteNumber(metric.brand_rank))
      : null,
    brand_recommended: Boolean(metric?.brand_recommended),
    share_of_voice: finiteNumber(metric?.share_of_voice),
    citation_count: finiteNumber(metric?.citation_count),
    owned_citation_count: finiteNumber(metric?.owned_citation_count),
    competitor_citation_count: finiteNumber(metric?.competitor_citation_count),
    sentiment: metric?.sentiment || '',
    sentiment_reason: metric?.sentiment_reason || '',
    analysis_method: metric?.analysis_method || 'legacy_rules_v1',
    analysis_platform: metric?.analysis_platform || '',
    analysis_model: metric?.analysis_model || '',
    analysis_structure: metric?.analysis_structure && typeof metric.analysis_structure === 'object'
      ? metric.analysis_structure
      : {},
    analysis_evidence: metric?.analysis_evidence && typeof metric.analysis_evidence === 'object'
      ? metric.analysis_evidence
      : {},
    competitor_mentions: Array.isArray(metric?.competitor_mentions) ? metric.competitor_mentions : [],
    citation_sources: Array.isArray(metric?.citation_sources) ? metric.citation_sources : [],
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  });
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
    const rows = sourceRows.map(normalizeCitationSemantics).map((row) => {
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
