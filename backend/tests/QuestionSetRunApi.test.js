const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-question-set-run-api-'));
process.env.DB_STORAGE = path.join(databaseDir, 'test.sqlite');
delete process.env.DATABASE_URL;

const router = require('../routes/geoProjects');
const {
  sequelize,
  User,
  BrandProject,
  QuestionSetRun
} = require('../models');

let user;
let project;
let run;

async function requestRoute(method, routePath, { params = {}, body = {}, query = {} } = {}) {
  const layer = router.stack.find((item) => item.route?.path === routePath && item.route.methods?.[method]);
  assert.ok(layer, `route ${method.toUpperCase()} ${routePath} should exist`);
  const req = { params, body, query, user: { id: user.id, role: 'user' } };
  const response = {
    statusCode: 200,
    payload: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    type(value) {
      this.headers['content-type'] = value;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    send(payload) {
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

test.before(async () => {
  await sequelize.sync({ force: true });
  user = await User.create({
    username: 'question-set-run-api-user',
    email: 'question-set-run-api@example.com',
    password: 'not-used',
    role: 'user',
    status: 'active'
  });
  project = await BrandProject.create({
    user_id: user.id,
    name: '广拓',
    aliases: [],
    primary_keywords: [],
    platforms: ['deepseek'],
    status: 'active'
  });
  run = await QuestionSetRun.create({
    project_id: project.id,
    user_id: user.id,
    question_set_name: '导入测试问题集',
    source: 'imported',
    imported_rows: [{
      record_id: 1,
      question_id: 2,
      question: '广拓怎么样？',
      question_category: '品牌认知',
      platform: 'deepseek',
      platform_name: 'DeepSeek',
      model_name: 'deepseek-chat',
      status: 'completed',
      error_message: '',
      answer: '广拓是一家周界报警厂商。',
      has_metrics: true,
      brand_mentioned: true,
      brand_mentions: 1,
      brand_rank: 1,
      brand_recommended: false,
      share_of_voice: 50,
      citation_count: 0,
      sentiment: 'neutral',
      sentiment_reason: '',
      competitor_mentions: [],
      citation_sources: []
    }]
  });
});

test.after(async () => {
  await sequelize.close();
  fs.rmSync(databaseDir, { recursive: true, force: true });
});

test('用户可以分页查看问题集运行历史并打开单次独立报告', async () => {
  const listResponse = await requestRoute('get', '/:projectId/question-set-runs', {
    params: { projectId: project.id },
    query: { page: 1, pageSize: 20 }
  });

  assert.equal(listResponse.statusCode, 200);
  assert.equal(listResponse.payload.success, true);
  assert.equal(listResponse.payload.data.length, 1);
  assert.equal(listResponse.payload.data[0].id, run.id);
  assert.equal(listResponse.payload.data[0].rows, undefined);
  assert.equal(listResponse.payload.pagination.totalItems, 1);

  const detailResponse = await requestRoute('get', '/:projectId/question-set-runs/:runId', {
    params: { projectId: project.id, runId: run.id }
  });

  assert.equal(detailResponse.statusCode, 200);
  assert.equal(detailResponse.payload.data.id, run.id);
  assert.equal(detailResponse.payload.data.source, 'imported');
  assert.equal(detailResponse.payload.data.rows[0].answer, '广拓是一家周界报警厂商。');
});

test('用户可以从报告接口导出标准 CSV 并安全回导', async () => {
  const exportResponse = await requestRoute('get', '/:projectId/question-set-runs/:runId/export', {
    params: { projectId: project.id, runId: run.id }
  });

  assert.equal(exportResponse.statusCode, 200);
  assert.match(exportResponse.headers['content-type'], /text\/csv/);
  assert.match(exportResponse.payload, /^\uFEFFschema_version,/);

  const importResponse = await requestRoute('post', '/:projectId/question-set-runs/import', {
    params: { projectId: project.id },
    body: { csv: exportResponse.payload }
  });

  assert.equal(importResponse.statusCode, 201);
  assert.equal(importResponse.payload.data.source, 'imported');
  assert.equal(importResponse.payload.data.summary.total, 1);
  assert.equal(importResponse.payload.data.rows[0].answer, '广拓是一家周界报警厂商。');

  const beforeInvalidImport = await QuestionSetRun.count({ where: { project_id: project.id } });
  const invalidResponse = await requestRoute('post', '/:projectId/question-set-runs/import', {
    params: { projectId: project.id },
    body: { csv: 'wrong,columns\n1,2' }
  });
  assert.equal(invalidResponse.statusCode, 422);
  assert.equal(invalidResponse.payload.error.code, 'MISSING_COLUMNS');
  assert.equal(await QuestionSetRun.count({ where: { project_id: project.id } }), beforeInvalidImport);
});
