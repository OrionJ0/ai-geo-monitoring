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
  return {
    header: { status: 0, failures: [] },
    body: {
      data: [{ rowCount: 1, totalRowCount: 1, rows: [row] }]
    }
  };
}

test('client reads and validates every documented SEARCH hierarchy report', async () => {
  const reportTypes = [];
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

  assert.deepEqual(reportTypes, [2290316, 2284618, 2602783, 2307838]);
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
