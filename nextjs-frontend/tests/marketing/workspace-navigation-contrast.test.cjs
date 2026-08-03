const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const globalsCss = fs.readFileSync(
  path.join(__dirname, '../../src/app/globals.css'),
  'utf8',
);

test('工作区导航分组标题使用满足浅色背景对比度的文字颜色', () => {
  assert.match(
    globalsCss,
    /\.workspace-navigation\s*>\s*\.ant-menu-item-group\s*>\s*\.ant-menu-item-group-title\s*\{[^}]*color:\s*#667085;/s,
  );
});
