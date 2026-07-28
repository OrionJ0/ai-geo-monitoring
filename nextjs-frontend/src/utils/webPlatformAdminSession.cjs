const MANAGED_WEB_ADAPTER_TYPES = new Set(['deepseek_web', 'doubao_web']);

function isManagedWebAdapter(adapterType) {
  return MANAGED_WEB_ADAPTER_TYPES.has(String(adapterType || ''));
}

function getWebPlatformAdminSessionPresentation(status) {
  if (!status?.browser_configured) {
    return {
      color: 'error',
      label: '浏览器未配置',
      detail: '后端未找到可用的专用 Chrome。'
    };
  }

  const states = {
    ready: {
      color: 'success',
      label: '网页登录已验证',
      detail: '本次服务进程已确认登录状态可用。'
    },
    login_required: {
      color: 'warning',
      label: '需要登录',
      detail: '请打开专用 Chrome 完成登录或账号切换，再验证登录状态。'
    },
    verification_required: {
      color: 'warning',
      label: '需要人工验证',
      detail: '请在专用 Chrome 中完成人工验证，再验证登录状态。'
    },
    selector_mismatch: {
      color: 'error',
      label: '页面结构异常',
      detail: '当前页面无法识别为可用的官方对话页面。'
    },
    unavailable: {
      color: 'error',
      label: '运行环境不可用',
      detail: '专用浏览器暂时无法启动或连接。'
    }
  };

  if (states[status.login_state]) return states[status.login_state];
  if (status.profile_initialized) {
    return {
      color: 'default',
      label: '会话待验证',
      detail: '已存在专用浏览器资料，但本次服务进程尚未确认登录有效。'
    };
  }
  return {
    color: 'default',
    label: '尚未登录',
    detail: '尚未初始化专用浏览器会话。'
  };
}

function getWebPlatformAdminSessionMeta(status) {
  const verifiedAt = status?.last_verified_at
    ? new Date(status.last_verified_at)
    : null;
  const hasValidVerifiedAt = verifiedAt && Number.isFinite(verifiedAt.getTime());
  return {
    lastVerifiedDetail: hasValidVerifiedAt
      ? `最近验证：${verifiedAt.toLocaleString('zh-CN')}`
      : '最近验证：尚未成功验证',
    accountDetail: '账号身份：系统不读取，请在专用 Chrome 中确认'
  };
}

module.exports = {
  getWebPlatformAdminSessionMeta,
  getWebPlatformAdminSessionPresentation,
  isManagedWebAdapter
};
