const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-scheduled-execution-'));
process.env.DB_STORAGE = path.join(databaseDir, 'test.sqlite');
delete process.env.DATABASE_URL;

const {
  sequelize,
  BrandProject,
  DetectionSchedule,
  QuestionRecord,
  QuestionSetRun,
  ScheduledExecution,
  TrackedPrompt,
  UsageCounter,
  User
} = require('../models');
const schedulerModule = require('../services/SchedulerService');

let user;
let project;

test.before(async () => {
  await sequelize.sync({ force: true });
  user = await User.create({
    username: 'scheduled-execution-user',
    email: 'scheduled-execution@example.com',
    password: 'not-used',
    membership_level: 'free',
    role: 'user',
    status: 'active'
  });
  project = await BrandProject.create({
    user_id: user.id,
    name: '调度防重测试项目',
    platforms: ['deepseek'],
    monitoring_enabled: true,
    monitoring_time: '09:00',
    status: 'active'
  });
});

test.after(async () => {
  await sequelize.close();
  fs.rmSync(databaseDir, { recursive: true, force: true });
});

test.beforeEach(async () => {
  await QuestionRecord.destroy({ where: {} });
  await UsageCounter.destroy({ where: {} });
  await ScheduledExecution.destroy({ where: {} });
  await DetectionSchedule.destroy({ where: {} });
});

test('two scheduler instances claim a due SQLite schedule slot only once', async () => {
  const dueAt = new Date('2026-07-26T01:00:00.000Z');
  const nextRunAt = new Date('2026-07-27T01:00:00.000Z');
  const schedule = await DetectionSchedule.create({
    user_id: user.id,
    project_id: project.id,
    question: '品牌在 AI 搜索中的表现如何？',
    platforms: ['deepseek'],
    daily_time: '09:00',
    timezone: 'Asia/Shanghai',
    next_run_at: dueAt
  });
  const firstService = new schedulerModule.SchedulerService({ ownerId: 'sqlite-worker-a' });
  const secondService = new schedulerModule.SchedulerService({ ownerId: 'sqlite-worker-b' });

  const results = await Promise.all([
    firstService.claimScheduledOccurrence({
      scheduleKind: 'detection_schedule',
      scheduleId: schedule.id,
      projectId: project.id,
      dueAt,
      nextRunAt
    }),
    secondService.claimScheduledOccurrence({
      scheduleKind: 'detection_schedule',
      scheduleId: schedule.id,
      projectId: project.id,
      dueAt,
      nextRunAt
    })
  ]);

  assert.equal(results.filter((result) => result.claimed).length, 1);
  assert.equal(results.filter((result) => result.reason === 'already_claimed').length, 1);
  assert.equal(await ScheduledExecution.count(), 1);
  await schedule.reload();
  assert.equal(schedule.next_run_at.toISOString(), nextRunAt.toISOString());
  assert.equal(
    firstService.getScheduledExecutionStats().duplicate_claims
      + secondService.getScheduledExecutionStats().duplicate_claims,
    1
  );
});

test('slot ledger creation rolls back when the schedule due time no longer matches', async () => {
  const persistedDueAt = new Date('2026-07-26T01:00:00.000Z');
  const staleDueAt = new Date('2026-07-25T01:00:00.000Z');
  const schedule = await DetectionSchedule.create({
    user_id: user.id,
    project_id: project.id,
    question: '过期扫描结果能否误领？',
    platforms: ['deepseek'],
    daily_time: '09:00',
    timezone: 'Asia/Shanghai',
    next_run_at: persistedDueAt
  });
  const service = new schedulerModule.SchedulerService({ ownerId: 'stale-scanner' });

  const result = await service.claimScheduledOccurrence({
    scheduleKind: 'detection_schedule',
    scheduleId: schedule.id,
    projectId: project.id,
    dueAt: staleDueAt,
    nextRunAt: new Date('2026-07-27T01:00:00.000Z')
  });

  assert.deepEqual(result, { claimed: false, reason: 'slot_not_due' });
  assert.equal(service.getScheduledExecutionStats().duplicate_claims, 0);
  assert.equal(service.getScheduledExecutionStats().stale_claims, 1);
  assert.equal(await ScheduledExecution.count(), 0);
  await schedule.reload();
  assert.equal(schedule.next_run_at.toISOString(), persistedDueAt.toISOString());
});

test('two scheduler processes execute the same long-running slot side effects only once', async () => {
  const dueAt = new Date(Date.now() - 60 * 1000);
  const schedule = await DetectionSchedule.create({
    user_id: user.id,
    project_id: project.id,
    question: '长任务是否会重复执行？',
    platforms: ['deepseek'],
    daily_time: '09:00',
    timezone: 'Asia/Shanghai',
    next_run_at: dueAt
  });
  const firstService = new schedulerModule.SchedulerService({ ownerId: 'process-a' });
  const secondService = new schedulerModule.SchedulerService({ ownerId: 'process-b' });
  let platformCalls = 0;
  let releasePlatformCall;
  const platformCallGate = new Promise((resolve) => {
    releasePlatformCall = resolve;
  });
  const submit = async (claimedSchedule, { scheduledExecutionId }) => {
    platformCalls += 1;
    await UsageCounter.create({
      user_id: user.id,
      feature: 'detection',
      period: 'daily',
      used_count: 1,
      period_start: dueAt
    });
    await QuestionRecord.create({
      user_id: user.id,
      project_id: project.id,
      scheduled_execution_id: scheduledExecutionId,
      platform: 'deepseek',
      platform_name: 'DeepSeek',
      model_name: 'deepseek-chat',
      brand: project.name,
      question: claimedSchedule.question,
      brand_keywords: project.name,
      status: 'completed'
    });
    await platformCallGate;
    return { ok: true, attempted: 1, completed: 1, failed: 0 };
  };
  for (const service of [firstService, secondService]) {
    service.dispatchPendingQuestionSetRuns = async () => 0;
    service.recoverStalePendingRecords = async () => 0;
    service.recoverStaleScheduledExecutions = async () => 0;
    service.submitDetectionForSchedule = submit;
  }

  const firstTick = firstService.tick();
  const competingTick = secondService.tick();
  let overlapTick = null;
  try {
    const deadline = Date.now() + 2000;
    while (platformCalls === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.equal(platformCalls, 1);
    overlapTick = secondService.tick();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(platformCalls, 1);
  } finally {
    releasePlatformCall();
  }
  await Promise.all([firstTick, competingTick, overlapTick].filter(Boolean));
  await secondService.tick();

  assert.equal(platformCalls, 1);
  assert.equal(await UsageCounter.sum('used_count'), 1);
  assert.equal(await QuestionRecord.count(), 1);
  assert.equal(await ScheduledExecution.count({
    where: {
      schedule_kind: 'detection_schedule',
      schedule_id: schedule.id,
      due_at: dueAt
    }
  }), 1);
  const execution = await ScheduledExecution.findOne({
    where: {
      schedule_kind: 'detection_schedule',
      schedule_id: schedule.id,
      due_at: dueAt
    }
  });
  assert.equal(execution.status, 'completed');
});

test('stale claimed or running schedule slots recover to a diagnostic terminal state', async () => {
  const now = new Date('2026-07-26T03:00:00.000Z');
  const expired = await ScheduledExecution.create({
    schedule_kind: 'project_monitoring',
    schedule_id: project.id,
    project_id: project.id,
    due_at: new Date('2026-07-26T01:00:00.000Z'),
    status: 'running',
    execution_token: 'expired-token',
    lease_owner: 'crashed-process',
    lease_expires_at: new Date('2026-07-26T02:00:00.000Z'),
    started_at: new Date('2026-07-26T01:00:01.000Z')
  });
  const active = await ScheduledExecution.create({
    schedule_kind: 'project_monitoring',
    schedule_id: project.id,
    project_id: project.id,
    due_at: new Date('2026-07-27T01:00:00.000Z'),
    status: 'running',
    execution_token: 'active-token',
    lease_owner: 'healthy-process',
    lease_expires_at: new Date('2026-07-26T04:00:00.000Z'),
    started_at: new Date('2026-07-26T02:59:00.000Z')
  });
  const service = new schedulerModule.SchedulerService({ ownerId: 'recovery-process' });

  const recovered = await service.recoverStaleScheduledExecutions({ now });

  assert.equal(recovered, 1);
  await expired.reload();
  await active.reload();
  assert.equal(expired.status, 'failed');
  assert.equal(expired.error_code, 'scheduled_execution_interrupted');
  assert.equal(expired.error_message, '调度执行中断，未自动重复外部调用');
  assert.equal(expired.completed_at.toISOString(), now.toISOString());
  assert.equal(active.status, 'running');
});

test('project monitoring uses its own schedule kind without creating a question-set run', async () => {
  const dueAt = new Date(Date.now() - 60 * 1000);
  await project.update({
    monitoring_enabled: true,
    monitoring_next_run_at: dueAt
  });
  const service = new schedulerModule.SchedulerService({ ownerId: 'project-monitoring-process' });
  service.recoverStalePendingRecords = async () => 0;
  service.recoverStaleScheduledExecutions = async () => 0;
  service.runProjectNow = async () => true;

  await service.tick();

  const execution = await ScheduledExecution.findOne({
    where: {
      schedule_kind: 'project_monitoring',
      schedule_id: project.id,
      due_at: dueAt
    }
  });
  assert.ok(execution);
  assert.equal(execution.project_id, project.id);
  assert.equal(execution.status, 'completed');
  assert.equal(await QuestionSetRun.count(), 0);
});

test('project automatic monitoring forwards DeepSeek Web through the existing project runner and schedule slot', async () => {
  const previousPlatforms = project.platforms;
  await project.update({
    platforms: ['deepseek-web'],
    monitoring_enabled: true
  });
  const prompt = await TrackedPrompt.create({
    project_id: project.id,
    user_id: user.id,
    question: 'DeepSeek 网页监测问题',
    platforms: ['deepseek-web'],
    enabled: true
  });
  const service = new schedulerModule.SchedulerService({
    ownerId: 'project-web-monitoring-process'
  });
  const ProjectRunService = require('../services/ProjectRunService');
  const originalRunProject = ProjectRunService.runProject;
  let runOptions = null;
  ProjectRunService.runProject = async (options) => {
    runOptions = options;
    return { ok: true, data: { completed: 1, failed: 0 } };
  };

  try {
    const ok = await service.runProjectNow(project.id, {
      advanceSchedule: false,
      scheduledExecutionId: 712
    });

    assert.equal(ok, true);
    assert.deepEqual(runOptions.platforms, ['deepseek-web']);
    assert.equal(runOptions.scheduledExecutionId, 712);
    assert.deepEqual(runOptions.prompts.map((item) => item.id), [prompt.id]);
  } finally {
    ProjectRunService.runProject = originalRunProject;
    await prompt.destroy();
    await project.update({ platforms: previousPlatforms });
  }
});

for (const dialect of ['sqlite', 'postgres']) {
  test(`${dialect} claim contract treats a unique slot conflict as an owned duplicate`, async () => {
    const dueAt = new Date('2026-07-26T01:00:00.000Z');
    const nextRunAt = new Date('2026-07-27T01:00:00.000Z');
    const slotKeys = new Set();
    let persistedNextRunAt = dueAt.toISOString();
    const transactionOptions = [];
    const database = {
      getDialect: () => dialect,
      transaction: async (options, work) => {
        transactionOptions.push(options);
        return work({ dialect });
      }
    };
    const ExecutionRepository = {
      create: async (payload) => {
        const key = [
          payload.schedule_kind,
          payload.schedule_id,
          payload.due_at.toISOString()
        ].join(':');
        if (slotKeys.has(key)) {
          const error = new Error('duplicate schedule slot');
          error.name = 'SequelizeUniqueConstraintError';
          throw error;
        }
        slotKeys.add(key);
        return { id: 1, ...payload };
      }
    };
    const ScheduleRepository = {
      update: async (payload, options) => {
        if (options.where.next_run_at.toISOString() !== persistedNextRunAt) return [0];
        persistedNextRunAt = payload.next_run_at.toISOString();
        return [1];
      }
    };
    const firstService = new schedulerModule.SchedulerService({ ownerId: `${dialect}-a` });
    const secondService = new schedulerModule.SchedulerService({ ownerId: `${dialect}-b` });
    const input = {
      scheduleKind: 'detection_schedule',
      scheduleId: 19,
      projectId: project.id,
      dueAt,
      nextRunAt
    };
    const dependencies = {
      sequelize: database,
      ScheduledExecution: ExecutionRepository,
      DetectionSchedule: ScheduleRepository
    };

    const results = await Promise.all([
      firstService.claimScheduledOccurrence(input, dependencies),
      secondService.claimScheduledOccurrence(input, dependencies)
    ]);

    assert.equal(results.filter((result) => result.claimed).length, 1);
    assert.equal(results.filter((result) => result.reason === 'already_claimed').length, 1);
    assert.equal(slotKeys.size, 1);
    assert.equal(persistedNextRunAt, nextRunAt.toISOString());
    if (dialect === 'sqlite') {
      assert.equal(transactionOptions[0].type, 'IMMEDIATE');
    } else {
      assert.equal(Object.hasOwn(transactionOptions[0], 'type'), false);
    }
  });
}
