import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';

const artifactDirectory = path.resolve(
  process.cwd(),
  '../output/playwright/website-traffic'
);

const sourceRows = [
  { sourceKey: 'BAIDU_SEARCH', sourceLabel: '百度自然搜索', visits: '25870', trafficShare: '41.8', bounceRate: null, averageVisitTime: null, averageVisitPages: null, dataState: 'DATA' },
  { sourceKey: 'DIRECT', sourceLabel: '直接访问', visits: '18630', trafficShare: '30.1', bounceRate: null, averageVisitTime: null, averageVisitPages: null, dataState: 'DATA' },
  { sourceKey: 'BING_SEARCH', sourceLabel: '必应自然搜索', visits: '10420', trafficShare: '16.8', bounceRate: null, averageVisitTime: null, averageVisitPages: null, dataState: 'DATA' },
  { sourceKey: 'OTHER', sourceLabel: '其他来源', visits: '6922', trafficShare: '11.2', bounceRate: null, averageVisitTime: null, averageVisitPages: null, dataState: 'DATA' }
] as const;

const metricTotals: Record<string, [string, string]> = {
  visits: ['61842', '57712'],
  visitors: ['49618', '46734'],
  pageviews: ['159420', '146503'],
  bounceRate: ['42.6', '44.4'],
  averageVisitTime: ['145', '127'],
  averageVisitPages: ['2.88', '2.71']
};

const landingRows = Array.from({ length: 23 }, (_, index) => ({
  key: `baidu-page:${index + 1}`,
  pageId: String(index + 1),
  title: null,
  path: index === 0
    ? '/solutions/intelligent-perimeter-security/industrial-very-long-path-for-tooltip-verification'
    : `/solutions/page-${index + 1}`,
  visits: String(5640 - (index * 137)),
  contributionPageviews: String(12900 - (index * 211)),
  bounceRate: index === 4 ? null : String(35.2 + (index * 0.7)),
  averageVisitTime: String(188 - index),
  averageVisitPages: String(3.46 - (index * 0.03))
}));

const visitedRows = Array.from({ length: 18 }, (_, index) => ({
  key: `baidu-page:${100 + index + 1}`,
  pageId: String(100 + index + 1),
  title: null,
  path: index === 0 ? '/' : `/products/detail-${index + 1}`,
  pageviews: String(16800 - (index * 321)),
  visitors: index === 2 ? '0' : String(10900 - (index * 219)),
  averageStayTime: String(132 - index),
  downstreamPageviews: String(8400 - (index * 173)),
  exitRate: index === 5 ? null : String(22.4 + (index * 0.8))
}));

function date(offset: number, start = '2026-07-05') {
  const value = new Date(`${start}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

async function installRoutes(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('agd_token', 'playwright.website-traffic.signature');
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
      capabilities: { trafficRead: true, formalNavigation: true }
    })
  }));
  await page.route('**/website-traffic-overview**', (route) => {
    const url = new URL(route.request().url());
    const metric = url.searchParams.get('metric') || 'visits';
    const source = url.searchParams.get('source') || 'ALL';
    const sourceIndex = Math.max(
      0,
      sourceRows.findIndex((row) => row.sourceKey === source)
    );
    const ratio = source === 'ALL' ? 1 : [0.42, 0.3, 0.17, 0.11][sourceIndex];
    const currentTotal = Number(metricTotals[metric][0]);
    const previousTotal = Number(metricTotals[metric][1]);
    const trend = Array.from({ length: 30 }, (_, index) => ({
      date: date(index),
      previousDate: date(index, '2026-06-05'),
      current: String(((currentTotal / 30) * ratio * (0.82 + ((index % 7) * 0.055))).toFixed(metric.includes('average') || metric === 'bounceRate' ? 2 : 0)),
      previous: String(((previousTotal / 30) * ratio * (0.86 + ((index % 6) * 0.045))).toFixed(metric.includes('average') || metric === 'bounceRate' ? 2 : 0))
    }));
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        projectId: '11',
        source: 'BAIDU_TONGJI',
        mode: 'DATABASE_RANGE_SNAPSHOT',
        site: { domain: 'gato.com.cn' },
        device: url.searchParams.get('device') || 'all',
        coverage: { from: '2026-07-05', to: '2026-08-03' },
        previousCoverage: { from: '2026-06-05', to: '2026-07-04' },
        selectedSource: {
          sourceKey: source,
          sourceLabel: source === 'ALL'
            ? '全部来源'
            : sourceRows.find((row) => row.sourceKey === source)?.sourceLabel
        },
        selectedMetric: metric,
        selectedMetricState: 'DATA',
        dataState: 'DATA',
        summary: {
          visits: { current: '61842', previous: '57712', changePercent: '7.2' },
          visitors: { current: '49618', previous: '46734', changePercent: '6.2' },
          pageviews: { current: '159420', previous: '146503', changePercent: '8.8' },
          bounceRate: { current: '42.6', previous: '44.4', changePoints: '-1.8' },
          averageVisitTime: { current: '145', previous: '127', changeSeconds: '18' },
          averageVisitPages: { current: '2.88', previous: '2.71', changePages: '0.17' }
        },
        trend,
        sourceQuality: { allSiteBounceRate: '42.6', rows: sourceRows },
        capabilities: {
          trafficCounts: true,
          sourceTraffic: true,
          qualityMetrics: true,
          pageReports: true,
          sourcePageCorrelation: false,
          unavailableReason: ''
        },
        cache: { state: 'HIT' }
      })
    });
  });
  await page.route('**/website-traffic-pages**', (route) => {
    const url = new URL(route.request().url());
    const view = url.searchParams.get('view') || 'landing';
    const query = (url.searchParams.get('query') || '').toLowerCase();
    const pageNumber = Number(url.searchParams.get('page') || 1);
    const pageSize = Number(url.searchParams.get('pageSize') || 10);
    const sortBy = url.searchParams.get('sortBy') || (view === 'landing' ? 'visits' : 'pageviews');
    const sortOrder = url.searchParams.get('sortOrder') || 'descend';
    const source: Array<Record<string, string | null>> = view === 'landing'
      ? landingRows
      : visitedRows;
    const filtered = source.filter((row) => (
      !query
      || String(row.title || '').toLowerCase().includes(query)
      || String(row.path || '').toLowerCase().includes(query)
    ));
    const sorted = [...filtered].sort((left, right) => {
      const difference = Number(left[sortBy] || 0) - Number(right[sortBy] || 0);
      return sortOrder === 'ascend' ? difference : -difference;
    });
    const offset = (pageNumber - 1) * pageSize;
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        projectId: '11',
        source: 'BAIDU_TONGJI',
        device: 'all',
        coverage: { from: '2026-07-05', to: '2026-08-03' },
        view,
        dataState: sorted.length ? 'DATA' : 'NO_DATA',
        rows: sorted.slice(offset, offset + pageSize),
        pagination: {
          page: pageNumber,
          pageSize,
          totalItems: sorted.length,
          totalPages: Math.ceil(sorted.length / pageSize)
        },
        sort: { field: sortBy, order: sortOrder },
        query,
        scope: { source: 'ALL', label: '全部来源' },
        dataQuality: { excludedCrossDomainRows: 0 },
        capabilities: {
          trafficCounts: true,
          sourceTraffic: true,
          qualityMetrics: true,
          pageReports: true,
          sourcePageCorrelation: false,
          unavailableReason: ''
        }
      })
    });
  });
}

async function installUnavailableDataRoutes(page: Page) {
  await page.unroute('**/website-traffic-overview**');
  await page.unroute('**/website-traffic-pages**');
  const unavailableReason = '尚未取得真实账号响应样本以验证来源汇总、质量指标与页面报告的严格响应合同';
  const capabilities = {
    trafficCounts: true,
    sourceTraffic: false,
    qualityMetrics: false,
    pageReports: false,
    sourcePageCorrelation: false,
    unavailableReason
  };
  await page.route('**/website-traffic-overview**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      projectId: '11',
      source: 'BAIDU_TONGJI',
      mode: 'DATABASE_RANGE_SNAPSHOT',
      site: { domain: 'gato.com.cn' },
      device: 'all',
      coverage: { from: '2026-07-05', to: '2026-08-03' },
      previousCoverage: { from: '2026-06-05', to: '2026-07-04' },
      selectedSource: { sourceKey: 'ALL', sourceLabel: '全部来源' },
      selectedMetric: 'visits',
      selectedMetricState: 'DATA',
      dataState: 'DATA',
      summary: {
        visits: { current: '61842', previous: '57712', changePercent: '7.2' },
        visitors: { current: '49618', previous: '46734', changePercent: '6.2' },
        pageviews: { current: '159420', previous: '146503', changePercent: '8.8' },
        bounceRate: { current: null, previous: null, changePoints: null },
        averageVisitTime: { current: null, previous: null, changeSeconds: null },
        averageVisitPages: { current: null, previous: null, changePages: null }
      },
      trend: Array.from({ length: 30 }, (_, index) => ({
        date: date(index),
        previousDate: date(index, '2026-06-05'),
        current: String(1800 + (index * 19)),
        previous: String(1700 + (index * 17))
      })),
      sourceQuality: {
        allSiteBounceRate: null,
        rows: sourceRows.map((row) => ({
          ...row,
          visits: null,
          trafficShare: null,
          bounceRate: null,
          averageVisitTime: null,
          averageVisitPages: null,
          dataState: 'NO_DATA'
        }))
      },
      capabilities,
      cache: { state: 'HIT' }
    })
  }));
  await page.route('**/website-traffic-pages**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      projectId: '11',
      source: 'BAIDU_TONGJI',
      device: 'all',
      coverage: { from: '2026-07-05', to: '2026-08-03' },
      view: 'landing',
      dataState: 'UNAVAILABLE',
      rows: [],
      pagination: { page: 1, pageSize: 10, totalItems: null, totalPages: null },
      sort: { field: 'visits', order: 'descend' },
      query: '',
      scope: { source: 'ALL', label: '全部来源' },
      dataQuality: { excludedCrossDomainRows: null },
      capabilities
    })
  }));
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-08-03T04:00:00.000Z'));
  await installRoutes(page);
});

test('matches the final desktop structure and supports source trend recovery', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto('/geo/website-traffic');
  await expect(page.getByRole('heading', { name: '周期汇总' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '网站访问趋势' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '来源质量' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '页面表现' })).toBeVisible();
  await expect(page.getByText('61,842', { exact: true })).toBeVisible();

  const chartBox = await page.getByRole('img', {
    name: /全部来源访问次数当前周期与上一周期趋势/
  }).boundingBox();
  if (!chartBox) throw new Error('trend chart is missing');
  await page.mouse.move(
    chartBox.x + (chartBox.width * 0.55),
    chartBox.y + (chartBox.height * 0.5)
  );
  const trendTooltip = page.locator('.g2-tooltip');
  await expect(trendTooltip).toContainText('近 30 天');
  await expect(trendTooltip).toContainText('较前 30 天');
  await expect(trendTooltip).toContainText('变化');

  const directRow = page.getByRole('row', { name: /直接访问/ });
  await directRow.focus();
  await expect(directRow).toBeFocused();
  await directRow.press(' ');
  await expect(page.getByText(/当前：直接访问/)).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/geo/website-traffic');
  await page.getByRole('button', { name: /恢复全部来源/ }).click();
  await expect(page.getByText(/当前：直接访问/)).not.toBeVisible();

  await page.getByText('查看每日趋势等价数据').click();
  const equivalentTable = page.getByRole('table', {
    name: '网站访问趋势每日等价数据'
  });
  await expect(equivalentTable).toBeVisible();
  await expect(equivalentTable.getByRole('row').nth(1)).toContainText('2026-07-05');
  await page.getByText('查看每日趋势等价数据').click();

  await page.addStyleTag({
    content: 'nextjs-portal { display: none !important; }'
  });

  await page.screenshot({
    path: path.join(artifactDirectory, 'website-traffic-1440x1024.png'),
    fullPage: false
  });
  await page.setViewportSize({ width: 1487, height: 1058 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(artifactDirectory, 'website-traffic-reference-viewport.png'),
    fullPage: false
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('heading', { name: '页面表现' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('heading', { name: '页面表现' })).toBeVisible();
  await page.screenshot({
    path: path.join(artifactDirectory, 'website-traffic-1280.png'),
    fullPage: false
  });
  expect(consoleErrors).toEqual([]);
});

test('switches page contracts, searches, sorts and paginates', async ({ page }) => {
  await page.goto('/geo/website-traffic');
  await page.getByRole('tab', { name: '受访页面' }).click();
  const pagePerformance = page.locator(
    'section[aria-labelledby="page-performance-heading"]'
  );
  await expect(pagePerformance.getByRole('columnheader', { name: 'PV' })).toBeVisible();
  await expect(pagePerformance.getByRole('columnheader', { name: '退出率' })).toBeVisible();
  await expect(pagePerformance.getByRole('columnheader', { name: '访问次数' })).toHaveCount(0);

  const search = page.getByRole('searchbox', { name: '搜索页面标题或路径' });
  await search.fill('detail-12');
  await search.press('Enter');
  await expect(page.getByText('/products/detail-12')).toBeVisible();

  await search.fill('');
  await search.press('Enter');
  const sortedRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.includes('website-traffic-pages')
      && url.searchParams.get('sortBy') === 'visitors';
  });
  await page.getByRole('columnheader', { name: 'UV' }).click();
  await sortedRequest;
  await expect(page.getByText('共 18 条')).toBeVisible();
  await page.getByTitle('下一页').click();
  await expect(
    pagePerformance.locator('.ant-pagination-item-active')
  ).toHaveText('2');
});

test('keeps tables internally scrollable at narrow width and 400 percent zoom', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/geo/website-traffic');
  const tableContent = page.getByRole('region', { name: '来源质量表滚动区' });
  await expect(tableContent).toBeVisible();
  expect(await tableContent.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  await tableContent.focus();
  await tableContent.press('ArrowRight');
  await expect.poll(() => tableContent.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  await tableContent.evaluate((node) => { node.scrollLeft = 0; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({
    path: path.join(artifactDirectory, 'website-traffic-narrow.png'),
    fullPage: false
  });

  await page.setViewportSize({ width: 320, height: 800 });
  await page.getByRole('heading', { name: '网站访问趋势' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('heading', { name: '网站访问趋势' })).toBeInViewport();
  await page.getByRole('heading', { name: '页面表现' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('heading', { name: '页面表现' })).toBeInViewport();
  const pageTableScroller = page.getByRole('region', {
    name: /^入口页面表滚动区/
  }).last();
  expect(await pageTableScroller.evaluate((node) => (
    node.scrollWidth > node.clientWidth
  ))).toBe(true);
  await pageTableScroller.focus();
  await pageTableScroller.press('ArrowRight');
  await expect.poll(() => pageTableScroller.evaluate((node) => (
    node.scrollLeft
  ))).toBeGreaterThan(0);
  await pageTableScroller.evaluate((node) => { node.scrollLeft = 0; });
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= window.innerWidth + 1
  ))).toBe(true);
  await page.screenshot({
    path: path.join(artifactDirectory, 'website-traffic-400-percent.png'),
    fullPage: false
  });
});

test('exposes full paths to hover and keyboard focus without serious axe findings', async ({ page }) => {
  await page.goto('/geo/website-traffic');
  const longPath = page.locator('span[tabindex="0"]').filter({
    hasText: /industrial-very-long-path/
  });
  await longPath.hover();
  await expect(page.getByRole('tooltip')).toContainText('industrial-very-long-path');
  await page.mouse.move(0, 0);
  await page.keyboard.press('Escape');
  await longPath.focus();
  await expect(page.getByRole('tooltip')).toContainText('industrial-very-long-path');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => (
    ['critical', 'serious'].includes(violation.impact || '')
  ))).toEqual([]);
});

test('renders an explicitly unavailable capability state without simulated quality or page data', async ({ page }) => {
  await installUnavailableDataRoutes(page);
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto('/geo/website-traffic');
  const bounceSummary = page.getByText('跳出率', { exact: true }).first().locator('..');
  await expect(bounceSummary.getByText('—', { exact: true })).toBeVisible();
  await expect(bounceSummary).toContainText('无可用环比');
  await expect(page.getByRole('row', { name: /百度自然搜索/ })).toContainText('—');
  await expect(page.getByText('页面报告暂未接入')).toBeVisible();
  await expect(page.getByText('未验证真实账号页面报告合同，不以 0 或模拟数据代替')).toBeVisible();
  await expect(page.locator('.ant-pagination')).toHaveCount(0);
  await page.screenshot({
    path: path.join(artifactDirectory, 'website-traffic-honest-missing.png'),
    fullPage: false
  });
});

test('rejects page rows that pretend Baidu supplied titles or custom keys', async ({ page }) => {
  await page.unroute('**/website-traffic-pages**');
  await page.route('**/website-traffic-pages**', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        projectId: '11',
        source: 'BAIDU_TONGJI',
        device: url.searchParams.get('device') || 'all',
        coverage: {
          from: url.searchParams.get('from'),
          to: url.searchParams.get('to')
        },
        view: 'landing',
        dataState: 'DATA',
        rows: [{
          key: 'invented-page-key',
          pageId: '1',
          title: '伪造页面标题',
          path: '/',
          visits: '1',
          contributionPageviews: '1',
          bounceRate: null,
          averageVisitTime: null,
          averageVisitPages: null
        }],
        pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
        sort: { field: 'visits', order: 'descend' },
        query: '',
        scope: { source: 'ALL', label: '全部来源' },
        dataQuality: { excludedCrossDomainRows: 0 },
        capabilities: {
          trafficCounts: true,
          sourceTraffic: true,
          qualityMetrics: true,
          pageReports: true,
          sourcePageCorrelation: false,
          unavailableReason: ''
        }
      })
    });
  });
  await page.goto('/geo/website-traffic');
  await expect(page.getByRole('main', { name: '网站流量' }).getByRole('alert'))
    .toContainText(
    '页面表现读取失败，请稍后重试。'
  );
  await expect(page.getByText('伪造页面标题')).toHaveCount(0);
});
