const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AIPlatformConfig = sequelize.define('AIPlatformConfig', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  code: { type: DataTypes.STRING(50), allowNull: false, unique: true },
  name: { type: DataTypes.STRING(100), allowNull: false },
  adapter_type: { type: DataTypes.STRING(50), allowNull: false },
  base_url: { type: DataTypes.STRING(2048), allowNull: false },
  encrypted_api_key: { type: DataTypes.TEXT, allowNull: true },
  api_key_last4: { type: DataTypes.STRING(4), allowNull: true },
  default_model: { type: DataTypes.STRING(255), allowNull: false },
  request_timeout_seconds: { type: DataTypes.INTEGER, allowNull: true },
  max_tokens: { type: DataTypes.INTEGER, allowNull: true },
  request_options: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
  enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  builtin: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  archived_at: { type: DataTypes.DATE, allowNull: true },
  test_status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'untested' },
  last_tested_at: { type: DataTypes.DATE, allowNull: true },
  last_test_error_code: { type: DataTypes.STRING(50), allowNull: true },
  last_test_message: { type: DataTypes.STRING(255), allowNull: true },
  web_search_test_status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'untested' },
  last_web_search_tested_at: { type: DataTypes.DATE, allowNull: true },
  last_web_search_test_error_code: { type: DataTypes.STRING(50), allowNull: true },
  last_web_search_test_message: { type: DataTypes.STRING(255), allowNull: true }
}, {
  tableName: 'ai_platform_configs',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['code'], unique: true },
    { fields: ['enabled'] },
    { fields: ['archived_at'] }
  ]
});

module.exports = AIPlatformConfig;
