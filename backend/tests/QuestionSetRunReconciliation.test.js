const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-run-reconciliation-'));
process.env.DB_STORAGE = path.join(databaseDir, 'test.sqlite');
process.env.JWT_SECRET = 'question-set-run-reconciliation-csv-integrity-test-secret';
delete process.env.DATABASE_URL;

const ProjectRunService = require('../services/ProjectRunService');
const QuestionSetRunService = require('../services/QuestionSetRunService');
const SchedulerService = require('../services/SchedulerService');
const {
  sequelize,
  User,
  BrandProject,
  PromptGroup,
  TrackedPrompt,
  QuestionRecord,
  QuestionSetRun,
  QuestionSetRetryBatch,
  ResultDetail,
  VisibilityMetric
} = require('../models');

let user;
let project;
let questionSet;
let prompt;

async function createRun(statuses, overrides = {}) {
  const run = await QuestionSetRun.create({
    project_id: project.id,
    user_id: user.id,
    question_set_id: questionSet.id,
    question_set_name: questionSet.name,
    source: 'native',
    planned_record_count: statuses.length,
    started_at: new Date('2026-07-26T01:00:00.000Z'),
    ...overrides
  });
  const records = [];
  for (const [runSlotIndex, status] of statuses.entries()) {
    records.push(await QuestionRecord.create({
      user_id: user.id,
      project_id: project.id,
      tracked_prompt_id: prompt.id,
      question_set_run_id: run.id,
      run_slot_index: runSlotIndex,
      platform: 'deepseek',
      platform_name: 'DeepSeek',
      model_name: 'deepseek-chat',
      question: `${prompt.question} #${runSlotIndex + 1}`,
      brand: project.name,
      brand_keywords: project.name,
      status,
      error_message: status === 'failed' ? '安全失败说明' : null,
      result_summary: status === 'failed'
        ? {
            failure: {
              stage: 'monitoring_request',
              error_code: 'provider_error'
            }
          }
        : null
    }));
  }
  return { run, records };
}

test.before(async () => {
  await sequelize.sync({ force: true });
  user = await User.create({
    username: 'reconcile-user',
    email: 'reconcile@example.com',
    password: 'not-used',
    role: 'user',
    status: 'active'
  });
  project = await BrandProject.create({
    user_id: user.id,
    name: '收敛测试品牌',
    aliases: [],
    primary_keywords: [],
    platforms: ['deepseek'],
    status: 'active'
  });
  questionSet = await PromptGroup.create({
    project_id: project.id,
    user_id: user.id,
    name: '收敛测试问题集'
  });
  prompt = await TrackedPrompt.create({
    project_id: project.id,
    prompt_group_id: questionSet.id,
    user_id: user.id,
    question: '父运行会正确收敛吗？',
    tags: [],
    platforms: ['deepseek'],
    enabled: true
  });
});

test.beforeEach(async () => {
  await VisibilityMetric.destroy({ where: {} });
  await ResultDetail.destroy({ where: {} });
  await QuestionSetRetryBatch.destroy({ where: {} });
  await QuestionRecord.destroy({ where: {} });
  await QuestionSetRun.destroy({ where: {} });
});

test.after(async () => {
  await sequelize.close();
  fs.rmSync(databaseDir, { recursive: true, force: true });
});

test('pending 任务只派生 running 或 paused，不写终态快照', async () => {
  const { run } = await createRun(['completed', 'pending']);

  const running = await QuestionSetRunService.reconcileNativeRun({
    projectId: project.id,
    runId: run.id,
    expectedRevision: 0
  });
  assert.equal(running.ok, true);
  assert.equal(running.reconciled, false);
  assert.equal(running.status, 'running');

  await run.update({ paused_at: new Date('2026-07-26T01:01:00.000Z') });
  const paused = await QuestionSetRunService.reconcileNativeRun({
    projectId: project.id,
    runId: run.id,
    expectedRevision: 0
  });
  assert.equal(paused.ok, true);
  assert.equal(paused.reconciled, false);
  assert.equal(paused.status, 'paused');

  await run.reload();
  assert.equal(run.completed_at, null);
  assert.deepEqual(run.imported_rows, []);
});

test('全成功、部分失败和全失败都幂等固化当前槽位终态', async () => {
  const cases = [
    { statuses: ['completed', 'completed'], expected: 'completed' },
    { statuses: ['completed', 'failed'], expected: 'partial' },
    { statuses: ['failed', 'failed'], expected: 'failed' }
  ];

  for (const item of cases) {
    await QuestionRecord.destroy({ where: {} });
    await QuestionSetRun.destroy({ where: {} });
    const { run } = await createRun(item.statuses, {
      paused_at: new Date('2026-07-26T01:01:00.000Z')
    });
    const first = await QuestionSetRunService.reconcileNativeRun({
      projectId: project.id,
      runId: run.id,
      expectedRevision: 0,
      now: new Date('2026-07-26T01:02:00.000Z')
    });
    assert.equal(first.ok, true);
    assert.equal(first.reconciled, true);
    assert.equal(first.status, item.expected);

    await run.reload();
    assert.equal(run.completed_at.toISOString(), '2026-07-26T01:02:00.000Z');
    assert.equal(run.paused_at, null);
    assert.deepEqual(run.imported_rows.map((row) => row.status), item.statuses);
    const updatedAt = run.updated_at.toISOString();

    const second = await QuestionSetRunService.reconcileNativeRun({
      projectId: project.id,
      runId: run.id,
      expectedRevision: 0,
      now: new Date('2026-07-26T01:03:00.000Z')
    });
    assert.equal(second.ok, true);
    assert.equal(second.reconciled, false);
    assert.equal(second.reason, 'already_terminal');
    await run.reload();
    assert.equal(run.completed_at.toISOString(), '2026-07-26T01:02:00.000Z');
    assert.equal(run.updated_at.toISOString(), updatedAt);
  }
});

test('无 pending 但槽位缺失时固化可诊断失败而不是永久 running', async () => {
  const { run } = await createRun(['failed'], { planned_record_count: 2 });

  const result = await QuestionSetRunService.reconcileNativeRun({
    projectId: project.id,
    runId: run.id,
    expectedRevision: 0
  });

  assert.equal(result.ok, true);
  assert.equal(result.reconciled, true);
  assert.equal(result.status, 'failed');
  assert.equal(result.integrity_status, 'missing_records');
  await run.reload();
  assert.ok(run.completed_at);
  assert.equal(run.integrity_status, 'missing_records');
  assert.equal(run.integrity_missing_record_count, 1);
  assert.equal(run.integrity_error_code, 'question_set_run_record_count_mismatch');
  assert.equal(run.imported_rows.length, 1);
  const report = await QuestionSetRunService.getReport({
    projectId: project.id,
    runId: run.id
  });
  assert.equal(report.status, 'failed');
});

test('暂停后的最后一个在途任务结束时通过执行器出口自动收敛', async () => {
  const { run } = await createRun(['completed', 'failed'], {
    paused_at: new Date('2026-07-26T01:01:00.000Z')
  });
  const originalRunPreparedTargets = ProjectRunService.runPreparedTargets;
  const originalEvaluateAlerts = ProjectRunService.evaluateAlertsAfterRun;
  ProjectRunService.runPreparedTargets = async () => [
    { status: 'completed' },
    { status: 'failed' }
  ];
  ProjectRunService.evaluateAlertsAfterRun = async () => ({ ok: true });

  try {
    const result = await ProjectRunService.executePreparedRun({
      entries: [],
      targets: [{}, {}],
      projectData: project.toJSON(),
      runUser: user.toJSON(),
      questionSetRunId: run.id,
      runRevision: 0
    });
    assert.equal(result.reconciliation.status, 'partial');
    await run.reload();
    assert.ok(run.completed_at);
    assert.equal(run.paused_at, null);
  } finally {
    ProjectRunService.runPreparedTargets = originalRunPreparedTargets;
    ProjectRunService.evaluateAlertsAfterRun = originalEvaluateAlerts;
  }
});

test('旧 revision 的 executor 不能覆盖新一轮重试快照', async () => {
  const { run } = await createRun(['completed'], { revision: 1 });

  const result = await QuestionSetRunService.reconcileNativeRun({
    projectId: project.id,
    runId: run.id,
    expectedRevision: 0
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'stale_revision');
  await run.reload();
  assert.equal(run.completed_at, null);
  assert.deepEqual(run.imported_rows, []);
  assert.equal(run.revision, 1);
});

test('旧 revision executor 结束时只关闭自己的 retry batch', async () => {
  const { run } = await createRun(['completed'], { revision: 1 });
  const retryBatch = await QuestionSetRetryBatch.create({
    question_set_run_id: run.id,
    project_id: project.id,
    user_id: user.id,
    idempotency_key: 'stale-executor-batch',
    status: 'running',
    record_ids: []
  });
  const originalRunPreparedTargets = ProjectRunService.runPreparedTargets;
  const originalEvaluateAlerts = ProjectRunService.evaluateAlertsAfterRun;
  let alertEvaluations = 0;
  ProjectRunService.runPreparedTargets = async () => [{ status: 'completed' }];
  ProjectRunService.evaluateAlertsAfterRun = async () => {
    alertEvaluations += 1;
    return { ok: true };
  };

  try {
    const result = await ProjectRunService.executePreparedRun({
      entries: [],
      targets: [{}],
      projectData: project.toJSON(),
      runUser: user.toJSON(),
      questionSetRunId: run.id,
      runRevision: 0,
      retryBatchId: retryBatch.id
    });
    assert.equal(result.reconciliation.reason, 'stale_revision');
    await retryBatch.reload();
    await run.reload();
    assert.equal(retryBatch.status, 'completed');
    assert.equal(run.completed_at, null);
    assert.deepEqual(run.imported_rows, []);
    assert.equal(run.revision, 1);
    assert.equal(alertEvaluations, 0);
  } finally {
    ProjectRunService.runPreparedTargets = originalRunPreparedTargets;
    ProjectRunService.evaluateAlertsAfterRun = originalEvaluateAlerts;
  }
});

test('recovery 回收过期子任务后立即收敛受影响父运行', async () => {
  const { run, records } = await createRun(['completed', 'pending']);
  await records[1].update({
    execution_token: 'expired-token',
    execution_started_at: new Date('2026-07-26T00:00:00.000Z'),
    lease_owner: 'dead-worker',
    lease_expires_at: new Date('2026-07-26T00:01:00.000Z')
  });

  const recovered = await SchedulerService.recoverStalePendingRecords({
    now: new Date('2026-07-26T01:30:00.000Z')
  });

  assert.equal(recovered, 1);
  await records[1].reload();
  await run.reload();
  assert.equal(records[1].status, 'failed');
  assert.equal(records[1].result_summary.failure.error_code, 'stale_pending_recovered');
  assert.ok(run.completed_at);
  assert.equal(run.paused_at, null);
  assert.deepEqual(run.imported_rows.map((row) => row.status), ['completed', 'failed']);
  const report = await QuestionSetRunService.getReport({
    projectId: project.id,
    runId: run.id
  });
  assert.equal(report.status, 'partial');
});

test('recovery 暴露 reconcile 失败并在下一轮成功重试', async () => {
  const { run } = await createRun(['completed']);
  const originalReconcile = QuestionSetRunService.reconcileNativeRun;
  let attempts = 0;
  QuestionSetRunService.reconcileNativeRun = async (...args) => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error('temporary snapshot failure');
      error.code = 'temporary_snapshot_failure';
      throw error;
    }
    return originalReconcile.apply(QuestionSetRunService, args);
  };

  try {
    await assert.rejects(
      SchedulerService.recoverStalePendingRecords({
        now: new Date('2026-07-26T01:30:00.000Z')
      }),
      /存在未能收敛的问题集父运行/
    );
    assert.equal(
      SchedulerService.getReadiness().last_error_code,
      'question_set_run_reconcile_failed'
    );
    await run.reload();
    assert.equal(run.completed_at, null);

    await SchedulerService.recoverStalePendingRecords({
      now: new Date('2026-07-26T01:31:00.000Z')
    });
    await run.reload();
    assert.ok(run.completed_at);
    assert.equal(SchedulerService.getReadiness().last_error_code, null);
    assert.equal(attempts, 2);
  } finally {
    QuestionSetRunService.reconcileNativeRun = originalReconcile;
  }
});

test('recovery 不会把非 revision 类 reconcile 拒绝当成成功', async () => {
  const fakeRecord = {
    project_id: project.id,
    question_set_run_id: 998,
    status: 'pending',
    result_summary: null,
    update: async (payload) => {
      fakeRecord.status = payload.status;
    }
  };

  await assert.rejects(
    SchedulerService.recoverStalePendingRecords({
      now: new Date('2026-07-26T01:30:00.000Z'),
      QuestionRecord: {
        findAll: async () => [fakeRecord]
      },
      QuestionSetRetryBatch: {
        update: async () => [0]
      },
      questionSetRunService: {
        reconcileNativeRun: async () => ({
          ok: false,
          reconciled: false,
          reason: 'not_native'
        })
      }
    }),
    /问题集父运行收敛失败/
  );
  assert.equal(fakeRecord.status, 'failed');
  assert.equal(
    SchedulerService.getReadiness().last_error_code,
    'question_set_run_reconcile_failed'
  );
});

test('resume 发现零 pending 时清理暂停并立即固化终态', async () => {
  const { run } = await createRun(['completed', 'failed'], {
    paused_at: new Date('2026-07-26T01:01:00.000Z')
  });

  const result = await ProjectRunService.resumeRun(run.id, project.id);

  assert.deepEqual(result, {
    ok: true,
    runId: run.id,
    run_id: run.id,
    resumed: true,
    remainingCount: 0,
    control_state: 'terminal',
    idempotent_replay: false
  });
  await run.reload();
  assert.ok(run.completed_at);
  assert.equal(run.paused_at, null);
  assert.deepEqual(run.imported_rows.map((row) => row.status), ['completed', 'failed']);
});

test('并发 resume 只有一个请求取得恢复权并调度一次', async () => {
  const { run } = await createRun(['pending'], {
    paused_at: new Date('2026-07-26T01:01:00.000Z')
  });
  const originalBuildContext = ProjectRunService.buildPersistedQuestionSetRunContext;
  const originalSchedule = ProjectRunService.schedulePreparedRun;
  let scheduled = 0;
  ProjectRunService.buildPersistedQuestionSetRunContext = async () => ({
    entries: [{}]
  });
  ProjectRunService.schedulePreparedRun = () => {
    scheduled += 1;
  };

  try {
    const results = await Promise.all([
      ProjectRunService.resumeRun(run.id, project.id),
      ProjectRunService.resumeRun(run.id, project.id)
    ]);
    assert.equal(scheduled, 1);
    assert.deepEqual(
      results.map((result) => result.idempotent_replay).sort(),
      [false, true]
    );
    assert.ok(results.every((result) => result.control_state === 'running'));
  } finally {
    ProjectRunService.buildPersistedQuestionSetRunContext = originalBuildContext;
    ProjectRunService.schedulePreparedRun = originalSchedule;
  }
});

test('重复 pause 返回幂等成功且不改写首次暂停时间', async () => {
  const { run } = await createRun(['pending']);
  const first = await ProjectRunService.pauseRun(run.id, project.id);
  await run.reload();
  const firstPausedAt = run.paused_at.toISOString();
  const second = await ProjectRunService.pauseRun(run.id, project.id);
  await run.reload();

  assert.equal(first.idempotent_replay, false);
  assert.equal(second.idempotent_replay, true);
  assert.equal(first.control_state, 'paused');
  assert.equal(second.control_state, 'paused');
  assert.equal(run.paused_at.toISOString(), firstPausedAt);
});

test('报告读取、历史列表和导出不触发父运行写入', async () => {
  const { run } = await createRun(['completed']);
  await QuestionSetRunService.reconcileNativeRun({
    projectId: project.id,
    runId: run.id,
    expectedRevision: 0
  });
  let writes = 0;
  QuestionSetRun.addHook('beforeUpdate', 'reconcile-read-only-guard', () => {
    writes += 1;
  });

  try {
    await QuestionSetRunService.getReport({ projectId: project.id, runId: run.id });
    await QuestionSetRunService.listReports({ projectId: project.id });
    await QuestionSetRunService.exportCsv({ projectId: project.id, runId: run.id });
    assert.equal(writes, 0);
  } finally {
    QuestionSetRun.removeHook('beforeUpdate', 'reconcile-read-only-guard');
  }
});

test('reconcile 持久化失败会向执行器冒泡而不是静默完成', async () => {
  const originalRunPreparedTargets = ProjectRunService.runPreparedTargets;
  const originalReconcile = QuestionSetRunService.reconcileNativeRun;
  ProjectRunService.runPreparedTargets = async () => [];
  QuestionSetRunService.reconcileNativeRun = async () => {
    throw new Error('snapshot write failed');
  };

  try {
    await assert.rejects(
      ProjectRunService.executePreparedRun({
        entries: [],
        targets: [],
        projectData: project.toJSON(),
        runUser: user.toJSON(),
        questionSetRunId: 999,
        runRevision: 0
      }),
      /snapshot write failed/
    );
  } finally {
    ProjectRunService.runPreparedTargets = originalRunPreparedTargets;
    QuestionSetRunService.reconcileNativeRun = originalReconcile;
  }
});
