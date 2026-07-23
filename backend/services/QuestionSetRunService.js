const { Op } = require('sequelize');
const {
  QuestionSetRun,
  QuestionRecord,
  ResultDetail,
  VisibilityMetric
} = require('../models');
const QuestionSetRunCsvService = require('./QuestionSetRunCsvService');

const SCHEMA_VERSION = 'question_set_run_v1';

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

function deriveStatus(rows) {
  const total = rows.length;
  const pending = rows.filter((row) => row.status === 'pending').length;
  const completed = rows.filter((row) => row.status === 'completed').length;
  const failed = rows.filter((row) => row.status === 'failed').length;
  if (pending > 0 || total === 0) return 'running';
  if (completed === total) return 'completed';
  if (failed === total) return 'failed';
  return 'partial';
}

function summarize(rows) {
  const completedRows = rows.filter((row) => row.status === 'completed');
  const metricRows = completedRows.filter((row) => row.has_metrics);
  const rankedRows = metricRows.filter((row) => finiteNumber(row.brand_rank) > 0);
  const sum = (key, list = metricRows) => list.reduce((total, row) => total + finiteNumber(row[key]), 0);

  return {
    total: rows.length,
    completed: completedRows.length,
    failed: rows.filter((row) => row.status === 'failed').length,
    pending: rows.filter((row) => row.status === 'pending').length,
    valid_analyses: metricRows.length,
    brand_mention_rate: percent(metricRows.filter((row) => row.brand_mentioned).length, metricRows.length),
    recommendation_rate: percent(metricRows.filter((row) => row.brand_recommended).length, metricRows.length),
    avg_share_of_voice: metricRows.length ? Number((sum('share_of_voice') / metricRows.length).toFixed(2)) : 0,
    citation_rate: percent(metricRows.filter((row) => finiteNumber(row.citation_count) > 0).length, metricRows.length),
    avg_brand_rank: rankedRows.length ? Number((sum('brand_rank', rankedRows) / rankedRows.length).toFixed(2)) : null,
    total_citations: sum('citation_count')
  };
}

function normalizeNativeRow(record) {
  const row = plain(record);
  const detail = plain(row.resultDetail) || {};
  const metric = plain(row.visibilityMetric) || null;
  return {
    record_id: row.id,
    question_id: row.tracked_prompt_id,
    question: row.question || '',
    question_category: metric?.prompt_category || '',
    platform: row.platform || '',
    platform_name: row.platform_name || row.platform || '',
    model_name: row.model_name || '',
    status: row.status || 'pending',
    error_message: row.error_message || '',
    answer: detail.ai_response_original || '',
    has_metrics: Boolean(metric),
    brand_mentioned: Boolean(metric?.brand_mentioned),
    brand_mentions: finiteNumber(metric?.brand_mentions),
    brand_rank: metric?.brand_rank == null ? null : finiteNumber(metric.brand_rank),
    brand_recommended: Boolean(metric?.brand_recommended),
    share_of_voice: finiteNumber(metric?.share_of_voice),
    citation_count: finiteNumber(metric?.citation_count),
    sentiment: metric?.sentiment || '',
    sentiment_reason: metric?.sentiment_reason || '',
    competitor_mentions: Array.isArray(metric?.competitor_mentions) ? metric.competitor_mentions : [],
    citation_sources: Array.isArray(metric?.citation_sources) ? metric.citation_sources : [],
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

class QuestionSetRunService {
  async createNativeRun({ project, questionSet, user, runData, repositories = {} }) {
    const Run = repositories.QuestionSetRun || QuestionSetRun;
    const projectRow = plain(project);
    const questionSetRow = plain(questionSet);
    const userRow = plain(user);
    return Run.create({
      project_id: projectRow.id,
      user_id: userRow.id,
      question_set_id: questionSetRow.id,
      question_set_name: questionSetRow.name,
      source: 'native',
      schema_version: SCHEMA_VERSION,
      record_ids: Array.isArray(runData?.record_ids) ? runData.record_ids : [],
      started_at: new Date()
    });
  }

  async findRun({ projectId, runId, repositories = {} }) {
    const Run = repositories.QuestionSetRun || QuestionSetRun;
    return Run.findOne({ where: { id: runId, project_id: projectId } });
  }

  async getNativeRows(run, repositories = {}) {
    const Record = repositories.QuestionRecord || QuestionRecord;
    const ids = Array.isArray(run.record_ids) ? run.record_ids.map(Number).filter(Number.isInteger) : [];
    if (!ids.length) return [];
    const records = await Record.findAll({
      where: { id: { [Op.in]: ids }, project_id: run.project_id },
      include: [
        { model: repositories.ResultDetail || ResultDetail, as: 'resultDetail', required: false },
        { model: repositories.VisibilityMetric || VisibilityMetric, as: 'visibilityMetric', required: false }
      ]
    });
    const byId = new Map(records.map((record) => [Number(record.id), record]));
    return ids.map((id) => byId.get(id)).filter(Boolean).map(normalizeNativeRow);
  }

  async getReport({ projectId, runId, repositories = {} }) {
    const stored = await this.findRun({ projectId, runId, repositories });
    if (!stored) return null;
    const run = plain(stored);
    const cachedRows = Array.isArray(run.imported_rows) ? run.imported_rows : [];
    const rows = run.source === 'imported' || cachedRows.length
      ? cachedRows
      : await this.getNativeRows(run, repositories);
    const status = deriveStatus(rows);
    if (run.source === 'native' && !cachedRows.length && status !== 'running' && rows.length) {
      const completedAt = new Date();
      if (typeof stored.update === 'function') {
        await stored.update({ imported_rows: rows, completed_at: completedAt });
      }
      run.completed_at = completedAt;
    }
    return {
      id: run.id,
      project_id: run.project_id,
      question_set_id: run.question_set_id,
      question_set_name: run.question_set_name,
      source: run.source,
      schema_version: run.schema_version,
      status,
      started_at: run.started_at,
      completed_at: run.completed_at,
      created_at: run.created_at,
      updated_at: run.updated_at,
      summary: summarize(rows),
      rows
    };
  }

  async listReports({ projectId, page = 1, pageSize = 20, repositories = {} }) {
    const Run = repositories.QuestionSetRun || QuestionSetRun;
    const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
    const safePageSize = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 20));
    const result = await Run.findAndCountAll({
      where: { project_id: projectId },
      order: [['created_at', 'DESC'], ['id', 'DESC']],
      limit: safePageSize,
      offset: (safePage - 1) * safePageSize
    });
    const reports = await Promise.all(result.rows.map((item) => this.getReport({
      projectId,
      runId: item.id,
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
      record_ids: [],
      imported_rows: parsed.rows,
      started_at: parsed.startedAt,
      completed_at: parsed.completedAt
    });
  }
}

module.exports = new QuestionSetRunService();
module.exports.SCHEMA_VERSION = SCHEMA_VERSION;
module.exports.deriveStatus = deriveStatus;
module.exports.summarize = summarize;
