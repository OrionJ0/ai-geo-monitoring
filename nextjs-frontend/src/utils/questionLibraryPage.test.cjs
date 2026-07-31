/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pageSource = fs.readFileSync(path.resolve(__dirname, '../app/geo/prompts/page.tsx'), 'utf8');
const layoutSource = fs.readFileSync(path.resolve(__dirname, '../app/geo/layout.tsx'), 'utf8');
const navigationSource = fs.readFileSync(path.resolve(__dirname, 'geoNavigation.cjs'), 'utf8');

test('导航和页面使用问题库命名', () => {
  assert.match(navigationSource, /page\('\/prompts', '问题库'/);
  assert.match(layoutSource, /buildGeoNavigation/);
  assert.doesNotMatch(navigationSource, /Prompt 库/);
  assert.doesNotMatch(pageSource, /<Card title="问题库">/);
  assert.match(pageSource, /<Card[^>]*title="问题列表"/);
  assert.doesNotMatch(pageSource, /Prompt 库/);
});

test('问题库提供问题集管理和整组运行入口', () => {
  assert.match(pageSource, /<Card[^>]*title="问题集"/);
  assert.match(pageSource, /\/question-sets`/);
  assert.match(pageSource, /\/question-sets\/\$\{questionSet\.id\}`/);
  assert.match(pageSource, /\/question-sets\/\$\{questionSet\.id\}\/run`/);
  assert.match(pageSource, /新建问题集/);
  assert.match(pageSource, /编辑问题集/);
  assert.match(pageSource, /删除问题集/);
});

test('问题可以选择所属问题集并继续单独运行', () => {
  assert.match(pageSource, /question_set_id/);
  assert.match(pageSource, /name="question_set_id"/);
  assert.match(pageSource, /\/prompts\/\$\{record\.id\}\/run`/);
  assert.match(pageSource, /新建问题/);
  assert.match(pageSource, /编辑问题/);
});

test('局域网 HTTP 环境使用兼容密钥运行问题集和单个问题', () => {
  const questionSetStart = pageSource.indexOf('const runQuestionSet');
  const questionSetEnd = pageSource.indexOf('const deletePrompt', questionSetStart);
  const questionSetRun = pageSource.slice(questionSetStart, questionSetEnd);
  const promptStart = pageSource.indexOf('const runPrompt');
  const promptEnd = pageSource.indexOf('const openPromptHistory', promptStart);
  const promptRun = pageSource.slice(promptStart, promptEnd);

  assert.match(pageSource, /import \{ createIdempotencyKey \}/);
  assert.doesNotMatch(pageSource, /window\.crypto\.randomUUID\(\)/);
  assert.ok(questionSetRun.indexOf('try {') < questionSetRun.indexOf('createIdempotencyKey()'));
  assert.match(questionSetRun, /createIdempotencyKey\(\)/);
  assert.match(questionSetRun, /axios\.post/);
  assert.ok(promptRun.indexOf('try {') < promptRun.indexOf('createIdempotencyKey()'));
  assert.match(promptRun, /createIdempotencyKey\(\)/);
  assert.match(promptRun, /axios\.post/);
});

test('问题库隐藏生成建议并提供单条和批量新增入口', () => {
  assert.doesNotMatch(pageSource, /title="生成问题建议"/);
  assert.doesNotMatch(pageSource, />生成建议<\/Button>/);
  assert.match(pageSource, />新建问题<\/Button>/);
  assert.match(pageSource, />批量新增<\/Button>/);
  assert.match(pageSource, /\/prompts\/batch`/);
});

test('问题库不再被全局原生按钮黑色背景污染', () => {
  const globalsSource = fs.readFileSync(path.resolve(__dirname, '../app/globals.css'), 'utf8');
  assert.doesNotMatch(globalsSource, /button\s*\{[\s\S]*?background-color:\s*#1a1a1a/);
});
