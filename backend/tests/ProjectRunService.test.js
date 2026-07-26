const test = require('node:test');
const assert = require('node:assert/strict');

const { QuestionRecord, ResultDetail, BrandCompetitor } = require('../models');
const AIPlatformService = require('../services/AIPlatformService');
const ProjectRunService = require('../services/ProjectRunService');
const { AIResponseAnalysisError } = require('../services/AIResponseAnalysisService');
const AIResponseAnalysisService = require('../services/AIResponseAnalysisService');
const AlertEvaluationService = require('../services/AlertEvaluationService');

test('builds project run targets from enabled prompts and project platforms', () => {
  const targets = ProjectRunService.buildPromptTargets([
    { id: 1, question: '问题一', enabled: true, platforms: ['doubao', 'deepseek', 'kimi'] },
    { id: 2, question: '问题二', enabled: false, platforms: ['doubao'] },
    { id: 3, question: '问题三', enabled: true, platforms: [] }
  ], ['doubao', 'deepseek'], ['deepseek']);

  assert.deepEqual(targets, [
    { prompt: { id: 1, question: '问题一', enabled: true, platforms: ['doubao', 'deepseek', 'kimi'] }, platform: 'deepseek' },
    { prompt: { id: 3, question: '问题三', enabled: true, platforms: [] }, platform: 'deepseek' }
  ]);
});

test('intersects prompt platforms with project platforms when building run targets', () => {
  const targets = ProjectRunService.buildPromptTargets([
    { id: 1, question: '只跑豆包', enabled: true, platforms: ['doubao'] },
    { id: 2, question: '只跑 DeepSeek', enabled: true, platforms: ['deepseek'] },
    { id: 3, question: '继承项目平台', enabled: true, platforms: [] }
  ], ['doubao', 'deepseek'], ['doubao', 'deepseek']);

  assert.deepEqual(targets, [
    { prompt: { id: 1, question: '只跑豆包', enabled: true, platforms: ['doubao'] }, platform: 'doubao' },
    { prompt: { id: 2, question: '只跑 DeepSeek', enabled: true, platforms: ['deepseek'] }, platform: 'deepseek' },
    { prompt: { id: 3, question: '继承项目平台', enabled: true, platforms: [] }, platform: 'doubao' },
    { prompt: { id: 3, question: '继承项目平台', enabled: true, platforms: [] }, platform: 'deepseek' }
  ]);
});

test('rejects prompt targets outside the selected project platforms', () => {
  const targets = ProjectRunService.buildPromptTargets([
    { id: 1, question: '只跑豆包', enabled: true, platforms: ['doubao'] }
  ], ['doubao', 'deepseek'], ['deepseek']);

  assert.deepEqual(targets, []);
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

test('normalizes explicit run prompt ids without falling back to all prompts', () => {
  assert.deepEqual(ProjectRunService.normalizeRunPromptIds(undefined), {
    explicit: false,
    ids: []
  });

  assert.deepEqual(ProjectRunService.normalizeRunPromptIds(['3', 'bad', 3, 0]), {
    explicit: true,
    ids: [3]
  });

  assert.deepEqual(ProjectRunService.normalizeRunPromptIds('bad'), {
    explicit: true,
    ids: []
  });
});

test('reports selected prompt availability separately from api key availability', async () => {
  const result = await ProjectRunService.runProject({
    project: { id: 1, user_id: 1, status: 'active', platforms: ['deepseek'] },
    prompts: [],
    platforms: ['deepseek'],
    user: { id: 1, role: 'user' },
    promptSelectionExplicit: true
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.message, '问题集中没有启用的问题。');
  assert.equal(result.data.error_code, 'no_enabled_questions');
});

test('reports prompt and project platform mismatch separately from api key availability', async () => {
  const result = await ProjectRunService.runProject({
    project: { id: 1, user_id: 1, status: 'active', platforms: ['deepseek'] },
    prompts: [{ id: 2, question: '只跑豆包', enabled: true, platforms: ['doubao'] }],
    platforms: ['deepseek'],
    user: { id: 1, role: 'user' }
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.message, '问题选择的平台不在当前项目的监测范围内。');
  assert.equal(result.data.error_code, 'platform_scope_mismatch');
});

test('rejects explicit project runs when any selected prompt has no project platform overlap', async () => {
  const result = await ProjectRunService.runProject({
    project: { id: 1, user_id: 1, status: 'active', platforms: ['deepseek'] },
    prompts: [
      { id: 2, question: 'DeepSeek 可运行', enabled: true, platforms: ['deepseek'] },
      { id: 3, question: '只跑豆包', enabled: true, platforms: ['doubao'] }
    ],
    platforms: ['deepseek'],
    user: { id: 1, role: 'user' },
    promptSelectionExplicit: true
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.message, '问题选择的平台不在当前项目的监测范围内。');
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
  const updates = [];
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
      keywords: ['广拓']
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'AI 结构化分析失败，本条未计入有效样本');
    assert.deepEqual(updates[0], {
      status: 'failed',
      error_message: 'AI 结构化分析失败，本条未计入有效样本',
      result_summary: {
        retry: {
          previous_record_id: 9,
          attempt: 2
        },
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
  } finally {
    ProjectRunService.buildVisibilityMetricPayload = originalBuildPayload;
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
      scheduledExecutionId: 77
    });

    assert.equal(entries.length, 3);
    assert.deepEqual(entries.map((entry) => entry.record.id), [1, 2, 3]);
    assert.deepEqual(createdPayloads.map((payload) => payload.tracked_prompt_id), [1, 2, 3]);
    assert.deepEqual(createdPayloads.map((payload) => payload.status), ['pending', 'pending', 'pending']);
    assert.deepEqual(createdPayloads.map((payload) => payload.scheduled_execution_id), [77, 77, 77]);
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

test('queues a project run without waiting for prepared targets to finish', async () => {
  const originalGetAvailability = AIPlatformService.getPlatformAvailability;
  const originalGetRuntimeSettings = ProjectRunService.getRuntimeSettings;
  const originalConsumeQuota = ProjectRunService.consumeRunQuota;
  const originalFindCompetitors = BrandCompetitor.findAll;
  const originalCreateEntries = ProjectRunService.createRunEntries;
  const originalSchedule = ProjectRunService.schedulePreparedRun;
  let scheduledContext = null;

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
  ProjectRunService.createRunEntries = async ({ targets }) => targets.map((target, index) => ({
    target,
    record: { id: index + 10 }
  }));
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
      user: { id: 9, role: 'user' }
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 202);
    assert.equal(result.data.status, 'queued');
    assert.equal(result.data.total, 2);
    assert.equal(result.data.pending, 2);
    assert.deepEqual(result.data.record_ids, [10, 11]);
    assert.equal(scheduledContext.entries.length, 2);
  } finally {
    AIPlatformService.getPlatformAvailability = originalGetAvailability;
    ProjectRunService.getRuntimeSettings = originalGetRuntimeSettings;
    ProjectRunService.consumeRunQuota = originalConsumeQuota;
    BrandCompetitor.findAll = originalFindCompetitors;
    ProjectRunService.createRunEntries = originalCreateEntries;
    ProjectRunService.schedulePreparedRun = originalSchedule;
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
    const result = await ProjectRunService.runProject({
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
