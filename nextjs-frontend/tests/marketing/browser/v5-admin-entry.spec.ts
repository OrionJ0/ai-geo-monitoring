import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
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

const longCompetitorName = '超长竞争实体名称（用于验证窄屏完整换行与事实身份不丢失）';
const v5Report = {
  id: 501,
  project_id: 11,
  question_set_id: 41,
  question_set_name: 'v5 结构化分析脱敏验收报告',
  source: 'native',
  status: 'completed',
  control_state: 'terminal',
  metric_semantics_version: 'contextual_competitor_mentions_sov_v2_scoped',
  started_at: '2026-08-06T12:00:00.000Z',
  completed_at: '2026-08-06T12:01:00.000Z',
  integrity: { status: 'complete', missing_record_count: 0 },
  capabilities: {
    can_pause: false,
    can_resume: false,
    can_retry: false
  },
  execution_summary: {
    total: 1,
    completed: 1,
    failed: 0,
    pending: 0,
    executing: 0,
    queued: 0,
    failure_stages: {}
  },
  summary: {
    total: 1,
    completed: 1,
    failed: 0,
    pending: 0,
    valid_analyses: 1,
    valid_answers: 1,
    acquired_answers: 1,
    invalid_captures: 0,
    analysis_coverage_rate: 100,
    brand_mentioned_answers: 1,
    recommended_answers: 0,
    ranked_answers: 0,
    sov_calculable_answers: 1,
    avg_answer_competitor_share: 33.33,
    brand_mention_rate: 100,
    recommendation_rate: 0,
    citation_valid_analyses: 1,
    citation_unverified_analyses: 0,
    citation_rate: 100,
    owned_citation_rate: 100,
    total_citations: 1,
    total_owned_citations: 1,
    sov_summary: {
      metric_semantics_version: 'contextual_competitor_mentions_sov_v2_scoped',
      kind: 'observed_competitor_mentions',
      scope: 'open_discovery',
      completeness: 'not_proven',
      average: 33.33,
      calculable_answers: 1
    }
  },
  rows: [{
    record_id: 9001,
    question_id: 701,
    question: '如何选择一套可靠的工业气体安全监测方案？',
    question_category: '产品选型',
    platform: 'deepseek',
    platform_name: 'DeepSeek',
    model_name: 'deepseek-v4-flash',
    status: 'completed',
    execution_state: 'completed',
    answer: '建议根据现场工况核验传感器、报警控制器和服务能力。[产品资料](https://gato.com.cn/)',
    answer_format: 'markdown_v1',
    has_metrics: true,
    brand_mentioned: true,
    brand_mentions: 1,
    brand_recommended: false,
    analysis_contract_version: 'ai_structured_v5',
    metric_semantics_version: 'contextual_competitor_mentions_sov_v2_scoped',
    analysis_method: 'ai_structured_v5',
    analysis_platform: 'deepseek',
    analysis_model: 'deepseek-v4-flash',
    sov: {
      metric_semantics_version: 'contextual_competitor_mentions_sov_v2_scoped',
      kind: 'observed_competitor_mentions',
      status: 'observed_only',
      scope: 'open_discovery',
      completeness: 'not_proven',
      value: 33.33,
      numerator: 1,
      denominator: 3
    },
    competition_entities: [{
      name: longCompetitorName,
      relation: 'competitor',
      mentions: 2,
      reason: '仅根据当前回答中明确出现的实体关系判断，不代表完整市场名单。',
      evidence: ['回答将该实体与目标品牌放在同一选型语境中。'],
      surface_forms: ['脱敏竞品']
    }],
    analysis_structure: {
      schema_version: 'geo_metric_input_v5',
      target_mapping: {
        status: 'resolved',
        target_entity_id: 'E001',
        candidate_entity_ids: []
      },
      target_entity_id: 'E001',
      entities: [
        { entity_id: 'E001', name: 'GATO', type: 'brand' },
        { entity_id: 'E002', name: longCompetitorName, type: 'company' }
      ],
      candidate_groups: [{
        ordered: false,
        entries: ['E001', 'E002'],
        reason: '回答只是并列举例，没有可靠排名。',
        evidence: ['可同时核验两类方案。']
      }],
      sentiment: {
        status: 'assessed',
        label: 'neutral',
        reason: '中性选型建议',
        evidence: ['建议根据现场工况核验。'],
        risk_terms: []
      },
      citations: {
        count: 1,
        official_count: 1,
        official_website_cited: true,
        sources: [{ url: 'https://gato.com.cn/', domain: 'gato.com.cn', title: '产品资料', owned: true }],
        semantics_version: 'provider_explicit_v1'
      }
    },
    citation_count: 1,
    owned_citation_count: 1,
    citation_evidence_status: 'explicit',
    sentiment: 'neutral'
  }]
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

async function installV5ReportRoutes(page: Page) {
  await page.unroute('**/api/geo-projects/11/question-set-runs*');
  await page.route('**/api/geo-projects/11/question-set-runs*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      data: [{ ...v5Report, rows: undefined }],
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 }
    })
  }));
  await page.route('**/api/geo-projects/11/question-set-runs/501*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: v5Report })
  }));
}

async function expectStableBounds(locator: Locator) {
  let previous: Awaited<ReturnType<Locator['boundingBox']>> = null;
  await expect.poll(async () => {
    const current = await locator.boundingBox();
    const stable = Boolean(previous && current
      && Math.abs(previous.x - current.x) < 0.5
      && Math.abs(previous.y - current.y) < 0.5
      && Math.abs(previous.width - current.width) < 0.5
      && Math.abs(previous.height - current.height) < 0.5);
    previous = current;
    return stable;
  }, { intervals: [100, 150, 200, 250] }).toBe(true);
  return locator.boundingBox();
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
  await expectStableBounds(dialog);
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

  const save = dialog.getByRole('button', { name: /保\s*存/u });
  await save.focus();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => (
    document.querySelector('[role="dialog"]')?.contains(document.activeElement) === true
  ))).toBe(true);
  const close = dialog.locator('.ant-modal-close');
  await close.focus();
  await page.keyboard.press('Shift+Tab');
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
  const stableMobileBox = await expectStableBounds(dialog);
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= window.innerWidth + 1
  ))).toBe(true);
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  const footer = dialog.locator('.ant-modal-footer');
  await footer.scrollIntoViewIfNeeded();
  await expect(footer.getByRole('button', { name: /取\s*消/u })).toBeVisible();
  await expect(footer.getByRole('button', { name: /保\s*存/u })).toBeVisible();
  const box = stableMobileBox;
  expect(box).not.toBeNull();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x || 0) + (box?.width || 0)).toBeLessThanOrEqual(390);
  expect(seriousViolations(await new AxeBuilder({ page }).include('[role="dialog"]').analyze()))
    .toEqual([]);
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
  for (const identity of [promptDefinition.version, promptDefinition.prompt_revision]) {
    const tag = page.getByText(identity, { exact: true });
    await expect(tag).toBeVisible();
    expect(await tag.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    const bounds = await tag.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect((bounds?.x || 0) + (bounds?.width || 0)).toBeLessThanOrEqual(320);
  }
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= window.innerWidth + 1
  ))).toBe(true);
  const analysisTab = page.getByRole('tab', { name: 'AI 分析 API' });
  await expect(analysisTab).toHaveAttribute('aria-selected', 'true');
  await analysisTab.focus();
  await page.keyboard.press('ArrowLeft');
  const platformTab = page.getByRole('tab', { name: 'AI 平台' });
  await expect(platformTab).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(platformTab).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(analysisTab).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(analysisTab).toHaveAttribute('aria-selected', 'true');
  // Ant Design renders its labelled overflow button inside the tablist at this
  // width. Keep the whole navigation in scope and waive only that library
  // structure rule; keyboard state and every other serious rule remain tested.
  expect(seriousViolations(await new AxeBuilder({ page })
    .disableRules(['aria-required-children'])
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
  await expect(page.getByRole('button', { name: /历史报告/u })).toBeEnabled();
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

test('v5 scoped report renders observed-only facts and long identities accessibly', async ({ page }) => {
  await installV5ReportRoutes(page);
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto('/geo/question-set-reports?run_id=501');
  await expect(page.getByRole('heading', { name: v5Report.question_set_name })).toBeVisible();
  await expect(page.getByText('开放发现 SOV（仅基于本次已发现实体）', { exact: false })).toBeVisible();
  await expect(page.getByText('33.33%（1/3）', { exact: false })).toBeVisible();
  await expect(page.getByText('这份历史报告包含旧规则指标')).toHaveCount(0);

  const expand = page.locator('button.ant-table-row-expand-icon').first();
  await expect(expand).toBeVisible();
  await expand.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('AI 结构化 v5', { exact: true })).toBeVisible();
  await expect(page.getByText('目标品牌映射：GATO', { exact: true })).toBeVisible();
  await expect(page.getByText(`普通列表：GATO → ${longCompetitorName}`, { exact: false })).toBeVisible();
  const entityTag = page.locator('.ant-tag').filter({ hasText: `${longCompetitorName} · 公司` }).last();
  await expect(entityTag).toBeVisible();
  const longIdentity = page.getByText(longCompetitorName, { exact: true }).last();
  await expect(longIdentity).toBeVisible();
  expect(seriousViolations(await new AxeBuilder({ page }).analyze())).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= window.innerWidth + 1
  ))).toBe(true);
  const table = page.locator('.ant-table-content').last();
  expect(await table.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);

  await page.setViewportSize({ width: 320, height: 800 });
  await entityTag.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'center' }));
  expect(await entityTag.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  const tagBounds = await entityTag.boundingBox();
  expect(tagBounds).not.toBeNull();
  expect(tagBounds?.x).toBeGreaterThanOrEqual(0);
  expect((tagBounds?.x || 0) + (tagBounds?.width || 0)).toBeLessThanOrEqual(320);
  await longIdentity.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'center' }));
  expect(await longIdentity.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  const bounds = await longIdentity.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x || 0) + (bounds?.width || 0)).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= window.innerWidth + 1
  ))).toBe(true);
  await page.screenshot({
    path: path.join(artifactDirectory, 'question-set-report-v5-mobile.png'),
    fullPage: false
  });
});
