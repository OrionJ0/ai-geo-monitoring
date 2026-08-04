/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function listTsxFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTsxFiles(entryPath);
    return entry.name.endsWith('.tsx') ? [entryPath] : [];
  });
}

test('市场页面不重复侧边栏标题或展示解释性段落', () => {
  const overview = read('app/geo/market-overview/page.tsx');
  const consultations = read('app/geo/consultations/page.tsx');
  const orders = read('app/geo/order-results/page.tsx');

  [
    '最近 30 天投入和网站流量',
    '各来源独立观察，不构成跨来源归因',
    '广告和网站流量分别展示，不连接、不换算',
    '当前只提示数据健康；趋势阈值尚未批准'
  ].forEach((copy) => assert.equal(overview.includes(copy), false));
  assert.match(overview, /<h1 className=\{styles\.visuallyHidden\}>市场总览<\/h1>/);
  assert.match(orders, /<h1 className=\{styles\.visuallyHidden\}>订单结果<\/h1>/);
  assert.doesNotMatch(orders, /<Title level=\{1\}/);
  assert.match(consultations, /<h1 className=\{styles\.visuallyHidden\}>咨询数据<\/h1>/);
  assert.doesNotMatch(overview, /<Title level=\{1\}/);
  assert.doesNotMatch(consultations, /<Title level=\{1\}|<Paragraph/);
  assert.doesNotMatch(orders, /<Paragraph|<Title/);
});

test('正式工作台页面以控件和数据开场，不重复导航页名', () => {
  const pages = [
    ['app/geo/project-dashboard/page.tsx', />总体表现</],
    ['app/geo/sources/page.tsx', />引用来源分析</],
    ['app/geo/prompts/page.tsx', /<Card title="问题库"/],
    ['app/geo/question-set-reports/page.tsx', />运行报告</],
    ['app/geo/notice/page.tsx', /<Card title="系统通知"/]
  ];

  pages.forEach(([file, duplicateTitle]) => {
    assert.doesNotMatch(read(file), duplicateTitle);
  });

  const websiteTraffic = read('app/geo/website-traffic/page.tsx');
  assert.match(websiteTraffic, /<h1 className=\{styles\.visuallyHidden\}>网站流量<\/h1>/);
  assert.doesNotMatch(websiteTraffic, /<Title level=\{1\}/);

  const adPerformance = read('app/geo/ad-performance/page.tsx');
  assert.doesNotMatch(adPerformance, /<Title level=\{1\}|<h1[^>]*>广告表现<\/h1>/);
});

test('SEO 检测用操作和状态说明范围，不展示功能宣传卡片', () => {
  const page = read('app/geo/seo-audit/page.tsx');
  const styles = read('app/geo/seo-audit/seo-audit.module.css');

  assert.doesNotMatch(page, /从站内链接与 Sitemap/);
  assert.doesNotMatch(page, /className=\{styles\.startPanel\}/);
  assert.doesNotMatch(styles, /\.hero::(?:before|after)/);
});

test('管理员页面不重复侧边栏页名或常驻说明', () => {
  const files = {
    users: read('app/admin/users/page.tsx'),
    memberships: read('app/admin/memberships/page.tsx'),
    notice: read('app/admin/notice/page.tsx'),
    health: read('app/admin/health/page.tsx'),
    settings: read('app/admin/settings/page.tsx')
  };

  assert.doesNotMatch(files.users, /<Card title="用户管理"/);
  assert.doesNotMatch(files.memberships, /<Card title="会员设置"/);
  assert.doesNotMatch(files.memberships, /title="说明"/);
  assert.doesNotMatch(files.notice, /<Card title="通知管理"/);
  assert.doesNotMatch(files.notice, /在此编辑系统通知/);
  assert.doesNotMatch(files.health, /<Card title="系统健康"/);
  assert.doesNotMatch(files.settings, /<Card title="设置中心"/);
});

test('个人中心不再请求或展示配额', () => {
  const profile = read('app/geo/profile/page.tsx');

  assert.doesNotMatch(profile, /\/api\/users\/quota\//);
  assert.doesNotMatch(profile, /配额与使用情况/);
  assert.doesNotMatch(profile, /<Statistic/);
});

test('工作台静态 tooltip 文案保持简短', () => {
  const roots = [
    path.resolve(__dirname, '../app/geo'),
    path.resolve(__dirname, '../components')
  ];
  const patterns = [
    /<Tooltip[^>]*\btitle="([^"]+)"/gs,
    /\b(?:info|help)="([^"]+)"/g,
    /\binfo:\s*'([^']+)'/g,
    /\bformula:\s*'([^']+)'/g
  ];

  roots.flatMap(listTsxFiles).forEach((file) => {
    const source = fs.readFileSync(file, 'utf8');
    patterns.forEach((pattern) => {
      for (const match of source.matchAll(pattern)) {
        assert.ok(
          Array.from(match[1]).length <= 40,
          `${path.relative(path.resolve(__dirname, '..'), file)} tooltip 过长：${match[1]}`
        );
      }
    });
  });
});
