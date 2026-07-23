const SeoAuditRecord = require('../models/SeoAuditRecord');

function positiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function plainRow(row) {
  if (typeof row?.get === 'function') return row.get({ plain: true });
  if (typeof row?.toJSON === 'function') return row.toJSON();
  return row;
}

function summarize(row) {
  const value = plainRow(row);
  const summary = {
    ...(value.summary || {}),
    mode: value.summary?.mode || 'page',
    pages: value.summary?.pages || 1,
    failedPages: value.summary?.failedPages || 0,
    truncated: Boolean(value.summary?.truncated)
  };
  return {
    id: value.id,
    requestedUrl: value.requested_url,
    finalUrl: value.final_url,
    statusCode: value.status_code,
    durationMs: value.duration_ms,
    score: summary.scoreStatus === 'unknown' ? null : value.score,
    grade: value.grade,
    summary,
    checkedAt: new Date(value.checked_at).toISOString()
  };
}

function createSeoAuditHistoryService({ model = SeoAuditRecord } = {}) {
  return {
    async save(userId, report) {
      const scoreStatus = report.health?.status || (report.score === null ? 'unknown' : 'scored');
      const scoreFacts = report.scoreVersion ? {
        scoreVersion: report.scoreVersion,
        scoreModel: report.scoreModel || 'legacy',
        rawScore: report.health?.rawScore ?? report.score,
        scoreCap: report.health?.scoreCap ?? null,
        stageScores: Array.isArray(report.health?.stages) ? report.health.stages : []
      } : {};
      const summary = {
        ...(report.summary || {}),
        mode: report.mode || 'page',
        pages: report.site?.auditedPages || 1,
        failedPages: report.site?.failedPages || 0,
        truncated: Boolean(report.site?.truncated),
        scoreStatus,
        ...scoreFacts
      };
      return model.create({
        user_id: userId,
        requested_url: report.requestedUrl,
        final_url: report.finalUrl,
        status_code: report.statusCode,
        duration_ms: report.durationMs,
        score: report.score ?? 0,
        grade: report.grade,
        summary,
        report,
        checked_at: report.checkedAt
      });
    },

    async list(userId, { page: rawPage, pageSize: rawPageSize } = {}) {
      const page = positiveInteger(rawPage, 1, Number.MAX_SAFE_INTEGER);
      const pageSize = positiveInteger(rawPageSize, 10, 50);
      const { count, rows } = await model.findAndCountAll({
        where: { user_id: userId },
        attributes: [
          'id', 'requested_url', 'final_url', 'status_code', 'duration_ms',
          'score', 'grade', 'summary', 'checked_at'
        ],
        order: [['checked_at', 'DESC'], ['id', 'DESC']],
        limit: pageSize,
        offset: (page - 1) * pageSize
      });
      return {
        items: rows.map(summarize),
        pagination: {
          page,
          pageSize,
          totalItems: count,
          totalPages: Math.ceil(count / pageSize)
        }
      };
    },

    async get(userId, auditId) {
      const row = await model.findOne({ where: { id: auditId, user_id: userId } });
      if (!row) return null;
      const value = plainRow(row);
      return { ...value.report, auditId: value.id };
    }
  };
}

module.exports = { createSeoAuditHistoryService };
