const express = require('express');
const router = express.Router();
const { Setting } = require('../models');
const { adminRequired } = require('../middleware/auth');
const AIRuntimeSettingsService = require('../services/AIRuntimeSettingsService');
const { AI_RUNTIME_SETTING_DEFINITIONS } = require('../services/AIRuntimeSettingsService');
const AIAnalysisConfigService = require('../services/AIAnalysisConfigService');
const { AIAnalysisConfigError } = require('../services/AIAnalysisConfigService');
const AIResponseAnalysisService = require('../services/AIResponseAnalysisService');
const { AIResponseAnalysisError } = require('../services/AIResponseAnalysisService');

// 允许的设置项及校验
const allowedKeys = {
  default_membership_level: (val) => ['free', 'pro', 'enterprise'].includes(String(val)),
  quota_low_threshold: (val) => {
    const num = Number(val);
    return !isNaN(num) && num >= 0 && num <= 1;
  },
  // 系统通知文本，允许空字符串，长度限制防止过长
  system_notice: (val) => {
    const s = String(val ?? '');
    return s.length <= 5000;
  },
  // SEO 设置
  seo_title: (val) => {
    const s = String(val ?? '');
    return s.length >= 0 && s.length <= 255;
  },
  seo_description: (val) => {
    const s = String(val ?? '');
    return s.length <= 1000; // 适度限制长度
  },
  seo_keywords: (val) => {
    const s = String(val ?? '');
    return s.length <= 1000;
  },
  seo_robots: (val) => ['index,follow','index,nofollow','noindex,follow','noindex,nofollow'].includes(String(val || 'index,follow')),
  ...Object.fromEntries(
    Object.keys(AI_RUNTIME_SETTING_DEFINITIONS).map((key) => [key, (val) => AIRuntimeSettingsService.isValid(key, val)])
  )
};

function analysisError(res, error, fallbackMessage) {
  const isKnown = error instanceof AIAnalysisConfigError || error instanceof AIResponseAnalysisError;
  return res.status(isKnown ? (error.status || 400) : 500).json({
    success: false,
    message: isKnown ? error.message : fallbackMessage,
    data: { error_code: isKnown ? error.code : 'analysis_api_error' }
  });
}

router.get('/analysis-api', adminRequired, async (_req, res) => {
  try {
    const config = await AIAnalysisConfigService.getPublicConfig();
    return res.json({ success: true, data: config });
  } catch (error) {
    return analysisError(res, error, '获取 AI 分析 API 配置失败');
  }
});

router.get('/analysis-api/prompt', adminRequired, async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  let platform = null;
  try {
    platform = await AIAnalysisConfigService.getAnalysisPlatform();
  } catch (error) {
    if (!(error instanceof AIAnalysisConfigError)) {
      return analysisError(res, error, '获取 AI 分析 API 请求参数失败');
    }
  }
  return res.json({
    success: true,
    data: AIResponseAnalysisService.getPromptDefinition(platform)
  });
});

router.put('/analysis-api', adminRequired, async (req, res) => {
  try {
    const config = await AIAnalysisConfigService.setConfig({
      platform_code: req.body?.platform_code,
      model_name: req.body?.model_name
    });
    return res.json({ success: true, message: 'AI 分析 API 已更新', data: config });
  } catch (error) {
    return analysisError(res, error, '更新 AI 分析 API 配置失败');
  }
});

router.post('/analysis-api/test', adminRequired, async (req, res) => {
  const questionText = String(req.body?.question_text || '').trim();
  const brandName = String(req.body?.brand_name || '').trim();
  const responseText = String(req.body?.response_text || '').trim();
  const brandAliases = (Array.isArray(req.body?.brand_aliases) ? req.body.brand_aliases : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 20);
  if (!brandName || brandName.length > 100) {
    return res.status(400).json({ success: false, message: '品牌名称不能为空且不能超过 100 个字符' });
  }
  if (!questionText) {
    return res.status(400).json({ success: false, message: '当前问题不能为空' });
  }
  if (!responseText) {
    return res.status(400).json({ success: false, message: '测试回答不能为空' });
  }
  try {
    const output = await AIResponseAnalysisService.analyze({
      question: questionText,
      responseText,
      brand: { name: brandName, aliases: brandAliases },
      competitorHints: [],
      includeRawOutput: true
    });
    return res.json({
      success: true,
      data: {
        input: {
          question_text: questionText,
          brand_name: brandName,
          brand_aliases: brandAliases,
          response_text: responseText
        },
        output
      }
    });
  } catch (error) {
    return analysisError(res, error, 'AI 分析 API 测试失败');
  }
});

// 获取所有设置（仅返回允许的键）
router.get('/', adminRequired, async (req, res) => {
  try {
    const rows = await Setting.findAll();
    const map = {};
    for (const row of rows) {
      const key = row.key;
      if (allowedKeys[key]) {
        map[key] = row.value;
      }
    }
    // 默认值兜底
    if (!('default_membership_level' in map)) map.default_membership_level = 'free';
    if (!('quota_low_threshold' in map)) map.quota_low_threshold = '0.2';
    if (!('system_notice' in map)) map.system_notice = '';
    if (!('seo_title' in map)) map.seo_title = '';
    if (!('seo_description' in map)) map.seo_description = '';
    if (!('seo_keywords' in map)) map.seo_keywords = '';
    if (!('seo_robots' in map)) map.seo_robots = 'index,follow';
    const runtimeSettings = await AIRuntimeSettingsService.getSettings();
    for (const [key, value] of Object.entries(runtimeSettings)) {
      if (!(key in map)) map[key] = String(value);
    }
    res.json({ success: true, data: map });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取设置失败' });
  }
});

// 更新设置（仅允许指定键）
router.put('/', adminRequired, async (req, res) => {
  try {
    const payload = req.body || {};
    const updates = {};
    for (const key of Object.keys(allowedKeys)) {
      if (key in payload) {
        const val = payload[key];
        if (!allowedKeys[key](val)) {
          return res.status(400).json({ success: false, message: `非法设置值: ${key}` });
        }
        updates[key] = String(val);
      }
    }
    const entries = Object.entries(updates);
    for (const [key, value] of entries) {
      const existing = await Setting.findOne({ where: { key } });
      if (existing) await existing.update({ value });
      else await Setting.create({ key, value });
    }
    res.json({ success: true, message: '设置已更新' });
  } catch (error) {
    res.status(500).json({ success: false, message: '更新设置失败' });
  }
});

// 公共SEO设置（无需鉴权）
router.get('/seo', async (req, res) => {
  try {
    const keys = ['seo_title','seo_description','seo_keywords','seo_robots'];
    const rows = await Setting.findAll({ where: { key: keys } });
    const map = {};
    for (const row of rows) {
      map[row.key] = row.value;
    }
    if (!('seo_title' in map)) map.seo_title = '';
    if (!('seo_description' in map)) map.seo_description = '';
    if (!('seo_keywords' in map)) map.seo_keywords = '';
    if (!('seo_robots' in map)) map.seo_robots = 'index,follow';
    res.json({ success: true, data: map });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取SEO设置失败' });
  }
});

// 普通用户获取系统通知（仅返回通知文本与更新时间）
router.get('/notice', async (req, res) => {
  try {
    const row = await Setting.findOne({ where: { key: 'system_notice' } });
    res.json({
      success: true,
      data: {
        notice: row?.value || '',
        updated_at: row?.updated_at || null
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取系统通知失败' });
  }
});

module.exports = router;
