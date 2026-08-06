import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import path from 'node:path';
import keywordFixtureModule from '../../../src/fixtures/keywordAnalysis.fixture.cjs';
import type {
  MarketingDashboardResponse
} from '../../../src/lib/marketing/generated/marketingAdReadApi';

const artifactDirectory = path.resolve(
  process.cwd(),
  '../output/playwright/keyword-analysis'
);

const { buildKeywordFixture } = keywordFixtureModule;

type FixtureFact = {
  date: string;
  accountId: string;
  accountName: string;
  schemeId: string;
  schemeName: string;
  unitId: string;
  unitName: string;
  keywordId: string;
  keyword: string;
  costAmountScaled: string;
  impressions: string;
  clicks: string;
};

type MetricRollup = {
  costAmountScaled: bigint;
  impressions: bigint;
  clicks: bigint;
};

function addMetrics(target: MetricRollup, fact: FixtureFact) {
  target.costAmountScaled += BigInt(fact.costAmountScaled);
  target.impressions += BigInt(fact.impressions);
  target.clicks += BigInt(fact.clicks);
}

function metricStrings(metrics: MetricRollup) {
  return {
    costAmountScaled: metrics.costAmountScaled.toString(),
    impressions: metrics.impressions.toString(),
    clicks: metrics.clicks.toString()
  };
}

function marketingFixture(stale = false) {
  const fixture = buildKeywordFixture(false);
  const facts = fixture.facts as FixtureFact[];
  const bindings = [...new Map(facts.map((fact) => [fact.accountId, {
    bindingId: `fixture-binding-${fact.accountId}`,
    accountId: fact.accountId,
    accountName: fact.accountName,
    sourceState: 'CONNECTED',
    bindingState: 'ACTIVE',
    blockingCode: null
  }])).values()];
  const campaignRollups = new Map<string, MetricRollup & {
    accountId: string;
    campaignId: string;
    campaignName: string;
  }>();
  const adGroupRollups = new Map<string, MetricRollup & {
    accountId: string;
    campaignId: string;
    campaignName: string;
    adGroupId: string;
    adGroupName: string;
  }>();
  const stableAdGroupIds = new Map<string, string>();
  const dailyRollups = new Map<string, MetricRollup>();
  for (const fact of facts) {
    const campaignKey = `${fact.accountId}:${fact.schemeId}`;
    const campaign = campaignRollups.get(campaignKey) || {
      accountId: fact.accountId,
      campaignId: fact.schemeId,
      campaignName: fact.schemeName,
      costAmountScaled: BigInt(0),
      impressions: BigInt(0),
      clicks: BigInt(0)
    };
    addMetrics(campaign, fact);
    campaignRollups.set(campaignKey, campaign);

    const stableAdGroupKey = `${campaignKey}:${fact.unitName}`;
    if (!stableAdGroupIds.has(stableAdGroupKey)) {
      stableAdGroupIds.set(
        stableAdGroupKey,
        `fixture-ad-group-${stableAdGroupIds.size + 1}`
      );
    }
    const adGroupId = stableAdGroupIds.get(stableAdGroupKey) as string;
    const adGroupKey = `${campaignKey}:${adGroupId}`;
    const adGroup = adGroupRollups.get(adGroupKey) || {
      accountId: fact.accountId,
      campaignId: fact.schemeId,
      campaignName: fact.schemeName,
      adGroupId,
      adGroupName: fact.unitName,
      costAmountScaled: BigInt(0),
      impressions: BigInt(0),
      clicks: BigInt(0)
    };
    addMetrics(adGroup, fact);
    adGroupRollups.set(adGroupKey, adGroup);

    const daily = dailyRollups.get(fact.date) || {
      costAmountScaled: BigInt(0),
      impressions: BigInt(0),
      clicks: BigInt(0)
    };
    addMetrics(daily, fact);
    dailyRollups.set(fact.date, daily);
  }
  const campaigns = [...campaignRollups.values()].map((row) => ({
    accountId: row.accountId,
    campaignId: row.campaignId,
    campaignName: row.campaignName,
    ...metricStrings(row)
  }));
  const adGroups = [...adGroupRollups.values()].map((row) => ({
    accountId: row.accountId,
    campaignId: row.campaignId,
    campaignName: row.campaignName,
    adGroupId: row.adGroupId,
    adGroupName: row.adGroupName,
    ...metricStrings(row)
  }));
  const keywords = facts.map((fact) => ({
    accountId: fact.accountId,
    campaignId: fact.schemeId,
    campaignName: fact.schemeName,
    adGroupId: stableAdGroupIds.get(
      `${fact.accountId}:${fact.schemeId}:${fact.unitName}`
    ) as string,
    adGroupName: fact.unitName,
    keywordId: fact.keywordId,
    keywordName: fact.keyword,
    targetingType: 'KEYWORD',
    costAmountScaled: fact.costAmountScaled,
    impressions: fact.impressions,
    clicks: fact.clicks
  }));
  const searchTerms = [
    {
      keywordName: '电子围栏厂家',
      searchTerm: '电子围栏厂家报价',
      queryStatus: 'NOT_ADDED',
      matchType: 'PHRASE',
      costAmountScaled: '186000',
      impressions: '1260',
      clicks: '18'
    },
    {
      keywordName: '电子围栏厂家',
      searchTerm: '电子围栏生产厂家',
      queryStatus: 'ADDED',
      matchType: 'EXACT',
      costAmountScaled: '124000',
      impressions: '840',
      clicks: '12'
    },
    {
      keywordName: '周界报警系统',
      searchTerm: '周界报警系统方案',
      queryStatus: 'NOT_ADDED',
      matchType: 'PHRASE',
      costAmountScaled: '98000',
      impressions: '620',
      clicks: '9'
    }
  ].flatMap((example) => {
    const keyword = keywords.find((row) => row.keywordName === example.keywordName);
    return keyword ? [{
      accountId: keyword.accountId,
      campaignId: keyword.campaignId,
      campaignName: keyword.campaignName,
      adGroupId: keyword.adGroupId,
      adGroupName: keyword.adGroupName,
      ...example
    }] : [];
  });
  const total = (field: 'costAmountScaled' | 'impressions' | 'clicks') => (
    keywords.reduce((sum: bigint, row: Record<string, string>) => (
      sum + BigInt(row[field])
    ), BigInt(0)).toString()
  );
  const trend = [...dailyRollups.entries()].map(([date, metrics]) => ({
    date,
    ...metricStrings(metrics)
  }));
  const dashboard: MarketingDashboardResponse = {
    schemaVersion: 'marketing_dashboard_v2',
    projectId: '11',
    projectName: fixture.projectName,
    revision: 'keyword-analysis-fixture-revision',
    states: {
      moduleState: 'READY',
      projectState: 'ACTIVE',
      sourceSummaryState: 'CONNECTED',
      bindingSummaryState: 'ACTIVE',
      snapshotContentState: 'DATA',
      snapshotFreshnessState: stale ? 'STALE' : 'FRESH',
      refreshState: stale ? 'FAILED' : 'SUCCEEDED'
    },
    coverage: {
      from: fixture.availableFrom,
      to: fixture.availableTo,
      lastSuccessfulAt: '2026-08-03T03:58:00.000Z',
      currency: fixture.currency,
      costScale: fixture.costScale
    },
    filter: { from: fixture.availableFrom, to: fixture.availableTo },
    summary: {
      costAmountScaled: total('costAmountScaled'),
      impressions: total('impressions'),
      clicks: total('clicks')
    },
    trend,
    bindings,
    hierarchyCounts: {
      campaigns: campaigns.length,
      adGroups: adGroups.length,
      keywords: keywords.length,
      searchTerms: searchTerms.length
    },
    activeRun: null,
    lastRun: {
      runId: stale ? 'failed-refresh-run' : 'successful-refresh-run',
      status: stale ? 'FAILED' : 'SUCCEEDED',
      failureCode: stale ? 'BAIDU_REPORT_SNAPSHOT_UNSTABLE' : null
    }
  };
  return { dashboard, campaigns, adGroups, keywords, searchTerms };
}

function dashboardFixture(stale = false): MarketingDashboardResponse {
  return marketingFixture(stale).dashboard;
}

function alignDashboardFilterToRequest<
  T extends ReturnType<typeof dashboardFixture>
>(body: T, requestUrl: string): T {
  const request = new URL(requestUrl);
  const from = request.searchParams.get('from');
  const to = request.searchParams.get('to');
  if (from && to) body.filter = { from, to } as T['filter'];
  return body;
}

function fulfillDashboardFixture(route: Route) {
  const body = dashboardFixture();
  const request = new URL(route.request().url());
  const from = request.searchParams.get('from');
  const to = request.searchParams.get('to');
  if (
    from
    && to
    && body.coverage
    && (from < body.coverage.from || to > body.coverage.to)
  ) {
    return route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'DASHBOARD_DATE_OUT_OF_RANGE',
          message: '请求日期超出当前快照覆盖范围'
        }
      })
    });
  }
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(alignDashboardFilterToRequest(
      body,
      route.request().url()
    ))
  });
}

function searchTermResourceFixture(requestUrl: string) {
  const request = new URL(requestUrl);
  const fixture = marketingFixture();
  const dashboard = fixture.dashboard;
  const from = request.searchParams.get('from') || dashboard.coverage!.from;
  const to = request.searchParams.get('to') || dashboard.coverage!.to;
  const exactFilters = [
    ['accountId', 'accountId'],
    ['campaignId', 'campaignId'],
    ['adGroupId', 'adGroupId'],
    ['keywordName', 'keywordName'],
    ['queryStatus', 'queryStatus'],
    ['matchType', 'matchType']
  ] as const;
  let items = fixture.searchTerms.filter((item) => exactFilters.every(
    ([parameter, field]) => !request.searchParams.has(parameter)
      || item[field] === request.searchParams.get(parameter)
  ));
  const query = request.searchParams.get('query');
  if (query) items = items.filter((item) => item.searchTerm.includes(query));
  const summary = items.reduce((total, item) => ({
    impressions: (BigInt(total.impressions) + BigInt(item.impressions)).toString(),
    clicks: (BigInt(total.clicks) + BigInt(item.clicks)).toString(),
    costAmountScaled: (
      BigInt(total.costAmountScaled) + BigInt(item.costAmountScaled)
    ).toString()
  }), { impressions: '0', clicks: '0', costAmountScaled: '0' });
  const page = Number(request.searchParams.get('page') || 1);
  const pageSize = Number(request.searchParams.get('pageSize') || 50);
  const totalItems = items.length;
  items = items.slice((page - 1) * pageSize, page * pageSize).map((item) => ({
    ...item,
    trend: [{
      date: from,
      impressions: item.impressions,
      clicks: item.clicks,
      costAmountScaled: item.costAmountScaled
    }]
  }));
  return {
    schemaVersion: 'marketing_search_terms_v1',
    projectId: dashboard.projectId,
    revision: request.searchParams.get('revision'),
    coverage: dashboard.coverage,
    filter: { from, to },
    summary,
    items,
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages: totalItems ? Math.ceil(totalItems / pageSize) : 0
    }
  };
}

function keywordResourceFixture(requestUrl: string) {
  const request = new URL(requestUrl);
  const fixture = marketingFixture();
  const dashboard = fixture.dashboard;
  const from = request.searchParams.get('from') || dashboard.coverage!.from;
  const to = request.searchParams.get('to') || dashboard.coverage!.to;
  let items = fixture.keywords.filter((item) => (
    (!request.searchParams.has('campaignId')
      || item.campaignId === request.searchParams.get('campaignId'))
    && (!request.searchParams.has('adGroupId')
      || item.adGroupId === request.searchParams.get('adGroupId'))
  ));
  const query = request.searchParams.get('query');
  if (query) items = items.filter((item) => (
    item.keywordName.includes(query) || item.keywordId.includes(query)
  ));
  const summary = items.reduce((total, item) => ({
    impressions: (BigInt(total.impressions) + BigInt(item.impressions)).toString(),
    clicks: (BigInt(total.clicks) + BigInt(item.clicks)).toString(),
    costAmountScaled: (
      BigInt(total.costAmountScaled) + BigInt(item.costAmountScaled)
    ).toString()
  }), { impressions: '0', clicks: '0', costAmountScaled: '0' });
  const sortBy = request.searchParams.get('sortBy') || 'impressions';
  const direction = request.searchParams.get('sortOrder') === 'ascend' ? 1 : -1;
  const metric = sortBy === 'costAmountScaled'
    ? 'costAmountScaled'
    : sortBy === 'clicks' ? 'clicks' : 'impressions';
  items.sort((left, right) => {
    if (sortBy === 'keywordName') {
      return direction * left.keywordName.localeCompare(right.keywordName, 'zh-CN');
    }
    const difference = BigInt(left[metric]) - BigInt(right[metric]);
    if (difference === BigInt(0)) {
      return left.keywordId.localeCompare(right.keywordId);
    }
    return difference > BigInt(0) ? direction : -direction;
  });
  const page = Number(request.searchParams.get('page') || 1);
  const pageSize = Number(request.searchParams.get('pageSize') || 50);
  const totalItems = items.length;
  items = items.slice((page - 1) * pageSize, page * pageSize).map((item) => ({
    ...item,
    trend: [{
      date: from,
      impressions: item.impressions,
      clicks: item.clicks,
      costAmountScaled: item.costAmountScaled
    }]
  }));
  return {
    schemaVersion: 'marketing_keywords_v1',
    projectId: dashboard.projectId,
    revision: request.searchParams.get('revision'),
    coverage: dashboard.coverage,
    filter: {
      from,
      to,
      ...(query ? { query } : {}),
      ...(request.searchParams.has('campaignId')
        ? { campaignId: request.searchParams.get('campaignId') as string }
        : {}),
      ...(request.searchParams.has('adGroupId')
        ? { adGroupId: request.searchParams.get('adGroupId') as string }
        : {})
    },
    summary,
    items,
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages: totalItems ? Math.ceil(totalItems / pageSize) : 0
    }
  };
}

function adHierarchyResourceFixture(requestUrl: string) {
  const request = new URL(requestUrl);
  const fixture = marketingFixture();
  const dashboard = fixture.dashboard;
  const from = request.searchParams.get('from') || dashboard.coverage!.from;
  const to = request.searchParams.get('to') || dashboard.coverage!.to;
  const withTrend = <T extends {
    impressions: string;
    clicks: string;
    costAmountScaled: string;
  }>(item: T) => ({
    ...item,
    trend: [{
      date: from,
      impressions: item.impressions,
      clicks: item.clicks,
      costAmountScaled: item.costAmountScaled
    }]
  });
  return {
    schemaVersion: 'marketing_ad_hierarchy_v1',
    projectId: dashboard.projectId,
    revision: request.searchParams.get('revision'),
    coverage: dashboard.coverage,
    filter: { from, to },
    summary: dashboard.summary,
    campaigns: fixture.campaigns.map(withTrend),
    adGroups: fixture.adGroups.map(withTrend),
    keywords: fixture.keywords.map(withTrend),
    hierarchyCounts: {
      campaigns: fixture.campaigns.length,
      adGroups: fixture.adGroups.length,
      keywords: fixture.keywords.length
    }
  };
}

async function installRoutes(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('agd_token', 'playwright.keyword-analysis.signature');
    localStorage.setItem('agd_user_id', '2');
    localStorage.setItem('agd_user', JSON.stringify({ id: 2, role: 'user' }));
  });
  await page.route('**/api/geo-projects/default-context', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      data: {
        project: {
          id: '11',
          name: '上海广拓',
          status: 'active',
          website: 'https://gato.com.cn',
          platforms: [],
          aliases: [],
          primary_keywords: []
        },
        source: 'SYSTEM_DEFAULT'
      }
    })
  }));
  await page.route('**/api/marketing/status', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      moduleState: 'READY',
      errorCode: null,
      capabilities: {
        pilotDataAccess: true,
        formalNavigation: true,
        adsRead: true,
        trafficRead: true,
        refreshAds: true
      }
    })
  }));
  await page.route(
    '**/api/marketing/projects/11/dashboard**',
    fulfillDashboardFixture
  );
  await page.route('**/api/marketing/projects/11/search-terms**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(searchTermResourceFixture(route.request().url()))
  }));
  await page.route('**/api/marketing/projects/11/keywords**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(keywordResourceFixture(route.request().url()))
  }));
  await page.route('**/api/marketing/projects/11/ad-hierarchy**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(adHierarchyResourceFixture(route.request().url()))
  }));
}

function keywordMetric(page: Page, title: string) {
  return page.getByRole('heading', { name: new RegExp(title, 'u') })
    .locator('xpath=ancestor::div[contains(@class,"ant-card")][1]');
}

test.beforeEach(async ({ page }) => {
  await installRoutes(page);
  await page.setViewportSize({ width: 1488, height: 1058 });
});

test('confirmed keyword analysis visual keeps selection, donut, task filters, and direct unit text', async ({ page }) => {
  await page.goto('/geo/keyword-analysis');

  await expect(keywordMetric(page, '广告关键词数')).toContainText('302');
  await expect(keywordMetric(page, '展现')).toContainText(/本期\s*[\d,]+/u);
  await expect(keywordMetric(page, '点击')).toContainText(/本期\s*[\d,]+/u);
  await expect(keywordMetric(page, '消费')).toContainText(/本期\s*¥[\d,]+/u);
  await expect(page.getByText(/百度推广 · 真实数据 · 更新于/u)).toBeVisible();
  await expect(page.getByText('当前选中关键词')).toBeVisible();
  await expect(page.getByText('优化标签分布')).toBeVisible();
  await expect(page.getByText('振动光纤价格').first()).toBeVisible();

  const scatterRegion = page.getByRole('img', {
    name: /关键词效率分布，共 \d+ 个有点击关键词/u
  });
  await expect(scatterRegion).toBeVisible();
  await page.getByRole('row', { name: /电子围栏厂家/u }).click();
  await expect(page.locator('aside').getByText('电子围栏厂家')).toBeVisible();

  const selectedRow = page.locator('tr[aria-selected="true"]');
  await expect(selectedRow).toContainText('电子围栏厂家');
  await expect(selectedRow).not.toContainText('推广单元');

  const alarmRow = page.getByRole('row', { name: /周界报警系统/ });
  await alarmRow.click();
  await expect(page.locator('aside').getByText('周界报警系统')).toBeVisible();
  await expect(alarmRow).toHaveAttribute('aria-selected', 'true');

  await page.getByText('密度', { exact: true }).click();
  await expect(page.locator('.ant-segmented-item-selected')).toContainText('密度');
  await page.getByText('散点', { exact: true }).click();
  await expect(page.locator('.ant-segmented-item-selected')).toContainText('散点');

  await page.getByLabel('搜索投放关键词').fill('周界报警系统');
  const keywordTable = page.getByRole('table', { name: '全部关键词明细表' });
  await expect(keywordTable).toContainText('周界报警系统');
  await expect(keywordTable).not.toContainText('电子围栏厂家');
  await page.getByRole('button', { name: '重置' }).click();
  await expect(keywordTable).toContainText('电子围栏厂家');

  await page.reload();
  await expect(page.locator('aside').getByText('振动光纤价格')).toBeVisible();

  await page.screenshot({
    path: path.join(artifactDirectory, 'keyword-analysis.png'),
    fullPage: true
  });

  const accessibilityScanResults = await new AxeBuilder({ page })
    .disableRules(['landmark-one-main'])
    .analyze();
  expect(accessibilityScanResults.violations.filter((violation) => (
    violation.impact === 'critical' || violation.impact === 'serious'
  ))).toEqual([]);
});

test('keyword table pins one root revision and sends paging, query, and sort to the resource', async ({ page }) => {
  let dashboardRequests = 0;
  const dashboardUrls: URL[] = [];
  const keywordRequests: URL[] = [];
  await page.unroute('**/api/marketing/projects/11/dashboard**');
  await page.route('**/api/marketing/projects/11/dashboard**', (route) => {
    dashboardRequests += 1;
    dashboardUrls.push(new URL(route.request().url()));
    return fulfillDashboardFixture(route);
  });
  await page.unroute('**/api/marketing/projects/11/keywords**');
  await page.route('**/api/marketing/projects/11/keywords**', (route) => {
    keywordRequests.push(new URL(route.request().url()));
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(keywordResourceFixture(route.request().url()))
    });
  });

  await page.goto('/geo/keyword-analysis');
  await expect(keywordMetric(page, '广告关键词数'))
    .toContainText(/本期\s*302\s*上期\s*302/u);
  await expect.poll(() => keywordRequests.length).toBe(2);
  const currentPeriod = dashboardUrls.at(-1)!;
  const currentRequest = keywordRequests.find((request) => (
    request.searchParams.get('from') === currentPeriod.searchParams.get('from')
    && request.searchParams.get('to') === currentPeriod.searchParams.get('to')
  ));
  expect(currentRequest).toBeDefined();
  const previousRequest = keywordRequests.find((request) => request !== currentRequest)!;
  expect(previousRequest.searchParams.get('page')).toBe('1');
  expect(previousRequest.searchParams.get('pageSize')).toBe('1');
  const currentFrom = Date.parse(`${currentRequest!.searchParams.get('from')}T00:00:00.000Z`);
  const currentTo = Date.parse(`${currentRequest!.searchParams.get('to')}T00:00:00.000Z`);
  const previousFrom = Date.parse(`${previousRequest.searchParams.get('from')}T00:00:00.000Z`);
  const previousTo = Date.parse(`${previousRequest.searchParams.get('to')}T00:00:00.000Z`);
  expect(previousTo + 86_400_000).toBe(currentFrom);
  expect(previousTo - previousFrom).toBe(currentTo - currentFrom);

  const summaryBeforePaging = await keywordMetric(page, '展现').textContent();
  const requestsBeforePaging = keywordRequests.length;
  await page.getByRole('listitem', { name: '2' }).click();
  await expect.poll(() => keywordRequests.length).toBe(requestsBeforePaging + 1);
  expect(keywordRequests.at(-1)!.searchParams.get('page')).toBe('2');
  expect(keywordRequests.at(-1)!.searchParams.get('pageSize')).toBe('10');
  expect(keywordRequests.filter((request) => (
    request.searchParams.get('from') === previousRequest.searchParams.get('from')
    && request.searchParams.get('to') === previousRequest.searchParams.get('to')
  ))).toHaveLength(1);
  expect(await keywordMetric(page, '展现').textContent()).toBe(summaryBeforePaging);
  await page.locator('.ant-pagination-options-size-changer').click();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(() => keywordRequests.length).toBe(requestsBeforePaging + 2);
  expect(keywordRequests.at(-1)!.searchParams.get('page')).toBe('1');
  expect(keywordRequests.at(-1)!.searchParams.get('pageSize')).toBe('20');
  expect(keywordRequests.filter((request) => (
    request.searchParams.get('from') === previousRequest.searchParams.get('from')
    && request.searchParams.get('to') === previousRequest.searchParams.get('to')
  ))).toHaveLength(1);
  expect(await keywordMetric(page, '展现').textContent()).toBe(summaryBeforePaging);

  await page.getByLabel('搜索投放关键词').fill('周界报警系统');
  await expect(page.getByRole('table', { name: '全部关键词明细表' }))
    .toContainText('周界报警系统');
  await expect.poll(() => keywordRequests.some((request) => (
    request.searchParams.get('query') === '周界报警系统'
  ))).toBe(true);
  await expect.poll(() => keywordRequests.filter((request) => (
    request.searchParams.get('query') === '周界报警系统'
  )).length).toBeGreaterThanOrEqual(2);
  const matchingQueryRequests = keywordRequests.filter((request) => (
    request.searchParams.get('query') === '周界报警系统'
  ));
  expect(matchingQueryRequests.at(-1)!.searchParams.get('pageSize')).toBe('1');
  expect(matchingQueryRequests.at(-2)!.searchParams.get('query'))
    .toBe(matchingQueryRequests.at(-1)!.searchParams.get('query'));

  await page.getByLabel('推广单元').click({ force: true });
  await page.getByText('周界系统 / 通用词', { exact: true }).last().click();
  await expect.poll(() => keywordRequests.filter((request) => (
    request.searchParams.get('query') === '周界报警系统'
    && request.searchParams.has('adGroupId')
  )).length).toBeGreaterThanOrEqual(2);
  const matchingUnitRequests = keywordRequests.filter((request) => (
    request.searchParams.get('query') === '周界报警系统'
    && request.searchParams.has('adGroupId')
  ));
  expect(new Set(matchingUnitRequests.slice(-2).map((request) => (
    request.searchParams.get('adGroupId')
  ))).size).toBe(1);

  await page.getByRole('columnheader', { name: '展现' }).click();
  await expect.poll(() => keywordRequests.some((request) => (
    request.searchParams.get('sortBy') === 'impressions'
  ))).toBe(true);
  expect(dashboardRequests).toBe(3);
  expect(new Set(keywordRequests.map((request) => request.searchParams.get('revision'))))
    .toEqual(new Set(['keyword-analysis-fixture-revision']));
});

test('keyword pagination keeps data, keyboard focus, and a retryable error during remote loading', async ({ page }) => {
  let releaseSecondPage: (() => void) | undefined;
  const secondPageGate = new Promise<void>((resolve) => {
    releaseSecondPage = resolve;
  });
  let releasePageThreeRetry: (() => void) | undefined;
  const pageThreeRetryGate = new Promise<void>((resolve) => {
    releasePageThreeRetry = resolve;
  });
  let pageThreeAttempts = 0;
  await page.unroute('**/api/marketing/projects/11/keywords**');
  await page.route('**/api/marketing/projects/11/keywords**', async (route) => {
    const request = new URL(route.request().url());
    const requestedPage = request.searchParams.get('page');
    const requestedPageSize = request.searchParams.get('pageSize');
    if (requestedPage === '2' && requestedPageSize === '10') {
      await secondPageGate;
    }
    if (requestedPage === '3' && requestedPageSize === '10') {
      pageThreeAttempts += 1;
      if (pageThreeAttempts === 1) {
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'MARKETING_RESOURCE_UNAVAILABLE',
              message: '关键词第 3 页暂时不可用'
            }
          })
        });
      }
      await pageThreeRetryGate;
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(keywordResourceFixture(route.request().url()))
    });
  });

  await page.goto('/geo/keyword-analysis');
  const table = page.getByRole('table', { name: '全部关键词明细表' });
  await expect(table).toBeVisible();
  const pageTwo = page.locator('.ant-pagination-item-2');
  await pageTwo.focus();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('status'))
    .toContainText('正在加载关键词第 2 页');
  await expect(table).toBeVisible();
  await expect(table).toHaveAttribute('aria-busy', 'true');
  await expect(pageTwo).toBeFocused();

  releaseSecondPage?.();
  await expect(table).toHaveAttribute('aria-busy', 'false');
  await expect(pageTwo).toHaveAttribute('aria-current', 'page');
  await expect(pageTwo).toBeFocused();
  await expect(page.getByRole('status'))
    .toContainText('关键词第 2 页加载完成，显示 10 条');
  const secondPageFirstRow = await table.locator('tbody tr').first().textContent();

  const pageThree = page.locator('.ant-pagination-item-3');
  await pageThree.focus();
  await page.keyboard.press('Enter');
  const retryableError = page.getByRole('alert').filter({
    hasText: '关键词第 3 页暂时不可用'
  });
  await expect(retryableError).toBeVisible();
  await expect(retryableError.getByRole('button', { name: /重\s*试/u })).toBeVisible();
  await expect(table.locator('tbody tr').first()).toHaveText(secondPageFirstRow || '');
  await expect(pageTwo).toHaveAttribute('aria-current', 'page');
  await expect(pageThree).toBeFocused();

  const retryButton = retryableError.getByRole('button', { name: /重\s*试/u });
  await retryButton.focus();
  await page.keyboard.press('Enter');
  await expect(retryButton).toBeFocused();
  await expect(retryButton).toHaveAttribute('aria-disabled', 'true');
  await expect(retryableError).toBeVisible();
  await expect(page.getByRole('status')).toContainText('正在加载关键词第 3 页');

  releasePageThreeRetry?.();
  await expect(pageThree).toHaveAttribute('aria-current', 'page');
  await expect(pageThree).toBeFocused();
  await expect(page.getByRole('status'))
    .toContainText('关键词第 3 页加载完成，显示 10 条');
  await expect(retryableError).toHaveCount(0);
});

test('keyword current facts render before a slow previous-period comparison', async ({ page }) => {
  let releasePrevious: (() => void) | undefined;
  const previousGate = new Promise<void>((resolve) => {
    releasePrevious = resolve;
  });
  let previousStarted = false;
  await page.unroute('**/api/marketing/projects/11/keywords**');
  await page.route('**/api/marketing/projects/11/keywords**', async (route) => {
    const request = new URL(route.request().url());
    if ((request.searchParams.get('to') || '') < '2026-07-28') {
      previousStarted = true;
      await previousGate;
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(keywordResourceFixture(route.request().url()))
    });
  });

  await page.goto('/geo/keyword-analysis');
  await expect.poll(() => previousStarted).toBe(true);
  await expect(page.getByRole('table', { name: '全部关键词明细表' }))
    .toContainText('电子围栏厂家');
  await expect(page.getByRole('status'))
    .toContainText('正在加载上一周期关键词比较');

  releasePrevious?.();
  await expect(keywordMetric(page, '广告关键词数'))
    .toContainText(/本期\s*302\s*上期\s*302/u);
});

test('keyword server search waits for stable input and sends only one comparison pair', async ({ page }) => {
  const resourceRequests: URL[] = [];
  await page.unroute('**/api/marketing/projects/11/keywords**');
  await page.route('**/api/marketing/projects/11/keywords**', (route) => {
    const request = new URL(route.request().url());
    if (request.searchParams.has('query')) resourceRequests.push(request);
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(keywordResourceFixture(route.request().url()))
    });
  });

  await page.goto('/geo/keyword-analysis');
  const pageTwo = page.locator('.ant-pagination-item-2');
  await pageTwo.click();
  await expect(pageTwo).toHaveAttribute('aria-current', 'page');
  resourceRequests.length = 0;
  const search = page.getByLabel('搜索投放关键词');
  await search.pressSequentially('周界报警系统', { delay: 50 });
  await expect(page.getByRole('table', { name: '全部关键词明细表' }))
    .toContainText('周界报警系统');
  await expect.poll(() => resourceRequests.length).toBe(2);
  expect(new Set(resourceRequests.map((request) => request.searchParams.get('query'))))
    .toEqual(new Set(['周界报警系统']));
  expect(resourceRequests.map((request) => request.searchParams.get('page')))
    .toEqual(['1', '1']);
  expect(new Set(resourceRequests.map((request) => request.searchParams.get('pageSize'))))
    .toEqual(new Set(['10', '1']));
});

test('keyword comparison keeps factual zero distinct from unavailable data', async ({ page }) => {
  let keywordRequestCount = 0;
  await page.unroute('**/api/marketing/projects/11/keywords**');
  await page.route('**/api/marketing/projects/11/keywords**', (route) => {
    keywordRequestCount += 1;
    const body = keywordResourceFixture(route.request().url());
    if (keywordRequestCount === 2) {
      body.summary = {
        impressions: '0',
        clicks: '0',
        costAmountScaled: '0'
      };
      body.items = [];
      body.pagination.totalItems = 0;
      body.pagination.totalPages = 0;
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(body)
    });
  });

  await page.goto('/geo/keyword-analysis');
  await expect(keywordMetric(page, '广告关键词数')).toContainText(/上期\s*0/u);
  await expect(keywordMetric(page, '展现')).toContainText(/上期\s*0/u);
  await expect(page.getByLabel('广告关键词数上期：暂无数据')).toHaveCount(0);
});

test('keyword comparison keeps current facts when the previous period is outside coverage', async ({ page }) => {
  let keywordRequestCount = 0;
  await page.unroute('**/api/marketing/projects/11/keywords**');
  await page.route('**/api/marketing/projects/11/keywords**', (route) => {
    keywordRequestCount += 1;
    if (keywordRequestCount === 2) {
      return route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'DASHBOARD_DATE_OUT_OF_RANGE',
            message: '上一周期超出当前快照覆盖范围'
          }
        })
      });
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(keywordResourceFixture(route.request().url()))
    });
  });

  await page.goto('/geo/keyword-analysis');
  await expect(page.getByRole('table', { name: '全部关键词明细表' }))
    .toContainText('电子围栏厂家');
  const previous = page.getByLabel(/广告关键词数上期：暂无数据。上一周期超出当前快照覆盖范围/u);
  await expect(previous).toBeVisible();
  await previous.focus();
  await expect(page.getByRole('tooltip'))
    .toContainText('上一周期超出当前快照覆盖范围');
});

test('keyword comparison preserves retryable previous failure instead of calling it no data', async ({ page }) => {
  let keywordRequestCount = 0;
  await page.unroute('**/api/marketing/projects/11/keywords**');
  await page.route('**/api/marketing/projects/11/keywords**', (route) => {
    keywordRequestCount += 1;
    if (keywordRequestCount === 2) {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'MARKETING_UPSTREAM_UNAVAILABLE',
            message: '上一周期关键词上游暂时不可用'
          }
        })
      });
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(keywordResourceFixture(route.request().url()))
    });
  });

  await page.goto('/geo/keyword-analysis');
  const warning = page.getByRole('alert').filter({
    hasText: '上一周期关键词比较读取失败'
  });
  await expect(warning).toContainText('上一周期关键词上游暂时不可用');
  await expect(warning.getByRole('button', { name: /重\s*试/u })).toBeVisible();
  await expect(page.getByRole('table', { name: '全部关键词明细表' }))
    .toContainText('电子围栏厂家');
});

test('keyword comparison discards a late request generation after the date changes', async ({ page }) => {
  let releaseFirstPrevious: (() => void) | undefined;
  const firstPreviousGate = new Promise<void>((resolve) => {
    releaseFirstPrevious = resolve;
  });
  let releaseSecondCurrent: (() => void) | undefined;
  const secondCurrentGate = new Promise<void>((resolve) => {
    releaseSecondCurrent = resolve;
  });
  let currentRequests = 0;
  let previousRequests = 0;
  let firstPreviousUrl = '';
  let firstPreviousAborted = false;
  page.on('requestfailed', (request) => {
    if (request.url() === firstPreviousUrl) firstPreviousAborted = true;
  });
  await page.unroute('**/api/marketing/projects/11/keywords**');
  await page.route('**/api/marketing/projects/11/keywords**', async (route) => {
    const requestUrl = route.request().url();
    const request = new URL(requestUrl);
    const isPrevious = (request.searchParams.get('to') || '') < '2026-07-28';
    const body = keywordResourceFixture(requestUrl);
    if (isPrevious) {
      previousRequests += 1;
      if (previousRequests === 1) {
        firstPreviousUrl = requestUrl;
        await firstPreviousGate;
      }
    } else {
      currentRequests += 1;
      body.summary.impressions = currentRequests === 1 ? '700' : '1400';
      if (currentRequests === 2) await secondCurrentGate;
    }
    try {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(body)
      });
    } catch {
      // The superseded first previous-period request is expected to be aborted.
    }
  });

  await page.goto('/geo/keyword-analysis');
  await expect.poll(() => previousRequests).toBe(1);
  await page.locator('.ant-picker').first().click();
  await page.getByText('最近 14 天', { exact: true }).last().click();
  await expect.poll(() => currentRequests).toBe(2);
  await expect.poll(() => firstPreviousAborted).toBe(true);
  releaseSecondCurrent?.();
  await expect.poll(() => previousRequests).toBe(2);
  await expect(keywordMetric(page, '展现')).toContainText(/本期\s*1,400/u);

  releaseFirstPrevious?.();
  await expect(keywordMetric(page, '展现')).toContainText(/本期\s*1,400/u);
  await expect(keywordMetric(page, '展现')).not.toContainText(/本期\s*700/u);
});

test('keyword evidence opens scoped real search terms and invalid scope never expands to all rows', async ({ page }) => {
  await page.goto('/geo/keyword-analysis');

  await expect(page.getByRole('columnheader', { name: '命中广告搜索词' }))
    .toBeVisible();
  const electronicRow = page.getByRole('row', { name: /电子围栏厂家/u });
  await expect(electronicRow).toContainText('查看');
  await electronicRow.getByRole('link', {
    name: '查看“电子围栏厂家”命中的广告搜索词'
  }).click();

  await expect(page).toHaveURL(
    /\/geo\/keyword-analysis\/search-terms\?accountId=.*&campaignId=.*&adGroupId=.*&keywordName=/u
  );
  await expect(page.getByText('当前广告关键词')).toBeVisible();
  await expect(page.getByText('电子围栏厂家报价', { exact: true })).toBeVisible();
  await expect(page.getByText('电子围栏生产厂家', { exact: true })).toBeVisible();
  await expect(page.getByText('周界报警系统方案', { exact: true })).toHaveCount(0);

  await page.goto('/geo/keyword-analysis/search-terms');
  await expect(page.getByRole('alert').filter({ hasText: '下钻范围无效' }))
    .toContainText('下钻范围无效');
  await expect(page.getByText('电子围栏厂家报价', { exact: true })).toHaveCount(0);

  await page.goto(
    '/geo/keyword-analysis/search-terms?accountId=invalid&campaignId=invalid&adGroupId=invalid&keywordName=invalid'
  );
  await expect(page.getByText(
    '当前广告关键词在所选时间内没有命中的广告搜索词',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByText('电子围栏厂家报价', { exact: true })).toHaveCount(0);
  await expect(page.getByText('周界报警系统方案', { exact: true })).toHaveCount(0);

  await page.getByRole('link', { name: '查看全部广告搜索词' }).click();
  await expect(page).toHaveURL('/geo/keyword-analysis/search-terms?view=all');
  await expect(page.getByText('电子围栏厂家报价', { exact: true })).toBeVisible();
  await expect(page.getByText('周界报警系统方案', { exact: true })).toBeVisible();

  const accessibility = await new AxeBuilder({ page })
    .disableRules(['landmark-one-main'])
    .analyze();
  expect(accessibility.violations.filter((violation) => (
    violation.impact === 'critical' || violation.impact === 'serious'
  ))).toEqual([]);
});

test('search-term comparison refuses a resource from another revision', async ({ page }) => {
  let resourceRequestCount = 0;
  await page.unroute('**/api/marketing/projects/11/search-terms**');
  await page.route('**/api/marketing/projects/11/search-terms**', (route) => {
    const body = searchTermResourceFixture(route.request().url());
    resourceRequestCount += 1;
    if (resourceRequestCount === 2) body.revision = 'another-revision';
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(body)
    });
  });

  await page.goto('/geo/keyword-analysis/search-terms?view=all');
  await expect(page.getByText('电子围栏厂家报价', { exact: true })).toBeVisible();
  const previous = page.getByLabel('广告搜索词数上期：暂无数据');
  await previous.hover();
  await expect(page.getByRole('tooltip'))
    .toContainText('上一周期广告搜索词响应无效');
});

test('search-term comparison refuses a same-revision response for the wrong period', async ({ page }) => {
  let resourceRequestCount = 0;
  await page.unroute('**/api/marketing/projects/11/search-terms**');
  await page.route('**/api/marketing/projects/11/search-terms**', (route) => {
    const body = searchTermResourceFixture(route.request().url());
    resourceRequestCount += 1;
    if (resourceRequestCount === 2) {
      body.filter = { from: '2026-07-05', to: '2026-08-03' };
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(body)
    });
  });

  await page.goto('/geo/keyword-analysis/search-terms?view=all');
  await expect(page.getByText('电子围栏厂家报价', { exact: true })).toBeVisible();
  await expect.poll(() => resourceRequestCount).toBe(2);
  const previous = page.getByLabel('广告搜索词数上期：暂无数据');
  await previous.hover();
  await expect(page.getByRole('tooltip'))
    .toContainText('上一周期广告搜索词响应无效');
});

test('search-term page rejects a current response for a different requested period', async ({ page }) => {
  await page.unroute('**/api/marketing/projects/11/dashboard**');
  await page.route('**/api/marketing/projects/11/dashboard**', (route) => {
    const body = dashboardFixture();
    body.filter = { from: '2026-07-01', to: '2026-07-07' } as unknown as typeof body.filter;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(body)
    });
  });

  await page.goto('/geo/keyword-analysis/search-terms?view=all');
  await expect(page.getByText('广告搜索词数据读取失败，请稍后重试。'))
    .toBeVisible();
  await expect(page.getByText('电子围栏厂家报价', { exact: true })).toHaveCount(0);
});

test('current search-term data renders while previous-period comparison is pending', async ({ page }) => {
  let releasePrevious: (() => void) | undefined;
  let resourceRequestCount = 0;
  await page.unroute('**/api/marketing/projects/11/search-terms**');
  await page.route('**/api/marketing/projects/11/search-terms**', async (route) => {
    const body = searchTermResourceFixture(route.request().url());
    resourceRequestCount += 1;
    if (resourceRequestCount === 2) {
      await new Promise<void>((resolve) => {
        releasePrevious = resolve;
      });
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(body)
    });
  });

  await page.goto('/geo/keyword-analysis/search-terms?view=all');
  await expect(page.getByText('电子围栏厂家报价', { exact: true }))
    .toBeVisible({ timeout: 2_000 });
  expect(releasePrevious).toBeDefined();
  releasePrevious?.();
});

test('scoped comparison pins both periods to one revision and keyword identity', async ({ page }) => {
  const resourceRequests: URL[] = [];
  await page.unroute('**/api/marketing/projects/11/search-terms**');
  await page.route('**/api/marketing/projects/11/search-terms**', (route) => {
    resourceRequests.push(new URL(route.request().url()));
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(searchTermResourceFixture(route.request().url()))
    });
  });

  await page.goto('/geo/keyword-analysis');
  const electronicRow = page.getByRole('row', { name: /电子围栏厂家/u });
  await electronicRow.getByRole('link', {
    name: '查看“电子围栏厂家”命中的广告搜索词'
  }).click();

  const countCard = page.getByRole('heading', { name: /广告搜索词数/u })
    .locator('xpath=ancestor::div[contains(@class,"ant-card")][1]');
  await expect(countCard).toContainText(/本期\s*2\s*上期\s*2/u);
  await expect.poll(() => resourceRequests.length).toBe(2);
  expect(resourceRequests.map((request) => request.searchParams.get('revision')))
    .toEqual([
      'keyword-analysis-fixture-revision',
      'keyword-analysis-fixture-revision'
    ]);
  expect(resourceRequests.map((request) => request.searchParams.get('keywordName')))
    .toEqual(['电子围栏厂家', '电子围栏厂家']);
});

test('search-term table sends pagination, query, and sort to the resource', async ({ page }) => {
  const requests: URL[] = [];
  let dashboardRequests = 0;
  await page.unroute('**/api/marketing/projects/11/dashboard**');
  await page.route('**/api/marketing/projects/11/dashboard**', (route) => {
    dashboardRequests += 1;
    return fulfillDashboardFixture(route);
  });
  await page.unroute('**/api/marketing/projects/11/search-terms**');
  await page.route('**/api/marketing/projects/11/search-terms**', (route) => {
    const request = new URL(route.request().url());
    requests.push(request);
    const base = searchTermResourceFixture(route.request().url());
    const allItems = Array.from({ length: 25 }, (_, index) => ({
      ...marketingFixture().searchTerms[0],
      searchTerm: `分页搜索词 ${String(index + 1).padStart(2, '0')}`,
      impressions: String(100 - index)
    })).filter((item) => (
      !request.searchParams.get('query')
      || item.searchTerm.includes(request.searchParams.get('query') || '')
    ));
    const requestedPage = Number(request.searchParams.get('page') || 1);
    const requestedPageSize = Number(request.searchParams.get('pageSize') || 20);
    base.items = allItems.slice(
      (requestedPage - 1) * requestedPageSize,
      requestedPage * requestedPageSize
    );
    base.pagination = {
      page: requestedPage,
      pageSize: requestedPageSize,
      totalItems: allItems.length,
      totalPages: allItems.length ? Math.ceil(allItems.length / requestedPageSize) : 0
    };
    base.summary = allItems.reduce((total, item) => ({
      impressions: (BigInt(total.impressions) + BigInt(item.impressions)).toString(),
      clicks: (BigInt(total.clicks) + BigInt(item.clicks)).toString(),
      costAmountScaled: (
        BigInt(total.costAmountScaled) + BigInt(item.costAmountScaled)
      ).toString()
    }), { impressions: '0', clicks: '0', costAmountScaled: '0' });
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(base)
    });
  });

  await page.goto('/geo/keyword-analysis/search-terms?view=all');
  await expect(page.getByText('分页搜索词 01', { exact: true })).toBeVisible();
  await page.getByRole('listitem', { name: '2' }).click();
  await expect(page.getByText('分页搜索词 21', { exact: true })).toBeVisible();
  await expect.poll(() => requests.some((request) => (
    request.searchParams.get('page') === '2'
    && request.searchParams.get('pageSize') === '20'
  ))).toBe(true);

  await page.getByLabel('搜索广告搜索词').fill('分页搜索词 25');
  await expect(page.getByText('分页搜索词 25', { exact: true })).toBeVisible();
  await expect.poll(() => requests.some((request) => (
    request.searchParams.get('query') === '分页搜索词 25'
  ))).toBe(true);

  await page.getByRole('columnheader', { name: '展现' }).click();
  await expect.poll(() => requests.some((request) => (
    request.searchParams.get('sortBy') === 'impressions'
  ))).toBe(true);
  expect(dashboardRequests).toBe(3);
  expect(new Set(requests.map((request) => request.searchParams.get('revision'))))
    .toEqual(new Set(['keyword-analysis-fixture-revision']));
});

test('keyword analysis keeps page width stable at 1280px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.goto('/geo/keyword-analysis');

  await expect(page.getByText('关键词效率分布')).toBeVisible();
  await expect(page.getByText('优化标签分布')).toBeVisible();
  expect(await page.evaluate(() => ({
    viewport: window.innerWidth,
    pageWidth: document.documentElement.scrollWidth
  }))).toEqual({ viewport: 1280, pageWidth: 1280 });

  await page.screenshot({
    path: path.join(artifactDirectory, 'keyword-analysis-1280.png'),
    fullPage: true
  });
});

test('ad delivery detail defaults to campaigns and keeps unsupported lower-level status honest', async ({ page }) => {
  await page.goto('/geo/ad-performance');

  await expect(page.getByRole('heading', { name: '投放明细' })).toBeVisible();
  const table = page.getByRole('table', { name: '广告投放明细表格' });
  await expect(table.getByText('PC-周界报警', { exact: true }).first()).toBeVisible();
  await expect(table.getByText('移动-周界报警', { exact: true }).first()).toBeVisible();
  await expect(table.getByText('电子围栏 / 意向词', { exact: true })).toHaveCount(0);
  await expect(table.getByText('投放中', { exact: true })).toHaveCount(0);
  await expect(table.getByText('未提供', { exact: true })).toHaveCount(7);

  const rowsBeforeCampaignExpansion = await table.getByRole('row').count();
  await page.getByRole('button', { name: '展开PC-周界报警' }).first().click();
  await expect.poll(() => table.getByRole('row').count())
    .toBeGreaterThan(rowsBeforeCampaignExpansion);
  await expect.poll(() => table.getByText('未提供', { exact: true }).count())
    .toBeGreaterThan(7);
});

test('advertising hierarchy pins the dashboard revision without reading legacy detail arrays', async ({ page }) => {
  const dashboardRequests: string[] = [];
  const hierarchyRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/marketing/projects/11/dashboard')) {
      dashboardRequests.push(request.url());
    }
    if (request.url().includes('/api/marketing/projects/11/ad-hierarchy')) {
      hierarchyRequests.push(request.url());
    }
  });

  await page.goto('/geo/ad-performance');
  await expect(page.getByRole('heading', { name: '投放明细' })).toBeVisible();
  expect(dashboardRequests).toHaveLength(3);
  expect(hierarchyRequests).toHaveLength(2);
  const hierarchyUrls = hierarchyRequests.map((request) => new URL(request));
  const dashboardUrl = new URL(dashboardRequests.at(-1)!);
  expect(new Set(hierarchyUrls.map((url) => url.searchParams.get('revision'))))
    .toEqual(new Set(['keyword-analysis-fixture-revision']));
  const currentUrl = hierarchyUrls.find((url) => (
    url.searchParams.get('from') === dashboardUrl.searchParams.get('from')
    && url.searchParams.get('to') === dashboardUrl.searchParams.get('to')
  ));
  expect(currentUrl).toBeDefined();
  const previousUrl = hierarchyUrls.find((url) => url !== currentUrl)!;
  const currentFrom = Date.parse(`${currentUrl!.searchParams.get('from')}T00:00:00.000Z`);
  const currentTo = Date.parse(`${currentUrl!.searchParams.get('to')}T00:00:00.000Z`);
  const previousFrom = Date.parse(`${previousUrl.searchParams.get('from')}T00:00:00.000Z`);
  const previousTo = Date.parse(`${previousUrl.searchParams.get('to')}T00:00:00.000Z`);
  expect(previousTo + 86_400_000).toBe(currentFrom);
  expect(previousTo - previousFrom).toBe(currentTo - currentFrom);
  await expect(keywordMetric(page, '总展现'))
    .toContainText(/上期\s*[\d,]+/u);
  await expect(page.getByLabel('总展现上期：暂无数据')).toHaveCount(0);
});

test('advertising keeps current facts when the previous period is outside coverage', async ({ page }) => {
  let hierarchyRequestCount = 0;
  await page.unroute('**/api/marketing/projects/11/ad-hierarchy**');
  await page.route('**/api/marketing/projects/11/ad-hierarchy**', (route) => {
    hierarchyRequestCount += 1;
    if (hierarchyRequestCount === 2) {
      return route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'DASHBOARD_DATE_OUT_OF_RANGE',
            message: '上一周期超出当前快照覆盖范围'
          }
        })
      });
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(adHierarchyResourceFixture(route.request().url()))
    });
  });

  await page.goto('/geo/ad-performance');
  await expect(page.getByRole('heading', { name: '投放明细' })).toBeVisible();
  await expect(page.getByRole('table', { name: '广告投放明细表格' }))
    .toContainText('PC-周界报警');
  const previous = page.getByRole('note', {
    name: /总展现上期：暂无数据。上一周期超出当前快照覆盖范围/u
  });
  await expect(previous).toBeVisible();
  await previous.focus();
  await expect(page.getByRole('tooltip'))
    .toContainText('上一周期超出当前快照覆盖范围');
  const trend = page.getByRole('img', {
    name: /总体消费每日趋势.*仅展示本期，上期不可用：上一周期超出当前快照覆盖范围/u
  });
  await expect(trend).toBeVisible();
  await expect(trend.getByText(/较前 7 天/u)).toHaveCount(0);
});

test('advertising selected object without previous identity hides the comparison series', async ({ page }) => {
  let hierarchyRequestCount = 0;
  await page.unroute('**/api/marketing/projects/11/ad-hierarchy**');
  await page.route('**/api/marketing/projects/11/ad-hierarchy**', (route) => {
    hierarchyRequestCount += 1;
    const fixture = adHierarchyResourceFixture(route.request().url());
    if (hierarchyRequestCount === 2) {
      const previousIdentity = <T extends { campaignId: string }>(row: T) => ({
        ...row,
        campaignId: `${row.campaignId}-previous`
      });
      fixture.campaigns = fixture.campaigns.map(previousIdentity);
      fixture.adGroups = fixture.adGroups.map(previousIdentity);
      fixture.keywords = fixture.keywords.map(previousIdentity);
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(fixture)
    });
  });

  await page.goto('/geo/ad-performance');
  const campaignRow = page.getByRole('table', { name: '广告投放明细表格' })
    .getByRole('row')
    .filter({ hasText: 'PC-周界报警' })
    .first();
  await campaignRow.click();
  const trend = page.getByRole('img', {
    name: /PC-周界报警消费每日趋势.*仅展示本期，上期不可用：所选对象在上一周期没有可匹配事实/u
  });
  await expect(trend).toBeVisible();
  await expect(trend.getByText(/较前 7 天/u)).toHaveCount(0);
});

test('advertising preserves retryable previous-period failure instead of calling it no data', async ({ page }) => {
  let hierarchyRequestCount = 0;
  await page.unroute('**/api/marketing/projects/11/ad-hierarchy**');
  await page.route('**/api/marketing/projects/11/ad-hierarchy**', (route) => {
    hierarchyRequestCount += 1;
    if (hierarchyRequestCount === 2) {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'MARKETING_UPSTREAM_UNAVAILABLE',
            message: '上一周期上游暂时不可用'
          }
        })
      });
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(adHierarchyResourceFixture(route.request().url()))
    });
  });

  await page.goto('/geo/ad-performance');
  await expect(page.getByRole('heading', { name: '投放明细' })).toBeVisible();
  const warning = page.getByRole('alert').filter({
    hasText: '上一周期比较读取失败'
  });
  await expect(warning).toContainText('上一周期上游暂时不可用');
  await expect(warning.getByRole('button', { name: /重\s*试/u })).toBeVisible();
  await expect(page.getByRole('table', { name: '广告投放明细表格' }))
    .toContainText('PC-周界报警');
});

test('advertising discards a late previous request generation after the date changes', async ({ page }) => {
  let releaseFirstGeneration: (() => void) | undefined;
  const firstGenerationGate = new Promise<void>((resolve) => {
    releaseFirstGeneration = resolve;
  });
  let hierarchyRequestCount = 0;
  await page.unroute('**/api/marketing/projects/11/ad-hierarchy**');
  await page.route('**/api/marketing/projects/11/ad-hierarchy**', async (route) => {
    hierarchyRequestCount += 1;
    if (hierarchyRequestCount <= 2) await firstGenerationGate;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(adHierarchyResourceFixture(route.request().url()))
    });
  });

  await page.goto('/geo/ad-performance');
  await expect.poll(() => hierarchyRequestCount).toBe(2);
  await page.getByLabel('广告表现日期范围').first().click();
  await page.getByText('最近 14 天', { exact: true }).last().click();
  await expect.poll(() => hierarchyRequestCount).toBe(4);
  await expect(page.getByRole('img', { name: /每日趋势，近 14 天与较前 14 天/u }))
    .toBeVisible();

  releaseFirstGeneration?.();
  await expect.poll(() => page.getByRole('img', {
    name: /每日趋势，近 14 天与较前 14 天/u
  }).count())
    .toBeGreaterThan(0);
  await expect(page.getByRole('img', { name: /每日趋势，近 7 天与较前 7 天/u }))
    .toHaveCount(0);
});

test('migrated detail pages use the lightweight dashboard root', async ({ page }) => {
  await page.unroute('**/api/marketing/projects/11/dashboard**');
  await page.route(
    '**/api/marketing/projects/11/dashboard**',
    fulfillDashboardFixture
  );
  await page.goto('/geo/keyword-analysis');
  await expect(page.getByText('振动光纤价格').first()).toBeVisible();

  await page.goto('/geo/ad-performance');
  await expect(page.getByRole('heading', { name: '投放明细' })).toBeVisible();

  await page.goto('/geo/keyword-analysis/search-terms?view=all');
  await expect(page.getByText('电子围栏厂家报价', { exact: true })).toBeVisible();
});

test('advertising page rejects an orphan keyword from the hierarchy resource', async ({ page }) => {
  await page.unroute('**/api/marketing/projects/11/ad-hierarchy**');
  await page.route('**/api/marketing/projects/11/ad-hierarchy**', (route) => {
    const invalid = adHierarchyResourceFixture(route.request().url());
    invalid.adGroups = [];
    invalid.hierarchyCounts.adGroups = 0;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(invalid)
    });
  });
  await page.goto('/geo/ad-performance');
  await expect(page.getByText('广告数据读取失败，请稍后重试。'))
    .toBeVisible();
});

test('stale snapshot warns and preserves keyword data with retry', async ({ page }) => {
  await page.unroute('**/api/marketing/projects/11/dashboard**');
  await page.route('**/api/marketing/projects/11/dashboard**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(dashboardFixture(true))
  }));
  await page.goto('/geo/keyword-analysis');

  const warning = page.getByRole('alert').filter({
    hasText: 'BAIDU_REPORT_SNAPSHOT_UNSTABLE'
  });
  await expect(warning).toContainText('截至 2026-08-03');
  await expect(warning.getByRole('button', { name: /重\s*试/u })).toBeVisible();
  await expect(keywordMetric(page, '广告关键词数')).toContainText('302');
  await expect(page.getByText('振动光纤价格').first()).toBeVisible();
});

test('stale snapshot clamps a crossed-day default to the last completed coverage', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-08-05T04:00:00.000Z'));
  await page.unroute('**/api/marketing/projects/11/dashboard**');
  await page.unroute('**/api/marketing/projects/11/keywords**');
  const requestedRanges: Array<string | null> = [];
  let previousRequests = 0;
  let releasePrevious: (() => void) | undefined;
  const previousGate = new Promise<void>((resolve) => {
    releasePrevious = resolve;
  });
  await page.route('**/api/marketing/projects/11/dashboard**', (route) => {
    const url = new URL(route.request().url());
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    requestedRanges.push(from && to ? `${from}:${to}` : null);
    if (to === '2026-08-04') {
      return route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'DASHBOARD_DATE_OUT_OF_RANGE',
            message: '日期筛选超出当前快照覆盖范围'
          }
        })
      });
    }
    const response = dashboardFixture(true);
    if (from && to) response.filter = { from, to } as typeof response.filter;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(response)
    });
  });
  await page.route('**/api/marketing/projects/11/keywords**', async (route) => {
    const request = new URL(route.request().url());
    if ((request.searchParams.get('to') || '') < '2026-07-28') {
      previousRequests += 1;
      await previousGate;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(keywordResourceFixture(route.request().url()))
    });
  });

  await page.goto('/geo/keyword-analysis');

  await expect(keywordMetric(page, '广告关键词数')).toContainText('302');
  await expect.poll(() => previousRequests).toBe(1);
  const pageTwo = page.locator('.ant-pagination-item-2');
  await pageTwo.click();
  await expect(pageTwo).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => previousRequests).toBe(1);
  await expect(page.getByRole('status'))
    .toContainText('正在加载上一周期关键词比较');
  await expect(page.getByRole('alert').filter({
    hasText: '上一周期关键词比较读取失败'
  })).toHaveCount(0);
  releasePrevious?.();
  await expect(keywordMetric(page, '广告关键词数'))
    .toContainText(/本期\s*302\s*上期\s*302/u);
  await expect(page.getByText('日期筛选超出当前快照覆盖范围')).toHaveCount(0);
  await expect.poll(() => requestedRanges).toEqual([
    '2026-07-29:2026-08-04',
    null,
    '2026-07-28:2026-08-03'
  ]);
});

test('stale snapshot warns and preserves advertising data with retry', async ({ page }) => {
  await page.unroute('**/api/marketing/projects/11/dashboard**');
  await page.route('**/api/marketing/projects/11/dashboard**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(dashboardFixture(true))
  }));
  await page.goto('/geo/ad-performance');

  const warning = page.getByRole('alert').filter({
    hasText: 'BAIDU_REPORT_SNAPSHOT_UNSTABLE'
  });
  await expect(warning).toContainText('截至 2026-08-03');
  await expect(warning.getByRole('button', { name: /重\s*试/u })).toBeVisible();
  await expect(page.getByText('总展现')).toBeVisible();
  await expect(page.getByText('投放明细')).toBeVisible();
});

test('keyword page rejects a dashboard belonging to another project', async ({ page }) => {
  await page.unroute('**/api/marketing/projects/11/dashboard**');
  await page.route('**/api/marketing/projects/11/dashboard**', (route) => {
    const invalid = dashboardFixture();
    invalid.projectId = '12';
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(invalid)
    });
  });
  await page.goto('/geo/keyword-analysis');

  await expect(page.getByText('关键词数据读取失败，请稍后重试。'))
    .toBeVisible();
  await expect(page.getByText('百度推广 · 真实数据', { exact: false }))
    .toHaveCount(0);
});

test('advertising page rejects an impossible data-with-NA state', async ({ page }) => {
  await page.unroute('**/api/marketing/projects/11/dashboard**');
  await page.route('**/api/marketing/projects/11/dashboard**', (route) => {
    const invalid = dashboardFixture();
    invalid.states.snapshotFreshnessState = 'NA';
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(invalid)
    });
  });
  await page.goto('/geo/ad-performance');

  await expect(page.getByText('广告数据读取失败，请稍后重试。'))
    .toBeVisible();
  await expect(page.getByText('周期汇总指标')).toHaveCount(0);
});
