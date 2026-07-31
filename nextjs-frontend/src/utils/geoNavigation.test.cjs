/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildGeoNavigation,
  flattenGeoNavigation,
  resolveGeoDefaultRoute,
  resolveGeoLocation
} = require('./geoNavigation.cjs');

const srcRoot = path.resolve(__dirname, '..');

test('workspace always shows the complete agreed information architecture', () => {
  const items = flattenGeoNavigation(buildGeoNavigation({
    formalNavigation: false,
    role: 'user'
  }));
  const labels = items.map((item) => item.label);
  const hrefs = items.map((item) => item.href);

  assert.deepEqual(labels, [
    '市场总览',
    '广告表现',
    '网站流量',
    '原始咨询',
    '订单结果',
    'AI 搜索表现',
    '引用来源分析',
    'SEO 健康检测',
    '问题库',
    '运行报告',
    '快捷导航',
    '系统通知',
    '个人中心'
  ]);
  assert.match(hrefs.join(' '), /market-overview|quick-links|ad-performance|website-traffic|consultations|order-results/);
  assert.equal(hrefs.includes('/admin/settings'), false);
  assert.equal(resolveGeoDefaultRoute({ formalNavigation: false }), '/geo/market-overview');
});

test('workspace navigation groups use the approved order and names', () => {
  const navigation = buildGeoNavigation({
    formalNavigation: true,
    role: 'user'
  });
  const items = flattenGeoNavigation(navigation);

  assert.deepEqual(navigation.map((item) => item.label), [
    '市场总览',
    '投放与流量',
    '转化结果',
    'AI 品牌监测',
    '网站诊断',
    '监测任务',
    '快捷导航',
    '设置'
  ]);
  assert.deepEqual(items.slice(0, 3).map((item) => item.label), [
    '市场总览',
    '广告表现',
    '网站流量',
  ]);
  assert.equal(navigation.at(-2).label, '快捷导航');
  assert.equal(navigation.at(-1).label, '设置');
  assert.equal(resolveGeoDefaultRoute({ formalNavigation: true }), '/geo/market-overview');
});

test('workspace settings group does not jump into the administrator console', () => {
  const userItems = flattenGeoNavigation(buildGeoNavigation({
    formalNavigation: false,
    role: 'user'
  }));
  const adminItems = flattenGeoNavigation(buildGeoNavigation({
    formalNavigation: false,
    role: 'admin'
  }));

  assert.equal(userItems.some((item) => item.href === '/admin/settings'), false);
  assert.equal(adminItems.some((item) => item.href === '/admin/settings'), false);
});

test('selected item and breadcrumb use the same longest-prefix navigation match', () => {
  const options = { formalNavigation: true, role: 'user' };
  const report = resolveGeoLocation('/geo/question-set-reports/run-42', options);
  const source = resolveGeoLocation('/geo/sources', options);

  assert.equal(report.selectedKey, '/question-set-reports');
  assert.equal(report.breadcrumb.at(-1).label, '运行报告');
  assert.equal(source.selectedKey, '/sources');
  assert.equal(source.breadcrumb.at(-1).label, '引用来源分析');
});

test('market routes keep an accurate breadcrumb before source data is available', () => {
  const options = { formalNavigation: false, role: 'user' };
  const location = resolveGeoLocation('/geo/market-overview', options);

  assert.equal(location.selectedKey, '/market-overview');
  assert.equal(location.breadcrumb.at(-1).label, '市场总览');
  assert.equal(
    flattenGeoNavigation(buildGeoNavigation(options))
      .some((item) => item.key === '/market-overview'),
    true
  );
});

test('legacy secondary GEO routes still redirect into retained workspace routes', () => {
  const redirects = {
    'app/geo/dashboard/page.tsx': '/geo/project-dashboard',
    'app/geo/history/page.tsx': '/geo/project-dashboard',
    'app/geo/tasks/page.tsx': '/geo/project-dashboard'
  };

  Object.entries(redirects).forEach(([relativePath, target]) => {
    const source = fs.readFileSync(path.join(srcRoot, relativePath), 'utf8');
    assert.match(source, new RegExp(`redirect\\('${target}'\\)`));
  });
});

test('workspace entry and layout consume the shared navigation contract', () => {
  const entrySource = fs.readFileSync(path.join(srcRoot, 'app/geo/page.tsx'), 'utf8');
  const layoutSource = fs.readFileSync(path.join(srcRoot, 'app/geo/layout.tsx'), 'utf8');

  assert.match(entrySource, /resolveGeoDefaultRoute/);
  assert.doesNotMatch(entrySource, /formalNavigation/);
  assert.match(layoutSource, /buildGeoNavigation/);
  assert.match(layoutSource, /resolveGeoLocation/);
  assert.match(layoutSource, /openKeys=\{openKeys\}/);
  assert.match(layoutSource, /onOpenChange=\{handleOpenChange\}/);
  assert.match(layoutSource, /setOpenKeys\(keys\)/);
  assert.doesNotMatch(layoutSource, /keys\.slice\(-1\)/);
  assert.doesNotMatch(layoutSource, /type:\s*'group'\s+as const/);
  assert.doesNotMatch(layoutSource, /const breadcrumbMap/);
});

test('workspace sidebar stays operable and named on narrow screens', () => {
  const layoutSource = fs.readFileSync(path.join(srcRoot, 'app/geo/layout.tsx'), 'utf8');
  const globalStyles = fs.readFileSync(path.join(srcRoot, 'app/globals.css'), 'utf8');

  assert.match(layoutSource, /breakpoint="md"/);
  assert.match(layoutSource, /aria-label="工作台主导航"/);
  assert.match(layoutSource, /aria-label=\{collapsed \? '展开侧栏' : '折叠侧栏'\}/);
  assert.match(layoutSource, /className="geo-sider"/);
  assert.match(layoutSource, /className="workspace-shell"/);
  assert.match(layoutSource, /className="workspace-navigation"/);
  assert.match(layoutSource, /className="geo-sider-backdrop"/);
  assert.match(layoutSource, /aria-label="关闭侧栏"/);
  assert.match(layoutSource, /if \(collapsed && activeGroupKey\)/);
  assert.match(layoutSource, /onClick=\{handleSiderToggle\}/);
  assert.match(layoutSource, /window\.innerWidth < 768/);
  assert.match(layoutSource, /window\.setTimeout\(\(\) => setCollapsed\(true\), 0\)/);
  assert.match(globalStyles, /@media \(max-width: 680px\)/);
  assert.match(globalStyles, /\.geo-content/);
  assert.match(globalStyles, /\.workspace-shell\s*\{[\s\S]*overflow:\s*hidden/);
  assert.match(globalStyles, /\.geo-content\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(globalStyles, /\.workspace-navigation > \.ant-menu-item,[\s\S]*color:\s*#4b5563/);
  assert.match(globalStyles, /\.geo-sider\s*\{[\s\S]*position:\s*fixed/);
  assert.match(globalStyles, /@media \(max-width: 680px\)[\s\S]*\.geo-sider\s*\{[\s\S]*height:\s*auto/);
  assert.match(globalStyles, /:focus-visible/);
});
