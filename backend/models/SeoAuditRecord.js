const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SeoAuditRecord = sequelize.define('SeoAuditRecord', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  requested_url: { type: DataTypes.TEXT, allowNull: false },
  final_url: { type: DataTypes.TEXT, allowNull: false },
  status_code: { type: DataTypes.INTEGER, allowNull: false },
  duration_ms: { type: DataTypes.INTEGER, allowNull: false },
  score: { type: DataTypes.INTEGER, allowNull: false },
  grade: { type: DataTypes.STRING(32), allowNull: false },
  summary: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
  report: { type: DataTypes.JSON, allowNull: false },
  checked_at: { type: DataTypes.DATE, allowNull: false }
}, {
  tableName: 'seo_audit_records',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['user_id'] },
    { fields: ['user_id', 'checked_at'] }
  ]
});

module.exports = SeoAuditRecord;
