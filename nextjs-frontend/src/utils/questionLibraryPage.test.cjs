/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pageSource = fs.readFileSync(path.resolve(__dirname, '../app/geo/prompts/page.tsx'), 'utf8');
const layoutSource = fs.readFileSync(path.resolve(__dirname, '../app/geo/layout.tsx'), 'utf8');

test('导航和页面使用问题库命名', () => {
  assert.match(layoutSource, /label: '问题库'/);
  assert.match(layoutSource, />问题库<\/Link>/);
  assert.doesNotMatch(layoutSource, /Prompt 库/);
  assert.match(pageSource, /<Card title="问题库">/);
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
