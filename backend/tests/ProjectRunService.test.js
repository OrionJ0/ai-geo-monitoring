const test = require('node:test');
const assert = require('node:assert/strict');

const {
  QuestionRecord,
  QuestionSetRun,
  QuestionSetRetryBatch,
  ResultDetail,
  BrandCompetitor
} = require('../models');
const AIPlatformService = require('../services/AIPlatformService');
const WebPlatformRegistry = require('../services/WebPlatformRegistry');
const ProjectRunService = require('../services/ProjectRunService');
const { ProjectRunService: ProjectRunServiceClass } = require('../services/ProjectRunService');
const { AIAnalysisConfigError } = require('../services/AIAnalysisConfigService');
const { AIResponseAnalysisError } = require('../services/AIResponseAnalysisService');
const AIResponseAnalysisService = require('../services/AIResponseAnalysisService');
const AlertEvaluationService = require('../services/AlertEvaluationService');

const originalAnalysisConfigService = ProjectRunService.analysisConfigService;

test.beforeEach(() => {
  ProjectRunService.analysisConfigService = {
    getAnalysisPlatform: async () => ({ code: 'analysis-ready' })
  };
});

test.after(() => {
  ProjectRunService.analysisConfigService = originalAnalysisConfigService;
});

test('builds project run targets from enabled prompts and globally enabled platforms', () => {
  const targets = ProjectRunService.buildPromptTargets([
    { id: 1, question: '问题一', enabled: true, platforms: ['doubao', 'deepseek', 'kimi'] },
    { id: 2, question: '问题二', enabled: false, platforms: ['doubao'] },
    { id: 3, question: '问题三', enabled: true, platforms: [] }
  ], ['doubao', 'deepseek'], ['deepseek']);

  assert.deepEqual(targets, [
    { prompt: { id: 1, question: '问题一', enabled: true, platforms: ['doubao', 'deepseek', 'kimi'] }, platform: 'doubao' },
    { prompt: { id: 1, question: '问题一', enabled: true, platforms: ['doubao', 'deepseek', 'kimi'] }, platform: 'deepseek' },
    { prompt: { id: 3, question: '问题三', enabled: true, platforms: [] }, platform: 'doubao' },
    { prompt: { id: 3, question: '问题三', enabled: true, platforms: [] }, platform: 'deepseek' }
  ]);
});

test('ignores legacy per-prompt platform fields when building run targets', () => {
  const targets = ProjectRunService.buildPromptTargets([
    { id: 1, question: '只跑豆包', enabled: true, platforms: ['doubao'] },
    { id: 2, question: '只跑 DeepSeek', enabled: true, platforms: ['deepseek'] },
    { id: 3, question: '继承项目平台', enabled: true, platforms: [] }
  ], ['doubao', 'deepseek'], ['doubao', 'deepseek']);

  assert.deepEqual(targets, [
    { prompt: { id: 1, question: '只跑豆包', enabled: true, platforms: ['doubao'] }, platform: 'doubao' },
    { prompt: { id: 1, question: '只跑豆包', enabled: true, platforms: ['doubao'] }, platform: 'deepseek' },
    { prompt: { id: 2, question: '只跑 DeepSeek', enabled: true, platforms: ['deepseek'] }, platform: 'doubao' },
    { prompt: { id: 2, question: '只跑 DeepSeek', enabled: true, platforms: ['deepseek'] }, platform: 'deepseek' },
    { prompt: { id: 3, question: '继承项目平台', enabled: true, platforms: [] }, platform: 'doubao' },
    { prompt: { id: 3, question: '继承项目平台', enabled: true, platforms: [] }, platform: 'deepseek' }
  ]);
});

test('ignores legacy project platform arguments when building run targets', () => {
  const targets = ProjectRunService.buildPromptTargets([
    { id: 1, question: '只跑豆包', enabled: true, platforms: ['doubao'] }
  ], ['doubao', 'deepseek'], ['deepseek']);

  assert.deepEqual(targets, [
    { prompt: { id: 1, question: '只跑豆包', enabled: true, platforms: ['doubao'] }, platform: 'doubao' },
    { prompt: { id: 1, question: '只跑豆包', enabled: true, platforms: ['doubao'] }, platform: 'deepseek' }
  ]);
});

test('only active projects are runnable', () => {
  assert.equal(ProjectRunService.isRunnableProject({ status: 'active' }), true);
  assert.equal(ProjectRunService.isRunnableProject({ status: 'archived' }), false);
  assert.equal(ProjectRunService.isRunnableProject(null), false);
});

test('attributes admin initiated project runs to the project owner', () => {
  const owner = ProjectRunService.resolveRunUser(
    { id: 2, user_id: 9 },
    { id: 1, role: 'admin', username: 'admin' }
  );
  const regularUser = ProjectRunService.resolveRunUser(
    { id: 2, user_id: 9 },
    { id: 9, role: 'user', username: 'owner' }
  );

  assert.equal(owner.id, 9);
  assert.equal(owner.actor_user_id, 1);
  assert.equal(regularUser.id, 9);
  assert.equal(regularUser.actor_user_id, undefined);
});

test('reports selected prompt availability separately from api key availability', async () => {
  const result = await ProjectRunService.runProject({
    project: { id: 1, user_id: 1, status: 'active', platforms: ['deepseek'] },
    prompts: [],
    user: { id: 1, role: 'user' }
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.message, '问题集中没有启用的问题。');
  assert.equal(result.data.error_code, 'no_enabled_questions');
});

test('blocks project monitoring before platform preflight when analysis API is missing', async () => {
  let availabilityCalls = 0;
  const originalGetAvailability = AIPlatformService.getPlatformAvailability;
  AIPlatformService.getPlatformAvailability = async () => {
    availabilityCalls += 1;
    return [];
  };
  const service = new ProjectRunServiceClass({
    analysisConfigService: {
      getAnalysisPlatform: async () => {
        throw new AIAnalysisConfigError(
          '尚未配置 AI 分析 API',
          'analysis_api_not_configured',
          503
        );
      }
    }
  });

  try {
    const result = await service.planProjectRun({
      project: { id: 1, user_id: 1, status: 'active', platforms: ['deepseek-web'] },
      prompts: [{
        id: 2,
        question: 'GEO 怎么做',
        enabled: true,
        platforms: ['deepseek-web']
      }],
      user: { id: 1, role: 'user' }
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
    assert.equal(result.data.error_code, 'analysis_api_not_configured');
    assert.equal(result.data.settings_url, '/admin/settings');
    assert.match(result.message, /设置中心.*AI 分析 API/);
    assert.equal(availabilityCalls, 0);
  } finally {
    AIPlatformService.getPlatformAvailability = originalGetAvailability;
  }
});

test('blocks a failed-item retry before creating another attempt when analysis API is missing', async () => {
  const originalFindRun = QuestionSetRun.findOne;
  const originalFindBatch = QuestionSetRetryBatch.findOne;
  const originalFindRecords = QuestionRecord.findAll;
  let recordReads = 0;
  QuestionSetRun.findOne = async () => ({
    id: 41,
    source: 'native',
    planned_record_count: 1
  });
  QuestionSetRetryBatch.findOne = async () => null;
  QuestionRecord.findAll = async () => {
    recordReads += 1;
    return [];
  };
  const service = new ProjectRunServiceClass({
    analysisConfigService: {
      getAnalysisPlatform: async () => {
        throw new AIAnalysisConfigError(
          '尚未配置 AI 分析 API',
          'analysis_api_not_configured',
          503
        );
      }
    }
  });

  try {
    await assert.rejects(
      service.retryFailedQuestionSetRun({
        project: { id: 2, status: 'active', platforms: ['deepseek-web'] },
        runId: 41,
        user: { id: 1, role: 'user' },
        idempotencyKey: 'missing-analysis-retry'
      }),
      (error) => (
        error.status === 503
        && error.exposeToClient === true
        && error.data?.error_code === 'analysis_api_not_configured'
        && error.data?.settings_url === '/admin/settings'
      )
    );
    assert.equal(recordReads, 0);
  } finally {
    QuestionSetRun.findOne = originalFindRun;
    QuestionSetRetryBatch.findOne = originalFindBatch;
    QuestionRecord.findAll = originalFindRecords;
  }
});

test('builds keyword stats list from brand, aliases and brand product terms', () => {
  const keywords = ProjectRunService.buildBrandKeywordList({
    name: '米其林',
    aliases: ['Michelin', '米其林'],
    primary_keywords: ['静音轮胎', '米其林静音轮胎', '轮胎', 'Michelin Pilot Sport']
  });

  assert.deepEqual(keywords, ['米其林', 'Michelin', '米其林静音轮胎', 'Michelin Pilot Sport']);
});

test('derives prompt category from tags before question text', () => {
  assert.equal(ProjectRunService.derivePromptCategory({
    question: '米其林和马牌哪个更适合家用',
    tags: ['竞品对比', '轮胎']
  }), '竞品对比');

  assert.equal(ProjectRunService.derivePromptCategory({
    question: '买静音轮胎主要看哪些参数',
    tags: []
  }), '购买决策');
});

test('derives prompt categories from common user question intents', () => {
  assert.equal(ProjectRunService.derivePromptCategory({ question: '豆包的替代方案有哪些' }), '替代方案');
  assert.equal(ProjectRunService.derivePromptCategory({ question: '新能源车轮胎价格' }), '价格成本');
  assert.equal(ProjectRunService.derivePromptCategory({ question: '轮胎售后风险有哪些' }), '风险顾虑');
  assert.equal(ProjectRunService.derivePromptCategory({ question: 'DeepSeek 和豆包哪个更适合内容团队' }), '竞品对比');
});

test('commits the visibility metric and completed record in one transaction', async () => {
  const originalBuildPayload = ProjectRunService.buildVisibilityMetricPayload;
  const originalPersistMetric = ProjectRunService.persistVisibilityMetric;
  const originalRunInTransaction = ProjectRunService.runInTransaction;
  const transaction = { id: 'analysis-transaction' };
  const updates = [];
  let persistedTransaction;
  ProjectRunService.buildVisibilityMetricPayload = async () => ({ project_id: 2 });
  ProjectRunService.persistVisibilityMetric = async (input) => {
    persistedTransaction = input.transaction;
    return { id: 99 };
  };
  ProjectRunService.runInTransaction = async (work) => work(transaction);

  try {
    const result = await ProjectRunService.finalizeSuccessfulRecord({
      record: {
        id: 12,
        result_summary: {
          retry: { previous_record_id: 8, attempt: 1 }
        },
        update: async (payload, options) => updates.push({ payload, options })
      },
      responseText: '广拓值得关注',
      aiResponse: {},
      project: { id: 2, name: '广拓' },
      competitors: [],
      prompt: { id: 3, question: '周界报警怎么选' },
      keywords: ['广拓']
    });

    assert.equal(result.ok, true);
    assert.equal(persistedTransaction, transaction);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].payload.status, 'completed');
    assert.deepEqual(updates[0].payload.result_summary.retry, {
      previous_record_id: 8,
      attempt: 1
    });
    assert.equal(updates[0].options.transaction, transaction);
  } finally {
    ProjectRunService.buildVisibilityMetricPayload = originalBuildPayload;
    ProjectRunService.persistVisibilityMetric = originalPersistMetric;
    ProjectRunService.runInTransaction = originalRunInTransaction;
  }
});

test('marks a completed AI response as failed when metric generation fails', async () => {
  const originalBuildPayload = ProjectRunService.buildVisibilityMetricPayload;
  const updates = [];
  ProjectRunService.buildVisibilityMetricPayload = async () => {
    throw new Error('metric write failed');
  };

  try {
    const result = await ProjectRunService.finalizeSuccessfulRecord({
      record: {
        id: 12,
        update: async (payload) => updates.push(payload)
      },
      responseText: '米其林静音轮胎不错',
      aiResponse: {},
      project: { id: 2, name: '米其林' },
      competitors: [],
      prompt: { id: 3, question: '静音轮胎怎么选' },
      keywords: ['米其林']
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'failed');
    assert.equal(updates.length, 1);
    assert.equal(updates[0].status, 'failed');
    assert.equal(updates[0].error_message, '指标生成失败，请稍后重试');
    assert.equal(result.error, '指标生成失败，请稍后重试');
  } finally {
    ProjectRunService.buildVisibilityMetricPayload = originalBuildPayload;
  }
});

test('explains that invalid AI structure is excluded instead of falling back to rules', async () => {
  const originalBuildPayload = ProjectRunService.buildVisibilityMetricPayload;
  const originalPersistResultDetail = ProjectRunService.persistResultDetail;
  const originalRunInTransaction = ProjectRunService.runInTransaction;
  const updates = [];
  const persistedDetails = [];
  const webCapture = {
    status: 'completed',
    artifact_owner_record_id: 13,
    artifacts: {
      final_answer: { id: '00000000-0000-4000-8000-000000000004' }
    }
  };
  ProjectRunService.buildVisibilityMetricPayload = async () => {
    throw new AIResponseAnalysisError(
      '证据不在原回答中',
      'invalid_analysis_output',
      {
        stage: 'parse_or_validate',
        attempt_count: 2,
        platform: 'deepseek',
        model: 'deepseek-v4-pro',
        finish_reason: 'stop',
        output_length: 321,
        usage: { prompt_tokens: 120, completion_tokens: 18, total_tokens: 138 }
      }
    );
  };
  ProjectRunService.persistResultDetail = async (payload) => persistedDetails.push(payload);
  ProjectRunService.runInTransaction = async (work) => work({ id: 'failure-transaction' });

  try {
    const result = await ProjectRunService.finalizeSuccessfulRecord({
      record: {
        id: 13,
        result_summary: {
          retry: { previous_record_id: 9, attempt: 2 }
        },
        update: async (payload) => updates.push(payload)
      },
      responseText: '原始回答仍然保留',
      aiResponse: {},
      project: { id: 1, name: '广拓' },
      competitors: [],
      prompt: { id: 1, question: '示例问题' },
      keywords: ['广拓'],
      providerCitations: [{
        url: 'https://example.com/source',
        source_role: 'explicit_citation'
      }],
      persistResponseDetail: true,
      resultSummaryPatch: { web_capture: webCapture }
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'AI 结构化结果无效，本条未计入品牌指标');
    assert.deepEqual(updates[0], {
      status: 'failed',
      error_message: 'AI 结构化结果无效，本条未计入品牌指标',
      result_summary: {
        retry: {
          previous_record_id: 9,
          attempt: 2
        },
        web_capture: webCapture,
        failure: {
          stage: 'analysis_validation',
          error_code: 'invalid_analysis_output'
        },
        keyword_counts: [],
        analysis: {
          status: 'failed',
          error_code: 'invalid_analysis_output',
          error_detail: '证据不在原回答中',
          stage: 'parse_or_validate',
          attempt_count: 2,
          platform: 'deepseek',
          model: 'deepseek-v4-pro',
          finish_reason: 'stop',
          output_length: 321,
          usage: { prompt_tokens: 120, completion_tokens: 18, total_tokens: 138 }
        }
      }
    });
    assert.equal(updates[0].result_summary.analysis.raw_output, undefined);
    assert.equal(persistedDetails.length, 1);
    assert.equal(persistedDetails[0].responseText, '原始回答仍然保留');
    assert.equal(persistedDetails[0].providerCitations.length, 1);
    assert.equal(persistedDetails[0].citationAnalysis.evidence_status, 'explicit');
    assert.equal(persistedDetails[0].citationAnalysis.citation_count, 1);
    assert.equal(
      persistedDetails[0].citationAnalysis.sources[0].url,
      'https://example.com/source'
    );
    assert.deepEqual(persistedDetails[0].transaction, { id: 'failure-transaction' });
  } finally {
    ProjectRunService.buildVisibilityMetricPayload = originalBuildPayload;
    ProjectRunService.persistResultDetail = originalPersistResultDetail;
    ProjectRunService.runInTransaction = originalRunInTransaction;
  }
});

test('preserves the full answer and citations when analysis input exceeds the model context', async () => {
  const originalBuildPayload = ProjectRunService.buildVisibilityMetricPayload;
  const originalPersistResultDetail = ProjectRunService.persistResultDetail;
  const originalPersistMetric = ProjectRunService.persistVisibilityMetric;
  const originalRunInTransaction = ProjectRunService.runInTransaction;
  const updates = [];
  const persistedDetails = [];
  let metricWrites = 0;
  ProjectRunService.buildVisibilityMetricPayload = async () => {
    throw new AIResponseAnalysisError(
      '提交内容超出模型可处理范围。',
      'analysis_input_too_long',
      {
        stage: 'request',
        platform: 'analysis-ai',
        attempt_count: 1
      }
    );
  };
  ProjectRunService.persistResultDetail = async (payload) => persistedDetails.push(payload);
  ProjectRunService.persistVisibilityMetric = async () => {
    metricWrites += 1;
  };
  ProjectRunService.runInTransaction = async (work) => work({ id: 'failure-transaction' });

  try {
    const result = await ProjectRunService.finalizeSuccessfulRecord({
      record: {
        id: 14,
        analysis_contract_version: 'ai_structured_v4',
        metric_semantics_version: 'contextual_competitor_mentions_sov_v1',
        update: async (payload) => updates.push(payload)
      },
      responseText: '必须原样保留的完整长回答',
      aiResponse: {},
      project: { id: 1, name: '广拓' },
      competitors: [],
      prompt: { id: 1, question: '示例问题' },
      keywords: ['广拓'],
      providerCitations: [{
        url: 'https://example.com/source',
        source_role: 'explicit_citation'
      }],
      persistResponseDetail: true
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, '回答超出分析模型范围，本条未计入品牌指标');
    assert.equal(updates[0].result_summary.failure.stage, 'analysis_request');
    assert.equal(updates[0].result_summary.failure.error_code, 'analysis_input_too_long');
    assert.equal(persistedDetails[0].responseText, '必须原样保留的完整长回答');
    assert.equal(persistedDetails[0].providerCitations.length, 1);
    assert.equal(metricWrites, 0);
  } finally {
    ProjectRunService.buildVisibilityMetricPayload = originalBuildPayload;
    ProjectRunService.persistResultDetail = originalPersistResultDetail;
    ProjectRunService.persistVisibilityMetric = originalPersistMetric;
    ProjectRunService.runInTransaction = originalRunInTransaction;
  }
});

test('deduplicates overlapping brand keywords in record keyword counts', async () => {
  const originalBuildPayload = ProjectRunService.buildVisibilityMetricPayload;
  const originalPersistMetric = ProjectRunService.persistVisibilityMetric;
  const originalRunInTransaction = ProjectRunService.runInTransaction;
  const updates = [];
  ProjectRunService.buildVisibilityMetricPayload = async () => ({ project_id: 2 });
  ProjectRunService.persistVisibilityMetric = async () => ({ id: 99 });
  ProjectRunService.runInTransaction = async (work) => work({ id: 'keyword-transaction' });

  try {
    const result = await ProjectRunService.finalizeSuccessfulRecord({
      record: {
        id: 12,
        update: async (payload) => updates.push(payload)
      },
      responseText: '豆包大模型适合中文内容生产，DeepSeek 适合代码场景。',
      aiResponse: {},
      project: { id: 2, name: '豆包', primary_keywords: ['豆包大模型'] },
      competitors: [],
      prompt: { id: 3, question: 'AI 平台怎么选' },
      keywords: ['豆包', '豆包大模型']
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.keyword_counts, [
      { keyword: '豆包大模型', count: 1 }
    ]);
    assert.deepEqual(updates[0].result_summary.keyword_counts, [
      { keyword: '豆包大模型', count: 1 }
    ]);
  } finally {
    ProjectRunService.buildVisibilityMetricPayload = originalBuildPayload;
    ProjectRunService.persistVisibilityMetric = originalPersistMetric;
    ProjectRunService.runInTransaction = originalRunInTransaction;
  }
});

test('counts compact brand spellings in record keyword counts without exposing compact keywords', async () => {
  const originalBuildPayload = ProjectRunService.buildVisibilityMetricPayload;
  const originalPersistMetric = ProjectRunService.persistVisibilityMetric;
  const originalRunInTransaction = ProjectRunService.runInTransaction;
  const updates = [];
  ProjectRunService.buildVisibilityMetricPayload = async () => ({ project_id: 2 });
  ProjectRunService.persistVisibilityMetric = async () => ({ id: 99 });
  ProjectRunService.runInTransaction = async (work) => work({ id: 'keyword-transaction' });

  try {
    const result = await ProjectRunService.finalizeSuccessfulRecord({
      record: {
        id: 12,
        update: async (payload) => updates.push(payload)
      },
      responseText: 'GoodieAI 适合做品牌可见度监测。',
      aiResponse: {},
      project: { id: 2, name: 'Goodie AI' },
      competitors: [],
      prompt: { id: 3, question: 'GEO 工具怎么选' },
      keywords: ['Goodie AI']
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.keyword_counts, [
      { keyword: 'Goodie AI', count: 1 }
    ]);
    assert.deepEqual(updates[0].result_summary.keyword_counts, [
      { keyword: 'Goodie AI', count: 1 }
    ]);
  } finally {
    ProjectRunService.buildVisibilityMetricPayload = originalBuildPayload;
    ProjectRunService.persistVisibilityMetric = originalPersistMetric;
    ProjectRunService.runInTransaction = originalRunInTransaction;
  }
});

test('builds complete visibility metric payload for any project detection path', async () => {
  const originalAnalyze = AIResponseAnalysisService.analyze;
  AIResponseAnalysisService.analyze = async () => ({
    brand_mentioned: true,
    brand_mentions: 1,
    brand_position: 1,
    brand_rank: 1,
    brand_recommended: true,
    visibility_score: 1,
    competitor_mentions: [],
    share_of_voice: 50,
    sentiment: 'positive',
    sentiment_reason: '明确推荐品牌',
    sentiment_risk_terms: ['价格高'],
    analysis_method: 'ai_structured_v2',
    analysis_platform: 'analysis-ai',
    analysis_model: 'analysis-model',
    analysis_structure: {
      schema_version: 'geo_metric_input_v2',
      entities: [{ name: '米其林', type: 'brand' }],
      mentions: [{ entity_name: '米其林', surface_forms: ['米其林'] }],
      candidate_lists: [{ ordered: true, entries: ['米其林'] }],
      recommendations: [{ entity_name: '米其林', kind: 'explicit' }],
      claims: [],
      sentiment: { label: 'positive', reason: '明确推荐品牌', risk_terms: ['价格高'] },
      target_entity_name: '米其林',
      competitor_matches: [{ configured_name: '马牌', entity_name: null }]
    }
  });

  try {
    const payload = await ProjectRunService.buildVisibilityMetricPayload({
      record: {
        id: 9,
        user_id: 1,
        platform: 'deepseek',
        tracked_prompt_id: 3
      },
      responseText: '米其林静音轮胎值得推荐。参考 https://www.michelin.com.cn/tire?id=1',
      aiResponse: {},
      providerCitations: ProjectRunService.snapshotProviderCitations({
        citations: [
          { url: 'https://www.michelin.com.cn/tire?id=1', title: '米其林官网' }
        ]
      }),
      project: {
        id: 2,
        name: '米其林',
        aliases: ['Michelin'],
        website: 'https://www.michelin.com.cn',
        primary_keywords: ['米其林静音轮胎']
      },
      competitors: [
        { name: '马牌', website: 'https://www.continental-tires.cn' }
      ],
      prompt: {
        id: 3,
        question: '静音轮胎怎么选',
        tags: ['购买决策']
      }
    });

    assert.equal(payload.project_id, 2);
    assert.equal(payload.prompt_id, 3);
    assert.equal(payload.brand_mentioned, true);
    assert.equal(payload.brand_rank, 1);
    assert.equal(payload.brand_recommended, true);
    assert.equal(payload.citation_count, 1);
    assert.equal(payload.owned_citation_count, 1);
    assert.equal(payload.prompt_category, '购买决策');
    assert.equal(payload.sentiment, 'positive');
    assert.equal(payload.sentiment_reason, '明确推荐品牌');
    assert.deepEqual(payload.sentiment_risk_terms, ['价格高']);
    assert.equal(payload.analysis_method, 'ai_structured_v2');
    assert.equal(payload.analysis_platform, 'analysis-ai');
    assert.equal(payload.analysis_model, 'analysis-model');
    assert.equal(payload.analysis_structure.citations.count, 1);
    assert.equal(payload.analysis_structure.citations.semantics_version, 'explicit-citation-v2');
    assert.equal(payload.analysis_structure.citations.official_website_cited, true);
    assert.equal(payload.analysis_structure.citations.sources[0].domain, 'michelin.com.cn');
    assert.deepEqual(
      payload.analysis_structure.citations.source_groups.response_links.map((source) => source.url),
      ['https://michelin.com.cn/tire?id=1']
    );
    assert.deepEqual(payload.analysis_evidence, {});
  } finally {
    AIResponseAnalysisService.analyze = originalAnalyze;
  }
});

test('keeps provider retrieval candidates out of stored citation metrics', () => {
  const snapshot = ProjectRunService.snapshotProviderCitations({
    citations: [{ url: 'https://cited.example.com/report' }],
    web_search: [{ url: 'https://retrieved.example.com/result' }],
    search_results: [{ url: 'https://retrieved.example.com/other' }]
  });

  assert.deepEqual(snapshot.map((source) => source.source_role), [
    'explicit_citation',
    'retrieval_candidate',
    'retrieval_candidate'
  ]);
});

test('promotes TokenHub search_results referenced by answer markers to explicit citations', () => {
  const snapshot = ProjectRunService.snapshotProviderCitations({
    choices: [{
      message: {
        content: '第一项事实来自已引用来源[1]，第二项没有引用标记，危险来源不能成为引用[3]。',
        search_results: [{
          index: 1,
          name: '已引用来源',
          url: 'https://cited.example.com/report'
        }, {
          index: 2,
          name: '仅检索来源',
          url: 'https://retrieved.example.com/result'
        }, {
          index: 3,
          name: '危险来源',
          url: 'javascript://unsafe.example.com/alert'
        }]
      }
    }]
  });

  assert.deepEqual(
    snapshot
      .filter((source) => source.url === 'https://cited.example.com/report')
      .map((source) => source.source_role),
    ['retrieval_candidate', 'explicit_citation']
  );
  assert.deepEqual(
    snapshot
      .filter((source) => source.url === 'https://retrieved.example.com/result')
      .map((source) => source.source_role),
    ['retrieval_candidate']
  );
  assert.deepEqual(
    snapshot
      .filter((source) => source.url === 'javascript://unsafe.example.com/alert')
      .map((source) => source.source_role),
    []
  );
});

test('preserves explicit citation when the same URL also appears as a retrieval candidate', () => {
  const snapshot = ProjectRunService.snapshotProviderCitations({
    output: [{
      type: 'web_search_call',
      action: {
        sources: [{ url: 'https://example.com/report', title: '同一来源' }]
      }
    }, {
      type: 'message',
      content: [{
        type: 'output_text',
        annotations: [{
          type: 'url_citation',
          url_citation: { url: 'https://example.com/report', title: '同一来源' }
        }]
      }]
    }]
  });

  assert.deepEqual(snapshot.map((source) => source.source_role), [
    'retrieval_candidate',
    'explicit_citation'
  ]);
});

test('uses the structured analysis result when the target brand is absent', async () => {
  const originalAnalyze = AIResponseAnalysisService.analyze;
  AIResponseAnalysisService.analyze = async () => ({
    brand_mentioned: false,
    brand_mentions: 0,
    brand_position: null,
    brand_rank: null,
    brand_recommended: false,
    visibility_score: 0,
    competitor_mentions: [{
      id: null,
      name: '马牌',
      mentioned: true,
      mentions: 1,
      recommended: true,
      position: 1,
      rank: 1,
      evidence: ['马牌']
    }],
    share_of_voice: 0,
    sentiment: 'neutral',
    sentiment_reason: '未提及目标品牌',
    sentiment_risk_terms: [],
    analysis_method: 'ai_structured_v2',
    analysis_platform: 'analysis-ai',
    analysis_model: 'analysis-model',
    analysis_structure: {
      schema_version: 'geo_metric_input_v2',
      entities: [{ name: '马牌', type: 'brand' }],
      mentions: [{ entity_name: '马牌', surface_forms: ['马牌'] }],
      candidate_lists: [],
      recommendations: [{ entity_name: '马牌', kind: 'explicit' }],
      claims: [],
      sentiment: { label: 'neutral', reason: '未提及目标品牌', risk_terms: [] },
      target_entity_name: null,
      competitor_matches: [{ configured_name: '马牌', entity_name: '马牌' }]
    }
  });

  try {
    const payload = await ProjectRunService.buildVisibilityMetricPayload({
      record: {
        id: 10,
        user_id: 1,
        platform: 'deepseek',
        tracked_prompt_id: 4
      },
      responseText: '马牌在静音轮胎场景值得推荐，整体口碑不错。',
      aiResponse: {},
      project: {
        id: 2,
        name: '米其林',
        aliases: ['Michelin'],
        website: 'https://www.michelin.com.cn',
        primary_keywords: ['米其林静音轮胎']
      },
      competitors: [
        { name: '马牌', website: 'https://www.continental-tires.cn' }
      ],
      prompt: {
        id: 4,
        question: '静音轮胎怎么选',
        tags: ['购买决策']
      }
    });

    assert.equal(payload.brand_mentioned, false);
    assert.equal(payload.sentiment, 'neutral');
    assert.equal(payload.analysis_method, 'ai_structured_v2');
  } finally {
    AIResponseAnalysisService.analyze = originalAnalyze;
  }
});

test('persists the v4 answer-level SOV contract without passing project competitors into semantic analysis', async () => {
  const originalAnalyze = AIResponseAnalysisService.analyze;
  let analysisInput;
  AIResponseAnalysisService.analyze = async (input) => {
    analysisInput = input;
    return {
      metric_semantics_version: 'contextual_competitor_mentions_sov_v1',
      brand_mentioned: true,
      brand_mentions: 2,
      brand_position: null,
      brand_rank: null,
      brand_recommended: false,
      visibility_score: 2,
      answer_competitor_share: 50,
      sov_numerator: 2,
      sov_denominator: 4,
      competition_entities: [{
        name: '海康',
        relation: 'competitor',
        reason: '提供同类周界方案',
        evidence: ['海康都提供周界方案'],
        mentions: 2,
        surface_forms: ['海康', '海康']
      }],
      sentiment: 'neutral',
      sentiment_reason: '客观列举',
      sentiment_risk_terms: [],
      analysis_method: 'ai_structured_v4',
      analysis_platform: 'analysis-ai',
      analysis_model: 'analysis-model',
      analysis_structure: {
        schema_version: 'geo_metric_input_v4',
        competitor_relations: [{
          entity_name: '海康',
          relation: 'competitor',
          reason: '提供同类周界方案',
          evidence: ['海康都提供周界方案']
        }],
        candidate_lists: [],
        sentiment: {
          label: 'neutral',
          reason: '客观列举',
          evidence: ['广拓与海康都提供周界方案'],
          risk_terms: []
        }
      }
    };
  };

  try {
    const payload = await ProjectRunService.buildVisibilityMetricPayload({
      record: {
        id: 11,
        user_id: 1,
        platform: 'deepseek',
        tracked_prompt_id: 5,
        question: '哪些厂商提供周界安防方案？'
      },
      responseText: '广拓与海康都提供周界方案。',
      aiResponse: {},
      project: {
        id: 2,
        name: '广拓',
        aliases: ['GATO'],
        industry: '周界安防',
        primary_keywords: ['电子围栏']
      },
      competitors: [{ name: '海康', aliases: ['海康威视'] }],
      prompt: {
        id: 5,
        question: '哪些厂商提供周界安防方案？',
        tags: ['购买决策']
      }
    });

    assert.equal(analysisInput.question, '哪些厂商提供周界安防方案？');
    assert.equal(Object.hasOwn(analysisInput, 'competitorHints'), false);
    assert.equal(
      payload.metric_semantics_version,
      'contextual_competitor_mentions_sov_v1'
    );
    assert.equal(payload.answer_competitor_share, 50);
    assert.equal(payload.sov_numerator, 2);
    assert.equal(payload.sov_denominator, 4);
    assert.equal(payload.share_of_voice, null);
    assert.deepEqual(payload.competitor_mentions, []);
    assert.equal(payload.competition_entities[0].reason, '提供同类周界方案');
    assert.deepEqual(
      payload.competition_entities[0].evidence,
      ['海康都提供周界方案']
    );
    assert.deepEqual(
      payload.analysis_structure.sentiment.evidence,
      ['广拓与海康都提供周界方案']
    );
  } finally {
    AIResponseAnalysisService.analyze = originalAnalyze;
  }
});

test('marks a project run target failed when platform execution throws', async () => {
  const originalCreateRecord = QuestionRecord.create;
  const originalQueryPlatform = AIPlatformService.queryPlatform;
  const originalCreateDetail = ResultDetail.create;
  const originalFinalize = ProjectRunService.finalizeSuccessfulRecord;
  const updates = [];

  QuestionRecord.create = async () => ({
    id: 21,
    update: async (payload) => updates.push(payload)
  });
  AIPlatformService.queryPlatform = async () => {
    throw new Error('network down');
  };
  ResultDetail.create = async () => {
    throw new Error('should not create detail');
  };
  ProjectRunService.finalizeSuccessfulRecord = async () => {
    throw new Error('should not finalize');
  };

  try {
    const result = await ProjectRunService.runTarget({
      target: {
        prompt: { id: 3, question: '静音轮胎怎么选' },
        platform: 'deepseek'
      },
      runUser: { id: 9 },
      projectData: { id: 2, name: '米其林' },
      competitors: [],
      keywords: ['米其林']
    });

    assert.deepEqual(result, {
      record_id: 21,
      prompt_id: 3,
      platform: 'deepseek',
      status: 'failed',
      error: '监测平台调用失败，请稍后重试'
    });
    assert.equal(updates.length, 1);
    assert.equal(updates[0].status, 'failed');
    assert.equal(updates[0].error_message, '监测平台调用失败，请稍后重试');
  } finally {
    QuestionRecord.create = originalCreateRecord;
    AIPlatformService.queryPlatform = originalQueryPlatform;
    ResultDetail.create = originalCreateDetail;
    ProjectRunService.finalizeSuccessfulRecord = originalFinalize;
  }
});

test('creates run records for every project run target before execution', async () => {
  const originalCreateRecord = QuestionRecord.create;
  const createdPayloads = [];
  QuestionRecord.create = async (payload) => {
    createdPayloads.push(payload);
    return { id: createdPayloads.length, ...payload };
  };

  try {
    const entries = await ProjectRunService.createRunEntries({
      targets: [
        { prompt: { id: 1, question: '问题一' }, platform: 'doubao' },
        { prompt: { id: 2, question: '问题二' }, platform: 'doubao' },
        { prompt: { id: 3, question: '问题三' }, platform: 'doubao' }
      ],
      runUser: { id: 9 },
      projectData: { id: 2, name: 'Goodie AI' },
      keywords: ['Goodie AI'],
      scheduledExecutionId: 77,
      questionSetRunId: 41
    });

    assert.equal(entries.length, 3);
    assert.deepEqual(entries.map((entry) => entry.record.id), [1, 2, 3]);
    assert.deepEqual(createdPayloads.map((payload) => payload.tracked_prompt_id), [1, 2, 3]);
    assert.deepEqual(createdPayloads.map((payload) => payload.status), ['pending', 'pending', 'pending']);
    assert.deepEqual(createdPayloads.map((payload) => payload.scheduled_execution_id), [77, 77, 77]);
    assert.deepEqual(createdPayloads.map((payload) => payload.question_set_run_id), [41, 41, 41]);
    assert.deepEqual(createdPayloads.map((payload) => payload.run_slot_index), [0, 1, 2]);
    assert.deepEqual(createdPayloads.map((payload) => payload.execution_mode), [
      'full_monitoring',
      'full_monitoring',
      'full_monitoring'
    ]);
  } finally {
    QuestionRecord.create = originalCreateRecord;
  }
});

test('同一待处理记录被重复调度时只允许一个执行者调用平台', async () => {
  const originalRunTarget = ProjectRunService.runTarget;
  let callCount = 0;
  let releaseFirst;
  const firstStarted = new Promise((resolve) => {
    ProjectRunService.runTarget = async () => {
      callCount += 1;
      if (callCount > 1) return { status: 'completed' };
      resolve();
      await new Promise((release) => {
        releaseFirst = release;
      });
      return { status: 'completed' };
    };
  });
  const entry = {
    target: {
      prompt: { id: 8, question: '重复调度测试' },
      platform: 'qwen'
    },
    record: { id: 880 }
  };

  try {
    const first = ProjectRunService.runPreparedTargets({
      entries: [entry],
      targets: [entry.target],
      runUser: { id: 9 },
      projectData: { id: 2 },
      competitors: [],
      keywords: [],
      runtimeSettings: {},
      concurrency: 1
    });
    await firstStarted;
    const second = ProjectRunService.runPreparedTargets({
      entries: [entry],
      targets: [entry.target],
      runUser: { id: 9 },
      projectData: { id: 2 },
      competitors: [],
      keywords: [],
      runtimeSettings: {},
      concurrency: 1
    });
    releaseFirst();
    const [, secondResults] = await Promise.all([first, second]);

    assert.equal(callCount, 1);
    assert.equal(secondResults[0].skipped_reason, 'already_running');
  } finally {
    ProjectRunService.runTarget = originalRunTarget;
  }
});

test('数据库执行租约只抢占仍为 pending 且尚未被其他进程领取的记录', async () => {
  const originalUpdate = QuestionRecord.update;
  const calls = [];
  QuestionRecord.update = async (...args) => {
    calls.push(args);
    return [calls.length === 1 ? 1 : 0];
  };

  try {
    const first = await ProjectRunService.claimRecordExecution(881);
    const second = await ProjectRunService.claimRecordExecution(881);

    assert.equal(first.claimed, true);
    assert.equal(second.claimed, false);
    assert.equal(calls[0][1].where.id, 881);
    assert.equal(calls[0][1].where.status, 'pending');
    assert.equal(calls[0][1].where.execution_token, null);
    assert.match(calls[0][0].execution_token, /^[0-9a-f-]{36}$/);
    assert.equal(typeof calls[0][0].lease_owner, 'string');
    assert.ok(calls[0][0].lease_owner.length > 0);
    assert.ok(calls[0][0].lease_expires_at instanceof Date);
    assert.ok(calls[0][0].execution_started_at instanceof Date);
  } finally {
    QuestionRecord.update = originalUpdate;
  }
});

test('runs a prepared project run target without creating a duplicate question record', async () => {
  const originalCreateRecord = QuestionRecord.create;
  const originalQueryPlatform = AIPlatformService.queryPlatform;
  const updates = [];

  QuestionRecord.create = async () => {
    throw new Error('should reuse the prepared record');
  };
  AIPlatformService.queryPlatform = async () => ({
    success: false,
    error: '[doubao] timeout'
  });

  try {
    const result = await ProjectRunService.runTarget({
      target: {
        prompt: { id: 8, question: '开源 GEO 工具有哪些' },
        platform: 'doubao'
      },
      record: {
        id: 88,
        update: async (payload) => updates.push(payload)
      },
      runUser: { id: 9 },
      projectData: { id: 2, name: 'Goodie AI' },
      competitors: [],
      keywords: ['Goodie AI']
    });

    assert.deepEqual(result, {
      record_id: 88,
      prompt_id: 8,
      platform: 'doubao',
      status: 'failed',
      error: '监测平台调用失败，请稍后重试'
    });
    assert.deepEqual(updates[0], {
      status: 'failed',
      error_message: '监测平台调用失败，请稍后重试',
      result_summary: {
        failure: {
          stage: 'monitoring_request',
          error_code: 'provider_error'
        }
      }
    });
  } finally {
    QuestionRecord.create = originalCreateRecord;
    AIPlatformService.queryPlatform = originalQueryPlatform;
  }
});

test('project executor passes bounded owner context and persists Doubao Web text, citations and capture metadata', async () => {
  const originalQueryPlatform = AIPlatformService.queryPlatform;
  const originalFinalize = ProjectRunService.finalizeSuccessfulRecord;
  let queryOptions = null;
  let finalizationInput = null;
  const webCapture = {
    schema_version: 'doubao-web-capture-v1',
    status: 'completed',
    artifact_owner_record_id: 88
  };

  AIPlatformService.queryPlatform = async (_platform, _question, options) => {
    queryOptions = options;
    return {
      success: true,
      platform: 'doubao-web',
      text: '豆包网页最终回答',
      data: {},
      provider_citations: [{
        url: 'https://example.com/source',
        domain: 'example.com',
        source_origin: 'doubao_web_dom',
        source_role: 'explicit_citation'
      }],
      web_capture: webCapture
    };
  };
  ProjectRunService.finalizeSuccessfulRecord = async (input) => {
    finalizationInput = input;
    return {
      ok: true,
      metric: {
        metric_semantics_version: 'contextual_competitor_mentions_sov_v1',
        sentiment: 'neutral',
        answer_competitor_share: 0,
        sov_numerator: 0,
        sov_denominator: 2,
        brand_mentioned: false,
        citation_count: 1,
        brand_rank: null,
        brand_recommended: false
      }
    };
  };

  try {
    const result = await ProjectRunService.runTarget({
      target: {
        prompt: { id: 8, question: '开源 GEO 工具有哪些' },
        platform: 'doubao-web',
        platformConfig: {
          adapter_type: 'doubao_web',
          default_model: 'doubao-web-ui'
        }
      },
      record: { id: 88, update: async () => {} },
      runUser: { id: 9 },
      projectData: { id: 2, name: 'Goodie AI' },
      competitors: [],
      keywords: ['Goodie AI'],
      executionToken: 'lease-token'
    });

    assert.equal(result.status, 'completed');
    assert.deepEqual(result.sov, {
      metric_semantics_version: 'contextual_competitor_mentions_sov_v1',
      kind: 'contextual_competitor_mentions',
      status: 'calculated',
      value: 0,
      numerator: 0,
      denominator: 2
    });
    assert.equal(Object.hasOwn(result, 'share_of_voice'), false);
    assert.equal(queryOptions.purpose, 'project_monitoring');
    assert.deepEqual(queryOptions.capture_owner, {
      record_id: 88,
      user_id: 9,
      project_id: 2,
      execution_token: 'lease-token'
    });
    assert.equal(finalizationInput.responseText, '豆包网页最终回答');
    assert.equal(finalizationInput.providerCitations.length, 1);
    assert.deepEqual(finalizationInput.resultSummaryPatch, { web_capture: webCapture });
  } finally {
    AIPlatformService.queryPlatform = originalQueryPlatform;
    ProjectRunService.finalizeSuccessfulRecord = originalFinalize;
  }
});

test('a stale Web worker discards newly promoted evidence after terminal fencing rejects it', async () => {
  const originalQueryPlatform = AIPlatformService.queryPlatform;
  const originalFinalize = ProjectRunService.finalizeSuccessfulRecord;
  const originalGetService = WebPlatformRegistry.getService;
  const discarded = [];
  const webCapture = {
    status: 'completed',
    artifact_owner_record_id: 88,
    artifacts: {
      final_answer: { id: '00000000-0000-4000-8000-000000000001' }
    }
  };

  AIPlatformService.queryPlatform = async () => ({
    success: true,
    platform: 'deepseek-web',
    text: '迟到回答',
    data: {},
    provider_citations: [],
    web_capture: webCapture
  });
  ProjectRunService.finalizeSuccessfulRecord = async () => ({
    ok: false,
    status: 'stale',
    error: '执行租约已失效',
    error_code: 'stale_worker_write_rejected'
  });
  WebPlatformRegistry.getService = () => ({
    discardRecordCapture: async (...args) => discarded.push(args)
  });

  try {
    const result = await ProjectRunService.runTarget({
      target: {
        prompt: { id: 8, question: '测试迟到 worker' },
        platform: 'deepseek-web',
        platformConfig: { adapter_type: 'deepseek_web' }
      },
      record: { id: 88, update: async () => {} },
      runUser: { id: 9 },
      projectData: { id: 2, name: 'Goodie AI' },
      competitors: [],
      keywords: ['Goodie AI'],
      executionToken: 'expired-token'
    });

    assert.equal(result.status, 'failed');
    assert.deepEqual(discarded, [[88, webCapture]]);
  } finally {
    AIPlatformService.queryPlatform = originalQueryPlatform;
    ProjectRunService.finalizeSuccessfulRecord = originalFinalize;
    WebPlatformRegistry.getService = originalGetService;
  }
});

test('an unexpected finalization failure discards newly promoted Web evidence', async () => {
  const originalQueryPlatform = AIPlatformService.queryPlatform;
  const originalFinalize = ProjectRunService.finalizeSuccessfulRecord;
  const originalGetService = WebPlatformRegistry.getService;
  const discarded = [];
  const updates = [];
  const webCapture = {
    status: 'completed',
    artifact_owner_record_id: 89,
    artifacts: {
      final_answer: { id: '00000000-0000-4000-8000-000000000002' }
    }
  };

  AIPlatformService.queryPlatform = async () => ({
    success: true,
    platform: 'deepseek-web',
    text: '已经生成但未能提交的回答',
    data: {},
    provider_citations: [],
    web_capture: webCapture
  });
  ProjectRunService.finalizeSuccessfulRecord = async () => {
    throw new Error('database connection lost');
  };
  WebPlatformRegistry.getService = () => ({
    discardRecordCapture: async (...args) => discarded.push(args)
  });

  try {
    const result = await ProjectRunService.runTarget({
      target: {
        prompt: { id: 8, question: '测试异常终态' },
        platform: 'deepseek-web',
        platformConfig: { adapter_type: 'deepseek_web' }
      },
      record: { id: 89, update: async (payload) => updates.push(payload) },
      runUser: { id: 9 },
      projectData: { id: 2, name: 'Goodie AI' },
      competitors: [],
      keywords: ['Goodie AI']
    });

    assert.equal(result.status, 'failed');
    assert.deepEqual(discarded, [[89, webCapture]]);
    assert.equal(updates.at(-1).status, 'failed');
  } finally {
    AIPlatformService.queryPlatform = originalQueryPlatform;
    ProjectRunService.finalizeSuccessfulRecord = originalFinalize;
    WebPlatformRegistry.getService = originalGetService;
  }
});

test('Web failure stores only bounded failure metadata and never finalizes a metric', async () => {
  const originalQueryPlatform = AIPlatformService.queryPlatform;
  const originalFinalize = ProjectRunService.finalizeSuccessfulRecord;
  const updates = [];
  let finalizations = 0;

  AIPlatformService.queryPlatform = async () => ({
    success: false,
    platform: 'deepseek-web',
    error_code: 'web_generation_timeout',
    error: 'partial answer must not escape',
    text: '不应保存的部分回答',
    web_capture: {
      status: 'failed',
      failure: {
        stage: 'generation_finished',
        error_code: 'web_generation_timeout'
      }
    }
  });
  ProjectRunService.finalizeSuccessfulRecord = async () => {
    finalizations += 1;
    throw new Error('must not finalize');
  };

  try {
    const result = await ProjectRunService.runTarget({
      target: {
        prompt: { id: 8, question: '测试回答超时' },
        platform: 'deepseek-web',
        platformConfig: { adapter_type: 'deepseek_web' }
      },
      record: { id: 90, update: async (payload) => updates.push(payload) },
      runUser: { id: 9 },
      projectData: { id: 2, name: 'Goodie AI' },
      competitors: [],
      keywords: ['Goodie AI']
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.error, '等待 DeepSeek 网页版最终回答超时');
    assert.equal(finalizations, 0);
    assert.deepEqual(updates.at(-1), {
      status: 'failed',
      error_message: '等待 DeepSeek 网页版最终回答超时',
      result_summary: {
        web_capture: {
          status: 'failed',
          failure: {
            stage: 'generation_finished',
            error_code: 'web_generation_timeout'
          }
        },
        failure: {
          stage: 'generation_finished',
          error_code: 'web_generation_timeout'
        }
      }
    });
  } finally {
    AIPlatformService.queryPlatform = originalQueryPlatform;
    ProjectRunService.finalizeSuccessfulRecord = originalFinalize;
  }
});

test('queues a project run without waiting for prepared targets to finish', async () => {
  const originalGetAvailability = AIPlatformService.getPlatformAvailability;
  const originalGetEnabledPlatforms = AIPlatformService.getEnabledPlatforms;
  const originalGetRuntimeSettings = ProjectRunService.getRuntimeSettings;
  const originalConsumeQuota = ProjectRunService.consumeRunQuota;
  const originalFindCompetitors = BrandCompetitor.findAll;
  const originalCreateEntries = ProjectRunService.createRunEntries;
  const originalSchedule = ProjectRunService.schedulePreparedRun;
  const originalUpdateRun = QuestionSetRun.update;
  let scheduledContext = null;
  let createEntriesOptions = null;
  let runUpdate = null;

  AIPlatformService.getEnabledPlatforms = async () => ['doubao'];
  AIPlatformService.getPlatformAvailability = async () => [{
    code: 'doubao',
    platform_name: '豆包',
    model_name: 'doubao-model',
    available: true,
    reason: null,
    config: { code: 'doubao', default_model: 'doubao-model' }
  }];
  ProjectRunService.getRuntimeSettings = async () => ({ ai_run_concurrency: 2, ai_retry_count: 3, ai_default_timeout_seconds: 90, ai_default_max_tokens: 4096 });
  ProjectRunService.consumeRunQuota = async () => ({ ok: true, used: 2, limit: 100 });
  BrandCompetitor.findAll = async () => [];
  ProjectRunService.createRunEntries = async (options) => {
    createEntriesOptions = options;
    return options.targets.map((target, index) => ({
      target,
      record: { id: index + 10 }
    }));
  };
  QuestionSetRun.update = async (payload, options) => {
    runUpdate = { payload, options };
    return [1];
  };
  ProjectRunService.schedulePreparedRun = (context) => {
    scheduledContext = context;
  };

  try {
    const result = await ProjectRunService.enqueueProjectRun({
      project: { id: 2, user_id: 9, status: 'active', name: 'Goodie AI', platforms: ['doubao'] },
      prompts: [
        { id: 3, question: '开源 GEO 工具有哪些', enabled: true, platforms: ['doubao'] },
        { id: 4, question: 'GEO 监测怎么做', enabled: true, platforms: ['doubao'] }
      ],
      platforms: ['doubao'],
      user: { id: 9, role: 'user' },
      questionSetRunId: 41
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 202);
    assert.equal(result.data.status, 'queued');
    assert.equal(result.data.total, 2);
    assert.equal(result.data.pending, 2);
    assert.deepEqual(result.data.record_ids, [10, 11]);
    assert.equal(scheduledContext.entries.length, 2);
    assert.equal(createEntriesOptions.questionSetRunId, 41);
    assert.equal(scheduledContext.questionSetRunId, 41);
    assert.deepEqual(runUpdate, {
      payload: {
        planned_record_count: 2,
        imported_rows: [],
        completed_at: null,
        integrity_status: 'complete',
        integrity_missing_record_count: 0,
        integrity_error_code: null
      },
      options: {
        where: {
          id: 41,
          project_id: 2
        }
      }
    });
  } finally {
    AIPlatformService.getPlatformAvailability = originalGetAvailability;
    AIPlatformService.getEnabledPlatforms = originalGetEnabledPlatforms;
    ProjectRunService.getRuntimeSettings = originalGetRuntimeSettings;
    ProjectRunService.consumeRunQuota = originalConsumeQuota;
    BrandCompetitor.findAll = originalFindCompetitors;
    ProjectRunService.createRunEntries = originalCreateEntries;
    ProjectRunService.schedulePreparedRun = originalSchedule;
    QuestionSetRun.update = originalUpdateRun;
  }
});

test('queues runnable platforms and reports unavailable platforms as skipped', async () => {
  const originalGetAvailability = AIPlatformService.getPlatformAvailability;
  const originalGetRuntimeSettings = ProjectRunService.getRuntimeSettings;
  const originalConsumeQuota = ProjectRunService.consumeRunQuota;
  const originalFindCompetitors = BrandCompetitor.findAll;
  const originalCreateEntries = ProjectRunService.createRunEntries;
  const originalSchedule = ProjectRunService.schedulePreparedRun;
  let quotaAmount = 0;

  AIPlatformService.getPlatformAvailability = async () => [
    { code: 'doubao', platform_name: '豆包', model_name: 'doubao-model', available: false, reason: 'missing_api_key', config: null },
    { code: 'deepseek', platform_name: 'DeepSeek', model_name: 'deepseek-v4-flash', available: true, reason: null, config: { code: 'deepseek', default_model: 'deepseek-v4-flash' } }
  ];
  ProjectRunService.getRuntimeSettings = async () => ({ ai_run_concurrency: 2 });
  ProjectRunService.consumeRunQuota = async (_userId, amount) => {
    quotaAmount = amount;
    return { ok: true };
  };
  BrandCompetitor.findAll = async () => [];
  ProjectRunService.createRunEntries = async ({ targets }) => targets.map((target) => ({ target, record: { id: 31 } }));
  ProjectRunService.schedulePreparedRun = () => {};

  try {
    const result = await ProjectRunService.enqueueProjectRun({
      project: { id: 2, user_id: 9, status: 'active', name: 'Goodie AI', platforms: ['doubao', 'deepseek'] },
      prompts: [{ id: 3, question: 'GEO 怎么做', enabled: true, platforms: ['doubao', 'deepseek'] }],
      platforms: ['doubao', 'deepseek'],
      user: { id: 9, role: 'user' }
    });

    assert.equal(result.ok, true);
    assert.equal(result.data.total, 1);
    assert.equal(quotaAmount, 1);
    assert.deepEqual(result.data.skipped_platforms, [{
      platform: 'doubao',
      name: '豆包',
      reason_code: 'PLATFORM_UNAVAILABLE',
      reason: 'missing_api_key',
      message: '豆包未配置 API Key'
    }]);
    assert.match(result.message, /豆包未配置 API Key，已跳过/);
  } finally {
    AIPlatformService.getPlatformAvailability = originalGetAvailability;
    ProjectRunService.getRuntimeSettings = originalGetRuntimeSettings;
    ProjectRunService.consumeRunQuota = originalConsumeQuota;
    BrandCompetitor.findAll = originalFindCompetitors;
    ProjectRunService.createRunEntries = originalCreateEntries;
    ProjectRunService.schedulePreparedRun = originalSchedule;
  }
});

test('does not consume quota or create records when every candidate platform is unavailable', async () => {
  const originalGetAvailability = AIPlatformService.getPlatformAvailability;
  const originalConsumeQuota = ProjectRunService.consumeRunQuota;
  const originalCreateEntries = ProjectRunService.createRunEntries;
  let quotaCalled = false;
  let recordsCalled = false;

  AIPlatformService.getPlatformAvailability = async () => [{
    code: 'deepseek',
    platform_name: 'DeepSeek',
    model_name: 'deepseek-v4-flash',
    available: false,
    reason: 'missing_api_key',
    config: null
  }];
  ProjectRunService.consumeRunQuota = async () => {
    quotaCalled = true;
    return { ok: true };
  };
  ProjectRunService.createRunEntries = async () => {
    recordsCalled = true;
    return [];
  };

  try {
    const result = await ProjectRunService.enqueueProjectRun({
      project: { id: 2, user_id: 9, status: 'active', platforms: ['deepseek'] },
      prompts: [{ id: 3, question: 'GEO 怎么做', enabled: true, platforms: ['deepseek'] }],
      platforms: ['deepseek'],
      user: { id: 9, role: 'user' }
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(result.data.error_code, 'all_platforms_unavailable');
    assert.match(result.message, /DeepSeek未配置 API Key/);
    assert.equal(quotaCalled, false);
    assert.equal(recordsCalled, false);
  } finally {
    AIPlatformService.getPlatformAvailability = originalGetAvailability;
    ProjectRunService.consumeRunQuota = originalConsumeQuota;
    ProjectRunService.createRunEntries = originalCreateEntries;
  }
});

test('skips an unavailable Web platform while other globally enabled platforms still run', async () => {
  const originalGetEnabledPlatforms = AIPlatformService.getEnabledPlatforms;
  const originalGetAvailability = AIPlatformService.getPlatformAvailability;
  const originalConsumeQuota = ProjectRunService.consumeRunQuota;
  const originalCreateEntries = ProjectRunService.createRunEntries;
  const originalSchedule = ProjectRunService.schedulePreparedRun;
  let quotaAmount = 0;
  let quotaCalled = false;
  let recordsCalled = false;
  let availabilityOptions;

  AIPlatformService.getEnabledPlatforms = async () => ['deepseek-web', 'qwen'];
  AIPlatformService.getPlatformAvailability = async (_codes, options) => {
    availabilityOptions = options;
    return [
    {
      code: 'deepseek-web',
      platform_name: 'DeepSeek 网页版',
      model_name: 'deepseek-web-ui',
      available: false,
      reason: 'web_login_required',
      config: null
    },
    {
      code: 'qwen',
      platform_name: '千问',
      model_name: 'qwen-model',
      available: true,
      reason: null,
      config: { code: 'qwen', default_model: 'qwen-model' }
    }
    ];
  };
  ProjectRunService.consumeRunQuota = async (_userId, amount) => {
    quotaCalled = true;
    quotaAmount = amount;
    return { ok: true };
  };
  ProjectRunService.createRunEntries = async ({ targets }) => {
    recordsCalled = true;
    return targets.map((target) => ({ target, record: { id: 41 } }));
  };
  ProjectRunService.schedulePreparedRun = () => {};

  try {
    const result = await ProjectRunService.enqueueProjectRun({
      project: { id: 2, user_id: 9, status: 'active', platforms: ['deepseek-web', 'qwen'] },
      prompts: [{
        id: 3,
        question: 'GEO 怎么做',
        enabled: true,
        platforms: ['deepseek-web', 'qwen']
      }],
      platforms: ['deepseek-web', 'qwen'],
      user: { id: 9, role: 'user' }
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 202);
    assert.equal(result.data.total, 1);
    assert.equal(result.data.results[0].platform, 'qwen');
    assert.deepEqual(result.data.skipped_platforms, [{
      platform: 'deepseek-web',
      name: 'DeepSeek 网页版',
      reason_code: 'PLATFORM_UNAVAILABLE',
      reason: 'web_login_required',
      message: 'DeepSeek 网页版需要重新人工登录'
    }]);
    assert.match(result.message, /需要重新人工登录，已跳过/);
    assert.deepEqual(availabilityOptions, { forceRuntimeProbe: true });
    assert.equal(quotaCalled, true);
    assert.equal(quotaAmount, 1);
    assert.equal(recordsCalled, true);
  } finally {
    AIPlatformService.getEnabledPlatforms = originalGetEnabledPlatforms;
    AIPlatformService.getPlatformAvailability = originalGetAvailability;
    ProjectRunService.consumeRunQuota = originalConsumeQuota;
    ProjectRunService.createRunEntries = originalCreateEntries;
    ProjectRunService.schedulePreparedRun = originalSchedule;
  }
});

test('marks a project run target failed with a safe message when platform returns failure', async () => {
  const originalCreateRecord = QuestionRecord.create;
  const originalQueryPlatform = AIPlatformService.queryPlatform;
  const updates = [];

  QuestionRecord.create = async () => ({
    id: 22,
    update: async (payload) => updates.push(payload)
  });
  AIPlatformService.queryPlatform = async () => ({
    success: false,
    error: '[deepseek] 401 invalid api key'
  });

  try {
    const result = await ProjectRunService.runTarget({
      target: {
        prompt: { id: 4, question: '静音轮胎怎么选' },
        platform: 'deepseek'
      },
      runUser: { id: 9 },
      projectData: { id: 2, name: '米其林' },
      competitors: [],
      keywords: ['米其林']
    });

    assert.deepEqual(result, {
      record_id: 22,
      prompt_id: 4,
      platform: 'deepseek',
      status: 'failed',
      error: '监测平台调用失败，请稍后重试'
    });
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0], {
      status: 'failed',
      error_message: '监测平台调用失败，请稍后重试',
      result_summary: {
        failure: {
          stage: 'monitoring_request',
          error_code: 'provider_error'
        }
      }
    });
  } finally {
    QuestionRecord.create = originalCreateRecord;
    AIPlatformService.queryPlatform = originalQueryPlatform;
  }
});

test('persists a monitoring-stage failure code so retry can choose the correct path', async () => {
  const originalCreateRecord = QuestionRecord.create;
  const originalQueryPlatform = AIPlatformService.queryPlatform;
  const updates = [];

  QuestionRecord.create = async () => ({
    id: 23,
    result_summary: {},
    update: async (payload) => updates.push(payload)
  });
  AIPlatformService.queryPlatform = async () => ({
    success: false,
    error_code: 'provider_quota_exhausted',
    error: '平台账户额度不足，请补充额度后重试。'
  });

  try {
    const result = await ProjectRunService.runTarget({
      target: {
        prompt: { id: 4, question: '静音轮胎怎么选' },
        platform: 'qwen'
      },
      runUser: { id: 9 },
      projectData: { id: 2, name: '米其林' },
      competitors: [],
      keywords: ['米其林']
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.error, '平台账户额度不足，请补充额度后重试。');
    assert.deepEqual(updates[0], {
      status: 'failed',
      error_message: '平台账户额度不足，请补充额度后重试。',
      result_summary: {
        failure: {
          stage: 'monitoring_request',
          error_code: 'provider_quota_exhausted'
        }
      }
    });
  } finally {
    QuestionRecord.create = originalCreateRecord;
    AIPlatformService.queryPlatform = originalQueryPlatform;
  }
});

test('summarizes project run results by completed and failed counts', () => {
  assert.deepEqual(ProjectRunService.summarizeRunResults([
    { status: 'completed' },
    { status: 'failed' }
  ], 2), {
    total: 2,
    completed: 1,
    failed: 1,
    message: '项目单次分析已完成，部分平台失败'
  });

  assert.deepEqual(ProjectRunService.summarizeRunResults([
    { status: 'failed' },
    { status: 'failed' }
  ], 2), {
    total: 2,
    completed: 0,
    failed: 2,
    message: '项目单次分析全部失败，请检查监测平台配置、账号额度或网络连接'
  });
});

test('project run response is not ok when every target fails', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../services/ProjectRunService.js'), 'utf8');

  assert.match(source, /const ok = summary\.completed > 0/);
  assert.match(source, /status: ok \? 200 : 502/);
  assert.match(source, /ok,/);
});

test('marks a project run target failed when AI returns an empty response body', async () => {
  const originalCreateRecord = QuestionRecord.create;
  const originalQueryPlatform = AIPlatformService.queryPlatform;
  const originalCreateDetail = ResultDetail.create;
  const originalFinalize = ProjectRunService.finalizeSuccessfulRecord;
  const updates = [];

  QuestionRecord.create = async () => ({
    id: 31,
    update: async (payload) => updates.push(payload)
  });
  AIPlatformService.queryPlatform = async () => ({
    success: true,
    data: { choices: [{ message: { content: '' } }] }
  });
  ResultDetail.create = async () => {
    throw new Error('should not create detail for empty response');
  };
  ProjectRunService.finalizeSuccessfulRecord = async () => {
    throw new Error('should not finalize empty response');
  };

  try {
    const result = await ProjectRunService.runTarget({
      target: {
        prompt: { id: 5, question: '静音轮胎怎么选' },
        platform: 'deepseek'
      },
      runUser: { id: 9 },
      projectData: { id: 2, name: '米其林' },
      competitors: [],
      keywords: ['米其林']
    });

    assert.deepEqual(result, {
      record_id: 31,
      prompt_id: 5,
      platform: 'deepseek',
      status: 'failed',
      error: '监测平台返回内容为空'
    });
    assert.equal(updates.length, 1);
    assert.equal(updates[0].status, 'failed');
    assert.equal(updates[0].error_message, '监测平台返回内容为空');
  } finally {
    QuestionRecord.create = originalCreateRecord;
    AIPlatformService.queryPlatform = originalQueryPlatform;
    ResultDetail.create = originalCreateDetail;
    ProjectRunService.finalizeSuccessfulRecord = originalFinalize;
  }
});

test('does not fail a completed project run when alert evaluation fails', async () => {
  const originalEvaluate = AlertEvaluationService.evaluateProject;
  const warnings = [];
  const originalWarn = console.warn;
  AlertEvaluationService.evaluateProject = async () => {
    throw new Error('alert database down');
  };
  console.warn = (...args) => warnings.push(args.join(' '));

  try {
    const result = await ProjectRunService.evaluateAlertsAfterRun(
      { id: 2 },
      { id: 9 }
    );

    assert.deepEqual(result, { ok: false, error: 'alert database down' });
    assert.equal(warnings.some((line) => line.includes('项目运行告警评估失败')), true);
  } finally {
    AlertEvaluationService.evaluateProject = originalEvaluate;
    console.warn = originalWarn;
  }
});
