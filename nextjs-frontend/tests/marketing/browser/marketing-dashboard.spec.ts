import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const dashboard = {
  projectId: '11',
  projectName: '上海品牌增长',
  revision: 'run-fixture-1',
  states: {
    moduleState: 'READY',
    projectState: 'ACTIVE',
    sourceSummaryState: 'CONNECTED',
    bindingSummaryState: 'ACTIVE',
    snapshotContentState: 'DATA',
    snapshotFreshnessState: 'FRESH',
    refreshState: 'SUCCEEDED',
  },
  bindings: [{
    bindingId: 'binding-1',
    accountId: '0009007199254740993123',
    accountName: '华东搜索账户（用于长文本响应式验证）',
    sourceState: 'CONNECTED',
    bindingState: 'ACTIVE',
    blockingCode: null,
  }],
  coverage: {
    from: '2026-06-30',
    to: '2026-07-29',
    lastSuccessfulAt: '2026-07-29T03:58:00.000Z',
    currency: 'CNY',
    costScale: 6,
  },
  filter: { from: '2026-06-30', to: '2026-07-29' },
  summary: {
    impressions: '900719925474099312352',
    clicks: '90071992547409931',
    costAmountScaled: '123456789012345678',
  },
  trend: [
    {
      date: '2026-07-28',
      impressions: '900719925474099312345',
      clicks: '3',
      costAmountScaled: '1000001',
    },
    {
      date: '2026-07-29',
      impressions: '7',
      clicks: '4',
      costAmountScaled: '2000002',
    },
  ],
  campaigns: [{
    accountId: '0009007199254740993123',
    campaignId: 'campaign-0009007199254740993123',
    campaignName: '超长品牌搜索推广计划名称——响应式与键盘验收夹具',
    impressions: '900719925474099312352',
    clicks: '7',
    costAmountScaled: '3000003',
  }],
  activeRun: null,
  lastRun: {
    runId: 'run-fixture-1',
    status: 'SUCCEEDED',
    failureCode: null,
    nextRetryAt: null,
  },
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const payload = btoa(JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).replace(/=/gu, '');
    localStorage.setItem('agd_token', `header.${payload}.signature`);
    localStorage.setItem('agd_user_id', '2');
    localStorage.setItem('agd_user', JSON.stringify({
      id: 2,
      role: 'user',
    }));
  });
  await page.route('**/api/marketing/status', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ moduleState: 'READY', errorCode: null }),
  }));
  await page.route('**/api/geo-projects', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      data: [{ id: 11, name: '上海品牌增长', status: 'active' }],
    }),
  }));
  await page.route('**/api/marketing/projects/11/dashboard**', (route) => (
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(dashboard),
    })
  ));
});

test('fresh snapshot is keyboard-readable and axe-clean', async ({ page }) => {
  await page.goto('/geo/marketing?project_id=11');
  await expect(page.getByRole('heading', { name: '营销监控' })).toBeVisible();
  await expect(
    page.getByLabel('营销指标汇总')
      .getByText('900,719,925,474,099,312,352')
  ).toBeVisible();
  await expect(page.getByRole('table', {
    name: '逐日营销指标等价数据表',
  })).toBeVisible();
  await expect(page.getByText(
    '超长品牌搜索推广计划名称——响应式与键盘验收夹具'
  )).toBeVisible();

  const projectSelector = page.getByLabel('监控项目');
  await projectSelector.focus();
  await expect(projectSelector).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '立即刷新' })).toBeFocused();

  const results = await new AxeBuilder({ page })
    .exclude('.ant-menu-submenu')
    .analyze();
  expect(results.violations).toEqual([]);
});

test('320 CSS px and 400 percent zoom keep the page within its viewport', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/geo/marketing?project_id=11');
  await expect(page.getByRole('heading', { name: '营销监控' })).toBeVisible();
  const overflowAt320 = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(overflowAt320).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath('marketing-320.png'),
    fullPage: true,
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '4';
  });
  const overflowAtZoom = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(overflowAtZoom).toBe(false);
});
