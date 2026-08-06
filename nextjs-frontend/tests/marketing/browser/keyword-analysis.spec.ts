import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import keywordFixtureModule from '../../../src/fixtures/keywordAnalysis.fixture.cjs';

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

function dashboardFixture(stale = false) {
  const fixture = buildKeywordFixture(false);
  const facts = fixture.facts as FixtureFact[];
  const bindings = [...new Map(facts.map((fact) => [fact.accountId, {
    accountId: fact.accountId,
    accountName: fact.accountName
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
  return {
    projectId: '11',
    projectName: fixture.projectName,
    revision: 'keyword-analysis-fixture-revision',
    states: {
      projectState: 'ACTIVE',
      snapshotContentState: 'DATA',
      snapshotFreshnessState: stale ? 'STALE' : 'FRESH'
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
    campaigns,
    adGroups,
    keywords,
    searchTerms,
    hierarchyCounts: {
      campaigns: campaigns.length,
      adGroups: adGroups.length,
      keywords: keywords.length,
      searchTerms: searchTerms.length
    },
    lastRun: {
      runId: stale ? 'failed-refresh-run' : 'successful-refresh-run',
      status: stale ? 'FAILED' : 'SUCCEEDED',
      failureCode: stale ? 'BAIDU_REPORT_SNAPSHOT_UNSTABLE' : null
    }
  };
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
  await page.route('**/api/marketing/projects/11/dashboard**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(alignDashboardFilterToRequest(
      dashboardFixture(),
      route.request().url()
    ))
  }));
}

function keywordMetric(page: Page, title: string) {
  return page.getByRole('heading', { name: new RegExp(title, 'u') })
    .locator('xpath=ancestor::div[contains(@class,"ant-card")][1]');
}

async function clickScatterPointNear(
  page: Page,
  title: string,
  expected: { x: number; y: number }
) {
  const tooltipTitle = page.locator('.g2-tooltip-title').filter({ hasText: title });
  for (let radius = 0; radius <= 25; radius += 5) {
    for (let yOffset = -radius; yOffset <= radius; yOffset += 5) {
      for (let xOffset = -radius; xOffset <= radius; xOffset += 5) {
        if (radius > 0 && Math.abs(xOffset) < radius && Math.abs(yOffset) < radius) {
          continue;
        }
        const x = expected.x + xOffset;
        const y = expected.y + yOffset;
        await page.mouse.move(x, y);
        await page.waitForTimeout(8);
        if (await tooltipTitle.isVisible().catch(() => false)) {
          await page.mouse.click(x, y);
          return;
        }
      }
    }
  }
  throw new Error(`未在预期区域找到散点：${title}`);
}

test.beforeEach(async ({ page }) => {
  await installRoutes(page);
  await page.setViewportSize({ width: 1488, height: 1058 });
});

test('confirmed keyword analysis visual keeps selection, donut, task filters, and direct unit text', async ({ page }) => {
  await page.goto('/geo/keyword-analysis');

  await expect(keywordMetric(page, '有展现关键词')).toContainText('302');
  await expect(keywordMetric(page, '有点击关键词')).toContainText('51');
  await expect(keywordMetric(page, '点击覆盖率')).toContainText('16.89%');
  await expect(keywordMetric(page, '未获点击')).toContainText('251');
  const selectedEndDate = await page.getByRole('textbox', { name: '结束日期' }).inputValue();
  await expect(page.getByText(`百度推广 · 真实数据 · 数据截至 ${selectedEndDate}`)).toBeVisible();
  await expect(page.getByText('当前选中关键词')).toBeVisible();
  await expect(page.getByText('优化标签分布')).toBeVisible();
  await expect(page.getByText('振动光纤价格').first()).toBeVisible();

  const scatterRegion = page.getByRole('img', {
    name: /关键词效率分布，共 51 个有点击关键词/u
  });
  const scatterBox = await scatterRegion.boundingBox();
  expect(scatterBox).not.toBeNull();
  if (scatterBox) {
    const plotWidth = scatterBox.width - 56 - 20;
    const plotHeight = 300 - 8 - 36;
    await clickScatterPointNear(page, '电子围栏厂家', {
      x: scatterBox.x + 56 + (1.3762272089761571 / 7) * plotWidth,
      y: scatterBox.y + 8 + (1 - 109.10828025477707 / 120) * plotHeight
    });
  }
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

test('keyword evidence opens scoped real search terms and invalid scope never expands to all rows', async ({ page }) => {
  await page.goto('/geo/keyword-analysis');

  await expect(page.getByRole('columnheader', { name: '命中广告搜索词' }))
    .toBeVisible();
  const electronicRow = page.getByRole('row', { name: /电子围栏厂家/u });
  await expect(electronicRow).toContainText('查看 2 个');
  await electronicRow.getByRole('link', {
    name: '查看“电子围栏厂家”命中的 2 个广告搜索词'
  }).click();

  await expect(page).toHaveURL(/\/geo\/keyword-analysis\/search-terms\?accountId=.*&keywordId=/u);
  await expect(page.getByText('当前广告关键词')).toBeVisible();
  await expect(page.getByText('电子围栏厂家报价', { exact: true })).toBeVisible();
  await expect(page.getByText('电子围栏生产厂家', { exact: true })).toBeVisible();
  await expect(page.getByText('周界报警系统方案', { exact: true })).toHaveCount(0);

  await page.goto('/geo/keyword-analysis/search-terms');
  await expect(page.getByRole('alert').filter({ hasText: '下钻范围无效' }))
    .toContainText('下钻范围无效');
  await expect(page.getByText('电子围栏厂家报价', { exact: true })).toHaveCount(0);

  await page.goto('/geo/keyword-analysis/search-terms?accountId=invalid&keywordId=invalid');
  await expect(page.getByRole('alert').filter({ hasText: '下钻范围无效' }))
    .toContainText('下钻范围无效');
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

test('search-term comparison refuses dashboard responses from different revisions', async ({ page }) => {
  let dashboardRequestCount = 0;
  await page.unroute('**/api/marketing/projects/11/dashboard**');
  await page.route('**/api/marketing/projects/11/dashboard**', (route) => {
    const body = alignDashboardFilterToRequest(
      dashboardFixture(),
      route.request().url()
    );
    dashboardRequestCount += 1;
    if (dashboardRequestCount === 2) {
      body.revision = 'keyword-analysis-previous-revision';
    }
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
    .toContainText('本期与上期广告快照版本不一致，无法进行周期比较');
});

test('search-term comparison refuses a same-revision response for the wrong period', async ({ page }) => {
  let dashboardRequestCount = 0;
  await page.unroute('**/api/marketing/projects/11/dashboard**');
  await page.route('**/api/marketing/projects/11/dashboard**', (route) => {
    dashboardRequestCount += 1;
    const body = dashboardRequestCount === 1
      ? alignDashboardFilterToRequest(dashboardFixture(), route.request().url())
      : dashboardFixture();
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(body)
    });
  });

  await page.goto('/geo/keyword-analysis/search-terms?view=all');
  await expect(page.getByText('电子围栏厂家报价', { exact: true })).toBeVisible();
  await expect.poll(() => dashboardRequestCount).toBe(2);
  const previous = page.getByLabel('广告搜索词数上期：暂无数据');
  await previous.hover();
  await expect(page.getByRole('tooltip'))
    .toContainText('上一周期广告搜索词响应范围与请求不一致');
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
  let dashboardRequestCount = 0;
  await page.unroute('**/api/marketing/projects/11/dashboard**');
  await page.route('**/api/marketing/projects/11/dashboard**', async (route) => {
    const body = alignDashboardFilterToRequest(
      dashboardFixture(),
      route.request().url()
    );
    dashboardRequestCount += 1;
    if (dashboardRequestCount === 2) {
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

test('scoped comparison resolves each revision by keyword ID before name evidence', async ({ page }) => {
  let dashboardRequestCount = 0;
  await page.unroute('**/api/marketing/projects/11/dashboard**');
  await page.route('**/api/marketing/projects/11/dashboard**', (route) => {
    const body = alignDashboardFilterToRequest(
      dashboardFixture(),
      route.request().url()
    );
    dashboardRequestCount += 1;
    if (dashboardRequestCount === 3) {
      body.keywords = body.keywords.map((keyword) => keyword.keywordName === '电子围栏厂家'
        ? { ...keyword, keywordName: '电子围栏厂家旧称' }
        : keyword);
      body.searchTerms = body.searchTerms.map((term) => term.keywordName === '电子围栏厂家'
        ? { ...term, keywordName: '电子围栏厂家旧称' }
        : term);
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(body)
    });
  });

  await page.goto('/geo/keyword-analysis');
  const electronicRow = page.getByRole('row', { name: /电子围栏厂家/u });
  await electronicRow.getByRole('link', {
    name: '查看“电子围栏厂家”命中的 2 个广告搜索词'
  }).click();

  const countCard = page.getByRole('heading', { name: /广告搜索词数/u })
    .locator('xpath=ancestor::div[contains(@class,"ant-card")][1]');
  await expect(countCard).toContainText(/本期\s*2\s*上期\s*2/u);
  await expect(page.getByText('电子围栏厂家旧称', { exact: true })).toHaveCount(0);
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

test('rejects a structurally valid dashboard with orphan keywords', async ({ page }) => {
  await page.unroute('**/api/marketing/projects/11/dashboard**');
  await page.route('**/api/marketing/projects/11/dashboard**', (route) => {
    const invalid = dashboardFixture();
    invalid.adGroups = [];
    invalid.hierarchyCounts.adGroups = 0;
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
  await expect(keywordMetric(page, '有展现关键词')).toContainText('302');
  await expect(page.getByText('振动光纤价格').first()).toBeVisible();
});

test('stale snapshot clamps a crossed-day default to the last completed coverage', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-08-05T04:00:00.000Z'));
  await page.unroute('**/api/marketing/projects/11/dashboard**');
  const requestedRanges: Array<string | null> = [];
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

  await page.goto('/geo/keyword-analysis');

  await expect(keywordMetric(page, '有展现关键词')).toContainText('302');
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
