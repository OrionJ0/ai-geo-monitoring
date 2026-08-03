const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createMarketingTestDatabase
} = require('./helpers/createMarketingTestDatabase');

test('marketing schema owns separate exact daily fact tables for every SEARCH level', async (t) => {
  const database = await createMarketingTestDatabase('marketing-hierarchy-');
  t.after(database.close);

  const expected = {
    baidu_ad_group_daily_metrics: [
      'campaign_id',
      'ad_group_id',
      'impressions_text',
      'clicks_text',
      'cost_amount_scaled_text'
    ],
    baidu_keyword_daily_metrics: [
      'campaign_id',
      'ad_group_id',
      'keyword_id',
      'keyword_name',
      'targeting_type',
      'impressions_text',
      'clicks_text',
      'cost_amount_scaled_text'
    ],
    baidu_search_term_daily_metrics: [
      'campaign_id',
      'ad_group_id',
      'keyword_name',
      'search_term',
      'search_term_key',
      'query_status',
      'match_type',
      'impressions_text',
      'clicks_text',
      'cost_amount_scaled_text'
    ]
  };

  for (const [table, columns] of Object.entries(expected)) {
    const description = await database.sequelize
      .getQueryInterface()
      .describeTable(table);
    columns.forEach((column) => assert.ok(description[column], `${table}.${column}`));
  }

  await assert.rejects(
    database.sequelize.query(
      `INSERT INTO baidu_keyword_daily_metrics (
        id, project_id, binding_id, refresh_run_id, metric_date,
        external_account_id, campaign_id, campaign_name,
        ad_group_id, ad_group_name, keyword_id, keyword_name, targeting_type,
        impressions_text, clicks_text, cost_amount_scaled_text, created_at
      ) VALUES (
        'invalid', 11, 'missing', 'missing', '2026-08-03',
        'account', 'campaign', '计划', 'group', '单元', 'keyword', '关键词',
        'KEYWORD', '1e3', '0', '0', CURRENT_TIMESTAMP
      )`
    ),
    /constraint|foreign key|check/iu
  );
});
