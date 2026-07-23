const express = require('express');
const AIPlatformConfigService = require('../services/AIPlatformConfigService');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.use(authRequired);

router.get('/', async (_req, res) => {
  try {
    const platforms = await AIPlatformConfigService.listCatalog();
    return res.json({ success: true, data: platforms });
  } catch (error) {
    console.error('AI 平台目录读取失败:', error?.name || 'Error');
    return res.status(500).json({ success: false, message: '获取 AI 平台目录失败' });
  }
});

module.exports = router;
