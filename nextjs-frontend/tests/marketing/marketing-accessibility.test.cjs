const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const frontendDirectory = path.resolve(__dirname, '../..');
const marketingPage = fs.readFileSync(
  path.join(frontendDirectory, 'src/app/geo/marketing/page.tsx'),
  'utf8'
);
const marketingCss = fs.readFileSync(
  path.join(frontendDirectory, 'src/app/geo/marketing/marketing.module.css'),
  'utf8'
);
const marketingSettings = fs.readFileSync(
  path.join(
    frontendDirectory,
    'src/app/admin/settings/BaiduMarketingSettings.tsx'
  ),
  'utf8'
);

test('marketing dashboard provides one live region and equivalent trend table', () => {
  assert.equal((marketingPage.match(/aria-live="polite"/gu) || []).length, 1);
  assert.match(marketingPage, /逐日营销指标等价数据表/);
  assert.match(marketingPage, /role="region"/);
  assert.match(marketingPage, /tabIndex=\{0\}/);
  assert.match(marketingPage, /aria-describedby/);
  assert.match(marketingPage, /scope="col"/);
  assert.match(marketingPage, /scope="row"/);
});

test('marketing layout includes narrow viewport, focus, and reduced-motion rules', () => {
  assert.match(marketingCss, /@media \(max-width: 760px\)/);
  assert.match(marketingCss, /:focus-visible/);
  assert.match(marketingCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(marketingCss, /overflow-x: auto/);
});

test('marketing dashboard keeps exact values out of floating point conversion', () => {
  assert.doesNotMatch(marketingPage, /\bparseInt\s*\(/u);
  assert.doesNotMatch(marketingPage, /\bparseFloat\s*\(/u);
  assert.doesNotMatch(marketingPage, /\bNumber\s*\(/u);
});

test('administrator UI exposes the complete account binding lifecycle', () => {
  assert.match(marketingSettings, /绑定搜索账户/);
  assert.match(marketingSettings, /\/baidu-bindings/);
  assert.match(marketingSettings, /action: 'pause' \| 'resume'/);
  assert.match(marketingSettings, /\/\$\{action\}/);
  assert.match(marketingSettings, /axios\.delete/);
  assert.match(marketingSettings, /解除绑定不会修改百度来源数据/);
});
