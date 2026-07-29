const { Op } = require('sequelize');
const {
  BrandCompetitor,
  QuestionRecord,
  ResultDetail,
  ReportSnapshot,
  TrackedPrompt,
  VisibilityMetric
} = require('../models');
const ProjectMetricsService = require('./ProjectMetricsService');
const ProjectRunService = require('./ProjectRunService');
const SourceAnalysisService = require('./SourceAnalysisService');
const OpportunityInsightService = require('./OpportunityInsightService');
const { CURRENT_METRIC_SEMANTICS } = require('./GeoMetricSemanticsService');

const defaultRepositories = {
  BrandCompetitor,
  QuestionRecord,
  ResultDetail,
  ReportSnapshot,
  TrackedPrompt,
  VisibilityMetric
};

function plain(row) {
  return row && typeof row.toJSON === 'function' ? row.toJSON() : row;
}

class ReportSnapshotService {
  resolveSnapshotUser(project, user) {
    const projectOwnerId = Number(project?.user_id || 0);
    const userId = Number(user?.id || 0);
    if (projectOwnerId > 0 && user?.role === 'admin' && userId !== projectOwnerId) {
      return { ...user, id: projectOwnerId, actor_user_id: userId || null };
    }
    return user;
  }

  async findLatest({ project, days, repositories = defaultRepositories }) {
    if (days !== undefined && days !== null && days !== '') {
      const safeDays = ProjectMetricsService.normalizeDays(days);
      const pageSize = 50;
      let offset = 0;

      while (true) {
        const rows = await repositories.ReportSnapshot.findAll({
          where: { project_id: project.id, status: 'generated' },
          order: [['created_at', 'DESC'], ['id', 'DESC']],
          limit: pageSize,
          offset
        });
        const plainRows = rows.map(plain);
        const match = plainRows.find((row) => {
          const periodDays = Number(row?.summary?.period_days || 0) || 30;
          return periodDays === safeDays;
        });
        if (match) return match;
        if (plainRows.length < pageSize) return null;
        offset += pageSize;
      }
    }
    return repositories.ReportSnapshot.findOne({
      where: { project_id: project.id, status: 'generated' },
      order: [['created_at', 'DESC'], ['id', 'DESC']]
    });
  }

  async generate({ project, user, days, repositories = defaultRepositories }) {
    const payload = await this.buildSnapshotPayload({ project, user, days, repositories });
    return repositories.ReportSnapshot.create(payload);
  }

  async buildSnapshotPayload({ project, user, days, repositories = defaultRepositories, now = new Date() }) {
    const {
      days: safeDays,
      periodStart,
      periodEnd,
      changePeriodStart
    } = ProjectMetricsService.buildPeriodWindow(days, { referenceDate: now });

    const projectRow = plain(project);
    const snapshotUser = this.resolveSnapshotUser(projectRow, user);
    const [metrics, changeMetrics, changeRecords, prompts, competitors] = await Promise.all([
      repositories.VisibilityMetric.findAll({
        where: {
          project_id: project.id,
          metric_semantics_version: CURRENT_METRIC_SEMANTICS,
          created_at: { [Op.between]: [periodStart, periodEnd] }
        },
        order: [['created_at', 'ASC']]
      }),
      repositories.VisibilityMetric.findAll({
        where: {
          project_id: project.id,
          metric_semantics_version: CURRENT_METRIC_SEMANTICS,
          created_at: { [Op.between]: [changePeriodStart, periodEnd] }
        },
        order: [['created_at', 'ASC']]
      }),
      repositories.QuestionRecord.findAll({
        where: {
          project_id: project.id,
          metric_semantics_version: CURRENT_METRIC_SEMANTICS,
          created_at: { [Op.between]: [changePeriodStart, periodEnd] }
        },
        attributes: [
          'id',
          'status',
          'tracked_prompt_id',
          'question_set_run_id',
          'run_slot_index',
          'platform',
          'metric_semantics_version',
          'created_at'
        ],
        include: [{
          model: repositories.ResultDetail || ResultDetail,
          as: 'resultDetail',
          attributes: ['ai_response_original', 'citation_analysis'],
          required: false
        }]
      }),
      repositories.TrackedPrompt.findAll({
        where: { project_id: project.id },
        attributes: ['id', 'question', 'tags', 'platforms', 'enabled'],
        raw: true
      }),
      repositories.BrandCompetitor.findAll({
        where: { project_id: project.id },
        order: [['id', 'ASC']]
      })
    ]);

    const metricRows = metrics.map(plain);
    const changeMetricRows = changeMetrics.map(plain);
    const changeRecordRows = changeRecords.map(plain);
    const recordRows = changeRecordRows.filter((row) => {
      const createdAt = new Date(row.created_at || row.createdAt || 0);
      return !Number.isNaN(createdAt.getTime()) && createdAt >= periodStart;
    });
    const competitorRows = competitors.map(plain);
    const promptRows = prompts.map((prompt) => ({
      ...prompt,
      category: ProjectRunService.derivePromptCategory(prompt)
    }));
    const citationEvidenceRows = ProjectMetricsService.buildCurrentCitationEvidenceRows({
      metrics: metricRows,
      records: recordRows
    });
    const changeCitationEvidenceRows = ProjectMetricsService.buildCurrentCitationEvidenceRows({
      metrics: changeMetricRows,
      records: changeRecordRows
    });
    const sourceAnalysis = SourceAnalysisService.summarize(citationEvidenceRows, {
      brand: projectRow,
      competitors: competitorRows,
      prompts: promptRows,
      days: safeDays,
      referenceDate: periodEnd,
      changeMetrics: changeCitationEvidenceRows
    });
    const availablePlatforms = ProjectMetricsService.listActualPlatforms(metricRows, recordRows);
    const promptPerformance = ProjectMetricsService.buildCurrentPromptPerformance(
      promptRows,
      metricRows,
      recordRows
    );
    const opportunities = OpportunityInsightService.build({
      prompts: promptRows,
      promptPerformance,
      metrics: metricRows,
      sourceOpportunities: sourceAnalysis.opportunities,
      projectPlatforms: availablePlatforms,
      days: safeDays
    });
    const buildMetricView = (viewMetrics, viewRecords, viewSourceAnalysis) => ({
      summary: ProjectMetricsService.buildCurrentDashboardSummary({
        metrics: viewMetrics,
        records: viewRecords,
        prompts: promptRows,
        sourceAnalysis: viewSourceAnalysis
      }),
      trend: ProjectMetricsService.buildCurrentTrend(
        viewMetrics,
        viewRecords,
        safeDays,
        { referenceDate: periodEnd }
      )
    });
    const allView = buildMetricView(metricRows, recordRows, sourceAnalysis);
    const platformViews = availablePlatforms.map((platform) => {
      const platformMetrics = ProjectMetricsService.filterByPlatform(metricRows, platform);
      const platformRecords = ProjectMetricsService.filterByPlatform(recordRows, platform);
      return {
        platform,
        ...buildMetricView(platformMetrics, platformRecords)
      };
    });

    return {
      project_id: project.id,
      user_id: snapshotUser.id,
      period_start: periodStart,
      period_end: periodEnd,
      metric_semantics_version: CURRENT_METRIC_SEMANTICS,
      summary: {
        period_days: safeDays,
        metric_semantics_version: CURRENT_METRIC_SEMANTICS,
        available_platforms: availablePlatforms,
        metric_views: {
          all: allView,
          platforms: platformViews
        },
        ...allView.summary,
        trend: allView.trend,
        source_summary: sourceAnalysis.summary,
        source_types: sourceAnalysis.source_types,
        source_domains: sourceAnalysis.domains.slice(0, 20),
        source_urls: sourceAnalysis.urls.slice(0, 20),
        source_changes: sourceAnalysis.source_changes,
        opportunities: opportunities.slice(0, 20),
        usage_guidance: {
          monitoring_questions: 'SOV 监测问题应由运营人员维护为不直接包含目标品牌名称或别名的非品牌词问题。',
          trend_comparison: '项目趋势应在稳定的问题集合内比较；问题集合实质增删后，从变更日起建立新的比较基线。'
        }
      }
    };
  }
}

module.exports = new ReportSnapshotService();
