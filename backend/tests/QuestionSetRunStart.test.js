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
  assert.equal(dispatched[0].runRevision, 0);

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

test('single-question runs use the same report and retry ownership model without a persisted question set', async () => {
  ProjectRunService.schedulePreparedRun = () => {};
  const prompt = prompts[0];

  const result = await ProjectRunService.startQuestionSetRun(startOptions({
    questionSet: {
      id: null,
      name: `单问题：${prompt.question}`
    },
    prompts: [{
      ...prompt.toJSON(),
      platforms: ['doubao']
    }],
    platforms: project.platforms,
    idempotencyKey: 'single-question-run-start'
  }));

  assert.equal(result.ok, true);
  assert.equal(result.status, 202);
  assert.equal(result.message, '问题分析已加入队列');
  assert.match(result.data.report_url, /question-set-reports/);
  const run = await QuestionSetRun.findByPk(result.data.question_set_run_id);
  assert.equal(run.question_set_id, null);
  assert.equal(run.question_set_name, '单问题：问题一');
  assert.equal(run.planned_record_count, 1);
  assert.equal(await QuestionRecord.count({
    where: { question_set_run_id: run.id }
  }), 1);
  const report = await QuestionSetRunService.getReport({
    projectId: project.id,
    runId: run.id
  });
  assert.equal(report.capabilities.can_retry, false);
  assert.equal(report.question_set_id, null);
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

test('concurrent active submissions with different keys create independent runs', async () => {
  const dispatched = [];
  ProjectRunService.schedulePreparedRun = (context) => {
    dispatched.push(context.questionSetRunId);
  };

  const [first, second] = await Promise.all([
    ProjectRunService.startQuestionSetRun(startOptions({
      idempotencyKey: 'browser-a-active-submit'
    })),
    ProjectRunService.startQuestionSetRun(startOptions({
      idempotencyKey: 'browser-b-active-submit'
    }))
  ]);

  assert.notEqual(first.data.question_set_run_id, second.data.question_set_run_id);
  assert.equal(first.data.idempotent_replay, false);
  assert.equal(second.data.idempotent_replay, false);
  assert.equal(await QuestionSetRun.count(), 2);
  assert.equal(await QuestionRecord.count(), 4);
  assert.deepEqual(
    new Set(dispatched),
    new Set([first.data.question_set_run_id, second.data.question_set_run_id])
  );
  const counter = await UsageCounter.findOne();
  assert.equal(counter.used_count, 4);
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
  assert.equal(dispatched[0].runRevision, 0);
});

test('question-set entry persists DeepSeek Web records with run ownership and adapter config', async () => {
  const previousPlatforms = project.platforms;
  await project.update({ platforms: ['deepseek-web'] });
  AIPlatformService.getPlatformAvailability = async () => [{
    code: 'deepseek-web',
    platform_name: 'DeepSeek 网页版',
    model_name: 'deepseek-web-ui',
    available: true,
    reason: null,
    config: {
      code: 'deepseek-web',
      adapter_type: 'deepseek_web',
      default_model: 'deepseek-web-ui'
    }
  }];
  let scheduledContext = null;
  ProjectRunService.schedulePreparedRun = (context) => {
    scheduledContext = context;
  };

  try {
    const result = await ProjectRunService.startQuestionSetRun(startOptions({
      project,
      prompts: prompts.map((prompt) => ({
        ...prompt.toJSON(),
        platforms: ['deepseek-web']
      })),
      platforms: ['deepseek-web'],
      idempotencyKey: 'deepseek-web-question-set-entry'
    }));

    assert.equal(result.ok, true);
    assert.deepEqual(result.data.planned_platforms, ['deepseek-web']);
    const records = await QuestionRecord.findAll({
      where: { question_set_run_id: result.data.question_set_run_id },
      order: [['run_slot_index', 'ASC']]
    });
    assert.equal(records.length, 2);
    assert.deepEqual(records.map((record) => record.platform), [
      'deepseek-web',
      'deepseek-web'
    ]);
    assert.deepEqual(records.map((record) => record.run_slot_index), [0, 1]);
    assert.ok(records.every((record) => record.model_name === 'deepseek-web-ui'));
    assert.equal(
      scheduledContext.entries[0].target.platformConfig.adapter_type,
      'deepseek_web'
    );
  } finally {
    await project.update({ platforms: previousPlatforms });
  }
});

test('mixed question-set run skips unavailable Web before quota and keeps API records runnable', async () => {
  const previousPlatforms = project.platforms;
  await project.update({ platforms: ['doubao', 'deepseek-web'] });
  AIPlatformService.getPlatformAvailability = async () => [{
    code: 'doubao',
    platform_name: '豆包',
    model_name: 'doubao-model',
    available: true,
    reason: null,
    config: { code: 'doubao', adapter_type: 'openai_compatible' }
  }, {
    code: 'deepseek-web',
    platform_name: 'DeepSeek 网页版',
    model_name: 'deepseek-web-ui',
    available: false,
    reason: 'web_login_required',
    config: null
  }];
  ProjectRunService.schedulePreparedRun = () => {};

  try {
    const result = await ProjectRunService.startQuestionSetRun(startOptions({
      project,
      prompts: prompts.map((prompt) => ({
        ...prompt.toJSON(),
        platforms: ['doubao', 'deepseek-web']
      })),
      platforms: ['doubao', 'deepseek-web'],
      idempotencyKey: 'mixed-web-unavailable-entry'
    }));

    assert.equal(result.ok, true);
    assert.deepEqual(result.data.planned_platforms, ['doubao']);
    assert.equal(result.data.skipped_platforms[0].platform, 'deepseek-web');
    assert.equal(result.data.skipped_platforms[0].reason, 'web_login_required');
    assert.equal(await QuestionRecord.count({
      where: { question_set_run_id: result.data.question_set_run_id }
    }), 2);
    const counter = await UsageCounter.findOne({
      where: { user_id: user.id, feature: 'detection', period: 'daily' }
    });
    assert.equal(counter.used_count, 2);
  } finally {
    await project.update({ platforms: previousPlatforms });
  }
});
