const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const QuestionRecord = sequelize.define('QuestionRecord', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  project_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  tracked_prompt_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  scheduled_execution_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  question_set_run_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  run_slot_index: {
    type: DataTypes.INTEGER,
    allowNull: true,
    validate: { min: 0 }
  },
  execution_mode: {
    type: DataTypes.STRING(24),
    allowNull: false,
    defaultValue: 'full_monitoring',
    validate: {
      isIn: [['full_monitoring', 'analysis_only']]
    }
  },
  retry_batch_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  lease_owner: {
    type: DataTypes.STRING(120),
    allowNull: true
  },
  lease_expires_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  platform: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  platform_name: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  model_name: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  brand: {
    type: DataTypes.STRING,
    allowNull: true
  },
  question: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  brand_keywords: {
    type: DataTypes.STRING(500),
    allowNull: false
  },
  detection_time: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  result_summary: {
    type: DataTypes.JSON,
    comment: '统计结果摘要，包含推荐率、曝光率等'
  },
  status: {
    type: DataTypes.ENUM('pending', 'completed', 'failed'),
    defaultValue: 'pending'
  },
  execution_token: {
    type: DataTypes.STRING(64),
    allowNull: true
  },
  execution_started_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  error_message: {
    type: DataTypes.TEXT
  }
}, {
  tableName: 'question_records',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      fields: ['user_id']
    },
    {
      fields: ['project_id']
    },
    {
      fields: ['tracked_prompt_id']
    },
    {
      fields: ['scheduled_execution_id']
    },
    {
      fields: ['question_set_run_id']
    },
    {
      fields: ['question_set_run_id', 'status']
    },
    {
      name: 'question_records_run_slot_unique',
      unique: true,
      fields: ['question_set_run_id', 'run_slot_index']
    },
    {
      fields: ['lease_expires_at', 'status']
    },
    {
      fields: ['retry_batch_id']
    },
    {
      fields: ['platform']
    },
    {
      fields: ['detection_time']
    }
  ]
});

module.exports = QuestionRecord;
