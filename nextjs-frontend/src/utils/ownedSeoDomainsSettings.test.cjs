const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontendRoot = path.resolve(__dirname, '../..');
const componentSource = fs.readFileSync(
  path.join(frontendRoot, 'src/app/admin/settings/OwnedSeoDomainsSettings.tsx'),
  'utf8'
);
const pageSource = fs.readFileSync(
  path.join(frontendRoot, 'src/app/admin/settings/page.tsx'),
  'utf8'
);

test('administrator can load and save exact owned origins from the settings center', () => {
  assert.match(componentSource, /axios\.get\('\/api\/settings\/seo-audit'\)/);
  assert.match(componentSource, /axios\.put\('\/api\/settings\/seo-audit'/);
  assert.match(componentSource, /ownedOrigins/);
  assert.match(componentSource, /每行一个/);
});

test('settings center exposes owned SEO sites as a dedicated tab', () => {
  assert.match(pageSource, /OwnedSeoDomainsSettings/);
  assert.match(pageSource, /key: 'seo-audit'/);
  assert.match(pageSource, /自有检测站点/);
});
