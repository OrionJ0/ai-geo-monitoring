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
const { createHash, randomUUID } = require('node:crypto');
const os = require('node:os');
const { Op, Transaction } = require('sequelize');
const AIPlatformService = require('./AIPlatformService');
const WebPlatformRegistry = require('./WebPlatformRegistry');
const ResultParserService = require('./ResultParserService');
const VisibilityAnalysisService = require('./VisibilityAnalysisService');
const AIAnalysisConfigService = require('./AIAnalysisConfigService');
const { AIAnalysisConfigError } = require('./AIAnalysisConfigService');
const CitationAnalysisService = require('./CitationAnalysisService');
const { SEMANTICS_VERSION: CITATION_SEMANTICS_VERSION } = require('./CitationMetricSemanticsService');
const GeoMetricSemanticsService = require('./GeoMetricSemanticsService');
const {
  CURRENT_ANALYSIS_CONTRACT,
  CURRENT_METRIC_SEMANTICS,
  V5_ANALYSIS_CONTRACT,
  SCOPED_METRIC_SEMANTICS
} = require('./GeoMetricSemanticsService');
const AIResponseAnalysisV5Service = require('./AIResponseAnalysisV5Service');
const { AIResponseAnalysisV5Error } = require('./AIResponseAnalysisV5Service');
const AlertEvaluationService = require('./AlertEvaluationService');
const PromptCategoryService = require('./PromptCategoryService');
const AIRuntimeSettingsService = require('./AIRuntimeSettingsService');
const WebCaptureAnswerQualityService = require('./WebCaptureAnswerQualityService');
const { ERROR_MESSAGES: AI_PLATFORM_ERROR_MESSAGES } = require('./AIPlatformRequestService');
const { consumeQuotaDirect } = require('../middleware/quota');

function normalizeCompetitorSnapshot(competitors, fallbackSnapshot = null) {
  if (Array.isArray(competitors) && competitors.length) {
    return competitors.map((item) => {
      const row = item?.toJSON ? item.toJSON() : item;
      return {
        id: Number(row?.id ?? row?.competitor_id) || null,
        name: String(row?.name || ''),
        aliases: Array.isArray(row?.aliases)
          ? row.aliases.map((alias) => String(alias || '').trim()).filter(Boolean)
          : [],
        website: row?.website || null
      };
    });
  }
  return Array.isArray(fallbackSnapshot) ? fallbackSnapshot : [];
}

/**
 * 解析本次执行使用的不可变注册表快照：
 * analysis-only 优先复用原记录冻结的快照；新运行优先传入快照，
 * 再回退到从 competitors 实例构建。历史分析不随实时配置漂移。
 */
function resolveFrozenSnapshot(record, competitors, competitorSnapshot = null) {
  if (Array.isArray(record?.competitor_snapshot)) return record.competitor_snapshot;
  return normalizeCompetitorSnapshot(competitors, competitorSnapshot);
}

const SAFE_PLATFORM_FAILURE_MESSAGE = '监测平台调用失败，请稍后重试';
const RETRY_SCHEDULE_FAILURE_MESSAGE = '失败项重试调度失败，请重新提交';
const MIN_RECORD_LEASE_MS = 60 * 1000;
const RECORD_LEASE_BUFFER_SECONDS = 60;

function webPlatformErrorMessage(result) {
  const name = result?.platform === 'doubao-web'
    ? '豆包网页版'
    : 'DeepSeek 网页版';
  const messages = {
    web_browser_not_configured: '未配置可用的本机 Chrome',
    web_browser_launch_failed: `${name}浏览器启动失败`,
    web_browser_closed: `${name}浏览器已关闭`,
    web_browser_unresponsive: `${name}浏览器响应超时`,
    web_browser_command_failed: `${name}浏览器命令执行失败`,
    web_browser_connection_failed: `无法连接 ${name}浏览器`,
    web_capture_failed: `${name}采集失败`,
    web_profile_in_use: `${name}专用浏览器会话正在使用中`,
    web_login_required: `${name}需要重新人工登录`,
    web_verification_required: `${name}需要人工完成验证`,
    web_selector_mismatch: `${name}页面结构暂不受支持`,
    web_capture_mode_unverified: `无法确认 ${name}普通模式`,
    web_search_state_unverified: `无法确认 ${name}联网搜索已开启`,
    web_generation_timeout: `等待 ${name}最终回答超时`,
    web_response_too_large: `${name}回答超过保存上限`,
    web_screenshot_failed: `${name}截图保存失败`,
    web_artifact_write_failed: `${name}证据保存失败`,
    web_artifact_promote_failed: `${name}证据提交失败`,
    web_capture_metadata_too_large: `${name}采集元数据超过保存上限`,
    web_shutdown: `${name}服务正在关闭`
  };
  return messages[result?.error_code];
}

class StaleWorkerWriteError extends Error {
  constructor(recordId) {
    super('执行租约已失效，拒绝迟到 worker 写入');
    this.name = 'StaleWorkerWriteError';
    this.code = 'stale_worker_write_rejected';
    this.recordId = recordId;
  }
}

function runtimePlatformFailureMessage(result) {
  return webPlatformErrorMessage(result)
    || AI_PLATFORM_ERROR_MESSAGES[result?.error_code]
    || SAFE_PLATFORM_FAILURE_MESSAGE;
}

function metricFailureMessage(error) {
  if (error instanceof AIAnalysisConfigError && error.code === 'analysis_api_not_configured') {
    return 'AI 分析 API 未配置，本条未计入有效样本';
  }
  const messages = {
    analysis_context_missing: '分析所需问题或原回答缺失，本条未计入品牌指标',
    analysis_input_too_long: '回答超出分析模型范围，本条未计入品牌指标',
    analysis_output_truncated: '分析输出被截断，本条未计入品牌指标',
    analysis_relation_incomplete: '竞品关系识别不完整，本条未计入品牌指标',
    analysis_relation_reason_invalid: '竞品判断理由无效，本条未计入品牌指标',
    invalid_analysis_output: 'AI 结构化结果无效，本条未计入品牌指标'
  };
  if (error instanceof AIResponseAnalysisV5Error && messages[error.code]) {
    return messages[error.code];
  }
  if (error instanceof AIAnalysisConfigError
    || error instanceof AIResponseAnalysisV5Error) {
    return 'AI 结构化分析失败，本条未计入有效样本';
  }
  return '指标生成失败，请稍后重试';
}

function metricFailureDiagnostics(error) {
  if (
    !(error instanceof AIAnalysisConfigError)
    && !(error instanceof AIResponseAnalysisV5Error)
  ) {
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
    config_unavailable: `${name}配置暂不可用`,
    web_browser_not_configured: `${name}未配置可用的本机 Chrome`,
    web_browser_launch_failed: `${name}浏览器启动失败`,
    web_browser_unresponsive: `${name}浏览器响应超时`,
    web_browser_command_failed: `${name}浏览器命令执行失败`,
    web_browser_connection_failed: `${name}浏览器连接失败`,
    web_capture_failed: `${name}采集失败`,
    web_profile_in_use: `${name}专用浏览器会话正在使用中`,
    web_login_required: `${name}需要重新人工登录`,
    web_verification_required: `${name}需要人工完成验证`,
    web_selector_mismatch: `${name}页面结构暂不受支持`,
    web_shutdown: `${name}服务正在关闭`
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

function normalizeRequiredIdempotencyKey(value) {
  const text = String(value || '').trim();
  if (!text || text.length < 8 || text.length > 128 || !/^[A-Za-z0-9._:-]+$/u.test(text)) {
    throw runError('幂等键格式无效', 400, { error_code: 'INVALID_IDEMPOTENCY_KEY' });
  }
  return text;
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableSerialize(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isUniqueConstraintError(error) {
  return error?.name === 'SequelizeUniqueConstraintError'
    || error?.original?.code === '23505'
    || (
      error?.original?.code === 'SQLITE_CONSTRAINT'
      && /unique/i.test(String(error?.original?.message || error?.message || ''))
    );
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

function boundedWebCaptureReference(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const ownerRecordId = Number(value.artifact_owner_record_id);
  if (
    value.status !== 'completed'
    || !Number.isSafeInteger(ownerRecordId)
    || ownerRecordId <= 0
    || !value.artifacts
    || typeof value.artifacts !== 'object'
  ) {
    return null;
  }
  try {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') > 32 * 1024) return null;
    return JSON.parse(serialized);
  } catch {
    return null;
  }
}

function retrySummaryMetadata(record) {
  const summary = {};
  const retry = record?.result_summary?.retry;
  const previousRecordId = Number(retry?.previous_record_id);
  const attempt = Number(retry?.attempt);
  if (Number.isInteger(previousRecordId) && previousRecordId > 0
    && Number.isInteger(attempt) && attempt > 0) {
    summary.retry = {
      previous_record_id: previousRecordId,
      attempt,
      ...(record?.result_summary?.retry?.kind
        ? { kind: String(record.result_summary.retry.kind).slice(0, 40) }
        : {})
    };
  }
  const webCapture = boundedWebCaptureReference(record?.result_summary?.web_capture);
  if (webCapture) summary.web_capture = webCapture;
  return summary;
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

function isHttpProviderCitation(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function extractIndexedChatCitations(aiResponse) {
  return (Array.isArray(aiResponse?.choices) ? aiResponse.choices : [])
    .flatMap((choice) => {
      const message = choice?.message;
      const content = String(message?.content || '');
      const citedIndexes = new Set(
        Array.from(content.matchAll(/\[(\d+)\]/gu))
          .map((match) => Number(match[1]))
          .filter((index) => Number.isSafeInteger(index) && index > 0)
      );
      if (!citedIndexes.size || !Array.isArray(message?.search_results)) return [];
      return message.search_results
        .filter((source) => (
          citedIndexes.has(Number(source?.index))
          && isHttpProviderCitation(source?.url)
        ))
        .map((source) => ({
          ...(source?.url ? { url: source.url } : {}),
          ...(source?.name ? { title: source.name } : {}),
          source_role: CitationAnalysisService.SOURCE_ROLES.explicit,
          source_origin: 'citation_metadata'
        }));
    });
}

class ProjectRunService {
  constructor(options = {}) {
    this.activeRecordIds = new Set();
    this.activeQuestionSetRunRevisions = new Set();
    this.recordLeaseOwner = `${os.hostname()}:${process.pid}:project-run`;
    this.acceptingBackgroundRuns = true;
    this.backgroundRuns = new Set();
    this.analysisConfigService = options.analysisConfigService || AIAnalysisConfigService;
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

  buildPromptTargets(prompts, enabledPlatforms = []) {
    const platformCodes = normalizePlatformCodes(enabledPlatforms);
    const rows = Array.isArray(prompts) ? prompts : [];
    return rows
      .filter((prompt) => prompt && prompt.enabled !== false)
      .flatMap((prompt) => platformCodes.map((platform) => ({ prompt, platform })));
  }

  async getAnalysisReadinessFailure() {
    try {
      await this.analysisConfigService.getAnalysisPlatform();
      return null;
    } catch (error) {
      if (!(error instanceof AIAnalysisConfigError)) throw error;
      return {
        ok: false,
        status: Number(error.status) || 503,
        message: `${error.message}，请先在设置中心的“AI 分析 API”中完成配置。`,
        data: {
          error_code: error.code || 'analysis_config_unavailable',
          settings_url: '/admin/settings'
        }
      };
    }
  }

  derivePromptCategory(prompt) {
    return PromptCategoryService.derive(prompt);
  }

  snapshotProviderCitations(aiResponse) {
    return normalizeProviderCitations([
      ...CitationAnalysisService.collectMetadataSources(aiResponse),
      ...extractIndexedChatCitations(aiResponse)
    ]);
  }

  buildCitationAnalysis({
    responseText,
    aiResponse,
    providerCitations,
    project,
    competitors,
    citationObservationStatus = 'observed'
  }) {
    const citationAnalysis = CitationAnalysisService.extractSources({
      responseText,
      aiResponse: Array.isArray(providerCitations) ? providerCitations : aiResponse,
      brand: project,
      competitors
    });
    return {
      semantics_version: CITATION_SEMANTICS_VERSION,
      evidence_status: citationAnalysis.citation_count > 0
        || citationObservationStatus === 'observed'
        ? 'explicit'
        : 'unavailable',
      ...citationAnalysis
    };
  }

  async buildVisibilityMetricPayload({
    record,
    responseText,
    aiResponse,
    providerCitations,
    citationAnalysis: providedCitationAnalysis,
    project,
    competitors,
    prompt,
    competitorSnapshot = null
  }) {
    const projectData = project.toJSON ? project.toJSON() : project;
    const competitorData = Array.isArray(competitors)
      ? competitors.map((item) => (item.toJSON ? item.toJSON() : item))
      : [];
    const question = String(prompt?.question || record?.question || '').trim();
    const frozenSnapshot = resolveFrozenSnapshot(record, competitors, competitorSnapshot);
    // 010 硬切（2026-08-06）：v5 为唯一分析器，不再分派 v4；
    // v5 分阶段分析强制 deepseek-v4-flash（assertFlashPlatform），无 v4/Pro fallback。
    const analysis = await AIResponseAnalysisV5Service.analyze({
      question,
      responseText,
      brand: projectData,
      competitors: frozenSnapshot
    });
    const citationAnalysis = providedCitationAnalysis || this.buildCitationAnalysis({
      responseText,
      aiResponse,
      providerCitations,
      project: projectData,
      competitors: competitorData
    });
    const analysisStructure = analysis.analysis_structure
      && typeof analysis.analysis_structure === 'object'
      && !Array.isArray(analysis.analysis_structure)
      ? {
        ...analysis.analysis_structure,
        citations: {
          semantics_version: citationAnalysis.semantics_version,
          evidence_status: citationAnalysis.evidence_status,
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
      competitor_mentions: [],
      share_of_voice: null,
      answer_competitor_share: analysis.answer_competitor_share,
      sov_numerator: analysis.sov_numerator,
      sov_denominator: analysis.sov_denominator,
      competition_entities: analysis.competition_entities,
      citation_count: citationAnalysis.citation_count,
      owned_citation_count: citationAnalysis.owned_citation_count,
      competitor_citation_count: citationAnalysis.competitor_citation_count,
      citation_sources: citationAnalysis.sources,
      prompt_category: this.derivePromptCategory(prompt),
      sentiment: analysis.sentiment,
      sentiment_reason: analysis.sentiment_reason || null,
      sentiment_risk_terms: Array.isArray(analysis.sentiment_risk_terms) ? analysis.sentiment_risk_terms : [],
      analysis_method: analysis.analysis_method,
      metric_semantics_version: analysis.metric_semantics_version
        || CURRENT_METRIC_SEMANTICS,
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

  async persistResultDetail({
    record,
    responseText,
    providerCitations,
    citationAnalysis,
    transaction
  }) {
    const payload = {
      ai_response_original: responseText,
      provider_citations: normalizeProviderCitations(providerCitations),
      citation_analysis: citationAnalysis && typeof citationAnalysis === 'object'
        ? citationAnalysis
        : {},
      parsing_status: 'completed',
      parsing_error: null
    };
    const existing = await ResultDetail.findOne({
      where: { question_record_id: record.id },
      transaction
    });
    if (existing) return existing.update(payload, { transaction });
    return ResultDetail.create(
      { ...payload, question_record_id: record.id },
      { transaction }
    );
  }

  async updateRecordTerminalState({
    record,
    payload,
    executionToken = null,
    transaction = null
  }) {
    if (!executionToken) {
      if (record instanceof QuestionRecord) {
        throw new StaleWorkerWriteError(record.id);
      }
      await record.update(payload, transaction ? { transaction } : undefined);
      return true;
    }
    const [updated] = await QuestionRecord.update(
      {
        ...payload,
        execution_token: null,
        execution_started_at: null,
        lease_owner: null,
        lease_expires_at: null
      },
      {
        where: {
          id: record.id,
          status: 'pending',
          execution_token: executionToken
        },
        ...(transaction ? { transaction } : {})
      }
    );
    if (updated !== 1) throw new StaleWorkerWriteError(record.id);
    return true;
  }

  async finalizeRecordWithoutMetric({
    record,
    executionToken = null,
    persistResponseDetail = false,
    responseText,
    providerCitations = [],
    resultSummary = {}
  }) {
    try {
      await this.runInTransaction(async (transaction) => {
        if (persistResponseDetail) {
          await this.persistResultDetail({
            record,
            responseText,
            providerCitations,
            transaction
          });
        }
        await this.updateRecordTerminalState({
          record,
          executionToken,
          transaction,
          payload: {
            status: 'completed',
            error_message: null,
            result_summary: resultSummary
          }
        });
      });
      return { ok: true, status: 'completed' };
    } catch (error) {
      if (error instanceof StaleWorkerWriteError) {
        console.warn('拒绝迟到 worker 写入:', {
          record_id: record.id,
          error_code: error.code
        });
        return {
          ok: false,
          status: 'stale',
          error: new Error('执行租约已失效'),
          error_code: error.code
        };
      }
      throw error;
    }
  }

  async finalizeSuccessfulRecord({
    record,
    executionToken = null,
    persistResponseDetail = false,
    responseText,
    aiResponse,
    providerCitations,
    project,
    competitors,
    prompt,
    keywords,
    citationObservationStatus,
    resultSummaryPatch = {},
    competitorSnapshot = null
  }) {
    const keywordCounts = countKeywordOccurrences(responseText, keywords, true);
    const projectData = project?.toJSON ? project.toJSON() : project;
    const competitorData = Array.isArray(competitors)
      ? competitors.map((item) => (item?.toJSON ? item.toJSON() : item))
      : [];
    const citationAnalysis = this.buildCitationAnalysis({
      responseText,
      aiResponse,
      providerCitations,
      project: projectData,
      competitors: competitorData,
      citationObservationStatus: citationObservationStatus
        || ((Array.isArray(providerCitations) && providerCitations.length) ? 'observed' : 'unavailable')
    });
    try {
      const payload = await this.buildVisibilityMetricPayload({
        record,
        responseText,
        aiResponse,
        providerCitations,
        citationAnalysis,
        project,
        competitors,
        prompt,
        competitorSnapshot
      });
      const metric = await this.runInTransaction(async (transaction) => {
        if (persistResponseDetail) {
          await this.persistResultDetail({
            record,
            responseText,
            providerCitations,
            citationAnalysis,
            transaction
          });
        }
        const savedMetric = await this.persistVisibilityMetric({ record, payload, transaction });
        await this.updateRecordTerminalState({
          record,
          executionToken,
          transaction,
          payload: {
            status: 'completed',
            error_message: null,
            result_summary: {
              ...retrySummaryMetadata(record),
              ...resultSummaryPatch,
              keyword_counts: keywordCounts
            }
          }
        });
        return savedMetric;
      });
      return {
        ok: true,
        status: 'completed',
        metric,
        keyword_counts: keywordCounts
      };
    } catch (error) {
      if (error instanceof StaleWorkerWriteError) {
        console.warn('拒绝迟到 worker 写入:', {
          record_id: record.id,
          error_code: error.code
        });
        return {
          ok: false,
          status: 'stale',
          error: '执行租约已失效',
          error_code: error.code
        };
      }
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
          ...resultSummaryPatch,
          failure,
          keyword_counts: keywordCounts,
          ...(diagnostics ? { analysis: diagnostics } : {})
        }
      };
      if (diagnostics) {
        console.warn('AI 结构化分析失败:', {
          record_id: record.id,
          platform: diagnostics.platform || record.platform || '',
          analysis_contract_version: record.analysis_contract_version || CURRENT_ANALYSIS_CONTRACT,
          metric_semantics_version: record.metric_semantics_version || CURRENT_METRIC_SEMANTICS,
          stage: diagnostics.stage || failure.stage,
          error_code: diagnostics.error_code
        });
      }
      const failed = await this.failRecord(
        record,
        message,
        failure,
        {
          executionToken,
          resultSummary: updatePayload.result_summary,
          persistResponseDetail,
          responseText,
          providerCitations,
          citationAnalysis
        }
      );
      if (executionToken && !failed) {
        return {
          ok: false,
          status: 'stale',
          error: '执行租约已失效',
          error_code: 'stale_worker_write_rejected'
        };
      }
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

  async failRecord(record, message, failure = null, options = {}) {
    if (!record?.id) return false;
    try {
      const payload = { status: 'failed', error_message: message };
      if (options.resultSummary && typeof options.resultSummary === 'object') {
        payload.result_summary = options.resultSummary;
      } else if (failure?.stage && failure?.error_code) {
        payload.result_summary = {
          ...(record.result_summary && typeof record.result_summary === 'object' ? record.result_summary : {}),
          failure: {
            stage: String(failure.stage).slice(0, 80),
            error_code: String(failure.error_code).slice(0, 80)
          }
        };
      }
      const persistFailure = async (transaction = null) => {
        if (options.persistResponseDetail) {
          await this.persistResultDetail({
            record,
            responseText: options.responseText,
            providerCitations: options.providerCitations,
            citationAnalysis: options.citationAnalysis,
            transaction
          });
        }
        await this.updateRecordTerminalState({
          record,
          payload,
          executionToken: options.executionToken || null,
          transaction
        });
      };
      if (options.persistResponseDetail) {
        await this.runInTransaction(persistFailure);
      } else {
        await persistFailure();
      }
      return true;
    } catch (error) {
      if (error instanceof StaleWorkerWriteError) {
        console.warn('拒绝迟到 worker 写入:', {
          record_id: record.id,
          error_code: error.code
        });
        return false;
      }
      console.warn('标记项目运行记录失败异常:', error?.message || error);
      return false;
    }
  }

  async createTargetRecord({
    target,
    runUser,
    projectData,
    keywords,
    scheduledExecutionId = null,
    questionSetRunId = null,
    runSlotIndex = null,
    executionMode = 'full_monitoring',
    retryBatchId = null,
    competitorSnapshot = null,
    transaction = null
  }) {
    const prompt = target.prompt;
    return QuestionRecord.create({
      user_id: runUser.id,
      project_id: projectData.id,
      tracked_prompt_id: prompt.id,
      scheduled_execution_id: Number(scheduledExecutionId) > 0 ? Number(scheduledExecutionId) : null,
      question_set_run_id: Number(questionSetRunId) > 0 ? Number(questionSetRunId) : null,
      run_slot_index: Number.isInteger(runSlotIndex) && runSlotIndex >= 0 ? runSlotIndex : null,
      execution_mode: executionMode === 'analysis_only' ? 'analysis_only' : 'full_monitoring',
      retry_batch_id: Number(retryBatchId) > 0 ? Number(retryBatchId) : null,
      platform: target.platform,
      platform_name: target.platform_name || target.platform,
      model_name: target.model_name || null,
      question: prompt.question,
      brand: projectData.name,
      brand_keywords: keywords.join(','),
      analysis_contract_version: V5_ANALYSIS_CONTRACT,
      metric_semantics_version: SCOPED_METRIC_SEMANTICS,
      competitor_snapshot: competitorSnapshot,
      status: 'pending'
    }, transaction ? { transaction } : undefined);
  }

  async createRunEntries({
    targets,
    runUser,
    projectData,
    keywords,
    scheduledExecutionId = null,
    questionSetRunId = null,
    transaction = null,
    afterRecordCreated = null,
    competitorSnapshot = null
  }) {
    const rows = [];
    for (const [runSlotIndex, target] of targets.entries()) {
      const record = await this.createTargetRecord({
        target,
        runUser,
        projectData,
        keywords,
        scheduledExecutionId,
        questionSetRunId,
        runSlotIndex: questionSetRunId ? runSlotIndex : null,
        competitorSnapshot,
        transaction
      });
      rows.push({ target, record });
      if (typeof afterRecordCreated === 'function') {
        await afterRecordCreated({ target, record, runSlotIndex });
      }
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

  getRecordExecutionLeaseMs({ target = {}, runtimeSettings = {}, retryMode } = {}) {
    const rawMonitoringTimeoutSeconds = Number(
      target?.platformConfig?.request_timeout_seconds
      || runtimeSettings.ai_default_timeout_seconds
      || 90
    );
    const monitoringTimeoutSeconds = Number.isFinite(rawMonitoringTimeoutSeconds)
      && rawMonitoringTimeoutSeconds > 0
      ? rawMonitoringTimeoutSeconds
      : 90;
    const rawMonitoringRetryCount = Number(runtimeSettings.ai_retry_count ?? 3);
    const monitoringRetryCount = Number.isInteger(rawMonitoringRetryCount)
      ? Math.max(0, Math.min(3, rawMonitoringRetryCount))
      : 3;
    const monitoringAttempts = retryMode === 'analysis_only'
      ? 0
      : Math.max(1, Math.min(4, monitoringRetryCount + 1));
    const monitoringSeconds = Math.max(10, monitoringTimeoutSeconds) * monitoringAttempts;
    const retryDelaySeconds = monitoringAttempts > 1
      ? Array.from(
        { length: monitoringAttempts - 1 },
        (_, index) => Math.min(5, 2 ** index)
      ).reduce((sum, seconds) => sum + seconds, 0)
      : 0;
    // 010 硬切（2026-08-06）：v5 分阶段分析——两阶段 × 每阶段最多 2 次 =
    // 最多 4 次 Flash 调用，每次 120 秒；正常 2 次也处于预算内。v4 profile 不再使用。
    const { ANALYSIS_TIMEOUT_SECONDS } = require('./AIResponseEntityExtractionService');
    const v5StageSeconds = Math.max(10, Number(ANALYSIS_TIMEOUT_SECONDS) || 120);
    const analysisSeconds = v5StageSeconds * 4;
    return Math.max(
      MIN_RECORD_LEASE_MS,
      (monitoringSeconds + retryDelaySeconds + analysisSeconds + RECORD_LEASE_BUFFER_SECONDS) * 1000
    );
  }

  async claimRecordExecution(recordId, options = {}) {
    const executionToken = randomUUID();
    const now = options.now ? new Date(options.now) : new Date();
    const leaseMs = Math.max(
      MIN_RECORD_LEASE_MS,
      Number(options.leaseMs) || MIN_RECORD_LEASE_MS
    );
    const leaseOwner = String(options.leaseOwner || this.recordLeaseOwner).slice(0, 120);
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);
    const [updated] = await QuestionRecord.update(
      {
        execution_token: executionToken,
        execution_started_at: now,
        lease_owner: leaseOwner,
        lease_expires_at: leaseExpiresAt
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
      executionToken: updated === 1 ? executionToken : null,
      leaseOwner: updated === 1 ? leaseOwner : null,
      leaseExpiresAt: updated === 1 ? leaseExpiresAt : null,
      leaseMs
    };
  }

  async renewRecordExecutionLease(recordId, executionToken, options = {}) {
    if (!executionToken) return false;
    const now = options.now ? new Date(options.now) : new Date();
    const leaseMs = Math.max(
      MIN_RECORD_LEASE_MS,
      Number(options.leaseMs) || MIN_RECORD_LEASE_MS
    );
    const [updated] = await QuestionRecord.update(
      { lease_expires_at: new Date(now.getTime() + leaseMs) },
      {
        where: {
          id: recordId,
          status: 'pending',
          execution_token: executionToken
        }
      }
    );
    if (updated !== 1) {
      console.warn('执行租约续期失败:', {
        record_id: recordId,
        error_code: 'record_lease_renewal_rejected'
      });
    }
    return updated === 1;
  }

  startRecordLeaseHeartbeat({
    recordId,
    executionToken,
    leaseMs,
    heartbeatMs
  }) {
    let stopped = false;
    let renewalInFlight = false;
    let pendingRenewal = Promise.resolve();
    const normalizedLeaseMs = Math.max(
      MIN_RECORD_LEASE_MS,
      Number(leaseMs) || MIN_RECORD_LEASE_MS
    );
    const intervalMs = Math.max(
      5,
      Number(heartbeatMs) || Math.max(1000, Math.floor(normalizedLeaseMs / 3))
    );
    const timer = setInterval(() => {
      if (stopped || renewalInFlight) return;
      renewalInFlight = true;
      pendingRenewal = this.renewRecordExecutionLease(
        recordId,
        executionToken,
        { leaseMs: normalizedLeaseMs }
      ).then((renewed) => {
        if (!renewed) {
          stopped = true;
          clearInterval(timer);
        }
      }).catch(() => {
        stopped = true;
        clearInterval(timer);
        console.warn('执行租约续期异常:', {
          record_id: recordId,
          error_code: 'record_lease_renewal_failed'
        });
      }).finally(() => {
        renewalInFlight = false;
      });
    }, intervalMs);
    timer.unref?.();
    return {
      stop: async () => {
        stopped = true;
        clearInterval(timer);
        await pendingRenewal;
      }
    };
  }

  async releaseRecordExecution(recordId, executionToken) {
    if (!executionToken) return false;
    try {
      const [updated] = await QuestionRecord.update(
        {
          execution_token: null,
          execution_started_at: null,
          lease_owner: null,
          lease_expires_at: null
        },
        {
          where: {
            id: recordId,
            execution_token: executionToken
          }
        }
      );
      return updated === 1;
    } catch (error) {
      console.warn('释放分析任务执行租约失败:', {
        record_id: recordId,
        error_code: 'record_lease_release_failed'
      });
      return false;
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
        let leaseHeartbeat = null;
        try {
          if (claimable && entry.record instanceof QuestionRecord) {
            const leaseMs = this.getRecordExecutionLeaseMs({
              target: entry.target,
              runtimeSettings,
              retryMode: entry.retryMode
            });
            const lease = await this.claimRecordExecution(recordId, { leaseMs });
            if (!lease.claimed) {
              console.warn('领取执行租约失败:', {
                record_id: recordId,
                error_code: 'record_lease_claim_rejected'
              });
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
            leaseHeartbeat = this.startRecordLeaseHeartbeat({
              recordId,
              executionToken,
              leaseMs: lease.leaseMs
            });
          }
          results[currentIndex] = await this.runTarget({
            target: entry.target,
            record: entry.record,
            retryMode: entry.retryMode,
            responseText: entry.responseText,
            providerCitations: entry.providerCitations,
            citationObservationStatus: entry.citationObservationStatus,
            runUser,
            projectData,
            competitors,
            keywords,
            runtimeSettings,
            executionToken
          });
        } finally {
          if (leaseHeartbeat) await leaseHeartbeat.stop();
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

  async planProjectRun({
    project,
    prompts,
    user
  }) {
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

    const analysisReadinessFailure = await this.getAnalysisReadinessFailure();
    if (analysisReadinessFailure) return analysisReadinessFailure;

    const enabledPlatformCodes = await AIPlatformService.getEnabledPlatforms({
      capability: 'monitoring'
    });
    const candidateTargets = this.buildPromptTargets(enabledPrompts, enabledPlatformCodes);
    const candidateCodes = normalizePlatformCodes(enabledPlatformCodes);
    const availability = await AIPlatformService.getPlatformAvailability(
      candidateCodes,
      { forceRuntimeProbe: true }
    );
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
        reason_code: 'PLATFORM_UNAVAILABLE',
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
    const competitors = await BrandCompetitor.findAll({
      where: { project_id: projectData.id },
      order: [['id', 'ASC']]
    });
    const keywords = this.buildBrandKeywordList(projectData);

    return {
      ok: true,
      projectData,
      runUser,
      targets,
      plannedPlatforms: normalizePlatformCodes(targets.map((target) => target.platform)),
      skippedPlatforms,
      runtimeSettings,
      competitors,
      keywords
    };
  }

  quotaFailureResult(quota) {
    const reasonMap = {
      not_allowed: '当前会员等级不允许使用该功能',
      exceeded: '今日可用检测次数不足',
      error: '配额检查失败'
    };
    return {
      ok: false,
      status: quota?.reason === 'error' ? 500 : 403,
      message: reasonMap[quota?.reason] || '配额不足',
      data: {
        error_code: quota?.reason === 'error'
          ? 'RUN_START_TRANSACTION_FAILED'
          : 'RUN_QUOTA_UNAVAILABLE'
      }
    };
  }

  async prepareProjectRun(options) {
    const plan = await this.planProjectRun(options);
    if (!plan.ok) return plan;
    const quota = await this.consumeRunQuota(plan.runUser.id, plan.targets.length);
    if (!quota.ok) return this.quotaFailureResult(quota);
    const entries = await this.createRunEntries({
      targets: plan.targets,
      runUser: plan.runUser,
      projectData: plan.projectData,
      keywords: plan.keywords,
      scheduledExecutionId: options.scheduledExecutionId,
      questionSetRunId: options.questionSetRunId
    });
    return { ...plan, quota, entries };
  }

  buildQuestionSetRunFingerprint({ project, questionSet, prompts, user }) {
    const projectData = project?.toJSON ? project.toJSON() : project;
    const questionSetData = questionSet?.toJSON ? questionSet.toJSON() : questionSet;
    const runUser = this.resolveRunUser(projectData, user);
    const request = {
      user_id: Number(runUser?.id) || null,
      project_id: Number(projectData?.id) || null,
      question_set_id: Number(questionSetData?.id) || null,
      prompts: (Array.isArray(prompts) ? prompts : []).map((prompt) => ({
        id: Number(prompt?.id) || null,
        question: String(prompt?.question || ''),
        enabled: prompt?.enabled !== false
      }))
    };
    return sha256(stableSerialize(request));
  }

  buildQuestionSetRunStartResult(run, { replay = false, dispatchDeferred = false } = {}) {
    const row = run?.toJSON ? run.toJSON() : run;
    const skippedPlatforms = Array.isArray(row?.skipped_platforms) ? row.skipped_platforms : [];
    const plannedPlatforms = Array.isArray(row?.planned_platforms) ? row.planned_platforms : [];
    const runLabel = row?.question_set_id ? '问题集' : '问题';
    return {
      ok: true,
      status: 202,
      message: dispatchDeferred
        ? '运行命令已保存，任务将在调度器恢复后执行'
        : (replay ? '已返回原运行命令' : `${runLabel}分析已加入队列`),
      data: {
        status: 'queued',
        question_set_run_id: Number(row.id),
        accepted_count: Number(row.planned_record_count) || 0,
        total: Number(row.planned_record_count) || 0,
        queued: Number(row.planned_record_count) || 0,
        pending: Number(row.planned_record_count) || 0,
        completed: 0,
        failed: 0,
        planned_platforms: plannedPlatforms,
        skipped_platforms: skippedPlatforms,
        idempotent_replay: replay,
        dispatch_deferred: dispatchDeferred,
        report_url: `/geo/question-set-reports?project_id=${row.project_id}&run_id=${row.id}`
      }
    };
  }

  async startQuestionSetRun(options) {
    const idempotencyKey = normalizeRequiredIdempotencyKey(options.idempotencyKey);
    const idempotencyKeyHash = sha256(idempotencyKey);
    const requestFingerprint = this.buildQuestionSetRunFingerprint(options);
    const projectData = options.project?.toJSON ? options.project.toJSON() : options.project;
    const questionSetData = options.questionSet?.toJSON
      ? options.questionSet.toJSON()
      : options.questionSet;
    const runUser = this.resolveRunUser(projectData, options.user);
    const idempotencyWhere = {
      user_id: runUser.id,
      project_id: projectData.id,
      idempotency_key_hash: idempotencyKeyHash
    };
    const existing = await QuestionSetRun.findOne({ where: idempotencyWhere });
    if (existing) {
      if (existing.request_fingerprint !== requestFingerprint) {
        throw runError('幂等键已用于不同的运行请求', 409, {
          error_code: 'IDEMPOTENCY_KEY_REUSED'
        });
      }
      return this.buildQuestionSetRunStartResult(existing, { replay: true });
    }

    const plan = await this.planProjectRun(options);
    if (!plan.ok) return plan;
    const competitorSnapshot = plan.competitors.map((competitor) => {
      const row = competitor?.toJSON ? competitor.toJSON() : competitor;
      return {
        id: Number(row.id) || null,
        name: String(row.name || ''),
        aliases: Array.isArray(row.aliases) ? row.aliases : [],
        website: row.website || null
      };
    });
    const transactionOptions = sequelize.getDialect() === 'sqlite'
      ? { type: Transaction.TYPES.IMMEDIATE }
      : {};

    let committed;
    try {
      committed = await sequelize.transaction(transactionOptions, async (transaction) => {
        const replay = await QuestionSetRun.findOne({
          where: idempotencyWhere,
          transaction,
          lock: transaction.LOCK.UPDATE
        });
        if (replay) {
          if (replay.request_fingerprint !== requestFingerprint) {
            throw runError('幂等键已用于不同的运行请求', 409, {
              error_code: 'IDEMPOTENCY_KEY_REUSED'
            });
          }
          return { replay };
        }

        const run = await QuestionSetRun.create({
          project_id: projectData.id,
          user_id: runUser.id,
          question_set_id: questionSetData.id,
          question_set_name: questionSetData.name,
          source: 'native',
          schema_version: 'question_set_run_v1',
          idempotency_key_hash: idempotencyKeyHash,
          request_fingerprint: requestFingerprint,
          planned_platforms: plan.plannedPlatforms,
          skipped_platforms: plan.skippedPlatforms,
          competitor_snapshot: competitorSnapshot,
          analysis_contract_version: CURRENT_ANALYSIS_CONTRACT,
          metric_semantics_version: CURRENT_METRIC_SEMANTICS,
          planned_record_count: plan.targets.length,
          integrity_status: 'complete',
          integrity_missing_record_count: 0,
          integrity_error_code: null,
          started_at: new Date()
        }, { transaction });

        const quota = await this.consumeRunQuota(
          runUser.id,
          plan.targets.length,
          { transaction }
        );
        if (!quota.ok) {
          const failure = this.quotaFailureResult(quota);
          throw runError(failure.message, failure.status, failure.data);
        }
        if (typeof options.faultInjector === 'function') {
          await options.faultInjector('after_quota', { run, quota, transaction });
        }
        const entries = await this.createRunEntries({
          targets: plan.targets,
          runUser,
          projectData,
          keywords: plan.keywords,
          questionSetRunId: run.id,
          transaction,
          afterRecordCreated: async (context) => {
            if (typeof options.faultInjector === 'function') {
              await options.faultInjector('after_record', {
                ...context,
                run,
                transaction
              });
            }
          }
        });
        if (typeof options.faultInjector === 'function') {
          await options.faultInjector('before_commit', { run, entries, transaction });
        }
        return { run, entries };
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const replay = await QuestionSetRun.findOne({ where: idempotencyWhere });
        if (replay) {
          if (replay.request_fingerprint !== requestFingerprint) {
            throw runError('幂等键已用于不同的运行请求', 409, {
              error_code: 'IDEMPOTENCY_KEY_REUSED'
            });
          }
          return this.buildQuestionSetRunStartResult(replay, { replay: true });
        }
      }
      throw error;
    }

    if (committed.replay) {
      return this.buildQuestionSetRunStartResult(committed.replay, { replay: true });
    }
    const context = {
      ...plan,
      entries: committed.entries,
      competitors: competitorSnapshot,
      questionSetRunId: committed.run.id,
      runRevision: Number(committed.run.revision) || 0
    };
    let dispatchDeferred = false;
    try {
      this.schedulePreparedRun(context);
    } catch (error) {
      dispatchDeferred = true;
      console.warn('问题集运行提交后调度失败，等待补发:', {
        question_set_run_id: committed.run.id,
        error_code: 'question_set_run_dispatch_deferred'
      });
    }
    return this.buildQuestionSetRunStartResult(committed.run, { dispatchDeferred });
  }

  async buildPersistedQuestionSetRunContext(run, records) {
    const project = await BrandProject.findByPk(run.project_id);
    const projectData = project?.toJSON ? project.toJSON() : project;
    if (!this.isRunnableProject(projectData)) return null;
    const analysisOnlyRecordIds = records
      .filter((record) => record.execution_mode === 'analysis_only')
      .map((record) => Number(record.id))
      .filter((recordId) => Number.isInteger(recordId) && recordId > 0);
    const platformCodes = normalizePlatformCodes(
      records
        .filter((record) => record.execution_mode !== 'analysis_only')
        .map((record) => record.platform)
    );
    const promptIds = Array.from(new Set(
      records
        .map((record) => Number(record.tracked_prompt_id))
        .filter((promptId) => Number.isInteger(promptId) && promptId > 0)
    ));
    const [availability, runtimeSettings, responseDetails, storedPrompts] = await Promise.all([
      AIPlatformService.getPlatformAvailability(platformCodes),
      this.getRuntimeSettings(),
      analysisOnlyRecordIds.length
        ? ResultDetail.findAll({
            where: {
              question_record_id: { [Op.in]: analysisOnlyRecordIds }
            }
          })
        : [],
      promptIds.length
        ? TrackedPrompt.findAll({
            where: {
              id: { [Op.in]: promptIds },
              project_id: run.project_id
            }
          })
        : []
    ]);
    const availabilityByCode = new Map(availability.map((item) => [item.code, item]));
    const detailByRecordId = new Map(
      responseDetails.map((detail) => [Number(detail.question_record_id), detail])
    );
    const promptById = new Map(
      storedPrompts.map((prompt) => [Number(prompt.id), prompt])
    );
    const entries = records.map((record) => {
      const platform = String(record.platform || '').trim().toLowerCase();
      const platformStatus = availabilityByCode.get(platform);
      const retryMode = record.execution_mode === 'analysis_only'
        ? 'analysis_only'
        : 'full_monitoring';
      const responseDetail = retryMode === 'analysis_only'
        ? detailByRecordId.get(Number(record.id))
        : null;
      const storedPrompt = promptById.get(Number(record.tracked_prompt_id));
      const prompt = storedPrompt?.toJSON ? storedPrompt.toJSON() : (storedPrompt || {});
      return {
        record,
        retryMode,
        responseText: retryMode === 'analysis_only'
          ? String(responseDetail?.ai_response_original || '')
          : '',
        providerCitations: retryMode === 'analysis_only'
          ? normalizeProviderCitations(responseDetail?.provider_citations)
          : [],
        citationObservationStatus: responseDetail?.citation_analysis?.evidence_status === 'explicit'
          ? 'observed'
          : 'unavailable',
        target: {
          prompt: {
            ...prompt,
            id: record.tracked_prompt_id,
            question: record.question,
            enabled: true
          },
          platform,
          platform_name: record.platform_name || platformStatus?.platform_name || platform,
          model_name: record.model_name || platformStatus?.model_name || '',
          platformConfig: retryMode === 'full_monitoring'
            ? (platformStatus?.config || {})
            : {}
        }
      };
    });
    const firstRecord = records[0];
    const keywords = String(firstRecord?.brand_keywords || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const competitorSnapshot = Array.isArray(run.competitor_snapshot)
      ? run.competitor_snapshot
      : [];
    const retryBatchIds = Array.from(new Set(
      records
        .map((record) => Number(record.retry_batch_id))
        .filter((batchId) => Number.isInteger(batchId) && batchId > 0)
    ));
    if (retryBatchIds.length > 1) {
      const error = new Error('同一运行存在多个待处理重试批次');
      error.code = 'question_set_retry_batch_context_conflict';
      throw error;
    }
    return {
      ok: true,
      projectData,
      runUser: { id: run.user_id },
      targets: entries.map((entry) => entry.target),
      skippedPlatforms: Array.isArray(run.skipped_platforms) ? run.skipped_platforms : [],
      runtimeSettings,
      competitors: competitorSnapshot,
      keywords,
      entries,
      concurrency: this.getProjectRunConcurrency(runtimeSettings),
      questionSetRunId: run.id,
      runRevision: Number(run.revision) || 0,
      retryBatchId: retryBatchIds[0] || null
    };
  }

  getQuestionSetRunRevisionKey(runId, runRevision = 0) {
    const normalizedRunId = Number(runId);
    if (!Number.isInteger(normalizedRunId) || normalizedRunId <= 0) return null;
    return `${normalizedRunId}:${Number(runRevision) || 0}`;
  }

  async dispatchPendingQuestionSetRuns(options = {}) {
    const RunRepository = options.QuestionSetRun || QuestionSetRun;
    const RecordRepository = options.QuestionRecord || QuestionRecord;
    const limit = Number.isInteger(options.limit) && options.limit > 0
      ? Math.min(options.limit, 500)
      : 100;
    const runs = await RunRepository.findAll({
      where: {
        source: 'native',
        completed_at: null,
        paused_at: null
      },
      order: [['id', 'ASC']],
      limit
    });
    let dispatched = 0;
    for (const run of runs) {
      const runRevisionKey = this.getQuestionSetRunRevisionKey(run.id, run.revision);
      if (
        runRevisionKey
        && this.activeQuestionSetRunRevisions.has(runRevisionKey)
      ) continue;
      const records = await RecordRepository.findAll({
        where: {
          question_set_run_id: run.id,
          run_slot_index: { [Op.not]: null },
          status: 'pending',
          execution_token: null
        },
        order: [['run_slot_index', 'ASC'], ['id', 'ASC']]
      });
      if (!records.length) continue;
      const context = await this.buildPersistedQuestionSetRunContext(run, records);
      if (!context) continue;
      try {
        const execution = this.schedulePreparedRun(context);
        if (execution !== null) dispatched += 1;
      } catch (error) {
        console.warn('补发问题集运行失败:', {
          question_set_run_id: run.id,
          error_code: 'question_set_run_redispatch_failed'
        });
      }
    }
    return dispatched;
  }

  async executePreparedRun(context) {
    await this.updateRetryBatchStatus(context.retryBatchId, 'running');
    try {
      const results = await this.runPreparedTargets(context);
      const summary = this.summarizeRunResults(results.filter(Boolean), context.targets.length);
      let reconciliation = null;
      if (context.questionSetRunId) {
        const QuestionSetRunService = require('./QuestionSetRunService');
        reconciliation = await QuestionSetRunService.reconcileNativeRun({
          projectId: context.projectData.id,
          runId: context.questionSetRunId,
          expectedRevision: context.runRevision
        });
        if (!reconciliation.ok && reconciliation.reason !== 'stale_revision') {
          const error = new Error('问题集父运行收敛失败');
          error.code = `question_set_run_reconcile_${reconciliation.reason || 'failed'}`;
          throw error;
        }
      }

      const terminal = !context.questionSetRunId
        || reconciliation?.reconciled
        || reconciliation?.reason === 'already_terminal';
      if (terminal) {
        await this.evaluateAlertsAfterRun(context.projectData, context.runUser);
        await this.updateRetryBatchStatus(
          context.retryBatchId,
          reconciliation?.status === 'failed' ? 'failed' : 'completed'
        );
      } else if (reconciliation?.reason === 'stale_revision') {
        await this.updateRetryBatchStatus(
          context.retryBatchId,
          summary.completed === 0 && summary.failed > 0 ? 'failed' : 'completed'
        );
      } else if (reconciliation?.status === 'paused') {
        await this.updateRetryBatchStatus(context.retryBatchId, 'queued');
        console.log('问题集运行已暂停:', {
          question_set_run_id: context.questionSetRunId,
          revision: reconciliation.revision
        });
      }

      console.log('项目队列分析完成:', {
        project_id: context.projectData.id,
        total: summary.total,
        completed: summary.completed,
        failed: summary.failed
      });
      return { results, summary, reconciliation };
    } catch (error) {
      await this.updateRetryBatchStatus(context.retryBatchId, 'failed');
      throw error;
    }
  }

  schedulePreparedRun(context) {
    if (!this.acceptingBackgroundRuns) {
      throw runError('项目运行服务正在关闭', 503, {
        error_code: 'project_run_shutdown'
      });
    }
    const runRevisionKey = this.getQuestionSetRunRevisionKey(
      context?.questionSetRunId,
      context?.runRevision
    );
    if (runRevisionKey && this.activeQuestionSetRunRevisions.has(runRevisionKey)) {
      return null;
    }
    if (runRevisionKey) this.activeQuestionSetRunRevisions.add(runRevisionKey);
    let execution;
    execution = new Promise((resolve) => {
      setImmediate(async () => {
        try {
          await this.executePreparedRun(context);
        } catch (error) {
          console.error('项目队列分析异常:', this.formatError(error));
        } finally {
          this.backgroundRuns.delete(execution);
          if (runRevisionKey) this.activeQuestionSetRunRevisions.delete(runRevisionKey);
          resolve();
        }
      });
    });
    this.backgroundRuns.add(execution);
    return execution;
  }

  beginShutdown() {
    this.acceptingBackgroundRuns = false;
  }

  async drain() {
    while (this.backgroundRuns.size > 0) {
      await Promise.allSettled(Array.from(this.backgroundRuns));
    }
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
          planned_record_count: prepared.entries.length,
          imported_rows: [],
          completed_at: null,
          integrity_status: 'complete',
          integrity_missing_record_count: 0,
          integrity_error_code: null
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

    const analysisReadinessFailure = await this.getAnalysisReadinessFailure();
    if (analysisReadinessFailure) {
      const error = runError(
        analysisReadinessFailure.message,
        analysisReadinessFailure.status,
        analysisReadinessFailure.data
      );
      error.exposeToClient = true;
      throw error;
    }

    const orderedRecords = await QuestionRecord.findAll({
      where: {
        question_set_run_id: runId,
        project_id: projectData.id,
        run_slot_index: { [require('sequelize').Op.not]: null }
      },
      order: [['run_slot_index', 'ASC'], ['id', 'ASC']]
    });
    if (orderedRecords.length !== Number(storedRun.planned_record_count || 0)) {
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
    const monitoringCandidates = failedRecords.filter((record) => (
      !analysisOnlyIds.has(Number(record.id))
    ));
    const platformCodes = normalizePlatformCodes(monitoringCandidates.map((record) => record.platform));
    const availability = await AIPlatformService.getPlatformAvailability(
      platformCodes,
      { forceRuntimeProbe: true }
    );
    const availabilityByCode = new Map(availability.map((item) => [item.code, item]));
    const retryableMonitoringIds = new Set(
      monitoringCandidates
        .filter((record) => availabilityByCode.get(String(record.platform || '').toLowerCase())?.available)
        .map((record) => Number(record.id))
    );
    const retryableRecords = failedRecords.filter((record) => (
      analysisOnlyIds.has(Number(record.id)) || retryableMonitoringIds.has(Number(record.id))
    ));
    const skippedPlatforms = availability
      .filter((item) => !item.available)
      .map((item) => ({
        platform: item.code,
        name: item.platform_name,
        reason: item.reason,
        message: skippedPlatformMessage(item)
      }));
    if (!retryableRecords.length) {
      const message = skippedPlatforms.map((item) => item.message).join('；') || '监测平台配置暂不可用';
      throw runError(`${message}；失败项仍保留，但当前无法重新提交`, 400, {
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

      const currentOrderedRecords = await QuestionRecord.findAll({
        where: {
          question_set_run_id: runId,
          project_id: projectData.id,
          run_slot_index: { [require('sequelize').Op.not]: null }
        },
        order: [['run_slot_index', 'ASC'], ['id', 'ASC']],
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (currentOrderedRecords.length !== Number(run.planned_record_count || 0)) {
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
        const runSlotIndex = Number(previousRecord.run_slot_index);
        const retryMode = analysisOnlyIds.has(Number(previousRecord.id))
          ? 'analysis_only'
          : 'full_monitoring';
        const platformStatus = availabilityByCode.get(String(previousRecord.platform || '').toLowerCase());
        const previousAttempt = Number(previousRecord.result_summary?.retry?.attempt) || 0;
        const retainedWebCapture = retryMode === 'analysis_only'
          ? boundedWebCaptureReference(previousRecord.result_summary?.web_capture)
          : null;
        await previousRecord.update({ run_slot_index: null }, { transaction });
        const retryRecord = await QuestionRecord.create({
          user_id: previousRecord.user_id,
          project_id: projectData.id,
          tracked_prompt_id: previousRecord.tracked_prompt_id,
          question_set_run_id: runId,
          run_slot_index: runSlotIndex,
          execution_mode: retryMode,
          retry_batch_id: retryBatch.id,
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
          analysis_contract_version: previousRecord.analysis_contract_version
            || CURRENT_ANALYSIS_CONTRACT,
          metric_semantics_version: previousRecord.metric_semantics_version
            || CURRENT_METRIC_SEMANTICS,
          competitor_snapshot: Array.isArray(previousRecord.competitor_snapshot)
            ? previousRecord.competitor_snapshot
            : null,
          status: 'pending',
          result_summary: {
            retry: {
              previous_record_id: previousRecord.id,
              attempt: previousAttempt + 1,
              kind: retryMode
            },
            ...(retainedWebCapture ? { web_capture: retainedWebCapture } : {})
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
            citation_analysis: previousDetail?.citation_analysis
              && typeof previousDetail.citation_analysis === 'object'
              ? previousDetail.citation_analysis
              : {},
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
          providerCitations: normalizeProviderCitations(previousDetail?.provider_citations),
          citationObservationStatus: previousDetail?.citation_analysis?.evidence_status === 'explicit'
            ? 'observed'
            : 'unavailable'
        });
      }

      await run.update({
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

    const context = {
      entries: prepared.entries,
      runUser,
      projectData,
      competitors,
      keywords,
      runtimeSettings,
      concurrency: this.getProjectRunConcurrency(runtimeSettings),
      questionSetRunId: runId,
      runRevision: Number(prepared.run.revision) || 0,
      retryBatchId: prepared.retryBatchId,
      targets: prepared.entries.map((entry) => entry.target)
    };
    try {
      this.schedulePreparedRun(context);
    } catch (error) {
      await sequelize.transaction(async (transaction) => {
        for (const entry of prepared.entries) {
          await QuestionRecord.update(
            {
              status: 'failed',
              error_message: RETRY_SCHEDULE_FAILURE_MESSAGE,
              execution_token: null,
              execution_started_at: null,
              lease_owner: null,
              lease_expires_at: null,
              result_summary: {
                ...(entry.record.result_summary && typeof entry.record.result_summary === 'object'
                  ? entry.record.result_summary
                  : {}),
                failure: {
                  stage: 'retry_dispatch',
                  error_code: 'retry_dispatch_failed'
                }
              }
            },
            {
              where: {
                id: entry.record.id,
                project_id: projectData.id,
                status: 'pending'
              },
              transaction
            }
          );
        }
        await QuestionSetRetryBatch.update(
          { status: 'failed' },
          {
            where: {
              id: prepared.retryBatchId,
              question_set_run_id: runId
            },
            transaction
          }
        );
      });
      const QuestionSetRunService = require('./QuestionSetRunService');
      await QuestionSetRunService.reconcileNativeRun({
        projectId: projectData.id,
        runId,
        expectedRevision: context.runRevision
      });
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
    citationObservationStatus: reusedCitationObservationStatus = 'unavailable',
    runUser,
    projectData,
    competitors,
    keywords,
    runtimeSettings,
    executionToken = null,
    competitorSnapshot = null
  }) {
    const prompt = target.prompt;
    let record = preparedRecord;
    let generatedWebCapture = null;
    try {
      // 冻结快照：analysis-only 复用原记录快照；否则优先传入快照，
      // 再回退到从 competitors 实例构建，保持不可变身份。
      const frozenSnapshot = resolveFrozenSnapshot(record, competitors, competitorSnapshot);
      if (!record) {
        record = await this.createTargetRecord({
          target,
          runUser,
          projectData,
          keywords,
          competitorSnapshot: frozenSnapshot
        });
      }

      let aiResult = { data: {} };
      let originalText = String(reusedResponseText || '');
      let providerCitations = normalizeProviderCitations(reusedProviderCitations);
      let citationObservationStatus = reusedCitationObservationStatus;
      let resultSummaryPatch = {};
      if (retryMode === 'analysis_only' && !originalText.trim()) {
        const message = '结构化分析重试所需原回答缺失';
        await this.failRecord(
          record,
          message,
          {
            stage: 'analysis_retry_context',
            error_code: 'analysis_retry_context_missing'
          },
          { executionToken }
        );
        return {
          record_id: record.id,
          prompt_id: prompt.id,
          platform: target.platform,
          status: 'failed',
          error: message
        };
      }
      if (retryMode !== 'analysis_only') {
        const queryOptions = {
          config: target.platformConfig,
          runtimeSettings
        };
        if (WebPlatformRegistry.hasDefinition(target.platform)) {
          queryOptions.purpose = 'project_monitoring';
          queryOptions.capture_owner = {
            record_id: record.id,
            user_id: runUser.id,
            project_id: projectData.id,
            execution_token: executionToken
          };
        }
        aiResult = await AIPlatformService.queryPlatform(
          target.platform,
          prompt.question,
          queryOptions
        );
        if (aiResult.web_capture && typeof aiResult.web_capture === 'object') {
          resultSummaryPatch = { web_capture: aiResult.web_capture };
          if (aiResult.web_capture.status === 'completed') {
            generatedWebCapture = aiResult.web_capture;
          }
        }
        if (!aiResult.success) {
          const message = runtimePlatformFailureMessage(aiResult);
          const webFailure = aiResult.web_capture?.status === 'failed'
            ? aiResult.web_capture.failure
            : null;
          const failure = {
            stage: String(webFailure?.stage || 'monitoring_request').slice(0, 80),
            error_code: aiResult.error_code || 'provider_error'
          };
          await this.failRecord(record, message, failure, {
            executionToken,
            resultSummary: {
              ...retrySummaryMetadata(record),
              ...resultSummaryPatch,
              failure
            }
          });
          return {
            record_id: record.id,
            prompt_id: prompt.id,
            platform: target.platform,
            status: 'failed',
            error: message
          };
        }
        originalText = String(aiResult.text || '').trim()
          || ResultParserService.extractResponseText(aiResult.data);
        providerCitations = Array.isArray(aiResult.provider_citations)
          ? normalizeProviderCitations(aiResult.provider_citations)
          : this.snapshotProviderCitations(aiResult.data);
        citationObservationStatus = (
          aiResult.citation_observation_status === 'observed'
          || aiResult.web_capture?.status === 'completed'
          || providerCitations.length > 0
        ) ? 'observed' : 'unavailable';
      }
      if (!String(originalText || '').trim()) {
        const message = '监测平台返回内容为空';
        await this.failRecord(
          record,
          message,
          {
            stage: 'monitoring_response',
            error_code: 'empty_provider_response'
          },
          { executionToken }
        );
        return {
          record_id: record.id,
          prompt_id: prompt.id,
          platform: target.platform,
          status: 'failed',
          error: message
        };
      }
      const captureQuality = WebCaptureAnswerQualityService.evaluate({
        platform: target.platform,
        responseText: originalText,
        webCapture: resultSummaryPatch.web_capture
          || retrySummaryMetadata(record).web_capture
      });
      if (captureQuality.status === 'invalid') {
        const message = '豆包网页版采集结果无效，本条不进入结构化分析';
        const failure = {
          stage: 'capture_validation',
          error_code: 'web_capture_invalid_answer'
        };
        const retainedSummary = {
          ...retrySummaryMetadata(record),
          ...resultSummaryPatch
        };
        const retainedWebCapture = retainedSummary.web_capture
          ? {
              ...retainedSummary.web_capture,
              answer_quality: captureQuality
            }
          : null;
        const citationAnalysis = this.buildCitationAnalysis({
          responseText: originalText,
          aiResponse: aiResult.data,
          providerCitations,
          project: projectData,
          competitors,
          citationObservationStatus
        });
        const failed = await this.failRecord(record, message, failure, {
          executionToken,
          resultSummary: {
            ...retainedSummary,
            ...(retainedWebCapture ? { web_capture: retainedWebCapture } : {}),
            failure
          },
          persistResponseDetail: retryMode !== 'analysis_only',
          responseText: originalText,
          providerCitations,
          citationAnalysis
        });
        if (executionToken && !failed && generatedWebCapture) {
          await WebPlatformRegistry.getService(target.platform).discardRecordCapture(
            record.id,
            generatedWebCapture
          );
        }
        return {
          record_id: record.id,
          prompt_id: prompt.id,
          platform: target.platform,
          status: 'failed',
          error: failed || !executionToken ? message : '执行租约已失效'
        };
      }
      const finalization = await this.finalizeSuccessfulRecord({
        record,
        executionToken,
        persistResponseDetail: retryMode !== 'analysis_only',
        responseText: originalText,
        aiResponse: aiResult.data,
        providerCitations,
        citationObservationStatus,
        project: projectData,
        competitors,
        prompt,
        keywords,
        resultSummaryPatch,
        competitorSnapshot: frozenSnapshot
      });
      if (!finalization.ok) {
        if (
          finalization.error_code === 'stale_worker_write_rejected'
          && generatedWebCapture
        ) {
          await WebPlatformRegistry.getService(target.platform).discardRecordCapture(
            record.id,
            generatedWebCapture
          );
        }
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
        sov: GeoMetricSemanticsService.presentSov(metric),
        brand_mentioned: metric.brand_mentioned,
        citation_count: metric.citation_count,
        brand_rank: metric.brand_rank,
        brand_recommended: metric.brand_recommended
      };
    } catch (error) {
      if (generatedWebCapture && record?.id) {
        try {
          await WebPlatformRegistry
            .getService(target.platform)
            .discardRecordCapture(record.id, generatedWebCapture);
        } catch {
          // Evidence cleanup is best-effort here; the record must still reach a failed terminal state.
        }
      }
      const message = SAFE_PLATFORM_FAILURE_MESSAGE;
      await this.failRecord(
        record,
        message,
        { stage: 'worker_exception', error_code: 'worker_execution_failed' },
        { executionToken }
      );
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
    if (run.completed_at) throw Object.assign(new Error('运行已完成，无法暂停'), { status: 409 });
    const rows = Array.isArray(run.imported_rows) ? run.imported_rows : [];
    const pendingCount = rows.filter((row) => row.status === 'pending').length;
    const records = await QuestionRecord.findAll({
      where: {
        question_set_run_id: run.id,
        project_id: run.project_id,
        run_slot_index: { [require('sequelize').Op.not]: null }
      },
      attributes: [
        'id',
        'status',
        'execution_token',
        'execution_started_at',
        'lease_owner',
        'lease_expires_at'
      ]
    });
    const pendingRecords = records.filter((r) => r.status === 'pending').length;
    if (!pendingRecords && !pendingCount) {
      throw Object.assign(new Error('运行已完成，无法暂停'), { status: 409 });
    }
    const [updated] = await QuestionSetRun.update(
      { paused_at: new Date() },
      {
        where: {
          id: run.id,
          project_id: run.project_id,
          source: 'native',
          completed_at: null,
          paused_at: null
        }
      }
    );
    const QuestionSetRunService = require('./QuestionSetRunService');
    const controlState = records.some(
      (record) => QuestionSetRunService.deriveExecutionState(record) === 'executing'
    ) ? 'pausing' : 'paused';
    if (!updated) {
      await run.reload();
      if (!run.paused_at) {
        throw Object.assign(new Error('运行状态已变化，请刷新后重试'), { status: 409 });
      }
    }
    return {
      ok: true,
      runId,
      run_id: runId,
      paused: true,
      control_state: controlState,
      idempotent_replay: updated === 0
    };
  }

  async resumeRun(runId, projectId) {
    const run = await QuestionSetRun.findOne({
      where: { id: runId, project_id: projectId }
    });
    if (!run) throw Object.assign(new Error('运行记录不存在'), { status: 404 });
    if (run.source !== 'native') throw Object.assign(new Error('导入报告不能恢复'), { status: 409 });
    if (run.completed_at) throw Object.assign(new Error('运行已完成，无法恢复'), { status: 409 });
    const [claimed] = await QuestionSetRun.update(
      { paused_at: null },
      {
        where: {
          id: run.id,
          project_id: run.project_id,
          source: 'native',
          completed_at: null,
          paused_at: { [Op.not]: null }
        }
      }
    );
    if (!claimed) {
      await run.reload();
      if (!run.paused_at && !run.completed_at) {
        return {
          ok: true,
          runId,
          run_id: runId,
          resumed: true,
          remainingCount: null,
          control_state: 'running',
          idempotent_replay: true
        };
      }
      throw Object.assign(new Error('运行状态已变化，请刷新后重试'), { status: 409 });
    }

    // 找到所有 pending 状态的记录
    const records = await QuestionRecord.findAll({
      where: {
        question_set_run_id: run.id,
        project_id: run.project_id,
        run_slot_index: { [require('sequelize').Op.not]: null },
        status: 'pending'
      }
    });
    if (!records.length) {
      const QuestionSetRunService = require('./QuestionSetRunService');
      await QuestionSetRunService.reconcileNativeRun({
        projectId: run.project_id,
        runId: run.id,
        expectedRevision: Number(run.revision) || 0
      });
      return {
        ok: true,
        runId,
        run_id: runId,
        resumed: true,
        remainingCount: 0,
        control_state: 'terminal',
        idempotent_replay: false
      };
    }

    let context;
    try {
      context = await this.buildPersistedQuestionSetRunContext(run, records);
      if (!context) {
        throw Object.assign(new Error('项目不存在或已归档'), { status: 409 });
      }
      this.schedulePreparedRun(context);
    } catch (error) {
      await QuestionSetRun.update(
        { paused_at: new Date() },
        {
          where: {
            id: run.id,
            project_id: run.project_id,
            completed_at: null,
            paused_at: null
          }
        }
      ).catch(() => {});
      throw error;
    }

    return {
      ok: true,
      runId,
      run_id: runId,
      resumed: true,
      remainingCount: context.entries.length,
      control_state: 'running',
      idempotent_replay: false
    };
  }

  async runProject({
    project,
    prompts,
    user,
    scheduledExecutionId = null
  }) {
    const prepared = await this.prepareProjectRun({
      project,
      prompts,
      user,
      scheduledExecutionId
    });
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
module.exports.ProjectRunService = ProjectRunService;
module.exports.metricFailureDiagnostics = metricFailureDiagnostics;
module.exports.metricFailureMessage = metricFailureMessage;
module.exports.normalizeCompetitorSnapshot = normalizeCompetitorSnapshot;
module.exports.resolveFrozenSnapshot = resolveFrozenSnapshot;
