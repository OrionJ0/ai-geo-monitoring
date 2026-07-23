/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pagePath = path.resolve(__dirname, '../app/geo/seo-audit/page.tsx');
const historyPath = path.resolve(__dirname, '../app/geo/seo-audit/SeoAuditHistoryDrawer.tsx');
const crawlerAccessPath = path.resolve(__dirname, '../app/geo/seo-audit/CrawlerAccessPanel.tsx');
const siteReportPath = path.resolve(__dirname, '../app/geo/seo-audit/SeoSiteAuditReport.tsx');
const healthOverviewPath = path.resolve(__dirname, '../app/geo/seo-audit/TechnicalHealthOverview.tsx');

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

test('SEO reports group search and AI crawler permissions with robots limitations', () => {
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const siteReportSource = fs.readFileSync(siteReportPath, 'utf8');
  const panelSource = fs.readFileSync(crawlerAccessPath, 'utf8');

  assert.match(pageSource, /CrawlerAccessPanel/);
  assert.match(pageSource, /report\.crawlerAccess/);
  assert.match(siteReportSource, /CrawlerAccessPanel/);
  assert.match(siteReportSource, /report\.crawlerAccess/);
  assert.match(panelSource, /access\.crawlers/);
  assert.match(panelSource, /搜索引擎/);
  assert.match(panelSource, /AI 搜索/);
  assert.match(panelSource, /用户触发访问/);
  assert.match(panelSource, /AI 训练与数据使用/);
  assert.match(panelSource, /robots 允许不等于一定收录或引用/);
  assert.match(panelSource, /纳入评分/);
  assert.match(panelSource, /不计分/);
});

test('SEO history distinguishes full-site reports and page coverage', () => {
  const historySource = fs.readFileSync(historyPath, 'utf8');

  assert.match(historySource, /summary\?\.mode/);
  assert.match(historySource, /全站/);
  assert.match(historySource, /summary\?\.pages/);
});

test('SEO 报告支持标准 CSV 导出并重新导入历史', () => {
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const historySource = fs.readFileSync(historyPath, 'utf8');

  assert.match(pageSource, /Upload/);
  assert.match(pageSource, /导入 CSV/);
  assert.match(pageSource, /get\(`\/api\/seo-audits\/\$\{report\.auditId\}\/export`/);
  assert.match(pageSource, /post\('\/api\/seo-audits\/import'/);
  assert.match(pageSource, /text\/csv/);
  assert.match(pageSource, /responseType:\s*'blob'/);
  assert.match(historySource, /summary\?\.source === 'imported'/);
  assert.match(historySource, /导入/);
});

test('v4 单页和全站报告只使用技术健康分作为主指标并展示四阶段', () => {
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const siteSource = fs.readFileSync(siteReportPath, 'utf8');
  const healthSource = fs.readFileSync(healthOverviewPath, 'utf8');

  assert.match(pageSource, /TechnicalHealthOverview/);
  assert.match(siteSource, /TechnicalHealthOverview/);
  assert.match(healthSource, /技术健康分/);
  assert.match(healthSource, /访问与发现/);
  assert.match(healthSource, /索引资格/);
  assert.match(healthSource, /内容理解/);
  assert.match(healthSource, /展示与增强/);
  assert.match(healthSource, /主要瓶颈/);
  assert.doesNotMatch(pageSource, /SEO 基础分/);
  assert.doesNotMatch(pageSource, /技术健康度/);
  assert.doesNotMatch(siteSource, /技术健康度/);
});

test('v4 问题项展示阶段、覆盖率、具体事实、实际扣分和小字建议', () => {
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const siteSource = fs.readFileSync(siteReportPath, 'utf8');

  for (const source of [pageSource, siteSource]) {
    assert.match(source, /stageLabel/);
    assert.match(source, /coverage/);
    assert.match(source, /deduction/);
    assert.match(source, /检测事实/);
    assert.match(source, /建议：/);
  }
});

test('SEO 历史只比较版本、模式和 URL 相同的有效分数', () => {
  const historySource = fs.readFileSync(historyPath, 'utf8');

  assert.match(historySource, /scoreVersion/);
  assert.match(historySource, /summary\?\.mode/);
  assert.match(historySource, /finalUrl/);
  assert.match(historySource, /score !== null/);
  assert.match(historySource, /较上次/);
  assert.match(historySource, /旧版评分/);
});
