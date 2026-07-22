/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pagePath = path.resolve(__dirname, '../app/geo/seo-audit/page.tsx');
const historyPath = path.resolve(__dirname, '../app/geo/seo-audit/SeoAuditHistoryDrawer.tsx');

test('SEO audit page uses the authenticated API and leads with prioritized fixes', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /from '@\/lib\/axiosConfig'/);
  assert.match(source, /post\('\/api\/seo-audits'/);
  assert.match(source, /优先修复/);
  assert.match(source, /按优先级筛选/);
  assert.match(source, /categories/);
  assert.match(source, /previews/);
});

test('SEO audit page exposes paginated history and reopens complete reports', () => {
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const historySource = fs.readFileSync(historyPath, 'utf8');

  assert.match(pageSource, /SeoAuditHistoryDrawer/);
  assert.match(pageSource, /历史报告/);
  assert.match(historySource, /from '@\/lib\/axiosConfig'/);
  assert.match(historySource, /get\('\/api\/seo-audits'/);
  assert.match(historySource, /get\(`\/api\/seo-audits\/\$\{auditId\}`/);
  assert.match(historySource, /查看报告/);
});
