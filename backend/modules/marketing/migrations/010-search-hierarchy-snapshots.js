function exactTextCheck(dialect, column) {
  return dialect === 'postgres'
    ? `${column} ~ '^[0-9]+$'`
    : `${column} <> '' AND ${column} NOT GLOB '*[^0-9]*'`;
}

function commonColumns(check) {
  return `
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
    ad_group_id TEXT NOT NULL,
    ad_group_name VARCHAR(512) NOT NULL,
    impressions_text TEXT NOT NULL CHECK (${check('impressions_text')}),
    clicks_text TEXT NOT NULL CHECK (${check('clicks_text')}),
    cost_amount_scaled_text TEXT NOT NULL
      CHECK (${check('cost_amount_scaled_text')}),
    created_at TIMESTAMP NOT NULL`;
}

async function addFactIndexes(queryInterface, table, prefix, transaction) {
  await queryInterface.addIndex(table, ['refresh_run_id'], {
    name: `${prefix}_run`,
    transaction
  });
  await queryInterface.addIndex(table, ['project_id', 'metric_date'], {
    name: `${prefix}_project_date`,
    transaction
  });
}

module.exports = {
  async up({ sequelize, queryInterface, transaction }) {
    const dialect = sequelize.getDialect();
    const check = (column) => exactTextCheck(dialect, column);

    await sequelize.query(
      `CREATE TABLE baidu_ad_group_daily_metrics (
        ${commonColumns(check)},
        CONSTRAINT baidu_ad_group_daily_metrics_fact_unique
          UNIQUE (binding_id, campaign_id, ad_group_id, metric_date)
      )`,
      { transaction }
    );
    await addFactIndexes(
      queryInterface,
      'baidu_ad_group_daily_metrics',
      'baidu_ad_group_daily_metrics',
      transaction
    );

    await sequelize.query(
      `CREATE TABLE baidu_keyword_daily_metrics (
        ${commonColumns(check)},
        keyword_id TEXT NOT NULL,
        keyword_name VARCHAR(512) NOT NULL,
        targeting_type VARCHAR(32) NOT NULL,
        CONSTRAINT baidu_keyword_daily_metrics_fact_unique
          UNIQUE (
            binding_id, campaign_id, ad_group_id, keyword_id, metric_date
          )
      )`,
      { transaction }
    );
    await addFactIndexes(
      queryInterface,
      'baidu_keyword_daily_metrics',
      'baidu_keyword_daily_metrics',
      transaction
    );

    await sequelize.query(
      `CREATE TABLE baidu_search_term_daily_metrics (
        ${commonColumns(check)},
        keyword_name VARCHAR(512) NOT NULL,
        search_term VARCHAR(1024) NOT NULL,
        search_term_key VARCHAR(64) NOT NULL,
        query_status VARCHAR(24) NOT NULL,
        match_type VARCHAR(40) NOT NULL,
        CONSTRAINT baidu_search_term_daily_metrics_fact_unique
          UNIQUE (binding_id, search_term_key, metric_date)
      )`,
      { transaction }
    );
    await addFactIndexes(
      queryInterface,
      'baidu_search_term_daily_metrics',
      'baidu_search_term_daily_metrics',
      transaction
    );
  }
};
