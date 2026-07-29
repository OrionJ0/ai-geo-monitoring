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

test('new projects default only to catalog-marked platforms', () => {
  const hook = source('../lib/useAIPlatformCatalog.ts');
  const projectsPage = source('../app/geo/projects/page.tsx');

  assert.match(hook, /default_for_new_project:\s*boolean/);
  assert.match(hook, /const defaultCodes = useMemo/);
  assert.match(projectsPage, /platforms:\s*defaultCodes/);
  assert.doesNotMatch(projectsPage, /platforms:\s*selectableCodes/);
});

test('project and reporting screens use the shared platform catalog', () => {
  for (const relativePath of [
    '../app/geo/projects/page.tsx',
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
  assert.match(analysisSettings, /capabilities\?\.analysis/);
});

test('platform settings warn before disabling the API used for structural analysis', () => {
  const platformSettings = source('../app/admin/settings/AIPlatformSettings.tsx');

  assert.match(platformSettings, /\/api\/settings\/analysis-api/);
  assert.match(platformSettings, /shouldWarnAnalysisPlatformDisable/);
  assert.match(platformSettings, /停用当前分析 API/);
  assert.match(platformSettings, /所有监测运行都会在创建任务前被阻断/);
});

test('project edits preserve an existing platform that was temporarily disabled', () => {
  const page = source('../app/geo/projects/page.tsx');
  assert.match(page, /platforms:\s*normalizeList\(record\.platforms\)/);
  assert.match(page, /normalizeList\(editingProject\?\.platforms\)\.includes\(item\)/);
});

test('project and prompt screens label selected platforms that became unavailable', () => {
  const projectsPage = source('../app/geo/projects/page.tsx');
  const promptsPage = source('../app/geo/prompts/page.tsx');

  assert.match(projectsPage, /describeSelectedPlatforms/);
  assert.match(projectsPage, /displayLabel/);
  assert.match(promptsPage, /describeSelectedPlatforms/);
  assert.match(promptsPage, /当前项目包含暂不可用的监测平台/);
  assert.match(promptsPage, /前往设置中心/);
});

test('project platform selector exposes its full small option list to assistive technology', () => {
  const projectsPage = source('../app/geo/projects/page.tsx');
  assert.match(projectsPage, /aria-label="监测平台"/);
  assert.match(projectsPage, /virtual=\{false\}/);
});
