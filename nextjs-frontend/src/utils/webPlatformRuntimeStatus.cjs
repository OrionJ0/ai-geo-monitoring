function nonNegativeInteger(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0;
}

const MANAGED_WEB_PLATFORM_CODES = ['deepseek-web', 'doubao-web'];

function selectManagedWebPlatformCodes(platformCodes) {
  const selected = new Set(
    (Array.isArray(platformCodes) ? platformCodes : [])
      .map((code) => String(code || '').trim().toLowerCase())
      .filter(Boolean)
  );
  return MANAGED_WEB_PLATFORM_CODES.filter((code) => selected.has(code));
}

function getWebPlatformRuntimePresentation(status, options = {}) {
  const platformName = options.platformName || 'Web 平台';
  if (options.unavailable || !status) {
    return {
      type: 'info',
      title: `${platformName} 状态暂时无法读取`,
      description: '不影响现有运行入口；提交时仍会执行通道检查。'
    };
  }

  if (status.enabled === false && status.reason_code === 'disabled') {
    return null;
  }

  if (status.state === 'login_required') {
    return {
      type: 'warning',
      title: `${platformName} 登录已失效`,
      description: '请联系虚拟机运维负责人处理；恢复后可从原运行报告重试。'
    };
  }

  if (status.state === 'verification_required') {
    return {
      type: 'warning',
      title: `${platformName} 需要人工验证`,
      description: `请联系虚拟机运维负责人处理；不要在当前页面输入 ${platformName} 凭据。`
    };
  }

  if (status.state === 'unavailable') {
    const reasonDescriptions = {
      web_browser_not_configured: '虚拟机未找到可用的 Chrome，请联系虚拟机运维负责人处理。',
      web_browser_launch_failed: '专用 Chrome 无法启动，请联系虚拟机运维负责人处理。',
      web_profile_in_use: '专用浏览器会话正在被占用，请联系虚拟机运维负责人处理。',
      web_runtime_config_invalid: 'Web 运行目录配置不可用，请联系虚拟机运维负责人处理。',
      web_selector_mismatch: `${platformName} 页面结构已变化，请联系虚拟机运维负责人处理。`,
      web_browser_connection_failed: '专用 Chrome 连接失败，请联系虚拟机运维负责人处理。',
      web_browser_closed: '专用 Chrome 连接已关闭，请联系虚拟机运维负责人处理。',
      config_unavailable: 'Web 平台配置暂不可用，请联系虚拟机运维负责人处理。'
    };
    return {
      type: 'error',
      title: `${platformName} 当前不可用`,
      description: reasonDescriptions[status.reason_code]
        || 'Web 运行通道暂不可用，请联系虚拟机运维负责人处理。'
    };
  }

  if (status.state === 'shutting_down') {
    return {
      type: 'info',
      title: `${platformName} 服务正在关闭`,
      description: '暂不接受新的 Web 页面工作。'
    };
  }

  if (status.state === 'busy') {
    const runningCount = Math.min(nonNegativeInteger(status.running_count), 1);
    const queuedCount = nonNegativeInteger(status.queued_count);
    if (runningCount > 0) {
      return {
        type: 'info',
        title: `${platformName} 正在处理`,
        description: `正在运行 1 条，等待 ${queuedCount} 条。其他 Web 问题将按顺序执行。`
      };
    }
    return {
      type: 'info',
      title: `${platformName} 已有任务等待处理`,
      description: `已有 ${queuedCount} 条等待处理。Web 问题将按顺序执行。`
    };
  }

  return {
    type: 'info',
    title: `${platformName} 当前空闲`,
    description: '当前没有等待中的 Web 问题。'
  };
}

module.exports = {
  getWebPlatformRuntimePresentation,
  selectManagedWebPlatformCodes
};
