const express = require('express');
const AIPlatformConfigService = require('../services/AIPlatformConfigService');
const AIPlatformRequestService = require('../services/AIPlatformRequestService');
const { PlatformConfigError } = require('../services/AIPlatformConfigService');
const { adminRequired } = require('../middleware/auth');

const router = express.Router();

router.use(adminRequired);

function handleError(res, error, operation) {
  if (error instanceof PlatformConfigError || Number.isInteger(error?.status)) {
    return res.status(error.status || 400).json({
      success: false,
      message: error.message,
      data: { error_code: error.code || 'invalid_platform_config' }
    });
  }
  console.error(`AI 平台${operation}失败:`, error?.name || 'Error');
  return res.status(500).json({ success: false, message: `${operation}失败` });
}

router.get('/', async (_req, res) => {
  try {
    const platforms = await AIPlatformConfigService.listAdminPlatforms();
    return res.json({ success: true, data: platforms });
  } catch (error) {
    return handleError(res, error, '列表读取');
  }
});

router.post('/', async (req, res) => {
  try {
    const platform = await AIPlatformConfigService.createPlatform(req.body || {});
    return res.status(201).json({ success: true, message: 'AI 平台已新增', data: platform });
  } catch (error) {
    return handleError(res, error, '新增');
  }
});

router.put('/:id', async (req, res) => {
  try {
    const platform = await AIPlatformConfigService.updatePlatform(req.params.id, req.body || {});
    return res.json({ success: true, message: 'AI 平台已更新', data: platform });
  } catch (error) {
    return handleError(res, error, '更新');
  }
});

router.put('/:id/enabled', async (req, res) => {
  try {
    if (typeof req.body?.enabled !== 'boolean') {
      throw new PlatformConfigError('enabled 必须是布尔值');
    }
    const platform = await AIPlatformConfigService.setEnabled(req.params.id, req.body.enabled);
    return res.json({ success: true, message: platform.enabled ? 'AI 平台已启用' : 'AI 平台已停用', data: platform });
  } catch (error) {
    return handleError(res, error, '启停');
  }
});

router.delete('/:id/api-key', async (req, res) => {
  try {
    const platform = await AIPlatformConfigService.clearApiKey(req.params.id);
    return res.json({ success: true, message: 'API Key 已清除', data: platform });
  } catch (error) {
    return handleError(res, error, '密钥清除');
  }
});

router.post('/:id/test', async (req, res) => {
  try {
    const result = await AIPlatformRequestService.testConnection(req.params.id);
    return res.json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, '连接测试');
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const platform = await AIPlatformConfigService.archivePlatform(req.params.id);
    return res.json({ success: true, message: 'AI 平台已归档', data: platform });
  } catch (error) {
    return handleError(res, error, '归档');
  }
});

module.exports = router;
