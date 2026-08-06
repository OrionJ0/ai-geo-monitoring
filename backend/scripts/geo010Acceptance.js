#!/usr/bin/env node
/**
 * 010 v5 正式入口验收。
 *
 * 本脚本只能在正式服务器运行，只访问唯一受支持的 HTTPS 入口。它不会启动
 * 第二套应用、修改 AI 平台配置、读取/传递 API Key，也不会创建临时数据库。
 * 登录凭据只从服务器环境读取，验收证据写入 /tmp 且不包含凭据、问题正文或
 * 上游原始响应。
 */
const fs = require('node:fs');
const path = require('node:path');

const BACKEND_ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(BACKEND_ROOT, '.env'), quiet: true });

const OFFICIAL_BASE = 'https://insight.guangtuo.com/api';
const V5_CONTRACT = 'ai_structured_v5';
const V5_METHOD = 'ai_structured_v5';
const V5_SEMANTICS = 'contextual_competitor_mentions_sov_v2_scoped';
const FLASH_MODEL = 'deepseek-v4-flash';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function idempotencyKey(label, nonce) {
  return `geo010-${label}-${nonce}`.slice(0, 120);
}

function extractRecordId(payload) {
  const data = payload?.data || payload || {};
  const candidates = [
    data.record_id,
    data.first_record_id,
    data.record_ids?.[0],
    data.results?.[0]?.record_id,
    data.records?.[0]?.record_id,
    data.records?.[0]?.id,
    data.run?.records?.[0]?.record_id,
    data.run?.records?.[0]?.id
  ];
  const id = candidates.map(Number).find((value) => Number.isInteger(value) && value > 0);
  return id || null;
}

function toEvidence(record) {
  const row = record?.toJSON ? record.toJSON() : record;
  const metric = row?.visibilityMetric || row?.visibility_metric || {};
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
    analysis_model: metric?.analysis_model || null
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
    const row = entries?.[name];
    return [name, Boolean(
      row
      && row.status === 'completed'
      && row.analysis_contract_version === V5_CONTRACT
      && row.metric_semantics_version === V5_SEMANTICS
      && row.analysis_method === V5_METHOD
      && row.analysis_platform === 'deepseek'
      && row.analysis_model === FLASH_MODEL
      && (name !== 'analysis_only' || row.execution_mode === 'analysis_only')
    )];
  }));
  return {
    required_entries: requiredNames,
    entry_checks: checks,
    history_v4_readable: historyV4Readable === true,
    pass: requiredNames.every((name) => checks[name]) && historyV4Readable === true
  };
}

async function api(method, urlPath, { body, token, idempotency } = {}) {
  const response = await fetch(`${OFFICIAL_BASE}${urlPath}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(idempotency ? { 'Idempotency-Key': idempotency } : {})
    },
    body: body ? JSON.stringify(body) : undefined
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

async function waitRecord(QuestionRecord, VisibilityMetric, recordId, timeoutMs = 240000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await QuestionRecord.findByPk(recordId, {
      include: [{ model: VisibilityMetric, as: 'visibilityMetric', required: false }]
    });
    if (row?.status === 'completed') return row;
    if (row?.status === 'failed') throw new Error(`record ${recordId} 执行失败`);
    await sleep(3000);
  }
  throw new Error(`record ${recordId} 未在 ${timeoutMs}ms 内完成`);
}

async function findDeepSeekRecord(QuestionRecord, VisibilityMetric, ids) {
  for (const id of ids || []) {
    const row = await waitRecord(QuestionRecord, VisibilityMetric, id);
    if (String(row.platform || '').toLowerCase() === 'deepseek') return row;
  }
  throw new Error('入口响应没有产生 DeepSeek 记录');
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
      planned_record_count: 1,
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
      competitor_snapshot: [],
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

async function verifyHistoricalV4(QuestionRecord, token) {
  const row = await QuestionRecord.findOne({
    where: { analysis_contract_version: 'ai_structured_v4' },
    order: [['id', 'DESC']]
  });
  if (!row) throw new Error('生产库没有可用于兼容读取验收的历史 v4 记录');
  const status = await api('GET', `/detection/status/${row.id}`, { token });
  return Number(status?.data?.record_id) === Number(row.id);
}

async function main() {
  if (process.env.NODE_ENV !== 'production') {
    throw new Error('geo010Acceptance 只允许在 NODE_ENV=production 的正式服务器运行');
  }
  const username = String(process.env.GEO010_ACCEPTANCE_USERNAME || 'admin').trim();
  const password = String(
    process.env.GEO010_ACCEPTANCE_PASSWORD || process.env.DEFAULT_ADMIN_PASSWORD || ''
  );
  if (!username || !password) {
    throw new Error('缺少服务器侧 GEO010_ACCEPTANCE_PASSWORD/DEFAULT_ADMIN_PASSWORD');
  }

  const ready = await fetch(`${OFFICIAL_BASE}/ready`);
  if (ready.status !== 200) throw new Error(`正式入口 /ready 未就绪 (${ready.status})`);

  const login = await api('POST', '/users/login', { body: { username, password } });
  const token = login?.data?.token || login?.token;
  const userId = Number(login?.data?.user?.id || login?.user?.id);
  if (!token || !Number.isInteger(userId)) throw new Error('正式入口登录响应无效');

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
    || analysisConfig?.platform_code !== 'deepseek'
    || analysisConfig?.model_name !== FLASH_MODEL
  ) {
    throw new Error('正式 DeepSeek/分析配置不满足 builtin + enabled + credential + Flash 门禁');
  }

  const models = require('../models');
  const {
    sequelize,
    BrandProject,
    TrackedPrompt,
    QuestionRecord,
    QuestionSetRun,
    ResultDetail,
    VisibilityMetric
  } = models;
  const nonce = `${Date.now()}-${process.pid}`;
  const projectName = `010-v5-acceptance-${nonce}`;
  const projectResponse = await api('POST', '/geo-projects', {
    token,
    body: {
      name: projectName,
      aliases: [],
      website: `https://acceptance-${nonce}.example.com`,
      industry: 'GEO 验收',
      primary_keywords: ['GEO 监测']
    }
  });
  const projectId = Number(projectResponse?.data?.id);
  const project = await BrandProject.findByPk(projectId);
  if (!project) throw new Error('验收项目未落库');

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
  const singlePrompt = await TrackedPrompt.findByPk(singlePromptResponse?.data?.id);
  const setPrompt = await TrackedPrompt.findByPk(setPromptResponse?.data?.id);
  if (!singlePrompt || !setPrompt) throw new Error('验收问题未落库');

  const singleResponse = await api(
    'POST',
    `/geo-projects/${projectId}/prompts/${singlePrompt.id}/run`,
    {
      token,
      idempotency: idempotencyKey('single', nonce),
      body: { idempotency_key: idempotencyKey('single', nonce) }
    }
  );
  const singleIds = singleResponse?.data?.record_ids || [extractRecordId(singleResponse)].filter(Boolean);
  const singleRecord = await findDeepSeekRecord(QuestionRecord, VisibilityMetric, singleIds);

  const setResponse = await api('POST', `/geo-projects/${projectId}/question-sets`, {
    token,
    body: {
      name: `010 question set ${nonce}`,
      question_ids: [setPrompt.id]
    }
  });
  const questionSetId = Number(setResponse?.data?.id);
  const setRunResponse = await api(
    'POST',
    `/geo-projects/${projectId}/question-sets/${questionSetId}/run`,
    {
      token,
      idempotency: idempotencyKey('set', nonce),
      body: { idempotency_key: idempotencyKey('set', nonce) }
    }
  );
  const setIds = setRunResponse?.data?.record_ids || [extractRecordId(setRunResponse)].filter(Boolean);
  const setRecord = await findDeepSeekRecord(QuestionRecord, VisibilityMetric, setIds);

  const scheduledAfter = new Date();
  const scheduleResponse = await api('POST', '/schedules', {
    token,
    body: {
      project_id: projectId,
      prompt_id: singlePrompt.id,
      question: singlePrompt.question,
      platforms: ['deepseek'],
      daily_time: '09:00',
      timezone: 'Asia/Shanghai',
      enabled: true,
      brand: project.name
    }
  });
  const scheduleId = Number(scheduleResponse?.data?.id);
  await api('POST', `/schedules/${scheduleId}/run`, { token, body: {} });
  const scheduledRecord = await QuestionRecord.findOne({
    where: {
      project_id: projectId,
      tracked_prompt_id: singlePrompt.id,
      platform: 'deepseek',
      created_at: { [require('sequelize').Op.gte]: scheduledAfter }
    },
    include: [{ model: VisibilityMetric, as: 'visibilityMetric', required: false }],
    order: [['id', 'DESC']]
  });
  if (!scheduledRecord || scheduledRecord.status !== 'completed') {
    throw new Error('自动监测正式入口没有产生已完成 DeepSeek 记录');
  }

  const retryRun = await prepareAnalysisOnlyRetry(
    { sequelize, QuestionSetRun, QuestionRecord, ResultDetail },
    setRecord,
    project,
    setPrompt,
    userId,
    nonce
  );
  const retryResponse = await api(
    'POST',
    `/geo-projects/${projectId}/question-set-runs/${retryRun.id}/retry-failed`,
    {
      token,
      idempotency: idempotencyKey('analysis-only', nonce),
      body: { idempotency_key: idempotencyKey('analysis-only', nonce) }
    }
  );
  if (
    Number(retryResponse?.data?.analysis_only_count) !== 1
    || Number(retryResponse?.data?.full_monitoring_count) !== 0
  ) {
    throw new Error('analysis-only 正式入口未保持 1/0 重试边界');
  }
  const retryRecordId = extractRecordId(retryResponse);
  const retryRecord = await waitRecord(QuestionRecord, VisibilityMetric, retryRecordId);

  const entries = {
    single_question: toEvidence(singleRecord),
    question_set: toEvidence(setRecord),
    automatic_monitoring: toEvidence(scheduledRecord),
    analysis_only: toEvidence(retryRecord)
  };
  const historyV4Readable = await verifyHistoricalV4(QuestionRecord, token);
  const evaluation = evaluateEvidence(entries, historyV4Readable);
  const evidence = {
    generated_at: new Date().toISOString(),
    base_url: OFFICIAL_BASE,
    project_id: projectId,
    entries,
    ...evaluation
  };
  const revision = String(process.env.APP_REVISION || 'unknown').replace(/[^a-zA-Z0-9._-]/gu, '_');
  const outputPath = `/tmp/geo010-acceptance-${revision}-${Date.now()}.json`;
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ ...evidence, evidence_path: outputPath }, null, 2));
  await sequelize.close();
  if (!evaluation.pass) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error('010 正式入口验收失败:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  OFFICIAL_BASE,
  evaluateEvidence,
  extractRecordId,
  toEvidence
};
