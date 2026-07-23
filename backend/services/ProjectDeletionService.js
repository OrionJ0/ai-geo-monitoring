const { Op } = require('sequelize');
const {
  BrandProject,
  BrandCompetitor,
  DetectionSchedule,
  PromptGroup,
  TrackedPrompt,
  QuestionRecord,
  ResultDetail,
  VisibilityMetric,
  AlertRule,
  ReportSnapshot,
  QuestionSetRun
} = require('../models');

class ProjectDeletionService {
  normalizeIds(values) {
    return Array.from(new Set((Array.isArray(values) ? values : [])
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item > 0)));
  }

  async deleteArchivedProject(project, repositories = {}) {
    if (!project) {
      return { ok: false, status: 404, message: '品牌项目不存在' };
    }
    if (project.status !== 'archived') {
      return { ok: false, status: 409, message: '请先归档项目后再删除' };
    }

    const projectId = Number(project.id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return { ok: false, status: 400, message: '品牌项目无效' };
    }

    const ProjectRepository = repositories.BrandProject || BrandProject;
    const CompetitorRepository = repositories.BrandCompetitor || BrandCompetitor;
    const ScheduleRepository = repositories.DetectionSchedule || DetectionSchedule;
    const PromptGroupRepository = repositories.PromptGroup || PromptGroup;
    const PromptRepository = repositories.TrackedPrompt || TrackedPrompt;
    const RecordRepository = repositories.QuestionRecord || QuestionRecord;
    const DetailRepository = repositories.ResultDetail || ResultDetail;
    const MetricRepository = repositories.VisibilityMetric || VisibilityMetric;
    const AlertRepository = repositories.AlertRule || AlertRule;
    const ReportRepository = repositories.ReportSnapshot || ReportSnapshot;
    const QuestionSetRunRepository = repositories.QuestionSetRun || QuestionSetRun;

    const records = await RecordRepository.findAll({
      where: { project_id: projectId },
      attributes: ['id'],
      raw: true
    });
    const recordIds = this.normalizeIds(records.map((item) => item.id));

    const metrics = await MetricRepository.destroy({ where: { project_id: projectId } });
    let details = 0;
    let deletedRecords = 0;
    if (recordIds.length) {
      details = await DetailRepository.destroy({
        where: { question_record_id: { [Op.in]: recordIds } }
      });
      deletedRecords = await RecordRepository.destroy({
        where: {
          project_id: projectId,
          id: { [Op.in]: recordIds }
        }
      });
    }

    const schedules = await ScheduleRepository.destroy({ where: { project_id: projectId } });
    const reports = await ReportRepository.destroy({ where: { project_id: projectId } });
    const questionSetRuns = await QuestionSetRunRepository.destroy({ where: { project_id: projectId } });
    const alerts = await AlertRepository.destroy({ where: { project_id: projectId } });
    const prompts = await PromptRepository.destroy({ where: { project_id: projectId } });
    const groups = await PromptGroupRepository.destroy({ where: { project_id: projectId } });
    const competitors = await CompetitorRepository.destroy({ where: { project_id: projectId } });
    const projects = await ProjectRepository.destroy({ where: { id: projectId } });

    return {
      ok: true,
      deleted: {
        projects,
        competitors,
        groups,
        prompts,
        alerts,
        reports,
        questionSetRuns,
        schedules,
        records: deletedRecords,
        details,
        metrics
      }
    };
  }
}

module.exports = new ProjectDeletionService();
