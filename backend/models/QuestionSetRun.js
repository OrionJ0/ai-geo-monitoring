const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const QuestionSetRun = sequelize.define('QuestionSetRun', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  project_id: { type: DataTypes.INTEGER, allowNull: false },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  question_set_id: { type: DataTypes.INTEGER, allowNull: true },
  question_set_name: { type: DataTypes.STRING(120), allowNull: false },
  source: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'native' },
  schema_version: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'question_set_run_v1' },
  planned_record_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  integrity_status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'complete' },
  integrity_missing_record_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  integrity_error_code: { type: DataTypes.STRING(80), allowNull: true },
  imported_rows: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
  started_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  completed_at: { type: DataTypes.DATE, allowNull: true },
  paused_at: { type: DataTypes.DATE, allowNull: true },
  revision: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
}, {
  tableName: 'question_set_runs',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['project_id', 'created_at'] },
    { fields: ['user_id'] },
    { fields: ['question_set_id'] }
  ]
});

module.exports = QuestionSetRun;
