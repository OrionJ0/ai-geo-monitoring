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
  assert.match(hook, /axios\.get\('\/api\/ai-platforms'\)/);
  assert.match(hook, /disabled:\s*!item\.selectable/);
  assert.match(hook, /管理员尚未配置/);
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

test('project edits preserve an existing platform that was temporarily disabled', () => {
  const page = source('../app/geo/projects/page.tsx');
  assert.match(page, /platforms:\s*normalizeList\(record\.platforms\)/);
  assert.match(page, /normalizeList\(editingProject\?\.platforms\)\.includes\(item\)/);
});
