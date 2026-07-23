const express = require('express');
const { createSeoAuditService } = require('../services/SeoAuditService');
const { createSeoAuditHistoryService } = require('../services/SeoAuditHistoryService');
const { createSeoAuditJobService } = require('../services/SeoAuditJobService');
const SeoAuditExchangeService = require('../services/SeoAuditExchangeService');
const { defaultSeoHealthScoreConfig } = require('../config/seoAuditRules');

function createRuntimeInfoHandler({
  scoreVersion = defaultSeoHealthScoreConfig.version,
  scoreModel = 'technical-health-v4'
} = {}) {
  return function runtimeInfoHandler(req, res) {
    return res.json({
      success: true,
      data: { scoreVersion, scoreModel }
    });
  };
}

function createAuditHandler({
  service = createSeoAuditService(),
  historyService = createSeoAuditHistoryService()
} = {}) {
  return async function auditHandler(req, res) {
    const url = String(req.body?.url || '').trim();
    if (!url) {
      return res.status(400).json({ success: false, message: '请输入需要检测的网址' });
    }

    try {
      const report = await service.audit(url);
      const stored = await historyService.save(Number(req.user.id), report);
      return res.json({ success: true, data: { ...report, auditId: stored.id } });
    } catch (error) {
      if (error?.code && Number.isInteger(error.status)) {
        return res.status(error.status).json({
          success: false,
          message: error.message,
          code: error.code
        });
      }
      console.error('SEO 检测失败:', error);
      return res.status(500).json({ success: false, message: 'SEO 检测失败，请稍后重试' });
    }
  };
}

function createListHandler({ historyService = createSeoAuditHistoryService() } = {}) {
  return async function listHandler(req, res) {
    try {
      const data = await historyService.list(Number(req.user.id), {
        page: req.query?.page,
        pageSize: req.query?.pageSize
      });
      return res.json({ success: true, data });
    } catch (error) {
      console.error('读取 SEO 检测历史失败:', error);
      return res.status(500).json({ success: false, message: '读取 SEO 检测历史失败' });
    }
  };
}

function createSiteAuditHandler({ jobService = createSeoAuditJobService() } = {}) {
  return async function siteAuditHandler(req, res) {
    const url = String(req.body?.url || '').trim();
    if (!url) {
      return res.status(400).json({ success: false, message: '请输入需要检测的网址' });
    }
    try {
      const job = await jobService.create(Number(req.user.id), url);
      return res.status(202).json({ success: true, data: job });
    } catch (error) {
      if (error?.code && Number.isInteger(error.status)) {
        return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      }
      console.error('创建全站 SEO 检测任务失败:', error);
      return res.status(500).json({ success: false, message: '创建全站 SEO 检测任务失败' });
    }
  };
}

function createJobDetailHandler({ jobService = createSeoAuditJobService() } = {}) {
  return async function jobDetailHandler(req, res) {
    const jobId = Number(req.params?.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) {
      return res.status(404).json({ success: false, message: 'SEO 检测任务不存在' });
    }
    try {
      const job = await jobService.get(Number(req.user.id), jobId);
      if (!job) {
        return res.status(404).json({ success: false, message: 'SEO 检测任务不存在' });
      }
      return res.json({ success: true, data: job });
    } catch (error) {
      console.error('读取全站 SEO 检测任务失败:', error);
      return res.status(500).json({ success: false, message: '读取全站 SEO 检测任务失败' });
    }
  };
}

function createDetailHandler({ historyService = createSeoAuditHistoryService() } = {}) {
  return async function detailHandler(req, res) {
    const auditId = Number(req.params?.id);
    if (!Number.isInteger(auditId) || auditId < 1) {
      return res.status(404).json({ success: false, message: 'SEO 检测历史不存在' });
    }
    try {
      const report = await historyService.get(Number(req.user.id), auditId);
      if (!report) {
        return res.status(404).json({ success: false, message: 'SEO 检测历史不存在' });
      }
      return res.json({ success: true, data: report });
    } catch (error) {
      console.error('读取 SEO 检测报告失败:', error);
      return res.status(500).json({ success: false, message: '读取 SEO 检测报告失败' });
    }
  };
}

function createExportHandler({
  historyService = createSeoAuditHistoryService(),
  exchangeService = SeoAuditExchangeService
} = {}) {
  return async function exportHandler(req, res) {
    const auditId = Number(req.params?.id);
    if (!Number.isInteger(auditId) || auditId < 1) {
      return res.status(404).json({ success: false, message: 'SEO 检测历史不存在' });
    }
    try {
      const report = await historyService.get(Number(req.user.id), auditId);
      if (!report) {
        return res.status(404).json({ success: false, message: 'SEO 检测历史不存在' });
      }
      const csv = exchangeService.buildCsv(report);
      res.type('text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="seo-audit-${auditId}.csv"`);
      return res.send(csv);
    } catch (error) {
      console.error('导出 SEO 检测报告失败:', error);
      return res.status(500).json({ success: false, message: '导出 SEO 检测报告失败' });
    }
  };
}

function createImportHandler({
  historyService = createSeoAuditHistoryService(),
  exchangeService = SeoAuditExchangeService
} = {}) {
  return async function importHandler(req, res) {
    try {
      const parsed = exchangeService.parseCsv(req.body);
      const report = exchangeService.prepareImportedReport(parsed);
      const stored = await historyService.save(Number(req.user.id), report);
      return res.status(201).json({
        success: true,
        message: 'SEO 检测报告已导入',
        data: { ...report, auditId: stored.id }
      });
    } catch (error) {
      if (error?.code && Number.isInteger(error.status)) {
        return res.status(error.status).json({
          success: false,
          message: error.message,
          code: error.code
        });
      }
      console.error('导入 SEO 检测报告失败:', error);
      return res.status(500).json({ success: false, message: '导入 SEO 检测报告失败' });
    }
  };
}

const router = express.Router();
router.post('/', createAuditHandler());
router.post('/site', createSiteAuditHandler());
router.post('/import', express.text({
  type: ['text/csv', 'application/csv', 'text/plain'],
  limit: '10mb'
}), createImportHandler());
router.get('/runtime', createRuntimeInfoHandler());
router.get('/', createListHandler());
router.get('/jobs/:jobId', createJobDetailHandler());
router.get('/:id/export', createExportHandler());
router.get('/:id', createDetailHandler());

module.exports = router;
module.exports.createAuditHandler = createAuditHandler;
module.exports.createSiteAuditHandler = createSiteAuditHandler;
module.exports.createRuntimeInfoHandler = createRuntimeInfoHandler;
module.exports.createJobDetailHandler = createJobDetailHandler;
module.exports.createListHandler = createListHandler;
module.exports.createDetailHandler = createDetailHandler;
module.exports.createExportHandler = createExportHandler;
module.exports.createImportHandler = createImportHandler;
