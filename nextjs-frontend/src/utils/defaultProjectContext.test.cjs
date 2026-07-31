const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontendRoot = path.resolve(__dirname, '../..');
const hookPath = path.join(frontendRoot, 'src/lib/useDefaultProjectContext.ts');
const settingsPath = path.join(
  frontendRoot,
  'src/app/admin/settings/WorkspaceSettings.tsx'
);
const adminPagePath = path.join(frontendRoot, 'src/app/admin/settings/page.tsx');

test('default project hook reads only the dedicated minimal-context endpoint', () => {
  const source = fs.readFileSync(hookPath, 'utf8');

  assert.match(source, /\/api\/geo-projects\/default-context/);
  assert.doesNotMatch(source, /axios\.get\(['"]\/api\/geo-projects['"]\)/);
  assert.doesNotMatch(source, /projects?\[0\]/);
  assert.match(source, /project:\s*DefaultProjectSummary\s*\|\s*null/);
  assert.match(source, /errorCode:\s*string\s*\|\s*null/);
});

test('workspace settings saves an exact string projectId and reloads the context', () => {
  const source = fs.readFileSync(settingsPath, 'utf8');

  assert.match(source, /axios\.put\(\s*['"]\/api\/geo-projects\/default-context['"]/);
  assert.match(source, /\{\s*projectId:\s*selectedProjectId\s*\}/);
  assert.match(source, /String\(project\.id\)/);
  assert.match(source, /status\s*===\s*['"]active['"]/);
  assert.match(source, /await loadDefaultContext\(\)/);
});

test('administrator settings exposes the workspace configuration as its own tab', () => {
  const source = fs.readFileSync(adminPagePath, 'utf8');

  assert.match(source, /WorkspaceSettings/);
  assert.match(source, /key:\s*['"]workspace['"]/);
  assert.match(source, /label:\s*['"]工作台['"]/);
});
