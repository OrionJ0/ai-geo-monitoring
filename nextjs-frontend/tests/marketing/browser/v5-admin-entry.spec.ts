import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const artifactDirectory = path.resolve(
  process.cwd(),
  '../output/playwright/v5-admin-entry'
);

const deepSeekPlatform = {
  id: 1,
  code: 'deepseek',
  name: 'DeepSeek',
  adapter_type: 'openai_chat_completions',
  base_url: 'https://api.deepseek.com',
  default_model: 'deepseek-v4-flash',
  request_timeout_seconds: 180,
  max_tokens: null,
  request_options: {},
  enabled: true,
  builtin: true,
  configured: true,
  api_key_last4: '1234',
  test_status: 'success',
  last_tested_at: '2026-08-06T12:00:00.000Z',
  last_test_message: '连接成功',
  web_search_test_status: 'untested',
  last_web_search_tested_at: null,
  last_web_search_test_message: null,
  capabilities: {
    monitoring: true,
    analysis: true,
    model_listing: true,
    connection_test: true,
    api_web_search_test: true,
    api_key_management: true,
    interactive_login: false
  }
};

const promptDefinition = {
  version: 'ai_structured_v5',
  prompt_revision: 'structured_v5_rev2',
  template: '兼容提示词',
  request_profile: {
    temperature: 0.1,
    token_limit: null,
    timeout_seconds: 610,
    max_attempts: 2,
    web_search: false,
    deepseek_thinking: 'disabled',
    json_mode: 'chat_completions_only'
  },
  stages: [
    {
      version: 'entity-extraction-v1',
      prompt_revision: 'entity_extraction_v1_rev2',
      template: `实体抽取提示词：${'请保留完整原文定位。'.repeat(24)}`,
      expected_output: { entities: [] }
    },
    {
      version: 'semantic-judgment-v1',
      prompt_revision: 'semantic_judgment_v1_rev2',
      template: `语义判断提示词：${'只在封闭实体目录内判断。'.repeat(24)}`,
      expected_output: { judgments: [] }
    }
  ]
};

async function installRoutes(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('agd_token', 'playwright.v5-admin.signature');
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
  await page.route('**/api/admin/ai-platforms', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: [deepSeekPlatform] })
  }));
  await page.route('**/api/settings/analysis-api', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      data: {
        platform_code: 'deepseek',
        model_name: 'deepseek-v4-flash',
        request_options: { temperature: 0.1 }
      }
    })
  }));
  await page.route('**/api/settings/analysis-api/prompt*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: promptDefinition })
  }));
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
          platforms: ['deepseek'],
          aliases: ['GATO'],
          primary_keywords: ['气体报警器']
        },
        source: 'SYSTEM_DEFAULT'
      }
    })
  }));
  await page.route('**/api/geo-projects/11/question-set-runs*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      data: [],
      pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 }
    })
  }));
  await page.route('**/api/geo-projects/11/question-sets', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: [] })
  }));
}

function seriousViolations(result: Awaited<ReturnType<AxeBuilder['analyze']>>) {
  return result.violations.filter((violation) => (
    ['critical', 'serious'].includes(violation.impact || '')
  ));
}

test.beforeAll(() => {
  fs.mkdirSync(artifactDirectory, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await installRoutes(page);
});

test('official DeepSeek dialog is keyboard-contained, selectable, and mobile-safe', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto('/admin/settings#ai-platforms');
  const edit = page.getByRole('button', { name: /编\s*辑/u }).first();
  await expect(edit).toBeVisible();
  await edit.focus();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: '配置官方 DeepSeek' });
  await expect(dialog).toBeVisible();
  for (const label of ['平台名称', '唯一标识', '接口类型', 'Base URL', '默认模型']) {
    const field = dialog.getByLabel(label);
    await expect(field).toBeVisible();
    await expect(field).toHaveAttribute('aria-readonly', 'true');
  }
  const model = dialog.getByLabel('默认模型');
  await model.focus();
  await page.keyboard.press('ControlOrMeta+A');
  expect(await model.evaluate((node) => {
    const input = node as HTMLInputElement;
    return input.selectionStart === 0 && input.selectionEnd === input.value.length;
  })).toBe(true);

  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => (
    document.querySelector('[role="dialog"]')?.contains(document.activeElement) === true
  ))).toBe(true);
  expect(seriousViolations(await new AxeBuilder({ page }).include('[role="dialog"]').analyze()))
    .toEqual([]);
  await page.screenshot({
    path: path.join(artifactDirectory, 'deepseek-dialog-desktop.png'),
    fullPage: false
  });

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(edit).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await edit.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= window.innerWidth + 1
  ))).toBe(true);
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x || 0) + (box?.width || 0)).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: path.join(artifactDirectory, 'deepseek-dialog-mobile.png'),
    fullPage: false
  });
});

test('two-stage analysis prompts and fallback stay named at narrow zoom width', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/admin/settings#ai-analysis');
  await expect(page.getByLabel('阶段 1 提示词')).toBeVisible();
  await expect(page.getByLabel('阶段 2 提示词')).toBeVisible();
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= window.innerWidth + 1
  ))).toBe(true);
  expect(seriousViolations(await new AxeBuilder({ page })
    .exclude('.ant-tabs-nav')
    .analyze())).toEqual([]);
  await page.screenshot({
    path: path.join(artifactDirectory, 'analysis-prompts-400-percent.png'),
    fullPage: false
  });

  await page.route('**/api/settings/analysis-api/prompt*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      data: { ...promptDefinition, stages: [] }
    })
  }));
  await page.reload();
  await expect(page.getByLabel('当前分析提示词')).toHaveValue('兼容提示词');
});

test('question-set report entry stays usable on desktop, mobile, and narrow zoom width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto('/geo/question-set-reports');
  await expect(page.getByText('暂无报告')).toBeVisible();
  expect(seriousViolations(await new AxeBuilder({ page }).analyze())).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= window.innerWidth + 1
  ))).toBe(true);
  await page.screenshot({
    path: path.join(artifactDirectory, 'question-set-reports-mobile.png'),
    fullPage: false
  });

  await page.setViewportSize({ width: 320, height: 800 });
  await expect(page.getByText('暂无报告')).toBeInViewport();
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= window.innerWidth + 1
  ))).toBe(true);
});
