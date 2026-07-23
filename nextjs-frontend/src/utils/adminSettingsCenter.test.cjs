/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const settingsSource = fs.readFileSync(path.resolve(__dirname, '../app/admin/settings/page.tsx'), 'utf8');
const platformSource = fs.readFileSync(path.resolve(__dirname, '../app/admin/settings/AIPlatformSettings.tsx'), 'utf8');
const layoutSource = fs.readFileSync(path.resolve(__dirname, '../app/admin/layout.tsx'), 'utf8');

test('admin settings is the single settings center with three tabs', () => {
  assert.match(settingsSource, /AI 平台/);
  assert.match(settingsSource, /运行设置/);
  assert.match(settingsSource, /站点 SEO/);
  assert.match(settingsSource, /defaultActiveKey="ai-platforms"/);
  assert.match(layoutSource, /key: 'settings', label: '设置中心'/);
  assert.doesNotMatch(layoutSource, /key: 'platforms'|平台自检/);
});

test('platform settings use the management API for every explicit operation', () => {
  assert.match(platformSource, /\/api\/admin\/ai-platforms/);
  assert.match(platformSource, /\/enabled/);
  assert.match(platformSource, /\/api-key/);
  assert.match(platformSource, /\/test/);
  assert.match(platformSource, /Popconfirm/);
});

test('the retired standalone platform page is removed', () => {
  assert.equal(fs.existsSync(path.resolve(__dirname, '../app/admin/platforms/page.tsx')), false);
});
