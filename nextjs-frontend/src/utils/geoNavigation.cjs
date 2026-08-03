function page(key, label, href) {
  return Object.freeze({ type: 'item', key, label, href });
}

function group(key, label, children) {
  return Object.freeze({ type: 'group', key, label, children });
}

const MARKET_OVERVIEW = page(
  '/market-overview',
  '市场总览',
  '/geo/market-overview'
);

const QUICK_LINKS = page(
  '/quick-links',
  '常用网站',
  '/geo/quick-links'
);

const DELIVERY_ITEMS = Object.freeze([
  page('/ad-performance', '广告表现', '/geo/ad-performance'),
  page('/keyword-analysis', '关键词分析', '/geo/keyword-analysis'),
  page('/website-traffic', '网站流量', '/geo/website-traffic')
]);

const AI_MONITORING_ITEMS = Object.freeze([
  page('/project-dashboard', 'AI 搜索表现', '/geo/project-dashboard'),
  page('/sources', '引用来源分析', '/geo/sources')
]);

const WEBSITE_DIAGNOSIS_ITEMS = Object.freeze([
  page('/seo-audit', 'SEO 健康检测', '/geo/seo-audit')
]);

const MONITORING_TASK_ITEMS = Object.freeze([
  page('/prompts', '问题库', '/geo/prompts'),
  page('/question-set-reports', '运行报告', '/geo/question-set-reports')
]);

function buildGeoNavigation() {
  const navigation = [
    MARKET_OVERVIEW,
    group('delivery', '投放与流量', DELIVERY_ITEMS),
    group('conversion', '转化结果', [
      page('/consultations', '原始咨询', '/geo/consultations'),
      page('/order-results', '订单结果', '/geo/order-results')
    ])
  ];

  navigation.push(group('ai-monitoring', 'AI 品牌监测', AI_MONITORING_ITEMS));
  navigation.push(group(
    'website-diagnosis',
    '网站诊断',
    WEBSITE_DIAGNOSIS_ITEMS
  ));
  navigation.push(group(
    'monitoring-tasks',
    '监测任务',
    MONITORING_TASK_ITEMS
  ));
  navigation.push(QUICK_LINKS);

  const settingItems = [
    page('/notice', '系统通知', '/geo/notice'),
    page('/profile', '个人中心', '/geo/profile')
  ];
  navigation.push(group('settings', '设置', settingItems));
  return navigation;
}

function flattenGeoNavigation(navigation) {
  return navigation.flatMap((item) => (
    item.type === 'group' ? item.children : [item]
  ));
}

function resolveGeoDefaultRoute() {
  return '/geo/market-overview';
}

function resolveGeoLocation(pathname, options = {}) {
  const visiblePages = flattenGeoNavigation(buildGeoNavigation(options));
  const matches = visiblePages
    .filter((item) => (
      pathname === item.href || pathname.startsWith(`${item.href}/`)
    ))
    .sort((left, right) => right.href.length - left.href.length);
  const current = matches[0] || visiblePages.find(
    (item) => item.href === resolveGeoDefaultRoute(options)
  ) || visiblePages[0];
  return {
    selectedKey: current?.key || null,
    current: current || null
  };
}

module.exports = {
  buildGeoNavigation,
  flattenGeoNavigation,
  resolveGeoDefaultRoute,
  resolveGeoLocation
};
