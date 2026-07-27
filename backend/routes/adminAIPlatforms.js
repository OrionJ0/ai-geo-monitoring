const express = require('express');
const AIPlatformConfigService = require('../services/AIPlatformConfigService');
const AIPlatformRequestService = require('../services/AIPlatformRequestService');
const WebPlatformRegistry = require('../services/WebPlatformRegistry');
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

async function getManagedWebService(id) {
  const row = await AIPlatformConfigService.requireCapability(
    id,
    'interactive_login'
  );
  let definition;
  try {
    definition = WebPlatformRegistry.validateManagedConfig(row);
  } catch (error) {
    throw new PlatformConfigError(
      '受管 Web 平台配置无效',
      error?.code || 'managed_config_invalid',
      409
    );
  }
  return WebPlatformRegistry.getService(definition.code);
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

router.patch('/:id/enabled', async (req, res) => {
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

router.get('/:id/web-session', async (req, res) => {
  try {
    const service = await getManagedWebService(req.params.id);
    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true,
      data: service.getAdminSessionSnapshot()
    });
  } catch (error) {
    return handleError(res, error, '网页登录状态读取');
  }
});

router.post('/:id/web-session/open', async (req, res) => {
  try {
    const service = await getManagedWebService(req.params.id);
    const status = await service.beginInteractiveLogin();
    return res.json({
      success: true,
      message: '专用 Chrome 已打开，请完成人工登录或账号切换',
      data: status
    });
  } catch (error) {
    return handleError(res, error, '网页登录窗口打开');
  }
});

router.post('/:id/web-session/verify', async (req, res) => {
  try {
    const service = await getManagedWebService(req.params.id);
    const status = await service.verifyInteractiveLogin();
    return res.json({
      success: true,
      message: status.login_state === 'ready'
        ? '网页登录状态已验证'
        : '网页登录状态仍需人工处理',
      data: status
    });
  } catch (error) {
    return handleError(res, error, '网页登录验证');
  }
});

router.get('/:id/api-key', async (req, res) => {
  try {
    const secret = await AIPlatformConfigService.revealApiKey(req.params.id);
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, data: secret });
  } catch (error) {
    return handleError(res, error, '密钥读取');
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

router.get('/:id/models', async (req, res) => {
  try {
    await AIPlatformConfigService.requireCapability(req.params.id, 'model_listing');
    const result = await AIPlatformRequestService.listModels(req.params.id);
    if (!result.success) {
      throw new PlatformConfigError(
        result.error || '模型列表读取失败',
        result.error_code || 'model_list_failed',
        400
      );
    }
    return res.json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, '模型列表读取');
  }
});

router.post('/:id/test', async (req, res) => {
  try {
    await AIPlatformConfigService.requireCapability(req.params.id, 'connection_test');
    const result = await AIPlatformRequestService.testConnection(req.params.id);
    return res.json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, '连接测试');
  }
});

router.post('/:id/test-web-search', async (req, res) => {
  try {
    await AIPlatformConfigService.requireCapability(req.params.id, 'api_web_search_test');
    const input = String(req.body?.input || '').trim();
    if (input.length > 1000) throw new PlatformConfigError('联网测试问题不能超过 1000 个字符');
    const result = await AIPlatformRequestService.testWebSearch(req.params.id, input);
    return res.json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, '联网能力测试');
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const platform = await AIPlatformConfigService.deletePlatform(req.params.id);
    return res.json({ success: true, message: 'AI 平台已删除', data: platform });
  } catch (error) {
    return handleError(res, error, '删除');
  }
});

module.exports = router;
