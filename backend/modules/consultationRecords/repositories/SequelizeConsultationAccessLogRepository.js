const crypto = require('node:crypto');

class SequelizeConsultationAccessLogRepository {
  constructor({ sequelize, clock = () => new Date() }) {
    if (!sequelize || typeof sequelize.query !== 'function') {
      throw new TypeError('咨询详情审计仓储缺少数据库连接');
    }
    this.sequelize = sequelize;
    this.clock = clock;
  }

  async recordView({ userId, projectId, sourceSystem, consultationType, recordId }) {
    const viewedAt = this.clock().toISOString();
    const fingerprint = crypto
      .createHash('sha256')
      .update(String(recordId))
      .digest('hex');
    await this.sequelize.query(
      `INSERT INTO consultation_detail_access_logs (
         id, user_id, project_id, action, source_system,
         consultation_type, record_fingerprint, viewed_at
       ) VALUES (
         :id, :userId, :projectId, :action, :sourceSystem,
         :consultationType, :recordFingerprint, :viewedAt
       )`,
      {
        replacements: {
          id: crypto.randomUUID(),
          userId: String(userId),
          projectId: String(projectId),
          action: 'CONSULTATION_DETAIL_VIEW',
          sourceSystem,
          consultationType,
          recordFingerprint: fingerprint,
          viewedAt
        }
      }
    );
  }
}

module.exports = { SequelizeConsultationAccessLogRepository };
