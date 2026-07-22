/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('report page renders top citation URL details from report summary', () => {
  const pagePath = path.resolve(__dirname, '../app/geo/reports/page.tsx');
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /summary\.source_urls/);
  assert.match(source, /const sourceUrls = Array\.isArray\(summary\.source_urls\)/);
  assert.match(source, /const sourceUrlColumns = \[/);
  assert.match(source, /title="Top 引用 URL"/);
  assert.match(source, /dataSource=\{sourceUrls\}/);
});

test('report page renders url-level source changes from report summary', () => {
  const pagePath = path.resolve(__dirname, '../app/geo/reports/page.tsx');
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /const retainedDomains = Array\.isArray\(sourceChanges\.retained_domains\) \? sourceChanges\.retained_domains : \[\]/);
  assert.match(source, /const newUrls = Array\.isArray\(sourceChanges\.new_urls\) \? sourceChanges\.new_urls : \[\]/);
  assert.match(source, /const droppedUrls = Array\.isArray\(sourceChanges\.dropped_urls\) \? sourceChanges\.dropped_urls : \[\]/);
  assert.match(source, /const retainedUrls = Array\.isArray\(sourceChanges\.retained_urls\) \? sourceChanges\.retained_urls : \[\]/);
  assert.match(source, /const sourceUrlChangeColumns = \[/);
  assert.match(source, /title="新增引用 URL"/);
  assert.match(source, /dataSource=\{newUrls\}/);
  assert.match(source, /title="流失引用 URL"/);
  assert.match(source, /dataSource=\{droppedUrls\}/);
  assert.match(source, /title="保留引用域名"/);
  assert.match(source, /dataSource=\{retainedDomains\}/);
  assert.match(source, /title="保留引用 URL"/);
  assert.match(source, /dataSource=\{retainedUrls\}/);
});

test('report page renders platform and category context for source change tables', () => {
  const pagePath = path.resolve(__dirname, '../app/geo/reports/page.tsx');
  const source = fs.readFileSync(pagePath, 'utf8');

  const domainStart = source.indexOf('const sourceChangeColumns = [');
  assert.notEqual(domainStart, -1, 'sourceChangeColumns should exist');
  const domainEnd = source.indexOf('const sourceUrlChangeColumns = [', domainStart);
  assert.notEqual(domainEnd, -1, 'sourceUrlChangeColumns should follow sourceChangeColumns');
  const domainBlock = source.slice(domainStart, domainEnd);

  assert.match(domainBlock, /title:\s*'平台'/);
  assert.match(domainBlock, /dataIndex:\s*'platforms'/);
  assert.match(domainBlock, /title:\s*'问题分类'/);
  assert.match(domainBlock, /dataIndex:\s*'categories'/);
});
