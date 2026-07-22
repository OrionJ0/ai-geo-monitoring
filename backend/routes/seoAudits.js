const express = require('express');
const { createSeoAuditService } = require('../services/SeoAuditService');

function createAuditHandler({ service = createSeoAuditService() } = {}) {
  return async function auditHandler(req, res) {
    const url = String(req.body?.url || '').trim();
    if (!url) {
      return res.status(400).json({ success: false, message: '请输入需要检测的网址' });
    }

    try {
      const report = await service.audit(url);
      return res.json({ success: true, data: report });
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

const router = express.Router();
router.post('/', createAuditHandler());

module.exports = router;
module.exports.createAuditHandler = createAuditHandler;
