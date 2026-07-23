const {
  sequelize,
  BrandProject,
  TrackedPrompt,
  QuestionRecord,
  QuestionSetRun,
  ResultDetail,
  BrandCompetitor,
  VisibilityMetric,
  QuestionSetRetryBatch
} = require('../models');
const { randomUUID } = require('node:crypto');
const AIPlatformService = require('./AIPlatformService');
const ResultParserService = require('./ResultParserService');
const VisibilityAnalysisService = require('./VisibilityAnalysisService');
const AIResponseAnalysisService = require('./AIResponseAnalysisService');
const { AIResponseAnalysisError } = require('./AIResponseAnalysisService');
const { AIAnalysisConfigError } = require('./AIAnalysisConfigService');
const CitationAnalysisService = require('./CitationAnalysisService');
const { SEMANTICS_VERSION: CITATION_SEMANTICS_VERSION } = require('./CitationMetricSemanticsService');
const AlertEvaluationService = require('./AlertEvaluationService');
const PromptCategoryService = require('./PromptCategoryService');
const AIRuntimeSettingsService = require('./AIRuntimeSettingsService');
const { ERROR_MESSAGES: AI_PLATFORM_ERROR_MESSAGES } = require('./AIPlatformRequestService');
const { consumeQuotaDirect } = require('../middleware/quota');

const SAFE_PLATFORM_FAILURE_MESSAGE = '监测平台调用失败，请稍后重试';
const RETRY_SCHEDULE_FAILURE_MESSAGE = '失败项重试调度失败，请重新提交';
const PLATFORM_MISMATCH_MESSAGE = '问题选择的平台不在当前项目的监测范围内。';

function runtimePlatformFailureMessage(result) {
  return AI_PLATFORM_ERROR_MESSAGES[result?.error_code] || SAFE_PLATFORM_FAILURE_MESSAGE;
}

function metricFailureMessage(error) {
  if (error instanceof AIAnalysisConfigError && error.code === 'analysis_api_not_configured') {
    return 'AI 分析 API 未配置，本条未计入有效样本';
  }
  if (error instanceof AIAnalysisConfigError || error instanceof AIResponseAnalysisError) {
    return 'AI 结构化分析失败，本条未计入有效样本';
  }
  return '指标生成失败，请稍后重试';
}

function metricFailureDiagnostics(error) {
  if (!(error instanceof AIAnalysisConfigError) && !(error instanceof AIResponseAnalysisError)) {
    return null;
  }
  const details = error?.details && typeof error.details === 'object' ? error.details : {};
  const diagnostics = {
    status: 'failed',
    error_code: String(error?.code || 'analysis_failed').slice(0, 80),
    error_detail: String(error?.message || 'AI 分析失败').slice(0, 300)
  };
  ['stage', 'platform', 'model', 'finish_reason'].forEach((field) => {
    if (details[field] !== undefined && details[field] !== null) {
      diagnostics[field] = String(details[field]).slice(0, 120);
    }
  });
  ['attempt_count', 'output_length'].forEach((field) => {
    const value = Number(details[field]);
    if (Number.isFinite(value) && value >= 0) diagnostics[field] = value;
  });
  const usage = {};
  ['prompt_tokens', 'completion_tokens', 'total_tokens'].forEach((field) => {
    const value = Number(details?.usage?.[field]);
    if (Number.isFinite(value) && value >= 0) usage[field] = value;
  });
  if (Object.keys(usage).length) diagnostics.usage = usage;
  return diagnostics;
}

function normalizePlatformCodes(value) {
  return Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean)
  ));
}

function skippedPlatformMessage(item) {
  const name = item?.platform_name || item?.name || item?.code || '监测平台';
  const messages = {
    missing_api_key: `${name}未配置 API Key`,
    disabled: `${name}已被管理员停用`,
    missing_base_url: `${name}未配置接口地址`,
    missing_model: `${name}未配置默认模型`,
    archived: `${name}已归档`,
    config_unavailable: `${name}配置暂不可用`
  };
  return messages[item?.reason] || `${name}暂不可用`;
}

function countKeywordOccurrences(text, keywords) {
  const list = Array.isArray(keywords) ? keywords.filter(Boolean) : [];
  const ranges = list.flatMap((kw) => {
    const keyword = String(kw);
    return VisibilityAnalysisService.termVariants(keyword)
      .flatMap((variant) => VisibilityAnalysisService.termMatches(text, variant))
      .map((range) => ({ ...range, keyword }));
  });
  const selected = [];
  ranges
    .sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))
    .forEach((range) => {
      if (!selected.some((item) => VisibilityAnalysisService.overlaps(item, range))) selected.push(range);
    });
  const counts = new Map();
  selected.forEach((range) => {
    counts.set(range.keyword, (counts.get(range.keyword) || 0) + 1);
  });
  return Array.from(counts.entries()).map(([keyword, count]) => ({ keyword, count }));
}

function runError(message, status, data) {
  const error = Object.assign(new Error(message), { status });
  if (data) error.data = data;
  return error;
}

function normalizeIdempotencyKey(value) {
  const text = String(value || '').trim();
  if (!text) return randomUUID();
  if (text.length < 8 || text.length > 128 || !/^[A-Za-z0-9._:-]+$/u.test(text)) {
    throw runError('幂等键格式无效', 400, { error_code: 'invalid_idempotency_key' });
  }
  return text;
}

function retryReplayResult(batch) {
  const stored = batch?.response && typeof batch.response === 'object' ? batch.response : null;
  if (!stored) throw runError('相同重试请求正在处理中', 409, {
    error_code: 'retry_request_in_progress'
  });
  return {
    ok: true,
    status: 202,
    message: stored.message,
    data: {
      ...stored.data,
      retry_batch_id: batch.id,
      idempotent_replay: true
    }
  };
}

function retrySummaryMetadata(record) {
  const retry = record?.result_summary?.retry;
  const previousRecordId = Number(retry?.previous_record_id);
  const attempt = Number(retry?.attempt);
  if (!Number.isInteger(previousRecordId) || previousRecordId <= 0
    || !Number.isInteger(attempt) || attempt <= 0) {
    return {};
  }
  return {
    retry: {
      previous_record_id: previousRecordId,
      attempt,
      ...(record?.result_summary?.retry?.kind
        ? { kind: String(record.result_summary.retry.kind).slice(0, 40) }
        : {})
    }
  };
}

function retryFailureStage(record) {
  const explicitStage = String(record?.result_summary?.failure?.stage || '').trim();
  if (explicitStage) return explicitStage;
  if (record?.result_summary?.analysis?.status === 'failed') return 'analysis_validation';
  return 'monitoring_request';
}

function isAnalysisOnlyRetry(record, detail) {
  const responseText = String(detail?.ai_response_original || '').trim();
  return responseText.length > 0
    && (
      record?.result_summary?.retry?.kind === 'analysis_only'
      || [
        'analysis_request',
        'analysis_validation',
        'metric_persist',
        'execution_interrupted'
      ].includes(retryFailureStage(record))
    );
}

function normalizeProviderCitations(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .slice(0, 200)
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const citation = {
        ...(item.url ? { url: String(item.url).slice(0, 2048) } : {}),
        ...(item.domain ? { domain: String(item.domain).slice(0, 253) } : {}),
        ...(item.title ? { title: String(item.title).slice(0, 500) } : {}),
        ...(item.source_origin ? { source_origin: String(item.source_origin).slice(0, 40) } : {}),
        ...(item.source_role ? { source_role: String(item.source_role).slice(0, 40) } : {})
      };
      if (!citation.url && !citation.domain) return null;
      const key = `${citation.source_role || ''}|${citation.url || ''}|${citation.domain || ''}|${citation.title || ''}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return citation;
    })
    .filter(Boolean);
}

class ProjectRunService {
  constructor() {
    this.activeRecordIds = new Set();
  }

  isRunnableProject(project) {
    if (!project) return false;
    return (project.status || 'active') === 'active';
  }

  buildBrandKeywordList(project) {
    return VisibilityAnalysisService.buildBrandVisibilityTerms(project);
  }

  resolveRunUser(project, user) {
    const projectOwnerId = Number(project?.user_id || 0);
    const userId = Number(user?.id || 0);
    if (projectOwnerId > 0 && user?.role === 'admin' && userId !== projectOwnerId) {
      return { ...user, id: projectOwnerId, actor_user_id: userId || null };
    }
    return user;
  }

  normalizeRunPromptIds(value) {
    const explicit = value !== undefined && value !== null;
    if (!explicit) return { explicit: false, ids: [] };
    const raw = Array.isArray(value)
      ? value
      : (typeof value === 'string' ? value.split(/[,，;；\n]/) : [value]);
    const ids = raw
      .map((item) => Number(String(item || '').trim()))
      .filter((item) => Number.isInteger(item) && item > 0);
    return {
      explicit: true,
      ids: Array.from(new Set(ids))
    };
  }

  buildPromptTargets(prompts, availablePlatforms = [], projectPlatforms = []) {
    const available = new Set(normalizePlatformCodes(availablePlatforms));
    const projectPlatformList = normalizePlatformCodes(projectPlatforms);

    const rows = Array.isArray(prompts) ? prompts : [];
    return rows
      .filter((prompt) => prompt && prompt.enabled !== false)
      .flatMap((prompt) => {
        const promptPlatformList = Array.isArray(prompt.platforms) && prompt.platforms.length
          ? prompt.platforms
          : projectPlatformList;
        const promptPlatforms = new Set(normalizePlatformCodes(promptPlatformList));
        return Array.from(new Set(projectPlatformList
          .filter((item) => available.has(item) && promptPlatforms.has(item))))
          .map((platform) => ({ prompt, platform }));
      });
  }

  hasPromptProjectPlatformOverlap(prompts, projectPlatforms = []) {
    const projectPlatformList = normalizePlatformCodes(projectPlatforms);
    const projectPlatformSet = new Set(projectPlatformList);
    return (Array.isArray(prompts) ? prompts : [])
      .filter((prompt) => prompt && prompt.enabled !== false)
      .some((prompt) => {
        const promptPlatformList = Array.isArray(prompt.platforms) && prompt.platforms.length
          ? prompt.platforms
          : projectPlatformList;
        return normalizePlatformCodes(promptPlatformList).some((item) => projectPlatformSet.has(item));
      });
  }

  hasEveryPromptProjectPlatformOverlap(prompts, projectPlatforms = []) {
    const enabledPrompts = (Array.isArray(prompts) ? prompts : [])
      .filter((prompt) => prompt && prompt.enabled !== false);
    if (!enabledPrompts.length) return false;
    return enabledPrompts.every((prompt) => this.hasPromptProjectPlatformOverlap([prompt], projectPlatforms));
  }

  derivePromptCategory(prompt) {
    return PromptCategoryService.derive(prompt);
  }

  snapshotProviderCitations(aiResponse) {
    return normalizeProviderCitations(CitationAnalysisService.collectMetadataSources(aiResponse));
  }

  async buildVisibilityMetricPayload({
    record,
    responseText,
    aiResponse,
    providerCitations,
    project,
    competitors,
    prompt
  }) {
    const projectData = project.toJSON ? project.toJSON() : project;
    const competitorData = Array.isArray(competitors)
      ? competitors.map((item) => (item.toJSON ? item.toJSON() : item))
      : [];
    const analysis = await AIResponseAnalysisService.analyze({
      responseText,
      brand: projectData,
      competitors: competitorData
    });
    const citationAnalysis = CitationAnalysisService.extractSources({
      responseText,
      aiResponse: Array.isArray(providerCitations) ? providerCitations : aiResponse,
      brand: projectData,
      competitors: competitorData
    });
    const analysisStructure = analysis.analysis_structure
      && typeof analysis.analysis_structure === 'object'
      && !Array.isArray(analysis.analysis_structure)
      ? {
        ...analysis.analysis_structure,
        citations: {
          semantics_version: CITATION_SEMANTICS_VERSION,
          count: citationAnalysis.citation_count,
          official_count: citationAnalysis.owned_citation_count,
          competitor_count: citationAnalysis.competitor_citation_count,
          official_website_cited: citationAnalysis.owned_citation_count > 0,
          sources: citationAnalysis.sources,
          source_groups: citationAnalysis.source_groups
        }
      }
      : {};
    return {
      project_id: projectData.id,
      prompt_id: record.tracked_prompt_id || null,
      user_id: record.user_id,
      platform: record.platform,
      brand_mentioned: analysis.brand_mentioned,
      brand_mentions: analysis.brand_mentions,
      brand_position: analysis.brand_position,
      brand_rank: analysis.brand_rank,
      brand_recommended: analysis.brand_recommended,
      visibility_score: analysis.visibility_score,
      competitor_mentions: analysis.competitor_mentions,
      share_of_voice: analysis.share_of_voice,
      citation_count: citationAnalysis.citation_count,
      owned_citation_count: citationAnalysis.owned_citation_count,
      competitor_citation_count: citationAnalysis.competitor_citation_count,
      citation_sources: citationAnalysis.sources,
      prompt_category: this.derivePromptCategory(prompt),
      sentiment: analysis.sentiment,
      sentiment_reason: analysis.sentiment_reason || null,
      sentiment_risk_terms: Array.isArray(analysis.sentiment_risk_terms) ? analysis.sentiment_risk_terms : [],
      analysis_method: analysis.analysis_method,
      analysis_platform: analysis.analysis_platform,
      analysis_model: analysis.analysis_model,
      analysis_structure: analysisStructure,
      analysis_evidence: {}
    };
  }

  runInTransaction(work) {
    return sequelize.transaction(work);
  }

  async persistVisibilityMetric({ record, payload, transaction }) {
    const existing = await VisibilityMetric.findOne({
      where: { question_record_id: record.id },
      transaction
    });
    if (existing) return existing.update(payload, { transaction });
    return VisibilityMetric.create(
      { ...payload, question_record_id: record.id },
      { transaction }
    );
  }

  async finalizeSuccessfulRecord({
    record,
    responseText,
    aiResponse,
    providerCitations,
    project,
    competitors,
    prompt,
    keywords
  }) {
    const keywordCounts = countKeywordOccurrences(responseText, keywords, true);
    try {
      const payload = await this.buildVisibilityMetricPayload({
        record,
        responseText,
        aiResponse,
        providerCitations,
        project,
        competitors,
        prompt
      });
      const metric = await this.runInTransaction(async (transaction) => {
        const savedMetric = await this.persistVisibilityMetric({ record, payload, transaction });
        await record.update(
          {
            status: 'completed',
            result_summary: {
              ...retrySummaryMetadata(record),
              keyword_counts: keywordCounts
            }
          },
          { transaction }
        );
        return savedMetric;
      });
      return {
        ok: true,
        status: 'completed',
        metric,
        keyword_counts: keywordCounts
      };
    } catch (error) {
      const message = metricFailureMessage(error);
      const diagnostics = metricFailureDiagnostics(error);
      const failure = {
        stage: diagnostics
          ? (diagnostics.stage === 'request' ? 'analysis_request' : 'analysis_validation')
          : 'metric_persist',
        error_code: diagnostics?.error_code || 'metric_persist_failed'
      };
      const updatePayload = {
        status: 'failed',
        error_message: message,
        result_summary: {
          ...retrySummaryMetadata(record),
          failure,
          keyword_counts: keywordCounts,
          ...(diagnostics ? { analysis: diagnostics } : {})
        }
      };
      if (diagnostics) {
        console.warn('AI 结构化分析失败:', {
          record_id: record.id,
          ...diagnostics
        });
      }
      await record.update(updatePayload);
      return {
        ok: false,
        status: 'failed',
        error: message
      };
    }
  }

  formatError(error) {
    return error?.message || String(error || '未知错误');
  }

  async failRecord(record, message, failure = null) {
    if (!record?.update) return;
    try {
      const payload = { status: 'failed', error_message: message };
      if (failure?.stage && failure?.error_code) {
        payload.result_summary = {
          ...(record.result_summary && typeof record.result_summary === 'object' ? record.result_summary : {}),
          failure: {
            stage: String(failure.stage).slice(0, 80),
            error_code: String(failure.error_code).slice(0, 80)
          }
        };
      }
      await record.update(payload);
    } catch (updateError) {
      console.warn('标记项目运行记录失败异常:', updateError?.message || updateError);
    }
  }

  async createTargetRecord({ target, runUser, projectData, keywords }) {
    const prompt = target.prompt;
    return QuestionRecord.create({
      user_id: runUser.id,
      project_id: projectData.id,
      tracked_prompt_id: prompt.id,
      platform: target.platform,
      platform_name: target.platform_name || target.platform,
      model_name: target.model_name || null,
      question: prompt.question,
      brand: projectData.name,
      brand_keywords: keywords.join(','),
      status: 'pending'
    });
  }

  async createRunEntries({ targets, runUser, projectData, keywords }) {
    const rows = [];
    for (const target of targets) {
      const record = await this.createTargetRecord({ target, runUser, projectData, keywords });
      rows.push({ target, record });
    }
    return rows;
  }

  async getRuntimeSettings() {
    return AIRuntimeSettingsService.getSettings();
  }

  getProjectRunConcurrency(runtimeSettings = {}) {
    const configured = Number(runtimeSettings.ai_run_concurrency);
    if (Number.isInteger(configured) && configured > 0) return Math.min(configured, 5);
    return 2;
  }

  async claimRecordExecution(recordId) {
    const executionToken = randomUUID();
    const [updated] = await QuestionRecord.update(
      {
        execution_token: executionToken,
        execution_started_at: new Date()
      },
      {
        where: {
          id: recordId,
          status: 'pending',
          execution_token: null
        }
      }
    );
    return {
      claimed: updated === 1,
      executionToken: updated === 1 ? executionToken : null
    };
  }

  async releaseRecordExecution(recordId, executionToken) {
    if (!executionToken) return;
    try {
      await QuestionRecord.update(
        {
          execution_token: null,
          execution_started_at: null
        },
        {
          where: {
            id: recordId,
            execution_token: executionToken
          }
        }
      );
    } catch (error) {
      console.warn('释放分析任务执行租约失败:', {
        record_id: recordId,
        error: this.formatError(error)
      });
    }
  }

  async updateRetryBatchStatus(retryBatchId, status) {
    if (!retryBatchId) return;
    try {
      await QuestionSetRetryBatch.update(
        { status },
        { where: { id: retryBatchId } }
      );
    } catch (error) {
      console.warn('更新失败项重试批次状态失败:', {
        retry_batch_id: retryBatchId,
        status,
        error: this.formatError(error)
      });
    }
  }

  async runPreparedTargets({
    entries,
    runUser,
    projectData,
    competitors,
    keywords,
    runtimeSettings,
    concurrency,
    questionSetRunId,
    retryBatchId
  }) {
    const rows = Array.isArray(entries) ? entries : [];
    const results = new Array(rows.length);
    let nextIndex = 0;
    const configuredConcurrency = concurrency || this.getProjectRunConcurrency(runtimeSettings);
    const workerCount = Math.max(1, Math.min(Number(configuredConcurrency) || 1, rows.length || 1));

    const runNext = async () => {
      while (nextIndex < rows.length) {
        if (questionSetRunId) {
          const run = await QuestionSetRun.findByPk(questionSetRunId, { attributes: ['paused_at'] });
          if (run?.paused_at) break;
        }
        const currentIndex = nextIndex;
        nextIndex += 1;
        const entry = rows[currentIndex];
        const recordId = Number(entry.record?.id);
        const claimable = Number.isInteger(recordId) && recordId > 0;
        if (claimable && this.activeRecordIds.has(recordId)) {
          results[currentIndex] = {
            record_id: recordId,
            prompt_id: entry.target?.prompt?.id || null,
            platform: entry.target?.platform || entry.record?.platform || null,
            status: 'skipped',
            skipped_reason: 'already_running'
          };
          continue;
        }
        if (claimable) this.activeRecordIds.add(recordId);
        let executionToken = null;
        try {
          if (claimable && entry.record instanceof QuestionRecord) {
            const lease = await this.claimRecordExecution(recordId);
            if (!lease.claimed) {
              results[currentIndex] = {
                record_id: recordId,
                prompt_id: entry.target?.prompt?.id || null,
                platform: entry.target?.platform || entry.record?.platform || null,
                status: 'skipped',
                skipped_reason: 'already_running'
              };
              continue;
            }
            executionToken = lease.executionToken;
          }
          results[currentIndex] = await this.runTarget({
            target: entry.target,
            record: entry.record,
            retryMode: entry.retryMode,
            responseText: entry.responseText,
            providerCitations: entry.providerCitations,
            runUser,
            projectData,
            competitors,
            keywords,
            runtimeSettings
          });
        } finally {
          if (executionToken) await this.releaseRecordExecution(recordId, executionToken);
          if (retryBatchId) await this.updateRetryBatchStatus(retryBatchId, 'running');
          if (claimable) this.activeRecordIds.delete(recordId);
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, runNext));
    return results;
  }

  async consumeRunQuota(userId, amount, options = {}) {
    return consumeQuotaDirect(userId, 'detection', amount, options);
  }

  async prepareProjectRun({ project, prompts, platforms, user, promptSelectionExplicit = false }) {
    const projectData = project.toJSON ? project.toJSON() : project;
    const runUser = this.resolveRunUser(projectData, user);
    if (!this.isRunnableProject(projectData)) {
      return { ok: false, status: 400, message: '归档项目不能运行分析' };
    }
    const enabledPrompts = (Array.isArray(prompts) ? prompts : []).filter((prompt) => prompt && prompt.enabled !== false);
    if (!enabledPrompts.length) {
      return {
        ok: false,
        status: 400,
        message: '问题集中没有启用的问题。',
        data: { error_code: 'no_enabled_questions', skipped_platforms: [] }
      };
    }

    let projectPlatforms = normalizePlatformCodes(
      Array.isArray(platforms) && platforms.length ? platforms : projectData.platforms
    );
    if (!projectPlatforms.length) projectPlatforms = await AIPlatformService.getPlatformCodes();

    if (!this.hasPromptProjectPlatformOverlap(enabledPrompts, projectPlatforms)
      || (promptSelectionExplicit && !this.hasEveryPromptProjectPlatformOverlap(enabledPrompts, projectPlatforms))) {
      return {
        ok: false,
        status: 400,
        message: PLATFORM_MISMATCH_MESSAGE,
        data: { error_code: 'platform_scope_mismatch', skipped_platforms: [] }
      };
    }

    const candidateTargets = this.buildPromptTargets(enabledPrompts, projectPlatforms, projectPlatforms);
    const candidateCodes = normalizePlatformCodes(candidateTargets.map((target) => target.platform));
    const availability = await AIPlatformService.getPlatformAvailability(candidateCodes);
    const availabilityByCode = new Map(availability.map((item) => [item.code, item]));
    const targets = candidateTargets
      .filter((target) => availabilityByCode.get(target.platform)?.available)
      .map((target) => {
        const status = availabilityByCode.get(target.platform);
        return {
          ...target,
          platform_name: status.platform_name,
          model_name: status.model_name,
          platformConfig: status.config
        };
      });
    const skippedPlatforms = availability
      .filter((item) => !item.available)
      .map((item) => ({
        platform: item.code,
        name: item.platform_name,
        reason: item.reason,
        message: skippedPlatformMessage(item)
      }));

    if (!targets.length) {
      const detail = skippedPlatforms.map((item) => item.message).join('；') || '监测平台配置暂不可用';
      return {
        ok: false,
        status: 400,
        message: `${detail}，无法运行。`,
        data: { error_code: 'all_platforms_unavailable', skipped_platforms: skippedPlatforms }
      };
    }

    const runtimeSettings = await this.getRuntimeSettings();

    const quota = await this.consumeRunQuota(runUser.id, targets.length);
    if (!quota.ok) {
      const reasonMap = {
        not_allowed: '当前会员等级不允许使用该功能',
        exceeded: '今日可用检测次数不足',
        error: '配额检查失败'
      };
      return { ok: false, status: 403, message: reasonMap[quota.reason] || '配额不足' };
    }

    const competitors = await BrandCompetitor.findAll({
      where: { project_id: projectData.id },
      order: [['id', 'ASC']]
    });
    const keywords = this.buildBrandKeywordList(projectData);
    const entries = await this.createRunEntries({ targets, runUser, projectData, keywords });

    return {
      ok: true,
      projectData,
      runUser,
      targets,
      skippedPlatforms,
      runtimeSettings,
      competitors,
      keywords,
      entries
    };
  }

  schedulePreparedRun(context) {
    const task = async () => {
      await this.updateRetryBatchStatus(context.retryBatchId, 'running');
      try {
        const results = await this.runPreparedTargets(context);
        // 检查是否是暂停结束而非自然完成
        if (context.questionSetRunId) {
          const run = await QuestionSetRun.findByPk(context.questionSetRunId, { attributes: ['paused_at'] });
          if (run?.paused_at) {
            await this.updateRetryBatchStatus(context.retryBatchId, 'queued');
            console.log('问题集运行已暂停:', { question_set_run_id: context.questionSetRunId });
            return; // 暂停状态，跳过完成后的处理
          }
        }
        await this.evaluateAlertsAfterRun(context.projectData, context.runUser);
        if (context.questionSetRunId) {
          const QuestionSetRunService = require('./QuestionSetRunService');
          await QuestionSetRunService.finalizeNativeRun({
            projectId: context.projectData.id,
            runId: context.questionSetRunId
          });
        }
        await this.updateRetryBatchStatus(context.retryBatchId, 'completed');
        const summary = this.summarizeRunResults(results, context.targets.length);
        console.log('项目队列分析完成:', {
          project_id: context.projectData.id,
          total: summary.total,
          completed: summary.completed,
          failed: summary.failed
        });
      } catch (error) {
        await this.updateRetryBatchStatus(context.retryBatchId, 'failed');
        throw error;
      }
    };

    setImmediate(() => {
      task().catch((error) => {
        console.error('项目队列分析异常:', this.formatError(error));
      });
    });
  }

  async enqueueProjectRun(options) {
    const prepared = await this.prepareProjectRun(options);
    if (!prepared.ok) return prepared;

    // 将 questionSetRunId 注入 context 以便暂停检查
    if (options.questionSetRunId) {
      prepared.questionSetRunId = options.questionSetRunId;
    }

    const recordIds = prepared.entries.map((entry) => entry.record.id);
    if (options.questionSetRunId) {
      await QuestionSetRun.update(
        {
          record_ids: recordIds,
          imported_rows: [],
          completed_at: null
        },
        {
          where: {
            id: options.questionSetRunId,
            project_id: prepared.projectData.id
          }
        }
      );
    }
    this.schedulePreparedRun(prepared);
    const result = {
      ok: true,
      status: 202,
      message: '项目分析已加入队列',
      data: {
        status: 'queued',
        total: prepared.targets.length,
        queued: prepared.entries.length,
        pending: prepared.entries.length,
        completed: 0,
        failed: 0,
        skipped_platforms: prepared.skippedPlatforms,
        record_ids: recordIds,
        results: prepared.entries.map((entry) => ({
          record_id: entry.record.id,
          prompt_id: entry.target.prompt.id,
          platform: entry.target.platform,
          status: 'pending'
        }))
      }
    };
    if (prepared.skippedPlatforms.length) {
      result.message = `已加入 ${prepared.targets.length} 个运行任务；${prepared.skippedPlatforms.map((item) => item.message).join('；')}，已跳过。`;
    }
    return result;
  }

  async retryFailedQuestionSetRun({ project, runId, user, idempotencyKey: rawIdempotencyKey }) {
    const projectData = project?.toJSON ? project.toJSON() : project;
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    if (!this.isRunnableProject(projectData)) {
      throw runError('归档项目不能重试失败项', 400);
    }

    const storedRun = await QuestionSetRun.findOne({
      where: { id: runId, project_id: projectData.id }
    });
    if (!storedRun) throw runError('运行报告不存在', 404);
    if (storedRun.source !== 'native') throw runError('导入报告不能重试', 409);
    const existingBatch = await QuestionSetRetryBatch.findOne({
      where: {
        question_set_run_id: runId,
        project_id: projectData.id,
        idempotency_key: idempotencyKey
      }
    });
    if (existingBatch) return retryReplayResult(existingBatch);

    const storedIds = Array.isArray(storedRun.record_ids)
      ? storedRun.record_ids.map(Number).filter(Number.isInteger)
      : [];
    const storedRecords = storedIds.length
      ? await QuestionRecord.findAll({
        where: {
          id: { [require('sequelize').Op.in]: storedIds },
          project_id: projectData.id
        }
      })
      : [];
    const storedById = new Map(storedRecords.map((record) => [Number(record.id), record]));
    const orderedRecords = storedIds.map((id) => storedById.get(id)).filter(Boolean);
    if (orderedRecords.length !== storedIds.length) {
      throw runError('运行记录不完整，无法重试', 409);
    }
    if (orderedRecords.some((record) => record.status === 'pending')) {
      throw runError('运行中或正在重试，请等待当前任务结束', 409);
    }

    const failedRecords = orderedRecords.filter((record) => record.status === 'failed');
    if (!failedRecords.length) throw runError('没有可重试的失败项', 409);

    const failedRecordIds = failedRecords.map((record) => Number(record.id));
    const failedDetails = failedRecordIds.length
      ? await ResultDetail.findAll({
          where: {
            question_record_id: { [require('sequelize').Op.in]: failedRecordIds }
          }
        })
      : [];
    const detailsByRecordId = new Map(
      failedDetails.map((detail) => [Number(detail.question_record_id), detail])
    );
    const analysisOnlyIds = new Set(
      failedRecords
        .filter((record) => isAnalysisOnlyRetry(record, detailsByRecordId.get(Number(record.id))))
        .map((record) => Number(record.id))
    );
    const projectPlatformSet = new Set(normalizePlatformCodes(projectData.platforms));
    const monitoringCandidates = failedRecords.filter((record) => (
      !analysisOnlyIds.has(Number(record.id))
      && projectPlatformSet.has(String(record.platform || '').trim().toLowerCase())
    ));
    const outOfScopeRecords = failedRecords.filter((record) => (
      !analysisOnlyIds.has(Number(record.id))
      && !projectPlatformSet.has(String(record.platform || '').trim().toLowerCase())
    ));
    const platformCodes = normalizePlatformCodes(monitoringCandidates.map((record) => record.platform));
    const availability = await AIPlatformService.getPlatformAvailability(platformCodes);
    const availabilityByCode = new Map(availability.map((item) => [item.code, item]));
    const retryableMonitoringIds = new Set(
      monitoringCandidates
        .filter((record) => availabilityByCode.get(String(record.platform || '').toLowerCase())?.available)
        .map((record) => Number(record.id))
    );
    const retryableRecords = failedRecords.filter((record) => (
      analysisOnlyIds.has(Number(record.id)) || retryableMonitoringIds.has(Number(record.id))
    ));
    const skippedPlatforms = [
      ...outOfScopeRecords.map((record) => ({
        platform: record.platform,
        name: record.platform_name || record.platform,
        reason: 'outside_project_scope',
        message: `${record.platform_name || record.platform}已不在当前项目监测范围内`
      })),
      ...availability
      .filter((item) => !item.available)
      .map((item) => ({
        platform: item.code,
        name: item.platform_name,
        reason: item.reason,
        message: skippedPlatformMessage(item)
      }))
    ];
    if (!retryableRecords.length) {
      const message = skippedPlatforms.map((item) => item.message).join('；') || '监测平台配置暂不可用';
      throw runError(`${message}，没有失败项可重试`, 400, {
        error_code: 'all_retry_platforms_unavailable',
        skipped_platforms: skippedPlatforms
      });
    }

    const retryPromptIds = Array.from(new Set(
      retryableRecords.map((record) => Number(record.tracked_prompt_id)).filter(Number.isInteger)
    ));
    const [runtimeSettings, competitors, storedPrompts] = await Promise.all([
      this.getRuntimeSettings(),
      BrandCompetitor.findAll({
        where: { project_id: projectData.id },
        order: [['id', 'ASC']]
      }),
      retryPromptIds.length
        ? TrackedPrompt.findAll({
          where: {
            id: { [require('sequelize').Op.in]: retryPromptIds },
            project_id: projectData.id
          }
        })
        : []
    ]);
    const promptsById = new Map(storedPrompts.map((prompt) => [Number(prompt.id), prompt]));
    const keywords = this.buildBrandKeywordList(projectData);
    const runUser = this.resolveRunUser(projectData, user);

    let prepared;
    try {
      prepared = await sequelize.transaction(async (transaction) => {
      const run = await QuestionSetRun.findOne({
        where: { id: runId, project_id: projectData.id },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!run) throw runError('运行报告不存在', 404);
      if (run.source !== 'native') throw runError('导入报告不能重试', 409);
      const duplicateBatch = await QuestionSetRetryBatch.findOne({
        where: {
          question_set_run_id: runId,
          project_id: projectData.id,
          idempotency_key: idempotencyKey
        },
        transaction
      });
      if (duplicateBatch) return { replay: retryReplayResult(duplicateBatch) };
      const retryBatch = await QuestionSetRetryBatch.create({
        question_set_run_id: runId,
        project_id: projectData.id,
        user_id: runUser.id,
        idempotency_key: idempotencyKey,
        status: 'preparing',
        record_ids: []
      }, { transaction });

      const currentIds = Array.isArray(run.record_ids)
        ? run.record_ids.map(Number).filter(Number.isInteger)
        : [];
      const currentRecords = currentIds.length
        ? await QuestionRecord.findAll({
          where: {
            id: { [require('sequelize').Op.in]: currentIds },
            project_id: projectData.id
          },
          transaction,
          lock: transaction.LOCK.UPDATE
        })
        : [];
      const currentById = new Map(currentRecords.map((record) => [Number(record.id), record]));
      const currentOrderedRecords = currentIds.map((id) => currentById.get(id)).filter(Boolean);
      if (currentOrderedRecords.length !== currentIds.length) {
        throw runError('运行记录不完整，无法重试', 409);
      }
      if (currentOrderedRecords.some((record) => record.status === 'pending')) {
        throw runError('运行中或正在重试，请等待当前任务结束', 409);
      }

      const retryableIds = new Set(retryableRecords.map((record) => Number(record.id)));
      const claimedRecords = currentOrderedRecords.filter((record) => (
        record.status === 'failed' && retryableIds.has(Number(record.id))
      ));
      if (!claimedRecords.length) throw runError('没有可重试的失败项', 409);
      const fullMonitoringCount = claimedRecords.filter(
        (record) => !analysisOnlyIds.has(Number(record.id))
      ).length;
      const quota = fullMonitoringCount > 0
        ? await this.consumeRunQuota(runUser.id, fullMonitoringCount, { transaction })
        : { ok: true, used: 0, limit: null };
      if (!quota.ok) {
        const reasonMap = {
          not_allowed: '当前会员等级不允许使用该功能',
          exceeded: '今日可用检测次数不足',
          error: '配额检查失败'
        };
        throw runError(reasonMap[quota.reason] || '配额不足', 403);
      }

      const entries = [];
      for (const previousRecord of claimedRecords) {
        const retryMode = analysisOnlyIds.has(Number(previousRecord.id))
          ? 'analysis_only'
          : 'full_monitoring';
        const platformStatus = availabilityByCode.get(String(previousRecord.platform || '').toLowerCase());
        const previousAttempt = Number(previousRecord.result_summary?.retry?.attempt) || 0;
        const retryRecord = await QuestionRecord.create({
          user_id: previousRecord.user_id,
          project_id: projectData.id,
          tracked_prompt_id: previousRecord.tracked_prompt_id,
          platform: previousRecord.platform,
          platform_name: retryMode === 'full_monitoring'
            ? (platformStatus?.platform_name || previousRecord.platform_name || previousRecord.platform)
            : (previousRecord.platform_name || previousRecord.platform),
          model_name: retryMode === 'full_monitoring'
            ? (platformStatus?.model_name || previousRecord.model_name || null)
            : (previousRecord.model_name || null),
          question: previousRecord.question,
          brand: previousRecord.brand || projectData.name,
          brand_keywords: previousRecord.brand_keywords || keywords.join(','),
          status: 'pending',
          result_summary: {
            retry: {
              previous_record_id: previousRecord.id,
              attempt: previousAttempt + 1,
              kind: retryMode
            }
          }
        }, { transaction });
        const previousDetail = detailsByRecordId.get(Number(previousRecord.id));
        const responseText = retryMode === 'analysis_only'
          ? String(previousDetail?.ai_response_original || '')
          : '';
        if (retryMode === 'analysis_only') {
          await ResultDetail.create({
            question_record_id: retryRecord.id,
            ai_response_original: responseText,
            provider_citations: normalizeProviderCitations(previousDetail?.provider_citations),
            parsing_status: 'completed'
          }, { transaction });
        }
        const storedPrompt = promptsById.get(Number(previousRecord.tracked_prompt_id));
        const prompt = storedPrompt?.toJSON ? storedPrompt.toJSON() : (storedPrompt || {});
        const target = {
          prompt: {
            ...prompt,
            id: previousRecord.tracked_prompt_id,
            question: previousRecord.question
          },
          platform: previousRecord.platform,
          platform_name: retryMode === 'full_monitoring'
            ? (platformStatus?.platform_name || previousRecord.platform_name || previousRecord.platform)
            : (previousRecord.platform_name || previousRecord.platform),
          model_name: retryMode === 'full_monitoring'
            ? (platformStatus?.model_name || previousRecord.model_name || '')
            : (previousRecord.model_name || ''),
          platformConfig: retryMode === 'full_monitoring' ? (platformStatus?.config || {}) : {}
        };
        entries.push({
          target,
          record: retryRecord,
          previousRecordId: previousRecord.id,
          retryMode,
          responseText,
          providerCitations: normalizeProviderCitations(previousDetail?.provider_citations)
        });
      }

      const replacementById = new Map(entries.map((entry) => [
        Number(entry.previousRecordId),
        Number(entry.record.id)
      ]));
      await run.update({
        record_ids: currentIds.map((id) => replacementById.get(id) || id),
        imported_rows: [],
        completed_at: null,
        paused_at: null,
        revision: (Number(run.revision) || 0) + 1
      }, { transaction });
      const retryRecordIds = entries.map((entry) => Number(entry.record.id));
      const responseData = {
        run_id: runId,
        retry_batch_id: retryBatch.id,
        retried_count: retryRecordIds.length,
        analysis_only_count: entries.filter((entry) => entry.retryMode === 'analysis_only').length,
        full_monitoring_count: fullMonitoringCount,
        quota_consumed: fullMonitoringCount,
        record_ids: retryRecordIds,
        skipped_platforms: skippedPlatforms,
        idempotent_replay: false
      };
      const retrySummary = `已提交 ${retryRecordIds.length} 条失败项：`
        + `${responseData.analysis_only_count} 条复用原回答重做结构化分析，`
        + `${responseData.full_monitoring_count} 条重新调用监测平台`;
      const responseMessage = skippedPlatforms.length
        ? `${retrySummary}；${skippedPlatforms.map((item) => item.message).join('；')}，已跳过`
        : retrySummary;
      await retryBatch.update({
        status: 'queued',
        record_ids: retryRecordIds,
        response: {
          message: responseMessage,
          data: responseData
        }
      }, { transaction });

      return {
        run,
        entries,
        quota,
        retryBatchId: retryBatch.id,
        response: {
          ok: true,
          status: 202,
          message: responseMessage,
          data: responseData
        }
      };
      });
    } catch (error) {
      const concurrentBatch = await QuestionSetRetryBatch.findOne({
        where: {
          question_set_run_id: runId,
          project_id: projectData.id,
          idempotency_key: idempotencyKey
        }
      });
      if (concurrentBatch) return retryReplayResult(concurrentBatch);
      throw error;
    }
    if (prepared.replay) return prepared.replay;

    const retryRecordIds = prepared.entries.map((entry) => Number(entry.record.id));
    const fullMonitoringCount = prepared.entries.filter(
      (entry) => entry.retryMode === 'full_monitoring'
    ).length;
    const context = {
      entries: prepared.entries,
      runUser,
      projectData,
      competitors,
      keywords,
      runtimeSettings,
      concurrency: this.getProjectRunConcurrency(runtimeSettings),
      questionSetRunId: runId,
      retryBatchId: prepared.retryBatchId,
      targets: prepared.entries.map((entry) => entry.target)
    };
    try {
      this.schedulePreparedRun(context);
    } catch (error) {
      await QuestionRecord.update(
        { status: 'failed', error_message: RETRY_SCHEDULE_FAILURE_MESSAGE },
        {
          where: {
            id: { [require('sequelize').Op.in]: retryRecordIds },
            project_id: projectData.id,
            status: 'pending'
          }
        }
      );
      throw runError(RETRY_SCHEDULE_FAILURE_MESSAGE, 500);
    }

    return prepared.response;
  }

  async runTarget({
    target,
    record: preparedRecord = null,
    retryMode = 'full_monitoring',
    responseText: reusedResponseText = '',
    providerCitations: reusedProviderCitations = [],
    runUser,
    projectData,
    competitors,
    keywords,
    runtimeSettings
  }) {
    const prompt = target.prompt;
    let record = preparedRecord;
    try {
      if (!record) {
        record = await this.createTargetRecord({ target, runUser, projectData, keywords });
      }

      let aiResult = { data: {} };
      let originalText = String(reusedResponseText || '');
      let providerCitations = normalizeProviderCitations(reusedProviderCitations);
      if (retryMode !== 'analysis_only') {
        aiResult = await AIPlatformService.queryPlatform(target.platform, prompt.question, {
          config: target.platformConfig,
          runtimeSettings
        });
        if (!aiResult.success) {
          const message = runtimePlatformFailureMessage(aiResult);
          await this.failRecord(record, message, {
            stage: 'monitoring_request',
            error_code: aiResult.error_code || 'provider_error'
          });
          return {
            record_id: record.id,
            prompt_id: prompt.id,
            platform: target.platform,
            status: 'failed',
            error: message
          };
        }
        originalText = ResultParserService.extractResponseText(aiResult.data);
        providerCitations = this.snapshotProviderCitations(aiResult.data);
      }
      if (!String(originalText || '').trim()) {
        const message = '监测平台返回内容为空';
        await this.failRecord(record, message);
        return {
          record_id: record.id,
          prompt_id: prompt.id,
          platform: target.platform,
          status: 'failed',
          error: message
        };
      }
      if (retryMode !== 'analysis_only') {
        await ResultDetail.create({
          question_record_id: record.id,
          ai_response_original: originalText,
          provider_citations: providerCitations,
          parsing_status: 'completed'
        });
      }

      const finalization = await this.finalizeSuccessfulRecord({
        record,
        responseText: originalText,
        aiResponse: aiResult.data,
        providerCitations,
        project: projectData,
        competitors,
        prompt,
        keywords
      });
      if (!finalization.ok) {
        return {
          record_id: record.id,
          prompt_id: prompt.id,
          platform: target.platform,
          status: 'failed',
          error: finalization.error
        };
      }

      const metric = finalization.metric;
      return {
        record_id: record.id,
        prompt_id: prompt.id,
        platform: target.platform,
        status: 'completed',
        sentiment: metric.sentiment,
        share_of_voice: metric.share_of_voice,
        brand_mentioned: metric.brand_mentioned,
        citation_count: metric.citation_count,
        brand_rank: metric.brand_rank,
        brand_recommended: metric.brand_recommended
      };
    } catch (error) {
      const message = SAFE_PLATFORM_FAILURE_MESSAGE;
      await this.failRecord(record, message);
      return {
        record_id: record?.id || null,
        prompt_id: prompt?.id || null,
        platform: target.platform,
        status: 'failed',
        error: message
      };
    }
  }

  summarizeRunResults(results, total) {
    const completed = results.filter((item) => item.status === 'completed').length;
    const failed = results.filter((item) => item.status === 'failed').length;
    let message = '项目单次分析已完成';
    if (completed === 0 && failed > 0) {
      message = '项目单次分析全部失败，请检查监测平台配置、账号额度或网络连接';
    } else if (failed > 0) {
      message = '项目单次分析已完成，部分平台失败';
    }
    return { total, completed, failed, message };
  }

  async evaluateAlertsAfterRun(projectData, runUser) {
    try {
      await AlertEvaluationService.evaluateProject(projectData.id, runUser.id);
      return { ok: true };
    } catch (error) {
      const message = this.formatError(error);
      console.warn('项目运行告警评估失败:', message);
      return { ok: false, error: message };
    }
  }

  async pauseRun(runId, projectId) {
    const run = await QuestionSetRun.findOne({
      where: { id: runId, project_id: projectId }
    });
    if (!run) throw Object.assign(new Error('运行记录不存在'), { status: 404 });
    if (run.source !== 'native') throw Object.assign(new Error('导入报告不能暂停'), { status: 409 });
    if (run.paused_at) throw Object.assign(new Error('运行已暂停'), { status: 409 });
    const rows = Array.isArray(run.imported_rows) ? run.imported_rows : [];
    const pendingCount = rows.filter((row) => row.status === 'pending').length;
    const records = await QuestionRecord.findAll({
      where: {
        id: { [require('sequelize').Op.in]: run.record_ids },
        project_id: run.project_id
      },
      attributes: ['id', 'status']
    });
    const pendingRecords = records.filter((r) => r.status === 'pending').length;
    if (!pendingRecords && !pendingCount) {
      throw Object.assign(new Error('运行已完成，无法暂停'), { status: 409 });
    }
    await run.update({ paused_at: new Date() });
    return { ok: true, runId, paused: true };
  }

  async resumeRun(runId, projectId) {
    const run = await QuestionSetRun.findOne({
      where: { id: runId, project_id: projectId }
    });
    if (!run) throw Object.assign(new Error('运行记录不存在'), { status: 404 });
    if (run.source !== 'native') throw Object.assign(new Error('导入报告不能恢复'), { status: 409 });
    if (!run.paused_at) throw Object.assign(new Error('运行未处于暂停状态'), { status: 409 });

    // 找到所有 pending 状态的记录
    const records = await QuestionRecord.findAll({
      where: {
        id: { [require('sequelize').Op.in]: run.record_ids },
        project_id: run.project_id,
        status: 'pending'
      }
    });
    if (!records.length) {
      // 所有记录已完成，直接清除暂停状态
      await run.update({ paused_at: null });
      return { ok: true, runId, resumed: true, remainingCount: 0 };
    }

    // 重建执行上下文
    const project = await BrandProject.findByPk(run.project_id);
    if (!project) throw Object.assign(new Error('项目不存在'), { status: 404 });
    const projectData = project.toJSON ? project.toJSON() : project;

    const competitors = await BrandCompetitor.findAll({
      where: { project_id: run.project_id },
      order: [['id', 'ASC']]
    });

    const keywords = this.buildBrandKeywordList(projectData);
    const runtimeSettings = await this.getRuntimeSettings();

    // 获取关联的 prompts
    const promptIds = [...new Set(records.map((r) => r.tracked_prompt_id).filter(Boolean))];
    const prompts = await TrackedPrompt.findAll({
      where: {
        id: { [require('sequelize').Op.in]: promptIds },
        project_id: run.project_id
      }
    });
    const promptsById = new Map(prompts.map((p) => [p.id, p]));

    // 获取平台配置
    const platformCodes = [...new Set(records.map((r) => r.platform).filter(Boolean))];
    const availability = await AIPlatformService.getPlatformAvailability(platformCodes);
    const configByCode = new Map(availability.map((a) => [a.code, a.config]));

    // 构建 entries
    const entries = records.map((record) => {
      const prompt = promptsById.get(record.tracked_prompt_id);
      const platformConfig = configByCode.get(record.platform);
      return {
        target: {
          prompt: prompt || { id: record.tracked_prompt_id, question: record.question },
          platform: record.platform,
          platform_name: record.platform_name || record.platform,
          model_name: record.model_name || '',
          platformConfig: platformConfig || {}
        },
        record
      };
    });

    const validEntries = entries.filter((e) => e.target.prompt);
    if (!validEntries.length) {
      await run.update({ paused_at: null });
      return { ok: true, runId, resumed: true, remainingCount: 0 };
    }

    // 清除暂停状态并恢复执行
    await run.update({ paused_at: null });
    const concurrency = this.getProjectRunConcurrency(runtimeSettings);
    this.schedulePreparedRun({
      entries: validEntries,
      runUser: { id: run.user_id },
      projectData,
      competitors,
      keywords,
      runtimeSettings,
      concurrency,
      questionSetRunId: runId,
      targets: validEntries.map((e) => e.target)
    });

    return { ok: true, runId, resumed: true, remainingCount: validEntries.length };
  }

  async runProject({ project, prompts, platforms, user, promptSelectionExplicit = false }) {
    const prepared = await this.prepareProjectRun({ project, prompts, platforms, user, promptSelectionExplicit });
    if (!prepared.ok) return prepared;

    const results = await this.runPreparedTargets(prepared);

    await this.evaluateAlertsAfterRun(prepared.projectData, prepared.runUser);
    const summary = this.summarizeRunResults(results, prepared.targets.length);
    const ok = summary.completed > 0;

    const response = {
      ok,
      status: ok ? 200 : 502,
      message: summary.message,
      data: {
        total: summary.total,
        completed: summary.completed,
        failed: summary.failed,
        skipped_platforms: prepared.skippedPlatforms,
        results
      }
    };
    if (prepared.skippedPlatforms.length) {
      response.message = `${summary.message}；${prepared.skippedPlatforms.map((item) => item.message).join('；')}，已跳过。`;
    }
    return response;
  }
}

module.exports = new ProjectRunService();
