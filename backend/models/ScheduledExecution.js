const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ScheduledExecution = sequelize.define('ScheduledExecution', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  schedule_kind: {
    type: DataTypes.STRING(40),
    allowNull: false,
    validate: {
      isIn: [['detection_schedule', 'project_monitoring']]
    }
  },
  schedule_id: { type: DataTypes.INTEGER, allowNull: false },
  project_id: { type: DataTypes.INTEGER, allowNull: true },
  due_at: { type: DataTypes.DATE, allowNull: false },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'claimed',
    validate: {
      isIn: [['claimed', 'running', 'completed', 'failed']]
    }
  },
  execution_token: { type: DataTypes.STRING(64), allowNull: false },
  lease_owner: { type: DataTypes.STRING(120), allowNull: false },
  lease_expires_at: { type: DataTypes.DATE, allowNull: false },
  attempt: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  error_code: { type: DataTypes.STRING(80), allowNull: true },
  error_message: { type: DataTypes.TEXT, allowNull: true },
  started_at: { type: DataTypes.DATE, allowNull: true },
  completed_at: { type: DataTypes.DATE, allowNull: true }
}, {
  tableName: 'scheduled_executions',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      name: 'scheduled_executions_schedule_slot_unique',
      unique: true,
      fields: ['schedule_kind', 'schedule_id', 'due_at']
    },
    { fields: ['status', 'lease_expires_at'] },
    { fields: ['project_id'] }
  ]
});

module.exports = ScheduledExecution;
