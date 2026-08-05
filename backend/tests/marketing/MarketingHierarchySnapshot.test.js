const assert = require('node:assert/strict');
const test = require('node:test');
const { QueryTypes } = require('sequelize');

const {
  MarketingDashboardService
} = require('../../modules/marketing/services/MarketingDashboardService');
const {
  MarketingAdResourceService
} = require('../../modules/marketing/services/MarketingAdResourceService');
const {
  MarketingRefreshService
} = require('../../modules/marketing/services/MarketingRefreshService');
const {
  MarketingSnapshotSelector
} = require('../../modules/marketing/services/MarketingSnapshotSelector');
const {
  BaiduBindingService
} = require('../../modules/marketing/services/BaiduBindingService');
const {
  createMarketingTestDatabase,
  seedConnectionAndBinding
} = require('./helpers/createMarketingTestDatabase');

function completeReportSet(binding, campaignName = '计划甲') {
  const common = {
    accountId: binding.accountId,
    campaignId: '101',
    campaignName,
    metricDate: '2026-07-29',
    impressions: '10',
    clicks: '2',
    costAmountScaled: '350'
  };
  const adGroup = {
    ...common,
    adGroupId: '201',
    adGroupName: '单元甲'
  };
  return {
    campaigns: [common],
    adGroups: [adGroup],
    keywords: [{
      ...adGroup,
      keywordId: '301',
      keywordName: '周界报警系统',
      targetingType: 'KEYWORD'
    }],
    searchTerms: [{
      ...adGroup,
      keywordName: '周界报警系统',
      searchTerm: '周界报警系统厂家',
      queryStatus: 'NOT_ADDED',
      matchType: 'PHRASE'
    }]
  };
}

test('one refresh commits campaign, ad group, keyword and search-term facts atomically', async (t) => {
  const database = await createMarketingTestDatabase('marketing-hierarchy-refresh-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize, {
    accountId: '1234'
  });
  const service = new MarketingRefreshService({
    sequelize: database.sequelize,
    reportProvider: {
      async fetchSearchReports({ binding }) {
        return completeReportSet(binding);
      }
    },
    contractVersion: 'fixture-contract-v1',
    currencyCode: 'CNY',
    costScale: 2,
    clock: () => Date.parse('2026-07-30T04:00:00.000Z')
  });

  const run = await service.createRun({
    projectId: 11,
    triggerType: 'MANUAL',
    userId: 2
  });
  const completed = await service.executeRun(run.runId);

  assert.equal(completed.status, 'SUCCEEDED');
  for (const table of [
    'baidu_campaign_daily_metrics',
    'baidu_ad_group_daily_metrics',
    'baidu_keyword_daily_metrics',
    'baidu_search_term_daily_metrics'
  ]) {
    const [rows] = await database.sequelize.query(
      `SELECT * FROM ${table}`
    );
    assert.equal(rows.length, 1, table);
    assert.equal(rows[0].refresh_run_id, run.runId, table);
  }
  const [terms] = await database.sequelize.query(
    `SELECT search_term, search_term_key
     FROM baidu_search_term_daily_metrics`
  );
  assert.equal(terms[0].search_term, '周界报警系统厂家');
  assert.match(terms[0].search_term_key, /^[0-9a-f]{64}$/u);

  const dashboard = await new MarketingDashboardService({
    sequelize: database.sequelize,
    clock: () => Date.parse('2026-07-30T04:01:00.000Z')
  }).read({ projectId: 11 });
  assert.deepEqual(dashboard.hierarchyCounts, {
    campaigns: 1,
    adGroups: 1,
    keywords: 1,
    searchTerms: 1
  });
  assert.equal(dashboard.schemaVersion, 'marketing_dashboard_v2');
  for (const field of ['campaigns', 'adGroups', 'keywords', 'searchTerms']) {
    assert.equal(field in dashboard, false, `dashboard must omit ${field}`);
  }
});

test('a page keeps reading its pinned revision after the next refresh succeeds', async (t) => {
  const database = await createMarketingTestDatabase('marketing-pinned-refresh-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize, { accountId: '1234' });
  let campaignName = '旧快照';
  let now = Date.parse('2026-07-30T04:00:00.000Z');
  const refresh = new MarketingRefreshService({
    sequelize: database.sequelize,
    reportProvider: {
      async fetchSearchReports({ binding }) {
        return completeReportSet(binding, campaignName);
      }
    },
    contractVersion: 'fixture-contract-v1',
    currencyCode: 'CNY',
    costScale: 2,
    clock: () => now
  });
  const firstRun = await refresh.createRun({
    projectId: 11,
    triggerType: 'MANUAL',
    userId: 2
  });
  await refresh.executeRun(firstRun.runId);

  const dashboard = await new MarketingDashboardService({
    sequelize: database.sequelize,
    clock: () => now
  }).read({ projectId: 11 });
  assert.equal(dashboard.revision, firstRun.runId);

  campaignName = '新快照';
  now += 60 * 1000;
  const secondRun = await refresh.createRun({
    projectId: 11,
    triggerType: 'MANUAL',
    userId: 2
  });
  await refresh.executeRun(secondRun.runId);

  const resources = new MarketingAdResourceService({
    sequelize: database.sequelize,
    snapshotSelector: new MarketingSnapshotSelector({
      sequelize: database.sequelize
    })
  });
  const input = {
    projectId: 11,
    revision: dashboard.revision,
    from: dashboard.coverage.from,
    to: dashboard.coverage.to
  };
  const [hierarchy, keywords, searchTerms] = await Promise.all([
    resources.readAdHierarchy(input),
    resources.readKeywords(input),
    resources.readSearchTerms(input)
  ]);

  assert.equal(hierarchy.campaigns[0].campaignName, '旧快照');
  assert.equal(keywords.items[0].campaignName, '旧快照');
  assert.equal(searchTerms.items[0].campaignName, '旧快照');
  assert.equal(hierarchy.revision, firstRun.runId);
  assert.equal(keywords.revision, firstRun.runId);
  assert.equal(searchTerms.revision, firstRun.runId);

  const secondDashboard = await new MarketingDashboardService({
    sequelize: database.sequelize,
    clock: () => now
  }).read({ projectId: 11 });
  assert.equal(secondDashboard.revision, secondRun.runId);

  campaignName = '第三快照';
  now += 60 * 1000;
  const thirdRun = await refresh.createRun({
    projectId: 11,
    triggerType: 'MANUAL',
    userId: 2
  });
  await refresh.executeRun(thirdRun.runId);

  const previous = await resources.readAdHierarchy({
    ...input,
    revision: secondRun.runId
  });
  assert.equal(previous.campaigns[0].campaignName, '新快照');
  await assert.rejects(
    resources.readAdHierarchy(input),
    {
      code: 'MARKETING_SNAPSHOT_UNAVAILABLE',
      status: 409
    }
  );
  const retainedRuns = await database.sequelize.query(
    `SELECT DISTINCT refresh_run_id
     FROM baidu_campaign_daily_metrics
     ORDER BY refresh_run_id`,
    { type: QueryTypes.SELECT }
  );
  assert.deepEqual(
    retainedRuns.map((row) => row.refresh_run_id).sort(),
    [secondRun.runId, thirdRun.runId].sort()
  );
});

test('an unstable verification read fails the run and preserves the complete active revision', async (t) => {
  const database = await createMarketingTestDatabase('marketing-unstable-refresh-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize, { accountId: '1234' });

  const successful = new MarketingRefreshService({
    sequelize: database.sequelize,
    reportProvider: {
      async fetchSearchReports({ binding }) {
        return completeReportSet(binding, '旧快照');
      }
    },
    contractVersion: 'fixture-contract-v1',
    currencyCode: 'CNY',
    costScale: 2,
    clock: () => Date.parse('2026-07-30T04:00:00.000Z')
  });
  const oldRun = await successful.createRun({
    projectId: 11,
    triggerType: 'MANUAL',
    userId: 2
  });
  await successful.executeRun(oldRun.runId);

  const warnings = [];
  const unstable = new MarketingRefreshService({
    sequelize: database.sequelize,
    reportProvider: {
      async fetchSearchReports() {
        const error = new Error('上游快照漂移');
        error.code = 'BAIDU_REPORT_SNAPSHOT_UNSTABLE';
        throw error;
      }
    },
    contractVersion: 'fixture-contract-v1',
    currencyCode: 'CNY',
    costScale: 2,
    clock: () => Date.parse('2026-07-30T04:01:00.000Z'),
    logger: { warn: (entry) => warnings.push(entry) }
  });
  const failedRun = await unstable.createRun({
    projectId: 11,
    triggerType: 'MANUAL',
    userId: 2
  });
  await assert.rejects(
    unstable.executeRun(failedRun.runId),
    { code: 'BAIDU_REPORT_SNAPSHOT_UNSTABLE' }
  );
  assert.deepEqual(
    (await unstable.getRun(11, failedRun.runId)).failure,
    { code: 'BAIDU_REPORT_SNAPSHOT_UNSTABLE' }
  );
  assert.deepEqual(warnings, [{
    event: 'marketing_refresh_failed',
    projectId: '11',
    runId: failedRun.runId,
    coverage: failedRun.coverage,
    failureCode: 'BAIDU_REPORT_SNAPSHOT_UNSTABLE',
    durationMs: 0
  }]);

  for (const table of [
    'baidu_campaign_daily_metrics',
    'baidu_ad_group_daily_metrics',
    'baidu_keyword_daily_metrics',
    'baidu_search_term_daily_metrics'
  ]) {
    const [rows] = await database.sequelize.query(
      `SELECT refresh_run_id FROM ${table}`
    );
    assert.equal(rows.length, 1, table);
    assert.equal(rows[0].refresh_run_id, oldRun.runId, table);
  }

  const dashboard = await new MarketingDashboardService({
    sequelize: database.sequelize,
    clock: () => Date.parse('2026-07-30T04:02:00.000Z')
  }).read({ projectId: 11 });
  assert.equal(dashboard.revision, oldRun.runId);
  assert.deepEqual(dashboard.hierarchyCounts, {
    campaigns: 1,
    adGroups: 1,
    keywords: 1,
    searchTerms: 1
  });
});

test('deleting a binding invalidates retained revisions before facts cascade away', async (t) => {
  const database = await createMarketingTestDatabase('marketing-binding-delete-revision-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize, { accountId: '1234' });
  const refresh = new MarketingRefreshService({
    sequelize: database.sequelize,
    reportProvider: {
      async fetchSearchReports({ binding }) {
        return completeReportSet(binding);
      }
    },
    contractVersion: 'fixture-contract-v1',
    currencyCode: 'CNY',
    costScale: 2,
    clock: () => Date.parse('2026-07-30T04:00:00.000Z')
  });
  const run = await refresh.createRun({
    projectId: 11,
    triggerType: 'MANUAL',
    userId: 2
  });
  await refresh.executeRun(run.runId);
  const selector = new MarketingSnapshotSelector({
    sequelize: database.sequelize
  });
  assert.equal((await selector.selectRevision({
    projectId: 11,
    revision: run.runId
  })).run.id, run.runId);

  await new BaiduBindingService({
    sequelize: database.sequelize,
    accountDirectory: {},
    siteDirectory: {}
  }).deleteBinding({
    projectId: 11,
    bindingId: 'binding-1'
  });

  await assert.rejects(
    selector.selectRevision({ projectId: 11, revision: run.runId }),
    { code: 'MARKETING_SNAPSHOT_UNAVAILABLE', status: 409 }
  );
  const facts = await database.sequelize.query(
    `SELECT id FROM baidu_campaign_daily_metrics
     WHERE refresh_run_id = :revision`,
    {
      replacements: { revision: run.runId },
      type: QueryTypes.SELECT
    }
  );
  assert.deepEqual(facts, []);
});

test('refresh rejects orphan hierarchy rows instead of hiding them in the UI', async (t) => {
  const database = await createMarketingTestDatabase('marketing-hierarchy-orphan-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize, { accountId: '1234' });
  const common = {
    accountId: '1234',
    campaignId: '101',
    campaignName: '计划甲',
    metricDate: '2026-07-29',
    impressions: '10',
    clicks: '2',
    costAmountScaled: '350'
  };
  const service = new MarketingRefreshService({
    sequelize: database.sequelize,
    reportProvider: {
      async fetchSearchReports() {
        return {
          campaigns: [common],
          adGroups: [],
          keywords: [{
            ...common,
            adGroupId: 'missing-ad-group',
            adGroupName: '不存在的单元',
            keywordId: '301',
            keywordName: '周界报警系统',
            targetingType: 'KEYWORD'
          }],
          searchTerms: []
        };
      }
    },
    contractVersion: 'fixture-contract-v1',
    currencyCode: 'CNY',
    costScale: 2,
    clock: () => Date.parse('2026-07-30T04:00:00.000Z')
  });
  const run = await service.createRun({
    projectId: 11,
    triggerType: 'MANUAL',
    userId: 2
  });

  await assert.rejects(
    service.executeRun(run.runId),
    { code: 'REPORT_HIERARCHY_INVALID' }
  );
  const [facts] = await database.sequelize.query(
    'SELECT id FROM baidu_keyword_daily_metrics'
  );
  assert.equal(facts.length, 0);
});
