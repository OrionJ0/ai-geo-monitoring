const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontendRoot = path.resolve(__dirname, '../..');

test('workspace settings owns the complete single-brand profile and competitors', () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, 'src/app/admin/settings/WorkspaceSettings.tsx'),
    'utf8'
  );

  [
    '品牌名称',
    '品牌别名',
    '官网',
    '行业',
    '品牌核心关键词',
    '自动监测',
    '每日监测时间',
    '竞品'
  ].forEach((label) => assert.match(source, new RegExp(label)));
  assert.match(source, /\/api\/geo-projects\/\$\{projectId\}/);
  assert.match(source, /\/competitors/);
  assert.match(source, /仅影响后续运行/);
  assert.doesNotMatch(source, /name="platforms"/);
});

test('the retired project-management page redirects to workspace settings', () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, 'src/app/geo/projects/page.tsx'),
    'utf8'
  );

  assert.match(source, /redirect\(['"]\/admin\/settings#workspace['"]\)/);
  assert.doesNotMatch(source, /新建项目/);
  assert.doesNotMatch(source, /监测平台/);
});
