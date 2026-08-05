const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const {
  MARKETING_AD_READ_CONTRACT
} = require('../../modules/marketing/contracts/MarketingAdReadContract');

const openApiPath = path.resolve(
  __dirname,
  '../../modules/marketing/contracts/goodieai-marketing-ad-read.openapi.json'
);

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

test('唯一 OpenAPI 3.1 合同覆盖四个现役读取入口和生成式前端 wire type', () => {
  const document = JSON.parse(fs.readFileSync(openApiPath, 'utf8'));
  assert.equal(document.openapi, '3.1.0');
  assert.deepEqual(document.security, [{ BearerAuth: [] }]);
  assert.deepEqual(document.components.securitySchemes.BearerAuth, {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: '只允许 Authorization 请求头；不得通过 URL、Cookie 或响应传递令牌。'
  });
  assert.deepEqual(Object.keys(document.paths).sort(), [
    '/api/marketing/projects/{projectId}/ad-hierarchy',
    '/api/marketing/projects/{projectId}/dashboard',
    '/api/marketing/projects/{projectId}/keywords',
    '/api/marketing/projects/{projectId}/search-terms'
  ]);
  for (const item of Object.values(document.paths)) {
    const operation = item.get;
    assert.equal(operation['x-data-source'], 'local-complete-ad-snapshot');
    assert.equal(operation['x-upstream-calls'], 'none');
    assert.ok(operation.responses['200'].headers['Cache-Control']);
    for (const status of ['400', '403', '404', '409', '422', '500']) {
      assert.equal(
        operation.responses[status].$ref,
        '#/components/responses/ErrorResponse'
      );
    }
  }
  const dashboard = document.components.schemas.MarketingDashboardResponse;
  assert.equal(dashboard.properties.schemaVersion.const, 'marketing_dashboard_v2');
  for (const field of ['campaigns', 'adGroups', 'keywords', 'searchTerms']) {
    assert.equal(field in dashboard.properties, false);
  }
  const generated = fs.readFileSync(path.resolve(
    __dirname,
    '../../../nextjs-frontend/src/lib/marketing/generated/marketingAdReadApi.ts'
  ), 'utf8');
  assert.match(generated, /由 goodieai-marketing-ad-read\.openapi\.json 自动生成/);
  assert.match(generated, /export type MarketingDashboardResponse/);
  assert.doesNotMatch(generated, /MarketingDashboardResponse[\s\S]{0,1200}(campaigns|adGroups|keywords|searchTerms)\??:/);
  execFileSync(process.execPath, [
    path.resolve(__dirname, '../../../scripts/generate-marketing-ad-read-types.mjs'),
    '--check'
  ]);
});
