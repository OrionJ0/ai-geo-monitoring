const { BrandProject, BrandCompetitor, TrackedPrompt } = require('../models');
const ProjectRunService = require('./ProjectRunService');
const VisibilityAnalysisService = require('./VisibilityAnalysisService');

const SAFE_METRIC_FAILURE_MESSAGE = '指标生成失败，请稍后重试';

async function failRecordSafely(projectRunService, record, message, failure, executionToken) {
  if (typeof projectRunService?.failRecord !== 'function') {
    throw new TypeError('projectRunService.failRecord is required');
  }
  return projectRunService.failRecord(
    record,
    message,
    failure,
    { executionToken }
  );
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

async function finalize({
  record,
  executionToken = null,
  persistResponseDetail = false,
  responseText,
  aiResponse = null,
  providerCitations = [],
  keywords = [],
  repositories = {},
  projectRunService = ProjectRunService
}) {
  if (!String(responseText || '').trim()) {
    const message = '监测平台返回内容为空';
    const failed = await failRecordSafely(
      projectRunService,
      record,
      message,
      {
        stage: 'monitoring_response',
        error_code: 'empty_provider_response'
      },
      executionToken
    );
    return {
      ok: false,
      status: failed ? 'failed' : 'stale',
      error: new Error(failed ? message : '执行租约已失效')
    };
  }

  const keywordCounts = countKeywordOccurrences(responseText, keywords);
  if (!record?.project_id) {
    return projectRunService.finalizeRecordWithoutMetric({
      record,
      executionToken,
      persistResponseDetail,
      responseText,
      providerCitations,
      resultSummary: { keyword_counts: keywordCounts }
    });
  }

  const ProjectRepository = repositories.BrandProject || BrandProject;
  const CompetitorRepository = repositories.BrandCompetitor || BrandCompetitor;
  const PromptRepository = repositories.TrackedPrompt || TrackedPrompt;

  try {
    const project = await ProjectRepository.findByPk(record.project_id);
    if (!project) {
      const message = SAFE_METRIC_FAILURE_MESSAGE;
      const failed = await failRecordSafely(
        projectRunService,
        record,
        message,
        { stage: 'metric_persist', error_code: 'project_not_found' },
        executionToken
      );
      return {
        ok: false,
        status: failed ? 'failed' : 'stale',
        error: new Error(failed ? message : '执行租约已失效')
      };
    }
    const competitors = await CompetitorRepository.findAll({ where: { project_id: project.id }, order: [['id', 'ASC']] });
    const prompt = record.tracked_prompt_id
      ? await PromptRepository.findOne({ where: { id: record.tracked_prompt_id, project_id: project.id } })
      : null;
    return await projectRunService.finalizeSuccessfulRecord({
      record,
      executionToken,
      persistResponseDetail,
      responseText,
      aiResponse,
      providerCitations,
      project,
      competitors,
      competitorSnapshot: Array.isArray(record.competitor_snapshot)
        ? record.competitor_snapshot
        : null,
      prompt,
      keywords
    });
  } catch (error) {
    const message = SAFE_METRIC_FAILURE_MESSAGE;
    const failed = await failRecordSafely(
      projectRunService,
      record,
      message,
      { stage: 'metric_persist', error_code: 'metric_persist_failed' },
      executionToken
    );
    return {
      ok: false,
      status: failed ? 'failed' : 'stale',
      error: new Error(failed ? message : '执行租约已失效')
    };
  }
}

module.exports = {
  countKeywordOccurrences,
  finalize
};
