const assert = require('node:assert/strict');
const http = require('node:http');
const { performance } = require('node:perf_hooks');
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

async function seedKeywordRevision(sequelize) {
  await sequelize.query(
    `INSERT INTO baidu_marketing_refresh_runs (
      id, project_id, project_run_sequence, trigger_type, status,
      active_project_key, execution_token, binding_fingerprint,
      coverage_start, coverage_end, contract_version, currency_code,
      cost_scale, snapshot_content_state, started_at, finished_at,
      next_retry_at, failure_code, created_by_user_id, created_at, updated_at
    ) VALUES (
      'keyword-revision', 11, 1, 'MANUAL', 'SUCCEEDED',
      NULL, 'keyword-token', 'fixture-fingerprint',
      '2026-07-01', '2026-07-31', 'fixture-v1', 'CNY',
      2, 'DATA', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
      NULL, NULL, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )`
  );
  const rows = [
    ['2026-07-02', 'keyword-a', '电子围栏厂家', '999999999999999999999999', '2', '7'],
    ['2026-07-03', 'keyword-a', '电子围栏厂家', '10', '3', '11'],
    ['2026-07-03', 'keyword-b', '周界报警系统', '99', '4', '13'],
    ['2026-07-03', 'keyword-c', '振动光纤价格', '99', '5', '17']
  ];
  for (const [index, row] of rows.entries()) {
    await sequelize.query(
      `INSERT INTO baidu_keyword_daily_metrics (
        id, project_id, binding_id, refresh_run_id, metric_date,
        external_account_id, campaign_id, campaign_name,
        ad_group_id, ad_group_name, impressions_text, clicks_text,
        cost_amount_scaled_text, keyword_id, keyword_name,
        targeting_type, created_at
      ) VALUES (
        :id, 11, 'binding-1', 'keyword-revision', :metricDate,
        'account-1', 'campaign-1', '计划一',
        'group-1', '单元一', :impressions, :clicks,
        :cost, :keywordId, :keywordName, 'KEYWORD', CURRENT_TIMESTAMP
      )`,
      {
        replacements: {
          id: `keyword-fact-${index}`,
          metricDate: row[0],
          keywordId: row[1],
          keywordName: row[2],
          impressions: row[3],
          clicks: row[4],
          cost: row[5]
        }
      }
    );
  }
}

test('keyword resource keeps exact full-filter summary across stable pages', async (t) => {
  const database = await createMarketingTestDatabase('marketing-keywords-resource-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  await seedKeywordRevision(database.sequelize);
  const service = new MarketingAdResourceService({
    sequelize: database.sequelize,
    snapshotSelector: new MarketingSnapshotSelector({
      sequelize: database.sequelize
    })
  });

  const firstPage = await service.readKeywords({
    projectId: '11',
    revision: 'keyword-revision',
    from: '2026-07-02',
    to: '2026-07-03',
    page: '1',
    pageSize: '2',
    sortBy: 'impressions',
    sortOrder: 'descend'
  });
  assertMarketingOpenApiResponse({
    path: '/api/marketing/projects/{projectId}/keywords',
    status: 200,
    payload: firstPage
  });
  assert.equal(firstPage.schemaVersion, 'marketing_keywords_v1');
  assert.equal(firstPage.revision, 'keyword-revision');
  assert.deepEqual(firstPage.summary, {
    impressions: '1000000000000000000000207',
    clicks: '14',
    costAmountScaled: '48'
  });
  assert.deepEqual(firstPage.pagination, {
    page: 1,
    pageSize: 2,
    totalItems: 3,
    totalPages: 2
  });
  assert.deepEqual(firstPage.items.map((item) => ({
    keywordId: item.keywordId,
    keywordName: item.keywordName,
    impressions: item.impressions
  })), [
    {
      keywordId: 'keyword-a',
      keywordName: '电子围栏厂家',
      impressions: '1000000000000000000000009'
    },
    {
      keywordId: 'keyword-b',
      keywordName: '周界报警系统',
      impressions: '99'
    }
  ]);
  assert.deepEqual(firstPage.items[0].trend, [
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

  const secondPage = await service.readKeywords({
    projectId: '11',
    revision: 'keyword-revision',
    from: '2026-07-02',
    to: '2026-07-03',
    page: '2',
    pageSize: '2',
    sortBy: 'impressions',
    sortOrder: 'descend'
  });
  assert.deepEqual(secondPage.summary, firstPage.summary);
  assert.deepEqual(secondPage.items.map((item) => item.keywordId), ['keyword-c']);

  const filtered = await service.readKeywords({
    projectId: '11',
    revision: 'keyword-revision',
    from: '2026-07-02',
    to: '2026-07-03',
    query: '周界',
    campaignId: 'campaign-1',
    adGroupId: 'group-1'
  });
  assert.equal(filtered.pagination.totalItems, 1);
  assert.deepEqual(filtered.summary, {
    impressions: '99',
    clicks: '4',
    costAmountScaled: '13'
  });
  assert.deepEqual(filtered.filter, {
    from: '2026-07-02',
    to: '2026-07-03',
    query: '周界',
    campaignId: 'campaign-1',
    adGroupId: 'group-1'
  });
  assert.deepEqual(filtered.items.map((item) => item.keywordId), ['keyword-b']);
  assert.equal('searchTerms' in filtered, false);

  for (const [suffix, keywordId, keywordName, cost] of [
    ['a', 'ratio-a', '精确比率甲', '9007199254740992'],
    ['b', 'ratio-b', '精确比率乙', '9007199254740993']
  ]) {
    await database.sequelize.query(
      `INSERT INTO baidu_keyword_daily_metrics (
        id, project_id, binding_id, refresh_run_id, metric_date,
        external_account_id, campaign_id, campaign_name,
        ad_group_id, ad_group_name, impressions_text, clicks_text,
        cost_amount_scaled_text, keyword_id, keyword_name,
        targeting_type, created_at
      ) VALUES (
        :id, 11, 'binding-1', 'keyword-revision', '2026-07-03',
        'account-1', 'campaign-1', '计划一',
        'group-1', '单元一', '1', '1',
        :cost, :keywordId, :keywordName, 'KEYWORD', CURRENT_TIMESTAMP
      )`,
      {
        replacements: {
          id: `keyword-ratio-${suffix}`,
          cost,
          keywordId,
          keywordName
        }
      }
    );
  }
  const exactRatioOrder = await service.readKeywords({
    projectId: '11',
    revision: 'keyword-revision',
    from: '2026-07-02',
    to: '2026-07-03',
    page: '1',
    pageSize: '2',
    sortBy: 'averageCpc',
    sortOrder: 'descend'
  });
  assert.deepEqual(
    exactRatioOrder.items.map((item) => item.keywordId),
    ['ratio-b', 'ratio-a']
  );
});

test('SQLite exact CPC sorting stays bounded for one thousand keyword identities', async (t) => {
  const database = await createMarketingTestDatabase('marketing-keywords-scale-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  await seedKeywordRevision(database.sequelize);
  await database.sequelize.query(
    `WITH RECURSIVE seq(x) AS (
       SELECT 1 UNION ALL SELECT x + 1 FROM seq WHERE x < 1000
     )
     INSERT INTO baidu_keyword_daily_metrics (
       id, project_id, binding_id, refresh_run_id, metric_date,
       external_account_id, campaign_id, campaign_name,
       ad_group_id, ad_group_name, impressions_text, clicks_text,
       cost_amount_scaled_text, keyword_id, keyword_name,
       targeting_type, created_at
     )
     SELECT
       'scale-fact-' || x, 11, 'binding-1', 'keyword-revision', '2026-07-03',
       'account-1', 'campaign-1', '计划一', 'group-1', '单元一',
       CAST((x % 997) + 1 AS TEXT), CAST((x % 97) + 1 AS TEXT),
       '900719925474099' || printf('%04d', x),
       'scale-keyword-' || printf('%04d', x), '规模关键词 ' || x,
       'KEYWORD', CURRENT_TIMESTAMP
     FROM seq`
  );
  const service = new MarketingAdResourceService({
    sequelize: database.sequelize,
    snapshotSelector: new MarketingSnapshotSelector({
      sequelize: database.sequelize
    })
  });
  const startedAt = performance.now();
  const result = await service.readKeywords({
    projectId: '11',
    revision: 'keyword-revision',
    from: '2026-07-02',
    to: '2026-07-03',
    page: '1',
    pageSize: '50',
    sortBy: 'averageCpc',
    sortOrder: 'descend'
  });
  const durationMs = performance.now() - startedAt;
  assert.equal(result.pagination.totalItems, 1003);
  assert.equal(result.items.length, 50);
  assert.ok(durationMs < 5_000, `1000-keyword exact sort took ${durationMs}ms`);
});

test('SQLite exact ratio sorting rejects an unbounded keyword identity set', async (t) => {
  const database = await createMarketingTestDatabase('marketing-keywords-ratio-limit-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  await seedKeywordRevision(database.sequelize);
  await database.sequelize.query(
    `WITH RECURSIVE seq(x) AS (
       SELECT 1 UNION ALL SELECT x + 1 FROM seq WHERE x <= 100
     )
     INSERT INTO baidu_keyword_daily_metrics (
       id, project_id, binding_id, refresh_run_id, metric_date,
       external_account_id, campaign_id, campaign_name,
       ad_group_id, ad_group_name, impressions_text, clicks_text,
       cost_amount_scaled_text, keyword_id, keyword_name,
       targeting_type, created_at
     )
     SELECT
       'limit-fact-' || left_seq.x || '-' || right_seq.x,
       11, 'binding-1', 'keyword-revision', '2026-07-03',
       'account-1', 'campaign-1', '计划一', 'group-1', '单元一',
       '1', '1', '1',
       'limit-keyword-' || left_seq.x || '-' || right_seq.x,
       '规模关键词 ' || left_seq.x || '-' || right_seq.x,
       'KEYWORD', CURRENT_TIMESTAMP
     FROM seq left_seq CROSS JOIN seq right_seq`
  );
  const service = new MarketingAdResourceService({
    sequelize: database.sequelize,
    snapshotSelector: new MarketingSnapshotSelector({
      sequelize: database.sequelize
    })
  });

  await assert.rejects(
    service.readKeywords({
      projectId: '11',
      revision: 'keyword-revision',
      from: '2026-07-02',
      to: '2026-07-03',
      sortBy: 'averageCpc',
      sortOrder: 'descend'
    }),
    {
      code: 'MARKETING_AD_RESOURCE_SORT_SCOPE_TOO_LARGE',
      status: 422,
      message: '精确比率排序范围过大，请缩小关键词筛选范围'
    }
  );
});

test('SQLite exact ratio sorting enforces its 2k identity and 5k fact budgets', async (t) => {
  const database = await createMarketingTestDatabase('marketing-keywords-ratio-budgets-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  await seedKeywordRevision(database.sequelize);
  await database.sequelize.query(
    `WITH RECURSIVE identities(x) AS (
       SELECT 1 UNION ALL SELECT x + 1 FROM identities WHERE x < 2000
     )
     INSERT INTO baidu_keyword_daily_metrics (
       id, project_id, binding_id, refresh_run_id, metric_date,
       external_account_id, campaign_id, campaign_name,
       ad_group_id, ad_group_name, impressions_text, clicks_text,
       cost_amount_scaled_text, keyword_id, keyword_name,
       targeting_type, created_at
     )
     SELECT
       'identity-budget-' || x, 11, 'binding-1', 'keyword-revision', '2026-07-03',
       'account-1', 'campaign-1', '计划一', 'group-1', '单元一',
       CAST((x % 997) + 1 AS TEXT), CAST((x % 97) + 1 AS TEXT),
       CAST(9007199254740000 + x AS TEXT),
       'identity-budget-' || x, '实体边界 ' || x,
       'KEYWORD', CURRENT_TIMESTAMP
     FROM identities`
  );
  await database.sequelize.query(
    `WITH RECURSIVE identities(x) AS (
       SELECT 1 UNION ALL SELECT x + 1 FROM identities WHERE x < 1000
     ), days(day) AS (
       SELECT 0 UNION ALL SELECT day + 1 FROM days WHERE day < 4
     )
     INSERT INTO baidu_keyword_daily_metrics (
       id, project_id, binding_id, refresh_run_id, metric_date,
       external_account_id, campaign_id, campaign_name,
       ad_group_id, ad_group_name, impressions_text, clicks_text,
       cost_amount_scaled_text, keyword_id, keyword_name,
       targeting_type, created_at
     )
     SELECT
       'fact-budget-' || x || '-' || day,
       11, 'binding-1', 'keyword-revision', date('2026-07-01', '+' || day || ' day'),
       'account-1', 'campaign-1', '计划一', 'group-1', '单元一',
       '10', '2', '7', 'fact-budget-' || x, '事实边界 ' || x,
       'KEYWORD', CURRENT_TIMESTAMP
     FROM identities CROSS JOIN days`
  );
  const service = new MarketingAdResourceService({
    sequelize: database.sequelize,
    snapshotSelector: new MarketingSnapshotSelector({
      sequelize: database.sequelize
    })
  });

  for (const [query, totalItems] of [
    ['实体边界', 2000],
    ['事实边界', 1000]
  ]) {
    const readBoundary = () => service.readKeywords({
      projectId: '11',
      revision: 'keyword-revision',
      from: '2026-07-01',
      to: '2026-07-05',
      query,
      pageSize: '50',
      sortBy: 'averageCpc',
      sortOrder: 'descend'
    });
    assert.equal((await readBoundary()).pagination.totalItems, totalItems);
    const durations = [];
    for (let sample = 0; sample < 3; sample += 1) {
      const startedAt = performance.now();
      const result = await readBoundary();
      durations.push(performance.now() - startedAt);
      assert.equal(result.pagination.totalItems, totalItems);
    }
    durations.sort((left, right) => left - right);
    const p95Ms = durations[Math.ceil(durations.length * 0.95) - 1];
    assert.ok(p95Ms < 750, `${query} boundary sort P95 took ${p95Ms}ms`);
  }

  await database.sequelize.query(
    `INSERT INTO baidu_keyword_daily_metrics (
      id, project_id, binding_id, refresh_run_id, metric_date,
      external_account_id, campaign_id, campaign_name,
      ad_group_id, ad_group_name, impressions_text, clicks_text,
      cost_amount_scaled_text, keyword_id, keyword_name,
      targeting_type, created_at
    ) VALUES (
      'fact-budget-overflow', 11, 'binding-1', 'keyword-revision', '2026-07-06',
      'account-1', 'campaign-1', '计划一', 'group-1', '单元一',
      '1', '1', '1', 'fact-budget-1', '事实边界 1',
      'KEYWORD', CURRENT_TIMESTAMP
    )`
  );
  await assert.rejects(
    service.readKeywords({
      projectId: '11',
      revision: 'keyword-revision',
      from: '2026-07-01',
      to: '2026-07-06',
      query: '事实边界',
      sortBy: 'averageCpc',
      sortOrder: 'descend'
    }),
    { code: 'MARKETING_AD_RESOURCE_SORT_SCOPE_TOO_LARGE', status: 422 }
  );
});

test('keyword HTTP endpoint authorizes before forwarding allowlisted query fields', async (t) => {
  const calls = [];
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 2, role: 'user' };
    next();
  });
  app.use('/api/marketing', createMarketingDashboardRouter({
    dashboardService: {
      async assertAccess(input) {
        calls.push(['access', input]);
      }
    },
    adResourceService: {
      async readKeywords(input) {
        calls.push(['resource', input]);
        return { revision: input.revision, items: [] };
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
    `http://127.0.0.1:${server.address().port}/api/marketing/projects/11/keywords?revision=keyword-revision&from=2026-07-02&to=2026-07-03&page=2&pageSize=20&sortBy=clicks&sortOrder=ascend&query=%E5%91%A8%E7%95%8C&campaignId=c&adGroupId=g`
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
      revision: 'keyword-revision',
      from: '2026-07-02',
      to: '2026-07-03',
      page: '2',
      pageSize: '20',
      sortBy: 'clicks',
      sortOrder: 'ascend',
      query: '周界',
      campaignId: 'c',
      adGroupId: 'g'
    }]
  ]);
});
