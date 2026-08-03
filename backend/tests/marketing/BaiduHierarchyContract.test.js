const assert = require('node:assert/strict');
const test = require('node:test');

const {
  loadBaiduContract
} = require('../../modules/marketing/contracts/baidu/loadBaiduContract');

const manifest = loadBaiduContract('baidu-marketing-pilot-2026-07-30');

test('Baidu hierarchy contract fixes campaign, ad group, keyword and search-term reports', () => {
  const reports = {
    campaign: manifest.searchPlanReport,
    adGroup: manifest.searchAdGroupReport,
    keyword: manifest.searchKeywordReport,
    searchTerm: manifest.searchTermReport
  };

  assert.deepEqual(
    Object.fromEntries(Object.entries(reports).map(([key, report]) => (
      [key, report?.reportType]
    ))),
    {
      campaign: 2290316,
      adGroup: 2284618,
      keyword: 2602783,
      searchTerm: 2307838
    }
  );
  assert.ok(Object.values(reports).every((report) => (
    report.method === 'POST'
    && report.url
      === 'https://api.baidu.com/json/sms/service/OpenApiReportService/getReportData'
    && report.timeUnit === 'DAY'
    && report.pageSize === 200
    && Number.isSafeInteger(report.maxRows)
    && report.maxRows > 0
  )));
  assert.equal(reports.adGroup.maxDateRangeDays, 731);
  assert.equal(reports.keyword.maxDateRangeDays, 731);
  assert.equal(reports.searchTerm.maxDateRangeDays, 91);
  assert.equal(reports.adGroup.qps, 50);
  assert.equal(reports.keyword.qps, 10);
  assert.equal(reports.searchTerm.qps, 10);

  assert.deepEqual(reports.adGroup.columns, [
    'date',
    'userName',
    'userId',
    'campaignId',
    'campaignNameStatus',
    'adGroupId',
    'adGroupNameStatus',
    'impression',
    'click',
    'cost'
  ]);
  assert.deepEqual(reports.keyword.columns, [
    'date',
    'userName',
    'userId',
    'campaignId',
    'campaignNameStatus',
    'adGroupId',
    'adGroupNameStatus',
    'winfoIdTypeEnum',
    'wInfoId',
    'wInfoNameStatus',
    'impression',
    'click',
    'cost'
  ]);
  assert.deepEqual(reports.searchTerm.columns, [
    'date',
    'userName',
    'userId',
    'campaignId',
    'campaignNameStatus',
    'adGroupId',
    'adGroupNameStatus',
    'wInfoNameStatus',
    'queryWord',
    'queryStatusName',
    'wMatchId',
    'impression',
    'click',
    'cost'
  ]);
  assert.equal(
    reports.searchTerm.columns.includes('wInfoId'),
    false,
    '官方搜索词报告不能被扩充为不存在的关键词 ID 合同'
  );
});
