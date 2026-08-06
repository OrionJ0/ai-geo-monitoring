/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

test('AI platform catalog hook reads the authenticated database catalog', () => {
  const hook = source('../lib/useAIPlatformCatalog.ts');
  const statusPresentation = source('./platformSelectionStatus.cjs');
  assert.match(hook, /@\/lib\/axiosConfig/);
  assert.match(hook, /axios\.get\('\/api\/ai-platforms'\)/);
  assert.match(hook, /disabled:\s*!item\.selectable/);
  assert.match(hook, /getUnavailablePlatformLabel/);
  assert.match(hook, /getApiWebSearchStatusLabel/);
  assert.match(hook, /web_search_test_status/);
  assert.match(statusPresentation, /管理员尚未配置/);
  assert.match(hook, /capabilities\?:\s*AIPlatformCapabilities/);
});

test('retired project page has no project-specific platform defaults', () => {
  const hook = source('../lib/useAIPlatformCatalog.ts');
  const projectsPage = source('../app/geo/projects/page.tsx');

  assert.doesNotMatch(hook, /const defaultCodes = useMemo/);
  assert.match(projectsPage, /redirect\('\/admin\/settings#workspace'\)/);
  assert.doesNotMatch(projectsPage, /platforms/);
});

test('question and reporting screens use the shared platform catalog', () => {
  for (const relativePath of [
    '../app/geo/prompts/page.tsx',
    '../app/geo/project-dashboard/page.tsx',
    '../app/geo/reports/page.tsx',
    '../app/geo/sources/page.tsx'
  ]) {
    const page = source(relativePath);
    assert.match(page, /useAIPlatformCatalog/);
    assert.doesNotMatch(page, /\/api\/platforms\/ping|PLATFORM_OPTIONS\s*=|const platformOptions\s*=|const platformLabels\s*=/);
  }
});

test('platform settings hide API-only controls for managed Web adapters', () => {
  const platformSettings = source('../app/admin/settings/AIPlatformSettings.tsx');
  const analysisSettings = source('../app/admin/settings/AIAnalysisSettings.tsx');

  assert.match(platformSettings, /capabilities:\s*AIPlatformCapabilities/);
  assert.match(platformSettings, /api_key_management/);
  assert.match(platformSettings, /model_listing/);
  assert.match(platformSettings, /connection_test/);
  assert.match(platformSettings, /getWebPlatformAdminSessionMeta/);
  assert.match(platformSettings, /lastVerifiedDetail/);
  assert.match(platformSettings, /accountDetail/);
  assert.match(analysisSettings, /item\.code === 'deepseek'/);
  assert.match(analysisSettings, /正式结构化分析固定使用官方内置 DeepSeek/);
});

test('platform settings warn before disabling the API used for structural analysis', () => {
  const platformSettings = source('../app/admin/settings/AIPlatformSettings.tsx');

  assert.match(platformSettings, /\/api\/settings\/analysis-api/);
  assert.match(platformSettings, /shouldWarnAnalysisPlatformDisable/);
  assert.match(platformSettings, /停用当前分析 API/);
  assert.match(platformSettings, /所有监测运行都会在创建任务前被阻断/);
});

test('question screen reports globally enabled platforms that are currently unavailable', () => {
  const promptsPage = source('../app/geo/prompts/page.tsx');

  assert.match(promptsPage, /platformCatalogError/);
  assert.match(promptsPage, /当前没有可运行的 AI 平台/);
  assert.match(promptsPage, /前往设置中心/);
});
