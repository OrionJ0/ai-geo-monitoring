const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pagePath = path.resolve(
  __dirname,
  '../../src/app/geo/consultations/page.tsx'
);
const cssPath = path.resolve(
  __dirname,
  '../../src/app/geo/consultations/consultations.module.css'
);
const recordsHookPath = path.resolve(
  __dirname,
  '../../src/lib/consultations/useConsultationRecords.ts'
);
const dailyHookPath = path.resolve(
  __dirname,
  '../../src/lib/websiteData/useWebsiteFormConsultationDays.ts'
);

test('keeps form and online-chat consultations independent without a total', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  assert.match(source, /title="表单咨询"/);
  assert.match(source, /title="在线客服有效对话"/);
  assert.doesNotMatch(source, /咨询总数|总咨询/);
  for (const forbidden of ['线索', '订单', '成交金额', 'ROAS', 'CPA', 'CPL']) {
    assert.doesNotMatch(source, new RegExp(`>${forbidden}<`));
  }
});

test('implements exclusive trend/distribution views and independent filters', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  assert.match(source, /key: 'trend', label: '咨询趋势'/);
  assert.match(source, /key: 'distribution', label: '来源分布'/);
  assert.match(source, /children: trendPanel/);
  assert.match(source, /children: distributionPanel/);
  assert.match(source, /aria-label="咨询分析来源"/);
  assert.match(source, /<MarketingPageFilters/);
  assert.match(source, /queryDevice/);
  assert.match(source, /表单咨询与在线客服有效对话始终保持独立口径/);
  assert.match(source, /aria-describedby="consultation-trend-data"/);
  assert.match(source, /aria-describedby="consultation-distribution-data"/);
});

test('renders one full-width recent-consultation table with server filters', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  for (const column of [
    '时间',
    '类型',
    '来源',
    '落地页',
    '咨询内容摘要',
    '联系人',
    '查看'
  ]) assert.match(source, new RegExp(`title: '${column}'`));
  assert.match(source, /aria-label="最近咨询类型"/);
  assert.match(source, /aria-label="最近咨询来源"/);
  assert.match(source, /aria-label="搜索咨询内容"/);
  assert.match(source, /showSizeChanger/);
  assert.match(source, /sortBy/);
  assert.match(source, /sortOrder/);
});

test('uses a true overlay drawer with ESC and focus restoration', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.match(source, /<Drawer/);
  assert.match(source, /width=\{440\}/);
  assert.match(source, /keyboard/);
  assert.match(source, /maskClosable/);
  assert.match(source, /target\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /data-consultation-record-id/);
  assert.match(source, /\.ant-drawer-section\[aria-label=\"咨询详情\"\] \.ant-drawer-close/);
  assert.match(css, /\.detailDrawer:global\(\.ant-drawer\)\s*\{[^}]*top:\s*64px/s);
  assert.match(css, /height:\s*calc\(100vh - 64px\)/);
  assert.match(css, /box-shadow:\s*-10px 0 28px/);
  assert.doesNotMatch(source, /SplitPane|fixedDetailPane|detailColumn/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /aria-disabled="true"/);
  assert.match(source, /aria-describedby=\{reasonId\}/);
  assert.match(source, /来源明细接口尚未验证，当前不能查看详情/);
  assert.match(source, /trigger=\{\['hover'\]\}/);
  assert.doesNotMatch(source, /type="link"\s+size="small"\s+disabled/);
});

test('reads real contracts and validates all responses at the browser boundary', () => {
  const recordsHook = fs.readFileSync(recordsHookPath, 'utf8');
  const dailyHook = fs.readFileSync(dailyHookPath, 'utf8');
  assert.match(recordsHook, /\/api\/consultations\/projects\//);
  assert.match(recordsHook, /consultation_records_v1/);
  assert.match(recordsHook, /validContact/);
  assert.match(recordsHook, /contact\.phone\.includes\('\*'\)/);
  assert.match(recordsHook, /containsRawPii/);
  assert.match(dailyHook, /form-consultation-days/);
  assert.match(dailyHook, /ATTRIBUTED_SESSION_SUBMISSIONS_ONLY/);
  assert.doesNotMatch(recordsHook, /138\d{8}|@gato\.com\.cn/);
  assert.doesNotMatch(dailyHook, /138\d{8}|@gato\.com\.cn/);
});

test('preserves responsive table scrolling and reduced motion', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /width:\s*min\(440px, 100vw\)/);
  assert.doesNotMatch(css, /font-family/);
  assert.match(css, /backdrop-filter:\s*none !important/);
});
