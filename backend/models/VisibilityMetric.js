const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const VisibilityMetric = sequelize.define('VisibilityMetric', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  project_id: { type: DataTypes.INTEGER, allowNull: false },
  prompt_id: { type: DataTypes.INTEGER, allowNull: true },
  question_record_id: { type: DataTypes.INTEGER, allowNull: false },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  platform: { type: DataTypes.STRING(50), allowNull: false },
  brand_mentioned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  brand_mentions: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  brand_position: { type: DataTypes.INTEGER, allowNull: true },
  brand_rank: { type: DataTypes.INTEGER, allowNull: true },
  brand_recommended: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  visibility_score: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  competitor_mentions: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
  share_of_voice: { type: DataTypes.FLOAT, allowNull: true },
  citation_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  owned_citation_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  competitor_citation_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  citation_sources: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
  prompt_category: { type: DataTypes.STRING(80), allowNull: true },
  sentiment: { type: DataTypes.ENUM('positive', 'neutral', 'negative'), allowNull: false, defaultValue: 'neutral' },
  sentiment_reason: { type: DataTypes.STRING(120), allowNull: true },
  sentiment_risk_terms: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
  analysis_method: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'legacy_rules_v1' },
  metric_semantics_version: { type: DataTypes.STRING(50), allowNull: false },
  analysis_platform: { type: DataTypes.STRING(50), allowNull: true },
  analysis_model: { type: DataTypes.STRING(255), allowNull: true },
  analysis_structure: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
  analysis_evidence: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
  answer_competitor_share: { type: DataTypes.FLOAT, allowNull: true },
  sov_numerator: { type: DataTypes.INTEGER, allowNull: true },
  sov_denominator: { type: DataTypes.INTEGER, allowNull: true },
  competition_entities: { type: DataTypes.JSON, allowNull: false, defaultValue: [] }
}, {
  tableName: 'visibility_metrics',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['project_id'] },
    { fields: ['prompt_id'] },
    { fields: ['question_record_id'], unique: true },
    { fields: ['user_id'] },
    { fields: ['platform'] },
    {
      name: 'visibility_metrics_project_semantics_created_platform',
      fields: ['project_id', 'metric_semantics_version', 'created_at', 'platform']
    }
  ]
});

module.exports = VisibilityMetric;
