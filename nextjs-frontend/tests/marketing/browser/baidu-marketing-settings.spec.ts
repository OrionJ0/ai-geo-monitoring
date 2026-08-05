import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';

const artifactDirectory = path.resolve(
  process.cwd(),
  '../output/playwright/baidu-marketing-settings'
);

async function installRoutes(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('agd_token', 'playwright.baidu-settings.signature');
    localStorage.setItem('agd_user_id', '1');
    localStorage.setItem('agd_user', JSON.stringify({
      id: 1,
      role: 'admin',
      status: 'active'
    }));
  });
  await page.route('**/api/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: [] })
  }));
  await page.route('**/api/settings', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: {} })
  }));
  await page.route('**/api/marketing/status', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ moduleState: 'READY', errorCode: null })
  }));
  await page.route('**/api/admin/marketing/baidu/connections', (route) => (
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([{
        id: 'connection-redacted',
        status: 'CONNECTED',
        principalId: 'principal-redacted',
        principalName: '百度授权主体',
        tongjiUserName: 'tongji-user',
        products: {
          marketing: { state: 'VERIFIED', checkedAt: '2026-08-05T10:00:00.000Z' },
          tongji: { state: 'ACCOUNT_MISMATCH', checkedAt: '2026-08-05T10:00:00.000Z' }
        },
        lastErrorCode: null
      }])
    })
  ));
  await page.route('**/api/geo-projects', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([])
  }));
}

test.beforeEach(async ({ page }) => {
  await installRoutes(page);
});

test('管理员只提交统计用户名并分别看到双产品状态', async ({ page }) => {
  let submittedBody: unknown = null;
  await page.route('**/tongji-context', async (route) => {
    submittedBody = await route.request().postDataJSON();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        userName: 'updated-user',
        siteCount: 1,
        verifiedAt: '2026-08-05T10:10:00.000Z'
      })
    });
  });

  await page.goto('/admin/settings#marketing');
  await expect(page.getByRole('heading', { name: '百度搜索推广连接' })).toBeVisible();
  const marketingSettings = page.locator(
    'section[aria-labelledby="baidu-marketing-settings-title"]'
  );
  await expect(page.getByText('VERIFIED', { exact: true })).toBeVisible();
  await expect(page.getByText('ACCOUNT_MISMATCH', { exact: true })).toBeVisible();
  await expect(marketingSettings.getByText('Data API Token')).toHaveCount(0);
  await expect(marketingSettings.locator('input[type="password"]')).toHaveCount(0);

  const configure = page.getByRole('button', { name: '更新统计用户名' });
  await configure.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '配置百度统计用户名' })).toBeVisible();
  const userName = page.getByLabel('百度统计账户名');
  await userName.fill(' updated-user ');
  await page.getByRole('button', { name: '验证并保存用户名' }).click();
  await expect.poll(() => submittedBody).toEqual({ userName: ' updated-user ' });
  await expect(page.getByRole('dialog', { name: '配置百度统计用户名' })).toBeHidden();

  await page.screenshot({
    path: path.join(artifactDirectory, 'desktop.png'),
    fullPage: true
  });
});

test('统计用户名管理在移动端保持可操作', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/settings#marketing');
  await expect(page.getByRole('button', { name: '更新统计用户名' })).toBeVisible();
  await page.getByRole('button', { name: '更新统计用户名' }).click();
  await expect(page.getByLabel('百度统计账户名')).toBeVisible();
  await page.screenshot({
    path: path.join(artifactDirectory, 'mobile.png'),
    fullPage: true
  });
});
