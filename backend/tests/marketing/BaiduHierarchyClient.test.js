const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BaiduMarketingClient
} = require('../../modules/marketing/adapters/BaiduMarketingClient');
const {
  loadBaiduContract
} = require('../../modules/marketing/contracts/baidu/loadBaiduContract');

const manifest = loadBaiduContract('baidu-marketing-pilot-2026-07-30');

function envelope(row) {
  return envelopeRows([row]);
}

function envelopeRows(rows, totalRowCount = rows.length) {
  return {
    header: { status: 0, failures: [] },
    body: {
      data: [{ rowCount: rows.length, totalRowCount, rows }]
    }
  };
}

const rowsByType = {
  2290316: {
    date: '2026-08-03',
    userName: '脱敏搜索账户',
    userId: 1234,
    campaignId: 101,
    campaignNameStatus: '计划甲',
    impression: 100,
    click: 8,
    cost: 12.34
  },
  2284618: {
    date: '2026-08-03',
    userName: '脱敏搜索账户',
    userId: 1234,
    campaignId: 101,
    campaignNameStatus: '计划甲',
    adGroupId: 201,
    adGroupNameStatus: '单元甲',
    impression: 80,
    click: 6,
    cost: 10.2
  },
  2602783: {
    date: '2026-08-03',
    userName: '脱敏搜索账户',
    userId: 1234,
    campaignId: 101,
    campaignNameStatus: '计划甲',
    adGroupId: 201,
    adGroupNameStatus: '单元甲',
    winfoIdTypeEnum: 0,
    wInfoId: 301,
    wInfoNameStatus: '周界报警系统',
    impression: 50,
    click: 4,
    cost: 8.75
  },
  2307838: {
    date: '2026-08-03',
    userName: '脱敏搜索账户',
    userId: 1234,
    campaignId: 101,
    campaignNameStatus: '计划甲',
    adGroupId: 201,
    adGroupNameStatus: '单元甲',
    wInfoNameStatus: '周界报警系统',
    queryWord: '周界报警系统厂家',
    queryStatusName: 1,
    wMatchId: 31,
    impression: 20,
    click: 2,
    cost: 5.5
  }
};

test('client reads and validates every documented SEARCH hierarchy report', async () => {
  const reportTypes = [];
  const client = new BaiduMarketingClient({
    manifest,
    appId: 'app-id-fixture',
    secretKey: '0123456789abcdef-secret-key-fixture',
    scope: 'search-report-read-fixture',
    redirectUri: 'https://example.test/oauth/callback',
    timeoutMs: 10000,
    transport: async (request) => {
      const reportType = request.json.body.reportType;
      reportTypes.push(reportType);
      return envelope(rowsByType[reportType]);
    }
  });

  const reports = await client.fetchSearchReports({
    binding: {
      accountId: '1234',
      accountName: '脱敏搜索账户'
    },
    accessToken: 'access-token-fixture',
    coverage: { from: '2026-07-05', to: '2026-08-03' }
  });

  assert.deepEqual(reportTypes, [
    2290316, 2284618, 2602783, 2307838,
    2290316, 2284618, 2602783, 2307838
  ]);
  assert.equal(reports.campaigns[0].campaignId, '101');
  assert.deepEqual(reports.adGroups[0], {
    accountId: '1234',
    campaignId: '101',
    campaignName: '计划甲',
    adGroupId: '201',
    adGroupName: '单元甲',
    metricDate: '2026-08-03',
    impressions: '80',
    clicks: '6',
    costAmountScaled: '1020'
  });
  assert.deepEqual(reports.keywords[0], {
    accountId: '1234',
    campaignId: '101',
    campaignName: '计划甲',
    adGroupId: '201',
    adGroupName: '单元甲',
    keywordId: '301',
    keywordName: '周界报警系统',
    targetingType: 'KEYWORD',
    metricDate: '2026-08-03',
    impressions: '50',
    clicks: '4',
    costAmountScaled: '875'
  });
  assert.deepEqual(reports.searchTerms[0], {
    accountId: '1234',
    campaignId: '101',
    campaignName: '计划甲',
    adGroupId: '201',
    adGroupName: '单元甲',
    keywordName: '周界报警系统',
    searchTerm: '周界报警系统厂家',
    queryStatus: 'NOT_ADDED',
    matchType: 'PHRASE',
    metricDate: '2026-08-03',
    impressions: '20',
    clicks: '2',
    costAmountScaled: '550'
  });
  assert.equal(
    Object.hasOwn(reports.searchTerms[0], 'keywordId'),
    false
  );
});

test('client rejects a SEARCH hierarchy that changes between verification reads', async () => {
  let calls = 0;
  const client = new BaiduMarketingClient({
    manifest,
    appId: 'app-id-fixture',
    secretKey: '0123456789abcdef-secret-key-fixture',
    scope: 'search-report-read-fixture',
    redirectUri: 'https://example.test/oauth/callback',
    timeoutMs: 10000,
    transport: async (request) => {
      calls += 1;
      const reportType = request.json.body.reportType;
      return envelope({
        ...rowsByType[reportType],
        ...(calls > 4 && reportType === 2602783 ? { click: 5 } : {})
      });
    }
  });

  await assert.rejects(
    client.fetchSearchReports({
      binding: {
        accountId: '1234',
        accountName: '脱敏搜索账户'
      },
      accessToken: 'access-token-fixture',
      coverage: { from: '2026-07-05', to: '2026-08-03' }
    }),
    { code: 'BAIDU_REPORT_SNAPSHOT_UNSTABLE' }
  );
});

test('client accepts stable SEARCH facts returned in a different order', async () => {
  let calls = 0;
  const client = new BaiduMarketingClient({
    manifest,
    appId: 'app-id-fixture',
    secretKey: '0123456789abcdef-secret-key-fixture',
    scope: 'search-report-read-fixture',
    redirectUri: 'https://example.test/oauth/callback',
    timeoutMs: 10000,
    transport: async (request) => {
      calls += 1;
      const reportType = request.json.body.reportType;
      const rows = [
        rowsByType[reportType],
        {
          ...rowsByType[reportType],
          date: '2026-08-02'
        }
      ];
      return envelopeRows(calls > 4 ? rows.reverse() : rows);
    }
  });

  const reports = await client.fetchSearchReports({
    binding: {
      accountId: '1234',
      accountName: '脱敏搜索账户'
    },
    accessToken: 'access-token-fixture',
    coverage: { from: '2026-07-05', to: '2026-08-03' }
  });

  assert.equal(reports.campaigns.length, 2);
  assert.equal(reports.searchTerms.length, 2);
});

test('client applies one shared per-report QPS limit across pages and verification reads', async () => {
  let now = 0;
  const keywordRequestTimes = [];
  const keywordRows = Array.from({ length: 2200 }, (_, index) => ({
    ...rowsByType[2602783],
    wInfoId: index + 1,
    wInfoNameStatus: `关键词-${index + 1}`
  }));
  const client = new BaiduMarketingClient({
    manifest,
    appId: 'app-id-fixture',
    secretKey: '0123456789abcdef-secret-key-fixture',
    scope: 'search-report-read-fixture',
    redirectUri: 'https://example.test/oauth/callback',
    timeoutMs: 10000,
    monotonicClock: () => now,
    wait: async (milliseconds) => { now += milliseconds; },
    transport: async (request) => {
      const reportType = request.json.body.reportType;
      if (reportType !== 2602783) {
        return envelope(rowsByType[reportType]);
      }
      keywordRequestTimes.push(now);
      const start = request.json.body.startRow;
      const rows = keywordRows.slice(start, start + 200);
      return envelopeRows(rows, keywordRows.length);
    }
  });

  const reports = await client.fetchSearchReports({
    binding: {
      accountId: '1234',
      accountName: '脱敏搜索账户'
    },
    accessToken: 'access-token-fixture',
    coverage: { from: '2026-07-05', to: '2026-08-03' }
  });

  assert.equal(reports.keywords.length, keywordRows.length);
  assert.equal(keywordRequestTimes.length, 22);
  for (let index = 10; index < keywordRequestTimes.length; index += 1) {
    assert.ok(
      keywordRequestTimes[index] - keywordRequestTimes[index - 10] >= 1000
    );
  }
});

test('client stops a verification run that exceeds the shared request budget', async () => {
  let now = 0;
  const constrainedManifest = {
    ...manifest,
    searchPlanReport: {
      ...manifest.searchPlanReport,
      qps: 1000,
      pageSize: 1,
      maxRows: 600
    }
  };
  const client = new BaiduMarketingClient({
    manifest: constrainedManifest,
    appId: 'app-id-fixture',
    secretKey: '0123456789abcdef-secret-key-fixture',
    scope: 'search-report-read-fixture',
    redirectUri: 'https://example.test/oauth/callback',
    timeoutMs: 10000,
    monotonicClock: () => now,
    wait: async (milliseconds) => { now += milliseconds; },
    transport: async (request) => {
      const index = request.json.body.startRow;
      return envelopeRows([{
        ...rowsByType[2290316],
        campaignId: index + 1,
        campaignNameStatus: `计划-${index + 1}`
      }], 600);
    }
  });

  await assert.rejects(
    client.fetchSearchReports({
      binding: {
        accountId: '1234',
        accountName: '脱敏搜索账户'
      },
      accessToken: 'access-token-fixture',
      coverage: { from: '2026-07-05', to: '2026-08-03' }
    }),
    { code: 'BAIDU_REPORT_RESOURCE_BUDGET_EXCEEDED' }
  );
});

test('client stops a verification run that exceeds its wall-clock budget', async () => {
  let now = 0;
  const client = new BaiduMarketingClient({
    manifest,
    appId: 'app-id-fixture',
    secretKey: '0123456789abcdef-secret-key-fixture',
    scope: 'search-report-read-fixture',
    redirectUri: 'https://example.test/oauth/callback',
    timeoutMs: 10000,
    monotonicClock: () => now,
    wait: async (milliseconds) => { now += milliseconds; },
    transport: async (request) => {
      now += 120_001;
      return envelope(rowsByType[request.json.body.reportType]);
    }
  });

  await assert.rejects(
    client.fetchSearchReports({
      binding: {
        accountId: '1234',
        accountName: '脱敏搜索账户'
      },
      accessToken: 'access-token-fixture',
      coverage: { from: '2026-07-05', to: '2026-08-03' }
    }),
    { code: 'BAIDU_REPORT_DEADLINE_EXCEEDED' }
  );
});

test('client enforces configurable row and response-byte budgets at their boundaries', () => {
  const client = new BaiduMarketingClient({
    manifest,
    appId: 'app-id-fixture',
    secretKey: '0123456789abcdef-secret-key-fixture',
    scope: 'search-report-read-fixture',
    redirectUri: 'https://example.test/oauth/callback',
    timeoutMs: 10000,
    searchReportBudgetLimits: {
      maxRequests: 10,
      maxRows: 2,
      maxResponseBytes: 64,
      maxDurationMs: 1000
    }
  });

  const rowBudget = client.createSearchReportBudget();
  assert.throws(
    () => rowBudget.recordResponse({}, 3),
    { code: 'BAIDU_REPORT_RESOURCE_BUDGET_EXCEEDED' }
  );

  const byteBudget = client.createSearchReportBudget();
  assert.throws(
    () => byteBudget.recordResponse({ payload: 'x'.repeat(80) }, 0),
    { code: 'BAIDU_REPORT_RESOURCE_BUDGET_EXCEEDED' }
  );
});
