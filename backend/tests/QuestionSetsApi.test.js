const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-question-sets-'));
process.env.DB_STORAGE = path.join(databaseDir, 'test.sqlite');
delete process.env.DATABASE_URL;

const router = require('../routes/geoProjects');
const AIPlatformService = require('../services/AIPlatformService');
const ProjectRunService = require('../services/ProjectRunService');
const {
  sequelize,
  User,
  BrandProject,
  PromptGroup,
  TrackedPrompt,
  QuestionSetRun
} = require('../models');

let project;
let user;
const originalGetAvailablePlatforms = AIPlatformService.getAvailablePlatforms;

async function requestRoute(method, routePath, {
  params = {},
  body = {},
  query = {},
  headers = {}
} = {}) {
  const layer = router.stack.find((item) => item.route?.path === routePath && item.route.methods?.[method]);
  assert.ok(layer, `route ${method.toUpperCase()} ${routePath} should exist`);
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  const req = {
    params,
    body,
    query,
    headers: normalizedHeaders,
    get(name) {
      return normalizedHeaders[String(name).toLowerCase()];
    },
    user: { id: user.id, role: 'user' }
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

test.before(async () => {
  AIPlatformService.getAvailablePlatforms = async () => ['doubao', 'deepseek'];
  await sequelize.sync({ force: true });
  user = await User.create({
    username: 'question-set-user',
    email: 'question-set@example.com',
    password: 'not-used-in-api-test',
    role: 'user',
    status: 'active'
  });
  project = await BrandProject.create({
    user_id: user.id,
    name: '测试品牌',
    aliases: [],
    primary_keywords: [],
    platforms: ['doubao', 'deepseek'],
    status: 'active'
  });
  await TrackedPrompt.bulkCreate([
    {
      project_id: project.id,
      user_id: user.id,
      question: '问题一',
      tags: [],
      platforms: ['doubao'],
      enabled: true
    },
    {
      project_id: project.id,
      user_id: user.id,
      question: '问题二',
      tags: [],
      platforms: ['deepseek'],
      enabled: false
    }
  ]);

});

test.after(() => {
  AIPlatformService.getAvailablePlatforms = originalGetAvailablePlatforms;
});

test.after(async () => {
  await sequelize.close();
  fs.rmSync(databaseDir, { recursive: true, force: true });
});

test('用户可以创建包含多个问题的问题集并查询集合内容', async () => {
  const questions = await TrackedPrompt.findAll({
    where: { project_id: project.id },
    order: [['id', 'ASC']]
  });
  const createResponse = await requestRoute('post', '/:projectId/question-sets', {
    params: { projectId: project.id },
    body: {
      name: '购买决策问题集',
      description: '一起运行购买决策相关问题',
      question_ids: questions.map((item) => item.id)
    }
  });
  const created = createResponse.payload;

  assert.equal(createResponse.statusCode, 201);
  assert.equal(created.success, true);
  assert.equal(created.data.name, '购买决策问题集');
  assert.equal(created.data.question_count, 2);
  assert.equal(created.data.enabled_question_count, 1);
  assert.deepEqual(created.data.questions.map((item) => item.question), ['问题一', '问题二']);

  const listResponse = await requestRoute('get', '/:projectId/question-sets', {
    params: { projectId: project.id }
  });
  const listed = listResponse.payload;

  assert.equal(listResponse.statusCode, 200);
  assert.equal(listed.success, true);
  assert.equal(listed.data.length, 1);
  assert.equal(listed.data[0].id, created.data.id);
  assert.deepEqual(listed.data[0].questions.map((item) => item.id), questions.map((item) => item.id));

  const storedGroup = await PromptGroup.findByPk(created.data.id);
  assert.ok(storedGroup);
});

test('用户可以编辑问题集，删除问题集后其中的单问题仍然保留', async () => {
  const questions = await TrackedPrompt.findAll({
    where: { project_id: project.id },
    order: [['id', 'ASC']]
  });
  const createResponse = await requestRoute('post', '/:projectId/question-sets', {
    params: { projectId: project.id },
    body: {
      name: '待编辑问题集',
      question_ids: questions.map((item) => item.id)
    }
  });
  const questionSetId = createResponse.payload.data.id;

  const updateResponse = await requestRoute('patch', '/:projectId/question-sets/:questionSetId', {
    params: { projectId: project.id, questionSetId },
    body: {
      name: '已编辑问题集',
      description: '只保留一个成员',
      question_ids: [questions[0].id]
    }
  });

  assert.equal(updateResponse.statusCode, 200);
  assert.equal(updateResponse.payload.success, true);
  assert.equal(updateResponse.payload.data.name, '已编辑问题集');
  assert.deepEqual(updateResponse.payload.data.questions.map((item) => item.id), [questions[0].id]);

  const deleteResponse = await requestRoute('delete', '/:projectId/question-sets/:questionSetId', {
    params: { projectId: project.id, questionSetId }
  });

  assert.equal(deleteResponse.statusCode, 200);
  assert.equal(deleteResponse.payload.success, true);
  assert.equal(await PromptGroup.findByPk(questionSetId), null);
  const remainingQuestions = await TrackedPrompt.findAll({
    where: { project_id: project.id },
    order: [['id', 'ASC']]
  });
  assert.equal(remainingQuestions.length, 2);
  assert.equal(remainingQuestions.every((item) => item.prompt_group_id == null), true);
});

test('问题集内每个启用问题使用项目全部模型入队，单问题仍保留自己的模型范围', async () => {
  const questions = await TrackedPrompt.findAll({
    where: { project_id: project.id },
    order: [['id', 'ASC']]
  });
  const createResponse = await requestRoute('post', '/:projectId/question-sets', {
    params: { projectId: project.id },
    body: {
      name: '运行测试问题集',
      question_ids: questions.map((item) => item.id)
    }
  });
  const questionSetId = createResponse.payload.data.id;
  const originalStartQuestionSetRun = ProjectRunService.startQuestionSetRun;
  const originalEnqueue = ProjectRunService.enqueueProjectRun;
  const originalRun = ProjectRunService.runProject;
  const calls = [];
  let legacyEnqueueCalls = 0;
  ProjectRunService.startQuestionSetRun = async (options) => {
    calls.push({ type: 'set', options });
    return {
      ok: true,
      status: 202,
      message: '问题集分析已加入队列',
      data: {
        status: 'queued',
        total: options.prompts.length,
        accepted_count: options.prompts.length,
        question_set_run_id: 101,
        report_url: `/geo/question-set-reports?project_id=${project.id}&run_id=101`,
        idempotent_replay: false
      }
    };
  };
  ProjectRunService.enqueueProjectRun = async () => {
    legacyEnqueueCalls += 1;
    throw new Error('legacy question-set enqueue path should not run');
  };
  ProjectRunService.runProject = async (options) => {
    calls.push({ type: 'single', options });
    return {
      ok: true,
      status: 200,
      message: '单问题分析已完成',
      data: { total: options.prompts.length, completed: 1, failed: 0 }
    };
  };

  try {
    const runsBefore = await QuestionSetRun.count({
      where: { question_set_id: questionSetId }
    });
    const setRunResponse = await requestRoute('post', '/:projectId/question-sets/:questionSetId/run', {
      params: { projectId: project.id, questionSetId },
      headers: { 'Idempotency-Key': 'question-set-run-key-001' }
    });
    assert.equal(setRunResponse.statusCode, 202);
    assert.equal(setRunResponse.payload.success, true);
    assert.equal(calls[0].type, 'set');
    assert.deepEqual(calls[0].options.prompts.map((item) => item.id), [questions[0].id]);
    assert.deepEqual(calls[0].options.prompts[0].platforms, ['doubao', 'deepseek']);
    assert.equal(calls[0].options.promptSelectionExplicit, true);
    assert.equal(calls[0].options.idempotencyKey, 'question-set-run-key-001');
    assert.ok(Number(setRunResponse.payload.data.question_set_run_id) > 0);
    assert.match(setRunResponse.payload.data.report_url, /\/geo\/question-set-reports\?/);
    assert.equal(legacyEnqueueCalls, 0);
    assert.equal(
      await QuestionSetRun.count({ where: { question_set_id: questionSetId } }),
      runsBefore
    );

    const singleRunResponse = await requestRoute('post', '/:projectId/prompts/:promptId/run', {
      params: { projectId: project.id, promptId: questions[0].id }
    });
    assert.equal(singleRunResponse.statusCode, 200);
    assert.equal(singleRunResponse.payload.success, true);
    assert.equal(calls[1].type, 'single');
    assert.deepEqual(calls[1].options.prompts.map((item) => item.id), [questions[0].id]);
    assert.deepEqual(calls[1].options.prompts[0].platforms, ['doubao']);
  } finally {
    ProjectRunService.startQuestionSetRun = originalStartQuestionSetRun;
    ProjectRunService.enqueueProjectRun = originalEnqueue;
    ProjectRunService.runProject = originalRun;
  }
});

test('问题集运行拒绝缺失或头部与 body 冲突的幂等键', async () => {
  const group = await PromptGroup.create({
    project_id: project.id,
    user_id: user.id,
    name: '幂等键边界问题集'
  });
  const prompt = await TrackedPrompt.create({
    project_id: project.id,
    user_id: user.id,
    prompt_group_id: group.id,
    question: '幂等键边界问题',
    tags: [],
    platforms: ['doubao'],
    enabled: true
  });
  const originalStartQuestionSetRun = ProjectRunService.startQuestionSetRun;
  let startCalls = 0;
  ProjectRunService.startQuestionSetRun = async () => {
    startCalls += 1;
    return { ok: true, status: 202, data: {} };
  };

  try {
    const missing = await requestRoute('post', '/:projectId/question-sets/:questionSetId/run', {
      params: { projectId: project.id, questionSetId: group.id }
    });
    assert.equal(missing.statusCode, 400);
    assert.equal(missing.payload.data.error_code, 'INVALID_IDEMPOTENCY_KEY');

    const conflict = await requestRoute('post', '/:projectId/question-sets/:questionSetId/run', {
      params: { projectId: project.id, questionSetId: group.id },
      headers: { 'Idempotency-Key': 'header-key-0001' },
      body: { idempotency_key: 'body-key-000002' }
    });
    assert.equal(conflict.statusCode, 400);
    assert.equal(conflict.payload.data.error_code, 'INVALID_IDEMPOTENCY_KEY');
    assert.equal(startCalls, 0);
  } finally {
    ProjectRunService.startQuestionSetRun = originalStartQuestionSetRun;
    await prompt.destroy();
    await group.destroy();
  }
});

test('新建单问题时可以选择所属问题集，问题列表返回问题集标识', async () => {
  const createSetResponse = await requestRoute('post', '/:projectId/question-sets', {
    params: { projectId: project.id },
    body: { name: '单问题归属测试集' }
  });
  const questionSetId = createSetResponse.payload.data.id;
  const createQuestionResponse = await requestRoute('post', '/:projectId/prompts', {
    params: { projectId: project.id },
    body: {
      question: '新加入问题集的问题',
      question_set_id: questionSetId,
      tags: ['购买决策'],
      platforms: ['doubao'],
      enabled: true
    }
  });

  assert.equal(createQuestionResponse.statusCode, 200);
  assert.equal(createQuestionResponse.payload.success, true);

  const listResponse = await requestRoute('get', '/:projectId/prompts', {
    params: { projectId: project.id },
    query: { days: 30 }
  });
  const createdQuestion = listResponse.payload.data.find((item) => item.question === '新加入问题集的问题');

  assert.ok(createdQuestion);
  assert.equal(createdQuestion.question_set_id, questionSetId);
  assert.equal(createdQuestion.question_set.name, '单问题归属测试集');
});

test('旧分组创建路径继续兼容并返回问题集术语', async () => {
  const response = await requestRoute('post', '/:projectId/prompt-groups', {
    params: { projectId: project.id },
    body: { name: '兼容路径问题集', question_ids: [] }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.payload.success, true);
  assert.equal(response.payload.message, '问题集已创建');
  assert.equal(response.payload.data.name, '兼容路径问题集');
});

test('问题集拒绝混入非法成员 ID 而不是静默忽略', async () => {
  const before = await PromptGroup.count({ where: { project_id: project.id } });
  const question = await TrackedPrompt.findOne({ where: { project_id: project.id } });
  const response = await requestRoute('post', '/:projectId/question-sets', {
    params: { projectId: project.id },
    body: {
      name: '非法成员问题集',
      question_ids: [question.id, 'invalid-id']
    }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.payload.success, false);
  assert.match(response.payload.message, /问题 ID/);
  assert.equal(await PromptGroup.count({ where: { project_id: project.id } }), before);
});

test('问题集名称遵守数据模型的 120 字符边界', async () => {
  const response = await requestRoute('post', '/:projectId/question-sets', {
    params: { projectId: project.id },
    body: { name: '问'.repeat(121), question_ids: [] }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.payload.success, false);
  assert.match(response.payload.message, /120/);
});
