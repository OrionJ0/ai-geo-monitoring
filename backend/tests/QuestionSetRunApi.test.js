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
  QuestionRecord,
  QuestionSetRun,
  ResultDetail
} = require('../models');
const AIPlatformService = require('../services/AIPlatformService');
const ProjectRunService = require('../services/ProjectRunService');
const originalAnalysisConfigService = ProjectRunService.analysisConfigService;

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
    if (handlers[index].name === 'textParser') return dispatch(index + 1);
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
    platforms: ['deepseek', 'qwen'],
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
  ProjectRunService.analysisConfigService = {
    getAnalysisPlatform: async () => ({ code: 'analysis-ready' })
  };
});

test.after(async () => {
  ProjectRunService.analysisConfigService = originalAnalysisConfigService;
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
  assert.equal(listResponse.payload.data[0].capabilities.can_retry, false);
  assert.equal(
    listResponse.payload.data[0].capabilities.retry_disabled_reason,
    'imported_report_read_only'
  );
  assert.equal(listResponse.payload.pagination.totalItems, 1);

  const detailResponse = await requestRoute('get', '/:projectId/question-set-runs/:runId', {
    params: { projectId: project.id, runId: run.id }
  });

  assert.equal(detailResponse.statusCode, 200);
  assert.equal(detailResponse.payload.data.id, run.id);
  assert.equal(detailResponse.payload.data.source, 'imported');
  assert.deepEqual(detailResponse.payload.data.capabilities, {
    can_pause: false,
    pause_disabled_reason: 'imported_report_read_only',
    can_resume: false,
    resume_disabled_reason: 'imported_report_read_only',
    can_retry: false,
    retry_disabled_reason: 'imported_report_read_only'
  });
  assert.equal(detailResponse.payload.data.rows[0].answer, '广拓是一家周界报警厂商。');
});

test('用户可以按问题集筛选运行历史', async () => {
  const firstQuestionSetRun = await QuestionSetRun.create({
    project_id: project.id,
    user_id: user.id,
    question_set_id: 101,
    question_set_name: '采购决策问题集',
    source: 'native'
  });
  await QuestionSetRun.create({
    project_id: project.id,
    user_id: user.id,
    question_set_id: 202,
    question_set_name: '品牌认知问题集',
    source: 'native'
  });

  const filteredResponse = await requestRoute('get', '/:projectId/question-set-runs', {
    params: { projectId: project.id },
    query: { page: 1, pageSize: 20, questionSetId: 101 }
  });

  assert.equal(filteredResponse.statusCode, 200);
  assert.equal(filteredResponse.payload.pagination.totalItems, 1);
  assert.deepEqual(filteredResponse.payload.data.map((item) => item.id), [firstQuestionSetRun.id]);

  const invalidResponse = await requestRoute('get', '/:projectId/question-set-runs', {
    params: { projectId: project.id },
    query: { questionSetId: 'invalid' }
  });
  assert.equal(invalidResponse.statusCode, 400);
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
    body: exportResponse.payload
  });

  assert.equal(importResponse.statusCode, 201);
  assert.equal(importResponse.payload.data.source, 'imported');
  assert.equal(importResponse.payload.data.summary.total, 1);
  assert.equal(importResponse.payload.data.rows[0].answer, '广拓是一家周界报警厂商。');

  const beforeInvalidImport = await QuestionSetRun.count({ where: { project_id: project.id } });
  const invalidResponse = await requestRoute('post', '/:projectId/question-set-runs/import', {
    params: { projectId: project.id },
    body: 'wrong,columns\n1,2'
  });
  assert.equal(invalidResponse.statusCode, 422);
  assert.equal(invalidResponse.payload.error.code, 'MISSING_COLUMNS');
  assert.equal(await QuestionSetRun.count({ where: { project_id: project.id } }), beforeInvalidImport);

  const pendingCsv = exportResponse.payload.replace(',completed,,', ',pending,,');
  const pendingResponse = await requestRoute('post', '/:projectId/question-set-runs/import', {
    params: { projectId: project.id },
    body: pendingCsv
  });
  assert.equal(pendingResponse.statusCode, 422);
  assert.deepEqual({
    code: pendingResponse.payload.error.code,
    row: pendingResponse.payload.error.row,
    column: pendingResponse.payload.error.column
  }, {
    code: 'NON_TERMINAL_STATUS',
    row: 2,
    column: 'status'
  });
  assert.equal(await QuestionSetRun.count({ where: { project_id: project.id } }), beforeInvalidImport);
});

test('用户可以在原报告中重试失败项且重复提交不会创建第二批任务', async () => {
  const failedRecord = await QuestionRecord.create({
    user_id: user.id,
    project_id: project.id,
    tracked_prompt_id: 77,
    platform: 'qwen',
    platform_name: '千问',
    model_name: 'qwen-old-model',
    question: '哪些周界报警厂家比较靠谱？',
    brand: project.name,
    brand_keywords: project.name,
    status: 'failed',
    error_message: '监测平台调用失败，请稍后重试'
  });
  const nativeRun = await QuestionSetRun.create({
    project_id: project.id,
    user_id: user.id,
    question_set_id: 88,
    question_set_name: '失败项重试测试',
    source: 'native',
    planned_record_count: 1,
    imported_rows: [{
      record_id: failedRecord.id,
      question: failedRecord.question,
      platform: 'qwen',
      status: 'failed'
    }],
    completed_at: new Date()
  });
  await failedRecord.update({
    question_set_run_id: nativeRun.id,
    run_slot_index: 0
  });

  const originalGetAvailability = AIPlatformService.getPlatformAvailability;
  const originalGetRuntimeSettings = ProjectRunService.getRuntimeSettings;
  const originalConsumeQuota = ProjectRunService.consumeRunQuota;
  const originalSchedule = ProjectRunService.schedulePreparedRun;
  let scheduledContext = null;
  let quotaCalls = 0;
  let scheduleCalls = 0;

  AIPlatformService.getPlatformAvailability = async () => [{
    code: 'qwen',
    platform_name: '千问',
    model_name: 'qwen-current-model',
    available: true,
    reason: null,
    config: { code: 'qwen', default_model: 'qwen-current-model', temperature: 0.3 }
  }];
  ProjectRunService.getRuntimeSettings = async () => ({ ai_run_concurrency: 2 });
  ProjectRunService.consumeRunQuota = async () => {
    quotaCalls += 1;
    return { ok: true, used: 1, limit: 100 };
  };
  ProjectRunService.schedulePreparedRun = (context) => {
    scheduleCalls += 1;
    scheduledContext = context;
  };

  try {
    const response = await requestRoute('post', '/:projectId/question-set-runs/:runId/retry-failed', {
      params: { projectId: project.id, runId: nativeRun.id },
      body: { idempotency_key: 'retry-batch-qwen-001' }
    });

    assert.equal(response.statusCode, 202);
    assert.equal(response.payload.success, true);
    assert.equal(response.payload.data.retried_count, 1);
    assert.equal(scheduledContext.entries.length, 1);
    assert.equal(scheduledContext.runRevision, 1);
    assert.equal(scheduledContext.entries[0].target.model_name, 'qwen-current-model');
    assert.equal(scheduledContext.entries[0].target.platformConfig.temperature, 0.3);

    await nativeRun.reload();
    assert.deepEqual(nativeRun.imported_rows, []);
    assert.equal(nativeRun.completed_at, null);

    const retryRecord = await QuestionRecord.findOne({
      where: {
        question_set_run_id: nativeRun.id,
        run_slot_index: 0
      }
    });
    assert.notEqual(retryRecord.id, failedRecord.id);
    assert.equal(retryRecord.status, 'pending');
    assert.equal(retryRecord.model_name, 'qwen-current-model');
    assert.equal(retryRecord.result_summary.retry.previous_record_id, failedRecord.id);
    await failedRecord.reload();
    assert.equal(failedRecord.status, 'failed');
    assert.equal(failedRecord.question_set_run_id, nativeRun.id);
    assert.equal(failedRecord.run_slot_index, null);
    await retryRecord.update({ status: 'failed', error_message: '再次失败' });

    const duplicate = await requestRoute('post', '/:projectId/question-set-runs/:runId/retry-failed', {
      params: { projectId: project.id, runId: nativeRun.id },
      body: { idempotency_key: 'retry-batch-qwen-001' }
    });
    assert.equal(duplicate.statusCode, 202);
    assert.equal(duplicate.payload.data.idempotent_replay, true);
    assert.deepEqual(duplicate.payload.data.record_ids, response.payload.data.record_ids);
    assert.equal(quotaCalls, 1);
    assert.equal(scheduleCalls, 1);
  } finally {
    AIPlatformService.getPlatformAvailability = originalGetAvailability;
    ProjectRunService.getRuntimeSettings = originalGetRuntimeSettings;
    ProjectRunService.consumeRunQuota = originalConsumeQuota;
    ProjectRunService.schedulePreparedRun = originalSchedule;
  }
});

test('结构化分析失败时复用原回答且不重新消耗监测配额', async () => {
  const failedRecord = await QuestionRecord.create({
    user_id: user.id,
    project_id: project.id,
    tracked_prompt_id: 78,
    platform: 'deepseek-web',
    platform_name: 'DeepSeek 网页版',
    model_name: 'deepseek-web-ui',
    question: '哪些周界报警厂家比较靠谱？',
    brand: project.name,
    brand_keywords: project.name,
    status: 'failed',
    error_message: 'AI 结构化分析失败，本条未计入有效样本',
    result_summary: {
      failure: {
        stage: 'analysis_validation',
        error_code: 'invalid_analysis_output'
      },
      analysis: {
        status: 'failed',
        stage: 'parse_or_validate',
        error_code: 'invalid_analysis_output'
      }
    }
  });
  const originalWebCapture = {
    schema_version: 'deepseek-web-capture-v1',
    status: 'completed',
    artifact_owner_record_id: failedRecord.id,
    artifacts: {
      final_answer: {
        id: '00000000-0000-4000-8000-000000000003',
        sha256: 'a'.repeat(64),
        bytes: 1024,
        mime_type: 'image/png'
      }
    }
  };
  await failedRecord.update({
    result_summary: {
      ...failedRecord.result_summary,
      web_capture: originalWebCapture
    }
  });
  await ResultDetail.create({
    question_record_id: failedRecord.id,
    ai_response_original: '海康威视、上海广拓和大华股份都可以作为候选。',
    provider_citations: [{
      url: 'https://example.com/qwen-source',
      title: '千问检索来源',
      source_origin: 'web_search'
    }],
    parsing_status: 'completed'
  });
  const nativeRun = await QuestionSetRun.create({
    project_id: project.id,
    user_id: user.id,
    question_set_id: 89,
    question_set_name: '仅重试结构化分析',
    source: 'native',
    planned_record_count: 1,
    completed_at: new Date()
  });
  await failedRecord.update({
    question_set_run_id: nativeRun.id,
    run_slot_index: 0
  });

  const originalConsumeQuota = ProjectRunService.consumeRunQuota;
  const originalSchedule = ProjectRunService.schedulePreparedRun;
  let quotaCalls = 0;
  let scheduledContext = null;
  ProjectRunService.consumeRunQuota = async () => {
    quotaCalls += 1;
    return { ok: true };
  };
  ProjectRunService.schedulePreparedRun = (context) => {
    scheduledContext = context;
  };

  try {
    const response = await requestRoute('post', '/:projectId/question-set-runs/:runId/retry-failed', {
      params: { projectId: project.id, runId: nativeRun.id }
    });

    assert.equal(response.statusCode, 202);
    assert.equal(response.payload.data.analysis_only_count, 1);
    assert.equal(response.payload.data.full_monitoring_count, 0);
    assert.equal(response.payload.data.quota_consumed, 0);
    assert.equal(quotaCalls, 0);
    assert.equal(scheduledContext.entries[0].retryMode, 'analysis_only');
    assert.equal(
      scheduledContext.entries[0].responseText,
      '海康威视、上海广拓和大华股份都可以作为候选。'
    );
    assert.deepEqual(scheduledContext.entries[0].providerCitations, [{
      url: 'https://example.com/qwen-source',
      title: '千问检索来源',
      source_origin: 'web_search'
    }]);

    const retryRecord = await QuestionRecord.findOne({
      where: {
        question_set_run_id: nativeRun.id,
        run_slot_index: 0
      }
    });
    assert.equal(retryRecord.result_summary.retry.kind, 'analysis_only');
    assert.equal(retryRecord.execution_mode, 'analysis_only');
    assert.deepEqual(retryRecord.result_summary.web_capture, originalWebCapture);
    assert.equal(
      retryRecord.result_summary.web_capture.artifact_owner_record_id,
      failedRecord.id
    );
    const copiedDetail = await ResultDetail.findOne({
      where: { question_record_id: retryRecord.id }
    });
    assert.equal(copiedDetail.ai_response_original, '海康威视、上海广拓和大华股份都可以作为候选。');
    assert.deepEqual(copiedDetail.provider_citations, [{
      url: 'https://example.com/qwen-source',
      title: '千问检索来源',
      source_origin: 'web_search'
    }]);
  } finally {
    ProjectRunService.consumeRunQuota = originalConsumeQuota;
    ProjectRunService.schedulePreparedRun = originalSchedule;
  }
});

test('导入报告不可重试，非法运行 ID 会被拒绝', async () => {
  const importedResponse = await requestRoute('post', '/:projectId/question-set-runs/:runId/retry-failed', {
    params: { projectId: project.id, runId: run.id }
  });
  assert.equal(importedResponse.statusCode, 409);
  assert.match(importedResponse.payload.message, /导入报告/);

  const invalidResponse = await requestRoute('post', '/:projectId/question-set-runs/:runId/retry-failed', {
    params: { projectId: project.id, runId: 'invalid' }
  });
  assert.equal(invalidResponse.statusCode, 400);
});

test('重试配额不足时恢复原报告且不留下待处理记录', async () => {
  const failedRecord = await QuestionRecord.create({
    user_id: user.id,
    project_id: project.id,
    tracked_prompt_id: 91,
    platform: 'qwen',
    platform_name: '千问',
    model_name: 'qwen-old-model',
    question: '配额回滚测试问题',
    brand: project.name,
    brand_keywords: project.name,
    status: 'failed',
    error_message: '监测平台调用失败，请稍后重试'
  });
  const cachedRows = [{
    record_id: failedRecord.id,
    question: failedRecord.question,
    platform: 'qwen',
    status: 'failed'
  }];
  const completedAt = new Date('2026-07-23T08:00:00.000Z');
  const nativeRun = await QuestionSetRun.create({
    project_id: project.id,
    user_id: user.id,
    question_set_id: 92,
    question_set_name: '配额回滚测试',
    source: 'native',
    planned_record_count: 1,
    imported_rows: cachedRows,
    completed_at: completedAt
  });
  await failedRecord.update({
    question_set_run_id: nativeRun.id,
    run_slot_index: 0
  });

  const originalGetAvailability = AIPlatformService.getPlatformAvailability;
  const originalGetRuntimeSettings = ProjectRunService.getRuntimeSettings;
  const originalConsumeQuota = ProjectRunService.consumeRunQuota;
  const originalSchedule = ProjectRunService.schedulePreparedRun;
  let scheduled = false;

  AIPlatformService.getPlatformAvailability = async () => [{
    code: 'qwen',
    platform_name: '千问',
    model_name: 'qwen-current-model',
    available: true,
    reason: null,
    config: { code: 'qwen', default_model: 'qwen-current-model' }
  }];
  ProjectRunService.getRuntimeSettings = async () => ({ ai_run_concurrency: 2 });
  ProjectRunService.consumeRunQuota = async () => ({ ok: false, reason: 'exceeded' });
  ProjectRunService.schedulePreparedRun = () => {
    scheduled = true;
  };

  try {
    const beforeCount = await QuestionRecord.count({ where: { project_id: project.id } });
    const response = await requestRoute('post', '/:projectId/question-set-runs/:runId/retry-failed', {
      params: { projectId: project.id, runId: nativeRun.id }
    });

    assert.equal(response.statusCode, 403);
    assert.match(response.payload.message, /次数不足/);
    assert.equal(scheduled, false);
    assert.equal(await QuestionRecord.count({ where: { project_id: project.id } }), beforeCount);

    await nativeRun.reload();
    assert.deepEqual(nativeRun.imported_rows, cachedRows);
    assert.equal(nativeRun.completed_at.toISOString(), completedAt.toISOString());
    await failedRecord.reload();
    assert.equal(failedRecord.run_slot_index, 0);
  } finally {
    AIPlatformService.getPlatformAvailability = originalGetAvailability;
    ProjectRunService.getRuntimeSettings = originalGetRuntimeSettings;
    ProjectRunService.consumeRunQuota = originalConsumeQuota;
    ProjectRunService.schedulePreparedRun = originalSchedule;
  }
});

test('完整监测重试不会调用已移出当前项目范围的平台', async () => {
  const scopedProject = await BrandProject.create({
    user_id: user.id,
    name: '平台范围测试',
    aliases: [],
    primary_keywords: [],
    platforms: ['deepseek'],
    status: 'active'
  });
  const failedRecord = await QuestionRecord.create({
    user_id: user.id,
    project_id: scopedProject.id,
    tracked_prompt_id: 92,
    platform: 'qwen',
    platform_name: '千问',
    model_name: 'qwen-old-model',
    question: '平台范围测试问题',
    brand: scopedProject.name,
    brand_keywords: scopedProject.name,
    status: 'failed',
    error_message: '平台账户额度不足，请补充额度后重试。',
    result_summary: {
      failure: {
        stage: 'monitoring_request',
        error_code: 'provider_quota_exhausted'
      }
    }
  });
  const nativeRun = await QuestionSetRun.create({
    project_id: scopedProject.id,
    user_id: user.id,
    question_set_id: 93,
    question_set_name: '平台范围测试',
    source: 'native',
    planned_record_count: 1,
    completed_at: new Date()
  });
  await failedRecord.update({
    question_set_run_id: nativeRun.id,
    run_slot_index: 0
  });

  const originalConsumeQuota = ProjectRunService.consumeRunQuota;
  let quotaCalls = 0;
  ProjectRunService.consumeRunQuota = async () => {
    quotaCalls += 1;
    return { ok: true };
  };

  try {
    const response = await requestRoute('post', '/:projectId/question-set-runs/:runId/retry-failed', {
      params: { projectId: scopedProject.id, runId: nativeRun.id }
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.payload.data.error_code, 'all_retry_platforms_unavailable');
    assert.equal(response.payload.data.skipped_platforms[0].reason, 'outside_project_scope');
    assert.equal(quotaCalls, 0);
  } finally {
    ProjectRunService.consumeRunQuota = originalConsumeQuota;
  }
});

test('不能从另一个项目重试不属于它的运行报告', async () => {
  const otherProject = await BrandProject.create({
    user_id: user.id,
    name: '其他项目',
    aliases: [],
    primary_keywords: [],
    platforms: ['qwen'],
    status: 'active'
  });

  const response = await requestRoute('post', '/:projectId/question-set-runs/:runId/retry-failed', {
    params: { projectId: otherProject.id, runId: run.id }
  });

  assert.equal(response.statusCode, 404);
  assert.match(response.payload.message, /运行报告不存在/);
});

test('暂停和恢复接口不能操作另一个项目的问题集运行', async () => {
  const otherProject = await BrandProject.create({
    user_id: user.id,
    name: '暂停隔离项目',
    aliases: [],
    primary_keywords: [],
    platforms: ['qwen'],
    status: 'active'
  });
  const pending = await QuestionRecord.create({
    user_id: user.id,
    project_id: otherProject.id,
    platform: 'qwen',
    question: '隔离测试',
    brand: otherProject.name,
    brand_keywords: otherProject.name,
    status: 'pending'
  });
  const otherRun = await QuestionSetRun.create({
    project_id: otherProject.id,
    user_id: user.id,
    question_set_name: '隔离测试',
    source: 'native',
    planned_record_count: 1
  });
  await pending.update({
    question_set_run_id: otherRun.id,
    run_slot_index: 0
  });

  const pauseResponse = await requestRoute('post', '/:projectId/question-set-runs/:runId/pause', {
    params: { projectId: project.id, runId: otherRun.id }
  });
  assert.equal(pauseResponse.statusCode, 404);

  await otherRun.update({ paused_at: new Date() });
  const resumeResponse = await requestRoute('post', '/:projectId/question-set-runs/:runId/resume', {
    params: { projectId: project.id, runId: otherRun.id }
  });
  assert.equal(resumeResponse.statusCode, 404);
});

test('重试接口不会把未知后端异常或数据库细节返回给浏览器', async () => {
  const originalRetry = ProjectRunService.retryFailedQuestionSetRun;
  ProjectRunService.retryFailedQuestionSetRun = async () => {
    throw new Error('SQLITE_CONSTRAINT: secret internal row payload');
  };

  try {
    const response = await requestRoute('post', '/:projectId/question-set-runs/:runId/retry-failed', {
      params: { projectId: project.id, runId: 99999 },
      body: { idempotency_key: 'safe-error-test-001' }
    });
    assert.equal(response.statusCode, 500);
    assert.equal(response.payload.message, '重试失败项失败');
    assert.doesNotMatch(JSON.stringify(response.payload), /SQLITE|secret|row payload/);
  } finally {
    ProjectRunService.retryFailedQuestionSetRun = originalRetry;
  }
});

test('重试接口向浏览器返回可操作的分析 API 配置错误', async () => {
  const originalRetry = ProjectRunService.retryFailedQuestionSetRun;
  ProjectRunService.retryFailedQuestionSetRun = async () => {
    throw Object.assign(new Error('尚未配置 AI 分析 API，请先在设置中心完成配置。'), {
      status: 503,
      exposeToClient: true,
      data: {
        error_code: 'analysis_api_not_configured',
        settings_url: '/admin/settings'
      }
    });
  };

  try {
    const response = await requestRoute('post', '/:projectId/question-set-runs/:runId/retry-failed', {
      params: { projectId: project.id, runId: 99999 },
      body: { idempotency_key: 'analysis-config-error-001' }
    });
    assert.equal(response.statusCode, 503);
    assert.match(response.payload.message, /尚未配置 AI 分析 API/);
    assert.deepEqual(response.payload.data, {
      error_code: 'analysis_api_not_configured',
      settings_url: '/admin/settings'
    });
  } finally {
    ProjectRunService.retryFailedQuestionSetRun = originalRetry;
  }
});

test('重试接口不会仅凭 analysis 错误码透传未知 503 异常', async () => {
  const originalRetry = ProjectRunService.retryFailedQuestionSetRun;
  ProjectRunService.retryFailedQuestionSetRun = async () => {
    throw Object.assign(new Error('数据库连接串等内部细节'), {
      status: 503,
      data: {
        error_code: 'analysis_internal_failure',
        settings_url: '/admin/settings'
      }
    });
  };

  try {
    const response = await requestRoute('post', '/:projectId/question-set-runs/:runId/retry-failed', {
      params: { projectId: project.id, runId: 99999 },
      body: { idempotency_key: 'analysis-unknown-error-001' }
    });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.payload, {
      success: false,
      message: '重试失败项失败'
    });
  } finally {
    ProjectRunService.retryFailedQuestionSetRun = originalRetry;
  }
});
