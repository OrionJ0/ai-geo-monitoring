const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const {
  sequelize,
  BrandProject,
  BrandCompetitor,
  DetectionSchedule,
  PromptGroup,
  TrackedPrompt,
  QuestionRecord,
  ResultDetail,
  VisibilityMetric,
  AlertRule,
  ReportSnapshot,
} = require('../models');
const ProjectMetricsService = require('../services/ProjectMetricsService');
const AIPlatformService = require('../services/AIPlatformService');
const ResultParserService = require('../services/ResultParserService');
const PromptSuggestionService = require('../services/PromptSuggestionService');
const ProjectRunService = require('../services/ProjectRunService');
const SourceAnalysisService = require('../services/SourceAnalysisService');
const OpportunityInsightService = require('../services/OpportunityInsightService');
const SchedulerService = require('../services/SchedulerService');
const TrackedPromptService = require('../services/TrackedPromptService');
const BrandCompetitorService = require('../services/BrandCompetitorService');
const BrandProjectService = require('../services/BrandProjectService');
const AlertEvaluationService = require('../services/AlertEvaluationService');
const ReportSnapshotService = require('../services/ReportSnapshotService');
const PlatformSelectionService = require('../services/PlatformSelectionService');
const PromptAnalysisCleanupService = require('../services/PromptAnalysisCleanupService');
const ProjectArchiveService = require('../services/ProjectArchiveService');
const ProjectDeletionService = require('../services/ProjectDeletionService');
const WebCaptureDeletionService = require('../services/WebCaptureDeletionService');
const ProjectLifecycleService = require('../services/ProjectLifecycleService');
const ProjectFieldNormalizationService = require('../services/ProjectFieldNormalizationService');
const QuestionSetRunService = require('../services/QuestionSetRunService');
const CitationMetricSemanticsService = require('../services/CitationMetricSemanticsService');
const { CURRENT_METRIC_SEMANTICS } = require('../services/GeoMetricSemanticsService');
const AIRuntimeSettingsService = require('../services/AIRuntimeSettingsService');
const { CsvValidationError } = require('../services/QuestionSetRunCsvService');

function cleanupAwareError(res, error, fallbackMessage) {
  if (error?.code === 'web_capture_cleanup_incomplete') {
    return res.status(500).json({
      success: false,
      message: error.message,
      error_code: error.code,
      error: { code: error.code }
    });
  }
  return res.status(500).json({ success: false, message: fallbackMessage });
}

function asArray(value) {
  return ProjectFieldNormalizationService.normalizeList(value);
}

function cleanPlatforms(value) {
  return PlatformSelectionService.normalize(value);
}

async function getSelectablePlatformCodes() {
  return AIPlatformService.getAvailablePlatforms();
}

function cleanMonitoringPayload(body, existing = {}, normalizedPlatforms = null) {
  const hasEnabled = body.monitoring_enabled !== undefined;
  const hasTime = body.monitoring_time !== undefined;
  if (!hasEnabled && !hasTime) return {};
  const normalized = SchedulerService.normalizeProjectMonitoring({
    monitoring_enabled: hasEnabled ? body.monitoring_enabled : existing.monitoring_enabled,
    monitoring_time: hasTime ? body.monitoring_time : existing.monitoring_time,
    platforms: body.platforms !== undefined ? (normalizedPlatforms || cleanPlatforms(body.platforms)) : existing.platforms
  });
  return {
    monitoring_enabled: normalized.monitoring_enabled,
    monitoring_time: normalized.monitoring_time,
    monitoring_next_run_at: normalized.monitoring_enabled ? SchedulerService.nextProjectRunAt(normalized.monitoring_time) : null
  };
}

function platformValidationError(res, result) {
  return res.status(400).json({
    success: false,
    message: result.message,
    data: { invalid_platforms: result.invalid_platforms }
  });
}

function unavailablePlatformMessage(item) {
  const name = item?.platform_name || item?.code || '监测平台';
  const labels = {
    missing_api_key: `${name}未配置 API Key`,
    disabled: `${name}已被管理员停用`,
    missing_base_url: `${name}未配置接口地址`,
    missing_model: `${name}未配置默认模型`,
    archived: `${name}已归档`,
    config_unavailable: `${name}配置暂不可用`
  };
  return labels[item?.reason] || `${name}暂不可用`;
}

function alertValidationError(res, error) {
  if (error?.code !== 'INVALID_ALERT_RULE_TYPE') return null;
  return res.status(400).json({
    success: false,
    message: error.message
  });
}

function rejectInvalidWebsiteInput(req, res) {
  if (req.body?.website === undefined) return null;
  const raw = String(req.body.website || '').trim();
  if (!raw) return null;
  if (ProjectFieldNormalizationService.normalizeWebsite(raw)) return null;
  return res.status(400).json({ success: false, message: '官网格式不正确，请输入有效域名' });
}

function projectScopedUser(req) {
  const project = req.brandProject?.toJSON ? req.brandProject.toJSON() : req.brandProject;
  const projectOwnerId = Number(project?.user_id || 0);
  const userId = Number(req.user?.id || 0);
  if (projectOwnerId > 0 && req.user?.role === 'admin' && userId !== projectOwnerId) {
    return { ...req.user, id: projectOwnerId, actor_user_id: userId || null };
  }
  return req.user;
}

function rejectArchivedProjectMutation(req, res, message) {
  const guard = ProjectLifecycleService.validateActiveProject(req.brandProject, message);
  if (guard.ok) return null;
  return res.status(guard.status).json({ success: false, message: guard.message });
}

function readRequiredIdempotencyKey(req) {
  const headerKey = String(
    req.get?.('Idempotency-Key')
    || req.headers?.['idempotency-key']
    || ''
  ).trim();
  const bodyKey = String(req.body?.idempotency_key || '').trim();
  if (
    (!headerKey && !bodyKey)
    || (headerKey && bodyKey && headerKey !== bodyKey)
  ) {
    return { ok: false };
  }
  return { ok: true, value: headerKey || bodyKey };
}

function canAccess(req, row) {
  return req.user.role === 'admin' || row.user_id === req.user.id;
}

async function normalizePromptGroupId(projectId, promptGroupId) {
  if (promptGroupId === undefined || promptGroupId === null || promptGroupId === '') return { value: null };
  const id = Number(promptGroupId);
  if (!Number.isInteger(id) || id <= 0) return { error: '问题集 ID 无效' };
  const group = await PromptGroup.findOne({ where: { id, project_id: projectId } });
  if (!group) return { error: '问题集不存在或不属于该品牌项目' };
  return { value: id };
}

function serializeQuestionSet(group) {
  const row = group?.toJSON ? group.toJSON() : group;
  const questions = (Array.isArray(row?.trackedPrompts) ? row.trackedPrompts : [])
    .map((question) => (question?.toJSON ? question.toJSON() : question))
    .sort((left, right) => Number(left.id || 0) - Number(right.id || 0));
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    description: row.description || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    question_count: questions.length,
    enabled_question_count: questions.filter((question) => question.enabled !== false).length,
    questions
  };
}

async function loadQuestionSet(projectId, questionSetId, transaction) {
  return PromptGroup.findOne({
    where: { id: questionSetId, project_id: projectId },
    include: [{ model: TrackedPrompt, as: 'trackedPrompts' }],
    transaction
  });
}

async function resolveQuestionSetQuestions(projectId, value, transaction) {
  if (value === undefined || value === null || value === '') return { ids: [], questions: [] };
  const rawIds = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(/[,，;；\n]/) : [value]);
  const normalizedIds = rawIds.map((item) => Number(String(item || '').trim()));
  if (normalizedIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    return { error: '问题 ID 无效' };
  }
  const ids = Array.from(new Set(normalizedIds));
  if (!ids.length) return { ids: [], questions: [] };
  const questions = await TrackedPrompt.findAll({
    where: { project_id: projectId, id: { [Op.in]: ids } },
    order: [['id', 'ASC']],
    transaction
  });
  if (questions.length !== ids.length) {
    return { error: '选择的问题不存在或不属于该品牌项目' };
  }
  return { ids, questions };
}

async function loadProject(req, res, next) {
  try {
    const project = await BrandProject.findByPk(req.params.projectId || req.params.id);
    if (!project) return res.status(404).json({ success: false, message: '品牌项目不存在' });
    if (!canAccess(req, project)) return res.status(403).json({ success: false, message: '无权访问该品牌项目' });
    req.brandProject = project;
    return next();
  } catch (error) {
    return res.status(500).json({ success: false, message: '读取品牌项目失败' });
  }
}

async function batchDeletePrompts(req, res) {
  try {
    const archivedResponse = rejectArchivedProjectMutation(req, res, '归档项目不能修改问题');
    if (archivedResponse) return archivedResponse;
    const ids = asArray(req.body.prompt_ids || req.body.ids)
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item > 0);
    const uniqueIds = Array.from(new Set(ids));
    if (!uniqueIds.length) {
      return res.status(400).json({ success: false, message: '请选择需要删除的问题' });
    }
    const matchedRows = await TrackedPrompt.findAll({
      where: {
        id: { [Op.in]: uniqueIds },
        project_id: req.brandProject.id
      },
      attributes: ['id'],
      raw: true
    });
    const matchedIds = matchedRows.map((item) => item.id);
    if (matchedIds.length) {
      await deletePromptAnalysisData(req.brandProject.id, matchedIds);
      await TrackedPrompt.destroy({
        where: {
          id: { [Op.in]: matchedIds },
          project_id: req.brandProject.id
        }
      });
    }
    return res.json({
      success: true,
      message: `已删除 ${matchedIds.length} 个问题`,
      data: { deleted: matchedIds.length, requested: uniqueIds.length }
    });
  } catch (error) {
    return cleanupAwareError(res, error, '批量删除问题失败');
  }
}

async function deletePromptAnalysisData(projectId, promptIds) {
  return PromptAnalysisCleanupService.deleteForPrompts(projectId, promptIds, {
    DetectionSchedule,
    QuestionRecord,
    VisibilityMetric,
    ResultDetail,
    ReportSnapshot,
    WebCaptureDeletionService
  });
}

async function deleteProjectAnalysisData(projectId) {
  return PromptAnalysisCleanupService.deleteForProject(projectId, {
    QuestionRecord,
    VisibilityMetric,
    ResultDetail,
    ReportSnapshot,
    WebCaptureDeletionService
  });
}

async function invalidateGeneratedReports(projectId) {
  return ReportSnapshot.destroy({
    where: {
      project_id: projectId,
      status: 'generated'
    }
  });
}

router.get('/', async (req, res) => {
  try {
    const where = req.user.role === 'admin' ? {} : { user_id: req.user.id };
    if (req.query.status) where.status = req.query.status;
    const rows = await BrandProject.findAll({
      where,
      include: [
        { model: BrandCompetitor, as: 'competitors' },
        { model: TrackedPrompt, as: 'trackedPrompts' }
      ],
      order: [['updated_at', 'DESC']]
    });
    const latestExecutions = await SchedulerService.getLatestProjectMonitoringExecutions(
      rows.map((row) => row.id)
    );
    const data = rows.map((row) => {
      const item = row.toJSON();
      return {
        ...item,
        latest_monitoring_execution: latestExecutions[item.id] || null
      };
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取品牌项目失败' });
  }
});

router.post('/', async (req, res) => {
  try {
    const invalidWebsiteResponse = rejectInvalidWebsiteInput(req, res);
    if (invalidWebsiteResponse) return invalidWebsiteResponse;
    const projectFields = ProjectFieldNormalizationService.normalizeProjectPayload({
      name: req.body.name,
      aliases: req.body.aliases,
      website: req.body.website,
      industry: req.body.industry,
      primary_keywords: req.body.primary_keywords
    });
    if (!projectFields.name) return res.status(400).json({ success: false, message: '品牌名称不能为空' });
    const {
      selectablePlatforms,
      defaultPlatforms
    } = await AIPlatformService.getNewProjectPlatformOptions();
    const platformResult = PlatformSelectionService.validate(req.body.platforms, {
      availablePlatforms: selectablePlatforms,
      defaultPlatforms
    });
    if (!platformResult.platforms.length && platformResult.ok) {
      return res.status(400).json({ success: false, message: '当前没有可选择的监测平台，请联系管理员配置。' });
    }
    if (!platformResult.ok) return platformValidationError(res, platformResult);
    const duplicate = await BrandProjectService.findDuplicateProject(req.user.id, {
      name: projectFields.name,
      aliases: projectFields.aliases || []
    });
    if (duplicate) {
      return res.status(409).json({ success: false, message: '已存在相同品牌项目', data: { duplicate_id: duplicate.id } });
    }
    const websiteDuplicate = await BrandProjectService.findDuplicateProjectWebsite(req.user.id, {
      website: projectFields.website
    });
    if (websiteDuplicate) {
      return res.status(409).json({ success: false, message: '已存在相同品牌官网项目', data: { duplicate_id: websiteDuplicate.id } });
    }
    const project = await BrandProject.create({
      user_id: req.user.id,
      name: projectFields.name,
      aliases: projectFields.aliases || [],
      website: projectFields.website,
      industry: projectFields.industry,
      primary_keywords: projectFields.primary_keywords || [],
      platforms: platformResult.platforms,
      ...cleanMonitoringPayload(req.body, { monitoring_enabled: false, monitoring_time: '09:00', platforms: platformResult.platforms }, platformResult.platforms),
      status: req.body.status === 'archived' ? 'archived' : 'active'
    });
    res.json({ success: true, message: '品牌项目已创建', data: project });
  } catch (error) {
    res.status(500).json({ success: false, message: '创建品牌项目失败' });
  }
});

router.get('/:id', loadProject, async (req, res) => {
  try {
    const project = await BrandProject.findByPk(req.brandProject.id, {
      include: [
        { model: BrandCompetitor, as: 'competitors' },
        { model: PromptGroup, as: 'promptGroups' },
        { model: TrackedPrompt, as: 'trackedPrompts' },
        { model: AlertRule, as: 'alertRules' }
      ]
    });
    res.json({ success: true, data: project });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取品牌项目失败' });
  }
});

router.put('/:id', loadProject, async (req, res) => {
  try {
    const invalidWebsiteResponse = rejectInvalidWebsiteInput(req, res);
    if (invalidWebsiteResponse) return invalidWebsiteResponse;
    const lifecycleGuard = ProjectLifecycleService.validateProjectUpdate(req.brandProject, req.body || {});
    if (!lifecycleGuard.ok) {
      return res.status(lifecycleGuard.status).json({ success: false, message: lifecycleGuard.message });
    }
    const payload = {};
    if (req.body.name != null) {
      const name = ProjectFieldNormalizationService.normalizeNullableText(req.body.name) || '';
      if (!name) return res.status(400).json({ success: false, message: '品牌名称不能为空' });
      payload.name = name;
    }
    const candidateName = payload.name !== undefined ? payload.name : req.brandProject.name;
    if (req.body.aliases != null) {
      payload.aliases = ProjectFieldNormalizationService.normalizeList(req.body.aliases, { exclude: [candidateName] });
    }
    if (payload.name !== undefined || payload.aliases !== undefined) {
      const brandCandidate = {
        name: payload.name !== undefined ? payload.name : req.brandProject.name,
        aliases: payload.aliases !== undefined ? payload.aliases : req.brandProject.aliases
      };
      const duplicate = await BrandProjectService.findDuplicateProject(req.brandProject.user_id, brandCandidate, req.brandProject.id);
      if (duplicate) {
        return res.status(409).json({ success: false, message: '已存在相同品牌项目', data: { duplicate_id: duplicate.id } });
      }
      const competitorRows = await BrandCompetitor.findAll({
        where: { project_id: req.brandProject.id },
        attributes: ['id', 'name', 'aliases'],
        raw: true
      });
      const conflict = BrandCompetitorService.findBrandConflictInRows(brandCandidate, competitorRows);
      if (conflict) {
        return res.status(400).json({ success: false, message: '品牌名称或别名不能与已有竞品相同', data: { competitor_id: conflict.id } });
      }
    }
    if (req.body.website !== undefined) payload.website = ProjectFieldNormalizationService.normalizeWebsite(req.body.website);
    if (payload.website !== undefined) {
      const websiteDuplicate = await BrandProjectService.findDuplicateProjectWebsite(
        req.brandProject.user_id,
        { website: payload.website },
        req.brandProject.id
      );
      if (websiteDuplicate) {
        return res.status(409).json({ success: false, message: '已存在相同品牌官网项目', data: { duplicate_id: websiteDuplicate.id } });
      }
      const competitorRows = await BrandCompetitor.findAll({
        where: { project_id: req.brandProject.id },
        attributes: ['id', 'name', 'website'],
        raw: true
      });
      const websiteConflict = BrandCompetitorService.findBrandWebsiteConflictInRows({ website: payload.website }, competitorRows);
      if (websiteConflict) {
        return res.status(400).json({ success: false, message: '品牌官网不能与已有竞品官网相同', data: { competitor_id: websiteConflict.id } });
      }
    }
    if (req.body.industry !== undefined) payload.industry = ProjectFieldNormalizationService.normalizeNullableText(req.body.industry);
    if (req.body.primary_keywords != null) {
      payload.primary_keywords = ProjectFieldNormalizationService.normalizeList(req.body.primary_keywords, { exclude: [candidateName] });
    }
    let platformResult = null;
    if (req.body.platforms !== undefined) {
      const selectablePlatforms = await getSelectablePlatformCodes();
      platformResult = PlatformSelectionService.validateProjectUpdate(
        req.body.platforms,
        req.brandProject.platforms,
        selectablePlatforms
      );
      if (!platformResult.ok) return platformValidationError(res, platformResult);
      payload.platforms = platformResult.platforms;
    }
    Object.assign(payload, cleanMonitoringPayload(req.body, req.brandProject.toJSON(), platformResult?.platforms));
    const archiveRequested = req.body.status === 'archived';
    const restoreRequested = req.body.status === 'active' && req.brandProject.status === 'archived';
    if (restoreRequested) {
      const duplicate = await BrandProjectService.findDuplicateProject(
        req.brandProject.user_id,
        { name: req.brandProject.name, aliases: req.brandProject.aliases },
        req.brandProject.id
      );
      if (duplicate) {
        return res.status(409).json({ success: false, message: '已存在相同品牌项目', data: { duplicate_id: duplicate.id } });
      }
      const websiteDuplicate = await BrandProjectService.findDuplicateProjectWebsite(
        req.brandProject.user_id,
        { website: req.brandProject.website },
        req.brandProject.id
      );
      if (websiteDuplicate) {
        return res.status(409).json({ success: false, message: '已存在相同品牌官网项目', data: { duplicate_id: websiteDuplicate.id } });
      }
    }
    if (req.body.status != null) payload.status = archiveRequested ? 'archived' : 'active';
    const projectAnalysisFieldsChanged = (
      (Object.prototype.hasOwnProperty.call(payload, 'name') && payload.name !== req.brandProject.name) ||
      (Object.prototype.hasOwnProperty.call(payload, 'aliases') && JSON.stringify(payload.aliases || []) !== JSON.stringify(asArray(req.brandProject.aliases))) ||
      (Object.prototype.hasOwnProperty.call(payload, 'website') && payload.website !== req.brandProject.website) ||
      (Object.prototype.hasOwnProperty.call(payload, 'industry') && payload.industry !== req.brandProject.industry) ||
      (Object.prototype.hasOwnProperty.call(payload, 'primary_keywords') && JSON.stringify(payload.primary_keywords || []) !== JSON.stringify(asArray(req.brandProject.primary_keywords))) ||
      (Object.prototype.hasOwnProperty.call(payload, 'platforms') && JSON.stringify(payload.platforms || []) !== JSON.stringify(cleanPlatforms(req.brandProject.platforms)))
    );
    await req.brandProject.update(payload);
    if (platformResult) {
      const promptRows = await TrackedPrompt.findAll({
        where: { project_id: req.brandProject.id },
        attributes: ['id', 'platforms']
      });
      await Promise.all(promptRows.map((prompt) => prompt.update({
        platforms: PlatformSelectionService.reconcilePromptPlatforms(prompt.platforms, platformResult.platforms)
      })));
    }
    if (archiveRequested) {
      await ProjectArchiveService.archiveProject(req.brandProject);
    }
    if (projectAnalysisFieldsChanged) await deleteProjectAnalysisData(req.brandProject.id);
    res.json({ success: true, message: '品牌项目已更新', data: req.brandProject });
  } catch (error) {
    cleanupAwareError(res, error, '更新品牌项目失败');
  }
});

router.delete('/:id', loadProject, async (req, res) => {
  try {
    const permanent = req.query.permanent === 'true' || req.query.permanent === '1';
    if (permanent) {
      const result = await ProjectDeletionService.deleteArchivedProject(req.brandProject);
      if (!result.ok) {
        return res.status(result.status || 400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: '品牌项目已删除', data: result.deleted });
    }
    await ProjectArchiveService.archiveProject(req.brandProject);
    return res.json({ success: true, message: '品牌项目已归档' });
  } catch (error) {
    return cleanupAwareError(res, error, '处理品牌项目失败');
  }
});

router.post('/:projectId/competitors', loadProject, async (req, res) => {
  try {
    const invalidWebsiteResponse = rejectInvalidWebsiteInput(req, res);
    if (invalidWebsiteResponse) return invalidWebsiteResponse;
    const archivedResponse = rejectArchivedProjectMutation(req, res, '归档项目不能修改竞品');
    if (archivedResponse) return archivedResponse;
    const name = ProjectFieldNormalizationService.normalizeNullableText(req.body.name) || '';
    if (!name) return res.status(400).json({ success: false, message: '竞品名称不能为空' });
    const aliases = ProjectFieldNormalizationService.normalizeList(req.body.aliases, { exclude: [name] });
    const website = ProjectFieldNormalizationService.normalizeWebsite(req.body.website);
    if (BrandCompetitorService.matchesBrand({ name, aliases }, req.brandProject.toJSON())) {
      return res.status(400).json({ success: false, message: '竞品不能与当前品牌名称或别名相同' });
    }
    if (BrandCompetitorService.matchesBrandWebsite({ website }, req.brandProject.toJSON())) {
      return res.status(400).json({ success: false, message: '竞品官网不能与当前品牌官网相同' });
    }
    const duplicate = await BrandCompetitorService.findDuplicateCompetitor(req.brandProject.id, { name, aliases });
    if (duplicate) {
      return res.status(409).json({ success: false, message: '该项目已存在相同竞品', data: { duplicate_id: duplicate.id } });
    }
    const websiteDuplicate = await BrandCompetitorService.findDuplicateCompetitorWebsite(req.brandProject.id, { website });
    if (websiteDuplicate) {
      return res.status(409).json({ success: false, message: '该项目已存在相同竞品官网', data: { duplicate_id: websiteDuplicate.id } });
    }
    const competitor = await BrandCompetitor.create({
      project_id: req.brandProject.id,
      user_id: projectScopedUser(req).id,
      name,
      aliases,
      website
    });
    await deleteProjectAnalysisData(req.brandProject.id);
    res.json({ success: true, message: '竞品已添加', data: competitor });
  } catch (error) {
    cleanupAwareError(res, error, '添加竞品失败');
  }
});

router.put('/:projectId/competitors/:competitorId', loadProject, async (req, res) => {
  try {
    const invalidWebsiteResponse = rejectInvalidWebsiteInput(req, res);
    if (invalidWebsiteResponse) return invalidWebsiteResponse;
    const archivedResponse = rejectArchivedProjectMutation(req, res, '归档项目不能修改竞品');
    if (archivedResponse) return archivedResponse;
    const competitor = await BrandCompetitor.findOne({
      where: { id: req.params.competitorId, project_id: req.brandProject.id }
    });
    if (!competitor) return res.status(404).json({ success: false, message: '竞品不存在' });
    const payload = {};
    if (req.body.name != null) {
      const name = ProjectFieldNormalizationService.normalizeNullableText(req.body.name) || '';
      if (!name) return res.status(400).json({ success: false, message: '竞品名称不能为空' });
      payload.name = name;
    }
    const competitorName = payload.name !== undefined ? payload.name : competitor.name;
    if (req.body.aliases != null) {
      payload.aliases = ProjectFieldNormalizationService.normalizeList(req.body.aliases, { exclude: [competitorName] });
    }
    if (payload.name !== undefined || payload.aliases !== undefined) {
      const candidate = {
        name: payload.name !== undefined ? payload.name : competitor.name,
        aliases: payload.aliases !== undefined ? payload.aliases : competitor.aliases
      };
      if (BrandCompetitorService.matchesBrand(candidate, req.brandProject.toJSON())) {
        return res.status(400).json({ success: false, message: '竞品不能与当前品牌名称或别名相同' });
      }
      const duplicate = await BrandCompetitorService.findDuplicateCompetitor(req.brandProject.id, candidate, competitor.id);
      if (duplicate) {
        return res.status(409).json({ success: false, message: '该项目已存在相同竞品', data: { duplicate_id: duplicate.id } });
      }
    }
    if (req.body.website !== undefined) payload.website = ProjectFieldNormalizationService.normalizeWebsite(req.body.website);
    const candidateWebsite = payload.website !== undefined ? payload.website : competitor.website;
    if (BrandCompetitorService.matchesBrandWebsite({ website: candidateWebsite }, req.brandProject.toJSON())) {
      return res.status(400).json({ success: false, message: '竞品官网不能与当前品牌官网相同' });
    }
    const websiteDuplicate = await BrandCompetitorService.findDuplicateCompetitorWebsite(
      req.brandProject.id,
      { website: candidateWebsite },
      competitor.id
    );
    if (websiteDuplicate) {
      return res.status(409).json({ success: false, message: '该项目已存在相同竞品官网', data: { duplicate_id: websiteDuplicate.id } });
    }
    await competitor.update(payload);
    await deleteProjectAnalysisData(req.brandProject.id);
    res.json({ success: true, message: '竞品已更新', data: competitor });
  } catch (error) {
    cleanupAwareError(res, error, '更新竞品失败');
  }
});

router.delete('/:projectId/competitors/:competitorId', loadProject, async (req, res) => {
  try {
    const archivedResponse = rejectArchivedProjectMutation(req, res, '归档项目不能修改竞品');
    if (archivedResponse) return archivedResponse;
    const deleted = await BrandCompetitor.destroy({ where: { id: req.params.competitorId, project_id: req.brandProject.id } });
    if (deleted) await deleteProjectAnalysisData(req.brandProject.id);
    res.json({ success: true, message: deleted ? '竞品已删除' : '竞品不存在' });
  } catch (error) {
    cleanupAwareError(res, error, '删除竞品失败');
  }
});

router.get('/:projectId/question-sets', loadProject, async (req, res) => {
  try {
    const groups = await PromptGroup.findAll({
      where: { project_id: req.brandProject.id },
      include: [{ model: TrackedPrompt, as: 'trackedPrompts' }],
      order: [['updated_at', 'DESC']]
    });
    return res.json({ success: true, data: groups.map(serializeQuestionSet) });
  } catch (error) {
    return res.status(500).json({ success: false, message: '获取问题集失败' });
  }
});

async function createQuestionSet(req, res) {
  try {
    const archivedResponse = rejectArchivedProjectMutation(req, res, '归档项目不能修改问题集');
    if (archivedResponse) return archivedResponse;
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: '问题集名称不能为空' });
    if (name.length > 120) return res.status(400).json({ success: false, message: '问题集名称不能超过 120 个字符' });
    const duplicate = await PromptGroup.findOne({ where: { project_id: req.brandProject.id, name } });
    if (duplicate) return res.status(409).json({ success: false, message: '该项目已存在同名问题集' });

    const createdId = await sequelize.transaction(async (transaction) => {
      const selection = await resolveQuestionSetQuestions(req.brandProject.id, req.body.question_ids, transaction);
      if (selection.error) {
        const validationError = new Error(selection.error);
        validationError.status = 400;
        throw validationError;
      }
      const group = await PromptGroup.create({
        project_id: req.brandProject.id,
        user_id: projectScopedUser(req).id,
        name,
        description: req.body.description ? String(req.body.description).trim() : null
      }, { transaction });
      if (selection.ids.length) {
        await TrackedPrompt.update(
          { prompt_group_id: group.id },
          { where: { project_id: req.brandProject.id, id: { [Op.in]: selection.ids } }, transaction }
        );
      }
      return group.id;
    });
    const group = await loadQuestionSet(req.brandProject.id, createdId);
    return res.status(201).json({ success: true, message: '问题集已创建', data: serializeQuestionSet(group) });
  } catch (error) {
    if (error?.status === 400) return res.status(400).json({ success: false, message: error.message });
    return res.status(500).json({ success: false, message: '创建问题集失败' });
  }
}

router.post('/:projectId/question-sets', loadProject, createQuestionSet);
router.post('/:projectId/prompt-groups', loadProject, createQuestionSet);

router.patch('/:projectId/question-sets/:questionSetId', loadProject, async (req, res) => {
  try {
    const archivedResponse = rejectArchivedProjectMutation(req, res, '归档项目不能修改问题集');
    if (archivedResponse) return archivedResponse;
    const questionSetId = Number(req.params.questionSetId);
    if (!Number.isInteger(questionSetId) || questionSetId <= 0) {
      return res.status(400).json({ success: false, message: '问题集 ID 无效' });
    }
    const group = await PromptGroup.findOne({
      where: { id: questionSetId, project_id: req.brandProject.id }
    });
    if (!group) return res.status(404).json({ success: false, message: '问题集不存在' });

    const payload = {};
    if (req.body.name !== undefined) {
      const name = String(req.body.name || '').trim();
      if (!name) return res.status(400).json({ success: false, message: '问题集名称不能为空' });
      if (name.length > 120) return res.status(400).json({ success: false, message: '问题集名称不能超过 120 个字符' });
      const duplicate = await PromptGroup.findOne({
        where: { project_id: req.brandProject.id, name, id: { [Op.ne]: questionSetId } }
      });
      if (duplicate) return res.status(409).json({ success: false, message: '该项目已存在同名问题集' });
      payload.name = name;
    }
    if (req.body.description !== undefined) {
      payload.description = String(req.body.description || '').trim() || null;
    }

    await sequelize.transaction(async (transaction) => {
      if (req.body.question_ids !== undefined) {
        const selection = await resolveQuestionSetQuestions(req.brandProject.id, req.body.question_ids, transaction);
        if (selection.error) {
          const validationError = new Error(selection.error);
          validationError.status = 400;
          throw validationError;
        }
        await TrackedPrompt.update(
          { prompt_group_id: null },
          { where: { project_id: req.brandProject.id, prompt_group_id: questionSetId }, transaction }
        );
        if (selection.ids.length) {
          await TrackedPrompt.update(
            { prompt_group_id: questionSetId },
            { where: { project_id: req.brandProject.id, id: { [Op.in]: selection.ids } }, transaction }
          );
        }
      }
      if (Object.keys(payload).length) await group.update(payload, { transaction });
    });

    const updated = await loadQuestionSet(req.brandProject.id, questionSetId);
    return res.json({ success: true, message: '问题集已更新', data: serializeQuestionSet(updated) });
  } catch (error) {
    if (error?.status === 400) return res.status(400).json({ success: false, message: error.message });
    return res.status(500).json({ success: false, message: '更新问题集失败' });
  }
});

router.delete('/:projectId/question-sets/:questionSetId', loadProject, async (req, res) => {
  try {
    const archivedResponse = rejectArchivedProjectMutation(req, res, '归档项目不能修改问题集');
    if (archivedResponse) return archivedResponse;
    const questionSetId = Number(req.params.questionSetId);
    if (!Number.isInteger(questionSetId) || questionSetId <= 0) {
      return res.status(400).json({ success: false, message: '问题集 ID 无效' });
    }
    const group = await PromptGroup.findOne({
      where: { id: questionSetId, project_id: req.brandProject.id }
    });
    if (!group) return res.status(404).json({ success: false, message: '问题集不存在' });

    await sequelize.transaction(async (transaction) => {
      await TrackedPrompt.update(
        { prompt_group_id: null },
        { where: { project_id: req.brandProject.id, prompt_group_id: questionSetId }, transaction }
      );
      await group.destroy({ transaction });
    });
    return res.json({ success: true, message: '问题集已删除' });
  } catch (error) {
    return res.status(500).json({ success: false, message: '删除问题集失败' });
  }
});

router.post('/:projectId/question-sets/:questionSetId/run', loadProject, async (req, res) => {
  try {
    if (!ProjectRunService.isRunnableProject(req.brandProject.toJSON())) {
      return res.status(400).json({ success: false, message: '归档项目不能运行分析' });
    }
    const questionSetId = Number(req.params.questionSetId);
    if (!Number.isInteger(questionSetId) || questionSetId <= 0) {
      return res.status(400).json({ success: false, message: '问题集 ID 无效' });
    }
    const group = await PromptGroup.findOne({
      where: { id: questionSetId, project_id: req.brandProject.id }
    });
    if (!group) return res.status(404).json({ success: false, message: '问题集不存在' });
    const idempotency = readRequiredIdempotencyKey(req);
    if (!idempotency.ok) {
      return res.status(400).json({
        success: false,
        message: '幂等键格式无效',
        data: { error_code: 'INVALID_IDEMPOTENCY_KEY' }
      });
    }

    const questions = await TrackedPrompt.findAll({
      where: {
        project_id: req.brandProject.id,
        prompt_group_id: questionSetId,
        enabled: true
      },
      order: [['id', 'ASC']]
    });
    if (!questions.length) {
      return res.status(400).json({
        success: false,
        message: '问题集中没有启用的问题。',
        data: { error_code: 'no_enabled_questions', skipped_platforms: [] }
      });
    }
    const projectPlatforms = cleanPlatforms(req.brandProject.platforms);

    const result = await ProjectRunService.startQuestionSetRun({
      project: req.brandProject,
      questionSet: group,
      prompts: questions.map((item) => ({
        ...item.toJSON(),
        platforms: projectPlatforms
      })),
      platforms: projectPlatforms,
      user: req.user,
      promptSelectionExplicit: true,
      idempotencyKey: idempotency.value
    });
    if (!result.ok) {
      return res.status(result.status || 400).json({ success: false, message: result.message, data: result.data });
    }
    return res.status(result.status || 202).json({
      success: true,
      message: result.message,
      data: result.data
    });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return res.status(status).json({
      success: false,
      message: status < 500 ? error.message : '运行问题集失败',
      ...(error?.data ? { data: error.data } : {})
    });
  }
});

router.get('/:projectId/question-set-runs', loadProject, async (req, res) => {
  try {
    const rawQuestionSetId = req.query.questionSetId;
    const questionSetId = rawQuestionSetId == null || rawQuestionSetId === ''
      ? undefined
      : Number(rawQuestionSetId);
    if (questionSetId !== undefined && (!Number.isInteger(questionSetId) || questionSetId <= 0)) {
      return res.status(400).json({ success: false, message: '问题集 ID 无效' });
    }
    const result = await QuestionSetRunService.listReports({
      projectId: req.brandProject.id,
      questionSetId,
      page: req.query.page,
      pageSize: req.query.pageSize
    });
    return res.json({ success: true, data: result.data, pagination: result.pagination });
  } catch (error) {
    return res.status(500).json({ success: false, message: '获取问题集运行历史失败' });
  }
});

router.get('/:projectId/question-set-runs/:runId/export', loadProject, async (req, res) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isInteger(runId) || runId <= 0) {
      return res.status(400).json({ success: false, message: '运行报告 ID 无效' });
    }
    const report = await QuestionSetRunService.getReport({
      projectId: req.brandProject.id,
      runId
    });
    if (!report) return res.status(404).json({ success: false, message: '运行报告不存在' });
    const csv = await QuestionSetRunService.exportCsv({
      projectId: req.brandProject.id,
      runId
    });
    const filename = `${report.question_set_name || 'question-set-report'}-${runId}.csv`;
    res.type('text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    return res.send(csv);
  } catch (error) {
    return res.status(500).json({ success: false, message: '导出问题集运行报告失败' });
  }
});

router.post(
  '/:projectId/question-set-runs/import',
  express.text({ type: 'text/csv', limit: '5mb' }),
  loadProject,
  async (req, res) => {
    try {
      const archivedResponse = rejectArchivedProjectMutation(req, res, '归档项目不能导入运行报告');
      if (archivedResponse) return archivedResponse;
      const imported = await QuestionSetRunService.importCsv({
        project: req.brandProject,
        user: req.user,
        csv: req.body
      });
      const report = await QuestionSetRunService.getReport({
        projectId: req.brandProject.id,
        runId: imported.id
      });
      return res.status(201).json({ success: true, message: '问题集运行报告已导入', data: report });
    } catch (error) {
      if (error instanceof CsvValidationError) {
        return res.status(422).json({
          success: false,
          message: error.message,
          error: {
            code: error.code,
            message: error.message,
            row: error.row,
            column: error.column
          }
        });
      }
      return res.status(500).json({ success: false, message: '导入问题集运行报告失败' });
    }
  }
);

router.get('/:projectId/question-set-runs/:runId', loadProject, async (req, res) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isInteger(runId) || runId <= 0) {
      return res.status(400).json({ success: false, message: '运行报告 ID 无效' });
    }
    const report = await QuestionSetRunService.getReport({
      projectId: req.brandProject.id,
      runId
    });
    if (!report) return res.status(404).json({ success: false, message: '运行报告不存在' });
    return res.json({ success: true, data: report });
  } catch (error) {
    return res.status(500).json({ success: false, message: '获取问题集运行报告失败' });
  }
});

router.post('/:projectId/question-set-runs/:runId/retry-failed', loadProject, async (req, res) => {
  try {
    const archivedResponse = rejectArchivedProjectMutation(req, res, '归档项目不能重试失败项');
    if (archivedResponse) return archivedResponse;
    const runId = Number(req.params.runId);
    if (!Number.isInteger(runId) || runId <= 0) {
      return res.status(400).json({ success: false, message: '运行报告 ID 无效' });
    }
    const result = await ProjectRunService.retryFailedQuestionSetRun({
      project: req.brandProject,
      runId,
      user: req.user,
      idempotencyKey: req.body?.idempotency_key || req.get?.('Idempotency-Key')
    });
    return res.status(result.status).json({
      success: true,
      message: result.message,
      data: result.data
    });
  } catch (error) {
    const requestedStatus = Number(error?.status);
    const errorCode = String(error?.data?.error_code || '');
    const isSafeClientError = Number.isInteger(requestedStatus)
      && requestedStatus >= 400
      && requestedStatus < 500;
    const isSafeAnalysisConfigError = requestedStatus === 503
      && error?.exposeToClient === true
      && /^analysis_[a-z0-9_]+$/.test(errorCode);
    const isSafeError = isSafeClientError || isSafeAnalysisConfigError;
    const status = isSafeError ? requestedStatus : 500;
    return res.status(status).json({
      success: false,
      message: isSafeError && error?.message ? error.message : '重试失败项失败',
      ...(isSafeError && error?.data ? { data: error.data } : {})
    });
  }
});

// 暂停问题集运行
router.post('/:projectId/question-set-runs/:runId/pause', loadProject, async (req, res) => {
  try {
    const archivedResponse = rejectArchivedProjectMutation(req, res, '归档项目不能暂停运行');
    if (archivedResponse) return archivedResponse;
    const runId = Number(req.params.runId);
    if (!Number.isInteger(runId) || runId <= 0) {
      return res.status(400).json({ success: false, message: '运行报告 ID 无效' });
    }
    const result = await ProjectRunService.pauseRun(runId, req.brandProject.id);
    return res.json({ success: true, data: result });
  } catch (error) {
    const requestedStatus = Number(error?.status);
    const safe = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus < 500;
    return res.status(safe ? requestedStatus : 500).json({
      success: false,
      message: safe && error?.message ? error.message : '暂停运行失败'
    });
  }
});

// 恢复问题集运行
router.post('/:projectId/question-set-runs/:runId/resume', loadProject, async (req, res) => {
  try {
    const archivedResponse = rejectArchivedProjectMutation(req, res, '归档项目不能恢复运行');
    if (archivedResponse) return archivedResponse;
    const runId = Number(req.params.runId);
    if (!Number.isInteger(runId) || runId <= 0) {
      return res.status(400).json({ success: false, message: '运行报告 ID 无效' });
    }
    const result = await ProjectRunService.resumeRun(runId, req.brandProject.id);
    return res.json({ success: true, data: result });
  } catch (error) {
    const requestedStatus = Number(error?.status);
    const safe = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus < 500;
    return res.status(safe ? requestedStatus : 500).json({
      success: false,
      message: safe && error?.message ? error.message : '恢复运行失败'
    });
  }
});

router.get('/:projectId/prompts', loadProject, async (req, res) => {
  try {
    const { periodStart, periodEnd } = ProjectMetricsService.buildPeriodWindow(req.query.days);
    const [prompts, metrics, records] = await Promise.all([
      TrackedPrompt.findAll({
        where: { project_id: req.brandProject.id },
        include: [{ model: PromptGroup, as: 'group' }],
        order: [['updated_at', 'DESC']]
      }),
      VisibilityMetric.findAll({
        where: {
          project_id: req.brandProject.id,
          metric_semantics_version: CURRENT_METRIC_SEMANTICS,
          created_at: { [Op.between]: [periodStart, periodEnd] }
        },
        order: [['created_at', 'ASC']]
      }),
      QuestionRecord.findAll({
        where: {
          project_id: req.brandProject.id,
          metric_semantics_version: CURRENT_METRIC_SEMANTICS,
          tracked_prompt_id: { [Op.ne]: null },
          created_at: { [Op.between]: [periodStart, periodEnd] }
        },
        attributes: [
          'id',
          'status',
          'tracked_prompt_id',
          'question_set_run_id',
          'run_slot_index',
          'platform',
          'metric_semantics_version',
          'created_at'
        ],
        include: [
          {
            model: ResultDetail,
            as: 'resultDetail',
            attributes: ['ai_response_original', 'citation_analysis'],
            required: false
          }
        ],
        order: [['created_at', 'ASC']]
      })
    ]);
    const promptRows = prompts.map((prompt) => {
      const row = prompt.toJSON();
      return {
        ...row,
        question_set_id: row.prompt_group_id || null,
        question_set: row.group ? {
          id: row.group.id,
          name: row.group.name,
          description: row.group.description || null
        } : null,
        category: ProjectRunService.derivePromptCategory(row)
      };
    });
    const performance = ProjectMetricsService.buildCurrentPromptPerformance(
      promptRows,
      metrics.map((metric) => metric.toJSON()),
      records.map((record) => record.toJSON())
    );
    res.json({
      success: true,
      data: promptRows.map((prompt) => ({
        ...prompt,
        performance: performance[String(prompt.id)] || null
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取问题失败' });
  }
});

router.post('/:projectId/prompts/generate', loadProject, async (req, res) => {
  try {
    const archivedResponse = rejectArchivedProjectMutation(req, res, '归档项目不能生成问题建议');
    if (archivedResponse) return archivedResponse;
    const projectData = req.brandProject.toJSON();
    const projectPlatformCodes = cleanPlatforms(projectData.platforms);
    const candidateCodes = projectPlatformCodes.length
      ? projectPlatformCodes
      : await AIPlatformService.getPlatformCodes();
    const availability = await AIPlatformService.getPlatformAvailability(candidateCodes, {
      capability: 'prompt_generation'
    });
    const platformStatus = availability.find((item) => item.available);
    if (!platformStatus) {
      const detail = availability.map(unavailablePlatformMessage).join('；') || '监测平台配置暂不可用';
      return res.status(400).json({
        success: false,
        message: `${detail}，无法生成问题建议。`,
        data: { error_code: 'all_platforms_unavailable' }
      });
    }
    const platform = platformStatus.code;
    const [competitors, existingPrompts, runtimeSettings] = await Promise.all([
      BrandCompetitor.findAll({
        where: { project_id: req.brandProject.id },
        order: [['id', 'ASC']]
      }),
      TrackedPrompt.findAll({
        where: { project_id: req.brandProject.id },
        attributes: ['question'],
        raw: true
      }),
      AIRuntimeSettingsService.getSettings()
    ]);
    const requestedCount = PromptSuggestionService.normalizeCount(req.body.count || 10);
    const competitorData = competitors.map((item) => item.toJSON());
    const generation = await PromptSuggestionService.generateSuggestions(projectData, competitorData, {
      platform,
      count: requestedCount,
      focus: req.body.focus,
      platformNames: [platformStatus.platform_name],
      excludeQuestions: existingPrompts.map((item) => item.question).filter(Boolean),
      queryPlatform: (targetPlatform, question) => AIPlatformService.queryPlatform(targetPlatform, question, {
        config: platformStatus.config,
        runtimeSettings,
        purpose: 'prompt_generation'
      }),
      extractResponseText: (data) => ResultParserService.extractResponseText(data),
      maxBrandQuestionRatio: 0.15
    });
    if (!generation.success) {
      return res.status(502).json({ success: false, message: '问题建议生成失败，请稍后重试' });
    }

    const suggestions = generation.suggestions;
    if (!suggestions.length) {
      return res.status(502).json({ success: false, message: '问题建议暂不可用，请稍后重试' });
    }

    res.json({
      success: true,
      message: '问题建议已生成',
      data: {
        platform,
        platform_name: platformStatus.platform_name,
        model_name: platformStatus.model_name,
        requested_count: requestedCount,
        batch_count: generation.batch_count,
        suggestions
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '生成问题建议失败' });
  }
});

router.post('/:projectId/prompts', loadProject, async (req, res) => {
  try {
    const archivedResponse = rejectArchivedProjectMutation(req, res, '归档项目不能修改问题');
    if (archivedResponse) return archivedResponse;
    const question = String(req.body.question || '').trim();
    if (!question) return res.status(400).json({ success: false, message: '问题内容不能为空' });
    const duplicate = await TrackedPromptService.findDuplicatePrompt(req.brandProject.id, question);
    if (duplicate) {
      return res.status(409).json({ success: false, message: '该项目已存在相同问题', data: { duplicate_id: duplicate.id } });
    }
    const questionSetId = req.body.question_set_id !== undefined
      ? req.body.question_set_id
      : req.body.prompt_group_id;
    const groupResult = await normalizePromptGroupId(req.brandProject.id, questionSetId);
    if (groupResult.error) return res.status(400).json({ success: false, message: groupResult.error });
    const selectablePlatforms = await getSelectablePlatformCodes();
    const platformResult = PlatformSelectionService.validateWithinProject(
      req.body.platforms,
      req.brandProject.platforms,
      selectablePlatforms
    );
    if (!platformResult.ok) return platformValidationError(res, platformResult);
    const prompt = await TrackedPrompt.create({
      project_id: req.brandProject.id,
      prompt_group_id: groupResult.value,
      user_id: projectScopedUser(req).id,
      question,
      tags: asArray(req.body.tags),
      platforms: platformResult.platforms,
      enabled: req.body.enabled !== false
    });
    await invalidateGeneratedReports(req.brandProject.id);
    res.json({ success: true, message: '问题已创建', data: prompt });
  } catch (error) {
    res.status(500).json({ success: false, message: '创建问题失败' });
  }
});

router.post('/:projectId/prompts/batch', loadProject, async (req, res) => {
  try {
    const archivedResponse = rejectArchivedProjectMutation(req, res, '归档项目不能修改问题');
    if (archivedResponse) return archivedResponse;

    if (!Array.isArray(req.body.questions) || !req.body.questions.length) {
      return res.status(400).json({ success: false, message: '请至少输入一个问题' });
    }
    if (req.body.questions.length > 100) {
      return res.status(400).json({ success: false, message: '单次最多批量新增 100 个问题' });
    }
    const questions = req.body.questions.map((item) => String(item ?? '').trim());
    if (questions.some((item) => !item)) {
      return res.status(400).json({ success: false, message: '批量问题中不能包含空内容' });
    }
    if (questions.some((item) => item.length > 5000)) {
      return res.status(400).json({ success: false, message: '单个问题不能超过 5000 个字符' });
    }

    const questionSetId = req.body.question_set_id !== undefined
      ? req.body.question_set_id
      : req.body.prompt_group_id;
    const groupResult = await normalizePromptGroupId(req.brandProject.id, questionSetId);
    if (groupResult.error) return res.status(400).json({ success: false, message: groupResult.error });

    const selectablePlatforms = await getSelectablePlatformCodes();
    const platformResult = PlatformSelectionService.validateWithinProject(
      req.body.platforms,
      req.brandProject.platforms,
      selectablePlatforms
    );
    if (!platformResult.ok) return platformValidationError(res, platformResult);

    const existingRows = await TrackedPrompt.findAll({
      where: { project_id: req.brandProject.id },
      attributes: ['id', 'question'],
      raw: true
    });
    const prepared = TrackedPromptService.prepareBatchQuestions(questions, existingRows);
    let created = [];
    if (prepared.createdQuestions.length) {
      created = await sequelize.transaction(async (transaction) => TrackedPrompt.bulkCreate(
        prepared.createdQuestions.map((question) => ({
          project_id: req.brandProject.id,
          prompt_group_id: groupResult.value,
          user_id: projectScopedUser(req).id,
          question,
          tags: asArray(req.body.tags),
          platforms: platformResult.platforms,
          enabled: req.body.enabled !== false
        })),
        { transaction }
      ));
      await invalidateGeneratedReports(req.brandProject.id);
    }

    return res.status(created.length ? 201 : 200).json({
      success: true,
      message: created.length
        ? `已新增 ${created.length} 个问题${prepared.skipped.length ? `，跳过 ${prepared.skipped.length} 个重复项` : ''}`
        : '没有新增问题，输入内容均已存在',
      data: {
        created_count: created.length,
        skipped_count: prepared.skipped.length,
        created,
        skipped: prepared.skipped
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: '批量创建问题失败' });
  }
});

router.put('/:projectId/prompts/:promptId', loadProject, async (req, res) => {
  try {
    const archivedResponse = rejectArchivedProjectMutation(req, res, '归档项目不能修改问题');
    if (archivedResponse) return archivedResponse;
    const prompt = await TrackedPrompt.findOne({ where: { id: req.params.promptId, project_id: req.brandProject.id } });
    if (!prompt) return res.status(404).json({ success: false, message: '问题不存在' });
    const payload = {};
    if (req.body.question != null) {
      const question = String(req.body.question || '').trim();
      if (!question) return res.status(400).json({ success: false, message: '问题内容不能为空' });
      const duplicate = await TrackedPromptService.findDuplicatePrompt(req.brandProject.id, question, prompt.id);
      if (duplicate) {
        return res.status(409).json({ success: false, message: '该项目已存在相同问题', data: { duplicate_id: duplicate.id } });
      }
      payload.question = question;
    }
    if (req.body.question_set_id !== undefined || req.body.prompt_group_id !== undefined) {
      const questionSetId = req.body.question_set_id !== undefined
        ? req.body.question_set_id
        : req.body.prompt_group_id;
      const groupResult = await normalizePromptGroupId(req.brandProject.id, questionSetId);
      if (groupResult.error) return res.status(400).json({ success: false, message: groupResult.error });
      payload.prompt_group_id = groupResult.value;
    }
    if (req.body.tags != null) payload.tags = asArray(req.body.tags);
    if (req.body.platforms !== undefined) {
      const selectablePlatforms = await getSelectablePlatformCodes();
      const platformResult = PlatformSelectionService.validateWithinProject(
        req.body.platforms,
        req.brandProject.platforms,
        selectablePlatforms
      );
      if (!platformResult.ok) return platformValidationError(res, platformResult);
      payload.platforms = platformResult.platforms;
    }
    if (req.body.enabled != null) payload.enabled = !!req.body.enabled;
    const analysisFieldsChanged = (
      (Object.prototype.hasOwnProperty.call(payload, 'question') && payload.question !== prompt.question) ||
      (Object.prototype.hasOwnProperty.call(payload, 'tags') && JSON.stringify(payload.tags || []) !== JSON.stringify(asArray(prompt.tags))) ||
      (Object.prototype.hasOwnProperty.call(payload, 'platforms') && JSON.stringify(payload.platforms || []) !== JSON.stringify(cleanPlatforms(prompt.platforms)))
    );
    const promptVisibilityChanged = Object.prototype.hasOwnProperty.call(payload, 'enabled') && payload.enabled !== prompt.enabled;
    await prompt.update(payload);
    if (analysisFieldsChanged) await deletePromptAnalysisData(req.brandProject.id, [prompt.id]);
    else if (promptVisibilityChanged) await invalidateGeneratedReports(req.brandProject.id);
    res.json({ success: true, message: '问题已更新', data: prompt });
  } catch (error) {
    cleanupAwareError(res, error, '更新问题失败');
  }
});

router.post('/:projectId/prompts/batch-delete', loadProject, batchDeletePrompts);
router.delete('/:projectId/prompts/batch', loadProject, batchDeletePrompts);

router.delete('/:projectId/prompts/:promptId', loadProject, async (req, res) => {
  try {
    const archivedResponse = rejectArchivedProjectMutation(req, res, '归档项目不能修改问题');
    if (archivedResponse) return archivedResponse;
    const promptId = Number(req.params.promptId);
    if (!Number.isInteger(promptId) || promptId <= 0) {
      return res.status(400).json({ success: false, message: '问题 ID 无效' });
    }
    await deletePromptAnalysisData(req.brandProject.id, [promptId]);
    const deleted = await TrackedPrompt.destroy({ where: { id: promptId, project_id: req.brandProject.id } });
    res.json({ success: true, message: deleted ? '问题已删除' : '问题不存在' });
  } catch (error) {
    cleanupAwareError(res, error, '删除问题失败');
  }
});

router.post('/:projectId/prompts/:promptId/run', loadProject, async (req, res) => {
  try {
    if (!ProjectRunService.isRunnableProject(req.brandProject.toJSON())) {
      return res.status(400).json({ success: false, message: '归档项目不能运行分析' });
    }
    const prompt = await TrackedPrompt.findOne({
      where: { id: req.params.promptId, project_id: req.brandProject.id, enabled: true }
    });
    if (!prompt) return res.status(404).json({ success: false, message: '问题不存在或已停用' });
    const idempotency = readRequiredIdempotencyKey(req);
    if (!idempotency.ok) {
      return res.status(400).json({
        success: false,
        message: '幂等键格式无效',
        data: { error_code: 'INVALID_IDEMPOTENCY_KEY' }
      });
    }
    const promptData = prompt.toJSON();
    const result = await ProjectRunService.startQuestionSetRun({
      project: req.brandProject,
      questionSet: {
        id: null,
        name: `单问题：${String(promptData.question || '').trim()}`.slice(0, 120)
      },
      prompts: [promptData],
      platforms: cleanPlatforms(req.brandProject.platforms),
      user: req.user,
      promptSelectionExplicit: true,
      idempotencyKey: idempotency.value
    });
    if (!result.ok) {
      return res.status(result.status || 400).json({ success: false, message: result.message, data: result.data });
    }
    return res.status(result.status || 202).json({
      success: true,
      message: result.message,
      data: result.data
    });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return res.status(status).json({
      success: false,
      message: status < 500 ? error.message : '运行问题失败',
      ...(error?.data ? { data: error.data } : {})
    });
  }
});

router.get('/:projectId/prompts/:promptId/history', loadProject, async (req, res) => {
  try {
    const prompt = await TrackedPrompt.findOne({ where: { id: req.params.promptId, project_id: req.brandProject.id } });
    if (!prompt) return res.status(404).json({ success: false, message: '问题不存在' });
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
    const rows = await QuestionRecord.findAll({
      where: {
        project_id: req.brandProject.id,
        tracked_prompt_id: prompt.id
      },
      include: [
        { model: ResultDetail, as: 'resultDetail' },
        { model: VisibilityMetric, as: 'visibilityMetric' }
      ],
      order: [['created_at', 'DESC']],
      limit
    });
    const data = rows.map((item) => {
      const row = item?.toJSON ? item.toJSON() : item;
      return {
        ...row,
        visibilityMetric: CitationMetricSemanticsService.normalizeForRead(row.visibilityMetric)
      };
    });
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: '获取问题历史失败' });
  }
});

router.get('/:projectId/dashboard', loadProject, async (req, res) => {
  try {
    const { days, periodStart, periodEnd, changePeriodStart } = ProjectMetricsService.buildPeriodWindow(req.query.days);
    const selectedPlatform = ProjectMetricsService.normalizePlatformFilter(req.query.platform);
    const [metrics, sourceChangeMetrics, sourceChangeRecords, prompts, competitors] = await Promise.all([
      VisibilityMetric.findAll({
        where: {
          project_id: req.brandProject.id,
          metric_semantics_version: CURRENT_METRIC_SEMANTICS,
          created_at: { [Op.between]: [periodStart, periodEnd] }
        },
        include: [
          { model: QuestionRecord, as: 'questionRecord', attributes: ['id', 'question'] },
          { model: TrackedPrompt, as: 'prompt', attributes: ['id', 'question'] }
        ],
        order: [['created_at', 'ASC']]
      }),
      VisibilityMetric.findAll({
        where: {
          project_id: req.brandProject.id,
          metric_semantics_version: CURRENT_METRIC_SEMANTICS,
          created_at: { [Op.between]: [changePeriodStart, periodEnd] }
        },
        order: [['created_at', 'ASC']]
      }),
      QuestionRecord.findAll({
        where: {
          project_id: req.brandProject.id,
          metric_semantics_version: CURRENT_METRIC_SEMANTICS,
          created_at: { [Op.between]: [changePeriodStart, periodEnd] }
        },
        attributes: [
          'id',
          'status',
          'tracked_prompt_id',
          'question_set_run_id',
          'run_slot_index',
          'platform',
          'metric_semantics_version',
          'created_at'
        ],
        include: [{
          model: ResultDetail,
          as: 'resultDetail',
          attributes: ['ai_response_original', 'citation_analysis'],
          required: false
        }]
      }),
      TrackedPrompt.findAll({
        where: { project_id: req.brandProject.id },
        attributes: ['id', 'question', 'tags', 'platforms', 'enabled'],
        raw: true
      }),
      BrandCompetitor.findAll({
        where: { project_id: req.brandProject.id },
        order: [['id', 'ASC']]
      })
    ]);
    const allMetricRows = metrics.map((row) => row.toJSON());
    const allSourceChangeRecordRows = sourceChangeRecords.map((row) => row.toJSON());
    const allRecordRows = allSourceChangeRecordRows.filter((row) => {
      const createdAt = new Date(row.created_at || row.createdAt || 0);
      return !Number.isNaN(createdAt.getTime()) && createdAt >= periodStart;
    });
    const availablePlatforms = ProjectMetricsService.listActualPlatforms(allMetricRows, allRecordRows);
    const plain = ProjectMetricsService.filterByPlatform(allMetricRows, selectedPlatform);
    const recordRows = ProjectMetricsService.filterByPlatform(allRecordRows, selectedPlatform);
    const sourceChangeRows = ProjectMetricsService.filterByPlatform(
      sourceChangeMetrics.map((row) => row.toJSON()),
      selectedPlatform
    );
    const sourceChangeRecordRows = ProjectMetricsService.filterByPlatform(
      allSourceChangeRecordRows,
      selectedPlatform
    );
    const promptRows = prompts.map((prompt) => ({
      ...prompt,
      category: ProjectRunService.derivePromptCategory(prompt)
    }));
    const promptPerformance = ProjectMetricsService.buildCurrentPromptPerformance(promptRows, plain, recordRows);
    const citationEvidenceRows = ProjectMetricsService.buildCurrentCitationEvidenceRows({
      metrics: plain,
      records: recordRows
    });
    const sourceChangeCitationEvidenceRows = ProjectMetricsService.buildCurrentCitationEvidenceRows({
      metrics: sourceChangeRows,
      records: sourceChangeRecordRows
    });
    const sourceAnalysis = SourceAnalysisService.summarize(citationEvidenceRows, {
      brand: req.brandProject.toJSON(),
      competitors: competitors.map((row) => row.toJSON()),
      prompts: promptRows,
      days,
      referenceDate: periodEnd,
      changeMetrics: sourceChangeCitationEvidenceRows
    });
    const opportunities = OpportunityInsightService.build({
      prompts: promptRows,
      promptPerformance,
      metrics: plain,
      sourceOpportunities: sourceAnalysis.opportunities,
      projectPlatforms: selectedPlatform === 'all' ? availablePlatforms : [selectedPlatform],
      days
    });
    const summary = ProjectMetricsService.buildCurrentDashboardSummary({
      metrics: plain,
      records: recordRows,
      prompts: promptRows,
      sourceAnalysis
    });
    res.json({
      success: true,
      data: {
        project: req.brandProject,
        metric_semantics_version: CURRENT_METRIC_SEMANTICS,
        selected_platform: selectedPlatform,
        available_platforms: availablePlatforms,
        summary,
        trend: ProjectMetricsService.buildCurrentTrend(plain, recordRows, days, { referenceDate: periodEnd }),
        opportunities,
        recent_metrics: plain
          .slice(-20)
          .reverse()
          .map((metric) => ProjectMetricsService.presentCurrentMetric(
            CitationMetricSemanticsService.normalizeForRead(metric)
          ))
      }
    });
  } catch (error) {
    if (error?.code === 'INVALID_PLATFORM_FILTER') {
      return res.status(400).json({
        success: false,
        error_code: 'INVALID_PLATFORM_FILTER',
        message: error.message
      });
    }
    res.status(500).json({ success: false, message: '获取项目看板失败' });
  }
});

router.get('/:projectId/sources', loadProject, async (req, res) => {
  try {
    const { days, periodStart, periodEnd, changePeriodStart } = ProjectMetricsService.buildPeriodWindow(req.query.days);
    const [metrics, changeMetrics, changeRecords, competitors, prompts] = await Promise.all([
      VisibilityMetric.findAll({
        where: {
          project_id: req.brandProject.id,
          metric_semantics_version: CURRENT_METRIC_SEMANTICS,
          created_at: { [Op.between]: [periodStart, periodEnd] }
        },
        order: [['created_at', 'ASC']]
      }),
      VisibilityMetric.findAll({
        where: {
          project_id: req.brandProject.id,
          metric_semantics_version: CURRENT_METRIC_SEMANTICS,
          created_at: { [Op.between]: [changePeriodStart, periodEnd] }
        },
        order: [['created_at', 'ASC']]
      }),
      QuestionRecord.findAll({
        where: {
          project_id: req.brandProject.id,
          metric_semantics_version: CURRENT_METRIC_SEMANTICS,
          created_at: { [Op.between]: [changePeriodStart, periodEnd] }
        },
        attributes: [
          'id',
          'tracked_prompt_id',
          'question_set_run_id',
          'run_slot_index',
          'platform',
          'metric_semantics_version',
          'created_at'
        ],
        include: [{
          model: ResultDetail,
          as: 'resultDetail',
          attributes: ['ai_response_original', 'citation_analysis'],
          required: false
        }]
      }),
      BrandCompetitor.findAll({
        where: { project_id: req.brandProject.id },
        order: [['id', 'ASC']]
      }),
      TrackedPrompt.findAll({
        where: { project_id: req.brandProject.id },
        attributes: ['id', 'question', 'tags', 'platforms', 'enabled'],
        raw: true
      })
    ]);
    const metricRows = metrics.map((row) => row.toJSON());
    const changeMetricRows = changeMetrics.map((row) => row.toJSON());
    const changeRecordRows = changeRecords.map((row) => row.toJSON());
    const recordRows = changeRecordRows.filter((row) => {
      const createdAt = new Date(row.created_at || row.createdAt || 0);
      return !Number.isNaN(createdAt.getTime()) && createdAt >= periodStart;
    });
    const citationRows = ProjectMetricsService.buildCurrentCitationEvidenceRows({
      metrics: metricRows,
      records: recordRows
    });
    const changeCitationRows = ProjectMetricsService.buildCurrentCitationEvidenceRows({
      metrics: changeMetricRows,
      records: changeRecordRows
    });
    const competitorRows = competitors.map((row) => row.toJSON());
    const analysis = SourceAnalysisService.summarize(citationRows, {
      brand: req.brandProject.toJSON(),
      competitors: competitorRows,
      prompts,
      days,
      referenceDate: periodEnd,
      changeMetrics: changeCitationRows
    });

    res.json({
      success: true,
      data: {
        project: req.brandProject,
        days,
        ...analysis
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取来源分析失败' });
  }
});

router.get('/:projectId/reports/latest', loadProject, async (req, res) => {
  try {
    const report = await ReportSnapshotService.findLatest({
      project: req.brandProject,
      days: req.query.days
    });
    res.json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取最新报告失败' });
  }
});

router.post('/:projectId/reports/generate', loadProject, async (req, res) => {
  try {
    const archivedResponse = rejectArchivedProjectMutation(req, res, '归档项目不能生成报告');
    if (archivedResponse) return archivedResponse;
    const report = await ReportSnapshotService.generate({
      project: req.brandProject,
      user: req.user,
      days: req.body.days
    });
    res.json({ success: true, message: '报告快照已生成', data: report });
  } catch (error) {
    res.status(500).json({ success: false, message: '生成报告失败' });
  }
});

router.get('/:projectId/alerts', loadProject, async (req, res) => {
  try {
    const rows = await AlertRule.findAll({ where: { project_id: req.brandProject.id }, order: [['id', 'DESC']] });
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取告警规则失败' });
  }
});

router.post('/:projectId/alerts', loadProject, async (req, res) => {
  try {
    const archivedResponse = rejectArchivedProjectMutation(req, res, '归档项目不能修改告警规则');
    if (archivedResponse) return archivedResponse;
    const payload = AlertEvaluationService.buildRulePayload(req.body, 'visibility_drop');
    const type = payload.type || 'visibility_drop';
    const threshold = payload.threshold ?? AlertEvaluationService.normalizeThreshold(type, req.body.threshold);
    const rule = await AlertRule.create({
      project_id: req.brandProject.id,
      user_id: projectScopedUser(req).id,
      type,
      threshold,
      enabled: payload.enabled !== false
    });
    res.json({ success: true, message: '告警规则已创建', data: rule });
  } catch (error) {
    const validationResponse = alertValidationError(res, error);
    if (validationResponse) return validationResponse;
    res.status(500).json({ success: false, message: '创建告警规则失败' });
  }
});

router.put('/:projectId/alerts/:alertId', loadProject, async (req, res) => {
  try {
    const archivedResponse = rejectArchivedProjectMutation(req, res, '归档项目不能修改告警规则');
    if (archivedResponse) return archivedResponse;
    const rule = await AlertRule.findOne({ where: { id: req.params.alertId, project_id: req.brandProject.id } });
    if (!rule) return res.status(404).json({ success: false, message: '告警规则不存在' });
    const payload = AlertEvaluationService.buildRulePayload(req.body, rule.type);
    await rule.update(payload);
    res.json({ success: true, message: '告警规则已更新', data: rule });
  } catch (error) {
    const validationResponse = alertValidationError(res, error);
    if (validationResponse) return validationResponse;
    res.status(500).json({ success: false, message: '更新告警规则失败' });
  }
});

router.delete('/:projectId/alerts/:alertId', loadProject, async (req, res) => {
  try {
    const archivedResponse = rejectArchivedProjectMutation(req, res, '归档项目不能修改告警规则');
    if (archivedResponse) return archivedResponse;
    const deleted = await AlertRule.destroy({ where: { id: req.params.alertId, project_id: req.brandProject.id } });
    res.json({ success: true, message: deleted ? '告警规则已删除' : '告警规则不存在' });
  } catch (error) {
    res.status(500).json({ success: false, message: '删除告警规则失败' });
  }
});

module.exports = router;
