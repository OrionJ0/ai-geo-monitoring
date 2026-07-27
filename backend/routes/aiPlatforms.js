const express = require('express');
const rateLimit = require('express-rate-limit');
const AIPlatformConfigService = require('../services/AIPlatformConfigService');
const WebPlatformRuntimeStatusService = require('../services/WebPlatformRuntimeStatusService');
const WebPlatformRegistry = require('../services/WebPlatformRegistry');
const {
  WEB_RUNTIME_STATUS_RATE_LIMIT
} = require('../config/apiRateLimitPolicy');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
const runtimeStatusLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: WEB_RUNTIME_STATUS_RATE_LIMIT,
  standardHeaders: false,
  legacyHeaders: false,
  message: 'Web 平台状态读取过于频繁，请稍后再试'
});

router.use(authRequired);

router.get('/:platformCode/runtime-status', runtimeStatusLimiter, async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const platformCode = String(req.params.platformCode || '').trim().toLowerCase();
  if (!WebPlatformRegistry.hasDefinition(platformCode)) {
    return res.status(404).json({
      success: false,
      message: '受管 Web 平台不存在'
    });
  }
  try {
    const status = await WebPlatformRuntimeStatusService.getStatus(platformCode);
    return res.json({ success: true, data: status });
  } catch (error) {
    console.error('Web 平台运行状态读取失败:', error?.name || 'Error');
    return res.status(500).json({
      success: false,
      message: platformCode === 'deepseek-web'
        ? '读取 DeepSeek Web 运行状态失败'
        : '读取 Web 平台运行状态失败'
    });
  }
});

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
