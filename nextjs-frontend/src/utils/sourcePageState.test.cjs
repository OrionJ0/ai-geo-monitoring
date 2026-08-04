/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../app/geo/sources/page.tsx'), 'utf8');
const styles = fs.readFileSync(path.resolve(__dirname, '../app/geo/sources/sources.module.css'), 'utf8');

test('citation source analysis ignores stale async responses after period changes', () => {
  assert.match(source, /useRef/);
  assert.match(source, /const sourceRequestRef = useRef\(0\)/);
  assert.match(source, /const invalidateSourceRequest = \(\) =>/);
  assert.match(source, /sourceRequestRef\.current \+= 1/);
  assert.match(source, /const handleDaysChange = \(value\) =>/);
  assert.match(source, /onChange=\{handleDaysChange\}/);
  assert.match(source, /const requestId = sourceRequestRef\.current \+ 1/);
  assert.match(source, /sourceRequestRef\.current = requestId/);
  assert.match(source, /if \(!id\) \{[\s\S]*setSources\(null\);[\s\S]*setSourceLoading\(false\);[\s\S]*return;/);
  const daysHandler = source.slice(
    source.indexOf('const handleDaysChange'),
    source.indexOf('const fetchSources')
  );
  assert.doesNotMatch(daysHandler, /setSources\(null\)/);
  assert.match(daysHandler, /setSourceLoading\(true\)/);
  assert.match(source, /if \(sourceRequestRef\.current === requestId\) setSources\(res\?\.data\?\.data \|\| null\)/);
  assert.match(source, /if \(sourceRequestRef\.current === requestId\) setSourceLoading\(false\)/);
});

test('citation source analysis uses only the explicit default project context', () => {
  assert.match(source, /useDefaultProjectContext/);
  assert.match(source, /defaultContext\.project\?\.id/);
  assert.match(source, /defaultContext\.errorMessage/);
  assert.doesNotMatch(source, /getSelectableProjects/);
  assert.doesNotMatch(source, /resolveSelectedProjectId/);
  assert.doesNotMatch(source, /axios\.get\(['"]\/api\/geo-projects['"]\)/);
  assert.doesNotMatch(source, /project_id/);
  assert.doesNotMatch(source, /placeholder="选择品牌项目"/);
  assert.match(source, /引用来源分析/);
});

test('source analysis page exposes url-level source changes', () => {
  assert.match(source, /const retainedDomains = Array\.isArray\(sourceChanges\?\.retained_domains\) \? sourceChanges\.retained_domains : \[\]/);
  assert.match(source, /const newUrls = Array\.isArray\(sourceChanges\?\.new_urls\) \? sourceChanges\.new_urls : \[\]/);
  assert.match(source, /const droppedUrls = Array\.isArray\(sourceChanges\?\.dropped_urls\) \? sourceChanges\.dropped_urls : \[\]/);
  assert.match(source, /const retainedUrls = Array\.isArray\(sourceChanges\?\.retained_urls\) \? sourceChanges\.retained_urls : \[\]/);
  assert.match(source, /title="引用域名变化"/);
  assert.match(source, /title="引用 URL 变化"/);
  assert.match(source, /renderDomainChanges\(retainedDomains/);
  assert.match(source, /renderUrlChanges\(retainedUrls/);
});

test('引用来源页面先展示主要来源，再集中展示变化和明细', () => {
  const typeIndex = source.indexOf('title="来源类型分布"');
  const domainIndex = source.indexOf('Top 来源域名');
  const urlIndex = source.indexOf('title="Top 引用 URL"');
  const gapIndex = source.indexOf('title="竞品来源缺口"');
  const domainChangeIndex = source.indexOf('title="引用域名变化"');
  const urlChangeIndex = source.indexOf('title="引用 URL 变化"');
  const recentIndex = source.indexOf('title="最近引用记录"');

  assert.ok(typeIndex < domainIndex && domainIndex < urlIndex);
  assert.ok(urlIndex < gapIndex && gapIndex < domainChangeIndex);
  assert.ok(domainChangeIndex < urlChangeIndex && urlChangeIndex < recentIndex);
});

test('引用变化使用两张全宽 Tab 表，不再把六张宽表压缩到三列卡片', () => {
  assert.match(source, /<Tabs/);
  assert.match(source, /新增（\$\{newDomains\.length\}）/);
  assert.match(source, /流失（\$\{droppedUrls\.length\}）/);
  assert.doesNotMatch(source, /<Col xs=\{24\} lg=\{8\}>\s*<Card size="small" title="新增引用域名"/);
});

test('引用来源同一行卡片保持等高', () => {
  assert.match(source, /className=\{styles\.equalCardRow\}/);
  assert.match(styles, /\.equalCardRow > :global\(\.ant-col\)\s*\{[^}]*display:\s*flex/);
  assert.match(styles, /\.equalCardRow > :global\(\.ant-col\) > :global\(\.ant-card\)\s*\{[^}]*height:\s*100%/);
});
