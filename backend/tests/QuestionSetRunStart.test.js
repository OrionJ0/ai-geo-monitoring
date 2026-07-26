const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-question-set-run-start-'));
process.env.DB_STORAGE = path.join(databaseDir, 'test.sqlite');
delete process.env.DATABASE_URL;

const AIPlatformService = require('../services/AIPlatformService');
const ProjectRunService = require('../services/ProjectRunService');
const QuestionSetRunService = require('../services/QuestionSetRunService');
const {
  sequelize,
  User,
  MembershipPlan,
  UsageCounter,
  BrandProject,
  PromptGroup,
  TrackedPrompt,
  QuestionRecord,
  QuestionSetRun
} = require('../models');

let user;
let project;
let questionSet;
let otherQuestionSet;
let prompts;
const originalGetPlatformAvailability = AIPlatformService.getPlatformAvailability;
const originalGetRuntimeSettings = ProjectRunService.getRuntimeSettings;
const originalSchedulePreparedRun = ProjectRunService.schedulePreparedRun;

function startOptions(overrides = {}) {
  return {
    project,
    questionSet,
    prompts: prompts.map((prompt) => ({
      ...prompt.toJSON(),
      platforms: project.platforms
    })),
    platforms: project.platforms,
    user,
    promptSelectionExplicit: true,
    idempotencyKey: 'launch-key-0001',
    ...overrides
  };
}

test.before(async () => {
  await sequelize.sync({ force: true });
  await MembershipPlan.create({
    level: 'free',
    name: '免费版',
    detection_daily_limit: 100
  });
  user = await User.create({
    username: 'run-start-user',
    email: 'run-start@example.com',
    password: 'not-used',
    membership_level: 'free',
    role: 'user',
    status: 'active'
  });
  project = await BrandProject.create({
    user_id: user.id,
    name: '原子运行测试品牌',
    aliases: [],
    primary_keywords: [],
    platforms: ['doubao', 'deepseek'],
    status: 'active'
  });
  questionSet = await PromptGroup.create({
    project_id: project.id,
    user_id: user.id,
    name: '原子运行问题集'
  });
  otherQuestionSet = await PromptGroup.create({
    project_id: project.id,
    user_id: user.id,
    name: '另一个问题集'
  });
  prompts = await TrackedPrompt.bulkCreate([
    {
      project_id: project.id,
      user_id: user.id,
      prompt_group_id: questionSet.id,
      question: '问题一',
      tags: [],
      platforms: ['doubao'],
      enabled: true
    },
    {
      project_id: project.id,
      user_id: user.id,
      prompt_group_id: questionSet.id,
      question: '问题二',
      tags: [],
      platforms: ['deepseek'],
      enabled: true
    }
  ]);
});

test.beforeEach(async () => {
  await QuestionRecord.destroy({ where: {} });
  await QuestionSetRun.destroy({ where: {} });
  await UsageCounter.destroy({ where: {} });
  AIPlatformService.getPlatformAvailability = async () => [
    {
      code: 'doubao',
      platform_name: '豆包',
      model_name: 'doubao-model',
      available: true,
      reason: null,
      config: { code: 'doubao', default_model: 'doubao-model' }
    },
    {
      code: 'deepseek',
      platform_name: 'DeepSeek',
      model_name: 'deepseek-model',
      available: false,
      reason: 'disabled',
      config: null
    }
  ];
  ProjectRunService.getRuntimeSettings = async () => ({ ai_run_concurrency: 2 });
});

test.after(async () => {
  AIPlatformService.getPlatformAvailability = originalGetPlatformAvailability;
  ProjectRunService.getRuntimeSettings = originalGetRuntimeSettings;
  ProjectRunService.schedulePreparedRun = originalSchedulePreparedRun;
  await sequelize.close();
  fs.rmSync(databaseDir, { recursive: true, force: true });
});

test('atomically persists one launch plan and replays the same idempotency key', async () => {
  const dispatched = [];
  ProjectRunService.schedulePreparedRun = (context) => {
    dispatched.push(context);
  };

  const first = await ProjectRunService.startQuestionSetRun(startOptions());
  const replay = await ProjectRunService.startQuestionSetRun(startOptions());

  assert.equal(first.ok, true);
  assert.equal(first.status, 202);
  assert.equal(first.data.idempotent_replay, false);
  assert.equal(first.data.accepted_count, 2);
  assert.deepEqual(first.data.planned_platforms, ['doubao']);
  assert.deepEqual(first.data.skipped_platforms.map((item) => item.platform), ['deepseek']);
  assert.equal(first.data.skipped_platforms[0].reason_code, 'PLATFORM_UNAVAILABLE');
  assert.equal(replay.data.question_set_run_id, first.data.question_set_run_id);
  assert.equal(replay.data.idempotent_replay, true);
  assert.equal(await QuestionSetRun.count(), 1);
  assert.equal(await QuestionRecord.count(), 2);
  assert.equal(dispatched.length, 1);

  const run = await QuestionSetRun.findByPk(first.data.question_set_run_id);
  assert.equal(run.planned_record_count, 2);
  assert.equal(run.idempotency_key_hash.length, 64);
  assert.notEqual(run.idempotency_key_hash, 'launch-key-0001');
  assert.equal(run.request_fingerprint.length, 64);
  assert.deepEqual(run.planned_platforms, ['doubao']);
  assert.equal(run.skipped_platforms.length, 1);
  assert.equal(run.analysis_contract_version, 'ai_structured_v2');
  const report = await QuestionSetRunService.getReport({
    projectId: project.id,
    runId: run.id
  });
  assert.deepEqual(report.planned_platforms, ['doubao']);
  assert.deepEqual(report.skipped_platforms, run.skipped_platforms);
  assert.equal(report.analysis_contract_version, 'ai_structured_v2');

  const records = await QuestionRecord.findAll({
    where: { question_set_run_id: run.id },
    order: [['run_slot_index', 'ASC']]
  });
  assert.deepEqual(records.map((record) => record.run_slot_index), [0, 1]);
  const counter = await UsageCounter.findOne({
    where: { user_id: user.id, feature: 'detection', period: 'daily' }
  });
  assert.equal(counter.used_count, 2);
});

test('rejects reuse of one idempotency key for a different request fingerprint', async () => {
  ProjectRunService.schedulePreparedRun = () => {};
  await ProjectRunService.startQuestionSetRun(startOptions());

  await assert.rejects(
    ProjectRunService.startQuestionSetRun(startOptions({
      questionSet: otherQuestionSet
    })),
    (error) => (
      error.status === 409
      && error.data?.error_code === 'IDEMPOTENCY_KEY_REUSED'
    )
  );
  assert.equal(await QuestionSetRun.count(), 1);
  assert.equal(await QuestionRecord.count(), 2);
});

test('rolls back the run, quota and every record at each transaction failure point', async () => {
  ProjectRunService.schedulePreparedRun = () => {};
  const failures = [
    {
      key: 'failure-after-quota',
      shouldFail: (stage) => stage === 'after_quota'
    },
    {
      key: 'failure-mid-records',
      shouldFail: (stage, context) => (
        stage === 'after_record' && context.runSlotIndex === 0
      )
    },
    {
      key: 'failure-before-commit',
      shouldFail: (stage) => stage === 'before_commit'
    }
  ];

  for (const failure of failures) {
    await assert.rejects(
      ProjectRunService.startQuestionSetRun(startOptions({
        idempotencyKey: failure.key,
        faultInjector: async (stage, context) => {
          if (failure.shouldFail(stage, context)) {
            throw new Error(`injected-${stage}`);
          }
        }
      })),
      /injected-/
    );
    assert.equal(await QuestionSetRun.count(), 0);
    assert.equal(await QuestionRecord.count(), 0);
    assert.equal(await UsageCounter.count(), 0);
  }
});

test('concurrent submissions with one key commit and dispatch only one run', async () => {
  const dispatched = [];
  ProjectRunService.schedulePreparedRun = (context) => {
    dispatched.push(context.questionSetRunId);
  };

  const [first, second] = await Promise.all([
    ProjectRunService.startQuestionSetRun(startOptions({
      idempotencyKey: 'concurrent-launch-key'
    })),
    ProjectRunService.startQuestionSetRun(startOptions({
      idempotencyKey: 'concurrent-launch-key'
    }))
  ]);

  assert.equal(first.data.question_set_run_id, second.data.question_set_run_id);
  assert.deepEqual(
    [first.data.idempotent_replay, second.data.idempotent_replay].sort(),
    [false, true]
  );
  assert.equal(await QuestionSetRun.count(), 1);
  assert.equal(await QuestionRecord.count(), 2);
  assert.equal(dispatched.length, 1);
  const counter = await UsageCounter.findOne();
  assert.equal(counter.used_count, 2);
});

test('keeps committed pending records when immediate dispatch fails and later redispatches them', async () => {
  ProjectRunService.schedulePreparedRun = () => {
    throw new Error('injected-dispatch-failure');
  };
  const result = await ProjectRunService.startQuestionSetRun(startOptions({
    idempotencyKey: 'deferred-dispatch-key'
  }));

  assert.equal(result.ok, true);
  assert.equal(result.data.dispatch_deferred, true);
  assert.equal(await QuestionSetRun.count(), 1);
  assert.equal(await QuestionRecord.count({ where: { status: 'pending' } }), 2);
  const counter = await UsageCounter.findOne();
  assert.equal(counter.used_count, 2);

  const dispatched = [];
  ProjectRunService.schedulePreparedRun = (context) => {
    dispatched.push(context);
  };
  const redispatched = await ProjectRunService.dispatchPendingQuestionSetRuns();

  assert.equal(redispatched, 1);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].entries.length, 2);
  assert.equal(
    dispatched[0].questionSetRunId,
    result.data.question_set_run_id
  );
});
