import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
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
  return trend.reduce((total, row) => total + BigInt(row[field]), 0n).toString();
}

function dashboard(options: {
  freshness?: 'FRESH' | 'STALE';
  content?: 'DATA' | 'NONE' | 'ZERO';
} = {}) {
  const content = options.content || 'DATA';
  return {
    projectId: '11',
    projectName: '上海广拓',
    revision: 'market-overview-visual-fixture',
    states: {
      moduleState: 'READY',
      projectState: 'ACTIVE',
      sourceSummaryState: 'CONNECTED',
      bindingSummaryState: 'ACTIVE',
      snapshotContentState: content,
      snapshotFreshnessState: options.freshness || 'FRESH',
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
    coverage: {
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
    campaigns: [],
    activeRun: null,
    lastRun: {
      runId: 'run-fixture-1',
      status: 'SUCCEEDED',
      failureCode: null,
      nextRetryAt: null
    }
  };
}

const traffic = {
  projectId: '11',
  source: 'BAIDU_TONGJI',
  mode: 'LIVE_PILOT',
  site: { siteId: 'site-1', domain: 'gato.com.cn' },
  coverage: { from: '2026-07-05', to: '2026-08-03' },
  dataState: 'DATA',
  summary: { pageviews: '84500', visits: '32600', visitors: '25100' },
  trend: trend.slice(30).map((row, index) => ({
    date: row.date,
    pageviews: String(2500 + (index * 19)),
    visits: String(950 + (index * 11)),
    visitors: String(720 + (index * 9))
  }))
};

const trafficSources = {
  projectId: '11',
  source: 'BAIDU_TONGJI',
  mode: 'LIVE_PILOT',
  site: { siteId: 'site-1', domain: 'gato.com.cn' },
  coverage: { from: '2026-07-05', to: '2026-08-03' },
  dataState: 'DATA',
  attribution: {
    level: 'WEBSITE_TRAFFIC_SOURCE',
    isCrossSystemVerified: false
  },
  sources: [
    { sourceKey: 'DIRECT', sourceLabel: '直接访问', multiplier: 5 },
    { sourceKey: 'SEARCH', sourceLabel: '搜索引擎', multiplier: 3 },
    { sourceKey: 'EXTERNAL', sourceLabel: '外部链接', multiplier: 2 }
  ].map(({ sourceKey, sourceLabel, multiplier }) => {
    const sourceTrend = traffic.trend.map((row, index) => ({
      date: row.date,
      pageviews: String((240 + index) * multiplier),
      visits: String((90 + index) * multiplier),
      visitors: String((70 + index) * multiplier)
    }));
    return {
      sourceKey,
      sourceLabel,
      dataState: 'DATA',
      summary: {
        pageviews: sourceTrend.reduce(
          (total, row) => total + BigInt(row.pageviews),
          0n
        ).toString(),
        visits: sourceTrend.reduce(
          (total, row) => total + BigInt(row.visits),
          0n
        ).toString(),
        visitors: sourceTrend.reduce(
          (total, row) => total + BigInt(row.visitors),
          0n
        ).toString()
      },
      trend: sourceTrend
    };
  })
};

async function installCommonRoutes(page) {
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
  await page.route('**/api/marketing/projects/11/tongji-trend', (route) => (
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(traffic)
    })
  ));
  await page.route('**/api/marketing/projects/11/tongji-source-trends', (route) => (
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(trafficSources)
    })
  ));
}

async function installDashboard(page, response = dashboard(), delay = 0) {
  await page.route('**/api/marketing/projects/11/dashboard**', async (route) => {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(response)
    });
  });
}

async function installDashboardError(page) {
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

function collectConsoleErrors(page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test.beforeEach(async ({ page }) => {
  await installCommonRoutes(page);
});

test('desktop layout matches the final structure and is keyboard/axe clean', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  await installDashboard(page);
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto('/geo/market-overview');

  await expect(page.getByRole('heading', { name: '投放效率' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '来源全链路' })).toBeVisible();
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
  await page.getByRole('button', { name: '选择访问（点击）作为趋势指标' }).click();
  await expect(page.getByRole('img', { name: /访问（点击）每日趋势/u })).toBeVisible();
  await trendSourceControl.click();
  await page.getByRole('option', { name: '搜索引擎（百度统计）' }).click();
  await expect(page.getByRole('img', { name: /访问次数每日趋势/u })).toBeVisible();
  await page.getByRole('button', { name: '选择访问（点击）作为趋势指标' }).click();
  await expect(trendSourceControl).toContainText('搜索引擎（百度统计）');
  await trendSourceControl.click();
  await page.getByRole('option', { name: '百度推广' }).click();
  await expect(trendSourceControl).toContainText('百度推广');
  await expect(page.getByRole('img', { name: /访问（点击）每日趋势/u })).toBeVisible();

  const info = page.getByRole('button', { name: 'ROAS口径说明' });
  await efficiencySource.focus();
  await page.keyboard.press('Tab');
  await expect(info).toBeFocused();
  await expect(page.getByRole('tooltip')).toContainText('成交金额 ÷ 广告投入');
  await expect(page.getByRole('tooltip')).toContainText('本期：2026-07-05 至 2026-08-03');
  const outline = await info.evaluate((node) => getComputedStyle(node).outlineStyle);
  expect(outline).not.toBe('none');
  await page.screenshot({ path: artifact('market-overview-keyboard-tooltip-1440x1024.png') });
  await page.keyboard.press('Escape');
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
  const tableRegion = page.getByRole('region', { name: '来源全链路表格' });
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
  await page.route('**/api/marketing/projects/11/tongji-trend', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      ...traffic,
      dataState: 'NO_DATA',
      summary: { pageviews: null, visits: null, visitors: null },
      trend: []
    })
  }));
  await page.route('**/api/marketing/projects/11/tongji-source-trends', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      ...trafficSources,
      dataState: 'NO_DATA',
      sources: trafficSources.sources.map((source) => ({
        ...source,
        dataState: 'NO_DATA',
        summary: { pageviews: null, visits: null, visitors: null },
        trend: []
      }))
    })
  }));
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

test('stale state shows the only required timestamp near the affected source', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installDashboard(page, dashboard({ freshness: 'STALE' }));
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto('/geo/market-overview');
  await expect(page.getByText('广告数据陈旧')).toBeVisible();
  await expect(page.getByText(/最后成功快照/)).toBeVisible();
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
