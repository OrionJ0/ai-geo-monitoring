const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MARKETING_AD_READ_CONTRACT
} = require('../../modules/marketing/contracts/MarketingAdReadContract');

test('广告资源合同固定现役页面所需的有界查询与精确汇总', () => {
  assert.deepEqual(MARKETING_AD_READ_CONTRACT.pagination, {
    defaultPage: 1,
    defaultPageSize: 50,
    maximumPageSize: 200,
    maximumQueryLength: 200
  });
  assert.deepEqual(MARKETING_AD_READ_CONTRACT.summaryFields, [
    'impressions',
    'clicks',
    'costAmountScaled'
  ]);
  assert.equal(
    MARKETING_AD_READ_CONTRACT.exactValueType,
    'unsigned-decimal-string'
  );
  assert.equal(MARKETING_AD_READ_CONTRACT.missingValue, null);

  assert.deepEqual(MARKETING_AD_READ_CONTRACT.resources.keywords, {
    schemaVersion: 'marketing_keywords_v1',
    filters: ['query', 'campaignId', 'adGroupId'],
    sortBy: [
      'keywordName',
      'impressions',
      'clicks',
      'costAmountScaled',
      'ctr',
      'averageCpc'
    ]
  });
  assert.deepEqual(MARKETING_AD_READ_CONTRACT.resources.searchTerms, {
    schemaVersion: 'marketing_search_terms_v1',
    filters: [
      'query',
      'accountId',
      'campaignId',
      'adGroupId',
      'keywordName',
      'queryStatus',
      'matchType'
    ],
    sortBy: [
      'searchTerm',
      'keywordName',
      'impressions',
      'clicks',
      'costAmountScaled',
      'ctr',
      'averageCpc'
    ]
  });
});

test('广告资源合同固定 schema、revision、错误与私有缓存边界', () => {
  assert.equal(Object.isFrozen(MARKETING_AD_READ_CONTRACT), true);
  assert.equal(Object.isFrozen(MARKETING_AD_READ_CONTRACT.resources), true);
  assert.equal(
    Object.isFrozen(MARKETING_AD_READ_CONTRACT.resources.searchTerms.filters),
    true
  );
  assert.deepEqual(MARKETING_AD_READ_CONTRACT.schemaVersions, {
    dashboard: 'marketing_dashboard_v2',
    adHierarchy: 'marketing_ad_hierarchy_v1',
    keywords: 'marketing_keywords_v1',
    searchTerms: 'marketing_search_terms_v1'
  });
  assert.deepEqual(MARKETING_AD_READ_CONTRACT.revision, {
    requiredForDetails: true,
    source: 'complete-succeeded-refresh-run',
    projectScoped: true,
    coverageBound: true
  });
  assert.deepEqual(MARKETING_AD_READ_CONTRACT.cacheControl, {
    dashboard: 'private, no-store',
    details: 'private, max-age=60'
  });
  assert.deepEqual(MARKETING_AD_READ_CONTRACT.errors, {
    revisionRequired: 'MARKETING_REVISION_REQUIRED',
    queryInvalid: 'MARKETING_AD_RESOURCE_QUERY_INVALID',
    revisionNotFound: 'MARKETING_REVISION_NOT_FOUND',
    snapshotUnavailable: 'MARKETING_SNAPSHOT_UNAVAILABLE',
    dateOutOfRange: 'DASHBOARD_DATE_OUT_OF_RANGE',
    internalFailure: 'MARKETING_AD_RESOURCE_FAILED'
  });
});
