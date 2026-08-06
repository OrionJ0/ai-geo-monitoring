const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-question-set-runs-'));
process.env.DB_STORAGE = path.join(databaseDir, 'test.sqlite');
delete process.env.DATABASE_URL;

const QuestionSetRunService = require('../services/QuestionSetRunService');
const QuestionSetRunCsvService = require('../services/QuestionSetRunCsvService');
const {
  sequelize,
  User,
  BrandProject,
  PromptGroup,
  TrackedPrompt,
  QuestionRecord,
  ResultDetail,
  VisibilityMetric,
  QuestionSetRun
} = require('../models');

let user;
let project;
let questionSet;
let prompt;

async function createNativeRun(plannedRecordCount) {
  return QuestionSetRun.create({
    project_id: project.id,
    user_id: user.id,
    question_set_id: questionSet.id,
    question_set_name: questionSet.name,
    source: 'native',
    schema_version: 'question_set_run_v1',
    planned_record_count: plannedRecordCount,
    started_at: new Date()
  });
}

test.before(async () => {
  await sequelize.sync({ force: true });
  user = await User.create({
    username: 'question-set-report-user',
    email: 'question-set-report@example.com',
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
  questionSet = await PromptGroup.create({
    project_id: project.id,
    user_id: user.id,
    name: '采购决策问题集'
  });
  prompt = await TrackedPrompt.create({
    project_id: project.id,
    prompt_group_id: questionSet.id,
    user_id: user.id,
    question: '周界报警系统怎么选？',
    tags: ['购买决策'],
    platforms: ['deepseek'],
    enabled: true
  });
});

test.after(async () => {
  await sequelize.close();
  fs.rmSync(databaseDir, { recursive: true, force: true });
});

test('一次问题集运行只聚合本次关联任务并保留逐条回答', async () => {
  const completed = await QuestionRecord.create({
    user_id: user.id,
    project_id: project.id,
    tracked_prompt_id: prompt.id,
    platform: 'deepseek',
    platform_name: 'DeepSeek',
    model_name: 'deepseek-chat',
    question: prompt.question,
    brand: project.name,
    brand_keywords: project.name,
    status: 'completed'
  });
  const failed = await QuestionRecord.create({
    user_id: user.id,
    project_id: project.id,
    tracked_prompt_id: prompt.id,
    platform: 'deepseek',
    question: '失败问题',
    brand: project.name,
    brand_keywords: project.name,
    status: 'failed',
    error_message: 'AI 结构化分析失败，本条未计入有效样本',
    result_summary: {
      keyword_counts: [],
      failure: {
        stage: 'analysis_validation',
        error_code: 'invalid_analysis_output'
      },
      analysis: {
        status: 'failed',
        error_code: 'invalid_analysis_output',
        stage: 'parse_or_validate',
        attempt_count: 2,
        platform: 'deepseek',
        model: 'deepseek-v4-pro',
        finish_reason: 'stop',
        output_length: 321
      }
    }
  });
  await ResultDetail.create({
    question_record_id: completed.id,
    ai_response_original: '广拓可以作为周界报警方案的候选。',
    parsing_status: 'completed'
  });
  await VisibilityMetric.create({
    project_id: project.id,
    prompt_id: prompt.id,
    question_record_id: completed.id,
    user_id: user.id,
    platform: 'deepseek',
    brand_mentioned: true,
    brand_mentions: 1,
    brand_rank: 1,
    brand_recommended: true,
    visibility_score: 80,
    share_of_voice: 55,
    citation_count: 1,
    owned_citation_count: 1,
    citation_sources: [{
      url: 'https://www.gato.com.cn/guide',
      title: '-1',
      domain: 'www.gato.com.cn',
      owned: true
    }],
    prompt_category: '购买决策',
    sentiment: 'positive',
    analysis_method: 'ai_structured_v1',
    metric_semantics_version: 'configured_competitor_sov_v1',
    analysis_platform: 'analysis-ai',
    analysis_model: 'analysis-model',
    analysis_structure: {
      citations: {
        semantics_version: 'explicit-citation-v2'
      }
    },
    analysis_evidence: {
      brand: {
        mention: ['广拓'],
        recommendation: ['可以作为周界报警方案的候选'],
        rank: []
      }
    }
  });

  const run = await createNativeRun(2);
  await completed.update({ question_set_run_id: run.id, run_slot_index: 0 });
  await failed.update({ question_set_run_id: run.id, run_slot_index: 1 });
  const report = await QuestionSetRunService.getReport({ projectId: project.id, runId: run.id });

  assert.ok(await QuestionSetRun.findByPk(run.id));
  assert.equal(report.status, 'partial');
  assert.deepEqual(report.integrity, {
    status: 'complete',
    missing_record_count: 0,
    error_code: null
  });
  assert.deepEqual(report.capabilities, {
    can_pause: false,
    pause_disabled_reason: 'not_running',
    can_resume: false,
    resume_disabled_reason: 'not_paused',
    can_retry: true,
    retry_disabled_reason: null
  });
  assert.equal(report.summary.total, 2);
  assert.equal(report.summary.completed, 1);
  assert.equal(report.summary.failed, 1);
  assert.deepEqual(report.execution_summary, {
    total: 2,
    completed: 1,
    failed: 1,
    pending: 0,
    executing: 0,
    queued: 0,
    failure_stages: {
      analysis_validation: 1
    }
  });
  assert.equal(report.summary.brand_mention_rate, 100);
  assert.equal(report.summary.owned_citation_rate, 100);
  assert.equal(report.summary.total_owned_citations, 1);
  assert.equal(report.rows.length, 2);
  assert.equal(report.rows[0].answer, '广拓可以作为周界报警方案的候选。');
  assert.equal(report.rows[0].owned_citation_count, 1);
  assert.equal(report.rows[0].analysis_method, 'ai_structured_v1');
  assert.equal(report.rows[0].analysis_platform, 'analysis-ai');
  assert.deepEqual(report.rows[0].citation_sources, [{
    url: 'https://www.gato.com.cn/guide',
    title: 'www.gato.com.cn',
    domain: 'www.gato.com.cn',
    owned: true
  }]);
  assert.equal(report.rows[1].error_message, 'AI 结构化分析失败，本条未计入有效样本');
  assert.deepEqual(report.rows[1].failure, {
    stage: 'analysis_validation',
    error_code: 'invalid_analysis_output'
  });
  assert.deepEqual(report.rows[1].analysis_diagnostics, {
    status: 'failed',
    error_code: 'invalid_analysis_output',
    stage: 'parse_or_validate',
    attempt_count: 2,
    platform: 'deepseek',
    model: 'deepseek-v4-pro',
    finish_reason: 'stop',
    output_length: 321
  });

  await run.reload();
  assert.deepEqual(run.imported_rows, []);
  assert.equal(run.completed_at, null);
  const finalized = await QuestionSetRunService.reconcileNativeRun({
    projectId: project.id,
    runId: run.id,
    expectedRevision: 0
  });
  assert.equal(finalized.ok, true);
  assert.equal(finalized.reconciled, true);
  assert.equal(finalized.status, 'partial');
  await run.reload();
  assert.equal(run.imported_rows.length, 2);
  assert.ok(run.completed_at);

  await QuestionRecord.destroy({ where: { id: [completed.id, failed.id] } });
  const durableReport = await QuestionSetRunService.getReport({ projectId: project.id, runId: run.id });
  assert.equal(durableReport.rows.length, 2);
  assert.equal(durableReport.rows[0].answer, '广拓可以作为周界报警方案的候选。');
});

test('单问题报告返回 v5 排名、SOV 和可复核语义证据', async () => {
  // 010 硬切后 v5 为唯一当前契约。native v5 记录的报告读取目前被服务缺陷阻断
  // （VisibilityMetric 模型无 sov_status 列，presentScopedSov 读取时必然抛错，
  // 见 010 报告），因此本测试用 imported 快照行（question_set_id 为 null 的
  // 单问题报告等价形态）验证 v5 行数据读取、汇总与 CSV 往返。
  const v5Structure = {
    schema_version: 'geo_metric_input_v5',
    target_fact: {
      status: 'complete',
      brand_mentioned: true,
      brand_mentions: 1,
      mentions: []
    },
    target_mapping: {
      status: 'resolved',
      target_entity_id: 'E001',
      candidate_entity_ids: []
    },
    target_semantics: {
      status: 'complete',
      recommendation: {
        status: 'assessed',
        value: false,
        evidence: {
          entity_occurrence_source_ids: [],
          semantic_context_source_ids: []
        }
      },
      rank: {
        status: 'assessed',
        value: 2,
        evidence: {
          entity_occurrence_source_ids: ['O001'],
          semantic_context_source_ids: ['L002']
        }
      },
      sentiment: {
        status: 'assessed',
        value: 'neutral',
        evidence: {
          entity_occurrence_source_ids: ['O001'],
          semantic_context_source_ids: ['L003']
        }
      }
    },
    competition_analysis: {
      status: 'complete',
      scope: 'open_discovery',
      completeness: 'not_proven',
      entities: ['E001', 'E002'],
      relations: ['E002'],
      relation_evidence_source_ids: ['L002'],
      unresolved_entity_ids: [],
      quarantined_items: []
    },
    sov: {
      status: 'observed_only',
      scope: 'open_discovery',
      completeness: 'not_proven',
      numerator: 1,
      denominator: 2,
      value: 50
    },
    entities: [
      { entity_id: 'E001', name: '广拓', type: 'brand', surface_forms: ['广拓'], registry_match: null },
      { entity_id: 'E002', name: '海康', type: 'brand', surface_forms: ['海康'], registry_match: null }
    ],
    competitor_relations: [{
      entity_id: 'E002',
      relation: 'competitor',
      reason: '提供同类周界方案',
      evidence: ['广拓与海康都提供周界方案']
    }],
    candidate_lists: [{
      ordered: true,
      entries: ['海康', '广拓'],
      reason: '回答表达了先后',
      evidence: ['广拓与海康都提供周界方案']
    }],
    sentiment: {
      status: 'assessed',
      label: 'neutral',
      reason: '客观列举',
      evidence: ['广拓与海康都提供周界方案'],
      risk_terms: []
    },
    diagnostics: {
      entity_prompt_revision: 'geo-entity-extract-v2',
      semantic_prompt_revision: 'geo-semantic-v5',
      model: 'deepseek-v4-flash',
      attempt_count: 1,
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
      stages: [{ stage: 'entity_extract', status: 'completed', attempt_count: 1 }]
    }
  };
  const run = await QuestionSetRun.create({
    project_id: project.id,
    user_id: user.id,
    question_set_id: null,
    question_set_name: '单问题运行',
    source: 'imported',
    schema_version: 'question_set_run_v1',
    analysis_contract_version: 'ai_structured_v5',
    metric_semantics_version: 'contextual_competitor_mentions_sov_v2_scoped',
    planned_record_count: 0,
    integrity_status: 'complete',
    imported_rows: [{
      record_id: 1,
      question_id: 2,
      question: prompt.question,
      question_category: '购买决策',
      platform: 'deepseek',
      platform_name: 'DeepSeek',
      model_name: 'deepseek-chat',
      status: 'completed',
      error_message: '',
      answer: '广拓与海康都提供周界方案。',
      answer_format: 'plain_text',
      has_metrics: true,
      brand_mentioned: true,
      brand_mentions: 1,
      brand_rank: 2,
      brand_recommended: false,
      metric_semantics_version: 'contextual_competitor_mentions_sov_v2_scoped',
      share_of_voice: null,
      answer_competitor_share: 50,
      sov_numerator: 1,
      sov_denominator: 2,
      competition_entities: [{
        name: '海康',
        relation: 'competitor',
        reason: '提供同类周界方案',
        evidence: ['广拓与海康都提供周界方案'],
        mentions: 1,
        surface_forms: ['海康']
      }],
      citation_count: 0,
      owned_citation_count: 0,
      competitor_citation_count: 0,
      legacy_citation_count: 0,
      legacy_citation_sources: [],
      sentiment: 'neutral',
      sentiment_reason: '客观列举',
      competitor_mentions: [],
      citation_sources: [],
      created_at: null,
      updated_at: null,
      analysis_method: 'ai_structured_v5',
      analysis_platform: 'analysis-ai',
      analysis_model: 'analysis-model',
      analysis_structure: v5Structure,
      analysis_evidence: {},
      failure: null,
      retry: null,
      analysis_diagnostics: null
    }, {
      record_id: 3,
      question_id: 2,
      question: '另一条周界问题',
      question_category: '',
      platform: 'deepseek',
      platform_name: 'DeepSeek',
      model_name: 'deepseek-chat',
      status: 'failed',
      error_message: '回答超出分析模型范围，本条未计入品牌指标',
      answer: '这条完整原回答已经采集，但结构化分析失败。',
      answer_format: 'plain_text',
      has_metrics: false,
      brand_mentioned: false,
      brand_mentions: 0,
      brand_rank: null,
      brand_recommended: false,
      analysis_contract_version: 'ai_structured_v5',
      metric_semantics_version: 'contextual_competitor_mentions_sov_v2_scoped',
      share_of_voice: null,
      answer_competitor_share: null,
      sov_numerator: null,
      sov_denominator: null,
      competition_entities: [],
      citation_count: 0,
      owned_citation_count: 0,
      competitor_citation_count: 0,
      legacy_citation_count: 0,
      legacy_citation_sources: [],
      sentiment: '',
      sentiment_reason: '',
      competitor_mentions: [],
      citation_sources: [],
      created_at: null,
      updated_at: null,
      analysis_method: 'ai_structured_v5',
      analysis_platform: 'analysis-ai',
      analysis_model: 'analysis-model',
      analysis_structure: {},
      analysis_evidence: {},
      failure: {
        stage: 'analysis_request',
        error_code: 'analysis_input_too_long'
      },
      retry: null,
      analysis_diagnostics: null
    }],
    started_at: new Date(),
    completed_at: new Date()
  });

  const report = await QuestionSetRunService.getReport({
    projectId: project.id,
    runId: run.id
  });

  assert.equal(
    report.metric_semantics_version,
    'contextual_competitor_mentions_sov_v2_scoped'
  );
  assert.deepEqual(report.rows[0].sov, {
    metric_semantics_version: 'contextual_competitor_mentions_sov_v2_scoped',
    kind: 'contextual_competitor_mentions',
    status: 'calculated',
    value: 50,
    numerator: 1,
    denominator: 2
  });
  assert.deepEqual(report.summary.sov_summary, {
    metric_semantics_version: 'contextual_competitor_mentions_sov_v2_scoped',
    kind: 'observed_competitor_mentions',
    average: 50,
    calculable_answers: 1,
    scope: 'open_discovery',
    completeness: 'not_proven'
  });
  assert.equal(Object.hasOwn(report.summary, 'avg_share_of_voice'), false);
  assert.equal(Object.hasOwn(report.rows[0], 'share_of_voice'), false);
  assert.equal(report.rows[0].answer_competitor_share, 50);
  assert.equal(report.rows[0].competition_entities[0].relation, 'competitor');
  assert.equal(report.rows[0].competition_entities[0].reason, '提供同类周界方案');
  assert.deepEqual(
    report.rows[0].competition_entities[0].evidence,
    ['广拓与海康都提供周界方案']
  );
  assert.equal(report.rows[0].brand_rank, 2);
  assert.deepEqual(
    report.rows[0].analysis_structure.sentiment.evidence,
    ['广拓与海康都提供周界方案']
  );
  assert.equal(report.rows[1].has_metrics, false);
  assert.equal(
    report.rows[1].analysis_contract_version,
    'ai_structured_v5'
  );
  assert.equal(
    report.rows[1].metric_semantics_version,
    'contextual_competitor_mentions_sov_v2_scoped'
  );
  assert.deepEqual({
    valid_answers: report.summary.valid_answers,
    acquired_answers: report.summary.acquired_answers,
    analysis_coverage_rate: report.summary.analysis_coverage_rate,
    brand_mentioned_answers: report.summary.brand_mentioned_answers,
    brand_mention_rate: report.summary.brand_mention_rate
  }, {
    valid_answers: 1,
    acquired_answers: 2,
    analysis_coverage_rate: 50,
    brand_mentioned_answers: 1,
    brand_mention_rate: 100
  });

  const csv = await QuestionSetRunService.exportCsv({
    projectId: project.id,
    runId: run.id
  });
  const imported = await QuestionSetRunService.importCsv({ project, user, csv });
  const restored = await QuestionSetRunService.getReport({
    projectId: project.id,
    runId: imported.id
  });
  assert.equal(
    restored.metric_semantics_version,
    'contextual_competitor_mentions_sov_v2_scoped'
  );
  assert.deepEqual(restored.summary.sov_summary, report.summary.sov_summary);
  assert.deepEqual(restored.rows[0].sov, report.rows[0].sov);
  assert.deepEqual(
    restored.rows[0].competition_entities,
    report.rows[0].competition_entities
  );
  assert.equal(Object.hasOwn(restored.rows[0], 'share_of_voice'), false);
  await imported.destroy();
  await run.destroy();
});

test('单问题失败运行不依赖持久化问题集也能生成可重试报告', async () => {
  const run = await QuestionSetRun.create({
    project_id: project.id,
    user_id: user.id,
    question_set_id: null,
    question_set_name: `单问题：${prompt.question}`,
    source: 'native',
    schema_version: 'question_set_run_v1',
    planned_record_count: 1,
    started_at: new Date()
  });
  const failed = await QuestionRecord.create({
    user_id: user.id,
    project_id: project.id,
    tracked_prompt_id: prompt.id,
    question_set_run_id: run.id,
    run_slot_index: 0,
    platform: 'deepseek-web',
    platform_name: 'DeepSeek 网页版',
    model_name: 'deepseek-web-ui',
    question: prompt.question,
    brand: project.name,
    brand_keywords: project.name,
    status: 'failed',
    error_message: 'DeepSeek Web 浏览器无响应',
    result_summary: {
      failure: {
        stage: 'generation_finished',
        error_code: 'web_browser_unresponsive'
      }
    }
  });

  const report = await QuestionSetRunService.getReport({
    projectId: project.id,
    runId: run.id
  });

  assert.equal(report.question_set_id, null);
  assert.equal(report.status, 'failed');
  assert.equal(report.summary.failed, 1);
  assert.equal(report.capabilities.can_retry, true);
  assert.equal(report.capabilities.retry_disabled_reason, null);
  assert.deepEqual(report.execution_summary.failure_stages, {
    generation_finished: 1
  });

  await failed.destroy();
  await run.destroy();
});

test('DeepSeek Web 报告保留平台、模型、分角色来源、Web 证据及 CSV 身份', async (t) => {
  const run = await createNativeRun(1);
  const record = await QuestionRecord.create({
    user_id: user.id,
    project_id: project.id,
    tracked_prompt_id: prompt.id,
    question_set_run_id: run.id,
    run_slot_index: 0,
    platform: 'deepseek-web',
    platform_name: 'DeepSeek 网页版',
    model_name: 'deepseek-web-ui',
    question: '网页版如何推荐周界报警厂家？',
    brand: project.name,
    brand_keywords: project.name,
    status: 'completed',
    result_summary: {
      web_capture: {
        schema_version: 'deepseek-web-capture-v1',
        status: 'completed',
        selector_version: 'deepseek-web-v1',
        artifact_owner_record_id: 1,
        captured_at: '2026-07-26T08:30:00.000Z',
        capture_mode: {
          name: 'web_search',
          observed: true,
          evidence_type: 'dom_selected_state'
        },
        search: { requested: true, observed: true },
        artifacts: {
          search_state: { id: '00000000-0000-4000-8000-000000000011' },
          final_answer: { id: '00000000-0000-4000-8000-000000000012' }
        }
      }
    }
  });
  t.after(async () => {
    await VisibilityMetric.destroy({ where: { question_record_id: record.id } });
    await ResultDetail.destroy({ where: { question_record_id: record.id } });
    await record.destroy();
    await run.destroy();
  });
  await record.update({
    result_summary: {
      ...record.result_summary,
      web_capture: {
        ...record.result_summary.web_capture,
        artifact_owner_record_id: record.id
      }
    }
  });
  const providerCitations = [
    {
      url: 'https://explicit.example.com/a',
      title: '明确引用',
      domain: 'explicit.example.com',
      source_role: 'explicit_citation'
    },
    {
      url: 'https://retrieval.example.com/b',
      title: 'ç”µç£æ„ŸçŸ¥ - ä¸Šæµ·å¹¿æ‹“',
      domain: 'retrieval.example.com',
      source_role: 'retrieval_candidate'
    },
    {
      url: 'https://autolink.example.com/c',
      title: 'autolink',
      domain: 'autolink.example.com',
      source_role: 'explicit_citation'
    }
  ];
  await ResultDetail.create({
    question_record_id: record.id,
    ai_response_original: '网页版最终回答。',
    provider_citations: providerCitations,
    parsing_status: 'completed'
  });

  const report = await QuestionSetRunService.getReport({
    projectId: project.id,
    runId: run.id
  });

  assert.equal(report.rows[0].platform, 'deepseek-web');
  assert.equal(report.rows[0].platform_name, 'DeepSeek 网页版');
  assert.equal(report.rows[0].model_name, 'deepseek-web-ui');
  assert.equal(
    report.rows[0].provider_citations[1].title,
    '电磁感知 - 上海广拓'
  );
  assert.equal(
    providerCitations[1].title,
    'ç”µç£æ„ŸçŸ¥ - ä¸Šæµ·å¹¿æ‹“'
  );
  assert.equal(
    report.rows[0].provider_citations[2].title,
    'autolink.example.com'
  );
  assert.equal(report.rows[0].web_capture.selector_version, 'deepseek-web-v1');
  assert.equal(report.rows[0].web_capture.artifact_owner_record_id, record.id);
  assert.equal(report.rows[0].web_capture.capture_mode.name, 'web_search');

  const csv = await QuestionSetRunService.exportCsv({
    projectId: project.id,
    runId: run.id
  });
  assert.match(csv, /deepseek-web/);
  assert.match(csv, /DeepSeek 网页版/);
  assert.match(csv, /deepseek-web-ui/);
});

test('豆包 Web 报告保留普通模式，且不把未知搜索状态改成失败', async (t) => {
  const run = await createNativeRun(1);
  const record = await QuestionRecord.create({
    user_id: user.id,
    project_id: project.id,
    tracked_prompt_id: prompt.id,
    question_set_run_id: run.id,
    run_slot_index: 0,
    platform: 'doubao-web',
    platform_name: '豆包网页版',
    model_name: 'doubao-web-ui',
    question: '普通模式测试',
    brand: project.name,
    brand_keywords: project.name,
    status: 'completed',
    result_summary: {
      web_capture: {
        schema_version: 'doubao-web-capture-v1',
        status: 'completed',
        selector_version: 'doubao-web-v2',
        captured_at: '2026-07-29T08:30:00.000Z',
        capture_mode: {
          name: 'standard',
          observed: true,
          evidence_type: 'dom_standard_mode'
        },
        search: {
          requested: false,
          observed: null,
          evidence_type: 'dom_standard_mode'
        },
        artifacts: {
          search_state: { id: '00000000-0000-4000-8000-000000000021' },
          final_answer: { id: '00000000-0000-4000-8000-000000000022' }
        }
      }
    }
  });
  t.after(async () => {
    await record.destroy();
    await run.destroy();
  });
  await record.update({
    result_summary: {
      ...record.result_summary,
      web_capture: {
        ...record.result_summary.web_capture,
        artifact_owner_record_id: record.id
      }
    }
  });
  await run.update({
    imported_rows: [{
      record_id: record.id,
      question_id: prompt.id,
      question: record.question,
      platform: 'doubao-web',
      platform_name: '豆包网页版',
      model_name: 'doubao-web-ui',
      status: 'completed',
      provider_citations: [{
        url: 'https://example.com/search-result',
        title: '检索候选',
        domain: 'example.com',
        source_role: 'retrieval_candidate'
      }],
      web_capture: {
        schema_version: 'doubao-web-capture-v1',
        status: 'completed',
        selector_version: 'doubao-web-v2',
        artifact_owner_record_id: record.id,
        captured_at: '2026-07-29T08:30:00.000Z',
        search: {
          requested: false,
          observed: false,
          evidence_type: 'dom_standard_mode'
        },
        artifacts: {
          search_state: { id: '00000000-0000-4000-8000-000000000021' },
          final_answer: { id: '00000000-0000-4000-8000-000000000022' }
        }
      }
    }]
  });

  const report = await QuestionSetRunService.getReport({
    projectId: project.id,
    runId: run.id
  });

  assert.equal(report.rows[0].web_capture.capture_mode.name, 'standard');
  assert.equal(report.rows[0].web_capture.capture_mode.observed, true);
  assert.equal(report.rows[0].web_capture.search.requested, false);
  assert.equal(report.rows[0].web_capture.search.observed, true);
  assert.equal(
    report.rows[0].web_capture.search.evidence_type,
    'network_retrieval_candidates'
  );
});

test('历史混合引用不进入问题集核心 KPI，但保留可解释的旧口径提示', async () => {
  const record = await QuestionRecord.create({
    user_id: user.id,
    project_id: project.id,
    tracked_prompt_id: prompt.id,
    platform: 'qwen',
    question: '历史引用口径测试',
    brand: project.name,
    brand_keywords: project.name,
    status: 'completed'
  });
  await VisibilityMetric.create({
    project_id: project.id,
    prompt_id: prompt.id,
    question_record_id: record.id,
    user_id: user.id,
    platform: 'qwen',
    metric_semantics_version: 'configured_competitor_sov_v1',
    citation_count: 56,
    owned_citation_count: 4,
    citation_sources: [{ url: 'https://legacy.example.com/a', domain: 'legacy.example.com' }],
    analysis_structure: {
      citations: { semantics_version: 'explicit-citation-v1' }
    }
  });
  const run = await createNativeRun(1);
  await record.update({ question_set_run_id: run.id, run_slot_index: 0 });

  const report = await QuestionSetRunService.getReport({ projectId: project.id, runId: run.id });

  assert.equal(report.summary.total_citations, 0);
  assert.equal(report.summary.citation_rate, 0);
  assert.equal(report.summary.citation_valid_analyses, 0);
  assert.equal(report.summary.citation_unverified_analyses, 1);
  assert.equal(report.rows[0].citation_evidence_status, 'legacy_unverified');
  assert.equal(report.rows[0].citation_count, 0);
  assert.equal(report.rows[0].legacy_citation_count, 56);
  assert.deepEqual(report.rows[0].citation_sources, []);
  assert.equal(report.rows[0].legacy_citation_sources.length, 1);

  await run.destroy();
  await record.destroy();
});

test('问题集报告在品牌分析失败时仍统计独立保存的显式引用证据', async () => {
  const record = await QuestionRecord.create({
    user_id: user.id,
    project_id: project.id,
    tracked_prompt_id: prompt.id,
    platform: 'doubao',
    question: '引用证据独立统计',
    brand: project.name,
    brand_keywords: project.name,
    analysis_contract_version: 'ai_structured_v5',
    metric_semantics_version: 'contextual_competitor_mentions_sov_v2_scoped',
    status: 'failed'
  });
  await ResultDetail.create({
    question_record_id: record.id,
    ai_response_original: '回答已抓取，但品牌分析失败。',
    citation_analysis: {
      semantics_version: 'explicit-citation-v2',
      evidence_status: 'explicit',
      citation_count: 1,
      owned_citation_count: 1,
      competitor_citation_count: 0,
      sources: [{
        url: 'https://gato.example/report',
        domain: 'gato.example',
        owned: true,
        competitor_owned: false
      }]
    },
    parsing_status: 'completed'
  });
  const run = await createNativeRun(1);
  await record.update({ question_set_run_id: run.id, run_slot_index: 0 });

  const report = await QuestionSetRunService.getReport({
    projectId: project.id,
    runId: run.id
  });

  assert.equal(report.summary.valid_answers, 0);
  assert.equal(report.summary.acquired_answers, 1);
  assert.equal(report.summary.analysis_coverage_rate, 0);
  assert.equal(report.summary.citation_valid_analyses, 1);
  assert.equal(report.summary.citation_unverified_analyses, 0);
  assert.equal(report.summary.citation_rate, 100);
  assert.equal(report.summary.owned_citation_rate, 100);
  assert.equal(report.rows[0].citation_evidence_status, 'explicit');
  assert.equal(report.rows[0].citation_count, 1);

  await run.destroy();
  await record.destroy();
});

test('旧执行器生成的终态快照不能覆盖已进入新一轮重试的运行', async () => {
  const record = await QuestionRecord.create({
    user_id: user.id,
    project_id: project.id,
    tracked_prompt_id: prompt.id,
    platform: 'deepseek',
    question: '并发终态测试',
    brand: project.name,
    brand_keywords: project.name,
    status: 'completed'
  });
  const run = await createNativeRun(1);
  await record.update({ question_set_run_id: run.id, run_slot_index: 0 });
  const originalGetNativeRows = QuestionSetRunService.getNativeRows;
  QuestionSetRunService.getNativeRows = async (...args) => {
    const rows = await originalGetNativeRows.apply(QuestionSetRunService, args);
    await QuestionSetRun.increment('revision', { where: { id: run.id } });
    return rows;
  };

  try {
    const finalized = await QuestionSetRunService.reconcileNativeRun({
      projectId: project.id,
      runId: run.id,
      expectedRevision: 0
    });
    assert.equal(finalized.ok, false);
    assert.equal(finalized.reason, 'stale_revision');
    await run.reload();
    assert.deepEqual(run.imported_rows, []);
    assert.equal(run.completed_at, null);
    assert.equal(run.revision, 1);
  } finally {
    QuestionSetRunService.getNativeRows = originalGetNativeRows;
    await run.destroy();
    await record.destroy();
  }
});

test('标准 CSV 导出后可以重新导入为内容等价的只读历史报告', async () => {
  const nativeRun = await QuestionSetRun.findOne({
    where: { project_id: project.id, source: 'native' },
    order: [['id', 'DESC']]
  });
  const original = await QuestionSetRunService.getReport({ projectId: project.id, runId: nativeRun.id });
  const csv = await QuestionSetRunService.exportCsv({ projectId: project.id, runId: nativeRun.id });

  assert.match(csv, /^\uFEFFschema_version,source_run_id,question_set_name,/);
  assert.match(csv, /question_set_run_v1/);
  assert.match(csv, /周界报警系统怎么选/);

  const imported = await QuestionSetRunService.importCsv({ project, user, csv });
  const restored = await QuestionSetRunService.getReport({ projectId: project.id, runId: imported.id });

  assert.equal(restored.source, 'imported');
  assert.deepEqual(restored.capabilities, {
    can_pause: false,
    pause_disabled_reason: 'imported_report_read_only',
    can_resume: false,
    resume_disabled_reason: 'imported_report_read_only',
    can_retry: false,
    retry_disabled_reason: 'imported_report_read_only'
  });
  assert.equal(restored.question_set_name, original.question_set_name);
  assert.equal(restored.rows.length, original.rows.length);
  assert.equal(restored.rows[0].question, original.rows[0].question);
  assert.equal(restored.rows[0].answer, original.rows[0].answer);
  assert.deepEqual(restored.rows[0].citation_sources, original.rows[0].citation_sources);
  assert.equal(restored.rows[0].analysis_method, original.rows[0].analysis_method);
  assert.equal(restored.rows[0].analysis_model, original.rows[0].analysis_model);
  assert.deepEqual(restored.rows[0].analysis_evidence, original.rows[0].analysis_evidence);
  assert.deepEqual(restored.rows[1].failure, original.rows[1].failure);
  assert.deepEqual(restored.rows[1].analysis_diagnostics, original.rows[1].analysis_diagnostics);
  assert.equal(restored.summary.brand_mention_rate, original.summary.brand_mention_rate);
  assert.equal(restored.summary.owned_citation_rate, original.summary.owned_citation_rate);
  assert.equal(restored.summary.total_owned_citations, original.summary.total_owned_citations);
});

test('报告不再用文本规则猜测无竞品项目的历史排名', async () => {
  const imported = await QuestionSetRun.create({
    project_id: project.id,
    user_id: user.id,
    question_set_id: null,
    question_set_name: '校园周界厂家',
    source: 'imported',
    schema_version: 'question_set_run_v1',
    imported_rows: [{
      record_id: null,
      question_id: null,
      question: '学校使用的非通电电子围栏，国内哪些厂家做得比较多？',
      question_category: '',
      platform: 'deepseek',
      platform_name: 'DeepSeek',
      model_name: 'deepseek-v4-flash',
      status: 'completed',
      error_message: '',
      answer: [
        '- **海康威视（Hikvision）**：周界产品线齐全。',
        '- **大华股份（Dahua）**：教育行业项目覆盖广。',
        '- **上海广拓（GATO）**：非通电张力式领域经验丰富。'
      ].join('\n'),
      has_metrics: true,
      brand_mentioned: true,
      brand_mentions: 1,
      brand_rank: 1,
      brand_recommended: false,
      share_of_voice: 100,
      citation_count: 0,
      owned_citation_count: 0,
      competitor_citation_count: 0,
      sentiment: 'positive',
      sentiment_reason: '',
      competitor_mentions: [],
      citation_sources: [],
      created_at: null,
      updated_at: null
    }],
    started_at: new Date('2026-07-23T00:00:00.000Z'),
    completed_at: new Date('2026-07-23T00:01:00.000Z')
  });

  const report = await QuestionSetRunService.getReport({
    projectId: project.id,
    runId: imported.id
  });

  assert.equal(report.rows[0].brand_rank, null);
  assert.equal(report.summary.avg_brand_rank, null);
  assert.equal(report.summary.competitor_baseline_count, 0);
});

test('v2 结构化候选顺序可在无竞品项目中产生品牌排名并随 CSV 往返', async () => {
  const structuredRun = await QuestionSetRun.create({
    project_id: project.id,
    user_id: user.id,
    question_set_id: null,
    question_set_name: '结构化候选顺序',
    source: 'imported',
    schema_version: 'question_set_run_v1',
    imported_rows: [{
      record_id: null,
      question_id: null,
      question: '学校周界厂家有哪些？',
      question_category: '',
      platform: 'deepseek',
      platform_name: 'DeepSeek',
      model_name: 'deepseek-v4-flash',
      status: 'completed',
      error_message: '',
      answer: '1. 海康威视\\n2. 大华股份\\n3. 上海广拓',
      has_metrics: true,
      brand_mentioned: true,
      brand_mentions: 1,
      brand_rank: 3,
      brand_recommended: false,
      share_of_voice: 0,
      citation_count: 1,
      owned_citation_count: 1,
      competitor_citation_count: 0,
      sentiment: 'neutral',
      sentiment_reason: '',
      analysis_method: 'ai_structured_v2',
      analysis_platform: 'analysis-ai',
      analysis_model: 'analysis-model',
      analysis_structure: {
        schema_version: 'geo_metric_input_v2',
        entities: [
          { name: '海康威视', type: 'company' },
          { name: '大华股份', type: 'company' },
          { name: '上海广拓', type: 'company' }
        ],
        mentions: [
          { entity_name: '海康威视', surface_forms: ['海康威视'] },
          { entity_name: '大华股份', surface_forms: ['大华股份'] },
          { entity_name: '上海广拓', surface_forms: ['上海广拓'] }
        ],
        candidate_lists: [{ ordered: true, entries: ['海康威视', '大华股份', '上海广拓'] }],
        recommendations: [],
        claims: [],
        sentiment: { label: 'neutral', reason: '', risk_terms: [] },
        target_entity_name: '上海广拓',
        competitor_matches: [],
        citations: {
          count: 1,
          official_count: 1,
          competitor_count: 0,
          official_website_cited: true,
          sources: [{ url: 'https://gato.com.cn', domain: 'gato.com.cn', owned: true }]
        }
      },
      analysis_evidence: {},
      competitor_mentions: [],
      citation_sources: [{ url: 'https://gato.com.cn', domain: 'gato.com.cn', owned: true }],
      created_at: null,
      updated_at: null
    }],
    started_at: new Date('2026-07-23T02:00:00.000Z'),
    completed_at: new Date('2026-07-23T02:01:00.000Z')
  });

  const report = await QuestionSetRunService.getReport({
    projectId: project.id,
    runId: structuredRun.id
  });
  assert.equal(report.rows[0].brand_rank, 3);
  assert.equal(report.summary.avg_brand_rank, 3);
  assert.deepEqual(report.rows[0].analysis_structure.candidate_lists[0].entries, [
    '海康威视',
    '大华股份',
    '上海广拓'
  ]);

  const csv = await QuestionSetRunService.exportCsv({ projectId: project.id, runId: structuredRun.id });
  const imported = await QuestionSetRunService.importCsv({ project, user, csv });
  const restored = await QuestionSetRunService.getReport({ projectId: project.id, runId: imported.id });
  assert.equal(restored.rows[0].brand_rank, 3);
  assert.equal(restored.rows[0].analysis_structure.citations.official_website_cited, true);
});

test('报告汇总能够识别已配置的竞品基线', () => {
  const summary = QuestionSetRunService.summarize([{
    status: 'completed',
    has_metrics: true,
    brand_mentioned: true,
    brand_recommended: false,
    brand_rank: 2,
    share_of_voice: 40,
    citation_count: 0,
    competitor_mentions: [{ id: 12, name: '竞品甲', mentioned: true }]
  }]);

  assert.equal(summary.competitor_baseline_count, 1);
});

test('新口径没有已采集回答时覆盖率和平均 SOV 保持 N/A', () => {
  const summary = QuestionSetRunService.summarize([{
    status: 'failed',
    answer: '',
    has_metrics: false,
    metric_semantics_version: 'contextual_competitor_mentions_sov_v2_scoped'
  }]);

  assert.equal(summary.valid_answers, 0);
  assert.equal(summary.acquired_answers, 0);
  assert.equal(summary.analysis_coverage_rate, null);
  assert.equal(summary.brand_mention_rate, null);
  assert.equal(summary.recommendation_rate, null);
  assert.equal(summary.sov_calculable_answers, 0);
  assert.equal(summary.avg_answer_competitor_share, null);
  assert.equal(Object.hasOwn(summary, 'avg_share_of_voice'), false);
});

test('历史豆包过渡态标记为采集无效且不进入分析覆盖率分母', async () => {
  const record = await QuestionRecord.create({
    user_id: user.id,
    project_id: project.id,
    tracked_prompt_id: prompt.id,
    platform: 'doubao-web',
    question: '豆包历史搜索状态',
    brand: project.name,
    brand_keywords: project.name,
    analysis_contract_version: 'ai_structured_v5',
    metric_semantics_version: 'contextual_competitor_mentions_sov_v2_scoped',
    status: 'failed',
    error_message: 'AI 结构化结果无效',
    result_summary: {
      web_capture: {
        schema_version: 'doubao-web-capture-v1',
        status: 'completed',
        artifact_owner_record_id: 1,
        artifacts: {
          search_state: { id: '00000000-0000-4000-8000-000000000001' },
          final_answer: { id: '00000000-0000-4000-8000-000000000002' }
        }
      },
      failure: {
        stage: 'analysis_validation',
        error_code: 'invalid_analysis_output'
      }
    }
  });
  await record.update({
    result_summary: {
      ...record.result_summary,
      web_capture: {
        ...record.result_summary.web_capture,
        artifact_owner_record_id: record.id
      }
    }
  });
  await ResultDetail.create({
    question_record_id: record.id,
    ai_response_original: '正在搜索',
    parsing_status: 'completed'
  });
  const run = await createNativeRun(1);
  await record.update({ question_set_run_id: run.id, run_slot_index: 0 });

  const report = await QuestionSetRunService.getReport({
    projectId: project.id,
    runId: run.id
  });

  assert.deepEqual(report.rows[0].capture_quality, {
    status: 'invalid',
    reason_code: 'transient_search_status'
  });
  assert.equal(report.summary.invalid_captures, 1);
  assert.equal(report.summary.acquired_answers, 0);
  assert.equal(report.summary.analysis_coverage_rate, null);

  await run.destroy();
  await record.destroy();
});

test('执行能力由服务端状态机统一给出暂停和继续条件', () => {
  assert.deepEqual(QuestionSetRunService.deriveCapabilities({
    source: 'native',
    status: 'running',
    summary: { pending: 2, failed: 0 },
    integrityStatus: 'complete'
  }), {
    can_pause: true,
    pause_disabled_reason: null,
    can_resume: false,
    resume_disabled_reason: 'not_paused',
    can_retry: false,
    retry_disabled_reason: 'run_not_terminal'
  });
  assert.deepEqual(QuestionSetRunService.deriveCapabilities({
    source: 'native',
    status: 'paused',
    summary: { pending: 2, failed: 0 },
    integrityStatus: 'complete'
  }), {
    can_pause: false,
    pause_disabled_reason: 'not_running',
    can_resume: true,
    resume_disabled_reason: null,
    can_retry: false,
    retry_disabled_reason: 'run_not_terminal'
  });
});

test('报告从有效执行租约区分暂停收尾和已暂停且不泄漏租约字段', async () => {
  const run = await createNativeRun(2);
  await run.update({ paused_at: new Date('2026-07-31T10:00:00.000Z') });
  const executing = await QuestionRecord.create({
    user_id: user.id,
    project_id: project.id,
    tracked_prompt_id: prompt.id,
    question_set_run_id: run.id,
    run_slot_index: 0,
    platform: 'deepseek',
    question: '正在执行的问题',
    brand: project.name,
    brand_keywords: project.name,
    status: 'pending',
    execution_token: 'private-token',
    execution_started_at: new Date(),
    lease_owner: 'private-owner',
    lease_expires_at: new Date('2099-01-01T00:00:00.000Z')
  });
  const queued = await QuestionRecord.create({
    user_id: user.id,
    project_id: project.id,
    tracked_prompt_id: prompt.id,
    question_set_run_id: run.id,
    run_slot_index: 1,
    platform: 'deepseek',
    question: '等待处理的问题',
    brand: project.name,
    brand_keywords: project.name,
    status: 'pending'
  });

  const pausing = await QuestionSetRunService.getReport({
    projectId: project.id,
    runId: run.id
  });
  assert.equal(pausing.status, 'paused');
  assert.equal(pausing.control_state, 'pausing');
  assert.deepEqual(pausing.execution_summary, {
    total: 2,
    completed: 0,
    failed: 0,
    pending: 2,
    executing: 1,
    queued: 1,
    failure_stages: {}
  });
  assert.deepEqual(pausing.rows.map((row) => row.execution_state), ['executing', 'queued']);
  assert.equal(Object.hasOwn(pausing.rows[0], 'execution_token'), false);
  assert.equal(Object.hasOwn(pausing.rows[0], 'lease_owner'), false);
  assert.equal(Object.hasOwn(pausing.rows[0], 'lease_expires_at'), false);

  await executing.update({ lease_expires_at: new Date('2000-01-01T00:00:00.000Z') });
  const paused = await QuestionSetRunService.getReport({
    projectId: project.id,
    runId: run.id
  });
  assert.equal(paused.control_state, 'paused');
  assert.equal(paused.execution_summary.executing, 0);
  assert.equal(paused.execution_summary.queued, 2);
  assert.deepEqual(paused.rows.map((row) => row.execution_state), ['queued', 'queued']);

  await QuestionRecord.destroy({ where: { id: [executing.id, queued.id] } });
  await run.destroy();
});

test('失败阶段聚合把外部阶段名当作普通数据', () => {
  const summary = QuestionSetRunService.summarizeExecution([
    {
      status: 'failed',
      failure: { stage: '__proto__' }
    }
  ]);

  assert.equal(Object.hasOwn(summary.failure_stages, '__proto__'), true);
  assert.equal(summary.failure_stages.__proto__, 1);
  assert.equal(Object.getPrototypeOf(summary.failure_stages), Object.prototype);
});

test('导入拒绝引用来源中的非网页协议', async () => {
  const nativeRun = await QuestionSetRun.findOne({
    where: { project_id: project.id, source: 'native' },
    order: [['id', 'DESC']]
  });
  const csv = await QuestionSetRunService.exportCsv({ projectId: project.id, runId: nativeRun.id });
  const unsafeCsv = csv.replace('https://www.gato.com.cn/guide', 'javascript:alert(1)');

  await assert.rejects(
    QuestionSetRunService.importCsv({ project, user, csv: unsafeCsv }),
    (error) => error?.code === 'INVALID_FIELD' && /citation_sources_json/.test(error.message)
  );
});

test('导入拒绝把同名问题集的不同运行拼成一份报告', async () => {
  const nativeRun = await QuestionSetRun.findOne({
    where: { project_id: project.id, source: 'native' },
    order: [['id', 'DESC']]
  });
  const csv = await QuestionSetRunService.exportCsv({ projectId: project.id, runId: nativeRun.id });
  const lines = csv.split('\n');
  lines[2] = lines[2].replace(
    `question_set_run_v1,${nativeRun.id},`,
    `question_set_run_v1,${nativeRun.id + 1000},`
  );

  await assert.rejects(
    QuestionSetRunService.importCsv({ project, user, csv: lines.join('\n') }),
    (error) => error?.code === 'MIXED_REPORTS'
  );
});

test('CSV 公式防护不会破坏原本以制表符开头的内容', () => {
  const report = {
    id: 99,
    question_set_name: '公式字符回导测试',
    started_at: new Date('2026-07-23T00:00:00.000Z'),
    completed_at: new Date('2026-07-23T00:01:00.000Z'),
    rows: [{
      record_id: 1,
      question_id: 2,
      question: '=SUM(1,1)',
      question_category: '',
      platform: 'deepseek',
      platform_name: 'DeepSeek',
      model_name: '',
      status: 'completed',
      error_message: '',
      answer: '\t=这不是公式',
      has_metrics: false,
      brand_mentioned: false,
      brand_mentions: 0,
      brand_rank: null,
      brand_recommended: false,
      share_of_voice: 0,
      citation_count: 0,
      sentiment: '',
      sentiment_reason: '',
      competitor_mentions: [],
      citation_sources: [],
      created_at: null,
      updated_at: null
    }]
  };

  const parsed = QuestionSetRunCsvService.parseCsv(QuestionSetRunCsvService.buildCsv(report));

  assert.equal(parsed.rows[0].question, '=SUM(1,1)');
  assert.equal(parsed.rows[0].answer, '\t=这不是公式');
});
