const {
  QuestionRecord,
  ResultDetail,
  BrandCompetitor,
  VisibilityMetric
} = require('../models');
const AIPlatformService = require('./AIPlatformService');
const ResultParserService = require('./ResultParserService');
const VisibilityAnalysisService = require('./VisibilityAnalysisService');
const AIResponseAnalysisService = require('./AIResponseAnalysisService');
const { AIResponseAnalysisError } = require('./AIResponseAnalysisService');
const { AIAnalysisConfigError } = require('./AIAnalysisConfigService');
const CitationAnalysisService = require('./CitationAnalysisService');
const AlertEvaluationService = require('./AlertEvaluationService');
const PromptCategoryService = require('./PromptCategoryService');
const AIRuntimeSettingsService = require('./AIRuntimeSettingsService');
const { ERROR_MESSAGES: AI_PLATFORM_ERROR_MESSAGES } = require('./AIPlatformRequestService');
const { consumeQuotaDirect } = require('../middleware/quota');

const SAFE_PLATFORM_FAILURE_MESSAGE = '监测平台调用失败，请稍后重试';
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

class ProjectRunService {
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

  async buildVisibilityMetricPayload({ record, responseText, aiResponse, project, competitors, prompt }) {
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
      aiResponse,
      brand: projectData,
      competitors: competitorData
    });
    const analysisStructure = analysis.analysis_structure
      && typeof analysis.analysis_structure === 'object'
      && !Array.isArray(analysis.analysis_structure)
      ? {
        ...analysis.analysis_structure,
        citations: {
          count: citationAnalysis.citation_count,
          official_count: citationAnalysis.owned_citation_count,
          competitor_count: citationAnalysis.competitor_citation_count,
          official_website_cited: citationAnalysis.owned_citation_count > 0,
          sources: citationAnalysis.sources
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

  async createVisibilityMetric({ record, responseText, aiResponse, project, competitors, prompt }) {
    const payload = await this.buildVisibilityMetricPayload({
      record,
      responseText,
      aiResponse,
      project,
      competitors,
      prompt
    });
    const existing = await VisibilityMetric.findOne({ where: { question_record_id: record.id } });
    if (existing) return existing.update(payload);
    return VisibilityMetric.create({ ...payload, question_record_id: record.id });
  }

  async finalizeSuccessfulRecord({ record, responseText, aiResponse, project, competitors, prompt, keywords }) {
    const keywordCounts = countKeywordOccurrences(responseText, keywords, true);
    try {
      const metric = await this.createVisibilityMetric({
        record,
        responseText,
        aiResponse,
        project,
        competitors,
        prompt
      });
      await record.update({ status: 'completed', result_summary: { keyword_counts: keywordCounts } });
      return {
        ok: true,
        status: 'completed',
        metric,
        keyword_counts: keywordCounts
      };
    } catch (error) {
      const message = metricFailureMessage(error);
      await record.update({ status: 'failed', error_message: message });
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

  async failRecord(record, message) {
    if (!record?.update) return;
    try {
      await record.update({ status: 'failed', error_message: message });
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

  async runPreparedTargets({ entries, runUser, projectData, competitors, keywords, runtimeSettings, concurrency }) {
    const rows = Array.isArray(entries) ? entries : [];
    const results = new Array(rows.length);
    let nextIndex = 0;
    const configuredConcurrency = concurrency || this.getProjectRunConcurrency(runtimeSettings);
    const workerCount = Math.max(1, Math.min(Number(configuredConcurrency) || 1, rows.length || 1));

    const runNext = async () => {
      while (nextIndex < rows.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        const entry = rows[currentIndex];
        results[currentIndex] = await this.runTarget({
          target: entry.target,
          record: entry.record,
          runUser,
          projectData,
          competitors,
          keywords,
          runtimeSettings
        });
      }
    };

    await Promise.all(Array.from({ length: workerCount }, runNext));
    return results;
  }

  async consumeRunQuota(userId, amount) {
    return consumeQuotaDirect(userId, 'detection', amount);
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
      const results = await this.runPreparedTargets(context);
      await this.evaluateAlertsAfterRun(context.projectData, context.runUser);
      const summary = this.summarizeRunResults(results, context.targets.length);
      console.log('项目队列分析完成:', {
        project_id: context.projectData.id,
        total: summary.total,
        completed: summary.completed,
        failed: summary.failed
      });
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

    this.schedulePreparedRun(prepared);
    const recordIds = prepared.entries.map((entry) => entry.record.id);
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

  async runTarget({ target, record: preparedRecord = null, runUser, projectData, competitors, keywords, runtimeSettings }) {
    const prompt = target.prompt;
    let record = preparedRecord;
    try {
      if (!record) {
        record = await this.createTargetRecord({ target, runUser, projectData, keywords });
      }

      const aiResult = await AIPlatformService.queryPlatform(target.platform, prompt.question, {
        config: target.platformConfig,
        runtimeSettings
      });
      if (!aiResult.success) {
        const message = runtimePlatformFailureMessage(aiResult);
        await this.failRecord(record, message);
        return {
          record_id: record.id,
          prompt_id: prompt.id,
          platform: target.platform,
          status: 'failed',
          error: message
        };
      }

      const originalText = ResultParserService.extractResponseText(aiResult.data);
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
      await ResultDetail.create({
        question_record_id: record.id,
        ai_response_original: originalText,
        parsing_status: 'completed'
      });

      const finalization = await this.finalizeSuccessfulRecord({
        record,
        responseText: originalText,
        aiResponse: aiResult.data,
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
