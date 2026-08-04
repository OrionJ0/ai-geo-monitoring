const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('workspace page header provides one shared breadcrumb and action row', () => {
  const component = read('src/components/WorkspacePageHeader.tsx');
  const styles = read('src/components/WorkspacePageHeader.module.css');

  assert.match(component, /<Breadcrumb items=\{items\}/);
  assert.match(component, /actions \? <div className=\{styles\.actions\}>/);
  assert.match(styles, /min-height:\s*32px/);
  assert.match(styles, /@media \(max-width: 767px\)/);
});

test('GEO and monitoring pages share the workspace page header', () => {
  for (const page of [
    'src/app/geo/project-dashboard/page.tsx',
    'src/app/geo/sources/page.tsx',
    'src/app/geo/prompts/page.tsx',
    'src/app/geo/question-set-reports/page.tsx',
    'src/app/geo/quick-links/page.tsx',
    'src/app/geo/seo-audit/page.tsx',
    'src/app/geo/profile/page.tsx'
  ]) {
    assert.match(read(page), /<WorkspacePageHeader/);
  }
});

test('workspace pages use one content inset and standard 32px filters', () => {
  const dashboard = read('src/app/geo/project-dashboard/project-dashboard.module.css');
  const traffic = read('src/app/geo/website-traffic/website-traffic.module.css');
  const consultations = read('src/app/geo/consultations/consultations.module.css');
  const orders = read('src/app/geo/order-results/order-results.module.css');
  const filters = read('src/components/marketing/marketing-shared.module.css');
  const globals = read('src/app/globals.css');

  assert.doesNotMatch(dashboard, /\.page\s*\{[^}]*padding:\s*24px/s);
  assert.doesNotMatch(traffic, /top:\s*-20px|margin-bottom:\s*-20px/);
  assert.match(traffic, /\.breadcrumbRow\s*\{[^}]*min-height:\s*32px/s);
  assert.match(consultations, /\.tableCard\s*\{[^}]*border-radius:\s*10px/s);
  assert.match(orders, /\.breadcrumbRow\s*\{[^}]*margin-bottom:\s*16px/s);
  assert.match(orders, /\.tableCard\s*\{[^}]*border-radius:\s*10px/s);
  assert.match(filters, /\.deviceSelect\s*\{[^}]*min-height:\s*32px/s);
  assert.match(filters, /\.dateFilter\s*\{[^}]*min-height:\s*32px/s);
  assert.doesNotMatch(globals, /\.ant-statistic-(?:title|content)\s*\{[^}]*!important/s);
});
