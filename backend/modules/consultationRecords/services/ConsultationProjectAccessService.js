const { QueryTypes } = require('sequelize');
const {
  ConsultationRecordError
} = require('../contracts/consultationRecordContract');

class ConsultationProjectAccessService {
  constructor({ sequelize }) {
    if (!sequelize || typeof sequelize.query !== 'function') {
      throw new ConsultationRecordError(
        '咨询记录项目访问服务配置无效',
        'CONSULTATION_RECORD_ACCESS_CONFIG_INVALID'
      );
    }
    this.sequelize = sequelize;
  }

  async assertAccess({ projectId, user }) {
    const normalizedProjectId = String(projectId || '');
    if (!/^\d+$/u.test(normalizedProjectId)) {
      throw new ConsultationRecordError(
        '项目不存在',
        'PROJECT_NOT_FOUND',
        404
      );
    }
    const isAdmin = user?.role === 'admin';
    const rows = await this.sequelize.query(
      `SELECT id, user_id, status
       FROM brand_projects
       WHERE id = :projectId
       ${isAdmin ? '' : 'AND user_id = :userId'}
       LIMIT 1`,
      {
        replacements: isAdmin
          ? { projectId: normalizedProjectId }
          : { projectId: normalizedProjectId, userId: String(user?.id || '') },
        type: QueryTypes.SELECT
      }
    );
    const project = rows[0];
    if (!project) {
      throw new ConsultationRecordError(
        '项目不存在',
        'PROJECT_NOT_FOUND',
        404
      );
    }
    if (project.status === 'archived') {
      throw new ConsultationRecordError(
        '归档项目不能读取咨询记录',
        'PROJECT_ARCHIVED',
        409
      );
    }
    return project;
  }
}

module.exports = { ConsultationProjectAccessService };
