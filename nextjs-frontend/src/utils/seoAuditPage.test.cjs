/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pagePath = path.resolve(__dirname, '../app/geo/seo-audit/page.tsx');

test('SEO audit page uses the authenticated API and leads with prioritized fixes', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /from '@\/lib\/axiosConfig'/);
  assert.match(source, /post\('\/api\/seo-audits'/);
  assert.match(source, /优先修复/);
  assert.match(source, /按优先级筛选/);
  assert.match(source, /categories/);
  assert.match(source, /previews/);
});
