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

test('project page only lets the latest project run update navigation and loading', () => {
  assert.match(source, /const projectRunRequestRef = useRef\(0\)/);
  assert.match(source, /const requestId = projectRunRequestRef\.current \+ 1/);
  assert.match(source, /projectRunRequestRef\.current = requestId/);
  assert.match(source, /projectRunRequestRef\.current === requestId/);
  assert.match(source, /if \(projectRunRequestRef\.current === requestId\) setRunningProjectId\(null\)/);
});

test('project page distinguishes platform-mismatched questions from missing questions', () => {
  assert.match(source, /getProjectPromptRunBlockReason/);
  assert.match(source, /问题的监测平台与项目监测平台不一致/);
  assert.match(source, /请检查品牌项目监测平台设置/);
});

test('project page can permanently delete archived projects', () => {
  assert.match(source, /deleteArchivedProject/);
  assert.match(source, /params:\s*\{\s*permanent:\s*true\s*\}/);
  assert.match(source, /品牌项目已删除/);
  assert.match(source, /确认永久删除该品牌项目/);
});
