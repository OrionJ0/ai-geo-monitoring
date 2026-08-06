const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../app/geo/project-dashboard/page.tsx'), 'utf8');

test('project dashboard exposes top citation urls from dashboard summary', () => {
  assert.match(source, /summary\.source_urls/);
  assert.match(source, /const sourceUrls =[\s\S]*Array\.isArray\(summary\.source_urls\)/);
  assert.match(source, /const sourceUrlColumns = \[/);
  assert.match(source, /title="Top 引用 URL"/);
  assert.match(source, /dataSource=\{sourceUrls\}/);
});

test('project dashboard exposes top citation domains from dashboard summary', () => {
  assert.match(source, /summary\.source_domains/);
  assert.match(source, /const sourceDomains =[\s\S]*Array\.isArray\(summary\.source_domains\)/);
  assert.match(source, /const sourceDomainColumns = \[/);
  assert.match(source, /title="Top 引用域名"/);
  assert.match(source, /dataSource=\{sourceDomains\}/);
});

test('project dashboard exposes source type distribution from dashboard summary', () => {
  assert.match(source, /summary\.source_types/);
  assert.match(source, /const sourceTypes =[\s\S]*Array\.isArray\(summary\.source_types\)/);
  assert.match(source, /const sourceTypeColumns = \[/);
  assert.match(source, /title="来源类型分布"/);
  assert.match(source, /dataSource=\{sourceTypes\}/);
});

test('project dashboard exposes url-level source change counts', () => {
  assert.match(source, /const newSourceUrls = useMemo/);
  assert.match(source, /Array\.isArray\(sourceChanges\.new_urls\) \? sourceChanges\.new_urls : \[\]/);
  assert.match(source, /const droppedSourceUrls = useMemo/);
  assert.match(source, /Array\.isArray\(sourceChanges\.dropped_urls\) \? sourceChanges\.dropped_urls : \[\]/);
  assert.match(source, /const retainedSourceUrls = useMemo/);
  assert.match(source, /Array\.isArray\(sourceChanges\.retained_urls\) \? sourceChanges\.retained_urls : \[\]/);
  assert.match(source, /title="新增引用 URL"/);
  assert.match(source, /value=\{newSourceUrls\.length\}/);
  assert.match(source, /title="流失引用 URL"/);
  assert.match(source, /value=\{droppedSourceUrls\.length\}/);
  assert.match(source, /title="保留引用 URL"/);
  assert.match(source, /value=\{retainedSourceUrls\.length\}/);
});

test('project dashboard exposes domain-level source change counts and links to full details', () => {
  assert.match(source, /const retainedSourceDomains = useMemo/);
  assert.match(source, /Array\.isArray\(sourceChanges\.retained_domains\) \? sourceChanges\.retained_domains : \[\]/);
  assert.match(source, /title="新增引用域名"/);
  assert.match(source, /value=\{newSourceDomains\.length\}/);
  assert.match(source, /title="流失引用域名"/);
  assert.match(source, /value=\{droppedSourceDomains\.length\}/);
  assert.match(source, /title="保留引用域名"/);
  assert.match(source, /value=\{retainedSourceDomains\.length\}/);
  assert.match(source, /href="\/geo\/sources"/);
});
