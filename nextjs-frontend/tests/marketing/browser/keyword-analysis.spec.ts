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
    searchTerms: [],
    hierarchyCounts: {
      campaigns: campaigns.length,
      adGroups: adGroups.length,
      keywords: keywords.length,
      searchTerms: 0
    },
    lastRun: {
      runId: stale ? 'failed-refresh-run' : 'successful-refresh-run',
      status: stale ? 'FAILED' : 'SUCCEEDED',
      failureCode: stale ? 'BAIDU_REPORT_SNAPSHOT_UNSTABLE' : null
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
  await page.route('**/api/marketing/projects/11/dashboard**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(dashboardFixture())
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

  await expect(keywordMetric(page, '有展现关键词')).toContainText('302');
  await expect(keywordMetric(page, '有点击关键词')).toContainText('51');
  await expect(keywordMetric(page, '点击覆盖率')).toContainText('16.89%');
  await expect(keywordMetric(page, '未获点击')).toContainText('251');
  await expect(page.getByText('百度推广 · 真实数据 · 数据截至 2026-08-03')).toBeVisible();
  await expect(page.getByText('当前选中关键词')).toBeVisible();
  await expect(page.getByText('行动建议分布')).toBeVisible();
  await expect(page.getByText('振动光纤价格').first()).toBeVisible();

  const selectedRow = page.locator('tr[aria-selected="true"]');
  await expect(selectedRow).toContainText('振动光纤 / 价格词');
  await expect(selectedRow).not.toContainText('推广单元');

  const electronicRow = page.getByRole('row', { name: /电子围栏厂家/ });
  await electronicRow.click();
  await expect(page.locator('aside').getByText('电子围栏厂家')).toBeVisible();
  await expect(electronicRow).toHaveAttribute('aria-selected', 'true');

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

test('keyword analysis keeps page width stable at 1280px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.goto('/geo/keyword-analysis');

  await expect(page.getByText('关键词效率分布')).toBeVisible();
  await expect(page.getByText('行动建议分布')).toBeVisible();
  expect(await page.evaluate(() => ({
    viewport: window.innerWidth,
    pageWidth: document.documentElement.scrollWidth
  }))).toEqual({ viewport: 1280, pageWidth: 1280 });

  await page.screenshot({
    path: path.join(artifactDirectory, 'keyword-analysis-1280.png'),
    fullPage: true
  });
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
    if (from && to) response.filter = { from, to };
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
  await expect(page.getByText('结构下钻')).toBeVisible();
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
