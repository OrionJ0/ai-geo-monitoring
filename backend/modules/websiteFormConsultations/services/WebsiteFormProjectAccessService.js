const { QueryTypes } = require('sequelize');
const {
  WebsiteFormConsultationError
} = require('./WebsiteFormConsultationService');

class WebsiteFormProjectAccessService {
  constructor({ sequelize, configuredProjectId }) {
    if (
      !sequelize
      || typeof sequelize.query !== 'function'
      || !/^\d+$/u.test(String(configuredProjectId || ''))
    ) {
      throw new WebsiteFormConsultationError(
        '官网表单项目访问服务配置无效',
        'WEBSITE_FORM_ACCESS_CONFIG_INVALID'
      );
    }
    this.sequelize = sequelize;
    this.configuredProjectId = String(configuredProjectId);
  }

  async assertAccess({ projectId, user }) {
    const normalizedProjectId = String(projectId || '');
    if (normalizedProjectId !== this.configuredProjectId) {
      throw new WebsiteFormConsultationError(
        '项目没有配置官网表单数据源',
        'WEBSITE_FORM_PROJECT_NOT_CONFIGURED',
        404
      );
    }

    const rows = await this.sequelize.query(
      `SELECT id, user_id, status
       FROM brand_projects
       WHERE id = :projectId
       LIMIT 1`,
      {
        replacements: { projectId: normalizedProjectId },
        type: QueryTypes.SELECT
      }
    );
    const project = rows[0];
    if (!project) {
      throw new WebsiteFormConsultationError(
        '项目不存在',
        'PROJECT_NOT_FOUND',
        404
      );
    }
    if (project.status === 'archived') {
      throw new WebsiteFormConsultationError(
        '归档项目不能读取官网表单数据',
        'PROJECT_ARCHIVED',
        409
      );
    }
    if (
      user?.role !== 'admin'
      && String(project.user_id) !== String(user?.id)
    ) {
      throw new WebsiteFormConsultationError(
        '无权查看该项目',
        'PROJECT_FORBIDDEN',
        403
      );
    }
    return project;
  }
}

module.exports = { WebsiteFormProjectAccessService };
