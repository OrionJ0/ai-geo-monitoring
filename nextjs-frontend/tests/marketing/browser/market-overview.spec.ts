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

const sourceWeights = {
  BAIDU_PAID: 20,
  DIRECT: 25,
  BAIDU_SEARCH: 20,
  BING_SEARCH: 0,
  GOOGLE_SEARCH: 10,
  OTHER_SEARCH: 5,
  EXTERNAL_REFERRAL: 10
} as const;

function datesBetween(from: string, to: string) {
  const dates: string[] = [];
  for (
    let cursor = Date.parse(`${from}T00:00:00.000Z`);
    cursor <= Date.parse(`${to}T00:00:00.000Z`);
    cursor += 86_400_000
  ) dates.push(new Date(cursor).toISOString().slice(0, 10));
  return dates;
}

function previousRange(from: string, to: string) {
  const days = datesBetween(from, to).length;
  const previousTo = new Date(Date.parse(`${from}T00:00:00.000Z`) - 86_400_000);
  const previousFrom = new Date(previousTo.getTime() - ((days - 1) * 86_400_000));
  return {
    from: previousFrom.toISOString().slice(0, 10),
    to: previousTo.toISOString().slice(0, 10)
  };
}

function totalMetrics(date: string) {
  const offset = Math.floor(
    (Date.parse(`${date}T00:00:00.000Z`) - Date.parse('2026-06-05T00:00:00.000Z'))
      / 86_400_000
  );
  return {
    visits: String(950 + ((offset % 30) * 11)),
    visitors: String(720 + ((offset % 30) * 9)),
    pageviews: String(2500 + ((offset % 30) * 19))
  };
}

function sourceVisits(
  date: string,
  sourceKey: keyof typeof sourceWeights
) {
  return (
    BigInt(totalMetrics(date).visits) * BigInt(sourceWeights[sourceKey]) / BigInt(100)
  ).toString();
}

function totalForDates(dates: string[], field: 'visits' | 'visitors' | 'pageviews') {
  return dates.reduce(
    (total, date) => total + BigInt(totalMetrics(date)[field]),
    BigInt(0)
  ).toString();
}

function sourceTotalForDates(
  dates: string[],
  sourceKey: keyof typeof sourceWeights
) {
  return dates.reduce(
    (total, date) => total + BigInt(sourceVisits(date, sourceKey)),
    BigInt(0)
  ).toString();
}

function websiteTrafficOverview(url: string) {
  const params = new URL(url).searchParams;
  const from = params.get('from') || '2026-07-28';
  const to = params.get('to') || '2026-08-03';
  const device = params.get('device') || 'pc';
  const sourceKey = (params.get('source') || 'ALL') as 'ALL' | keyof typeof sourceWeights;
  const currentDates = datesBetween(from, to);
  const previous = previousRange(from, to);
  const previousDates = datesBetween(previous.from, previous.to);
  const selectedCurrent = (date: string) => sourceKey === 'ALL'
    ? totalMetrics(date).visits
    : sourceVisits(date, sourceKey);
  const selectedPrevious = (date: string) => sourceKey === 'ALL'
    ? totalMetrics(date).visits
    : sourceVisits(date, sourceKey);
  const sourceQualityRows = trafficSources.sources.map((source) => {
    const key = source.sourceKey as keyof typeof sourceWeights;
    return {
      sourceKey: key,
      sourceLabel: source.sourceLabel,
      visits: sourceTotalForDates(currentDates, key),
      trafficShare: `${sourceWeights[key]}.0`,
      bounceRate: null,
      averageVisitTime: null,
      averageVisitPages: null,
      dataState: 'DATA'
    };
  });
  const sourceComparison = {
    metric: 'visits',
    state: 'COMPLETE',
    rows: trafficSources.sources.map((source) => {
      const key = source.sourceKey as keyof typeof sourceWeights;
      const current = sourceTotalForDates(currentDates, key);
      const previousTotal = sourceTotalForDates(previousDates, key);
      return {
        sourceKey: key,
        sourceLabel: source.sourceLabel,
        summaryState: 'DATA',
        trendState: 'DATA',
        summary: {
          current,
          previous: previousTotal,
          changePercent: previousTotal === '0' ? null : '5.0',
          trafficShare: `${sourceWeights[key]}.0`
        },
        trend: currentDates.map((date) => ({
          date,
          visits: sourceVisits(date, key)
        }))
      };
    })
  };
  return {
    projectId: '11',
    source: 'BAIDU_TONGJI',
    mode: 'DATABASE_RANGE_SNAPSHOT',
    site: { domain: 'gato.com.cn' },
    device,
    coverage: { from, to },
    previousCoverage: previous,
    selectedSource: {
      sourceKey,
      sourceLabel: sourceKey === 'ALL'
        ? '全部来源'
        : trafficSources.sources.find((source) => source.sourceKey === sourceKey)?.sourceLabel
    },
    selectedMetric: 'visits',
    selectedMetricState: 'DATA',
    dataState: 'DATA',
    summary: {
      visits: {
        current: totalForDates(currentDates, 'visits'),
        previous: totalForDates(previousDates, 'visits'),
        changePercent: '5.0'
      },
      visitors: {
        current: totalForDates(currentDates, 'visitors'),
        previous: totalForDates(previousDates, 'visitors'),
        changePercent: '4.0'
      },
      pageviews: {
        current: totalForDates(currentDates, 'pageviews'),
        previous: totalForDates(previousDates, 'pageviews'),
        changePercent: '6.0'
      },
      bounceRate: { current: null, previous: null, changePoints: null },
      averageVisitTime: { current: null, previous: null, changeSeconds: null },
      averageVisitPages: { current: null, previous: null, changePages: null }
    },
    trend: currentDates.map((date, index) => ({
      date,
      previousDate: previousDates[index],
      current: selectedCurrent(date),
      previous: selectedPrevious(previousDates[index])
    })),
    sourceQuality: { allSiteBounceRate: null, rows: sourceQualityRows },
    ...(params.get('includeSourceComparison') === 'true'
      ? { sourceComparison }
      : {}),
    capabilities: {
      trafficCounts: true,
      sourceTraffic: true,
      qualityMetrics: false,
      pageReports: false,
      sourcePageCorrelation: false,
      unavailableReason: '测试数据未开放质量指标'
    },
    cache: { state: 'HIT' }
  };
}

const websiteForms = {
  projectId: '11',
  sourceSystem: 'GATO_WEBSITE',
  consultationType: 'WEBSITE_FORM',
  dataCoverage: 'ALL_FORM_RECORDS',
  coverage: {
    from: '2026-07-05',
    to: '2026-08-03',
    timeZone: 'Asia/Shanghai'
  },
  dataState: 'DATA',
  summary: { formConsultationRecords: '7' },
  sourceBreakdown: [
    {
      sourceKey: 'BAIDU_PAID',
      formConsultationRecords: '2'
    },
    {
      sourceKey: 'DIRECT',
      formConsultationRecords: '1'
    },
    {
      sourceKey: 'UNKNOWN',
      formConsultationRecords: '4'
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
  await page.route('**/api/marketing/projects/11/website-traffic-overview**', (route) => {
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(websiteTrafficOverview(route.request().url()))
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
  const retiredRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/tongji-(?:trend|source-trends)/u.test(request.url())) {
      retiredRequests.push(request.url());
    }
  });
  await installDashboard(page);
  await page.setViewportSize({ width: 1440, height: 1024 });
  const initialSourceRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.endsWith('/website-traffic-overview')
      && url.searchParams.get('source') === 'ALL'
      && url.searchParams.get('includeSourceComparison') === 'true';
  });
  await page.goto('/geo/market-overview');
  expect(new URL((await initialSourceRequest).url()).searchParams.get('device')).toBe('pc');
  expect(retiredRequests).toEqual([]);

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
  await expect(trendSourceControl).toContainText('全部');
  await expect(page.getByLabel('渠道趋势图例').getByRole('button')).toHaveCount(7);
  const directLegend = page.getByRole('button', { name: '隐藏直接访问趋势' });
  await directLegend.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '显示直接访问趋势' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '隐藏直接访问趋势' })).toBeVisible();
  await trendSourceControl.click();
  await page.getByRole('option', { name: '百度推广' }).click();
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
  await expect(page.getByRole('img', { name: /访问每日趋势/u })).toBeVisible();
  await page.getByRole('button', { name: '选择访问作为趋势指标' }).click();
  await expect(trendSourceControl).toContainText('百度自然搜索');
  await trendSourceControl.click();
  await page.getByRole('option', { name: '百度推广' }).click();
  await expect(trendSourceControl).toContainText('百度推广');
  await expect(page.getByRole('img', { name: /访问每日趋势/u })).toBeVisible();
  await expect(page.getByText('自然搜索', { exact: true })).toHaveCount(4);
  await expect(page.getByRole('columnheader', { name: /官网咨询/u })).toBeVisible();
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

test('full-journey table uses channel branding without redundant Tongji copy', async ({ page }) => {
  await installDashboard(page);
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto('/geo/market-overview');
  await expect(page.locator('.ant-skeleton')).toHaveCount(0);

  const journeyTable = page.getByRole('region', { name: '全链路数据表格' });
  await expect(journeyTable.getByText('所选区间的百度统计访问次数')).toHaveCount(0);
  await expect(journeyTable.getByText('来自百度统计', { exact: true })).toHaveCount(0);
  for (const [label, brand] of [
    ['百度推广', 'baidu'],
    ['百度自然搜索', 'baidu'],
    ['必应自然搜索', 'bing'],
    ['Google 自然搜索', 'google']
  ]) {
    await expect(journeyTable.getByRole('img', { name: `${label}渠道图标` }))
      .toHaveAttribute('data-brand', brand);
  }
});

test('channel rows switch and restore the range trend with keyboard input', async ({ page }) => {
  await installDashboard(page);
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto('/geo/market-overview');
  await expect(page.locator('.ant-skeleton')).toHaveCount(0);

  const directRow = page.getByRole('row', { name: /直接访问/u });
  const request = page.waitForRequest((pending) => {
    const url = new URL(pending.url());
    return url.pathname.endsWith('/website-traffic-overview')
      && url.searchParams.get('source') === 'DIRECT';
  });
  await directRow.focus();
  await page.keyboard.press('Enter');
  expect(new URL((await request).url()).searchParams.get('device')).toBe('pc');
  await expect(directRow).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('趋势来源').locator(
    'xpath=ancestor::div[contains(@class,"ant-select")][1]'
  )).toContainText('直接访问');

  await directRow.focus();
  await page.keyboard.press('Space');
  await expect(directRow).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByLabel('趋势来源').locator(
    'xpath=ancestor::div[contains(@class,"ant-select")][1]'
  )).toContainText('全部');
  await expect(directRow.getByRole('link')).toHaveAttribute('href', '/geo/website-traffic');
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
  await page.route('**/api/marketing/projects/11/website-traffic-overview**', (route) => {
    const base = websiteTrafficOverview(route.request().url());
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ...base,
        selectedMetricState: 'NO_DATA',
        dataState: 'NO_DATA',
        summary: {
          visits: { current: null, previous: null, changePercent: null },
          visitors: { current: null, previous: null, changePercent: null },
          pageviews: { current: null, previous: null, changePercent: null },
          bounceRate: { current: null, previous: null, changePoints: null },
          averageVisitTime: { current: null, previous: null, changeSeconds: null },
          averageVisitPages: { current: null, previous: null, changePages: null }
        },
        trend: [],
        sourceQuality: {
          allSiteBounceRate: null,
          rows: base.sourceQuality.rows.map((source) => ({
            ...source,
            visits: null,
            trafficShare: null,
            dataState: 'NO_DATA'
          }))
        },
        sourceComparison: base.sourceComparison ? {
          metric: 'visits',
          state: 'COMPLETE',
          rows: base.sourceComparison.rows.map((source) => ({
            ...source,
            summaryState: 'NO_DATA',
            trendState: 'NO_DATA',
            summary: {
              current: null,
              previous: null,
              changePercent: null,
              trafficShare: null
            },
            trend: []
          }))
        } : undefined
      })
    });
  });
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto('/geo/market-overview');
  await expect(page.getByText('当前范围没有趋势数据')).toBeVisible();
  await expect(page.getByRole('row', { name: /直接访问/u })).toContainText('—');
  await page.screenshot({ path: artifact('market-overview-empty-1440x1024.png') });
});

test('partial source error stays local instead of becoming a market action item', async ({ page }) => {
  await installDashboardError(page);
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto('/geo/market-overview');
  await expect(page.getByText('广告来源读取失败')).toHaveCount(0);
  await expect(page.getByRole('row', { name: /直接访问/u })).toBeVisible();
  await expect(page.getByRole('heading', { name: '每日趋势' })).toBeVisible();
  await page.screenshot({ path: artifact('market-overview-partial-error-1440x1024.png') });
});

test('stale snapshot preserves data with a local freshness label', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installDashboard(page, dashboard({ freshness: 'STALE' }));
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto('/geo/market-overview');
  await expect(page.getByText('BAIDU_REPORT_SNAPSHOT_UNSTABLE')).toHaveCount(0);
  const adRow = page.getByRole('row', { name: /百度推广/u });
  await expect(adRow).toContainText('截至 2026-08-03 的最后成功广告快照');
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
