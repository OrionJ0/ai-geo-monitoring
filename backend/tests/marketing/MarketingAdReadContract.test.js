const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const express = require('express');

const { authRequired } = require('../../middleware/auth');
const {
  createMarketingDashboardRouter
} = require('../../modules/marketing/routes/marketingDashboardRoutes');

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
  assert.deepEqual(MARKETING_AD_READ_CONTRACT.filterMaximumLengths, {
    accountId: 512,
    campaignId: 512,
    adGroupId: 512,
    keywordName: 512,
    queryStatus: 24,
    matchType: 40
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
    coverageBound: true,
    retainedSuccessfulRevisions: 2,
    prunedRevisionError: 'MARKETING_SNAPSHOT_UNAVAILABLE'
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
    filterWithoutSnapshot: 'DASHBOARD_FILTER_WITHOUT_SNAPSHOT',
    internalFailure: 'MARKETING_AD_RESOURCE_FAILED'
  });
});

test('唯一 OpenAPI 3.1 合同覆盖四个现役读取入口和生成式前端 wire type', () => {
  const document = JSON.parse(fs.readFileSync(openApiPath, 'utf8'));
  assert.equal(document.openapi, '3.1.0');
  assert.match(document.info.description, /Dashboard.*协调百度四报表/u);
  assert.match(document.info.description, /三个详情资源严格只读取/u);
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
  for (const [pathName, item] of Object.entries(document.paths)) {
    const operation = item.get;
    assert.equal(operation['x-data-source'], 'local-complete-ad-snapshot');
    assert.equal(
      operation['x-upstream-calls'],
      pathName.endsWith('/dashboard')
        ? 'conditional-on-demand-refresh'
        : 'none'
    );
    assert.ok(operation.responses['200'].headers['Cache-Control']);
    if (!pathName.endsWith('/dashboard')) {
      assert.match(
        operation.responses['200'].headers.Vary.description,
        /Authorization/u
      );
    }
    for (const status of ['400', '403', '404', '409', '422', '502']) {
      assert.equal(
        operation.responses[status].$ref,
        '#/components/responses/ErrorResponse'
      );
    }
    assert.equal(
      operation.responses['401'].$ref,
      '#/components/responses/AuthenticationErrorResponse'
    );
    assert.equal(
      operation.responses['500'].$ref,
      '#/components/responses/ServerErrorResponse'
    );
    assert.equal(
      operation.responses['503'].$ref,
      '#/components/responses/UnavailableResponse'
    );
  }
  const dashboard = document.components.schemas.MarketingDashboardResponse;
  assert.equal(dashboard.properties.schemaVersion.const, 'marketing_dashboard_v2');
  for (const field of ['campaigns', 'adGroups', 'keywords', 'searchTerms']) {
    assert.equal(field in dashboard.properties, false);
  }
  const keywordFilter = document.components.schemas.MarketingKeywordFilter;
  assert.deepEqual(keywordFilter.required, ['from', 'to']);
  assert.deepEqual(Object.keys(keywordFilter.properties), [
    'from',
    'to',
    'query',
    'campaignId',
    'adGroupId'
  ]);
  assert.equal(
    document.components.schemas.MarketingKeywordResponse.properties.filter.$ref,
    '#/components/schemas/MarketingKeywordFilter'
  );
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

test('鉴权缺失响应与四个广告读取入口的安全结构化日志符合合同', async (t) => {
  const authResponse = {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
  await authRequired({ headers: {} }, authResponse, () => {
    assert.fail('missing token must not reach the route');
  });
  assert.equal(authResponse.statusCode, 401);
  assert.deepEqual(authResponse.payload, {
    success: false,
    message: '未授权：缺少令牌'
  });

  const logs = [];
  const secretCanary = 'route-secret-canary';
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 2, role: 'user' };
    next();
  });
  app.use('/api/marketing', createMarketingDashboardRouter({
    dashboardService: {
      async assertAccess() {},
      async read() { return { schemaVersion: 'marketing_dashboard_v2' }; }
    },
    adResourceService: {
      async readAdHierarchy() { return { campaigns: [] }; },
      async readKeywords() { return { items: [] }; },
      async readSearchTerms(input) {
        if (input.revision === 'fail') {
          throw Object.assign(new Error(secretCanary), {
            code: 'MARKETING_SNAPSHOT_UNAVAILABLE',
            status: 409,
            rawResponse: secretCanary
          });
        }
        return { items: [] };
      }
    },
    refreshService: {},
    logger: {
      info: (entry) => logs.push(entry),
      warn: (entry) => logs.push(entry)
    }
  }));
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const suffix of [
    'dashboard',
    'ad-hierarchy?revision=r',
    'keywords?revision=r',
    'search-terms?revision=r'
  ]) {
    const response = await fetch(
      `${baseUrl}/api/marketing/projects/11/${suffix}`
    );
    assert.equal(response.status, 200);
  }
  const failed = await fetch(
    `${baseUrl}/api/marketing/projects/11/search-terms?revision=fail`
  );
  assert.equal(failed.status, 409);
  assert.deepEqual(logs.map(({ event, operation, status, errorCode }) => ({
    event,
    operation,
    status,
    errorCode
  })), [
    { event: 'marketing_ad_read_completed', operation: 'dashboard', status: 200, errorCode: null },
    { event: 'marketing_ad_read_completed', operation: 'ad-hierarchy', status: 200, errorCode: null },
    { event: 'marketing_ad_read_completed', operation: 'keywords', status: 200, errorCode: null },
    { event: 'marketing_ad_read_completed', operation: 'search-terms', status: 200, errorCode: null },
    { event: 'marketing_ad_read_failed', operation: 'search-terms', status: 409, errorCode: 'MARKETING_SNAPSHOT_UNAVAILABLE' }
  ]);
  assert.equal(logs.every((entry) => Number.isSafeInteger(entry.durationMs)), true);
  assert.doesNotMatch(JSON.stringify(logs), new RegExp(secretCanary));
});
