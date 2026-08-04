const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const page = fs.readFileSync(path.join(
  root,
  'src/app/geo/marketing-ai-analysis/page.tsx'
), 'utf8');
const styles = fs.readFileSync(path.join(
  root,
  'src/app/geo/marketing-ai-analysis/marketing-ai-analysis.module.css'
), 'utf8');
const fixture = fs.readFileSync(path.join(
  root,
  'src/fixtures/marketingAiReportPreview.fixture.ts'
), 'utf8');

test('marketing AI page is honest before the backend report flow exists', () => {
  assert.match(page, /前端预览页已开放/);
  assert.match(page, /真实报告生成尚未接入/);
  assert.match(page, /不会读取来源数据/);
  assert.match(page, /<Button type="primary" disabled>生成报告<\/Button>/);
  assert.doesNotMatch(page, /axios|\/api\/marketing-analysis/);
});

test('marketing AI preview stays unavailable in production', () => {
  assert.match(page, /NODE_ENV !== 'production'/);
  assert.doesNotMatch(page, /NEXT_PUBLIC_ENABLE_MARKETING_AI_ANALYSIS_DEMO/);
  assert.match(page, /尚未在生产环境启用/);
  assert.match(page, /当前正式流程不会展示示例报告/);
});

test('marketing AI page uses the workspace header and responsive content surface', () => {
  assert.match(page, /<WorkspacePageHeader/);
  assert.match(page, /title="营销数据 AI 分析"/);
  assert.match(page, /aria-label="营销数据 AI 分析"/);
  assert.match(styles, /min-height:\s*420px/);
  assert.match(styles, /@media \(max-width: 767px\)/);
});

test('sample report separates program facts from AI interpretation and recommendations', () => {
  assert.match(page, /<MarketingMetricGrid/);
  assert.match(page, /<MarketingMetricCard/);
  assert.match(page, />程序事实</);
  assert.match(page, />AI 解读</);
  assert.match(page, /建议是待执行或待验证方向，不是已证明事实/);
  assert.match(page, /跨来源混绘/);
  assert.match(page, /来源覆盖与口径/);
});

test('sample charts are allowlisted, static and have an equivalent data table', () => {
  assert.equal((page.match(/<Line/g) || []).length, 1);
  assert.match(page, /animate=\{false\}/);
  assert.match(page, /role="img"/);
  assert.match(page, /aria-label="示例趋势等价数据表"/);
  assert.match(page, /<caption>/);
  assert.match(page, /<select/);
  assert.doesNotMatch(page, /<Select/);
  assert.doesNotMatch(page, /dangerouslySetInnerHTML|react-markdown|eval\(/);
});

test('sample mode is user-initiated and remains visibly marked as non-real data', () => {
  assert.match(page, /useState\(false\)/);
  assert.match(page, /查看示例报告/);
  assert.match(page, /所有数字均为非真实数据/);
  assert.match(page, /不读取来源数据、不写入数据库/);
  assert.match(page, /返回未接入状态/);
  assert.match(page, /示例报告历史/);
});

test('preview fixture is explicitly synthetic and preserves source boundaries', () => {
  assert.match(fixture, /FRONTEND_PREVIEW_ONLY/);
  assert.match(fixture, /所有数字均为前端展示样例/);
  assert.match(fixture, /上一周期只覆盖 24 \/ 30 天/);
  assert.match(fixture, /不补零，也不外推/);
  assert.match(fixture, /当前证据不能证明广告变化导致访问回落/);
  assert.doesNotMatch(fixture, /phone|email|contactId|visitorId|sessionId/i);
});

test('report layout stays responsive without decorative animation or custom fonts', () => {
  assert.match(styles, /grid-template-columns:\s*minmax\(0, 1\.12fr\)/);
  assert.match(styles, /\.metricGridOverride > div/);
  assert.match(styles, /@media \(max-width: 1180px\)/);
  assert.match(styles, /@media \(max-width: 860px\)/);
  assert.match(styles, /@media \(max-width: 520px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /overflow:\s*auto/);
  assert.match(styles, /:focus-visible/);
  assert.doesNotMatch(styles, /font-family|linear-gradient|box-shadow/);
});
