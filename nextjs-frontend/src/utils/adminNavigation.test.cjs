/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildAdminNavigation,
  flattenAdminNavigation,
  resolveAdminLocation
} = require('./adminNavigation.cjs');

const srcRoot = path.resolve(__dirname, '..');

test('administrator navigation uses the approved hierarchy and labels', () => {
  const navigation = buildAdminNavigation();

  assert.deepEqual(navigation.map((item) => item.label), [
    '返回数据工作台',
    '后台总览',
    '历史记录',
    '账号与权限',
    '系统管理'
  ]);
  assert.deepEqual(
    flattenAdminNavigation(navigation).map((item) => item.label),
    [
      '返回数据工作台',
      '后台总览',
      '历史记录',
      '用户管理',
      '会员设置',
      '设置中心',
      '通知管理',
      '系统健康'
    ]
  );
});

test('administrator navigation resolves selected item', () => {
  assert.deepEqual(resolveAdminLocation('/admin'), { selectedKey: 'dashboard' });
  assert.deepEqual(resolveAdminLocation('/admin/users/42'), { selectedKey: 'users' });
  assert.deepEqual(resolveAdminLocation('/admin/settings'), { selectedKey: 'settings' });
});

test('administrator layout keeps every navigation group visible', () => {
  const source = fs.readFileSync(
    path.join(srcRoot, 'app/admin/layout.tsx'),
    'utf8'
  );

  assert.match(source, /buildAdminNavigation/);
  assert.match(source, /resolveAdminLocation/);
  assert.match(source, /type:\s*'group'\s+as const/);
  assert.doesNotMatch(source, /openKeys=/);
  assert.doesNotMatch(source, /onOpenChange=/);
  assert.doesNotMatch(source, /activeGroupKey/);
  assert.match(source, /onClick=\{handleSiderToggle\}/);
  assert.match(source, /className="geo-sider admin-sider"/);
  assert.match(source, /className="workspace-shell"/);
  assert.match(source, /className="workspace-navigation"/);
  assert.match(source, /className="geo-sider-backdrop"/);
  assert.match(source, /breakpoint="md"/);
  assert.match(source, /aria-label="管理员后台主导航"/);
  assert.match(source, /window\.setTimeout\(\(\) => setCollapsed\(true\), 0\)/);
  assert.doesNotMatch(source, /style=\{\{\s*background:\s*'#fff'\s*\}\}/);
});
