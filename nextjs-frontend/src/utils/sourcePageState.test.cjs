/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../app/geo/sources/page.tsx'), 'utf8');

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
  assert.match(source, /setSources\(null\)[\s\S]*setSourceLoading\(true\)/);
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
  assert.match(source, /title="新增引用 URL"/);
  assert.match(source, /title="流失引用 URL"/);
  assert.match(source, /title="保留引用域名"/);
  assert.match(source, /dataSource=\{retainedDomains\}/);
  assert.match(source, /title="保留引用 URL"/);
});
