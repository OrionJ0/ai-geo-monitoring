const { Op } = require('sequelize');

class PromptAnalysisCleanupService {
  normalizeIds(values) {
    return Array.from(new Set((Array.isArray(values) ? values : [])
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item > 0)));
  }

  partitionRecords(records) {
    const rows = Array.isArray(records) ? records : [];
    return {
      mutableRecordIds: this.normalizeIds(
        rows.filter((item) => !item.question_set_run_id).map((item) => item.id)
      ),
      protectedRecordIds: this.normalizeIds(
        rows.filter((item) => item.question_set_run_id).map((item) => item.id)
      )
    };
  }

  protectRunOwnedMetrics(where, protectedRecordIds) {
    if (!protectedRecordIds.length) return where;
    return {
      ...where,
      [Op.and]: [{
        [Op.or]: [
          { question_record_id: null },
          { question_record_id: { [Op.notIn]: protectedRecordIds } }
        ]
      }]
    };
  }

  async deleteForPrompts(projectId, promptIds, models) {
    const ids = this.normalizeIds(promptIds);
    if (!ids.length) return { records: 0, metrics: 0, details: 0, schedules: 0, reports: 0 };

    const { DetectionSchedule, QuestionRecord, VisibilityMetric, ResultDetail, ReportSnapshot } = models;
    const records = await QuestionRecord.findAll({
      where: {
        project_id: projectId,
        tracked_prompt_id: { [Op.in]: ids }
      },
      attributes: ['id', 'question_set_run_id'],
      raw: true
    });
    const { mutableRecordIds, protectedRecordIds } = this.partitionRecords(records);

    const schedules = DetectionSchedule
      ? await DetectionSchedule.destroy({
        where: {
          project_id: projectId,
          tracked_prompt_id: { [Op.in]: ids }
        }
      })
      : 0;

    const metricConditions = [{ prompt_id: { [Op.in]: ids } }];
    if (mutableRecordIds.length) {
      metricConditions.push({ question_record_id: { [Op.in]: mutableRecordIds } });
    }
    const metrics = await VisibilityMetric.destroy({
      where: this.protectRunOwnedMetrics({
        project_id: projectId,
        [Op.or]: metricConditions
      }, protectedRecordIds)
    });

    const reports = ReportSnapshot
      ? await ReportSnapshot.destroy({
        where: {
          project_id: projectId,
          status: 'generated'
        }
      })
      : 0;

    let details = 0;
    let deletedRecords = 0;
    if (mutableRecordIds.length) {
      details = await ResultDetail.destroy({
        where: {
          question_record_id: { [Op.in]: mutableRecordIds }
        }
      });
      deletedRecords = await QuestionRecord.destroy({
        where: {
          project_id: projectId,
          id: { [Op.in]: mutableRecordIds }
        }
      });
    }

    return { records: deletedRecords, metrics, details, schedules, reports };
  }

  async deleteForProject(projectId, models) {
    const id = Number(projectId);
    if (!Number.isInteger(id) || id <= 0) return { records: 0, metrics: 0, details: 0, reports: 0 };

    const { QuestionRecord, VisibilityMetric, ResultDetail, ReportSnapshot } = models;
    const records = await QuestionRecord.findAll({
      where: { project_id: id },
      attributes: ['id', 'question_set_run_id'],
      raw: true
    });
    const { mutableRecordIds, protectedRecordIds } = this.partitionRecords(records);

    const metrics = await VisibilityMetric.destroy({
      where: this.protectRunOwnedMetrics({ project_id: id }, protectedRecordIds)
    });

    let details = 0;
    let deletedRecords = 0;
    if (mutableRecordIds.length) {
      details = await ResultDetail.destroy({
        where: {
          question_record_id: { [Op.in]: mutableRecordIds }
        }
      });
      deletedRecords = await QuestionRecord.destroy({
        where: {
          project_id: id,
          id: { [Op.in]: mutableRecordIds }
        }
      });
    }

    const reports = ReportSnapshot
      ? await ReportSnapshot.destroy({
        where: {
          project_id: id,
          status: 'generated'
        }
      })
      : 0;

    return { records: deletedRecords, metrics, details, reports };
  }
}

module.exports = new PromptAnalysisCleanupService();
