const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const express = require('express');

const { authRequired } = require('../../middleware/auth');
const {
  setMarketingPrivateCache
} = require('../../modules/marketing');
const {
  createMarketingDashboardRouter
} = require('../../modules/marketing/routes/marketingDashboardRoutes');

const {
  MARKETING_AD_READ_CONTRACT
} = require('../../modules/marketing/contracts/MarketingAdReadContract');
const {
  PUBLIC_MARKETING_SERVER_CODES
} = require('../../modules/marketing/contracts/MarketingPublicErrorContract');
const {
  assertMarketingOpenApiResponse
} = require('./helpers/assertMarketingOpenApiResponse');

const openApiPath = path.resolve(
  __dirname,
  '../../modules/marketing/contracts/goodieai-marketing-ad-read.openapi.json'
);

function validAdReadResponses() {
  const coverage = {
    from: '2026-07-01',
    to: '2026-07-31',
    lastSuccessfulAt: '2026-08-01T00:00:00.000Z',
    currency: 'CNY',
    costScale: 6
  };
  const filter = { from: coverage.from, to: coverage.to };
  const summary = { impressions: '0', clicks: '0', costAmountScaled: '0' };
  return {
    dashboard: {
      schemaVersion: 'marketing_dashboard_v2',
      projectId: '11',
      projectName: '上海广拓',
      revision: 'revision-1',
      states: {
        moduleState: 'READY',
        projectState: 'ACTIVE',
        sourceSummaryState: 'CONNECTED',
        bindingSummaryState: 'ACTIVE',
        snapshotContentState: 'ZERO',
        snapshotFreshnessState: 'FRESH',
        refreshState: 'SUCCEEDED'
      },
      bindings: [],
      coverage,
      filter,
      summary,
      trend: [],
      hierarchyCounts: { campaigns: 0, adGroups: 0, keywords: 0, searchTerms: 0 },
      activeRun: null,
      lastRun: null
    },
    adHierarchy: {
      schemaVersion: 'marketing_ad_hierarchy_v1',
      projectId: '11',
      revision: 'revision-1',
      coverage,
      filter,
      summary,
      campaigns: [],
      adGroups: [],
      keywords: [],
      hierarchyCounts: { campaigns: 0, adGroups: 0, keywords: 0 }
    },
    keywords: {
      schemaVersion: 'marketing_keywords_v1',
      projectId: '11',
      revision: 'revision-1',
      coverage,
      filter,
      summary,
      items: [],
      pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 0 }
    },
    searchTerms: {
      schemaVersion: 'marketing_search_terms_v1',
      projectId: '11',
      revision: 'revision-1',
      coverage,
      filter,
      summary,
      items: [],
      pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 0 }
    }
  };
}

test('广告资源合同固定现役页面所需的有界查询与精确汇总', () => {
  assert.deepEqual(MARKETING_AD_READ_CONTRACT.pagination, {
    defaultPage: 1,
    defaultPageSize: 50,
    maximumPageSize: 200,
    maximumQueryLength: 200,
    maximumExactRatioSortItems: 2000,
    maximumExactRatioSortFacts: 5000
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
  assert.equal(
    MARKETING_AD_READ_CONTRACT.errors.sortScopeTooLarge,
    'MARKETING_AD_RESOURCE_SORT_SCOPE_TOO_LARGE'
  );

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
    sortScopeTooLarge: 'MARKETING_AD_RESOURCE_SORT_SCOPE_TOO_LARGE',
    internalFailure: 'MARKETING_AD_RESOURCE_FAILED'
  });
});

test('SQLite 精确比率排序与汇总保持线性读取边界', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../modules/marketing/services/MarketingAdResourceService.js'
  ), 'utf8');
  assert.doesNotMatch(source, /CROSS JOIN aggregated_rows/u);
  assert.doesNotMatch(
    source,
    /SELECT impressions_text, clicks_text, cost_amount_scaled_text\s+FROM baidu_(keyword|search_term)_daily_metrics/u
  );
  assert.match(source, /BigInt\(left\[numerator\]\).*BigInt\(right\[denominator\]\)/su);
  assert.match(source, /sqliteExactSummary/u);
});

test('唯一 OpenAPI 3.1 合同覆盖四个现役读取入口和生成式前端 wire type', () => {
  const document = JSON.parse(fs.readFileSync(openApiPath, 'utf8'));
  assert.equal(document.openapi, '3.1.0');
  const publicErrorCodes = new Set([
    ...Object.values(MARKETING_AD_READ_CONTRACT.errors),
    ...Object.values(PUBLIC_MARKETING_SERVER_CODES).flat()
  ]);
  for (const code of document.components.schemas.MarketingError
    .properties.code.examples) {
    assert.ok(publicErrorCodes.has(code), `OpenAPI error example is not public: ${code}`);
  }
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
    if (pathName.endsWith('/dashboard')) {
      assert.equal(
        operation.responses['504'].$ref,
        '#/components/responses/UnavailableResponse'
      );
    }
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
  const searchTermFilter = document.components.schemas.MarketingSearchTermFilter;
  assert.deepEqual(searchTermFilter.required, ['from', 'to']);
  assert.deepEqual(Object.keys(searchTermFilter.properties), [
    'from',
    'to',
    'query',
    'accountId',
    'campaignId',
    'adGroupId',
    'keywordName',
    'queryStatus',
    'matchType'
  ]);
  assert.equal(
    document.components.schemas.MarketingSearchTermResponse.properties.filter.$ref,
    '#/components/schemas/MarketingSearchTermFilter'
  );
  for (const responseName of [
    'ErrorResponse',
    'AuthenticationErrorResponse',
    'ServerErrorResponse',
    'UnavailableResponse'
  ]) {
    assert.equal(
      document.components.responses[responseName].headers['Cache-Control'].schema.const,
      'private, no-store'
    );
  }
  assert.deepEqual(
    document.components.responses.UnavailableResponse.headers['Retry-After'].schema,
    { type: 'string', pattern: '^[1-9][0-9]*$' }
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
    headers: {},
    set(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
  let cacheMiddlewareContinued = false;
  setMarketingPrivateCache({}, authResponse, () => {
    cacheMiddlewareContinued = true;
  });
  assert.equal(cacheMiddlewareContinued, true);
  await authRequired({ headers: {} }, authResponse, () => {
    assert.fail('missing token must not reach the route');
  });
  assert.equal(authResponse.statusCode, 401);
  assert.equal(authResponse.headers['cache-control'], 'private, no-store');
  assert.deepEqual(authResponse.payload, {
    success: false,
    message: '未授权：缺少令牌'
  });
  assertMarketingOpenApiResponse({
    path: '/api/marketing/projects/{projectId}/dashboard',
    status: 401,
    payload: authResponse.payload,
    headers: authResponse.headers
  });

  const logs = [];
  const secretCanary = 'route-secret-canary';
  const responses = validAdReadResponses();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 2, role: 'user' };
    next();
  });
  app.use('/api/marketing', createMarketingDashboardRouter({
    dashboardService: {
      async assertAccess() {},
      async read(input) {
        if (String(input.projectId) === '503') {
          throw Object.assign(new Error('营销模块不可用'), {
            code: 'MARKETING_MODULE_UNAVAILABLE',
            status: 503
          });
        }
        if (String(input.projectId) === '504') {
          throw Object.assign(new Error('百度请求超时'), {
            code: 'BAIDU_REQUEST_TIMEOUT',
            status: 504
          });
        }
        if (String(input.projectId) === '500') {
          throw Object.assign(new Error(secretCanary), {
            code: 'SQLITE_BUSY',
            rawResponse: secretCanary
          });
        }
        return responses.dashboard;
      }
    },
    adResourceService: {
      async readAdHierarchy(input) {
        if (input.revision === 'database-fail') {
          throw Object.assign(new Error(secretCanary), {
            code: 'SQLITE_BUSY',
            rawResponse: secretCanary
          });
        }
        return responses.adHierarchy;
      },
      async readKeywords(input) {
        if (input.revision === 'out-of-range') {
          throw Object.assign(new Error('所选范围超出快照覆盖'), {
            code: 'DASHBOARD_DATE_OUT_OF_RANGE',
            status: 422
          });
        }
        return responses.keywords;
      },
      async readSearchTerms(input) {
        if (input.revision === 'fail') {
          throw Object.assign(new Error(secretCanary), {
            code: 'MARKETING_SNAPSHOT_UNAVAILABLE',
            status: 409,
            rawResponse: secretCanary
          });
        }
        return responses.searchTerms;
      }
    },
    tongjiService: {
      async readProjectWebsiteTraffic(projectId) {
        const errors = {
          response: ['BAIDU_TONGJI_RESPONSE_INVALID', 502],
          capability: ['BAIDU_TONGJI_CAPABILITY_NOT_VERIFIED', 503],
          site: ['TONGJI_SITE_MISMATCH', 502]
        };
        const [code, status] = errors[projectId] || ['SQLITE_BUSY', 500];
        throw Object.assign(new Error(secretCanary), {
          code,
          status,
          rawResponse: secretCanary
        });
      },
      async readProjectWebsitePages() {
        throw Object.assign(new Error(secretCanary), {
          code: 'BAIDU_TONGJI_PAGE_REPORT_BUDGET_EXCEEDED',
          status: 504,
          retryAfterSeconds: 3,
          rawResponse: secretCanary
        });
      }
    },
    refreshService: {
      async createRun() {
        return { runId: 'queue-full-run', status: 'QUEUED' };
      },
      async rejectQueuedRun() {
      }
    },
    enqueue() {
      throw Object.assign(new Error('营销刷新队列已满'), {
        code: 'MARKETING_EXECUTOR_QUEUE_FULL',
        status: 503,
        retryAfterSeconds: 2
      });
    },
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
  for (const [suffix, pathName] of [
    ['dashboard', '/api/marketing/projects/{projectId}/dashboard'],
    ['ad-hierarchy?revision=r', '/api/marketing/projects/{projectId}/ad-hierarchy'],
    ['keywords?revision=r', '/api/marketing/projects/{projectId}/keywords'],
    ['search-terms?revision=r', '/api/marketing/projects/{projectId}/search-terms']
  ]) {
    const response = await fetch(
      `${baseUrl}/api/marketing/projects/11/${suffix}`
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assertMarketingOpenApiResponse({
      path: pathName,
      status: 200,
      payload,
      headers: response.headers
    });
  }
  const internalFailure = await fetch(
    `${baseUrl}/api/marketing/projects/11/ad-hierarchy?revision=database-fail`
  );
  assert.equal(internalFailure.status, 500);
  const internalFailurePayload = await internalFailure.json();
  assert.deepEqual(internalFailurePayload, {
    error: {
      code: 'MARKETING_AD_RESOURCE_FAILED',
      message: '营销广告资源暂时不可用'
    }
  });
  assertMarketingOpenApiResponse({
    path: '/api/marketing/projects/{projectId}/ad-hierarchy',
    status: 500,
    payload: internalFailurePayload,
    headers: internalFailure.headers
  });
  const timeout = await fetch(
    `${baseUrl}/api/marketing/projects/504/dashboard`
  );
  assert.equal(timeout.status, 504);
  assertMarketingOpenApiResponse({
    path: '/api/marketing/projects/{projectId}/dashboard',
    status: 504,
    payload: await timeout.json(),
    headers: timeout.headers
  });
  const dashboardInternalFailure = await fetch(
    `${baseUrl}/api/marketing/projects/500/dashboard`
  );
  assert.equal(dashboardInternalFailure.status, 500);
  const dashboardInternalFailurePayload = await dashboardInternalFailure.json();
  assert.deepEqual(dashboardInternalFailurePayload, {
    error: {
      code: 'MARKETING_DASHBOARD_FAILED',
      message: '营销看板暂时不可用'
    }
  });
  assertMarketingOpenApiResponse({
    path: '/api/marketing/projects/{projectId}/dashboard',
    status: 500,
    payload: dashboardInternalFailurePayload,
    headers: dashboardInternalFailure.headers
  });
  for (const [projectId, code, status] of [
    ['response', 'BAIDU_TONGJI_RESPONSE_INVALID', 502],
    ['capability', 'BAIDU_TONGJI_CAPABILITY_NOT_VERIFIED', 503],
    ['site', 'TONGJI_SITE_MISMATCH', 502]
  ]) {
    const response = await fetch(
      `${baseUrl}/api/marketing/projects/${projectId}/website-traffic-overview`
    );
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), {
      error: { code, message: '营销看板暂时不可用' }
    });
  }
  const pageBudget = await fetch(
    `${baseUrl}/api/marketing/projects/page-budget/website-traffic-pages`
  );
  assert.equal(pageBudget.status, 504);
  assert.equal(pageBudget.headers.get('retry-after'), '3');
  assert.deepEqual(await pageBudget.json(), {
    error: {
      code: 'BAIDU_TONGJI_PAGE_REPORT_BUDGET_EXCEEDED',
      message: '营销看板暂时不可用'
    }
  });
  const tongjiInternalFailure = await fetch(
    `${baseUrl}/api/marketing/projects/internal/website-traffic-overview`
  );
  assert.equal(tongjiInternalFailure.status, 500);
  assert.deepEqual(await tongjiInternalFailure.json(), {
    error: {
      code: 'MARKETING_DASHBOARD_FAILED',
      message: '营销看板暂时不可用'
    }
  });
  const queueFull = await fetch(
    `${baseUrl}/api/marketing/projects/11/refresh-runs`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ triggerType: 'MANUAL' })
    }
  );
  assert.equal(queueFull.status, 503);
  assert.equal(queueFull.headers.get('retry-after'), '2');
  assert.deepEqual(await queueFull.json(), {
    error: {
      code: 'MARKETING_EXECUTOR_QUEUE_FULL',
      message: '营销看板暂时不可用'
    }
  });
  const failed = await fetch(
    `${baseUrl}/api/marketing/projects/11/search-terms?revision=fail`
  );
  assert.equal(failed.status, 409);
  const failedPayload = await failed.json();
  assertMarketingOpenApiResponse({
    path: '/api/marketing/projects/{projectId}/search-terms',
    status: 409,
    payload: failedPayload,
    headers: failed.headers
  });

  const outOfRange = await fetch(
    `${baseUrl}/api/marketing/projects/11/keywords?revision=out-of-range`
  );
  assert.equal(outOfRange.status, 422);
  assertMarketingOpenApiResponse({
    path: '/api/marketing/projects/{projectId}/keywords',
    status: 422,
    payload: await outOfRange.json(),
    headers: outOfRange.headers
  });

  const unavailable = await fetch(
    `${baseUrl}/api/marketing/projects/503/dashboard`
  );
  assert.equal(unavailable.status, 503);
  assertMarketingOpenApiResponse({
    path: '/api/marketing/projects/{projectId}/dashboard',
    status: 503,
    payload: await unavailable.json(),
    headers: unavailable.headers
  });
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
    { event: 'marketing_ad_read_failed', operation: 'ad-hierarchy', status: 500, errorCode: 'SQLITE_BUSY' },
    { event: 'marketing_ad_read_failed', operation: 'dashboard', status: 504, errorCode: 'BAIDU_REQUEST_TIMEOUT' },
    { event: 'marketing_ad_read_failed', operation: 'dashboard', status: 500, errorCode: 'SQLITE_BUSY' },
    { event: 'marketing_ad_read_failed', operation: 'search-terms', status: 409, errorCode: 'MARKETING_SNAPSHOT_UNAVAILABLE' },
    { event: 'marketing_ad_read_failed', operation: 'keywords', status: 422, errorCode: 'DASHBOARD_DATE_OUT_OF_RANGE' },
    { event: 'marketing_ad_read_failed', operation: 'dashboard', status: 503, errorCode: 'MARKETING_MODULE_UNAVAILABLE' }
  ]);
  assert.equal(logs.every((entry) => Number.isSafeInteger(entry.durationMs)), true);
  assert.doesNotMatch(JSON.stringify(logs), new RegExp(secretCanary));
});
