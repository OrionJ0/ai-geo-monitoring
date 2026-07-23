const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-batch-prompts-'));
process.env.DB_STORAGE = path.join(databaseDir, 'test.sqlite');
delete process.env.DATABASE_URL;

const router = require('../routes/geoProjects');
const AIPlatformService = require('../services/AIPlatformService');
const {
  sequelize,
  User,
  BrandProject,
  PromptGroup,
  TrackedPrompt
} = require('../models');

let user;
let project;
const originalGetAvailablePlatforms = AIPlatformService.getAvailablePlatforms;

async function requestRoute(method, routePath, { params = {}, body = {} } = {}) {
  const layer = router.stack.find((item) => item.route?.path === routePath && item.route.methods?.[method]);
  assert.ok(layer, `route ${method.toUpperCase()} ${routePath} should exist`);
  const req = { params, body, query: {}, user: { id: user.id, role: 'user' } };
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

test.before(async () => {
  AIPlatformService.getAvailablePlatforms = async () => ['qwen'];
  await sequelize.sync({ force: true });
  user = await User.create({
    username: 'batch-prompt-user',
    email: 'batch-prompt@example.com',
    password: 'not-used',
    role: 'user',
    status: 'active'
  });
  project = await BrandProject.create({
    user_id: user.id,
    name: '批量问题品牌',
    aliases: [],
    primary_keywords: [],
    platforms: ['qwen'],
    status: 'active'
  });
  await TrackedPrompt.create({
    project_id: project.id,
    user_id: user.id,
    question: '已经存在的问题',
    tags: [],
    platforms: ['qwen'],
    enabled: true
  });
});

test.after(async () => {
  AIPlatformService.getAvailablePlatforms = originalGetAvailablePlatforms;
  await sequelize.close();
  fs.rmSync(databaseDir, { recursive: true, force: true });
});

test('批量新增在一个请求内创建问题并跳过库内及批次内重复项', async () => {
  const group = await PromptGroup.create({
    project_id: project.id,
    user_id: user.id,
    name: '批量问题集'
  });

  const response = await requestRoute('post', '/:projectId/prompts/batch', {
    params: { projectId: project.id },
    body: {
      questions: ['新问题一', '已经存在的问题？', '新问题一', '新问题二'],
      question_set_id: group.id,
      tags: ['批量'],
      platforms: ['qwen'],
      enabled: true
    }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.payload.success, true);
  assert.equal(response.payload.data.created_count, 2);
  assert.equal(response.payload.data.skipped_count, 2);
  assert.deepEqual(
    response.payload.data.created.map((item) => item.question),
    ['新问题一', '新问题二']
  );
  const stored = await TrackedPrompt.findAll({
    where: { project_id: project.id, prompt_group_id: group.id },
    order: [['id', 'ASC']]
  });
  assert.deepEqual(stored.map((item) => item.question), ['新问题一', '新问题二']);
  assert.equal(stored.every((item) => item.enabled && item.platforms.includes('qwen')), true);
});

test('批量新增拒绝超过一百条问题且不产生部分写入', async () => {
  const before = await TrackedPrompt.count({ where: { project_id: project.id } });
  const response = await requestRoute('post', '/:projectId/prompts/batch', {
    params: { projectId: project.id },
    body: {
      questions: Array.from({ length: 101 }, (_, index) => `超限问题 ${index + 1}`),
      platforms: ['qwen']
    }
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.payload.message, /100/);
  assert.equal(await TrackedPrompt.count({ where: { project_id: project.id } }), before);
});
