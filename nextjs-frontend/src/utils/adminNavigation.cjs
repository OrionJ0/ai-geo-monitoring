function page(key, label, href) {
  return Object.freeze({ type: 'item', key, label, href });
}

function group(key, label, children) {
  return Object.freeze({ type: 'group', key, label, children });
}

function buildAdminNavigation() {
  return [
    page('workspace', '返回数据工作台', '/geo/market-overview'),
    page('dashboard', '后台总览', '/admin'),
    page('history', '历史记录', '/admin/history'),
    group('accounts', '账号与权限', [
      page('users', '用户管理', '/admin/users'),
      page('memberships', '会员设置', '/admin/memberships')
    ]),
    group('system', '系统管理', [
      page('settings', '设置中心', '/admin/settings'),
      page('notice', '通知管理', '/admin/notice'),
      page('health', '系统健康', '/admin/health')
    ])
  ];
}

function flattenAdminNavigation(navigation) {
  return navigation.flatMap((item) => (
    item.type === 'group' ? item.children : [item]
  ));
}

function resolveAdminLocation(pathname) {
  const navigation = buildAdminNavigation();
  const pages = flattenAdminNavigation(navigation)
    .filter((item) => item.href.startsWith('/admin'));
  const current = pages
    .filter((item) => (
      pathname === item.href || pathname.startsWith(`${item.href}/`)
    ))
    .sort((left, right) => right.href.length - left.href.length)[0]
    || pages.find((item) => item.key === 'dashboard');
  const activeGroup = navigation.find((item) => (
    item.type === 'group'
    && item.children.some((child) => child.key === current?.key)
  ));

  return {
    selectedKey: current?.key || 'dashboard',
    activeGroupKey: activeGroup?.key || null
  };
}

module.exports = {
  buildAdminNavigation,
  flattenAdminNavigation,
  resolveAdminLocation
};
