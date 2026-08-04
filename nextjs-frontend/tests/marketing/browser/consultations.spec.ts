import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const artifactDirectory = path.resolve(
  process.cwd(),
  '../output/playwright/consultations-fixture'
);

const rows = Array.from({ length: 23 }, (_, index) => ({
    id: `website:${1001 + index}`,
    sourceSystem: 'GATO_WEBSITE',
    consultationType: 'WEBSITE_FORM',
    occurredAt: new Date(Date.UTC(2026, 7, 3 - index, 1, 32)).toISOString(),
    source: { key: 'BING_SEARCH', label: '必应自然搜索' },
    landingPage: { label: null, path: '/' },
    contentSummary: index === 0
      ? '咨询：工业平板是否支持宽温和串口扩展？'
      : `脱敏表单需求摘要 ${index + 1}`,
    maskedContact: {
      displayName: index === 0 ? '张**' : '李**',
      phone: index === 0 ? '138****5621' : null,
      email: null
    },
    device: 'UNKNOWN',
    detailAvailable: true
}));

function recordDetail(summary: (typeof rows)[number]) {
  return {
    ...summary,
    externalRecordUrl: null,
    form: {
      content: summary.contentSummary,
      fields: [
        { label: '需求类型', value: '产品咨询' },
        {
          label: '原始外部来路',
          value: 'https://cn.bing.com/search?q=industrial+tablet'
        }
      ]
    }
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  });
}

function dateSequence(from: string, to: string) {
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  const days: Array<{
    date: string;
    formConsultationRecords: string;
    sourceBreakdown: Array<{
      sourceKey: string;
      formConsultationRecords: string;
    }>;
  }> = [];
  let index = 0;
  while (cursor <= end) {
    const total = 2 + (index % 5) + (index === 0 ? 8 : 0);
    const paid = Math.floor(total / 2);
    const direct = Math.floor((total - paid) / 2);
    const organic = total - paid - direct;
    days.push({
      date: cursor.toISOString().slice(0, 10),
      formConsultationRecords: String(total),
      sourceBreakdown: [
        { sourceKey: 'BAIDU_PAID', formConsultationRecords: String(paid) },
        { sourceKey: 'DIRECT', formConsultationRecords: String(direct) },
        { sourceKey: 'UNKNOWN', formConsultationRecords: String(organic) }
      ].filter((source) => Number(source.formConsultationRecords) > 0)
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    index += 1;
  }
  return days;
}

async function installRoutes(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('agd_token', 'playwright.consultations.signature');
    localStorage.setItem('agd_user_id', '2');
    localStorage.setItem('agd_user', JSON.stringify({ id: 2, role: 'user' }));
  });
  await page.route('**/api/geo-projects/default-context', (route) => json(route, {
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
  }));
  await page.route('**/api/website-data/projects/11/form-consultation-days**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    const from = params.get('from') || '';
    const to = params.get('to') || '';
    const days = dateSequence(from, to);
    const total = days.reduce((sum, day) => (
      sum + Number(day.formConsultationRecords)
    ), 0);
    const sourceTotals = new Map<string, number>();
    days.forEach((day) => day.sourceBreakdown.forEach((source) => {
      sourceTotals.set(
        source.sourceKey,
        (sourceTotals.get(source.sourceKey) || 0)
          + Number(source.formConsultationRecords)
      );
    }));
    return json(route, {
      projectId: '11',
      sourceSystem: 'GATO_WEBSITE',
      consultationType: 'WEBSITE_FORM',
      dataCoverage: 'ALL_FORM_RECORDS',
      coverage: { from, to, timeZone: 'Asia/Shanghai' },
      dataState: 'DATA',
      summary: { formConsultationRecords: String(total) },
      sourceBreakdown: [...sourceTotals].map(([sourceKey, value]) => ({
        sourceKey,
        formConsultationRecords: String(value)
      })),
      days,
      cache: {
        state: 'HIT',
        refreshedAt: '2026-08-03T02:00:00.000Z',
        expiresAt: '2026-08-03T02:10:00.000Z'
      }
    });
  });
  await page.route('**/api/consultations/projects/11/records**', (route) => {
    const requestUrl = new URL(route.request().url());
    const detailId = requestUrl.pathname.match(/\/records\/(.+)$/u)?.[1];
    if (detailId) {
      const decodedId = decodeURIComponent(detailId);
      const summary = rows.find((row) => row.id === decodedId);
      if (!summary) return json(route, { error: { code: 'NOT_FOUND', message: '记录不存在' } }, 404);
      return json(route, {
        schemaVersion: 'consultation_records_v1',
        projectId: '11',
        detail: recordDetail(summary)
      });
    }

    const params = requestUrl.searchParams;
    const from = params.get('from') || '';
    const to = params.get('to') || '';
    const pageNumber = Number(params.get('page') || '1');
    const pageSize = Number(params.get('pageSize') || '10');
    const type = params.get('type') || 'ALL';
    const source = params.get('source') || 'ALL';
    const device = params.get('device') || 'ALL';
    const query = (params.get('q') || '').toLocaleLowerCase('zh-CN');
    const sortBy = params.get('sortBy') || 'occurredAt';
    const sortOrder = params.get('sortOrder') || 'desc';
    const filtered = rows.filter((row) => (
      (type === 'ALL' || row.consultationType === type)
      && (source === 'ALL' || row.source.key === source)
      && (device === 'ALL' || row.device === device)
      && (!query || [
        row.contentSummary,
        row.source.label,
        row.maskedContact.displayName
      ].filter(Boolean).join('\n').toLocaleLowerCase('zh-CN').includes(query))
    ));
    const sorted = [...filtered].sort((left, right) => {
      const leftValue = sortBy === 'source'
        ? left.source.label
        : String(left[sortBy as 'occurredAt' | 'consultationType']);
      const rightValue = sortBy === 'source'
        ? right.source.label
        : String(right[sortBy as 'occurredAt' | 'consultationType']);
      const compared = leftValue.localeCompare(rightValue, 'zh-CN')
        || left.id.localeCompare(right.id);
      return sortOrder === 'asc' ? compared : -compared;
    });
    const offset = (pageNumber - 1) * pageSize;
    const totalItems = sorted.length;
    return json(route, {
      schemaVersion: 'consultation_records_v1',
      projectId: '11',
      coverage: { from, to, timeZone: 'Asia/Shanghai' },
      coverageState: 'PARTIAL',
      sources: [
        {
          sourceSystem: 'GATO_WEBSITE',
          consultationType: 'WEBSITE_FORM',
          sourceState: 'AVAILABLE',
          recordCoverage: 'FULL',
          reasonCode: null
        },
        {
          sourceSystem: 'KF53',
          consultationType: 'ONLINE_CHAT',
          sourceState: 'NOT_CONNECTED',
          recordCoverage: 'NONE',
          reasonCode: 'KF53_API_UNVERIFIED'
        }
      ],
      items: sorted.slice(offset, offset + pageSize),
      pagination: {
        page: pageNumber,
        pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / pageSize)
      }
    });
  });
  await page.route('**/api/consultations/projects/11/records/*', (route) => {
    let recordId = new URL(route.request().url()).pathname.split('/').at(-1) || '';
    while (recordId.includes('%')) recordId = decodeURIComponent(recordId);
    const summary = rows.find((row) => row.id === recordId);
    if (!summary) {
      return json(route, { error: { code: 'NOT_FOUND', message: '记录不存在' } }, 404);
    }
    return json(route, {
      schemaVersion: 'consultation_records_v1',
      projectId: '11',
      detail: recordDetail(summary)
    });
  });
}

async function installUnavailableRoutes(page: Page, options: {
  includeUnavailableRow?: boolean;
  formError?: boolean;
  recordsError?: boolean;
} = {}) {
  await page.unroute('**/api/website-data/projects/11/form-consultation-days**');
  await page.unroute('**/api/consultations/projects/11/records**');
  await page.unroute('**/api/consultations/projects/11/records/*');
  await page.route('**/api/website-data/projects/11/form-consultation-days**', (route) => {
    if (options.formError) {
      return json(route, {
        error: { code: 'WEBSITE_FORM_UPSTREAM_FAILED', message: '官网表单数据读取失败' }
      }, 502);
    }
    const params = new URL(route.request().url()).searchParams;
    const from = params.get('from') || '';
    const to = params.get('to') || '';
    const days = dateSequence(from, to);
    const total = days.reduce((sum, day) => (
      sum + Number(day.formConsultationRecords)
    ), 0);
    const sourceTotals = new Map<string, number>();
    days.forEach((day) => day.sourceBreakdown.forEach((source) => {
      sourceTotals.set(
        source.sourceKey,
        (sourceTotals.get(source.sourceKey) || 0)
          + Number(source.formConsultationRecords)
      );
    }));
    return json(route, {
      projectId: '11',
      sourceSystem: 'GATO_WEBSITE',
      consultationType: 'WEBSITE_FORM',
      dataCoverage: 'ALL_FORM_RECORDS',
      coverage: { from, to, timeZone: 'Asia/Shanghai' },
      dataState: 'DATA',
      summary: { formConsultationRecords: String(total) },
      sourceBreakdown: [...sourceTotals].map(([sourceKey, value]) => ({
        sourceKey,
        formConsultationRecords: String(value)
      })),
      days,
      cache: {
        state: 'HIT',
        refreshedAt: '2026-08-03T02:00:00.000Z',
        expiresAt: '2026-08-03T02:10:00.000Z'
      }
    });
  });
  await page.route('**/api/consultations/projects/11/records**', (route) => {
    if (options.recordsError) {
      return json(route, {
        error: { code: 'CONSULTATION_RECORD_FAILED', message: '咨询记录暂时不可用' }
      }, 503);
    }
    const params = new URL(route.request().url()).searchParams;
    const from = params.get('from') || '';
    const to = params.get('to') || '';
    const pageNumber = Number(params.get('page') || '1');
    const pageSize = Number(params.get('pageSize') || '10');
    const type = params.get('type') || 'ALL';
    const unavailableRow = {
      ...rows[1],
      detailAvailable: false
    };
    const items = options.includeUnavailableRow && type !== 'ONLINE_CHAT'
      ? [unavailableRow]
      : [];
    return json(route, {
      schemaVersion: 'consultation_records_v1',
      projectId: '11',
      coverage: { from, to, timeZone: 'Asia/Shanghai' },
      coverageState: options.includeUnavailableRow ? 'PARTIAL' : 'NONE',
      sources: [
        {
          sourceSystem: 'GATO_WEBSITE',
          consultationType: 'WEBSITE_FORM',
          sourceState: options.includeUnavailableRow ? 'PARTIAL' : 'AGGREGATE_ONLY',
          recordCoverage: options.includeUnavailableRow ? 'PARTIAL' : 'NONE',
          reasonCode: options.includeUnavailableRow
            ? 'WEBSITE_FORM_RECORD_PARTIAL'
            : 'WEBSITE_FORM_RECORD_API_UNVERIFIED'
        },
        {
          sourceSystem: 'KF53',
          consultationType: 'ONLINE_CHAT',
          sourceState: 'NOT_CONNECTED',
          recordCoverage: 'NONE',
          reasonCode: 'KF53_API_UNVERIFIED'
        }
      ],
      items,
      pagination: {
        page: pageNumber,
        pageSize,
        totalItems: items.length,
        totalPages: items.length ? 1 : 0
      }
    });
  });
}

function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function selectAllDevices(page: Page) {
  const device = page.getByRole('combobox', { name: '设备' });
  const control = device.locator(
    'xpath=ancestor::div[contains(@class,"ant-select")][1]'
  );
  await control.click();
  await page.getByRole('option', { name: '全部设备' }).click();
  await expect(control).toContainText('全部设备');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toBeHidden();
}

function consultationMetric(page: Page, title: string) {
  return page.getByRole('heading', { name: new RegExp(title, 'u') })
    .locator('xpath=ancestor::div[contains(@class,"ant-card")][1]');
}

test.beforeEach(async ({ page }) => {
  fs.mkdirSync(artifactDirectory, { recursive: true });
  await page.clock.setFixedTime(new Date('2026-08-04T04:00:00.000Z'));
  await installRoutes(page);
});

test('1440x1024 keeps the table full width and opens an overlay audit drawer', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto('/geo/consultations');
  await selectAllDevices(page);

  await expect(consultationMetric(page, '表单咨询')).toContainText('本期33');
  await expect(page.getByText('53KF 尚未完成真实账户接口、有效对话规则和历史覆盖验证。')).toBeVisible();
  await expect(page.getByRole('heading', { name: '最近咨询' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '咨询内容摘要' })).toBeVisible();
  await expect(page.locator('.ant-skeleton')).toHaveCount(0);
  const pageAxe = await new AxeBuilder({ page }).analyze();
  expect(pageAxe.violations.map((violation) => ({
    id: violation.id,
    targets: violation.nodes.map((node) => node.target)
  }))).toEqual([]);

  expect((await page.locator('.app-header').boundingBox())?.height).toBe(64);
  expect((await page.locator('.geo-sider').boundingBox())?.width).toBe(224);
  const tableCard = page.locator('[class*="tableCard"]');
  const beforeDrawer = await tableCard.boundingBox();
  const trigger = page.getByRole('button', { name: /查看 2026-08-03 09:32/u });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '咨询详情' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '表单内容' })).toBeVisible();
  await expect(dialog.getByText('138****5621')).toBeVisible();
  await expect(dialog.getByText('原始外部来路')).toBeVisible();
  await expect(dialog.getByText('https://cn.bing.com/search?q=industrial+tablet')).toBeVisible();
  await expect(dialog.getByText('机器人问候')).toHaveCount(0);

  const drawerWrapper = page.locator('.ant-drawer-content-wrapper');
  await expect.poll(async () => Math.round(
    (await drawerWrapper.boundingBox())?.x || 0
  )).toBe(1000);

  for (let index = 0; index < 16; index += 1) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => (
    document.activeElement?.closest('.ant-drawer-section') !== null
  ))).toBe(true);
  for (let index = 0; index < 16; index += 1) {
    await page.keyboard.press('Shift+Tab');
  }
  expect(await page.evaluate(() => (
    document.activeElement?.closest('.ant-drawer-section') !== null
  ))).toBe(true);
  const drawerBox = await drawerWrapper.boundingBox();
  expect(Math.round(drawerBox?.x || 0)).toBe(1000);
  expect(drawerBox?.y).toBe(64);
  expect(drawerBox?.width).toBe(440);
  expect(drawerBox?.height).toBe(960);
  expect(await tableCard.boundingBox()).toEqual(beforeDrawer);
  const mask = page.locator('.ant-drawer-mask');
  await expect(mask).toBeVisible();
  expect(await mask.evaluate((node) => getComputedStyle(node).backdropFilter)).toBe('none');
  await expect(page.locator('.ant-drawer-close')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '咨询详情' })).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(page.getByRole('dialog', { name: '咨询详情' })).toBeVisible();
  await expect.poll(async () => Math.round(
    (await drawerWrapper.boundingBox())?.x || 0
  )).toBe(1000);

  const drawerAxe = await new AxeBuilder({ page })
    .include('.ant-drawer-section')
    .analyze();
  expect(drawerAxe.violations.map((violation) => ({
    id: violation.id,
    targets: violation.nodes.map((node) => node.target)
  }))).toEqual([]);
  expect(consoleErrors).toEqual([]);
  await page.screenshot({
    path: path.join(artifactDirectory, 'consultations-drawer-1440x1024.png')
  });
});

test('filters, search, sorting, pagination and analysis tabs drive independent state', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto('/geo/consultations');
  await selectAllDevices(page);
  await expect(page.getByRole('heading', { name: '最近咨询' })).toBeVisible({ timeout: 10_000 });

  const typeRequest = page.waitForRequest((request) => (
    new URL(request.url()).searchParams.get('type') === 'ONLINE_CHAT'
    && new URL(request.url()).searchParams.get('pageSize') === '10'
  ));
  await page.getByRole('combobox', { name: '最近咨询类型' })
    .locator('xpath=ancestor::div[contains(@class,"ant-select")][1]')
    .click();
  await page.getByRole('option', { name: '在线客服' }).click();
  await typeRequest;

  await expect(page.getByText('当前筛选条件下没有咨询记录')).toBeVisible();

  const formRequest = page.waitForRequest((request) => (
    new URL(request.url()).searchParams.get('type') === 'WEBSITE_FORM'
  ));
  await page.getByRole('combobox', { name: '最近咨询类型' })
    .locator('xpath=ancestor::div[contains(@class,"ant-select")][1]')
    .click();
  await page.getByRole('option', { name: '表单咨询' }).click();
  await formRequest;

  const sourceRequest = page.waitForRequest((request) => (
    new URL(request.url()).searchParams.get('source') === 'BING_SEARCH'
  ));
  await page.getByRole('combobox', { name: '最近咨询来源' })
    .locator('xpath=ancestor::div[contains(@class,"ant-select")][1]')
    .click();
  await page.getByRole('option', { name: '必应自然搜索' }).click();
  await sourceRequest;

  const searchRequest = page.waitForRequest((request) => (
    new URL(request.url()).searchParams.get('q') === '串口扩展'
  ));
  await page.getByRole('textbox', { name: '搜索咨询内容' }).fill('串口扩展');
  await searchRequest;

  const sortRequest = page.waitForRequest((request) => (
    new URL(request.url()).searchParams.get('sortBy') === 'occurredAt'
    && new URL(request.url()).searchParams.get('sortOrder') === 'asc'
  ));
  await page.getByRole('columnheader', { name: /时间/u }).focus();
  await page.keyboard.press('Enter');
  await sortRequest;

  const clearSearchRequest = page.waitForRequest((request) => (
    new URL(request.url()).searchParams.get('q') === ''
  ));
  await page.getByRole('textbox', { name: '搜索咨询内容' }).fill('');
  await clearSearchRequest;

  const nextPageRequest = page.waitForRequest((request) => (
    new URL(request.url()).searchParams.get('page') === '2'
    && new URL(request.url()).searchParams.get('pageSize') === '10'
  ));
  await page.locator('.ant-pagination-next button').focus();
  await page.keyboard.press('Enter');
  await nextPageRequest;

  await expect(page.locator('[aria-label="咨询趋势图"]')).toBeVisible();
  await page.getByRole('tab', { name: '咨询趋势' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '来源分布' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[aria-label="咨询来源分布图"]')).toBeVisible();
  await expect(page.locator('[aria-label="咨询趋势图"]')).toBeHidden();

  const deviceControl = page.getByRole('combobox', { name: '设备' })
    .locator('xpath=ancestor::div[contains(@class,"ant-select")][1]');
  await expect(async () => {
    if (!(await deviceControl.textContent())?.includes('移动端')) {
      await deviceControl.click();
      await page.getByRole('option', { name: '移动端' }).click();
    }
    await expect(deviceControl).toContainText('移动端');
  }).toPass({ timeout: 5_000 });
  await expect(page.getByRole('tabpanel', { name: '来源分布' })
    .getByText(/不会按总量推断设备分布/u)).toBeVisible();
});

test('exposes honest partial coverage, accessible chart data and disabled-detail reason', async ({ page }) => {
  await installUnavailableRoutes(page, { includeUnavailableRow: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/geo/consultations');
  await selectAllDevices(page);

  await expect(page.getByText(/官网逐条记录仅部分覆盖/u)).toBeVisible();
  await expect(page.getByText(/53KF 尚未完成真实账户接口/u)).toBeVisible();
  const trendTab = page.getByRole('tab', { name: '咨询趋势' });
  const panelId = await trendTab.getAttribute('aria-controls');
  expect(panelId).toBeTruthy();
  await expect(page.locator(`#${panelId}`)).toHaveAttribute('role', 'tabpanel');
  await expect(page.getByRole('table', { name: '表单咨询逐日数量' })).toBeAttached();

  const unavailable = page.getByRole('button', { name: '查看', exact: true });
  await unavailable.focus();
  await expect(unavailable).toBeFocused();
  await expect(unavailable).toHaveAttribute('aria-disabled', 'true');
  const reasonId = await unavailable.getAttribute('aria-describedby');
  await expect(page.locator(`#${reasonId}`)).toContainText('来源明细接口尚未验证');
  expect(await page.locator('.ant-table-content').evaluate((element) => (
    element.scrollWidth > element.clientWidth
  ))).toBe(true);
  const pageAxe = await new AxeBuilder({ page }).analyze();
  expect(pageAxe.violations).toEqual([]);
});

test('keeps the modal drawer full-width and keyboard-contained on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/geo/consultations');
  await selectAllDevices(page);
  const trigger = page.getByRole('button', { name: /查看 2026-08-03 09:32/u });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '咨询详情' });
  await expect(dialog).toBeVisible();
  expect(Math.round(
    (await page.locator('.ant-drawer-content-wrapper').boundingBox())?.width || 0
  )).toBe(390);
  for (let index = 0; index < 16; index += 1) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => (
    document.activeElement?.closest('.ant-drawer-section') !== null
  ))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('distinguishes source errors from genuine empty data and offers retries', async ({ page }) => {
  await installUnavailableRoutes(page, { formError: true, recordsError: true });
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto('/geo/consultations');
  await expect(page.getByText('表单咨询趋势读取失败')).toBeVisible();
  await expect(page.getByText('最近咨询读取失败')).toBeVisible();
  await expect(page.getByRole('button', { name: /重\s*试/u })).toHaveCount(2);
  await expect(page.getByRole('alert').filter({ hasText: '最近咨询读取失败' })
    .getByText('咨询记录暂时不可用')).toBeVisible();
});
