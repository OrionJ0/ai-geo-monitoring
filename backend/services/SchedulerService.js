const {
  BrandProject,
  DetectionSchedule,
  QuestionRecord,
  QuestionSetRetryBatch,
  ResultDetail,
  ScheduledExecution,
  TrackedPrompt,
  User,
  sequelize
} = require('../models');
const { randomUUID } = require('node:crypto');
const os = require('node:os');
const { Op, Transaction } = require('sequelize');
const AIPlatformService = require('./AIPlatformService');
const ResultParserService = require('./ResultParserService');
const ProjectRunService = require('./ProjectRunService');
const ProjectRecordFinalizationService = require('./ProjectRecordFinalizationService');
const AIRuntimeSettingsService = require('./AIRuntimeSettingsService');
const { ERROR_MESSAGES: AI_PLATFORM_ERROR_MESSAGES } = require('./AIPlatformRequestService');
const { consumeQuotaDirect } = require('../middleware/quota');
const SAFE_PLATFORM_FAILURE_MESSAGE = '监测平台调用失败，请稍后重试';

function platformUnavailableMessage(item) {
  const name = item?.platform_name || item?.code || '监测平台';
  const messages = {
    missing_api_key: `${name}未配置 API Key`,
    disabled: `${name}已被管理员停用`,
    missing_base_url: `${name}未配置接口地址`,
    missing_model: `${name}未配置默认模型`,
    archived: `${name}已归档`,
    config_unavailable: `${name}配置暂不可用`
  };
  return messages[item?.reason] || `${name}暂不可用`;
}

function safePlatformFailureMessage(result) {
  return AI_PLATFORM_ERROR_MESSAGES[result?.error_code] || SAFE_PLATFORM_FAILURE_MESSAGE;
}

function computeNextRun(dailyTime, timezone) {
  try {
    const [hhRaw, mmRaw] = String(dailyTime).split(':').map(n => parseInt(n, 10));
    const hh = Number.isInteger(hhRaw) && hhRaw >= 0 && hhRaw <= 23 ? hhRaw : 9;
    const mm = Number.isInteger(mmRaw) && mmRaw >= 0 && mmRaw <= 59 ? mmRaw : 0;
    const now = new Date();
    const next = new Date();
    next.setSeconds(0, 0);
    next.setHours(hh, mm, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next;
  } catch (_) {
    const n = new Date();
    n.setMinutes(n.getMinutes() + 5);
    return n;
  }
}

async function validateScheduleProject(schedule, repositories = {}) {
  if (!schedule?.project_id) return { ok: true };
  const ProjectRepository = repositories.BrandProject || BrandProject;
  const PromptRepository = repositories.TrackedPrompt || TrackedPrompt;
  const project = await ProjectRepository.findByPk(schedule.project_id);
  const projectData = project?.toJSON ? project.toJSON() : project;
  if (!projectData) {
    await schedule.update?.({ enabled: false });
    return { ok: false, reason: '项目不存在' };
  }
  if (projectData.status === 'archived') {
    await schedule.update?.({ enabled: false });
    return { ok: false, reason: '项目已归档' };
  }
  if (schedule.tracked_prompt_id) {
    const prompt = await PromptRepository.findOne({
      where: {
        id: schedule.tracked_prompt_id,
        project_id: schedule.project_id
      }
    });
    const promptData = prompt?.toJSON ? prompt.toJSON() : prompt;
    if (!promptData || promptData.enabled === false) {
      await schedule.update?.({ enabled: false });
      return { ok: false, reason: '问题已停用或不存在' };
    }
  }
  return { ok: true, project: projectData };
}

async function submitDetectionForSchedule(schedule, options = {}) {
  const platformService = options.aiPlatformService || AIPlatformService;
  const settingsService = options.settingsService || AIRuntimeSettingsService;
  const quotaConsumer = options.consumeQuota || consumeQuotaDirect;
  const scheduledExecutionId = Number(options.scheduledExecutionId) > 0
    ? Number(options.scheduledExecutionId)
    : null;
  let projectData = options.project || null;
  if (!options.projectValidated) {
    const projectGuard = await validateScheduleProject(schedule);
    if (!projectGuard.ok) {
      return { ok: false, skipped: true, reason: projectGuard.reason };
    }
    projectData = projectGuard.project || null;
  }

  const { user_id, question, platforms, highlight_keywords } = schedule;
  const platformsList = normalizeSchedulePlatforms(platforms, projectData);
  const keywordsArr = Array.isArray(highlight_keywords) ? highlight_keywords : [];
  let availability;
  try {
    availability = await platformService.getPlatformAvailability(platformsList);
  } catch (error) {
    console.warn('读取定时任务平台配置失败:', error?.message || error);
    return {
      ok: false,
      reason: 'platform_config_unavailable',
      attempted: 0,
      advance_schedule: true,
      skipped_platforms: platformsList.map((platform) => ({
        platform,
        reason: 'config_unavailable',
        message: `${platform}配置暂不可用`
      }))
    };
  }
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
    return {
      ok: false,
      reason: 'all_platforms_unavailable',
      attempted: 0,
      advance_schedule: true,
      skipped_platforms: skippedPlatforms
    };
  }

  const runtimeSettings = await settingsService.getSettings();

  // 配额检查：严格按会员控制，每次按平台数量扣减
  try {
    const consume = await quotaConsumer(user_id, 'detection', runnablePlatforms.length);
    if (!consume.ok) {
      console.warn(`定时任务配额不足或不可用: user=${user_id}, need=${runnablePlatforms.length}, limit=${consume.limit}, used=${consume.used}`);
      const reasonMap = {
        not_allowed: '当前会员等级不允许使用该功能',
        exceeded: '今日可用检测次数不足',
        error: '配额检查失败'
      };
      const errMsg = reasonMap[consume.reason] || '配额不足';
      // 为每个平台生成失败历史记录，便于用户在历史中看到失败原因
      for (const platformStatus of runnablePlatforms) {
        try {
          await QuestionRecord.create({
            user_id,
            project_id: schedule.project_id || null,
            tracked_prompt_id: schedule.tracked_prompt_id || null,
            scheduled_execution_id: scheduledExecutionId,
            platform: platformStatus.code,
            platform_name: platformStatus.platform_name,
            model_name: platformStatus.model_name,
            question,
            brand: schedule.brand,
            brand_keywords: keywordsArr.join(','),
            status: 'failed',
            error_message: errMsg
          });
        } catch (e) {
          console.warn('创建配额不足失败记录异常:', e?.message || e);
        }
      }
      return {
        ok: false,
        reason: 'quota_unavailable',
        attempted: runnablePlatforms.length,
        skipped_platforms: skippedPlatforms
      };
    }
  } catch (e) {
    console.warn('定时任务配额检查失败:', e?.message || e);
    return { ok: false, reason: 'quota_check_failed' };
  }
  let attempted = 0;
  let completed = 0;
  let failed = 0;
  for (const platformStatus of runnablePlatforms) {
    const platform = platformStatus.code;
    let rec = null;
    attempted += 1;
    try {
      rec = await QuestionRecord.create({
        user_id,
        project_id: schedule.project_id || null,
        tracked_prompt_id: schedule.tracked_prompt_id || null,
        scheduled_execution_id: scheduledExecutionId,
        platform,
        platform_name: platformStatus.platform_name,
        model_name: platformStatus.model_name,
        question,
        brand: schedule.brand,
        brand_keywords: keywordsArr.join(',')
      });

      const result = await platformService.queryPlatform(platform, question, {
        config: platformStatus.config,
        runtimeSettings
      });
      if (!result.success) {
        console.warn('定时任务平台调用失败:', result.error || result.message || platform);
        await QuestionRecord.update(
          { status: 'failed', error_message: safePlatformFailureMessage(result) },
          { where: { id: rec.id } }
        );
        failed += 1;
        continue;
      }

      const originalText = ResultParserService.extractResponseText(result.data);
      if (!String(originalText || '').trim()) {
        await QuestionRecord.update(
          { status: 'failed', error_message: '监测平台返回内容为空' },
          { where: { id: rec.id } }
        );
        failed += 1;
        continue;
      }
      await ResultDetail.create({
        question_record_id: rec.id,
        ai_response_original: originalText,
        provider_citations: ProjectRunService.snapshotProviderCitations(result.data),
        parsing_status: 'completed'
      });

      const finalization = await finalizeScheduledProjectRecord({
        record: rec,
        responseText: originalText,
        aiResponse: result.data,
        keywords: keywordsArr
      });
      if (finalization?.ok) {
        completed += 1;
      } else {
        failed += 1;
      }
    } catch (e) {
      console.warn('执行定时任务查询失败:', e?.message || e);
      failed += 1;
      if (rec?.id) {
        try {
          await QuestionRecord.update(
            { status: 'failed', error_message: SAFE_PLATFORM_FAILURE_MESSAGE },
            { where: { id: rec.id } }
          );
        } catch (updateError) {
          console.warn('标记定时任务失败记录异常:', updateError?.message || updateError);
        }
      }
    }
  }
  return { ok: completed > 0, completed, failed, attempted, skipped_platforms: skippedPlatforms };
}

async function finalizeScheduledProjectRecord({
  record,
  responseText,
  aiResponse = null,
  keywords = [],
  repositories = {},
  projectRunService = ProjectRunService
}) {
  const result = await ProjectRecordFinalizationService.finalize({
    record,
    responseText,
    aiResponse,
    keywords,
    repositories,
    projectRunService
  });
  if (!result.ok) {
    const error = result.error;
    console.warn('创建定时任务可见性指标失败:', error?.message || error);
  }
  return result;
}

function normalizeSchedulePlatforms(platforms, project = null) {
  const scheduled = (Array.isArray(platforms) ? platforms : [])
    .map(p => String(p || '').trim().toLowerCase())
    .filter(Boolean);
  if (!project?.id) return Array.from(new Set(scheduled));

  const projectPlatforms = (Array.isArray(project.platforms) ? project.platforms : [])
    .map(p => String(p || '').trim().toLowerCase())
    .filter(Boolean);
  const projectSet = new Set(projectPlatforms);
  return Array.from(new Set(scheduled.filter(p => projectSet.has(p))));
}

class SchedulerService {
  constructor(options = {}) {
    this._timer = null;
    this._tickPromise = null;
    this._started = false;
    this._lastRecoveryAt = null;
    this._lastErrorCode = null;
    this._ownerId = options.ownerId || `${os.hostname()}:${process.pid}`;
    this._scheduledExecutionStats = {
      claimed: 0,
      duplicate_claims: 0,
      stale_claims: 0,
      completed: 0,
      failed: 0,
      last_claimed_at: null,
      last_error_code: null
    };
  }

  async start() {
    if (this._started) return;
    try {
      await this.refresh();
      await this.dispatchPendingQuestionSetRuns();
      await this.recoverStalePendingRecords({
        includeUnclaimed: true,
        maxAgeMs: 1
      });
      await this.recoverStaleScheduledExecutions();
      this._lastRecoveryAt = new Date().toISOString();
      this._timer = setInterval(() => this.tick().catch(() => { }), 30 * 1000);
      this._started = true;
      this._lastErrorCode = null;
    } catch (error) {
      if (this._timer) clearInterval(this._timer);
      this._timer = null;
      this._started = false;
      this._lastErrorCode = 'scheduler_initialization_failed';
      throw error;
    }
  }

  getReadiness() {
    return {
      started: this._started,
      last_recovery_at: this._lastRecoveryAt,
      last_error_code: this._lastErrorCode
    };
  }

  getScheduledExecutionStats() {
    return { ...this._scheduledExecutionStats };
  }

  normalizeProjectMonitoring(project) {
    const rawTime = String(project?.monitoring_time || '09:00').trim();
    const match = rawTime.match(/^(\d{1,2}):(\d{1,2})$/);
    const hh = match ? Math.max(0, Math.min(23, Number(match[1]))) : 9;
    const mm = match ? Math.max(0, Math.min(59, Number(match[2]))) : 0;
    const platformList = Array.isArray(project?.platforms) ? project.platforms : [];
    const platforms = Array.from(new Set(platformList
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean)));
    return {
      monitoring_enabled: project?.monitoring_enabled === true || project?.monitoring_enabled === 'true',
      monitoring_time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
      platforms
    };
  }

  nextProjectRunAt(monitoringTime) {
    return computeNextRun(monitoringTime);
  }

  async finalizeScheduledProjectRecord(options) {
    return finalizeScheduledProjectRecord(options);
  }

  async validateScheduleProject(schedule, repositories = {}) {
    return validateScheduleProject(schedule, repositories);
  }

  async submitDetectionForSchedule(schedule, options = {}) {
    return submitDetectionForSchedule(schedule, options);
  }

  normalizeSchedulePlatforms(platforms, project = null) {
    return normalizeSchedulePlatforms(platforms, project);
  }

  async stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this._started = false;
  }

  async dispatchPendingQuestionSetRuns() {
    return ProjectRunService.dispatchPendingQuestionSetRuns();
  }

  async refresh(scheduleId) {
    const where = scheduleId ? { id: scheduleId } : {};
    const rows = await DetectionSchedule.findAll({ where });
    for (const row of rows) {
      if (scheduleId || !row.next_run_at) {
        const next = computeNextRun(row.daily_time, row.timezone);
        await row.update({ next_run_at: next });
      }
    }
    if (!scheduleId) {
      const projects = await BrandProject.findAll({ where: { monitoring_enabled: true, status: 'active' } });
      for (const project of projects) {
        const projectData = project.toJSON();
        const normalized = this.normalizeProjectMonitoring(projectData);
        const updatePayload = {};
        if (projectData.monitoring_time !== normalized.monitoring_time) {
          updatePayload.monitoring_time = normalized.monitoring_time;
        }
        if (!projectData.monitoring_next_run_at) {
          updatePayload.monitoring_next_run_at = computeNextRun(normalized.monitoring_time);
        }
        if (Object.keys(updatePayload).length > 0) {
          await project.update(updatePayload);
        }
      }
    }
  }

  async claimScheduledOccurrence(input, options = {}) {
    const scheduleKind = String(input?.scheduleKind || '');
    const scheduleConfig = {
      detection_schedule: {
        repository: options.DetectionSchedule || DetectionSchedule,
        nextRunField: 'next_run_at'
      },
      project_monitoring: {
        repository: options.BrandProject || BrandProject,
        nextRunField: 'monitoring_next_run_at'
      }
    }[scheduleKind];
    if (!scheduleConfig) throw new Error(`不支持的调度类型: ${scheduleKind}`);

    const dueAt = new Date(input.dueAt);
    const nextRunAt = new Date(input.nextRunAt);
    if (Number.isNaN(dueAt.getTime()) || Number.isNaN(nextRunAt.getTime())) {
      throw new Error('调度时槽时间无效');
    }

    const Database = options.sequelize || sequelize;
    const ExecutionRepository = options.ScheduledExecution || ScheduledExecution;
    const now = options.now ? new Date(options.now) : new Date();
    const leaseMs = Number(options.leaseMs) > 0 ? Number(options.leaseMs) : 20 * 60 * 1000;
    const executionToken = options.executionToken || randomUUID();
    const leaseOwner = options.ownerId || this._ownerId;
    const transactionOptions = Database.getDialect() === 'sqlite'
      ? { type: Transaction.TYPES.IMMEDIATE }
      : {};

    try {
      const execution = await Database.transaction(transactionOptions, async (transaction) => {
        const row = await ExecutionRepository.create({
          schedule_kind: scheduleKind,
          schedule_id: input.scheduleId,
          project_id: input.projectId || null,
          due_at: dueAt,
          status: 'claimed',
          execution_token: executionToken,
          lease_owner: leaseOwner,
          lease_expires_at: new Date(now.getTime() + leaseMs),
          attempt: 1
        }, { transaction });
        const [advanced] = await scheduleConfig.repository.update(
          { [scheduleConfig.nextRunField]: nextRunAt },
          {
            where: {
              id: input.scheduleId,
              [scheduleConfig.nextRunField]: dueAt
            },
            transaction
          }
        );
        if (advanced !== 1) {
          const error = new Error('调度时槽已不再到期');
          error.code = 'SCHEDULE_SLOT_NOT_DUE';
          throw error;
        }
        return row;
      });
      this._scheduledExecutionStats.claimed += 1;
      this._scheduledExecutionStats.last_claimed_at = now.toISOString();
      return { claimed: true, execution };
    } catch (error) {
      const uniqueConflict = error?.name === 'SequelizeUniqueConstraintError'
        || error?.original?.code === '23505'
        || (
          error?.original?.code === 'SQLITE_CONSTRAINT'
          && /unique/i.test(String(error?.original?.message || error?.message || ''))
        );
      if (uniqueConflict || error?.code === 'SCHEDULE_SLOT_NOT_DUE') {
        if (uniqueConflict) this._scheduledExecutionStats.duplicate_claims += 1;
        else this._scheduledExecutionStats.stale_claims += 1;
        return {
          claimed: false,
          reason: uniqueConflict ? 'already_claimed' : 'slot_not_due'
        };
      }
      this._scheduledExecutionStats.last_error_code = 'scheduled_execution_claim_failed';
      throw error;
    }
  }

  async startScheduledExecution(execution, options = {}) {
    const ExecutionRepository = options.ScheduledExecution || ScheduledExecution;
    const now = options.now ? new Date(options.now) : new Date();
    const [updated] = await ExecutionRepository.update(
      {
        status: 'running',
        started_at: now
      },
      {
        where: {
          id: execution.id,
          execution_token: execution.execution_token,
          status: 'claimed'
        }
      }
    );
    return updated === 1;
  }

  async finalizeScheduledExecution(execution, outcome, options = {}) {
    const ExecutionRepository = options.ScheduledExecution || ScheduledExecution;
    const now = options.now ? new Date(options.now) : new Date();
    const status = outcome?.status === 'completed' ? 'completed' : 'failed';
    const [updated] = await ExecutionRepository.update(
      {
        status,
        error_code: status === 'failed'
          ? String(outcome?.errorCode || 'scheduled_execution_failed').slice(0, 80)
          : null,
        error_message: status === 'failed'
          ? String(outcome?.errorMessage || '调度执行失败').slice(0, 500)
          : null,
        completed_at: now
      },
      {
        where: {
          id: execution.id,
          execution_token: execution.execution_token,
          status: 'running'
        }
      }
    );
    if (updated === 1) {
      this._scheduledExecutionStats[status] += 1;
      this._scheduledExecutionStats.last_error_code = status === 'failed'
        ? String(outcome?.errorCode || 'scheduled_execution_failed').slice(0, 80)
        : null;
    }
    return updated === 1;
  }

  async recoverStaleScheduledExecutions(options = {}) {
    const ExecutionRepository = options.ScheduledExecution || ScheduledExecution;
    const now = options.now ? new Date(options.now) : new Date();
    const [recovered] = await ExecutionRepository.update(
      {
        status: 'failed',
        error_code: 'scheduled_execution_interrupted',
        error_message: '调度执行中断，未自动重复外部调用',
        completed_at: now
      },
      {
        where: {
          status: { [Op.in]: ['claimed', 'running'] },
          lease_expires_at: { [Op.lt]: now }
        }
      }
    );
    if (recovered > 0) {
      this._scheduledExecutionStats.failed += recovered;
      this._scheduledExecutionStats.last_error_code = 'scheduled_execution_interrupted';
      console.warn(`已收敛 ${recovered} 个过期调度执行时槽`);
    }
    return recovered;
  }

  tick() {
    if (this._tickPromise) return this._tickPromise;
    const tickPromise = this._runTick().finally(() => {
      if (this._tickPromise === tickPromise) this._tickPromise = null;
    });
    this._tickPromise = tickPromise;
    return tickPromise;
  }

  async _runTick() {
    const now = new Date();
    await this.dispatchPendingQuestionSetRuns();
    await this.recoverStalePendingRecords({ now });
    await this.recoverStaleScheduledExecutions({ now });
    const due = await DetectionSchedule.findAll({
      where: {
        enabled: true,
        next_run_at: { [Op.lte]: now }
      }
    });
    for (const s of due) {
      let execution = null;
      try {
        const dueAt = new Date(s.next_run_at);
        const next = computeNextRun(s.daily_time, s.timezone);
        const claim = await this.claimScheduledOccurrence({
          scheduleKind: 'detection_schedule',
          scheduleId: s.id,
          projectId: s.project_id,
          dueAt,
          nextRunAt: next
        });
        if (!claim.claimed) continue;
        execution = claim.execution;
        if (!await this.startScheduledExecution(execution)) continue;

        const result = await this.submitDetectionForSchedule(s, {
          scheduledExecutionId: execution.id
        });
        if (!result?.skipped) {
          await s.update({ last_run_at: now });
        }
        await this.finalizeScheduledExecution(execution, result?.ok
          ? { status: 'completed' }
          : {
              status: 'failed',
              errorCode: result?.reason || 'scheduled_execution_failed',
              errorMessage: '定时监测执行失败'
            });
      } catch (e) {
        if (execution) {
          await this.finalizeScheduledExecution(execution, {
            status: 'failed',
            errorCode: 'scheduled_execution_exception',
            errorMessage: '定时监测执行异常'
          }).catch(() => {});
        }
        console.warn('执行定时任务失败:', e?.message || e);
      }
    }
    const dueProjects = await BrandProject.findAll({
      where: {
        status: 'active',
        monitoring_enabled: true,
        monitoring_next_run_at: { [Op.lte]: now }
      }
    });
    for (const project of dueProjects) {
      let execution = null;
      try {
        const dueAt = new Date(project.monitoring_next_run_at);
        const nextRunAt = computeNextRun(project.monitoring_time);
        const claim = await this.claimScheduledOccurrence({
          scheduleKind: 'project_monitoring',
          scheduleId: project.id,
          projectId: project.id,
          dueAt,
          nextRunAt
        });
        if (!claim.claimed) continue;
        execution = claim.execution;
        if (!await this.startScheduledExecution(execution)) continue;

        const ok = await this.runProjectNow(project.id, {
          advanceSchedule: false,
          scheduledExecutionId: execution.id
        });
        await this.finalizeScheduledExecution(execution, ok
          ? { status: 'completed' }
          : {
              status: 'failed',
              errorCode: 'project_monitoring_failed',
              errorMessage: '项目自动监测执行失败'
            });
      } catch (e) {
        if (execution) {
          await this.finalizeScheduledExecution(execution, {
            status: 'failed',
            errorCode: 'project_monitoring_exception',
            errorMessage: '项目自动监测执行异常'
          }).catch(() => {});
        }
        console.warn('执行项目自动监测失败:', e?.message || e);
      }
    }
  }

  async runProjectNow(projectId, options = {}) {
    const project = await BrandProject.findByPk(projectId);
    if (!project || !project.monitoring_enabled) return false;
    const normalized = this.normalizeProjectMonitoring(project.toJSON());
    const [prompts, user] = await Promise.all([
      TrackedPrompt.findAll({ where: { project_id: project.id, enabled: true }, order: [['updated_at', 'DESC']] }),
      User.findByPk(project.user_id)
    ]);
    if (!user) return false;
    const result = await ProjectRunService.runProject({
      project,
      prompts: prompts.map((item) => item.toJSON()),
      platforms: normalized.platforms,
      user,
      scheduledExecutionId: options.scheduledExecutionId || null
    });
    if (!result?.ok) {
      if (options.advanceSchedule !== false) {
        await project.update({
          monitoring_time: normalized.monitoring_time,
          monitoring_next_run_at: computeNextRun(normalized.monitoring_time)
        });
      }
      return false;
    }
    const updatePayload = {
      monitoring_time: normalized.monitoring_time,
      monitoring_last_run_at: new Date()
    };
    if (options.advanceSchedule !== false) {
      updatePayload.monitoring_next_run_at = computeNextRun(normalized.monitoring_time);
    }
    await project.update(updatePayload);
    return true;
  }

  async recoverStalePendingRecords(options = {}) {
    const maxAgeMs = Number(options.maxAgeMs || 0) > 0
      ? Number(options.maxAgeMs)
      : 15 * 60 * 1000;
    const now = options.now ? new Date(options.now) : new Date();
    const cutoff = new Date(now.getTime() - maxAgeMs);
    const RecordRepository = options.QuestionRecord || QuestionRecord;
    const staleTimeField = options.includeUnclaimed === true
      ? 'created_at'
      : 'execution_started_at';
    const where = {
      status: 'pending',
      [staleTimeField]: { [Op.lt]: cutoff }
    };
    if (options.includeUnclaimed === true) {
      where.question_set_run_id = null;
    }
    const staleRecords = await RecordRepository.findAll({ where });
    await Promise.all(staleRecords.map((record) => record.update({
      status: 'failed',
      error_message: '分析任务中断，请重新运行',
      execution_token: null,
      execution_started_at: null,
      result_summary: {
        ...(record.result_summary && typeof record.result_summary === 'object'
          ? record.result_summary
          : {}),
        failure: {
          stage: 'execution_interrupted',
          error_code: 'stale_pending_recovered'
        }
      }
    })));
    const count = staleRecords.length;
    const BatchRepository = options.QuestionSetRetryBatch || QuestionSetRetryBatch;
    await BatchRepository.update(
      { status: 'failed' },
      {
        where: {
          status: {
            [Op.in]: options.includeUnclaimed === true
              ? ['queued', 'running']
              : ['running']
          },
          updated_at: { [Op.lt]: cutoff }
        }
      }
    );
    if (count > 0) console.warn(`已恢复 ${count} 条超时未完成分析记录`);
    this._lastRecoveryAt = now.toISOString();
    return count;
  }

  async runNow(scheduleId) {
    const result = await this.runNowWithResult(scheduleId);
    return Boolean(result?.ok);
  }

  async runNowWithResult(scheduleId) {
    const s = await DetectionSchedule.findByPk(scheduleId);
    if (!s) return { ok: false, status: 404, message: '任务不存在' };
    try {
      const now = new Date();
      const guard = await this.validateScheduleProject(s);
      if (!guard.ok) return { ok: false, status: 400, message: guard.reason };
      const result = await submitDetectionForSchedule(s, { projectValidated: true, project: guard.project });
      if (!result?.ok) {
        const skippedMessage = (result?.skipped_platforms || []).map((item) => item.message).filter(Boolean).join('；');
        const reasonMessages = {
          all_platforms_unavailable: skippedMessage ? `${skippedMessage}，无法运行。` : '监测平台配置暂不可用，请联系管理员。',
          platform_config_unavailable: '监测平台配置暂不可用，请联系管理员。',
          quota_unavailable: '今日可用检测次数不足',
          quota_check_failed: '配额检查失败'
        };
        return {
          ...result,
          status: result?.reason === 'quota_unavailable' ? 403 : 400,
          message: reasonMessages[result?.reason] || '定时任务执行失败'
        };
      }
      const next = computeNextRun(s.daily_time, s.timezone);
      await s.update({ last_run_at: now, next_run_at: next });
      return {
        ...result,
        status: 200,
        message: result.skipped_platforms?.length
          ? `定时任务已完成；${result.skipped_platforms.map((item) => item.message).join('；')}，已跳过。`
          : '定时任务已执行'
      };
    } catch (e) {
      console.warn('手动执行定时任务失败:', e?.message || e);
      return { ok: false, status: 500, message: '手动执行定时任务失败' };
    }
  }
}

const schedulerService = new SchedulerService();
schedulerService.SchedulerService = SchedulerService;

module.exports = schedulerService;
