const { Op } = require('sequelize');
const SeoAuditJob = require('../models/SeoAuditJob');
const { normalizeWebsiteUrl } = require('./SeoAuditService');
const { createSeoAuditHistoryService } = require('./SeoAuditHistoryService');
const { compareAuditIssues } = require('./SeoSitewideAnalysisService');
const {
  createSiteAuditRuntime,
  resolveSeoAuditTarget,
  withNetworkPolicy
} = require('./SeoAuditRuntimeService');
const SeoAuditSettingsService = require('./SeoAuditSettingsService');

function defaultSchedule(callback) {
  setImmediate(() => Promise.resolve(callback()).catch((error) => {
    console.error('执行全站 SEO 检测任务失败:', error);
  }));
}

function plainRow(row) {
  if (typeof row?.get === 'function') return row.get({ plain: true });
  if (typeof row?.toJSON === 'function') return row.toJSON();
  return row;
}

function summarize(row) {
  const value = plainRow(row);
  return {
    id: value.id,
    requestedUrl: value.requested_url,
    status: value.status,
    progress: value.progress || { phase: value.status },
    auditId: value.audit_record_id || null,
    error: value.status === 'failed' ? {
      code: value.error_code || 'AUDIT_FAILED',
      message: value.error_message || '全站 SEO 检测失败，请稍后重试'
    } : null,
    createdAt: value.created_at ? new Date(value.created_at).toISOString() : null,
    startedAt: value.started_at ? new Date(value.started_at).toISOString() : null,
    completedAt: value.completed_at ? new Date(value.completed_at).toISOString() : null
  };
}

const SAFE_STOP_REASONS = new Set([
  'completed',
  'page_limit',
  'waf_blocked',
  'rate_limited',
  'entry_http_error',
  'entry_invalid_response',
  'resource_invalid'
]);

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safeCrawlDiagnostics(value) {
  if (!value || typeof value !== 'object') return null;
  const networkRequests = value.networkRequests || {};
  const byKind = networkRequests.byKind || {};
  return {
    networkRequests: {
      total: safeCount(networkRequests.total),
      byKind: {
        page: safeCount(byKind.page),
        robots: safeCount(byKind.robots),
        sitemap: safeCount(byKind.sitemap),
        link_probe: safeCount(byKind.link_probe)
      },
      redirectHops: safeCount(networkRequests.redirectHops)
    },
    renderAttempts: safeCount(value.renderAttempts),
    stopReason: SAFE_STOP_REASONS.has(value.stopReason) ? value.stopReason : null
  };
}

function safeFailure(error) {
  if (error?.code && Number.isInteger(error.status)) {
    return {
      code: error.code,
      message: error.message,
      stopReason: error.stopReason || null,
      retryAt: error.retryAt || null,
      crawlDiagnostics: safeCrawlDiagnostics(error.crawlDiagnostics)
    };
  }
  return { code: 'AUDIT_FAILED', message: '全站 SEO 检测失败，请稍后重试' };
}

function createSeoAuditJobService({
  model = SeoAuditJob,
  siteAuditService,
  runtimeFactory = createSiteAuditRuntime,
  targetResolver = resolveSeoAuditTarget,
  historyService = createSeoAuditHistoryService(),
  settingsService,
  schedule = defaultSchedule
} = {}) {
  const effectiveSettingsService = siteAuditService
    ? null
    : (settingsService
        || (runtimeFactory === createSiteAuditRuntime ? SeoAuditSettingsService : null));

  async function run(jobId) {
    const job = await model.findByPk(jobId);
    if (!job || ['completed', 'failed'].includes(job.status)) return;

    await job.update({
      status: 'running',
      started_at: new Date(),
      completed_at: null,
      error_code: null,
      error_message: null,
      progress: { phase: 'running', discoveredPages: 0, auditedPages: 0, failedPages: 0 }
    });

    try {
      const runtimeSettings = effectiveSettingsService
        ? await effectiveSettingsService.getSettings()
        : { ownedOrigins: [] };
      const runtime = siteAuditService
        ? {
            requestedUrl: job.requested_url,
            policy: { networkScope: 'public' },
            service: siteAuditService
          }
        : runtimeFactory(job.requested_url, {
            ownedOrigins: runtimeSettings.ownedOrigins
          });
      const audited = await runtime.service.audit(runtime.requestedUrl, {
        onProgress: (progress) => job.update({ progress })
      });
      const report = withNetworkPolicy(audited, runtime.policy, { mode: 'site' });
      const previousReport = typeof historyService.findPreviousSiteReport === 'function'
        ? await historyService.findPreviousSiteReport(
          Number(job.user_id),
          report.site?.origin || report.finalUrl || job.requested_url,
          { before: report.checkedAt }
        )
        : null;
      report.comparison = compareAuditIssues(report, previousReport);
      const stored = await historyService.save(Number(job.user_id), report);
      await job.update({
        status: 'completed',
        audit_record_id: stored.id,
        completed_at: new Date(),
        progress: {
          phase: 'completed',
          discoveredPages: report.site.discoveredPages,
          auditedPages: report.site.auditedPages,
          failedPages: report.site.failedPages,
          truncated: report.site.truncated
        }
      });
    } catch (error) {
      const failure = safeFailure(error);
      await job.update({
        status: 'failed',
        error_code: failure.code,
        error_message: failure.message,
        completed_at: new Date(),
        progress: {
          ...(job.progress || {}),
          phase: 'failed',
          ...(failure.stopReason ? { stopReason: failure.stopReason } : {}),
          ...(failure.retryAt ? { retryAt: failure.retryAt } : {}),
          ...(failure.crawlDiagnostics ? { crawlDiagnostics: failure.crawlDiagnostics } : {})
        }
      });
    }
  }

  return {
    async create(userId, inputUrl) {
      const requestedUrl = normalizeWebsiteUrl(inputUrl);
      targetResolver(requestedUrl);
      const job = await model.create({
        user_id: Number(userId),
        requested_url: requestedUrl,
        status: 'queued',
        progress: { phase: 'queued', discoveredPages: 0, auditedPages: 0, failedPages: 0 }
      });
      schedule(() => run(job.id));
      return summarize(job);
    },

    async get(userId, jobId) {
      const row = await model.findOne({ where: { id: jobId, user_id: Number(userId) } });
      if (!row) return null;
      const result = summarize(row);
      if (result.status === 'completed' && result.auditId) {
        result.report = await historyService.get(Number(userId), result.auditId);
      }
      return result;
    },

    run,

    async recoverInterruptedJobs() {
      const jobs = await model.findAll({ where: { status: { [Op.in]: ['queued', 'running'] } } });
      await Promise.all(jobs.map((job) => job.update({
        status: 'queued',
        progress: { ...(job.progress || {}), phase: 'queued', recovered: true }
      })));
      jobs.forEach((job) => schedule(() => run(job.id)));
      return jobs.length;
    }
  };
}

module.exports = { createSeoAuditJobService, summarize };
