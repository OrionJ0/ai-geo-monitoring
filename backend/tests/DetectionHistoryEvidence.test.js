const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-history-evidence-'));
process.env.DB_STORAGE = path.join(databaseDir, 'test.sqlite');
process.env.JWT_SECRET = 'history-evidence-test-secret';
delete process.env.DATABASE_URL;

const router = require('../routes/detection');
const {
  sequelize,
  User,
  BrandProject,
  QuestionRecord,
  QuestionSetRun,
  ResultDetail,
  VisibilityMetric
} = require('../models');

let user;
let project;
let token;

async function requestRoute(method, routePath, { params = {}, query = {} } = {}) {
  const layer = router.stack.find((item) => item.route?.path === routePath && item.route.methods?.[method]);
  assert.ok(layer, `route ${method.toUpperCase()} ${routePath} should exist`);
  const req = {
    params,
    query,
    body: {},
    headers: { authorization: `Bearer ${token}` },
    cookies: {}
  };
  const response = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
  const handlers = layer.route.stack.map((item) => item.handle);
  const dispatch = async (index) => {
    if (!handlers[index]) return;
    await handlers[index](req, response, () => dispatch(index + 1));
  };
  await dispatch(0);
  return response;
}

async function createRecord({ runId = null, slot = null, question }) {
  const record = await QuestionRecord.create({
    user_id: user.id,
    project_id: project.id,
    question_set_run_id: runId,
    run_slot_index: slot,
    platform: 'deepseek',
    question,
    brand: project.name,
    brand_keywords: project.name,
    status: 'completed'
  });
  await ResultDetail.create({
    question_record_id: record.id,
    ai_response_original: `${question} 的回答`,
    parsing_status: 'completed'
  });
  await VisibilityMetric.create({
    project_id: project.id,
    question_record_id: record.id,
    user_id: user.id,
    platform: 'deepseek'
  });
  return record;
}

test.before(async () => {
  await sequelize.sync({ force: true });
  user = await User.create({
    username: 'history-evidence-user',
    email: 'history-evidence@example.com',
    password: 'not-used',
    role: 'user',
    status: 'active'
  });
  project = await BrandProject.create({
    user_id: user.id,
    name: '历史证据项目',
    platforms: ['deepseek'],
    status: 'active'
  });
  token = jwt.sign({
    userId: user.id,
    username: user.username,
    role: user.role
  }, process.env.JWT_SECRET);
});

test.after(async () => {
  await sequelize.close();
  fs.rmSync(databaseDir, { recursive: true, force: true });
});

test.beforeEach(async () => {
  await VisibilityMetric.destroy({ where: {} });
  await ResultDetail.destroy({ where: {} });
  await QuestionRecord.destroy({ where: {} });
  await QuestionSetRun.destroy({ where: {} });
});

test('单条检测历史删除拒绝破坏问题集运行证据', async () => {
  const run = await QuestionSetRun.create({
    project_id: project.id,
    user_id: user.id,
    question_set_name: '受保护运行',
    source: 'native',
    planned_record_count: 1
  });
  const record = await createRecord({
    runId: run.id,
    slot: 0,
    question: '受保护问题'
  });

  const response = await requestRoute('delete', '/record/:id', {
    params: { id: record.id }
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.payload.error.code, 'RUN_EVIDENCE_PROTECTED');
  assert.ok(await QuestionRecord.findByPk(record.id));
  assert.ok(await ResultDetail.findOne({ where: { question_record_id: record.id } }));
  assert.ok(await VisibilityMetric.findOne({ where: { question_record_id: record.id } }));
});

test('批量检测历史删除只删除当前缓存并报告受保护数量', async () => {
  const run = await QuestionSetRun.create({
    project_id: project.id,
    user_id: user.id,
    question_set_name: '批量保护运行',
    source: 'native',
    planned_record_count: 1
  });
  const protectedRecord = await createRecord({
    runId: run.id,
    slot: 0,
    question: '保留的运行证据'
  });
  const mutableRecord = await createRecord({
    question: '可删除的当前缓存'
  });

  const response = await requestRoute('delete', '/history/:userId', {
    params: { userId: user.id }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload.data, { deleted: 1, protected: 1 });
  assert.ok(await QuestionRecord.findByPk(protectedRecord.id));
  assert.ok(await ResultDetail.findOne({ where: { question_record_id: protectedRecord.id } }));
  assert.ok(await VisibilityMetric.findOne({ where: { question_record_id: protectedRecord.id } }));
  assert.equal(await QuestionRecord.findByPk(mutableRecord.id), null);
  assert.equal(await ResultDetail.findOne({ where: { question_record_id: mutableRecord.id } }), null);
  assert.equal(await VisibilityMetric.findOne({ where: { question_record_id: mutableRecord.id } }), null);
});
