import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';

const artifactDirectory = path.resolve(
  process.cwd(),
  '../output/playwright/market-overview-fixture'
);

function isoDate(offset: number) {
  const date = new Date('2026-06-05T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

const trend = Array.from({ length: 60 }, (_, index) => ({
  date: isoDate(index),
  impressions: String(33000 + ((index % 9) * 1700)),
  clicks: String(540 + ((index % 8) * 43)),
  costAmountScaled: String(3200000000 + ((index % 10) * 135000000))
}));

function sum(field: 'impressions' | 'clicks' | 'costAmountScaled') {
  return trend.reduce(
    (total, row) => total + BigInt(row[field]),
    BigInt(0)
  ).toString();
}

function dashboard(options: {
  freshness?: 'FRESH' | 'STALE';
  content?: 'DATA' | 'NONE' | 'ZERO';
} = {}) {
  const content = options.content || 'DATA';
  return {
    projectId: '11',
    projectName: '上海广拓',
    revision: content === 'NONE' ? null : 'market-overview-visual-fixture',
    states: {
      moduleState: 'READY',
      projectState: 'ACTIVE',
      sourceSummaryState: 'CONNECTED',
      bindingSummaryState: 'ACTIVE',
      snapshotContentState: content,
      snapshotFreshnessState: content === 'NONE'
        ? 'NA'
        : options.freshness || 'FRESH',
      refreshState: 'SUCCEEDED'
    },
    bindings: [{
      bindingId: 'binding-1',
      accountId: 'baidu-search-1',
      accountName: '广拓百度搜索推广',
      sourceState: 'CONNECTED',
      bindingState: 'ACTIVE',
      blockingCode: null
    }],
    coverage: content === 'NONE' ? null : {
      from: '2026-06-05',
      to: '2026-08-03',
      lastSuccessfulAt: '2026-08-03T03:58:00.000Z',
      currency: 'CNY',
      costScale: 6
    },
    filter: { from: '2026-07-05', to: '2026-08-03' },
    summary: {
      impressions: content === 'DATA' ? sum('impressions') : '0',
      clicks: content === 'DATA' ? sum('clicks') : '0',
      costAmountScaled: content === 'DATA' ? sum('costAmountScaled') : '0'
    },
    trend: content === 'DATA' ? trend : [],
    campaigns: content === 'DATA' ? [{
      accountId: 'baidu-search-1',
      campaignId: 'campaign-1',
      campaignName: '广拓品牌推广',
      impressions: sum('impressions'),
      clicks: sum('clicks'),
      costAmountScaled: sum('costAmountScaled'),
      trend
    }] : [],
    adGroups: [],
    keywords: [],
    searchTerms: [],
    hierarchyCounts: {
      campaigns: content === 'DATA' ? 1 : 0,
      adGroups: 0,
      keywords: 0,
      searchTerms: 0
    },
    activeRun: null,
    lastRun: {
      runId: 'run-fixture-1',
      status: options.freshness === 'STALE' ? 'FAILED' : 'SUCCEEDED',
      failureCode: options.freshness === 'STALE'
        ? 'BAIDU_REPORT_SNAPSHOT_UNSTABLE'
        : null
    }
  };
}

const traffic = {
  projectId: '11',
  source: 'BAIDU_TONGJI',
  mode: 'DATABASE_SNAPSHOT',
  site: { siteId: 'site-1', domain: 'gato.com.cn' },
  device: 'all',
  coverage: { from: '2026-07-05', to: '2026-08-03' },
  dataState: 'DATA',
  summary: { pageviews: '84500', visits: '32600', visitors: '25100' },
  trend: trend.slice(30).map((row, index) => ({
    date: row.date,
    pageviews: String(2500 + (index * 19)),
    visits: String(950 + (index * 11)),
    visitors: String(720 + (index * 9))
  })),
  cache: { state: 'HIT', ttlSeconds: 600, refreshedAt: '2026-08-03T03:58:00.000Z' }
};

const trafficSources = {
  projectId: '11',
  source: 'BAIDU_TONGJI',
  mode: 'DATABASE_SNAPSHOT',
  site: { siteId: 'site-1', domain: 'gato.com.cn' },
  device: 'pc',
  coverage: { from: '2026-07-05', to: '2026-08-03' },
  dataState: 'DATA',
  attribution: {
    level: 'WEBSITE_TRAFFIC_SOURCE',
    isCrossSystemVerified: false
  },
  sources: [
    {
      sourceKey: 'BAIDU_PAID',
      sourceLabel: '百度推广',
      sourceHost: 'e.baidu.com',
      sourceDetails: ['百度搜索推广'],
      sourceType: 'PAID',
      multiplier: 4
    },
    {
      sourceKey: 'DIRECT',
      sourceLabel: '直接访问',
      sourceHost: 'gato.com.cn',
      sourceDetails: ['gato.com.cn'],
      sourceType: 'DIRECT',
      multiplier: 5
    },
    {
      sourceKey: 'BAIDU_SEARCH',
      sourceLabel: '百度搜索',
      sourceHost: 'baidu.com',
      sourceDetails: ['百度自然搜索'],
      sourceType: 'ORGANIC_SEARCH',
      multiplier: 3
    },
    {
      sourceKey: 'BING_SEARCH',
      sourceLabel: '必应搜索',
      sourceHost: 'bing.com',
      sourceDetails: [],
      sourceType: 'ORGANIC_SEARCH',
      multiplier: 0
    },
    {
      sourceKey: 'GOOGLE_SEARCH',
      sourceLabel: 'Google 搜索',
      sourceHost: 'google.com',
      sourceDetails: ['Google'],
      sourceType: 'ORGANIC_SEARCH',
      multiplier: 2
    },
    {
      sourceKey: 'OTHER_SEARCH',
      sourceLabel: '其他搜索',
      sourceHost: '多个搜索引擎',
      sourceDetails: ['搜狗'],
      sourceType: 'ORGANIC_SEARCH',
      multiplier: 1
    },
    {
      sourceKey: 'EXTERNAL_REFERRAL',
      sourceLabel: '外部引荐',
      sourceHost: '多个网站',
      sourceDetails: ['外部链接'],
      sourceType: 'REFERRAL',
      multiplier: 1
    }
  ].map(({ sourceKey, sourceLabel, sourceHost, sourceDetails, sourceType, multiplier }) => {
    const sourceTrend = traffic.trend.map((row, index) => ({
      date: row.date,
      pageviews: String((240 + index) * multiplier),
      visits: String((90 + index) * multiplier),
      visitors: String((70 + index) * multiplier)
    }));
    return {
      sourceKey,
      sourceLabel,
      sourceHost,
      sourceType,
      sourceDetails,
      dataState: 'DATA',
      summary: {
        pageviews: sourceTrend.reduce(
          (total, row) => total + BigInt(row.pageviews),
          BigInt(0)
        ).toString(),
        visits: sourceTrend.reduce(
          (total, row) => total + BigInt(row.visits),
          BigInt(0)
        ).toString(),
        visitors: sourceTrend.reduce(
          (total, row) => total + BigInt(row.visitors),
          BigInt(0)
        ).toString()
      }
    };
  }),
  cache: { state: 'HIT', ttlSeconds: 600, refreshedAt: '2026-08-03T03:58:00.000Z' }
};

const trafficSourceMultipliers = {
  BAIDU_PAID: 4,
  DIRECT: 5,
  BAIDU_SEARCH: 3,
  BING_SEARCH: 0,
  GOOGLE_SEARCH: 2,
  OTHER_SEARCH: 1,
  EXTERNAL_REFERRAL: 1
};

function trafficSourceTrend(
  sourceKey: keyof typeof trafficSourceMultipliers
) {
  const multiplier = trafficSourceMultipliers[sourceKey] || 0;
  return traffic.trend.map((row, index) => ({
    date: row.date,
    pageviews: String((240 + index) * multiplier),
    visits: String((90 + index) * multiplier),
    visitors: sourceKey === 'OTHER_SEARCH'
      ? null
      : String((70 + index) * multiplier)
  }));
}

const websiteForms = {
  projectId: '11',
  sourceSystem: 'GATO_WEBSITE',
  consultationType: 'WEBSITE_FORM',
  dataCoverage: 'ATTRIBUTED_SESSION_SUBMISSIONS_ONLY',
  formRecordTotalAvailable: false,
  coverage: {
    from: '2026-07-05',
    to: '2026-08-03',
    timeZone: 'Asia/Shanghai'
  },
  dataState: 'DATA',
  summary: { attributedFormSubmissionSessions: '7' },
  sourceBreakdown: [
    {
      sourceKey: 'BAIDU_PAID',
      upstreamSources: ['baidu_paid'],
      attributedFormSubmissionSessions: '2'
    },
    {
      sourceKey: 'DIRECT',
      upstreamSources: ['direct'],
      attributedFormSubmissionSessions: '1'
    },
    {
      sourceKey: 'UNKNOWN',
      upstreamSources: ['organic_search'],
      attributedFormSubmissionSessions: '4'
    }
  ],
  cache: {
    state: 'HIT',
    refreshedAt: '2026-08-03T03:58:00.000Z',
    expiresAt: '2026-08-03T04:08:00.000Z'
  }
};

async function installCommonRoutes(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('agd_token', 'playwright.market-overview.signature');
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
  await page.route('**/api/marketing/projects/11/tongji-trend**', (route) => {
    const device = new URL(route.request().url()).searchParams.get('device') || 'all';
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ...traffic, device })
    });
  });
  await page.route('**/api/marketing/projects/11/tongji-source-trends**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    const device = params.get('device') || 'all';
    const sourceKey = params.get('source');
    const selectedSource = trafficSources.sources.find((source) => (
      source.sourceKey === sourceKey
    ));
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ...trafficSources,
        device,
        selectedTrend: selectedSource ? {
          site: trafficSources.site,
          coverage: trafficSources.coverage,
          device,
          sourceKey,
          dataState: selectedSource.dataState,
          summary: selectedSource.summary,
          trend: trafficSourceTrend(
            sourceKey as keyof typeof trafficSourceMultipliers
          ),
          cache: trafficSources.cache
        } : null
      })
    });
  });
  await page.route('**/api/marketing/projects/11/website-traffic-overview**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    const from = params.get('from') || '2026-07-05';
    const to = params.get('to') || '2026-08-03';
    const sourceQualityRows = trafficSources.sources.map((source) => ({
      sourceKey: source.sourceKey,
      sourceLabel: source.sourceLabel,
      visits: source.summary.visits,
      trafficShare: '10',
      bounceRate: null,
      averageVisitTime: null,
      averageVisitPages: null,
      dataState: source.dataState
    }));
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        projectId: '11',
        source: 'BAIDU_TONGJI',
        mode: 'DATABASE_RANGE_SNAPSHOT',
        site: { domain: 'gato.com.cn' },
        device: params.get('device') || 'all',
        coverage: { from, to },
        previousCoverage: { from: '2026-06-05', to: '2026-07-04' },
        selectedSource: { sourceKey: 'ALL', sourceLabel: '全部来源' },
        selectedMetric: 'visits',
        selectedMetricState: 'DATA',
        dataState: 'DATA',
        summary: {
          visits: { current: '32600', previous: '30100', changePercent: '8.3' },
          visitors: { current: '25100', previous: '23900', changePercent: '5.0' },
          pageviews: { current: '84500', previous: '80200', changePercent: '5.4' },
          bounceRate: { current: null, previous: null, changePoints: null },
          averageVisitTime: { current: null, previous: null, changeSeconds: null },
          averageVisitPages: { current: null, previous: null, changePages: null }
        },
        trend: [],
        sourceQuality: { allSiteBounceRate: null, rows: sourceQualityRows },
        capabilities: {
          trafficCounts: true,
          sourceTraffic: true,
          qualityMetrics: false,
          pageReports: false,
          sourcePageCorrelation: false,
          unavailableReason: '测试数据未开放质量指标'
        },
        cache: { state: 'HIT' }
      })
    });
  });
  await page.route(
    '**/api/website-data/projects/11/form-consultations**',
    (route) => {
      const params = new URL(route.request().url()).searchParams;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ...websiteForms,
          coverage: {
            ...websiteForms.coverage,
            from: params.get('from'),
            to: params.get('to')
          }
        })
      });
    }
  );
}

async function installDashboard(
  page: Page,
  response = dashboard(),
  delay = 0
) {
  await page.route('**/api/marketing/projects/11/dashboard**', async (route) => {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(response)
    });
  });
}

async function installDashboardError(page: Page) {
  await page.route('**/api/marketing/projects/11/dashboard**', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({
      error: { code: 'FIXTURE_AD_SOURCE_ERROR', message: '广告快照暂时不可用' }
    })
  }));
}

function artifact(name: string) {
  return path.join(artifactDirectory, name);
}

function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-08-04T04:00:00.000Z'));
  await installCommonRoutes(page);
});

test('desktop layout matches the final structure and is keyboard/axe clean', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  await installDashboard(page);
  await page.setViewportSize({ width: 1440, height: 1024 });
  const initialSourceRequest = page.waitForRequest((request) => (
    request.url().includes('/tongji-source-trends')
    && new URL(request.url()).searchParams.get('source') === null
  ));
  await page.goto('/geo/market-overview');
  expect(
    new URL((await initialSourceRequest).url()).searchParams.get('source')
  ).toBeNull();

  await expect(page.getByRole('heading', { name: '投放效率' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '全链路数据' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '每日趋势' })).toBeVisible();
  await expect(page.getByText('CPC', { exact: true })).toBeVisible();
  await expect(page.locator('.ant-skeleton')).toHaveCount(0);

  const headerBox = await page.locator('.app-header').boundingBox();
  const siderBox = await page.locator('.geo-sider').boundingBox();
  expect(headerBox?.height).toBe(64);
  expect(siderBox?.width).toBe(224);

  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    body: document.body.scrollWidth > document.body.clientWidth
  }));
  expect(overflow).toEqual({ document: false, body: false });

  const efficiencySurface = await page.locator('section[aria-labelledby="efficiency-title"]')
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  const journeySurface = await page.locator('section[aria-labelledby="journey-title"]')
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(efficiencySurface).toBe('rgba(0, 0, 0, 0)');
  expect(journeySurface).toBe('rgb(255, 255, 255)');

  const efficiencySource = page.getByLabel('投放效率付费来源');
  const trendSource = page.getByLabel('趋势来源');
  const trendSourceControl = trendSource.locator(
    'xpath=ancestor::div[contains(@class,"ant-select")][1]'
  );
  await page.getByRole('button', { name: '选择广告投入作为趋势指标' }).click();
  await expect(page.getByRole('img', { name: /广告投入每日趋势/u })).toBeVisible();
  await expect(efficiencySource.locator('xpath=ancestor::div[contains(@class,"ant-select")][1]'))
    .toContainText('百度推广');
  await expect(trendSourceControl).toContainText('百度推广');
  await page.getByRole('button', { name: '选择访问作为趋势指标' }).click();
  await expect(page.getByRole('img', { name: /访问每日趋势/u })).toBeVisible();
  await trendSourceControl.click();
  const selectedSourceRequest = page.waitForRequest((request) => (
    new URL(request.url()).searchParams.get('source') === 'BAIDU_SEARCH'
  ));
  await page.getByRole('option', { name: '百度自然搜索' }).click();
  expect(
    new URL((await selectedSourceRequest).url()).searchParams.get('device')
  ).toBe('pc');
  await expect(page.getByRole('img', { name: /访问次数每日趋势/u })).toBeVisible();
  await page.getByRole('button', { name: '选择访问作为趋势指标' }).click();
  await expect(trendSourceControl).toContainText('百度自然搜索');
  await trendSourceControl.click();
  await page.getByRole('option', { name: '百度推广' }).click();
  await expect(trendSourceControl).toContainText('百度推广');
  await expect(page.getByRole('img', { name: /访问每日趋势/u })).toBeVisible();
  await expect(page.getByText('自然搜索', { exact: true })).toHaveCount(4);
  await expect(page.getByRole('columnheader', { name: '官网表单咨询' })).toBeVisible();
  await expect(page.getByText('未知来源（官网表单）')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '整体转换率' })).toBeVisible();
  await expect(page.locator('[class*="microFunnel"], [class*="funnelChart"]')).toHaveCount(0);

  const device = page.getByLabel('设备');
  const deviceControl = device.locator(
    'xpath=ancestor::div[contains(@class,"ant-select")][1]'
  );
  await deviceControl.click();
  await page.getByRole('option', { name: '移动端' }).click();
  await expect(deviceControl).toContainText('移动端');
  await deviceControl.click();
  await page.getByRole('option', { name: 'PC 端' }).click();

  const info = page.locator('[aria-label="ROAS口径说明"]');
  await info.hover();
  await expect(page.getByRole('tooltip')).toContainText('成交金额 ÷ 广告投入');
  await page.screenshot({ path: artifact('market-overview-hover-tooltip-1440x1024.png') });
  await page.mouse.move(0, 0);
  await expect(page.getByRole('tooltip')).toBeHidden();

  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  expect(consoleErrors).toEqual([]);

  await page.mouse.click(1000, 1000);
  await page.screenshot({ path: artifact('market-overview-desktop-1440x1024.png') });
});

test('390x844 keeps page width stable and uses an overlay sidebar', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  await installDashboard(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/geo/market-overview');
  await expect(page.getByRole('heading', { name: '投放效率' })).toBeVisible();
  await expect(page.locator('.ant-skeleton')).toHaveCount(0);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(overflow).toBe(false);
  const tableRegion = page.getByRole('region', { name: '全链路数据表格' });
  const tableScroll = await tableRegion.evaluate((node) => ({
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth
    }));
  expect(tableScroll.scrollWidth).toBeGreaterThan(tableScroll.clientWidth);
  await page.screenshot({ path: artifact('market-overview-mobile-390x844.png') });

  await tableRegion.scrollIntoViewIfNeeded();
  await tableRegion.evaluate((node) => { node.scrollLeft = 320; });
  await expect.poll(() => tableRegion.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  await page.screenshot({ path: artifact('market-overview-mobile-table-scroll-390x844.png') });
  await page.locator('.geo-content').evaluate((node) => { node.scrollTop = 0; });

  const toggle = page.getByRole('button', { name: '展开侧栏' });
  await toggle.click();
  await expect(page.getByRole('button', { name: '关闭侧栏' })).toBeVisible();
  await expect.poll(async () => (
    (await page.locator('.geo-sider').boundingBox())?.width
  )).toBe(260);
  await page.screenshot({ path: artifact('market-overview-mobile-sidebar-390x844.png') });
  await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused();

  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('reduced motion keeps the final state without active animations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installDashboard(page);
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto('/geo/market-overview');
  await expect(page.locator('.ant-skeleton')).toHaveCount(0);
  expect(await page.evaluate(() => (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ))).toBe(true);
  expect(await page.evaluate(() => (
    document.getAnimations().filter((animation) => animation.playState === 'running').length
  ))).toBe(0);
});

test('loading state uses structural skeletons', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installDashboard(page, dashboard(), 1800);
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto('/geo/market-overview');
  await expect(page.locator('.ant-skeleton').first()).toBeVisible();
  await page.screenshot({ path: artifact('market-overview-loading-1440x1024.png') });
});

test('empty data keeps the table contract without zero-shaped attribution', async ({ page }) => {
  await installDashboard(page, dashboard({ content: 'NONE' }));
  await page.route('**/api/marketing/projects/11/tongji-trend**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ...traffic,
        device: params.get('device') || 'all',
        dataState: 'NO_DATA',
        summary: { pageviews: null, visits: null, visitors: null },
        trend: []
      })
    });
  });
  await page.route('**/api/marketing/projects/11/tongji-source-trends**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    const sourceKey = params.get('source');
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
      ...trafficSources,
      dataState: 'NO_DATA',
      device: params.get('device') || 'all',
      selectedTrend: sourceKey ? {
        site: trafficSources.site,
        coverage: trafficSources.coverage,
        device: params.get('device') || 'all',
        sourceKey,
        dataState: 'NO_DATA',
        summary: { pageviews: null, visits: null, visitors: null },
        trend: [],
        cache: trafficSources.cache
      } : null,
      sources: trafficSources.sources.map((source) => ({
        ...source,
        dataState: 'NO_DATA',
        summary: { pageviews: null, visits: null, visitors: null }
      }))
      })
    });
  });
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto('/geo/market-overview');
  await expect(page.getByText('当前范围没有趋势数据')).toBeVisible();
  await expect(page.getByRole('row', { name: /直接访问/u })).toContainText('—');
  await page.screenshot({ path: artifact('market-overview-empty-1440x1024.png') });
});

test('partial source error preserves the page and reports the failed source', async ({ page }) => {
  await installDashboardError(page);
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto('/geo/market-overview');
  await expect(page.getByText('广告来源读取失败')).toBeVisible();
  await expect(page.getByRole('heading', { name: '每日趋势' })).toBeVisible();
  await page.screenshot({ path: artifact('market-overview-partial-error-1440x1024.png') });
});

test('stale snapshot warns, preserves old overview data, and offers retry', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installDashboard(page, dashboard({ freshness: 'STALE' }));
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto('/geo/market-overview');
  const warning = page.getByRole('alert').filter({
    hasText: 'BAIDU_REPORT_SNAPSHOT_UNSTABLE'
  });
  await expect(warning).toContainText('广告快照刷新失败');
  await expect(warning).toContainText('截至 2026-08-03');
  await expect(warning.getByRole('button', { name: /重\s*试/u })).toBeVisible();
  await expect(page.getByRole('row', { name: /百度推广/u })).toBeVisible();
  await page.screenshot({ path: artifact('market-overview-stale-1440x1024.png') });
});

test('permission blocking state stops data access without exposing a false dashboard', async ({ page }) => {
  await page.route('**/api/geo-projects/default-context', (route) => route.fulfill({
    status: 403,
    contentType: 'application/json',
    body: JSON.stringify({
      error: { code: 'DEFAULT_PROJECT_FORBIDDEN', message: '当前账号无权访问默认项目' }
    })
  }));
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto('/geo/market-overview');
  await expect(page.getByText('默认项目不可用')).toBeVisible();
  await expect(page.getByRole('heading', { name: '投放效率' })).toHaveCount(0);
  await page.screenshot({ path: artifact('market-overview-permission-blocked-1440x1024.png') });
});

test('retired combined route resolves to the only formal overview UI', async ({ page }) => {
  await installDashboard(page);
  await page.goto('/geo/marketing');
  await expect(page).toHaveURL(/\/geo\/market-overview$/u);
  await expect(page.getByRole('heading', { name: '投放效率' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '营销监控' })).toHaveCount(0);
});
