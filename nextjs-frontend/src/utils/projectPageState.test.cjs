/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../app/geo/projects/page.tsx'), 'utf8');

test('project page keeps competitor refreshes scoped to the open competitor project', () => {
  assert.match(source, /useRef/);
  assert.match(source, /const currentCompetitorProjectIdRef = useRef\(null\)/);
  assert.match(source, /currentCompetitorProjectIdRef\.current = record\.id/);
  assert.match(source, /if \(currentCompetitorProjectIdRef\.current === projectId\) setCurrentProject\(project\)/);
  assert.match(source, /const closeCompetitors = \(\) =>/);
  assert.match(source, /currentCompetitorProjectIdRef\.current = null/);
  assert.match(source, /onCancel=\{closeCompetitors\}/);
});

test('project page competitor mutations use the captured project id', () => {
  assert.match(source, /const mutationProjectId = currentProject\.id/);
  assert.match(source, /\/api\/geo-projects\/\$\{mutationProjectId\}\/competitors/);
  assert.match(source, /if \(currentCompetitorProjectIdRef\.current !== mutationProjectId\) return/);
  assert.match(source, /await refreshCurrentProject\(mutationProjectId\)/);
  assert.match(source, /if \(currentCompetitorProjectIdRef\.current === mutationProjectId\) setSavingCompetitor\(false\)/);
});

test('project page is configuration-only and does not expose a project-wide run entry', () => {
  assert.doesNotMatch(source, /运行分析/);
  assert.doesNotMatch(source, /\/api\/geo-projects\/\$\{record\.id\}\/run/);
  assert.doesNotMatch(source, /projectRunRequestRef/);
  assert.doesNotMatch(source, /runningProjectId/);
});

test('project page can permanently delete archived projects', () => {
  assert.match(source, /deleteArchivedProject/);
  assert.match(source, /params:\s*\{\s*permanent:\s*true\s*\}/);
  assert.match(source, /品牌项目已删除/);
  assert.match(source, /确认永久删除该品牌项目/);
});

test('project page explains why creation is disabled and links to settings', () => {
  assert.match(source, /还不能新建项目/);
  assert.match(source, /请先在设置中心启用并配置至少一个监测平台/);
  assert.match(source, /router\.push\('\/admin\/settings'\)/);
  assert.match(source, /前往设置中心/);
});

test('prompt run analysis configuration errors include a safe settings action', () => {
  const promptSource = fs.readFileSync(
    path.resolve(__dirname, '../app/geo/prompts/page.tsx'),
    'utf8',
  );
  assert.match(promptSource, /settings_url === '\/admin\/settings'/);
  assert.match(promptSource, /showRunError/);
  assert.match(promptSource, /getWebPreflightPrompt/);
  assert.match(promptSource, /Modal\.confirm/);
  assert.match(promptSource, /去设置登录/);
  assert.match(promptSource, /前往设置中心/);
  assert.match(promptSource, /router\.push\(settingsUrl\)/);
});
