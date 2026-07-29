function getWebPreflightPrompt(responseBody) {
  const data = responseBody?.data;
  if (
    data?.error_code !== 'web_platform_preflight_failed'
    || data?.settings_url !== '/admin/settings'
  ) {
    return null;
  }
  const blockedMessages = (Array.isArray(data.blocked_platforms) ? data.blocked_platforms : [])
    .map((item) => String(item?.message || item?.name || item?.platform || '').trim())
    .filter(Boolean);
  return {
    title: '运行前需要处理网页登录',
    message: String(responseBody?.message || '所选网页平台尚未就绪，本次运行未创建任务。'),
    blockedMessages,
    settingsUrl: '/admin/settings'
  };
}

module.exports = {
  getWebPreflightPrompt
};
