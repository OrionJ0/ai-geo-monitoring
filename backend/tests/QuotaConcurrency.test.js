const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-quota-concurrency-'));
process.env.DB_STORAGE = path.join(databaseDir, 'test.sqlite');
delete process.env.DATABASE_URL;

const {
  sequelize,
  User,
  MembershipPlan,
  UsageCounter
} = require('../models');
const { consumeQuotaDirect } = require('../middleware/quota');

let user;

test.before(async () => {
  await sequelize.sync({ force: true });
  await MembershipPlan.create({
    level: 'free',
    detection_daily_limit: 100
  });
  user = await User.create({
    username: 'quota-concurrency-user',
    email: 'quota-concurrency@example.com',
    password: 'not-used',
    membership_level: 'free',
    role: 'user',
    status: 'active'
  });
});

test.after(async () => {
  await sequelize.close();
  fs.rmSync(databaseDir, { recursive: true, force: true });
});

test('并发直接扣减不会丢失用量', async () => {
  const results = await Promise.all(
    Array.from({ length: 10 }, () => consumeQuotaDirect(user.id, 'detection', 1))
  );

  assert.equal(results.filter((result) => result.ok).length, 10);
  const counter = await UsageCounter.findOne({
    where: {
      user_id: user.id,
      feature: 'detection',
      period: 'daily'
    }
  });
  assert.equal(counter.used_count, 10);
});

test('事务内扣减后的读取异常会回滚配额', async () => {
  const counter = await UsageCounter.findOne({
    where: { user_id: user.id, feature: 'detection', period: 'daily' }
  });
  const before = counter.used_count;
  const failingModel = {
    findOne: (...args) => UsageCounter.findOne(...args),
    bulkCreate: (...args) => UsageCounter.bulkCreate(...args),
    update: (...args) => UsageCounter.update(...args),
    findByPk: async () => { throw new Error('injected counter read failure'); }
  };

  await assert.rejects(
    sequelize.transaction(async (transaction) => consumeQuotaDirect(
      user.id,
      'detection',
      1,
      { transaction, model: failingModel }
    )),
    /injected counter read failure/u
  );
  await counter.reload();
  assert.equal(counter.used_count, before);
});
