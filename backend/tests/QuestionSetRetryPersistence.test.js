const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-retry-persistence-'));
process.env.DB_STORAGE = path.join(databaseDir, 'test.sqlite');
delete process.env.DATABASE_URL;

const {
  sequelize,
  User,
  BrandProject,
  TrackedPrompt,
  QuestionRecord,
  QuestionSetRun,
  QuestionSetRetryBatch,
  ResultDetail,
  UsageCounter
} = require('../models');
const AIPlatformService = require('../services/AIPlatformService');
const ProjectRunService = require('../services/ProjectRunService');

let user;
let project;
let prompt;

async function createRetryState({
  executionMode = 'analysis_only',
  paused = false,
  withDetail = true,
  idempotencyKey
}) {
  const run = await QuestionSetRun.create({
    project_id: project.id,
    user_id: user.id,
    question_set_id: 91,
    question_set_name: '持久化重试上下文',
    source: 'native',
    planned_record_count: 1,
    competitor_snapshot: [{ id: 8, name: '竞品甲', aliases: [] }],
    revision: 1,
    paused_at: paused ? new Date('2026-07-26T08:00:00.000Z') : null
  });
  const batch = await QuestionSetRetryBatch.create({
    question_set_run_id: run.id,
    project_id: project.id,
    user_id: user.id,
    idempotency_key: idempotencyKey,
    status: 'queued',
    record_ids: []
  });
  const record = await QuestionRecord.create({
    user_id: user.id,
    project_id: project.id,
    tracked_prompt_id: prompt.id,
    question_set_run_id: run.id,
    run_slot_index: 0,
    execution_mode: executionMode,
    retry_batch_id: batch.id,
    platform: 'deepseek',
    platform_name: 'DeepSeek',
    model_name: 'deepseek-chat',
    question: prompt.question,
    brand: project.name,
    brand_keywords: project.name,
    status: 'pending',
    result_summary: {
      retry: {
        previous_record_id: 700,
        attempt: 1,
        kind: executionMode
      }
    }
  });
  if (withDetail) {
    await ResultDetail.create({
      question_record_id: record.id,
      ai_response_original: '上海广拓与竞品甲都可作为候选。',
      provider_citations: [{
        url: 'https://example.com/provider-source',
        title: '供应商检索来源',
        source_origin: 'web_search'
      }],
      parsing_status: 'completed'
    });
  }
  await batch.update({ record_ids: [record.id] });
  return { run, batch, record };
}

async function captureScheduledContext(work) {
  const originalSchedule = ProjectRunService.schedulePreparedRun;
  let context = null;
  ProjectRunService.schedulePreparedRun = (value) => {
    context = value;
  };
  try {
    const result = await work();
    assert.ok(context, '应生成可调度的持久化执行上下文');
    return { context, result };
  } finally {
    ProjectRunService.schedulePreparedRun = originalSchedule;
  }
}

async function executeWithSuccessfulMetric(context, expectedMode) {
  const originalQueryPlatform = AIPlatformService.queryPlatform;
  const originalFinalize = ProjectRunService.finalizeSuccessfulRecord;
  const originalEvaluateAlerts = ProjectRunService.evaluateAlertsAfterRun;
  let platformCalls = 0;
  let finalized = null;
  AIPlatformService.queryPlatform = async () => {
    platformCalls += 1;
    return {
      success: true,
      data: {
        choices: [{ message: { content: '重新调用监测平台得到的回答。' } }]
      }
    };
  };
  ProjectRunService.finalizeSuccessfulRecord = async (payload) => {
    finalized = payload;
    await QuestionRecord.update({
      status: 'completed',
      error_message: null,
      execution_token: null,
      execution_started_at: null,
      lease_owner: null,
      lease_expires_at: null
    }, {
      where: {
        id: payload.record.id,
        execution_token: payload.executionToken
      }
    });
    return {
      ok: true,
      status: 'completed',
      metric: {
        sentiment: 'neutral',
        share_of_voice: 50,
        brand_mentioned: true,
        citation_count: 1,
        brand_rank: 1,
        brand_recommended: false
      }
    };
  };
  ProjectRunService.evaluateAlertsAfterRun = async () => ({ ok: true });
  try {
    await ProjectRunService.executePreparedRun(context);
    assert.equal(context.entries[0].retryMode, expectedMode);
    return { platformCalls, finalized };
  } finally {
    AIPlatformService.queryPlatform = originalQueryPlatform;
    ProjectRunService.finalizeSuccessfulRecord = originalFinalize;
    ProjectRunService.evaluateAlertsAfterRun = originalEvaluateAlerts;
  }
}

test.before(async () => {
  await sequelize.sync({ force: true });
  user = await User.create({
    username: 'retry-persistence-user',
    email: 'retry-persistence@example.com',
    password: 'not-used',
    role: 'user',
    status: 'active'
  });
  project = await BrandProject.create({
    user_id: user.id,
    name: '重试持久化项目',
    aliases: [],
    primary_keywords: [],
    platforms: ['deepseek'],
    status: 'active'
  });
  prompt = await TrackedPrompt.create({
    project_id: project.id,
    user_id: user.id,
    question: '周界报警厂商怎么选？',
    tags: [],
    platforms: ['deepseek'],
    enabled: true
  });
  await UsageCounter.create({
    user_id: user.id,
    feature: 'detection',
    period: 'daily',
    used_count: 7,
    period_start: new Date()
  });
});

test.after(async () => {
  await sequelize.close();
  fs.rmSync(databaseDir, { recursive: true, force: true });
});

test.beforeEach(async () => {
  await ResultDetail.destroy({ where: {} });
  await QuestionRecord.destroy({ where: {} });
  await QuestionSetRetryBatch.destroy({ where: {} });
  await QuestionSetRun.destroy({ where: {} });
  await UsageCounter.update({ used_count: 7 }, { where: { user_id: user.id } });
});

test('暂停恢复从数据库重建 analysis-only 原回答、引用和批次归属', async () => {
  const { run, batch } = await createRetryState({
    paused: true,
    idempotencyKey: 'resume-analysis-only'
  });

  const { context, result } = await captureScheduledContext(
    () => ProjectRunService.resumeRun(run.id, project.id)
  );

  assert.equal(result.remainingCount, 1);
  assert.equal(context.retryBatchId, batch.id);
  assert.equal(context.entries[0].retryMode, 'analysis_only');
  assert.equal(context.entries[0].responseText, '上海广拓与竞品甲都可作为候选。');
  assert.deepEqual(context.entries[0].providerCitations, [{
    url: 'https://example.com/provider-source',
    title: '供应商检索来源',
    source_origin: 'web_search'
  }]);
});

test('进程重启补发 analysis-only 不调用监测平台、不增加配额且关闭批次', async () => {
  const { batch } = await createRetryState({
    idempotencyKey: 'restart-analysis-only'
  });
  const quotaBefore = await UsageCounter.findOne({
    where: { user_id: user.id, feature: 'detection', period: 'daily' }
  });
  const { context, result: dispatched } = await captureScheduledContext(
    () => ProjectRunService.dispatchPendingQuestionSetRuns()
  );

  assert.equal(dispatched, 1);
  const execution = await executeWithSuccessfulMetric(context, 'analysis_only');

  assert.equal(execution.platformCalls, 0);
  assert.equal(execution.finalized.responseText, '上海广拓与竞品甲都可作为候选。');
  assert.deepEqual(execution.finalized.providerCitations, [{
    url: 'https://example.com/provider-source',
    title: '供应商检索来源',
    source_origin: 'web_search'
  }]);
  const quotaAfter = await UsageCounter.findByPk(quotaBefore.id);
  assert.equal(quotaAfter.used_count, quotaBefore.used_count);
  await batch.reload();
  assert.equal(batch.status, 'completed');
});

test('analysis-only 原回答快照缺失时稳定失败且不退化为监测调用', async () => {
  const { batch, record } = await createRetryState({
    withDetail: false,
    idempotencyKey: 'missing-analysis-context'
  });
  const originalQueryPlatform = AIPlatformService.queryPlatform;
  const originalEvaluateAlerts = ProjectRunService.evaluateAlertsAfterRun;
  let platformCalls = 0;
  AIPlatformService.queryPlatform = async () => {
    platformCalls += 1;
    return { success: true, data: {} };
  };
  ProjectRunService.evaluateAlertsAfterRun = async () => ({ ok: true });
  try {
    const { context } = await captureScheduledContext(
      () => ProjectRunService.dispatchPendingQuestionSetRuns()
    );
    await ProjectRunService.executePreparedRun(context);
  } finally {
    AIPlatformService.queryPlatform = originalQueryPlatform;
    ProjectRunService.evaluateAlertsAfterRun = originalEvaluateAlerts;
  }

  assert.equal(platformCalls, 0);
  await record.reload();
  assert.equal(record.status, 'failed');
  assert.equal(record.result_summary.failure.stage, 'analysis_retry_context');
  assert.equal(record.result_summary.failure.error_code, 'analysis_retry_context_missing');
  await batch.reload();
  assert.equal(batch.status, 'failed');
});

test('full-monitoring 重启补发保持平台调用语义且不重复扣配额', async () => {
  const { batch } = await createRetryState({
    executionMode: 'full_monitoring',
    withDetail: false,
    idempotencyKey: 'restart-full-monitoring'
  });
  const quotaBefore = await UsageCounter.findOne({
    where: { user_id: user.id, feature: 'detection', period: 'daily' }
  });
  const { context } = await captureScheduledContext(
    () => ProjectRunService.dispatchPendingQuestionSetRuns()
  );

  const execution = await executeWithSuccessfulMetric(context, 'full_monitoring');

  assert.equal(execution.platformCalls, 1);
  const quotaAfter = await UsageCounter.findByPk(quotaBefore.id);
  assert.equal(quotaAfter.used_count, quotaBefore.used_count);
  await batch.reload();
  assert.equal(batch.status, 'completed');
});

test('重试调度失败会收敛任务、父运行和批次而不遗留 queued', async () => {
  const previousRecord = await QuestionRecord.create({
    user_id: user.id,
    project_id: project.id,
    tracked_prompt_id: prompt.id,
    platform: 'deepseek',
    platform_name: 'DeepSeek',
    model_name: 'deepseek-chat',
    question: prompt.question,
    brand: project.name,
    brand_keywords: project.name,
    status: 'failed',
    error_message: '结构化分析失败',
    result_summary: {
      failure: {
        stage: 'analysis_validation',
        error_code: 'invalid_analysis_output'
      }
    }
  });
  await ResultDetail.create({
    question_record_id: previousRecord.id,
    ai_response_original: '上海广拓可作为候选。',
    provider_citations: [],
    parsing_status: 'completed'
  });
  const run = await QuestionSetRun.create({
    project_id: project.id,
    user_id: user.id,
    question_set_name: '调度失败收敛',
    source: 'native',
    planned_record_count: 1,
    imported_rows: [{
      record_id: previousRecord.id,
      question: previousRecord.question,
      platform: previousRecord.platform,
      status: 'failed'
    }],
    completed_at: new Date()
  });
  await previousRecord.update({
    question_set_run_id: run.id,
    run_slot_index: 0
  });
  const originalSchedule = ProjectRunService.schedulePreparedRun;
  ProjectRunService.schedulePreparedRun = () => {
    throw new Error('synthetic scheduler failure');
  };
  try {
    await assert.rejects(
      ProjectRunService.retryFailedQuestionSetRun({
        project,
        runId: run.id,
        user,
        idempotencyKey: 'retry-schedule-failure'
      }),
      (error) => error.status === 500
    );
  } finally {
    ProjectRunService.schedulePreparedRun = originalSchedule;
  }

  const batch = await QuestionSetRetryBatch.findOne({
    where: {
      question_set_run_id: run.id,
      idempotency_key: 'retry-schedule-failure'
    }
  });
  const currentRecord = await QuestionRecord.findOne({
    where: {
      question_set_run_id: run.id,
      run_slot_index: 0
    }
  });
  await run.reload();
  assert.equal(batch.status, 'failed');
  assert.equal(currentRecord.status, 'failed');
  assert.equal(currentRecord.result_summary.failure.stage, 'retry_dispatch');
  assert.equal(currentRecord.result_summary.failure.error_code, 'retry_dispatch_failed');
  assert.ok(run.completed_at);
  assert.equal(run.imported_rows[0].status, 'failed');
});
