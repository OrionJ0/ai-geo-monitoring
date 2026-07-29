const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-history-evidence-'));
process.env.DB_STORAGE = path.join(databaseDir, 'test.sqlite');
process.env.JWT_SECRET = 'history-evidence-test-secret';
process.env.DEEPSEEK_WEB_EVIDENCE_DIR = path.join(databaseDir, 'web-evidence');
delete process.env.DATABASE_URL;

const router = require('../routes/detection');
const WebCaptureAccessService = require('../services/WebCaptureAccessService');
const WebCaptureDeletionService = require('../services/WebCaptureDeletionService');
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
    headers: {},
    headersSent: false,
    piped: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(headers) {
      Object.entries(headers).forEach(([name, value]) => {
        this.headers[name.toLowerCase()] = value;
      });
      this.headersSent = true;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    destroy() {
      this.destroyed = true;
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

async function createRecord({
  runId = null,
  slot = null,
  question,
  platform = 'deepseek',
  platformName = 'DeepSeek',
  modelName = 'deepseek-chat',
  providerCitations = [],
  resultSummary = {}
}) {
  const record = await QuestionRecord.create({
    user_id: user.id,
    project_id: project.id,
    question_set_run_id: runId,
    run_slot_index: slot,
    platform,
    platform_name: platformName,
    model_name: modelName,
    question,
    brand: project.name,
    brand_keywords: project.name,
    status: 'completed',
    result_summary: resultSummary
  });
  await ResultDetail.create({
    question_record_id: record.id,
    ai_response_original: `${question} 的回答`,
    provider_citations: providerCitations,
    parsing_status: 'completed'
  });
  await VisibilityMetric.create({
    project_id: project.id,
    question_record_id: record.id,
    user_id: user.id,
    platform,
    metric_semantics_version: 'configured_competitor_sov_v1'
  });
  return record;
}

async function createEvidence(recordId) {
  const recordDir = path.join(process.env.DEEPSEEK_WEB_EVIDENCE_DIR, 'records', String(recordId));
  await fs.promises.mkdir(recordDir, { recursive: true });
  await fs.promises.writeFile(path.join(recordDir, 'evidence.png'), 'evidence');
  return recordDir;
}

test.before(async () => {
  await sequelize.sync({ force: true });
  user = await User.create({
    username: 'history-evidence-user',
    email: 'history-evidence@example.com',
    password: 'not-used',
    role: 'admin',
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

test('用户历史按 deepseek-web 精确筛选并返回引用与 Web 采集元数据', async () => {
  await createRecord({
    question: 'API 样本',
    platform: 'deepseek',
    platformName: 'DeepSeek',
    modelName: 'deepseek-chat'
  });
  const webRecord = await createRecord({
    question: 'Web 样本',
    platform: 'deepseek-web',
    platformName: 'DeepSeek 网页版',
    modelName: 'deepseek-web-ui',
    providerCitations: [{
      url: 'https://example.com/explicit',
      source_role: 'explicit_citation'
    }],
    resultSummary: {
      web_capture: {
        status: 'completed',
        selector_version: 'deepseek-web-v1',
        artifact_owner_record_id: 2,
        artifacts: {
          search_state: { id: '00000000-0000-4000-8000-000000000011' },
          final_answer: { id: '00000000-0000-4000-8000-000000000012' }
        }
      }
    }
  });
  await webRecord.update({
    result_summary: {
      ...webRecord.result_summary,
      web_capture: {
        ...webRecord.result_summary.web_capture,
        artifact_owner_record_id: webRecord.id
      }
    }
  });

  const response = await requestRoute('get', '/history/:userId', {
    params: { userId: user.id },
    query: { platform: 'deepseek-web' }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.data.total, 1);
  assert.equal(response.payload.data.records[0].platform, 'deepseek-web');
  assert.equal(response.payload.data.records[0].platform_name, 'DeepSeek 网页版');
  assert.equal(response.payload.data.records[0].model_name, 'deepseek-web-ui');
  assert.deepEqual(
    response.payload.data.records[0].resultDetail.provider_citations,
    [{
      url: 'https://example.com/explicit',
      source_role: 'explicit_citation'
    }]
  );
  assert.equal(
    response.payload.data.records[0].result_summary.web_capture.selector_version,
    'deepseek-web-v1'
  );

  const adminResponse = await requestRoute('get', '/history', {
    query: { platform: 'deepseek-web' }
  });
  assert.equal(adminResponse.statusCode, 200);
  assert.equal(adminResponse.payload.data.total, 1);
  assert.equal(adminResponse.payload.data.records[0].platform, 'deepseek-web');
  assert.deepEqual(
    adminResponse.payload.data.records[0].resultDetail.provider_citations,
    [{
      url: 'https://example.com/explicit',
      source_role: 'explicit_citation'
    }]
  );
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

test('单条检测历史删除会在数据库提交后清理对应 Web 证据', async () => {
  const record = await createRecord({
    question: '带网页证据的普通记录',
    platform: 'deepseek-web'
  });
  const evidenceDir = await createEvidence(record.id);

  const response = await requestRoute('delete', '/record/:id', {
    params: { id: record.id }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(await QuestionRecord.findByPk(record.id), null);
  await assert.rejects(fs.promises.access(evidenceDir));
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
    question: '可删除的当前缓存',
    platform: 'deepseek-web'
  });
  const protectedEvidenceDir = await createEvidence(protectedRecord.id);
  const mutableEvidenceDir = await createEvidence(mutableRecord.id);

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
  await fs.promises.access(protectedEvidenceDir);
  await assert.rejects(fs.promises.access(mutableEvidenceDir));
});

test('数据库事务回滚时恢复已隔离的 Web 证据', async () => {
  const record = await createRecord({
    question: '事务回滚记录',
    platform: 'deepseek-web'
  });
  const evidenceDir = await createEvidence(record.id);
  const originalDestroy = ResultDetail.destroy;
  ResultDetail.destroy = async () => {
    throw new Error('synthetic rollback');
  };
  try {
    const response = await requestRoute('delete', '/record/:id', {
      params: { id: record.id }
    });
    assert.equal(response.statusCode, 500);
  } finally {
    ResultDetail.destroy = originalDestroy;
  }

  assert.ok(await QuestionRecord.findByPk(record.id));
  await fs.promises.access(path.join(evidenceDir, 'evidence.png'));
});

test('数据库提交后清理失败返回稳定错误且隔离证据不再可读', async () => {
  const record = await createRecord({
    question: '提交后清理失败记录',
    platform: 'deepseek-web'
  });
  const evidenceDir = await createEvidence(record.id);
  const originalCommit = WebCaptureDeletionService.captureStore.commitQuarantine;
  WebCaptureDeletionService.captureStore.commitQuarantine = async () => {
    throw new Error('synthetic cleanup failure');
  };
  let response;
  try {
    response = await requestRoute('delete', '/record/:id', {
      params: { id: record.id }
    });
  } finally {
    WebCaptureDeletionService.captureStore.commitQuarantine = originalCommit;
  }

  assert.equal(response.statusCode, 500);
  assert.equal(response.payload.error_code, 'web_capture_cleanup_incomplete');
  assert.equal(await QuestionRecord.findByPk(record.id), null);
  await assert.rejects(fs.promises.access(evidenceDir));
  assert.equal(
    await WebCaptureDeletionService.captureStore.reconcileTrash({
      recordExists: async (recordId) => Boolean(
        await QuestionRecord.findByPk(recordId)
      )
    }),
    1
  );
});

test('证据读取路由返回私有图片响应头并以内联流输出', async () => {
  const originalOpen = WebCaptureAccessService.openForUser;
  const stream = {
    on() {
      return this;
    },
    pipe(target) {
      target.piped = true;
      return target;
    }
  };
  WebCaptureAccessService.openForUser = async () => ({
    stream,
    mimeType: 'image/png',
    bytes: 128
  });
  try {
    const response = await requestRoute(
      'get',
      '/record/:recordId/web-captures/:artifactId',
      {
        params: {
          recordId: 12,
          artifactId: '00000000-0000-4000-8000-000000000041'
        }
      }
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'image/png');
    assert.equal(response.headers['content-length'], '128');
    assert.equal(response.headers['content-disposition'], 'inline');
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.piped, true);
  } finally {
    WebCaptureAccessService.openForUser = originalOpen;
  }
});
