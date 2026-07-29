const { DataTypes } = require('sequelize');

module.exports = {
  async up({ sequelize, queryInterface, transaction }) {
    await queryInterface.createTable('baidu_marketing_refresh_runs', {
      id: {
        type: DataTypes.STRING(36),
        primaryKey: true,
        allowNull: false
      },
      project_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'brand_projects', key: 'id' },
        onDelete: 'CASCADE'
      },
      project_run_sequence: {
        type: DataTypes.BIGINT,
        allowNull: false
      },
      trigger_type: {
        type: DataTypes.STRING(16),
        allowNull: false
      },
      status: {
        type: DataTypes.STRING(16),
        allowNull: false
      },
      active_project_key: {
        type: DataTypes.INTEGER,
        allowNull: true
      },
      execution_token: {
        type: DataTypes.STRING(64),
        allowNull: false
      },
      binding_fingerprint: {
        type: DataTypes.STRING(64),
        allowNull: false
      },
      coverage_start: {
        type: DataTypes.DATEONLY,
        allowNull: false
      },
      coverage_end: {
        type: DataTypes.DATEONLY,
        allowNull: false
      },
      contract_version: {
        type: DataTypes.STRING(120),
        allowNull: false
      },
      currency_code: {
        type: DataTypes.STRING(3),
        allowNull: false
      },
      cost_scale: {
        type: DataTypes.INTEGER,
        allowNull: false
      },
      snapshot_content_state: {
        type: DataTypes.STRING(8),
        allowNull: true
      },
      started_at: {
        type: DataTypes.DATE,
        allowNull: true
      },
      finished_at: {
        type: DataTypes.DATE,
        allowNull: true
      },
      next_retry_at: {
        type: DataTypes.DATE,
        allowNull: true
      },
      failure_code: {
        type: DataTypes.STRING(80),
        allowNull: true
      },
      created_by_user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL'
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false
      }
    }, { transaction });

    await queryInterface.addIndex(
      'baidu_marketing_refresh_runs',
      ['active_project_key'],
      {
        name: 'baidu_marketing_refresh_runs_one_active',
        unique: true,
        transaction
      }
    );
    await queryInterface.addIndex(
      'baidu_marketing_refresh_runs',
      ['project_id', 'created_at'],
      {
        name: 'baidu_marketing_refresh_runs_project_created',
        transaction
      }
    );
    await queryInterface.addIndex(
      'baidu_marketing_refresh_runs',
      ['project_id', 'project_run_sequence'],
      {
        name: 'baidu_marketing_refresh_runs_project_sequence',
        unique: true,
        transaction
      }
    );

    const decimalCheck = sequelize.getDialect() === 'postgres'
      ? "VALUE ~ '^[0-9]+$'"
      : "VALUE <> '' AND VALUE NOT GLOB '*[^0-9]*'";
    const check = (column) => decimalCheck.replaceAll('VALUE', column);
    await sequelize.query(
      `CREATE TABLE baidu_campaign_daily_metrics (
        id VARCHAR(36) PRIMARY KEY NOT NULL,
        project_id INTEGER NOT NULL
          REFERENCES brand_projects(id) ON DELETE CASCADE,
        binding_id VARCHAR(36) NOT NULL
          REFERENCES baidu_project_bindings(id) ON DELETE CASCADE,
        refresh_run_id VARCHAR(36) NOT NULL
          REFERENCES baidu_marketing_refresh_runs(id) ON DELETE CASCADE,
        metric_date DATE NOT NULL,
        external_account_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        campaign_name VARCHAR(512) NOT NULL,
        impressions_text TEXT NOT NULL
          CHECK (${check('impressions_text')}),
        clicks_text TEXT NOT NULL
          CHECK (${check('clicks_text')}),
        cost_amount_scaled_text TEXT NOT NULL
          CHECK (${check('cost_amount_scaled_text')}),
        created_at TIMESTAMP NOT NULL,
        CONSTRAINT baidu_campaign_daily_metrics_fact_unique
          UNIQUE (binding_id, campaign_id, metric_date)
      )`,
      { transaction }
    );
    await queryInterface.addIndex(
      'baidu_campaign_daily_metrics',
      ['refresh_run_id'],
      {
        name: 'baidu_campaign_daily_metrics_run',
        transaction
      }
    );
    await queryInterface.addIndex(
      'baidu_campaign_daily_metrics',
      ['project_id', 'metric_date'],
      {
        name: 'baidu_campaign_daily_metrics_project_date',
        transaction
      }
    );
  }
};
