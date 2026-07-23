const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SeoAuditJob = sequelize.define('SeoAuditJob', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  requested_url: { type: DataTypes.TEXT, allowNull: false },
  status: {
    type: DataTypes.ENUM('queued', 'running', 'completed', 'failed'),
    allowNull: false,
    defaultValue: 'queued'
  },
  progress: { type: DataTypes.JSON, allowNull: false, defaultValue: { phase: 'queued' } },
  audit_record_id: { type: DataTypes.INTEGER, allowNull: true },
  error_code: { type: DataTypes.STRING(64), allowNull: true },
  error_message: { type: DataTypes.TEXT, allowNull: true },
  started_at: { type: DataTypes.DATE, allowNull: true },
  completed_at: { type: DataTypes.DATE, allowNull: true }
}, {
  tableName: 'seo_audit_jobs',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['user_id'] },
    { fields: ['user_id', 'status'] },
    { fields: ['status'] }
  ]
});

module.exports = SeoAuditJob;
