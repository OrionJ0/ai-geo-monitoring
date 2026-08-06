const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const express = require('express');

const {
  createMarketingDashboardRouter
} = require('../../modules/marketing/routes/marketingDashboardRoutes');

const {
  MarketingAdResourceService
} = require('../../modules/marketing/services/MarketingAdResourceService');
const {
  MarketingSnapshotSelector
} = require('../../modules/marketing/services/MarketingSnapshotSelector');
const {
  createMarketingTestDatabase,
  seedConnectionAndBinding
} = require('./helpers/createMarketingTestDatabase');
const {
  assertMarketingOpenApiResponse
} = require('./helpers/assertMarketingOpenApiResponse');

async function seedHierarchy(sequelize) {
  await sequelize.query(
    `INSERT INTO baidu_marketing_refresh_runs (
      id, project_id, project_run_sequence, trigger_type, status,
      active_project_key, execution_token, binding_fingerprint,
      coverage_start, coverage_end, contract_version, currency_code,
      cost_scale, snapshot_content_state, started_at, finished_at,
      next_retry_at, failure_code, created_by_user_id, created_at, updated_at
    ) VALUES (
      'hierarchy-revision', 11, 1, 'MANUAL', 'SUCCEEDED',
      NULL, 'hierarchy-token', 'fixture-fingerprint',
      '2026-07-01', '2026-07-31', 'fixture-v1', 'CNY',
      2, 'DATA', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
      NULL, NULL, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )`
  );
  for (const [index, date, impressions, clicks, cost] of [
    [1, '2026-07-02', '999999999999999999999999', '2', '7'],
    [2, '2026-07-03', '10', '3', '11']
  ]) {
    const common = {
      replacements: { index, date, impressions, clicks, cost }
    };
    await sequelize.query(
      `INSERT INTO baidu_campaign_daily_metrics (
        id, project_id, binding_id, refresh_run_id, metric_date,
        external_account_id, campaign_id, campaign_name,
        impressions_text, clicks_text, cost_amount_scaled_text, created_at
      ) VALUES (
        'campaign-fact-' || :index, 11, 'binding-1', 'hierarchy-revision', :date,
        'account-1', 'campaign-1', '计划一',
        :impressions, :clicks, :cost, CURRENT_TIMESTAMP
      )`,
      common
    );
    await sequelize.query(
      `INSERT INTO baidu_ad_group_daily_metrics (
        id, project_id, binding_id, refresh_run_id, metric_date,
        external_account_id, campaign_id, campaign_name,
        ad_group_id, ad_group_name,
        impressions_text, clicks_text, cost_amount_scaled_text, created_at
      ) VALUES (
        'group-fact-' || :index, 11, 'binding-1', 'hierarchy-revision', :date,
        'account-1', 'campaign-1', '计划一', 'group-1', '单元一',
        :impressions, :clicks, :cost, CURRENT_TIMESTAMP
      )`,
      common
    );
    await sequelize.query(
      `INSERT INTO baidu_keyword_daily_metrics (
        id, project_id, binding_id, refresh_run_id, metric_date,
        external_account_id, campaign_id, campaign_name,
        ad_group_id, ad_group_name, keyword_id, keyword_name, targeting_type,
        impressions_text, clicks_text, cost_amount_scaled_text, created_at
      ) VALUES (
        'keyword-fact-' || :index, 11, 'binding-1', 'hierarchy-revision', :date,
        'account-1', 'campaign-1', '计划一', 'group-1', '单元一',
        'keyword-1', '电子围栏厂家', 'KEYWORD',
        :impressions, :clicks, :cost, CURRENT_TIMESTAMP
      )`,
      common
    );
  }
}

test('ad hierarchy returns one exact strict tree without reading search terms', async (t) => {
  const database = await createMarketingTestDatabase('marketing-ad-hierarchy-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  await seedHierarchy(database.sequelize);
  const statements = [];
  const beforeQuery = database.sequelize.options.logging;
  database.sequelize.options.logging = (statement) => statements.push(statement);
  t.after(() => { database.sequelize.options.logging = beforeQuery; });
  const service = new MarketingAdResourceService({
    sequelize: database.sequelize,
    snapshotSelector: new MarketingSnapshotSelector({
      sequelize: database.sequelize
    })
  });

  const result = await service.readAdHierarchy({
    projectId: '11',
    revision: 'hierarchy-revision',
    from: '2026-07-02',
    to: '2026-07-03'
  });
  assertMarketingOpenApiResponse({
    path: '/api/marketing/projects/{projectId}/ad-hierarchy',
    status: 200,
    payload: result
  });

  assert.equal(result.schemaVersion, 'marketing_ad_hierarchy_v1');
  assert.equal(result.revision, 'hierarchy-revision');
  assert.deepEqual(result.summary, {
    impressions: '1000000000000000000000009',
    clicks: '5',
    costAmountScaled: '18'
  });
  assert.deepEqual(result.hierarchyCounts, {
    campaigns: 1,
    adGroups: 1,
    keywords: 1
  });
  assert.deepEqual(result.campaigns[0].trend, [
    {
      date: '2026-07-02',
      impressions: '999999999999999999999999',
      clicks: '2',
      costAmountScaled: '7'
    },
    {
      date: '2026-07-03',
      impressions: '10',
      clicks: '3',
      costAmountScaled: '11'
    }
  ]);
  assert.equal(result.adGroups[0].campaignName, '计划一');
  assert.equal(result.keywords[0].adGroupName, '单元一');
  assert.equal('searchTerms' in result, false);
  assert.equal(
    statements.some((statement) => statement.includes('baidu_search_term_daily_metrics')),
    false
  );
});

test('ad hierarchy rejects a child whose parent name conflicts in the pinned revision', async (t) => {
  const database = await createMarketingTestDatabase('marketing-ad-hierarchy-invalid-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  await seedHierarchy(database.sequelize);
  await database.sequelize.query(
    `UPDATE baidu_keyword_daily_metrics
     SET ad_group_name = '冲突单元名'
     WHERE keyword_id = 'keyword-1'`
  );
  const service = new MarketingAdResourceService({
    sequelize: database.sequelize,
    snapshotSelector: new MarketingSnapshotSelector({
      sequelize: database.sequelize
    })
  });

  await assert.rejects(
    service.readAdHierarchy({
      projectId: '11',
      revision: 'hierarchy-revision',
      from: '2026-07-02',
      to: '2026-07-03'
    }),
    (error) => error.code === 'MARKETING_SNAPSHOT_UNAVAILABLE'
  );
});

test('ad hierarchy HTTP endpoint authorizes before resolving the pinned revision', async (t) => {
  const calls = [];
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 2, role: 'user' };
    next();
  });
  app.use('/api/marketing', createMarketingDashboardRouter({
    dashboardService: {
      async assertAccess(input) { calls.push(['access', input]); }
    },
    adResourceService: {
      async readAdHierarchy(input) {
        calls.push(['resource', input]);
        return { revision: input.revision, campaigns: [] };
      }
    },
    refreshService: {}
  }));
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/marketing/projects/11/ad-hierarchy?revision=hierarchy-revision&from=2026-07-02&to=2026-07-03`
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, max-age=60');
  assert.equal(response.headers.get('vary'), 'Authorization');
  assert.deepEqual(calls, [
    ['access', {
      projectId: '11',
      user: { id: 2, role: 'user' }
    }],
    ['resource', {
      projectId: '11',
      revision: 'hierarchy-revision',
      from: '2026-07-02',
      to: '2026-07-03'
    }]
  ]);
});
