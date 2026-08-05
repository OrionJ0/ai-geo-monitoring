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

async function seedRun(sequelize, {
  id,
  projectId = 11,
  sequence,
  contentState = 'DATA',
  rows = []
}) {
  await sequelize.query(
    `INSERT INTO baidu_marketing_refresh_runs (
      id, project_id, project_run_sequence, trigger_type, status,
      active_project_key, execution_token, binding_fingerprint,
      coverage_start, coverage_end, contract_version, currency_code,
      cost_scale, snapshot_content_state, started_at, finished_at,
      next_retry_at, failure_code, created_by_user_id, created_at, updated_at
    ) VALUES (
      :id, :projectId, :sequence, 'MANUAL', 'SUCCEEDED',
      NULL, :executionToken, 'fixture-fingerprint',
      '2026-07-01', '2026-07-31', 'fixture-v1', 'CNY',
      2, :contentState, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
      NULL, NULL, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )`,
    {
      replacements: {
        id,
        projectId,
        sequence,
        executionToken: `token-${id}`,
        contentState
      }
    }
  );
  for (const [index, row] of rows.entries()) {
    await sequelize.query(
      `INSERT INTO baidu_search_term_daily_metrics (
        id, project_id, binding_id, refresh_run_id, metric_date,
        external_account_id, campaign_id, campaign_name,
        ad_group_id, ad_group_name, impressions_text, clicks_text,
        cost_amount_scaled_text, keyword_name, search_term,
        search_term_key, query_status, match_type, created_at
      ) VALUES (
        :id, :projectId, 'binding-1', :runId, :metricDate,
        :accountId, :campaignId, :campaignName,
        :adGroupId, :adGroupName, :impressions, :clicks,
        :cost, :keywordName, :searchTerm,
        :searchTermKey, :queryStatus, :matchType, CURRENT_TIMESTAMP
      )`,
      {
        replacements: {
          id: `${id}-term-${index}`,
          projectId,
          runId: id,
          metricDate: row.metricDate,
          accountId: row.accountId || 'account-1',
          campaignId: row.campaignId || 'campaign-1',
          campaignName: row.campaignName || '计划一',
          adGroupId: row.adGroupId || 'group-1',
          adGroupName: row.adGroupName || '单元一',
          impressions: row.impressions,
          clicks: row.clicks,
          cost: row.cost,
          keywordName: row.keywordName,
          searchTerm: row.searchTerm,
          searchTermKey: row.searchTermKey,
          queryStatus: row.queryStatus || 'NOT_ADDED',
          matchType: row.matchType || 'PHRASE'
        }
      }
    );
  }
}

function createService(sequelize) {
  return new MarketingAdResourceService({
    sequelize,
    snapshotSelector: new MarketingSnapshotSelector({ sequelize })
  });
}

test('search-term resource pins an old revision and keeps exact database pagination', async (t) => {
  const database = await createMarketingTestDatabase('marketing-terms-resource-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  await seedRun(database.sequelize, {
    id: 'old-revision',
    sequence: 1,
    rows: [
      {
        metricDate: '2026-07-02',
        keywordName: '周界报警',
        searchTerm: '甲搜索词',
        searchTermKey: 'a',
        impressions: '999999999999999999999999',
        clicks: '2',
        cost: '7'
      },
      {
        metricDate: '2026-07-03',
        keywordName: '周界报警',
        searchTerm: '甲搜索词',
        searchTermKey: 'a',
        impressions: '10',
        clicks: '3',
        cost: '11'
      },
      {
        metricDate: '2026-07-03',
        keywordName: '周界报警',
        searchTerm: '乙搜索词',
        searchTermKey: 'b',
        impressions: '99',
        clicks: '4',
        cost: '13',
        queryStatus: 'ADDED',
        matchType: 'EXACT'
      },
      {
        metricDate: '2026-07-03',
        keywordName: '周界报警',
        searchTerm: '丙搜索词',
        searchTermKey: 'c',
        impressions: '99',
        clicks: '5',
        cost: '17'
      }
    ]
  });
  await seedRun(database.sequelize, {
    id: 'new-revision',
    sequence: 2,
    rows: [{
      metricDate: '2026-07-03',
      keywordName: '新关键词',
      searchTerm: '新快照搜索词',
      searchTermKey: 'new',
      impressions: '1',
      clicks: '1',
      cost: '1'
    }]
  });

  const service = createService(database.sequelize);
  const result = await service.readSearchTerms({
    projectId: '11',
    revision: 'old-revision',
    from: '2026-07-02',
    to: '2026-07-03',
    keywordName: '周界报警',
    page: '1',
    pageSize: '2',
    sortBy: 'impressions',
    sortOrder: 'descend'
  });

  assert.equal(result.schemaVersion, 'marketing_search_terms_v1');
  assert.equal(result.revision, 'old-revision');
  assert.deepEqual(result.coverage, {
    from: '2026-07-01',
    to: '2026-07-31',
    lastSuccessfulAt: result.coverage.lastSuccessfulAt,
    currency: 'CNY',
    costScale: 2
  });
  assert.deepEqual(result.filter, {
    from: '2026-07-02',
    to: '2026-07-03'
  });
  assert.deepEqual(result.summary, {
    impressions: '1000000000000000000000207',
    clicks: '14',
    costAmountScaled: '48'
  });
  assert.deepEqual(result.pagination, {
    page: 1,
    pageSize: 2,
    totalItems: 3,
    totalPages: 2
  });
  assert.deepEqual(result.items.map((item) => ({
    searchTerm: item.searchTerm,
    impressions: item.impressions,
    clicks: item.clicks,
    costAmountScaled: item.costAmountScaled
  })), [
    {
      searchTerm: '甲搜索词',
      impressions: '1000000000000000000000009',
      clicks: '5',
      costAmountScaled: '18'
    },
    {
      searchTerm: '乙搜索词',
      impressions: '99',
      clicks: '4',
      costAmountScaled: '13'
    }
  ]);
  assert.equal(result.items.some((item) => 'keywordId' in item), false);
  assert.deepEqual(result.items[0].trend, [
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

  const emptyPage = await service.readSearchTerms({
    projectId: '11',
    revision: 'old-revision',
    from: '2026-07-02',
    to: '2026-07-03',
    page: '3',
    pageSize: '2'
  });
  assert.deepEqual(emptyPage.items, []);
  assert.equal(emptyPage.pagination.totalItems, 3);
});

test('search-term resource distinguishes revision and coverage errors', async (t) => {
  const database = await createMarketingTestDatabase('marketing-terms-errors-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  await seedRun(database.sequelize, {
    id: 'available-revision',
    sequence: 1,
    rows: []
  });
  await seedRun(database.sequelize, {
    id: 'unavailable-revision',
    sequence: 2,
    contentState: 'NONE',
    rows: []
  });
  const service = createService(database.sequelize);

  await assert.rejects(
    service.readSearchTerms({ projectId: '11' }),
    { code: 'MARKETING_REVISION_REQUIRED', status: 400 }
  );
  await assert.rejects(
    service.readSearchTerms({
      projectId: '11',
      revision: 'missing-revision'
    }),
    { code: 'MARKETING_REVISION_NOT_FOUND', status: 404 }
  );
  await assert.rejects(
    service.readSearchTerms({
      projectId: '11',
      revision: 'unavailable-revision'
    }),
    { code: 'MARKETING_SNAPSHOT_UNAVAILABLE', status: 409 }
  );
  await assert.rejects(
    service.readSearchTerms({
      projectId: '11',
      revision: 'available-revision',
      from: '2026-06-30',
      to: '2026-07-02'
    }),
    { code: 'DASHBOARD_DATE_OUT_OF_RANGE', status: 422 }
  );
  await assert.rejects(
    service.readSearchTerms({
      projectId: '11',
      revision: 'available-revision',
      pageSize: '201'
    }),
    { code: 'MARKETING_AD_RESOURCE_QUERY_INVALID', status: 400 }
  );
  await assert.rejects(
    service.readSearchTerms({
      projectId: '11',
      revision: 'available-revision',
      campaignId: 'x'.repeat(513)
    }),
    { code: 'MARKETING_AD_RESOURCE_QUERY_INVALID', status: 400 }
  );
});

test('search-term HTTP endpoint authorizes before resolving revision', async (t) => {
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
        if (input.projectId === '12') {
          throw Object.assign(new Error('无权查看该项目'), {
            code: 'PROJECT_FORBIDDEN',
            status: 403
          });
        }
      }
    },
    adResourceService: {
      async readSearchTerms(input) {
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
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const allowed = await fetch(
    `${baseUrl}/api/marketing/projects/11/search-terms?revision=old-revision&from=2026-07-02&to=2026-07-03&page=2&pageSize=20&sortBy=searchTerm&sortOrder=ascend&query=%E5%8E%82%E5%AE%B6&accountId=a&campaignId=c&adGroupId=g&keywordName=k&queryStatus=ADDED&matchType=EXACT`
  );
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('cache-control'), 'private, max-age=60');
  assert.equal(allowed.headers.get('vary'), 'Authorization');
  assert.deepEqual(await allowed.json(), {
    revision: 'old-revision',
    items: []
  });
  assert.deepEqual(calls, [
    ['access', {
      projectId: '11',
      user: { id: 2, role: 'user' }
    }],
    ['resource', {
      projectId: '11',
      revision: 'old-revision',
      from: '2026-07-02',
      to: '2026-07-03',
      page: '2',
      pageSize: '20',
      sortBy: 'searchTerm',
      sortOrder: 'ascend',
      query: '厂家',
      accountId: 'a',
      campaignId: 'c',
      adGroupId: 'g',
      keywordName: 'k',
      queryStatus: 'ADDED',
      matchType: 'EXACT'
    }]
  ]);

  const forbidden = await fetch(
    `${baseUrl}/api/marketing/projects/12/search-terms?revision=secret-revision`
  );
  assert.equal(forbidden.status, 403);
  assert.deepEqual(await forbidden.json(), {
    error: {
      code: 'PROJECT_FORBIDDEN',
      message: '无权查看该项目'
    }
  });
  assert.equal(calls.filter(([type]) => type === 'resource').length, 1);
});
