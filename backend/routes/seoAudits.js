const express = require('express');
const { createSeoAuditService } = require('../services/SeoAuditService');
const { createSeoAuditHistoryService } = require('../services/SeoAuditHistoryService');

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

const router = express.Router();
router.post('/', createAuditHandler());
router.get('/', createListHandler());
router.get('/:id', createDetailHandler());

module.exports = router;
module.exports.createAuditHandler = createAuditHandler;
module.exports.createListHandler = createListHandler;
module.exports.createDetailHandler = createDetailHandler;
