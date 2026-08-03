const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pagePath = path.resolve(__dirname, '../../src/app/geo/order-results/page.tsx');
const cssPath = path.resolve(__dirname, '../../src/app/geo/order-results/order-results.module.css');
const sourcePath = path.resolve(__dirname, '../../src/lib/orderResults/orderResultsDataSource.ts');

test('keeps the default path honest and gates demo fixtures away from production', () => {
  const page = fs.readFileSync(pagePath, 'utf8');
  const source = fs.readFileSync(sourcePath, 'utf8');
  assert.match(page, /订单数据源尚未接入|dataSource\.message/);
  assert.match(source, /process\.env\.NODE_ENV !== 'production'/);
  assert.match(source, /state: 'UNAVAILABLE'/);
  assert.match(source, /sourceSystem: 'FRONTEND_FIXTURE'/);
  assert.doesNotMatch(source, /axios|\/api\/orders|localStorage/);
});

test('implements the required summary, one donut, trend and full-width table', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  for (const label of ['成交订单', '签订金额', '已关联订单', '待关联订单']) {
    assert.match(source, new RegExp(`title=\\"${label}\\"`));
  }
  assert.equal((source.match(/<Pie/g) || []).length, 1);
  assert.match(source, /innerRadius=\{0\.64\}/);
  assert.match(source, /label=\{false\}/);
  assert.match(source, /成交订单数/);
  assert.match(source, /签订金额/);
  assert.match(source, /<Table<OrderResult>/);
  assert.match(source, /pagination=\{false\}/);
});

test('provides filters, sorting, pagination and an overlay detail drawer', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');
  for (const label of [
    '订单来源筛选',
    '订单关联状态筛选',
    '搜索订单编号、项目或客户',
    '订单趋势指标'
  ]) assert.match(source, new RegExp(`aria-label=\\"${label}\\"`));
  assert.match(source, /sortKey/);
  assert.match(source, /showSizeChanger/);
  assert.match(source, /<Drawer/);
  assert.match(source, /keyboard/);
  assert.match(source, /maskClosable/);
  assert.match(source, /document\.addEventListener\('keydown', closeOnEscape\)/);
  assert.match(source, /returnFocusRef\.current\?\.focus/);
  assert.match(css, /\.detailDrawer:global\(\.ant-drawer\)/);
  assert.match(css, /top:\s*64px/);
  assert.match(css, /height:\s*calc\(100vh - 64px\)/);
});

test('keeps attribution manual, temporary and non-persistent', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  assert.match(source, /不会自动匹配/);
  assert.match(source, /不调用接口、不持久化，刷新后重置/);
  assert.match(source, /应用临时关联/);
  assert.doesNotMatch(source, /置信度|AI 推荐|多触点|自动归因/);
  assert.match(source, /销售系统尚未提供真实订单记录 URL/);
});

test('preserves responsive scrolling, contrast states and reduced motion', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /overflow:\s*auto/);
  assert.match(css, /color:\s*#b45309/);
  assert.match(css, /width:\s*min\(480px, 100vw\)/);
  assert.doesNotMatch(css, /font-family/);
});
