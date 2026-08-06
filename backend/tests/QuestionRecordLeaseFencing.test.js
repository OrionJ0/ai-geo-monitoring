const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-record-lease-fencing-'));
process.env.DB_STORAGE = path.join(databaseDir, 'test.sqlite');
delete process.env.DATABASE_URL;

const ProjectRunService = require('../services/ProjectRunService');
const SchedulerService = require('../services/SchedulerService');
const {
  sequelize,
  User,
  BrandProject,
  PromptGroup,
  TrackedPrompt,
  QuestionRecord,
  ResultDetail,
  VisibilityMetric,
  QuestionSetRun
} = require('../models');

let user;
let project;
let questionSet;
let prompt;
let run;
const originalBuildVisibilityMetricPayload = ProjectRunService.buildVisibilityMetricPayload;

async function createPendingRecord(overrides = {}) {
  return QuestionRecord.create({
    user_id: user.id,
    project_id: project.id,
    tracked_prompt_id: prompt.id,
    question_set_run_id: run.id,
    run_slot_index: 0,
    platform: 'doubao',
    platform_name: '豆包',
    model_name: 'doubao-model',
    question: '执行租约会阻止迟到写入吗？',
    brand: project.name,
    brand_keywords: project.name,
    status: 'pending',
    error_message: '分析任务中断，请重新运行',
    ...overrides
  });
}

function metricPayload(record) {
  return {
    project_id: project.id,
    prompt_id: prompt.id,
    user_id: user.id,
    platform: record.platform,
    brand_mentioned: true,
    brand_mentions: 1,
    brand_position: 1,
    brand_rank: 1,
    brand_recommended: true,
    visibility_score: 90,
    competitor_mentions: [],
    share_of_voice: 100,
    citation_count: 0,
    owned_citation_count: 0,
    competitor_citation_count: 0,
    citation_sources: [],
    prompt_category: '品牌认知',
    sentiment: 'positive',
    sentiment_reason: null,
    sentiment_risk_terms: [],
    analysis_method: 'ai_structured_v2',
    metric_semantics_version: 'configured_competitor_sov_v1',
    analysis_platform: 'deepseek',
    analysis_model: 'deepseek-model',
    analysis_structure: {},
    analysis_evidence: {}
  };
}

test.before(async () => {
  await sequelize.sync({ force: true });
  user = await User.create({
    username: 'lease-user',
    email: 'lease@example.com',
    password: 'not-used',
    membership_level: 'free',
    role: 'user',
    status: 'active'
  });
  project = await BrandProject.create({
    user_id: user.id,
    name: '租约测试品牌',
    platforms: ['doubao'],
    status: 'active'
  });
  questionSet = await PromptGroup.create({
    project_id: project.id,
    user_id: user.id,
    name: '租约测试问题集'
  });
  prompt = await TrackedPrompt.create({
    project_id: project.id,
    user_id: user.id,
    prompt_group_id: questionSet.id,
    question: '执行租约会阻止迟到写入吗？',
    platforms: ['doubao'],
    tags: [],
    enabled: true
  });
});

test.beforeEach(async () => {
  await VisibilityMetric.destroy({ where: {} });
  await ResultDetail.destroy({ where: {} });
  await QuestionRecord.destroy({ where: {} });
  await QuestionSetRun.destroy({ where: {} });
  run = await QuestionSetRun.create({
    project_id: project.id,
    user_id: user.id,
    question_set_id: questionSet.id,
    question_set_name: questionSet.name,
    source: 'native',
    planned_record_count: 1,
    started_at: new Date()
  });
  ProjectRunService.buildVisibilityMetricPayload = async ({ record }) => metricPayload(record);
});

test.after(async () => {
  ProjectRunService.buildVisibilityMetricPayload = originalBuildVisibilityMetricPayload;
  await sequelize.close();
  fs.rmSync(databaseDir, { recursive: true, force: true });
});

test('claims one pending record with token, owner and a budget-derived expiry', async () => {
  const record = await createPendingRecord();
  const now = new Date('2026-07-26T10:00:00.000Z');

  const lease = await ProjectRunService.claimRecordExecution(record.id, {
    leaseOwner: 'worker-a',
    leaseMs: 90_000,
    now
  });

  assert.equal(lease.claimed, true);
  assert.match(lease.executionToken, /^[0-9a-f-]{36}$/);
  assert.equal(lease.leaseOwner, 'worker-a');
  assert.equal(lease.leaseExpiresAt.toISOString(), '2026-07-26T10:01:30.000Z');
  await record.reload();
  assert.equal(record.lease_owner, 'worker-a');
  assert.equal(record.lease_expires_at.toISOString(), '2026-07-26T10:01:30.000Z');
});

test('derives lease duration from monitoring retries plus structured-analysis budget', () => {
  const analysisOnlyMs = ProjectRunService.getRecordExecutionLeaseMs({
    retryMode: 'analysis_only',
    runtimeSettings: {
      ai_default_timeout_seconds: 10,
      ai_retry_count: 0
    }
  });
  const fullMonitoringMs = ProjectRunService.getRecordExecutionLeaseMs({
    target: {
      platformConfig: { request_timeout_seconds: 180 }
    },
    runtimeSettings: {
      ai_default_timeout_seconds: 90,
      ai_retry_count: 3
    }
  });

  assert.ok(analysisOnlyMs >= 5 * 60 * 1000);
  assert.ok(fullMonitoringMs > analysisOnlyMs);
  assert.ok(fullMonitoringMs >= 17 * 60 * 1000);
});

test('renews an active lease and recovery ignores the still-live worker', async () => {
  const record = await createPendingRecord();
  const lease = await ProjectRunService.claimRecordExecution(record.id, {
    leaseOwner: 'worker-a',
    leaseMs: 60_000,
    now: new Date('2026-07-26T10:00:00.000Z')
  });

  const renewed = await ProjectRunService.renewRecordExecutionLease(
    record.id,
    lease.executionToken,
    {
      leaseMs: 60_000,
      now: new Date('2026-07-26T10:00:40.000Z')
    }
  );
  assert.equal(renewed, true);

  const recovered = await SchedulerService.recoverStalePendingRecords({
    now: new Date('2026-07-26T10:01:10.000Z')
  });
  assert.equal(recovered, 0);
  await record.reload();
  assert.equal(record.status, 'pending');
  assert.equal(record.execution_token, lease.executionToken);
  assert.equal(record.lease_expires_at.toISOString(), '2026-07-26T10:01:40.000Z');
});

test('recovers a pre-upgrade claimed record that has no lease expiry', async () => {
  const record = await createPendingRecord({
    execution_token: 'legacy-token',
    execution_started_at: new Date('2026-07-26T09:00:00.000Z'),
    lease_owner: null,
    lease_expires_at: null
  });

  const recovered = await SchedulerService.recoverStalePendingRecords({
    now: new Date('2026-07-26T10:00:00.000Z'),
    maxAgeMs: 20 * 60 * 1000
  });

  assert.equal(recovered, 1);
  await record.reload();
  assert.equal(record.status, 'failed');
  assert.equal(record.execution_token, null);
  assert.equal(record.result_summary.failure.error_code, 'stale_pending_recovered');
});

test('heartbeat renews a long-running lease until explicitly stopped', async () => {
  const originalRenew = ProjectRunService.renewRecordExecutionLease;
  let renewals = 0;
  let resolveTwoRenewals;
  const twoRenewals = new Promise((resolve) => {
    resolveTwoRenewals = resolve;
  });
  ProjectRunService.renewRecordExecutionLease = async () => {
    renewals += 1;
    if (renewals >= 2) resolveTwoRenewals();
    return true;
  };

  try {
    const heartbeat = ProjectRunService.startRecordLeaseHeartbeat({
      recordId: 77,
      executionToken: 'heartbeat-token',
      leaseMs: 90,
      heartbeatMs: 10
    });
    let timeout;
    await Promise.race([
      twoRenewals,
      new Promise((resolve) => {
        timeout = setTimeout(resolve, 500);
      })
    ]);
    clearTimeout(timeout);
    await heartbeat.stop();
    assert.ok(renewals >= 2);
  } finally {
    ProjectRunService.renewRecordExecutionLease = originalRenew;
  }
});

test('commits response, metric and successful terminal state together and clears old errors', async () => {
  const record = await createPendingRecord();
  const lease = await ProjectRunService.claimRecordExecution(record.id, {
    leaseOwner: 'worker-a',
    leaseMs: 60_000
  });

  const result = await ProjectRunService.finalizeSuccessfulRecord({
    record,
    executionToken: lease.executionToken,
    persistResponseDetail: true,
    responseText: '租约测试品牌值得关注。',
    aiResponse: {},
    providerCitations: [],
    project,
    competitors: [],
    prompt,
    keywords: [project.name]
  });

  assert.equal(result.ok, true);
  assert.equal(await ResultDetail.count({ where: { question_record_id: record.id } }), 1);
  assert.equal(await VisibilityMetric.count({ where: { question_record_id: record.id } }), 1);
  await record.reload();
  assert.equal(record.status, 'completed');
  assert.equal(record.error_message, null);
  assert.equal(record.execution_token, null);
  assert.equal(record.lease_owner, null);
  assert.equal(record.lease_expires_at, null);
});

test('keeps the original response atomically when structured analysis fails', async () => {
  const record = await createPendingRecord();
  const lease = await ProjectRunService.claimRecordExecution(record.id, {
    leaseOwner: 'worker-a',
    leaseMs: 60_000
  });
  ProjectRunService.buildVisibilityMetricPayload = async () => {
    throw new Error('injected-analysis-failure');
  };

  const result = await ProjectRunService.finalizeSuccessfulRecord({
    record,
    executionToken: lease.executionToken,
    persistResponseDetail: true,
    responseText: '这段原始回答必须保留，供 analysis-only 重试。',
    aiResponse: {},
    providerCitations: [],
    project,
    competitors: [],
    prompt,
    keywords: [project.name]
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'failed');
  assert.equal(await ResultDetail.count({ where: { question_record_id: record.id } }), 1);
  assert.equal(await VisibilityMetric.count({ where: { question_record_id: record.id } }), 0);
  await record.reload();
  assert.equal(record.status, 'failed');
  assert.equal(record.result_summary.failure.error_code, 'metric_persist_failed');
  assert.equal(record.execution_token, null);
});

test('rejects every artifact from a worker whose expired token was already recovered', async () => {
  const record = await createPendingRecord();
  const lease = await ProjectRunService.claimRecordExecution(record.id, {
    leaseOwner: 'worker-a',
    leaseMs: 60_000,
    now: new Date('2026-07-26T10:00:00.000Z')
  });

  const recovered = await SchedulerService.recoverStalePendingRecords({
    now: new Date('2026-07-26T10:01:01.000Z')
  });
  assert.equal(recovered, 1);
  const revisionBefore = run.revision;

  const result = await ProjectRunService.finalizeSuccessfulRecord({
    record,
    executionToken: lease.executionToken,
    persistResponseDetail: true,
    responseText: '这是已经迟到的成功结果。',
    aiResponse: {},
    providerCitations: [],
    project,
    competitors: [],
    prompt,
    keywords: [project.name]
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'stale');
  assert.equal(result.error_code, 'stale_worker_write_rejected');
  assert.equal(await ResultDetail.count({ where: { question_record_id: record.id } }), 0);
  assert.equal(await VisibilityMetric.count({ where: { question_record_id: record.id } }), 0);
  await record.reload();
  await run.reload();
  assert.equal(record.status, 'failed');
  assert.equal(record.error_message, '分析任务中断，请重新运行');
  assert.equal(run.revision, revisionBefore);
  assert.equal(await ProjectRunService.dispatchPendingQuestionSetRuns(), 0);

  const lateFailure = await ProjectRunService.failRecord(
    record,
    '迟到 worker 的失败',
    { stage: 'monitoring_request', error_code: 'provider_error' },
    { executionToken: lease.executionToken }
  );
  assert.equal(lateFailure, false);
  await record.reload();
  assert.equal(record.error_message, '分析任务中断，请重新运行');
});
