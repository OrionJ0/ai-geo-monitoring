#!/usr/bin/env node
/**
 * 010 v5 正式入口验收。
 *
 * 本脚本只能在正式服务器运行，只访问唯一受支持的 HTTPS 入口。它不会启动
 * 第二套应用、修改 AI 平台配置、读取/传递 API Key，也不会创建临时数据库。
 * 验收 JWT 只在服务器进程内短期签发和使用，验收证据写入 /tmp 且不包含
 * JWT、问题正文或上游原始响应。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const jwt = require('jsonwebtoken');

const BACKEND_ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(BACKEND_ROOT, '.env'), quiet: true });

const OFFICIAL_BASE = 'https://insight.guangtuo.com/api';
const OFFICIAL_ORIGIN = 'https://insight.guangtuo.com';
const FRONTEND_HEALTH_URL = `${OFFICIAL_BASE}/frontend-health`;
const V5_CONTRACT = 'ai_structured_v5';
const V5_METHOD = 'ai_structured_v5';
const V5_SEMANTICS = 'contextual_competitor_mentions_sov_v2_scoped';
const FLASH_MODEL = 'deepseek-v4-flash';
const HTTP_TIMEOUT_MS = 30 * 1000;
const ACCEPTANCE_TOTAL_TIMEOUT_MS = 300 * 60 * 1000;
const RECORD_BATCH_BUFFER_MS = 5 * 60 * 1000;
const DEPLOYMENT_CLEANUP_MARGIN_MS = 10 * 60 * 1000;
const DEPLOYMENT_STAGE_RESERVE_MS = 60 * 60 * 1000;
const acceptanceShutdown = new AbortController();

function abortableSleep(ms, signal = acceptanceShutdown.signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, ms);
    function finish(error = null) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    }
    function onAbort() {
      const error = signal?.reason instanceof Error
        ? signal.reason
        : new Error('010 正式入口验收已取消');
      error.code ||= 'acceptance_cancelled';
      finish(error);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function sleep(ms) {
  return abortableSleep(ms);
}

function requestSignal(cleanup = false) {
  const timeout = AbortSignal.timeout(HTTP_TIMEOUT_MS);
  return cleanup
    ? timeout
    : AbortSignal.any([acceptanceShutdown.signal, timeout]);
}

function idempotencyKey(label, nonce) {
  return `geo010-${label}-${nonce}`.slice(0, 120);
}

function readRequiredRevision(argv = process.argv.slice(2)) {
  const values = argv.filter((value) => value.startsWith('--revision='));
  if (values.length !== 1 || argv.length !== 1) {
    throw new Error('必须且只能提供 --revision=<40位提交 SHA>');
  }
  const revision = values[0].slice('--revision='.length).trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(revision)) throw new Error('revision 必须是 40 位 Git SHA');
  return revision;
}

function extractRecordIds(payload) {
  const data = payload?.data || payload || {};
  const candidates = [
    ...(Array.isArray(data.record_ids) ? data.record_ids : []),
    ...(Array.isArray(data.results) ? data.results.map((row) => row?.record_id) : []),
    ...(Array.isArray(data.records) ? data.records.map((row) => row?.record_id || row?.id) : []),
    data.record_id,
    data.first_record_id
  ];
  return [...new Set(candidates.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
}

function extractRecordId(payload) {
  return extractRecordIds(payload)[0] || null;
}

function toEvidence(record) {
  const row = record?.toJSON ? record.toJSON() : record;
  const metric = row?.visibilityMetric || row?.visibility_metric || {};
  const structure = metric?.analysis_structure || {};
  const stages = Array.isArray(structure?.diagnostics?.stages)
    ? structure.diagnostics.stages.map((stage) => ({
        stage: stage?.stage || null,
        platform: stage?.platform || null,
        model: stage?.model || null,
        degraded: stage?.degraded === true
      }))
    : [];
  return {
    id: Number(row?.id),
    status: row?.status || null,
    execution_mode: row?.execution_mode || null,
    analysis_contract_version: row?.analysis_contract_version || null,
    metric_semantics_version: metric?.metric_semantics_version
      || row?.metric_semantics_version
      || null,
    analysis_method: metric?.analysis_method || null,
    analysis_platform: metric?.analysis_platform || null,
    analysis_model: metric?.analysis_model || null,
    structure_version: structure?.schema_version || null,
    contract_revision: structure?.contract_revision || null,
    diagnostic_stages: stages
  };
}

function evaluateEvidence(entries, historyV4Readable) {
  const requiredNames = [
    'single_question',
    'question_set',
    'automatic_monitoring',
    'analysis_only'
  ];
  const checks = Object.fromEntries(requiredNames.map((name) => {
    const rows = Array.isArray(entries?.[name]) ? entries[name] : [];
    return [name, Boolean(
      rows.length > 0
      && rows.every((row) => (
        row.status === 'completed'
        && row.analysis_contract_version === V5_CONTRACT
        && row.metric_semantics_version === V5_SEMANTICS
        && row.analysis_method === V5_METHOD
        && row.analysis_platform === 'deepseek'
        && row.analysis_model === FLASH_MODEL
        && row.structure_version === 'geo_metric_input_v5'
        && row.contract_revision === 'three_track_partial_v2'
        && row.diagnostic_stages.some((stage) => stage.stage === 'entity_extract')
        && row.diagnostic_stages.some((stage) => stage.stage === 'semantic_judge')
        && (name !== 'analysis_only' || row.execution_mode === 'analysis_only')
      ))
    )];
  }));
  return {
    required_entries: requiredNames,
    entry_checks: checks,
    history_v4_readable: historyV4Readable === true,
    pass: requiredNames.every((name) => checks[name]) && historyV4Readable === true
  };
}

async function api(method, urlPath, {
  body,
  token,
  idempotency,
  cleanup = false
} = {}) {
  const response = await fetch(`${OFFICIAL_BASE}${urlPath}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(idempotency ? { 'Idempotency-Key': idempotency } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: requestSignal(cleanup)
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (_) {
    payload = null;
  }
  if (!response.ok) {
    const safeCode = String(payload?.data?.error_code || payload?.error?.code || 'http_error').slice(0, 80);
    throw new Error(`${method} ${urlPath} -> ${response.status} (${safeCode})`);
  }
  return payload;
}

async function rawApi(method, urlPath, { token, cleanup = false } = {}) {
  const response = await fetch(`${OFFICIAL_BASE}${urlPath}`, {
    method,
    headers: {
      Accept: '*/*',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    signal: requestSignal(cleanup)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${urlPath} -> ${response.status}`);
  return { text, headers: Object.fromEntries(response.headers.entries()) };
}

async function readPublicRevision(url, expectedRevision) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: requestSignal()
  });
  const payload = await response.json().catch(() => null);
  if (response.status !== 200) throw new Error(`${url} 未就绪 (${response.status})`);
  const revision = String(payload?.revision || payload?.data?.revision || '').toLowerCase();
  if (revision !== expectedRevision) throw new Error(`${url} revision 与候选 SHA 不一致`);
  return { status: response.status, revision };
}

async function readPublicRevisionValue(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: requestSignal()
  });
  const payload = await response.json().catch(() => null);
  const revision = String(payload?.revision || payload?.data?.revision || '').toLowerCase();
  if (response.status !== 200 || !/^[a-f0-9]{40}$/u.test(revision)) {
    throw new Error(`${url} 没有返回可验证的正式 revision`);
  }
  return revision;
}

async function readPublicReadiness(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: requestSignal()
  });
  const payload = await response.json().catch(() => null);
  if (response.status !== 200 || payload?.status !== 'ready') {
    throw new Error(`${url} 未就绪 (${response.status})`);
  }
  return { status: response.status, readiness: payload.status };
}

async function waitRecord(
  QuestionRecord,
  VisibilityMetric,
  recordId,
  projectId,
  timeoutMs
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await QuestionRecord.findOne({
      where: { id: recordId, project_id: projectId },
      include: [{ model: VisibilityMetric, as: 'visibilityMetric', required: false }]
    });
    if (row?.status === 'completed') return row;
    if (row?.status === 'failed') throw new Error(`record ${recordId} 执行失败`);
    await sleep(3000);
  }
  throw new Error(`record ${recordId} 未在 ${timeoutMs}ms 内完成`);
}

function recordBatchWaitTimeoutMs(recordCount, concurrency, recordLeaseMs) {
  const count = Math.max(1, Number(recordCount) || 1);
  const workers = Math.max(1, Number(concurrency) || 1);
  const lease = Math.max(60_000, Number(recordLeaseMs) || 60_000);
  return Math.ceil(count / workers) * lease + RECORD_BATCH_BUFFER_MS;
}

function acceptanceRequiredTimeoutMs(platformCount, concurrency, recordLeaseMs) {
  const count = Math.max(1, Number(platformCount) || 1);
  return [count, count, count * 2, 1].reduce(
    (total, batchSize) => total + recordBatchWaitTimeoutMs(
      batchSize,
      concurrency,
      recordLeaseMs
    ),
    0
  );
}

function acceptanceAvailableTimeoutMs(now = Date.now(), environment = process.env) {
  const deploymentDeadline = Number(environment.AI_GEO_DEPLOYMENT_DEADLINE_EPOCH_MS);
  if (!Number.isFinite(deploymentDeadline) || deploymentDeadline <= 0) {
    return ACCEPTANCE_TOTAL_TIMEOUT_MS;
  }
  const deploymentStageReserve = environment.AI_GEO_ACCEPTANCE_STAGE === 'preflight'
    ? DEPLOYMENT_STAGE_RESERVE_MS
    : 0;
  return Math.min(
    ACCEPTANCE_TOTAL_TIMEOUT_MS,
    Math.max(
      0,
      deploymentDeadline - now - DEPLOYMENT_CLEANUP_MARGIN_MS - deploymentStageReserve
    )
  );
}

function assertAcceptanceBudget({
  platformCount,
  concurrency,
  recordLeaseMs,
  availableMs
}) {
  const requiredMs = acceptanceRequiredTimeoutMs(
    platformCount,
    concurrency,
    recordLeaseMs
  );
  const normalizedAvailableMs = Math.max(0, Number(availableMs) || 0);
  if (requiredMs > normalizedAvailableMs) {
    throw new Error(
      `停服前门禁：四入口验收最坏需要 ${Math.ceil(requiredMs / 60_000)} 分钟，`
      + `当前发布只剩 ${Math.floor(normalizedAvailableMs / 60_000)} 分钟；拒绝进入业务写入或停服阶段`
    );
  }
  return {
    platform_count: Math.max(1, Number(platformCount) || 1),
    concurrency: Math.max(1, Number(concurrency) || 1),
    record_lease_ms: Math.max(60_000, Number(recordLeaseMs) || 60_000),
    required_ms: requiredMs,
    available_ms: normalizedAvailableMs
  };
}

function reassertAcceptanceBudget(budget, now = Date.now(), environment = process.env) {
  return {
    ...budget,
    ...assertAcceptanceBudget({
      platformCount: budget.platform_count,
      concurrency: budget.concurrency,
      recordLeaseMs: budget.record_lease_ms,
      availableMs: acceptanceAvailableTimeoutMs(now, environment)
    })
  };
}

function runnablePlatformCount(platformRows) {
  const count = (Array.isArray(platformRows) ? platformRows : []).filter((row) => (
    row?.enabled === true && row?.configured === true
  )).length;
  if (count < 1) throw new Error('没有已启用且已配置的正式监测平台');
  return count;
}

async function buildAcceptanceBudget(platformRows) {
  const runtimeSettings = await require('../services/AIRuntimeSettingsService').getSettings();
  const ProjectRunService = require('../services/ProjectRunService');
  const analysisCoordinator = require('../services/AIAnalysisExecutionCoordinator');
  const analysisSnapshot = analysisCoordinator.snapshot();
  const concurrency = Math.min(
    ProjectRunService.getProjectRunConcurrency(runtimeSettings),
    analysisSnapshot.concurrency
  );
  const recordLeaseMs = ProjectRunService.getRecordExecutionLeaseMs({
    target: { platformConfig: { request_timeout_seconds: 180 } },
    runtimeSettings: { ...runtimeSettings, ai_retry_count: 3 }
  });
  const platformCount = runnablePlatformCount(platformRows);
  const analysisTaskMs = require('../services/AIResponseEntityExtractionService')
    .ANALYSIS_TIMEOUT_SECONDS * 4 * 1000;
  const requiredQueueTimeoutMs = requiredAnalysisQueueTimeoutMs(
    platformCount * 2,
    analysisSnapshot.concurrency,
    analysisTaskMs
  );
  if (analysisSnapshot.queue_timeout_ms < requiredQueueTimeoutMs) {
    throw new Error(
      `停服前门禁：分析队列超时 ${analysisSnapshot.queue_timeout_ms}ms 小于验收批次最坏等待 `
      + `${requiredQueueTimeoutMs}ms`
    );
  }
  return {
    ...assertAcceptanceBudget({
      platformCount,
      concurrency,
      recordLeaseMs,
      availableMs: acceptanceAvailableTimeoutMs()
    }),
    analysis_concurrency: analysisSnapshot.concurrency,
    analysis_queue_timeout_ms: analysisSnapshot.queue_timeout_ms
  };
}

function requiredAnalysisQueueTimeoutMs(recordCount, concurrency, analysisTaskMs) {
  const count = Math.max(1, Number(recordCount) || 1);
  const slots = Math.max(1, Number(concurrency) || 1);
  const duration = Math.max(1, Number(analysisTaskMs) || 1);
  return Math.floor((count - 1) / slots) * duration;
}

async function waitRecords(
  QuestionRecord,
  VisibilityMetric,
  ids,
  projectId,
  { concurrency, recordLeaseMs, acceptanceDeadline }
) {
  const uniqueIds = [...new Set((ids || []).map(Number).filter(Number.isInteger))];
  if (!uniqueIds.length) throw new Error('入口响应没有返回记录 ID');
  const timeoutMs = Math.min(
    recordBatchWaitTimeoutMs(uniqueIds.length, concurrency, recordLeaseMs),
    Math.max(1, acceptanceDeadline - Date.now())
  );
  const rows = await Promise.all(uniqueIds.map((id) => (
    waitRecord(QuestionRecord, VisibilityMetric, id, projectId, timeoutMs)
  )));
  if (!rows.some((row) => String(row.platform || '').toLowerCase() === 'deepseek')) {
    throw new Error('入口响应没有产生 DeepSeek 记录');
  }
  return rows;
}

function canonicalDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function prepareAnalysisOnlyRetry(models, sourceRecord, project, prompt, userId, nonce) {
  const {
    QuestionSetRun,
    QuestionRecord,
    ResultDetail
  } = models;
  const sourceDetail = await ResultDetail.findOne({ where: { question_record_id: sourceRecord.id } });
  const responseText = String(sourceDetail?.ai_response_original || '').trim();
  if (!responseText) throw new Error('无法从已完成入口记录取得 analysis-only 原回答');

  return models.sequelize.transaction(async (transaction) => {
    const run = await QuestionSetRun.create({
      project_id: project.id,
      user_id: userId,
      question_set_id: null,
      question_set_name: `010 analysis-only ${nonce}`,
      source: 'native',
      planned_platforms: ['deepseek'],
      planned_record_count: 1,
      analysis_contract_version: V5_CONTRACT,
      metric_semantics_version: V5_SEMANTICS,
      competitor_snapshot: Array.isArray(sourceRecord.competitor_snapshot)
        ? sourceRecord.competitor_snapshot
        : [],
      revision: 1,
      completed_at: new Date()
    }, { transaction });
    const failed = await QuestionRecord.create({
      user_id: userId,
      project_id: project.id,
      tracked_prompt_id: prompt.id,
      question_set_run_id: run.id,
      run_slot_index: 0,
      execution_mode: 'full_monitoring',
      platform: 'deepseek',
      platform_name: 'DeepSeek',
      model_name: FLASH_MODEL,
      question: prompt.question,
      brand: project.name,
      brand_keywords: project.name,
      analysis_contract_version: V5_CONTRACT,
      metric_semantics_version: V5_SEMANTICS,
      competitor_snapshot: Array.isArray(sourceRecord.competitor_snapshot)
        ? sourceRecord.competitor_snapshot
        : [],
      status: 'failed',
      error_message: '010 controlled analysis retry seed',
      result_summary: {
        failure: { stage: 'analysis_validation', error_code: 'acceptance_retry_seed' }
      }
    }, { transaction });
    await ResultDetail.create({
      question_record_id: failed.id,
      ai_response_original: responseText,
      provider_citations: Array.isArray(sourceDetail.provider_citations)
        ? sourceDetail.provider_citations
        : [],
      citation_analysis: sourceDetail.citation_analysis || {},
      parsing_status: 'completed'
    }, { transaction });
    return run;
  });
}

function historicalV4Query(QuestionSetRun, userId) {
  return {
    where: {
      analysis_contract_version: 'ai_structured_v4',
      ...(Number.isInteger(userId) ? { user_id: userId } : {})
    },
    attributes: [
      'id',
      'project_id',
      'question_set_run_id',
      'analysis_contract_version',
      'metric_semantics_version'
    ],
    include: [{
      model: QuestionSetRun,
      as: 'questionSetRun',
      required: true,
      attributes: ['id', 'analysis_contract_version'],
      where: { analysis_contract_version: 'ai_structured_v4' }
    }],
    order: [['id', 'DESC']]
  };
}

async function verifyHistoricalV4(QuestionRecord, QuestionSetRun, token, userId) {
  const { parseCsv } = require('../services/QuestionSetRunCsvService');
  // 显式投影旧合同字段，确保停服前预检仍可读取尚未执行 v5 schema
  // 迁移的旧生产库，不让 ORM 自动选择新增 snapshot 列。
  const row = await QuestionRecord.findOne(historicalV4Query(QuestionSetRun, userId));
  if (!row) throw new Error('生产库没有可用于报告兼容验收的历史 v4 问题集记录');
  const report = await api(
    'GET',
    `/geo-projects/${row.project_id}/question-set-runs/${row.question_set_run_id}`,
    { token }
  );
  const reportData = report?.data || {};
  const reportRow = (Array.isArray(reportData.rows) ? reportData.rows : [])
    .find((item) => Number(item.record_id) === Number(row.id));
  const exported = await rawApi(
    'GET',
    `/geo-projects/${row.project_id}/question-set-runs/${row.question_set_run_id}/export`,
    { token }
  );
  const semantics = String(reportRow?.metric_semantics_version || row.metric_semantics_version || '');
  const csv = parseCsv(exported.text);
  const csvRow = csv.rows.find((item) => Number(item.record_id) === Number(row.id));
  const contentType = String(exported.headers['content-type'] || '').toLowerCase();
  const contentDisposition = String(exported.headers['content-disposition'] || '').toLowerCase();
  const readable = reportData.analysis_contract_version === 'ai_structured_v4'
    && reportRow?.analysis_contract_version === 'ai_structured_v4'
    && /_v1$/u.test(semantics)
    && csv.analysisContractVersion === 'ai_structured_v4'
    && csvRow?.analysis_contract_version === 'ai_structured_v4'
    && csvRow?.metric_semantics_version === semantics
    && contentType.includes('text/csv')
    && contentDisposition.includes('attachment');
  return {
    readable,
    analysis_contract_version: 'ai_structured_v4',
    metric_semantics_version: semantics,
    csv_content_type_valid: contentType.includes('text/csv'),
    csv_attachment: contentDisposition.includes('attachment')
  };
}

async function verifyDeepSeekFlashCredential(models) {
  const { inspectDeepSeekFlashConfigRow, OFFICIAL_DEEPSEEK_PRESET } = require(
    '../services/DeepSeekFlashConfigMigrationService'
  );
  const row = await models.AIPlatformConfig.findOne({
    where: { code: OFFICIAL_DEEPSEEK_PRESET.code },
    attributes: [
      'code', 'name', 'adapter_type', 'base_url', 'encrypted_api_key',
      'default_model', 'request_options', 'enabled', 'builtin', 'archived_at'
    ]
  });
  const state = inspectDeepSeekFlashConfigRow(row);
  if (!state.enabled || !state.credential_present) {
    throw new Error('DeepSeek 正式配置未启用或缺少凭据');
  }
  const candidate = {
    ...(row?.toJSON ? row.toJSON() : row),
    default_model: OFFICIAL_DEEPSEEK_PRESET.target_model
  };
  const result = await require('../services/AIPlatformRequestService').queryConfig(
    candidate,
    '请只回复 OK',
    {
      allowDisabled: true,
      retryCount: 0,
      purpose: 'connection_test',
      timeoutSeconds: 30,
      maxTokens: 8,
      requestOptions: {},
      disableWebSearch: true
    }
  );
  if (!result?.success) {
    throw new Error(`DeepSeek Flash 凭据预检失败 (${String(result?.error_code || 'provider_error')})`);
  }
  return { model: OFFICIAL_DEEPSEEK_PRESET.target_model, callable: true };
}

async function verifySchedulerBacklog(models, now = new Date()) {
  const { Op } = require('sequelize');
  const [dueDetectionSchedules, dueProjects, activeExecutions] = await Promise.all([
    models.DetectionSchedule.count({
      where: { enabled: true, next_run_at: { [Op.lte]: now } }
    }),
    models.BrandProject.count({
      where: {
        status: 'active',
        monitoring_enabled: true,
        monitoring_next_run_at: { [Op.lte]: now }
      }
    }),
    models.ScheduledExecution.count({
      where: {
        status: { [Op.in]: ['claimed', 'running'] },
        lease_expires_at: { [Op.gt]: now }
      }
    })
  ]);
  const snapshot = {
    due_detection_schedules: dueDetectionSchedules,
    due_projects: dueProjects,
    active_scheduled_executions: activeExecutions
  };
  if (Object.values(snapshot).some((count) => count !== 0)) {
    throw new Error(`停服前门禁：生产调度存在 backlog ${JSON.stringify(snapshot)}`);
  }
  return snapshot;
}

function acceptanceProjectMarker(name, markerKey = process.env.CONFIG_ENCRYPTION_KEY) {
  const normalizedKey = String(markerKey || '').trim();
  if (!normalizedKey) throw new Error('缺少验收项目 system marker 密钥');
  return crypto.createHmac('sha256', normalizedKey)
    .update(String(name), 'utf8')
    .digest('hex');
}

function acceptanceProjectWebsite(name, markerKey = process.env.CONFIG_ENCRYPTION_KEY) {
  const nonce = /^010-v5-acceptance-(\d+-\d+)$/u.exec(String(name))?.[1];
  if (!nonce) throw new Error('验收项目名称格式无效');
  const marker = acceptanceProjectMarker(name, markerKey);
  return `https://acceptance-${nonce}.geo010-${marker.slice(0, 32)}.${
    marker.slice(32)
  }.example.com`;
}

function isMarkedAcceptanceProject(project, markerKey) {
  const name = String(project?.name || '');
  if (!/^010-v5-acceptance-(\d+-\d+)$/u.test(name)) return false;
  return project?.website === acceptanceProjectWebsite(name, markerKey)
    && project?.industry === 'GEO 验收'
    && Array.isArray(project?.aliases)
    && project.aliases.length === 0;
}

async function cleanupAcceptanceProjects(models, {
  acceptanceUserId,
  markerKey = process.env.CONFIG_ENCRYPTION_KEY
} = {}) {
  const { Op } = require('sequelize');
  acceptanceProjectMarker('marker-preflight', markerKey);
  return models.sequelize.transaction(async (transaction) => {
    const projects = await models.BrandProject.findAll({
      where: {
        name: { [Op.like]: '010-v5-acceptance-%' },
        status: { [Op.ne]: 'archived' },
        ...(Number.isInteger(acceptanceUserId) ? { user_id: acceptanceUserId } : {})
      },
      attributes: ['id', 'user_id', 'name', 'aliases', 'website', 'industry'],
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    const projectIds = projects
      .filter((project) => isMarkedAcceptanceProject(project, markerKey))
      .map((project) => project.id);
    if (!projectIds.length) return { archived_projects: 0, disabled_schedules: 0 };
    const [disabledSchedules] = await models.DetectionSchedule.update(
      { enabled: false },
      { where: { project_id: { [Op.in]: projectIds }, enabled: true }, transaction }
    );
    const [archivedProjects] = await models.BrandProject.update({
      monitoring_enabled: false,
      status: 'archived'
    }, {
      where: { id: { [Op.in]: projectIds } },
      transaction
    });
    return {
      archived_projects: archivedProjects,
      disabled_schedules: disabledSchedules
    };
  });
}

function collectRequestAudits(sinceIso, runner = execFileSync) {
  const output = runner('journalctl', [
    '-u',
    'ai-geo-backend.service',
    '--since',
    sinceIso,
    '--no-pager',
    '-o',
    'cat'
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  return output.split(/\r?\n/u).flatMap((line) => {
    const marker = 'AI_PLATFORM_REQUEST_AUDIT ';
    const index = line.indexOf(marker);
    if (index < 0) return [];
    try {
      return [JSON.parse(line.slice(index + marker.length))];
    } catch (_) {
      throw new Error('systemd journal 中存在不可解析的 AI 请求审计行');
    }
  });
}

function verifyRequestAudits(audits, entryRecordIds, analysisOnlyIds) {
  const requiredPolicyRevisions = new Map([
    ['analysis_entity_extract', 'grounded_entity_catalog_v1+fixed_json_no_web_v1'],
    ['analysis_semantic_judge', 'closed_entity_semantics_v4_evidence_roles_rev2+fixed_json_no_web_v1']
  ]);
  const requiredPromptTemplates = new Map([
    ['analysis_entity_extract', new Map([
      ['base', '43508380a32708aab5f3815e114dbfbd19af21ec52018f58f055e2bc76ff93af'],
      ['repair', 'e515bc35a1d1f662d7aee4b6a930f37af33fb28e0586e0045d1db65266134ba0']
    ])],
    ['analysis_semantic_judge', new Map([
      ['base', 'bbab0ccf31aecaa250bd24209581ef99fb9ef2c83e26c4ba90623aef741efddb'],
      ['repair', 'a577dd874396b24b6e5f1cfec8736b988b25a3415981b8cd6ba4d48cee87da90']
    ])]
  ]);
  const formalPurposes = new Set([
    'project_monitoring',
    'legacy_schedule',
    'direct_stream',
    'analysis_entity_extract',
    'analysis_semantic_judge'
  ]);
  if (audits.some((row) => row.correlation_id && !formalPurposes.has(row.purpose))) {
    throw new Error('验收窗口存在关联到正式记录的非正式上游请求');
  }
  if (audits.some((row) => formalPurposes.has(row.purpose) && !row.correlation_id)) {
    throw new Error('验收窗口存在缺少 record correlation 的正式上游请求');
  }
  if (audits.some((row) => (
    String(row.purpose || '').startsWith('analysis_')
    && !['analysis_entity_extract', 'analysis_semantic_judge'].includes(row.purpose)
  ))) {
    throw new Error('验收窗口存在非 v5 两阶段分析请求');
  }
  if (audits.some((row) => (
    row.purpose === 'evaluation_v4_baseline'
    || (row.model === FLASH_MODEL && (!row.purpose || row.purpose === 'unspecified'))
  ))) {
    throw new Error('验收窗口存在未标记或 v4 基线分析请求');
  }
  const allIds = Object.values(entryRecordIds).flat();
  const byCorrelation = new Map(allIds.map((id) => [`record-${id}`, []]));
  for (const audit of audits) {
    if (byCorrelation.has(audit.correlation_id)) byCorrelation.get(audit.correlation_id).push(audit);
  }
  for (const id of allIds) {
    const rows = byCorrelation.get(`record-${id}`) || [];
    const analysisRows = rows.filter((row) => (
      row.purpose === 'analysis_entity_extract' || row.purpose === 'analysis_semantic_judge'
    ));
    if (!analysisRows.some((row) => row.purpose === 'analysis_entity_extract')) {
      throw new Error(`record ${id} 缺少实体抽取请求审计`);
    }
    if (!analysisRows.some((row) => row.purpose === 'analysis_semantic_judge')) {
      throw new Error(`record ${id} 缺少语义判断请求审计`);
    }
    if (analysisRows.some((row) => row.platform !== 'deepseek' || row.model !== FLASH_MODEL)) {
      throw new Error(`record ${id} 存在非 DeepSeek Flash 分析请求`);
    }
    if (analysisRows.some((row) => (
      row.policy_revision !== requiredPolicyRevisions.get(row.purpose)
    ))) {
      throw new Error(`record ${id} 的 v5 请求策略 revision 无效`);
    }
    if (analysisRows.some((row) => (
      row.policy_valid !== true
      || !/^[a-f0-9]{64}$/u.test(String(row.policy_fingerprint || ''))
      || !/^[a-f0-9]{64}$/u.test(String(row.prompt_fingerprint || ''))
      || !['base', 'repair'].includes(row.prompt_variant)
      || row.prompt_template_fingerprint
        !== requiredPromptTemplates.get(row.purpose)?.get(row.prompt_variant)
    ))) {
      throw new Error(`record ${id} 的 v5 请求策略指纹无效`);
    }
    if (new Set(analysisRows.map((row) => row.policy_fingerprint)).size !== 1) {
      throw new Error(`record ${id} 的 v5 两阶段请求策略不一致`);
    }
    if (!analysisOnlyIds.includes(id)
      && !rows.some((row) => ['project_monitoring', 'direct_stream'].includes(row.purpose))) {
      throw new Error(`record ${id} 缺少监测上游请求审计`);
    }
  }
  for (const id of analysisOnlyIds) {
    const rows = byCorrelation.get(`record-${id}`) || [];
    if (rows.some((row) => ['project_monitoring', 'direct_stream', 'legacy_schedule'].includes(row.purpose))) {
      throw new Error(`analysis-only record ${id} 错误调用了监测上游`);
    }
  }
  if (audits.some((row) => /(?:deepseek-v4-pro|ai_structured_v4)/iu.test(
    `${row.model || ''} ${row.purpose || ''}`
  ))) {
    throw new Error('验收窗口观察到 deepseek-v4-pro 请求');
  }
  return {
    total: audits.length,
    correlated: [...byCorrelation.values()].reduce((total, rows) => total + rows.length, 0),
    pro_requests: 0
  };
}

function writeSecureEvidence(evidence, revision) {
  const directory = fs.mkdtempSync('/tmp/geo010-acceptance-');
  fs.chmodSync(directory, 0o700);
  const filename = path.join(directory, `evidence-${revision}.json`);
  const flags = fs.constants.O_WRONLY
    | fs.constants.O_CREAT
    | fs.constants.O_EXCL
    | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(filename, flags, 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    fs.closeSync(fd);
  }
  return filename;
}

function writePreflightBudgetResult(budget, filename = process.env.AI_GEO_PREFLIGHT_RESULT_PATH) {
  const target = String(filename || '').trim();
  if (!target) throw new Error('缺少候选预检预算结果路径');
  const flags = fs.constants.O_WRONLY
    | fs.constants.O_CREAT
    | fs.constants.O_EXCL
    | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(target, flags, 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify({
      required_ms: budget.required_ms,
      platform_count: budget.platform_count,
      concurrency: budget.concurrency,
      record_lease_ms: budget.record_lease_ms
    })}\n`);
  } finally {
    fs.closeSync(fd);
  }
}

async function createAcceptanceSession(models, environment = process.env) {
  const username = String(
    environment.GEO010_ACCEPTANCE_USERNAME
      || environment.DEFAULT_ADMIN_USERNAME
      || 'admin'
  ).trim();
  const secret = String(environment.JWT_SECRET || '');
  if (!username) throw new Error('缺少服务器侧验收管理员用户名');
  if (secret.length < 32) throw new Error('服务器 JWT_SECRET 缺失或少于 32 个字符');

  const user = await models.User.findOne({
    where: { username },
    attributes: [
      'id',
      'username',
      'role',
      'status',
      'membership_level',
      'membership_expires_at'
    ]
  });
  if (!user) throw new Error('服务器侧验收管理员不存在');
  if (user.status !== 'active' || user.role !== 'admin') {
    throw new Error('服务器侧验收身份必须是 active admin');
  }

  let effectiveLevel = user.membership_level || 'free';
  if (
    effectiveLevel !== 'free'
    && user.membership_expires_at
    && new Date(user.membership_expires_at) < new Date()
  ) {
    effectiveLevel = 'free';
  }
  return {
    userId: Number(user.id),
    token: jwt.sign({
      userId: user.id,
      username: user.username,
      role: user.role,
      level: effectiveLevel,
      membershipExpiresAt: user.membership_expires_at || null,
      purpose: 'geo010-acceptance'
    }, secret, { expiresIn: '6h' })
  };
}

async function runPreflight() {
  if (process.env.NODE_ENV !== 'production') {
    throw new Error('geo010Acceptance 只允许在 NODE_ENV=production 的正式服务器运行');
  }
  const [backendRevision, frontendRevision, readiness] = await Promise.all([
    readPublicRevisionValue(`${OFFICIAL_BASE}/health`),
    readPublicRevisionValue(FRONTEND_HEALTH_URL),
    readPublicReadiness(`${OFFICIAL_BASE}/ready`)
  ]);
  if (backendRevision !== frontendRevision) {
    throw new Error('正式前后端 revision 不一致');
  }
  const models = require('../models');
  try {
    const { token, userId } = await createAcceptanceSession(models);
    const platformResponse = await api('GET', '/admin/ai-platforms', { token });
    const acceptanceCleanup = await cleanupAcceptanceProjects(models, {
      acceptanceUserId: userId
    });
    let acceptanceBudget = process.env.AI_GEO_REQUIRE_FULL_ACCEPTANCE === 'true'
      ? await buildAcceptanceBudget(platformResponse?.data)
      : { required: false };
    const deepSeekFlash = await verifyDeepSeekFlashCredential(models);
    const schedulerBacklog = await verifySchedulerBacklog(models);
    const historyV4 = await verifyHistoricalV4(
      models.QuestionRecord,
      models.QuestionSetRun,
      token,
      userId
    );
    if (!historyV4.readable) throw new Error('历史 v4 报告或 CSV 不可读取');
    if (process.env.AI_GEO_REQUIRE_FULL_ACCEPTANCE === 'true') {
      // 现役 bridge 会在本脚本成功后立即停服；全部只读检查结束后必须按
      // 当前时间复核预算，不能复用预检开头的时间余量。
      acceptanceBudget = reassertAcceptanceBudget(acceptanceBudget);
      writePreflightBudgetResult(acceptanceBudget);
    }
    console.log(JSON.stringify({
      preflight: 'ready',
      public_revision: backendRevision,
      readiness: readiness.readiness,
      acceptance_budget: acceptanceBudget,
      deepseek_flash: deepSeekFlash,
      scheduler_backlog: schedulerBacklog,
      acceptance_cleanup: acceptanceCleanup,
      historical_v4: historyV4
    }));
  } finally {
    await models.sequelize.close();
  }
}

async function runRecoveryPreflight() {
  if (process.env.NODE_ENV !== 'production') {
    throw new Error('geo010Acceptance 只允许在 NODE_ENV=production 的正式服务器运行');
  }
  const models = require('../models');
  try {
    const acceptanceCleanup = await cleanupAcceptanceProjects(models);
    const platformRows = await models.AIPlatformConfig.findAll({
      attributes: ['code', 'enabled']
    });
    const enabledPlatformCount = platformRows.filter((row) => row.enabled === true).length;
    if (enabledPlatformCount < 1) throw new Error('没有已启用的正式监测平台');
    let acceptanceBudget = await buildAcceptanceBudget(
      Array.from({ length: enabledPlatformCount }, () => ({ enabled: true, configured: true }))
    );
    const deepSeekFlash = await verifyDeepSeekFlashCredential(models);
    const schedulerBacklog = await verifySchedulerBacklog(models);
    const historicalV4 = await models.QuestionRecord.findOne(
      historicalV4Query(models.QuestionSetRun, undefined)
    );
    if (!historicalV4) throw new Error('生产库没有历史 v4 问题集记录');
    acceptanceBudget = reassertAcceptanceBudget(acceptanceBudget);
    writePreflightBudgetResult(acceptanceBudget);
    console.log(JSON.stringify({
      recovery_preflight: 'ready',
      acceptance_budget: acceptanceBudget,
      deepseek_flash: deepSeekFlash,
      scheduler_backlog: schedulerBacklog,
      acceptance_cleanup: acceptanceCleanup,
      historical_v4_record_present: true
    }));
  } finally {
    await models.sequelize.close();
  }
}

async function withAcceptanceModels(work, loadModels = () => require('../models')) {
  const models = loadModels();
  try {
    return await work(models);
  } finally {
    await models.sequelize.close();
  }
}

async function main() {
  if (process.env.NODE_ENV !== 'production') {
    throw new Error('geo010Acceptance 只允许在 NODE_ENV=production 的正式服务器运行');
  }
  const expectedRevision = readRequiredRevision();
  const acceptanceDeadline = Date.now() + acceptanceAvailableTimeoutMs();
  const repositoryRoot = path.resolve(BACKEND_ROOT, '..');
  const serverHead = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  }).trim().toLowerCase();
  if (serverHead !== expectedRevision) throw new Error('服务器 Git HEAD 与指定 revision 不一致');
  const serverWorktree = execFileSync('git', ['status', '--porcelain'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  });
  if (serverWorktree.trim()) throw new Error('服务器 Git 工作区不干净，拒绝生成 revision 验收证据');
  const publicChecks = {
    health: await readPublicRevision(`${OFFICIAL_BASE}/health`, expectedRevision),
    frontend_health: await readPublicRevision(FRONTEND_HEALTH_URL, expectedRevision),
    ready: await readPublicReadiness(`${OFFICIAL_BASE}/ready`)
  };

  return withAcceptanceModels(async (models) => {
    const { token, userId } = await createAcceptanceSession(models);

    const [platformResponse, analysisResponse] = await Promise.all([
      api('GET', '/admin/ai-platforms', { token }),
      api('GET', '/settings/analysis-api', { token })
    ]);
  const deepseek = (platformResponse?.data || []).find((row) => row.code === 'deepseek');
  const analysisConfig = analysisResponse?.data || {};
  if (
    !deepseek?.builtin
    || !deepseek?.enabled
    || !deepseek?.configured
    || deepseek?.default_model !== FLASH_MODEL
    || analysisConfig?.configured !== true
    || analysisConfig?.platform_code !== 'deepseek'
    || analysisConfig?.model_name !== FLASH_MODEL
  ) {
    throw new Error('正式 DeepSeek/分析配置不满足 builtin + enabled + credential + Flash 门禁');
  }

  const auditSince = new Date().toISOString();
  const {
    BrandProject,
    TrackedPrompt,
    QuestionRecord,
    QuestionSetRun,
    ResultDetail,
    VisibilityMetric,
    ScheduledExecution,
    DetectionSchedule,
    BrandCompetitor
  } = models;
  const runtimeSettings = await require('../services/AIRuntimeSettingsService').getSettings();
  const ProjectRunService = require('../services/ProjectRunService');
  const runConcurrency = ProjectRunService.getProjectRunConcurrency(runtimeSettings);
  const recordLeaseMs = ProjectRunService.getRecordExecutionLeaseMs({
    target: { platformConfig: { request_timeout_seconds: 180 } },
    runtimeSettings: { ...runtimeSettings, ai_retry_count: 3 }
  });
  const acceptanceBudget = assertAcceptanceBudget({
    platformCount: runnablePlatformCount(platformResponse?.data),
    concurrency: runConcurrency,
    recordLeaseMs,
    availableMs: Math.max(0, acceptanceDeadline - Date.now())
  });
  const nonce = `${Date.now()}-${process.pid}`;
  const projectName = `010-v5-acceptance-${nonce}`;
  const projectWebsite = acceptanceProjectWebsite(projectName);
  let projectId = null;
  let cleanup = {
    monitoring_disabled: false,
    project_archived: false,
    active_schedule_count: null,
    retention: 'archived_for_release_audit'
  };
  let finalEvidence = null;
  try {
    const projectResponse = await api('POST', '/geo-projects', {
      token,
      body: {
        name: projectName,
        aliases: [],
        website: projectWebsite,
        industry: 'GEO 验收',
        primary_keywords: ['GEO 监测'],
        monitoring_enabled: false,
        monitoring_time: '09:00'
      }
    });
    projectId = Number(projectResponse?.data?.id);
    const project = await BrandProject.findOne({
      where: {
        id: projectId,
        user_id: userId,
        name: projectName,
        website: projectWebsite
      }
    });
    if (!project) throw new Error('验收项目未落入当前 ORM 指向的同一数据库');

    const competitorResponse = await api('POST', `/geo-projects/${projectId}/competitors`, {
      token,
      body: {
        name: `010-competitor-a-${nonce}`,
        aliases: [`010-a-${nonce}`],
        website: `https://competitor-a-${nonce}.example.com`
      }
    });
    const competitorId = Number(competitorResponse?.data?.id);

    const singlePromptResponse = await api('POST', `/geo-projects/${projectId}/prompts`, {
      token,
      body: {
        question: `010 单问题正式入口验收 ${nonce}：介绍 GEO 监测工具。`,
        tags: ['010-acceptance'],
        enabled: true
      }
    });
    const setPromptResponse = await api('POST', `/geo-projects/${projectId}/prompts`, {
      token,
      body: {
        question: `010 问题集正式入口验收 ${nonce}：比较 GEO 监测工具。`,
        tags: ['010-acceptance'],
        enabled: true
      }
    });
    const singlePrompt = await TrackedPrompt.findOne({
      where: {
        id: singlePromptResponse?.data?.id,
        project_id: projectId,
        question: `010 单问题正式入口验收 ${nonce}：介绍 GEO 监测工具。`
      }
    });
    const setPrompt = await TrackedPrompt.findOne({
      where: {
        id: setPromptResponse?.data?.id,
        project_id: projectId,
        question: `010 问题集正式入口验收 ${nonce}：比较 GEO 监测工具。`
      }
    });
    if (!singlePrompt || !setPrompt) throw new Error('验收问题未落库');

    const singleKey = idempotencyKey('single', nonce);
    const singleResponse = await api(
      'POST',
      `/geo-projects/${projectId}/prompts/${singlePrompt.id}/run`,
      { token, idempotency: singleKey, body: { idempotency_key: singleKey } }
    );
    const singleIds = extractRecordIds(singleResponse);
    const singleRecords = await waitRecords(QuestionRecord, VisibilityMetric, singleIds, projectId, {
      concurrency: runConcurrency,
      recordLeaseMs,
      acceptanceDeadline
    });

    const setResponse = await api('POST', `/geo-projects/${projectId}/question-sets`, {
      token,
      body: { name: `010 question set ${nonce}`, question_ids: [setPrompt.id] }
    });
    const questionSetId = Number(setResponse?.data?.id);
    const setKey = idempotencyKey('set', nonce);
    const setRunResponse = await api(
      'POST',
      `/geo-projects/${projectId}/question-sets/${questionSetId}/run`,
      { token, idempotency: setKey, body: { idempotency_key: setKey } }
    );
    const setIds = extractRecordIds(setRunResponse);
    const setRecords = await waitRecords(QuestionRecord, VisibilityMetric, setIds, projectId, {
      concurrency: runConcurrency,
      recordLeaseMs,
      acceptanceDeadline
    });
    const setRecord = setRecords.find((row) => String(row.platform).toLowerCase() === 'deepseek');
    const sourceSnapshot = Array.isArray(setRecord?.competitor_snapshot)
      ? setRecord.competitor_snapshot
      : [];
    if (!sourceSnapshot.some((item) => Number(item.id) === competitorId)) {
      throw new Error('问题集记录没有冻结竞品 A 快照');
    }
    const [changedCompetitorRows] = await BrandCompetitor.update({
      name: `010-competitor-b-${nonce}`,
      aliases: [`010-b-${nonce}`],
      website: `https://competitor-b-${nonce}.example.com`
    }, { where: { id: competitorId, project_id: projectId, user_id: userId } });
    if (changedCompetitorRows !== 1) throw new Error('竞品快照漂移准备未精确更新一行');

    const monitoringStartedAt = new Date();
    await api('PUT', `/geo-projects/${projectId}`, {
      token,
      body: { monitoring_enabled: true, monitoring_time: '09:00' }
    });
    const dueAt = new Date(Date.now() - 1000);
    const [dueRows] = await BrandProject.update(
      { monitoring_next_run_at: dueAt },
      { where: { id: projectId, user_id: userId, name: projectName, status: 'active', monitoring_enabled: true } }
    );
    if (dueRows !== 1) throw new Error('自动监测到期时间未精确更新同库验收项目');
    const schedulerDeadline = Math.min(
      acceptanceDeadline,
      Date.now() + recordBatchWaitTimeoutMs(
        singleIds.length + setIds.length,
        runConcurrency,
        recordLeaseMs
      )
    );
    let scheduledExecution = null;
    while (Date.now() < schedulerDeadline) {
      scheduledExecution = await ScheduledExecution.findOne({
        where: {
          schedule_kind: 'project_monitoring',
          schedule_id: projectId,
          project_id: projectId,
          created_at: { [require('sequelize').Op.gte]: monitoringStartedAt }
        },
        order: [['id', 'DESC']]
      });
      if (scheduledExecution?.status === 'completed') break;
      if (scheduledExecution?.status === 'failed') throw new Error('真实项目自动监测调度执行失败');
      await sleep(3000);
    }
    if (!scheduledExecution || scheduledExecution.status !== 'completed') {
      throw new Error('真实项目自动监测未在时限内完成调度');
    }
    const scheduledRows = await QuestionRecord.findAll({
      where: { scheduled_execution_id: scheduledExecution.id },
      order: [['id', 'ASC']]
    });
    const scheduledIds = scheduledRows.map((row) => Number(row.id));
    const scheduledRecords = await waitRecords(QuestionRecord, VisibilityMetric, scheduledIds, projectId, {
      concurrency: runConcurrency,
      recordLeaseMs,
      acceptanceDeadline
    });
    await api('PUT', `/geo-projects/${projectId}`, {
      token,
      body: { monitoring_enabled: false, monitoring_time: '09:00' }
    });
    cleanup.monitoring_disabled = true;

    const retryRun = await prepareAnalysisOnlyRetry(
      { sequelize, QuestionSetRun, QuestionRecord, ResultDetail },
      setRecord,
      project,
      setPrompt,
      userId,
      nonce
    );
    const seedRecord = await QuestionRecord.findOne({
      where: { question_set_run_id: retryRun.id },
      include: [{ model: ResultDetail, as: 'resultDetail', required: true }]
    });
    const seedDigest = canonicalDigest({
      response: seedRecord.resultDetail.ai_response_original,
      citations: seedRecord.resultDetail.provider_citations,
      citation_analysis: seedRecord.resultDetail.citation_analysis
    });
    const retryKey = idempotencyKey('analysis-only', nonce);
    const retryResponse = await api(
      'POST',
      `/geo-projects/${projectId}/question-set-runs/${retryRun.id}/retry-failed`,
      { token, idempotency: retryKey, body: { idempotency_key: retryKey } }
    );
    if (
      Number(retryResponse?.data?.analysis_only_count) !== 1
      || Number(retryResponse?.data?.full_monitoring_count) !== 0
      || Number(retryResponse?.data?.quota_consumed) !== 0
    ) {
      throw new Error('analysis-only 正式入口未保持 1/0/0 重试边界');
    }
    const retryIds = extractRecordIds(retryResponse);
    const retryRecords = await waitRecords(QuestionRecord, VisibilityMetric, retryIds, projectId, {
      concurrency: runConcurrency,
      recordLeaseMs,
      acceptanceDeadline
    });
    const preservedSeed = await QuestionRecord.findByPk(seedRecord.id, {
      include: [{ model: ResultDetail, as: 'resultDetail', required: true }]
    });
    const preservedSeedDigest = canonicalDigest({
      response: preservedSeed.resultDetail.ai_response_original,
      citations: preservedSeed.resultDetail.provider_citations,
      citation_analysis: preservedSeed.resultDetail.citation_analysis
    });
    const retryDetail = await ResultDetail.findOne({ where: { question_record_id: retryIds[0] } });
    const retryDigest = canonicalDigest({
      response: retryDetail.ai_response_original,
      citations: retryDetail.provider_citations,
      citation_analysis: retryDetail.citation_analysis
    });
    if (seedDigest !== preservedSeedDigest || seedDigest !== retryDigest) {
      throw new Error('analysis-only 未保持原回答与引用哈希不变');
    }
    const retryRecord = retryRecords.find((row) => String(row.platform).toLowerCase() === 'deepseek');
    if (canonicalDigest(retryRecord?.competitor_snapshot || []) !== canonicalDigest(sourceSnapshot)) {
      throw new Error('analysis-only 未复用原冻结竞品快照');
    }

    const entries = {
      single_question: singleRecords.map(toEvidence),
      question_set: setRecords.map(toEvidence),
      automatic_monitoring: scheduledRecords.map(toEvidence),
      analysis_only: retryRecords.map(toEvidence)
    };
    const historyV4 = await verifyHistoricalV4(
      QuestionRecord,
      QuestionSetRun,
      token,
      userId
    );
    const evaluation = evaluateEvidence(entries, historyV4.readable);
    const entryRecordIds = {
      single_question: singleIds,
      question_set: setIds,
      automatic_monitoring: scheduledIds,
      analysis_only: retryIds
    };
    const audits = collectRequestAudits(auditSince);
    const auditEvidence = verifyRequestAudits(audits, entryRecordIds, retryIds);
    finalEvidence = {
      generated_at: new Date().toISOString(),
      base_url: OFFICIAL_BASE,
      revision: expectedRevision,
      server_head: serverHead,
      public_checks: publicChecks,
      project_id: projectId,
      controlled_setup: {
        project_monitoring_enabled_via_api: true,
        monitoring_next_run_at_set_due_in_database: true,
        analysis_only_seed_record_id: Number(seedRecord.id),
        response_and_citations_sha256_preserved: true
      },
      entry_record_ids: entryRecordIds,
      entries,
      request_audits: auditEvidence,
      historical_v4: historyV4,
      ...evaluation
    };
    if (!evaluation.pass) throw new Error('四入口 v5 或历史 v4 读取验收未通过');
  } finally {
    let cleanupError = null;
    if (projectId) {
      try {
        await api('PUT', `/geo-projects/${projectId}`, {
          token,
          cleanup: true,
          body: { monitoring_enabled: false, monitoring_time: '09:00' }
        });
        cleanup.monitoring_disabled = true;
      } catch (_) {
        cleanup.monitoring_disabled = false;
      }
      try {
        await api('DELETE', `/geo-projects/${projectId}`, { token, cleanup: true });
      } catch (_) {}
      const storedProject = await BrandProject.findByPk(projectId);
      cleanup.project_archived = storedProject?.status === 'archived';
      cleanup.active_schedule_count = await DetectionSchedule.count({
        where: { project_id: projectId, enabled: true }
      });
      if (!cleanup.monitoring_disabled || !cleanup.project_archived || cleanup.active_schedule_count !== 0) {
        cleanupError = new Error(`验收清理失败，project_id=${projectId}`);
      }
    }
    if (cleanupError) throw cleanupError;
  }
  finalEvidence.cleanup = cleanup;
  finalEvidence.acceptance_budget = acceptanceBudget;
  const outputPath = writeSecureEvidence(finalEvidence, expectedRevision);
  console.log(JSON.stringify({ ...finalEvidence, evidence_path: outputPath }, null, 2));
  });
}

if (require.main === module) {
  const invocation = process.argv.slice(2);
  const operation = invocation.length === 1 && invocation[0] === '--preflight'
    ? runPreflight
    : invocation.length === 1 && invocation[0] === '--recovery-preflight'
      ? runRecoveryPreflight
      : main;
  const handlers = new Map(['SIGHUP', 'SIGINT', 'SIGTERM'].map((signal) => [
    signal,
    () => {
      const error = new Error(`010 正式入口验收收到 ${signal}，开始清理验收状态`);
      error.code = 'acceptance_cancelled';
      acceptanceShutdown.abort(error);
    }
  ]));
  handlers.forEach((handler, signal) => process.once(signal, handler));
  operation()
    .catch((error) => {
      console.error('010 正式入口验收失败:', error.message);
      process.exitCode = 1;
    })
    .finally(() => {
      handlers.forEach((handler, signal) => process.removeListener(signal, handler));
    });
}

module.exports = {
  OFFICIAL_BASE,
  FRONTEND_HEALTH_URL,
  abortableSleep,
  collectRequestAudits,
  evaluateEvidence,
  extractRecordId,
  extractRecordIds,
  historicalV4Query,
  readRequiredRevision,
  acceptanceAvailableTimeoutMs,
  acceptanceRequiredTimeoutMs,
  assertAcceptanceBudget,
  reassertAcceptanceBudget,
  readPublicReadiness,
  readPublicRevisionValue,
  recordBatchWaitTimeoutMs,
  requiredAnalysisQueueTimeoutMs,
  verifyDeepSeekFlashCredential,
  verifySchedulerBacklog,
  cleanupAcceptanceProjects,
  acceptanceProjectMarker,
  acceptanceProjectWebsite,
  isMarkedAcceptanceProject,
  writePreflightBudgetResult,
  createAcceptanceSession,
  withAcceptanceModels,
  runPreflight,
  runRecoveryPreflight,
  toEvidence,
  verifyRequestAudits,
  writeSecureEvidence
};
