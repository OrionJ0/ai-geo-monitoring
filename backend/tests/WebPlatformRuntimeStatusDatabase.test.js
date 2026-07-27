const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_STORAGE = ':memory:';

const {
  sequelize,
  User,
  QuestionRecord,
  QuestionSetRun
} = require('../models');
const {
  WebPlatformRuntimeStatusService
} = require('../services/WebPlatformRuntimeStatusService');

const observedAt = new Date('2026-07-27T02:00:00.000Z');
let user;

function recordValues(overrides = {}) {
  return {
    user_id: user.id,
    platform: 'deepseek-web',
    question: '测试问题',
    brand_keywords: '测试品牌',
    status: 'pending',
    ...overrides
  };
}

test.before(async () => {
  await sequelize.sync({ force: true });
  user = await User.create({
    username: 'runtime-status-user',
    email: 'runtime-status@example.com',
    password: 'not-used'
  });
});

test.after(async () => {
  await sequelize.close();
});

test('counts only actionable pending Web records across active, paused and orphaned runs', async () => {
  const activeRun = await QuestionSetRun.create({
    project_id: 1,
    user_id: user.id,
    question_set_name: '活动运行'
  });
  const pausedRun = await QuestionSetRun.create({
    project_id: 1,
    user_id: user.id,
    question_set_name: '暂停运行',
    paused_at: new Date('2026-07-27T01:00:00.000Z')
  });

  await QuestionRecord.bulkCreate([
    recordValues(),
    recordValues({ question_set_run_id: activeRun.id }),
    recordValues({ question_set_run_id: pausedRun.id }),
    recordValues({
      question_set_run_id: pausedRun.id,
      execution_token: 'active-lease',
      lease_expires_at: new Date('2026-07-27T02:05:00.000Z')
    }),
    recordValues({
      question_set_run_id: pausedRun.id,
      execution_token: 'expired-lease',
      lease_expires_at: new Date('2026-07-27T01:55:00.000Z')
    }),
    recordValues({ platform: 'deepseek' }),
    recordValues({ status: 'completed' })
  ]);

  await sequelize.query('PRAGMA foreign_keys = OFF');
  await QuestionRecord.create(recordValues({ question_set_run_id: 999_999 }));
  await QuestionRecord.create(recordValues({
    question_set_run_id: 999_998,
    execution_token: 'orphan-active-lease',
    lease_expires_at: new Date('2026-07-27T02:05:00.000Z')
  }));
  await sequelize.query('PRAGMA foreign_keys = ON');

  const service = new WebPlatformRuntimeStatusService({
    questionRecordModel: QuestionRecord,
    questionSetRunModel: QuestionSetRun,
    aiPlatformConfigService: {
      async getPlatformByCode() {
        return { enabled: true };
      }
    },
    webPlatformRegistry: {
      getDefinition(code) {
        return {
          code,
          runtimeSchemaVersion: 'deepseek-web-runtime-v1'
        };
      },
      getService() {
        return {
          getRuntimeSnapshot() {
            return { running_count: 0 };
          }
        };
      }
    },
    now: () => observedAt
  });

  const status = await service.getStatus();

  assert.equal(status.state, 'busy');
  assert.equal(status.pending_count, 4);
  assert.equal(status.running_count, 0);
  assert.equal(status.queued_count, 4);
});
