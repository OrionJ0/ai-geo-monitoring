const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const QuestionSetRetryBatch = sequelize.define('QuestionSetRetryBatch', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  question_set_run_id: { type: DataTypes.INTEGER, allowNull: false },
  project_id: { type: DataTypes.INTEGER, allowNull: false },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  idempotency_key: { type: DataTypes.STRING(128), allowNull: false },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'queued' },
  record_ids: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
  response: { type: DataTypes.JSON, allowNull: true }
}, {
  tableName: 'question_set_retry_batches',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      fields: ['question_set_run_id', 'idempotency_key'],
      unique: true,
      name: 'question_set_retry_batches_run_key_unique'
    },
    { fields: ['project_id', 'created_at'] },
    { fields: ['user_id'] }
  ]
});

module.exports = QuestionSetRetryBatch;
