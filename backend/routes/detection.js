const express = require('express');
const router = express.Router();
const {
  QuestionRecord,
  ResultDetail,
  User,
  sequelize,
  VisibilityMetric
} = require('../models');
const { bulkConsumeQuota } = require('../middleware/quota');
const { authRequired, adminRequired } = require('../middleware/auth');
const { Op } = require('sequelize');
const AIPlatformService = require('../services/AIPlatformService');
const ResultParserService = require('../services/ResultParserService');
const ProjectRunService = require('../services/ProjectRunService');
const ProjectRecordFinalizationService = require('../services/ProjectRecordFinalizationService');
const ScheduleProjectContextService = require('../services/ScheduleProjectContextService');
const AIRuntimeSettingsService = require('../services/AIRuntimeSettingsService');
const { ERROR_MESSAGES: AI_PLATFORM_ERROR_MESSAGES } = require('../services/AIPlatformRequestService');

const SAFE_PLATFORM_FAILURE_MESSAGE = '监测平台调用失败，请稍后重试';

function runtimePlatformFailureMessage(result) {
  return AI_PLATFORM_ERROR_MESSAGES[result?.error_code] || SAFE_PLATFORM_FAILURE_MESSAGE;
}

function platformUnavailableMessage(status) {
  const name = status?.platform_name || status?.code || '监测平台';
  const messages = {
    missing_api_key: `${name}未配置 API Key`,
    disabled: `${name}已被管理员停用`,
    missing_base_url: `${name}未配置接口地址`,
    missing_model: `${name}未配置默认模型`,
    archived: `${name}已归档`,
    config_unavailable: `${name}配置暂不可用`
  };
  return messages[status?.reason] || `${name}暂不可用`;
}

// 获取所有已使用的品牌列表（用于筛选）
router.get('/brands', authRequired, async (req, res) => {
  try {
    const where = {
      brand: { [Op.ne]: null }
    };

    // 非管理员只能看自己的品牌
    if (req.user && req.user.role !== 'admin') {
      where.user_id = req.user.id;
    }

    const brands = await QuestionRecord.findAll({
      attributes: [[sequelize.fn('DISTINCT', sequelize.col('brand')), 'brand']],
      where,
      order: [['brand', 'ASC']]
    });

    const list = brands.map(b => b.brand).filter(b => b && String(b).trim() !== '');
    res.json({ success: true, data: list });
  } catch (error) {
    console.error('获取品牌列表失败:', error);
    res.status(500).json({ success: false, message: '获取品牌列表失败' });
  }
});

async function resolveProjectContext(req, source) {
  return ScheduleProjectContextService.resolveProjectContext({
    user: req.user,
    source,
    messages: {
      promptRequiresProject: '使用问题检测时必须提供 project_id',
      archivedProject: '归档项目不能运行检测',
      disabledPrompt: '停用问题不能运行检测'
    }
  });
}

async function saveCompletedDetectionResult({
  user_id,
  platform,
  question,
  brand,
  brandKeywordsStr,
  projectContext,
  responseText,
  aiResponse = null,
  platformName = null,
  modelName = null
}) {
  const record = await QuestionRecord.create({
    user_id: projectContext?.user_id || user_id,
    project_id: projectContext?.project_id || null,
    tracked_prompt_id: projectContext?.tracked_prompt_id || null,
    platform,
    platform_name: platformName || platform,
    model_name: modelName,
    question,
    brand: brand ? String(brand).trim() : null,
    brand_keywords: brandKeywordsStr || ''
  });
  const leaseMs = ProjectRunService.getRecordExecutionLeaseMs({
    retryMode: 'analysis_only'
  });
  const lease = await ProjectRunService.claimRecordExecution(record.id, { leaseMs });
  if (!lease.claimed) throw new Error('record_lease_claim_rejected');
  const heartbeat = ProjectRunService.startRecordLeaseHeartbeat({
    recordId: record.id,
    executionToken: lease.executionToken,
    leaseMs: lease.leaseMs
  });
  try {
    const keywordsArr = typeof brandKeywordsStr === 'string'
      ? brandKeywordsStr.split(/[,，]/).map(s => s.trim()).filter(Boolean)
      : [];
    await ProjectRecordFinalizationService.finalize({
      record,
      executionToken: lease.executionToken,
      persistResponseDetail: true,
      responseText,
      aiResponse,
      providerCitations: ProjectRunService.snapshotProviderCitations(aiResponse),
      keywords: keywordsArr
    });
  } finally {
    await heartbeat.stop();
    await ProjectRunService.releaseRecordExecution(record.id, lease.executionToken);
  }
  return record;
}

// 创建检测任务
router.post('/create', authRequired, async (req, res) => {
  try {
    let { user_id, platforms, question, brand, brand_keywords, highlightKeywords, highlight_keywords } = req.body;

    // 仅要求问题必填；其他参数提供默认值以简化调用
    if (!question || (typeof question === 'string' && question.trim() === '')) {
      return res.status(400).json({
        success: false,
        message: '问题不能为空'
      });
    }

    const projectContext = await resolveProjectContext(req, req.body);
    if (projectContext.error) {
      return res.status(projectContext.error.status).json({
        success: false,
        message: projectContext.error.message
      });
    }
    user_id = projectContext.user_id;

    // 规范化与校验平台列表，随后按数据库配置区分可运行和跳过平台
    // 兼容 string / array，并统一为小写、去重
    let hasExplicitSelection = Array.isArray(platforms) || typeof platforms === 'string';
    if (typeof platforms === 'string') {
      platforms = platforms.split(',').map(s => String(s).trim().toLowerCase()).filter(Boolean);
    }
    // 仅当数组非空或字符串非空时视为显式选择
    hasExplicitSelection = (Array.isArray(platforms) && platforms.length > 0);
    if (hasExplicitSelection) {
      const platformResult = ScheduleProjectContextService.validatePlatformsWithinContext(
        platforms,
        projectContext,
        '检测平台必须包含在项目或问题的监测平台内'
      );
      if (!platformResult.ok) {
        return res.status(400).json({
          success: false,
          message: platformResult.message || '检测平台不在当前可运行范围内'
        });
      }
      platforms = platformResult.platforms;
    }

    // 若未显式选择平台，使用数据库平台目录并套用项目/问题范围
    if (!hasExplicitSelection) {
      const platformCodes = await AIPlatformService.getPlatformCodes();
      if (!platformCodes.length) {
        return res.status(400).json({
          success: false,
          message: '监测平台配置暂不可用，请联系管理员。',
          data: { error_code: 'all_platforms_unavailable', skipped_platforms: [] }
        });
      }
      platforms = ScheduleProjectContextService.defaultPlatformsForContext(
        platformCodes,
        projectContext
      );
      if (platforms.length === 0) {
        return res.status(400).json({
          success: false,
          message: projectContext.project_id ? '当前项目或问题没有可用的监测平台' : '当前没有可用的监测平台，请联系管理员处理'
        });
      }
    }

    const availability = await AIPlatformService.getPlatformAvailability(platforms);
    const runnablePlatforms = availability.filter((item) => item.available);
    const skippedPlatforms = availability
      .filter((item) => !item.available)
      .map((item) => ({
        platform: item.code,
        name: item.platform_name,
        reason: item.reason,
        message: platformUnavailableMessage(item)
      }));
    if (!runnablePlatforms.length) {
      const detail = skippedPlatforms.map((item) => item.message).join('；') || '监测平台配置暂不可用';
      return res.status(400).json({
        success: false,
        message: `${detail}，无法运行。`,
        data: { error_code: 'all_platforms_unavailable', skipped_platforms: skippedPlatforms }
      });
    }
    platforms = runnablePlatforms.map((item) => item.code);
    const runtimeSettings = await AIRuntimeSettingsService.getSettings();

    // 归一化关键词（可从 brand_keywords 或 highlightKeywords 接收）
    let brandKeywordsStr = '';
    if (Array.isArray(brand_keywords)) {
      brandKeywordsStr = brand_keywords.map(s => String(s || '').trim()).filter(Boolean).join(',');
    } else if (typeof brand_keywords === 'string') {
      brandKeywordsStr = brand_keywords;
    } else if (Array.isArray(highlightKeywords)) {
      brandKeywordsStr = highlightKeywords.map(s => String(s || '').trim()).filter(Boolean).join(',');
    } else if (Array.isArray(highlight_keywords)) {
      brandKeywordsStr = highlight_keywords.map(s => String(s || '').trim()).filter(Boolean).join(',');
    }

    // 按平台数量进行配额扣减（一次请求可能创建多个任务）
    const ok = await bulkConsumeQuota(req, res, 'detection', Array.isArray(platforms) ? platforms.length : 0, { userId: user_id });
    if (!ok) return; // bulkConsumeQuota 已写入响应

    const results = [];

    for (const platformStatus of runnablePlatforms) {
      const platform = platformStatus.code;
      // 创建问题记录
      const questionRecord = await QuestionRecord.create({
        user_id,
        project_id: projectContext.project_id,
        tracked_prompt_id: projectContext.tracked_prompt_id,
        platform,
        platform_name: platformStatus.platform_name,
        model_name: platformStatus.model_name,
        question,
        brand: brand ? String(brand).trim() : null,
        // 保存本次任务的关键词（用于前端历史高亮与计数）
        brand_keywords: brandKeywordsStr || ''
      });

      // 异步处理AI查询
      processAIQuery(questionRecord.id, platform, question, platformStatus.config, runtimeSettings);

      results.push({
        record_id: questionRecord.id,
        platform,
        status: 'pending'
      });
    }

    res.json({
      success: true,
      message: skippedPlatforms.length
        ? `已加入 ${results.length} 个运行任务；${skippedPlatforms.map((item) => item.message).join('；')}，已跳过。`
        : '检测任务创建成功',
      data: {
        task_count: results.length,
        skipped_platforms: skippedPlatforms,
        results
      }
    });

  } catch (error) {
    console.error('创建检测任务失败:', error);
    res.status(500).json({
      success: false,
      message: '创建检测任务失败'
    });
  }
});

// 异步处理AI查询
async function processAIQuery(recordId, platform, question, platformConfig, runtimeSettings) {
  let rec = null;
  let executionToken = null;
  let leaseHeartbeat = null;
  try {
    rec = await QuestionRecord.findByPk(recordId);
    if (!rec) return;
    const leaseMs = ProjectRunService.getRecordExecutionLeaseMs({
      target: { platformConfig },
      runtimeSettings
    });
    const lease = await ProjectRunService.claimRecordExecution(recordId, { leaseMs });
    if (!lease.claimed) {
      console.warn('检测任务领取执行租约失败:', {
        record_id: recordId,
        error_code: 'record_lease_claim_rejected'
      });
      return;
    }
    executionToken = lease.executionToken;
    leaseHeartbeat = ProjectRunService.startRecordLeaseHeartbeat({
      recordId,
      executionToken,
      leaseMs: lease.leaseMs
    });

    // 调用AI平台API
    const aiResult = await AIPlatformService.queryPlatform(platform, question, {
      config: platformConfig,
      runtimeSettings
    });

    if (!aiResult.success) {
      const failureMessage = runtimePlatformFailureMessage(aiResult);
      await ProjectRunService.failRecord(
        rec,
        failureMessage,
        {
          stage: 'monitoring_request',
          error_code: aiResult.error_code || 'provider_error'
        },
        { executionToken }
      );
      return;
    }

    // 仅保存原始回答文本
    const originalText = ResultParserService.extractResponseText(aiResult.data);
    if (!String(originalText || '').trim()) {
      await ProjectRunService.failRecord(
        rec,
        '监测平台返回内容为空',
        {
          stage: 'monitoring_response',
          error_code: 'empty_provider_response'
        },
        { executionToken }
      );
      return;
    }

    // 读取记录中的关键词，并在一个事务中提交回答、指标和终态
    const brandKeywordsArr = typeof rec?.brand_keywords === 'string'
      ? rec.brand_keywords.split(/[,，]/).map(s => s.trim()).filter(Boolean)
      : Array.isArray(rec?.brand_keywords) ? rec.brand_keywords : [];
    await ProjectRecordFinalizationService.finalize({
      record: rec,
      executionToken,
      persistResponseDetail: true,
      responseText: originalText,
      aiResponse: aiResult.data,
      providerCitations: ProjectRunService.snapshotProviderCitations(aiResult.data),
      keywords: brandKeywordsArr
    });

  } catch (error) {
    console.error(`处理AI查询失败 (recordId: ${recordId}):`, error);
    if (rec) {
      await ProjectRunService.failRecord(
        rec,
        SAFE_PLATFORM_FAILURE_MESSAGE,
        { stage: 'worker_exception', error_code: 'detection_worker_failed' },
        { executionToken }
      );
    }
  } finally {
    if (leaseHeartbeat) await leaseHeartbeat.stop();
    if (executionToken) {
      await ProjectRunService.releaseRecordExecution(recordId, executionToken);
    }
  }
}

// 获取检测任务状态
router.get('/status/:recordId', authRequired, async (req, res) => {
  try {
    const { recordId } = req.params;

    const record = await QuestionRecord.findOne({
      where: { id: recordId },
      include: [{
        model: ResultDetail,
        as: 'resultDetail'
      }]
    });

    if (!record) {
      return res.status(404).json({
        success: false,
        message: '检测任务不存在'
      });
    }

    // 所有权验证：用户只能查看自己的记录，管理员可以查看所有
    if (req.user.role !== 'admin' && record.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: '无权访问该检测记录'
      });
    }

    res.json({
      success: true,
      data: {
        record_id: record.id,
        platform: record.platform,
        platform_name: record.platform_name,
        model_name: record.model_name,
        question: record.question,
        brand_keywords: record.brand_keywords,
        status: record.status,
        detection_time: record.detection_time,
        result_summary: record.result_summary,
        result_detail: record.resultDetail,
        error_message: record.error_message
      }
    });

  } catch (error) {
    console.error('获取任务状态失败:', error);
    res.status(500).json({
      success: false,
      message: '获取任务状态失败'
    });
  }
});

// 获取所有用户的检测历史（管理员）
router.get('/history', adminRequired, async (req, res) => {
  try {
    const { page = 1, limit = 10, user_id, platform, status, q, brand } = req.query;
    const whereClause = {};
    if (user_id) whereClause.user_id = user_id;
    if (platform) whereClause.platform = platform;
    if (status) whereClause.status = status;
    if (brand && String(brand).trim() !== '') {
      whereClause.brand = { [Op.like]: `%${brand.trim()}%` };
    }
    if (q && String(q).trim() !== '') {
      whereClause.question = { [Op.like]: `%${q}%` };
    }
    const offset = (page - 1) * limit;
    const { count, rows } = await QuestionRecord.findAndCountAll({
      where: whereClause,
      include: [
        { model: ResultDetail, as: 'resultDetail', attributes: ['ai_response_original', 'parsing_status', 'parsing_error', 'created_at'] },
        { model: User, as: 'user', attributes: ['id', 'username', 'email'] }
      ],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    res.json({
      success: true,
      data: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        total_pages: Math.ceil(count / limit),
        records: rows
      }
    });
  } catch (error) {
    console.error('获取管理员历史失败:', error);
    res.status(500).json({ success: false, message: '获取管理员历史失败' });
  }
});

// 获取用户的检测历史
router.get('/history/:userId', authRequired, async (req, res) => {
  try {
    const { userId } = req.params;
    // 权限验证：管理员或本人可访问
    if (req.user.role !== 'admin' && req.user.id !== parseInt(userId)) {
      return res.status(403).json({ success: false, message: '无权访问' });
    }
    const { page = 1, limit = 10, platform, status, q, brand } = req.query;

    const whereClause = { user_id: userId };
    if (platform) whereClause.platform = platform;
    if (status) whereClause.status = status;
    if (brand && String(brand).trim() !== '') {
      whereClause.brand = { [Op.like]: `%${brand.trim()}%` };
    }
    if (q && String(q).trim() !== '') {
      whereClause.question = { [Op.like]: `%${q}%` };
    }

    const offset = (page - 1) * limit;

    const { count, rows } = await QuestionRecord.findAndCountAll({
      where: whereClause,
      include: [{
        model: ResultDetail,
        as: 'resultDetail',
        attributes: ['ai_response_original', 'parsing_status', 'parsing_error', 'created_at']
      }],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      success: true,
      data: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        total_pages: Math.ceil(count / limit),
        records: rows
      }
    });

  } catch (error) {
    console.error('获取检测历史失败:', error);
    res.status(500).json({
      success: false,
      message: '获取检测历史失败'
    });
  }
});



// 删除单条历史记录
router.delete('/record/:id', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const rec = await QuestionRecord.findByPk(id);
    if (!rec) {
      return res.status(404).json({ success: false, message: '记录不存在' });
    }
    // 权限验证：管理员或记录所有者可删除
    if (req.user.role !== 'admin' && rec.user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: '无权删除' });
    }
    await VisibilityMetric.destroy({ where: { question_record_id: id } });
    await ResultDetail.destroy({ where: { question_record_id: id } });
    await QuestionRecord.destroy({ where: { id } });
    res.json({ success: true, message: '记录已删除' });
  } catch (error) {
    console.error('删除记录失败:', error);
    res.status(500).json({ success: false, message: '删除记录失败' });
  }
});

// 批量删除历史记录（可按用户与过滤条件）
router.delete('/history/:userId', authRequired, async (req, res) => {
  try {
    const { userId } = req.params;
    // 权限验证：管理员或本人可删除
    if (req.user.role !== 'admin' && req.user.id !== parseInt(userId)) {
      return res.status(403).json({ success: false, message: '无权删除' });
    }
    const { platform, status, q, brand } = req.query;
    const whereClause = { user_id: userId };
    if (platform) whereClause.platform = platform;
    if (status) whereClause.status = status;
    if (brand && String(brand).trim() !== '') {
      whereClause.brand = { [Op.like]: `%${brand.trim()}%` };
    }
    if (q && String(q).trim() !== '') {
      whereClause.question = { [Op.like]: `%${q}%` };
    }
    // 找出匹配的记录ID
    const rows = await QuestionRecord.findAll({ where: whereClause, attributes: ['id'] });
    const ids = rows.map(r => r.id);
    if (ids.length === 0) {
      return res.json({ success: true, message: '无匹配记录', data: { deleted: 0 } });
    }
    await VisibilityMetric.destroy({ where: { question_record_id: { [Op.in]: ids } } });
    await ResultDetail.destroy({ where: { question_record_id: { [Op.in]: ids } } });
    const del = await QuestionRecord.destroy({ where: { id: { [Op.in]: ids } } });
    res.json({ success: true, message: '批量删除完成', data: { deleted: del } });
  } catch (error) {
    console.error('批量删除失败:', error);
    res.status(500).json({ success: false, message: '批量删除失败' });
  }
});

// 流式获取AI原文（SSE方式）
router.get('/stream', authRequired, async (req, res) => {
  try {
    const { platform, question, brand } = req.query;
    const user_id = req.user.id; // 已通过 authRequired 验证
    let brandKeywordsStr = '';
    const qBrand = req.query.brand_keywords;
    const qHighlight = req.query.highlightKeywords || req.query.highlight_keywords;
    if (Array.isArray(qBrand)) {
      brandKeywordsStr = qBrand.map(s => String(s || '').trim()).filter(Boolean).join(',');
    } else if (typeof qBrand === 'string') {
      brandKeywordsStr = qBrand;
    } else if (Array.isArray(qHighlight)) {
      brandKeywordsStr = qHighlight.map(s => String(s || '').trim()).filter(Boolean).join(',');
    } else if (typeof qHighlight === 'string') {
      brandKeywordsStr = qHighlight;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    if (!question || (typeof question === 'string' && question.trim() === '')) {
      res.write(`data: ${JSON.stringify({ event: 'error', message: '问题不能为空' })}\n\n`);
      return res.end();
    }

    const projectContext = await resolveProjectContext(req, req.query);
    if (projectContext.error) {
      res.write(`data: ${JSON.stringify({ event: 'error', message: projectContext.error.message })}\n\n`);
      return res.end();
    }

    const requestedPlatform = String(platform || '').trim().toLowerCase();
    let platformStatus = null;
    if (requestedPlatform) {
      [platformStatus] = await AIPlatformService.getPlatformAvailability([requestedPlatform]);
    } else {
      const candidateCodes = projectContext.project_id
        ? projectContext.allowed_platforms
        : await AIPlatformService.getPlatformCodes();
      const candidateStatuses = await AIPlatformService.getPlatformAvailability(candidateCodes);
      platformStatus = candidateStatuses.find((item) => item.available) || candidateStatuses[0] || null;
    }
    const platformCode = platformStatus?.code || '';
    if (!platformCode) {
      res.write(`data: ${JSON.stringify({
        event: 'error',
        message: '当前没有可用的监测平台，请联系管理员处理',
        error_code: 'all_platforms_unavailable'
      })}\n\n`);
      return res.end();
    }
    const scopeResult = ScheduleProjectContextService.validatePlatformsWithinContext(
      [platformCode],
      projectContext,
      '检测平台必须包含在项目或问题的监测平台内'
    );
    if (!scopeResult.ok) {
      res.write(`data: ${JSON.stringify({ event: 'error', message: scopeResult.message })}\n\n`);
      return res.end();
    }

    if (!platformStatus?.available) {
      res.write(`data: ${JSON.stringify({
        event: 'error',
        message: `${platformUnavailableMessage(platformStatus)}，无法运行。`,
        error_code: 'all_platforms_unavailable'
      })}\n\n`);
      return res.end();
    }

    const ok = await bulkConsumeQuota(req, res, 'detection', 1, { sse: true, userId: projectContext.user_id });
    if (!ok) return;

    const result = await AIPlatformService.queryPlatform(platformCode, String(question), {
      config: platformStatus.config
    });
    if (!result.success) {
      res.write(`data: ${JSON.stringify({
        event: 'error',
        message: runtimePlatformFailureMessage(result),
        error_code: result.error_code || 'provider_error'
      })}\n\n`);
      return res.end();
    }

    const fullText = result.text || ResultParserService.extractResponseText(result.data);
    if (!String(fullText || '').trim()) {
      res.write(`data: ${JSON.stringify({ event: 'error', message: '监测平台返回内容为空' })}\n\n`);
      return res.end();
    }

    const normalizedText = String(fullText).replace(/\r\n/g, '\n');
    let chunks = normalizedText
      .split(/\n\n+/)
      .flatMap((paragraph) => paragraph.split(/(?<=[。！？!?])/))
      .map((piece) => piece.trim())
      .filter(Boolean);
    if (chunks.length < 6) {
      chunks = [];
      for (let index = 0; index < normalizedText.length; index += 60) {
        const piece = normalizedText.slice(index, index + 60).trim();
        if (piece) chunks.push(piece);
      }
    }
    for (const piece of chunks) {
      res.write(`data: ${JSON.stringify({ event: 'delta', content: piece })}\n\n`);
      if (typeof res.flush === 'function') {
        try { res.flush(); } catch (_) { }
      }
      await new Promise((resolve) => setTimeout(resolve, 45));
    }

    await saveCompletedDetectionResult({
      user_id,
      platform: platformCode,
      platformName: platformStatus.platform_name,
      modelName: platformStatus.model_name,
      question,
      brand,
      brandKeywordsStr,
      projectContext,
      responseText: fullText,
      aiResponse: result.data
    });
    res.write(`data: ${JSON.stringify({ event: 'done' })}\n\n`);
    res.end();

  } catch (error) {
    console.error('SSE流式接口异常:', error);
    try {
      res.write(`data: ${JSON.stringify({ event: 'error', message: SAFE_PLATFORM_FAILURE_MESSAGE })}\n\n`);
    } catch (_) { }
    res.end();
  }
});

module.exports = router;
