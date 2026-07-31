const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pagePath = path.resolve(
  __dirname,
  '../../src/app/geo/market-overview/page.tsx'
);
const hookPath = path.resolve(
  __dirname,
  '../../src/lib/marketing/useMarketOverview.ts'
);

test('overview independently settles advertising and traffic reads', () => {
  const source = fs.readFileSync(hookPath, 'utf8');

  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /\/dashboard/);
  assert.match(source, /\/tongji-trend/);
  assert.match(source, /ad:\s*SourceSlot/);
  assert.match(source, /traffic:\s*SourceSlot/);
});

test('overview contains exactly the three product-level sections', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  assert.match(source, />全链路概览</);
  assert.match(source, />投入与流量趋势</);
  assert.match(source, />需要关注</);
  assert.doesNotMatch(source, />01<|>02<|>03</);
  assert.match(source, /Card/);
  assert.match(source, /Typography/);
});

test('journey shows unavailable conversion sources without fake values', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /原始咨询/);
  assert.match(source, /落地页系统尚未提供稳定 API/);
  assert.match(source, /订单结果/);
  assert.match(source, /销售系统尚未提供稳定 API/);
  assert.match(source, /来源暂不可接入/);
  assert.doesNotMatch(source, /订单数量|转化率/);
});

test('overview labels a successful empty read as no data', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /EMPTY:\s*\{\s*label: '当前无数据'/);
  assert.match(source, /当前无数据/);
});

test('overview keeps source scope separate and does not imply attribution', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /各来源独立观察，不构成跨来源归因/);
  assert.match(source, /lastSuccessfulAt/);
  assert.match(source, /LIVE_PILOT/);
  assert.match(source, /广告逐日趋势等价数据表/);
  assert.match(source, /网站逐日趋势等价数据表/);
  assert.doesNotMatch(source, /广告带来|流量贡献|点击转化/);
});

test('overview styles preserve reading order and narrow viewport layout', () => {
  const css = fs.readFileSync(
    path.resolve(
      __dirname,
      '../../src/app/geo/market-overview/market-overview.module.css'
    ),
    'utf8'
  );

  assert.match(css, /\.journeyGrid/);
  assert.match(css, /\.trendGrid/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /grid-template-columns:\s*1fr/);
  assert.doesNotMatch(css, /font-family/);
  assert.doesNotMatch(css, /letter-spacing:\s*0\.1[0-9]em/);
});
