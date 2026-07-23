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

test('SEO audit results separate the finding, evidence and recommendation', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /getCheckFinding\(check\)/);
  assert.match(source, /getCheckFinding\(item\)/);
  assert.match(source, /检测事实/);
  assert.match(source, /建议：/);
  assert.match(source, /report\.summary\.total/);
});

test('legacy SEO reports translate failed check labels into problem findings', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /LEGACY_FAILED_FINDINGS/);
  assert.match(source, /页面标题长度需要优化/);
  assert.match(source, /缺少 H1/);
  assert.match(source, /张图片缺少有效 Alt/);
  assert.match(source, /JSON-LD 结构化数据缺失/);
});

test('SEO audit page defaults to full-site mode and polls persisted asynchronous jobs', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /useState\('site'\)/);
  assert.match(source, /全站检测/);
  assert.match(source, /单页检测/);
  assert.match(source, /post\('\/api\/seo-audits\/site'/);
  assert.match(source, /get\(`\/api\/seo-audits\/jobs\/\$\{jobId\}`/);
  assert.match(source, /localStorage/);
});

test('SEO audit page renders crawl progress and a site-level report contract', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /SeoSiteAuditReport/);
  assert.match(source, /SeoAuditJobProgress/);
  assert.match(source, /job\.progress/);
});

test('SEO reports show separate Google, Bing and Baidu verification tag states', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /SearchPlatformPanel/);
  assert.match(source, /report\.platforms/);
});

test('SEO history distinguishes full-site reports and page coverage', () => {
  const historySource = fs.readFileSync(historyPath, 'utf8');

  assert.match(historySource, /summary\?\.mode/);
  assert.match(historySource, /全站/);
  assert.match(historySource, /summary\?\.pages/);
});
