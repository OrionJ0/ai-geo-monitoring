const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const frontendDirectory = path.resolve(__dirname, '../..');
const pagePath = path.join(
  frontendDirectory,
  'src/app/geo/marketing/page.tsx'
);

test('frontend package has a real executable test command', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(frontendDirectory, 'package.json'), 'utf8')
  );

  assert.equal(
    packageJson.scripts.test,
    'node --test tests/marketing/*.test.cjs'
  );
});

test('marketing page skeleton states the integration boundary without fake funnel data', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /营销监控/);
  assert.match(source, /落地页系统和销售系统尚未接入/);
  assert.match(source, /不会展示模拟的咨询、订单或完整业务漏斗/);
  assert.match(source, /只读/);
  assert.doesNotMatch(source, /信息流/);
  assert.doesNotMatch(source, /咨询(?:数|量)[：:]\s*\d/u);
  assert.doesNotMatch(source, /订单(?:数|量)[：:]\s*\d/u);
});

test('workspace navigation exposes the new pages even before sources have data', () => {
  const navigation = fs.readFileSync(
    path.join(frontendDirectory, 'src/utils/geoNavigation.cjs'),
    'utf8'
  );

  assert.match(navigation, /\/geo\/market-overview/);
  assert.match(navigation, /\/geo\/ad-performance/);
  assert.match(navigation, /\/geo\/website-traffic/);
  assert.match(navigation, /\/geo\/consultations/);
  assert.match(navigation, /\/geo\/order-results/);
});

test('pilot marketing page reads Baidu Tongji separately from the local ad snapshot', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /\/tongji-trend/);
  assert.match(source, /百度统计 · 实时试点/);
  assert.match(source, /浏览量（PV）/);
  assert.match(source, /访客数（UV）/);
  assert.match(source, /不写入搜索广告的本地快照/);
  assert.match(source, /无数据标记，不按 0 处理/);
});
