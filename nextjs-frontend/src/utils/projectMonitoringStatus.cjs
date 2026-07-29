function describeMonitoringExecution(execution) {
  if (!execution || typeof execution !== 'object') return null;
  if (execution.status === 'completed') {
    return {
      label: '最近一次成功',
      color: 'success',
      detail: '',
      settingsUrl: null
    };
  }
  if (execution.status === 'failed') {
    return {
      label: '最近一次失败',
      color: 'error',
      detail: String(execution.error_message || '项目自动监测执行失败'),
      settingsUrl: execution.error_code === 'web_platform_preflight_failed'
        ? '/admin/settings'
        : null
    };
  }
  if (execution.status === 'running') {
    return {
      label: '正在执行',
      color: 'processing',
      detail: '',
      settingsUrl: null
    };
  }
  return {
    label: '等待执行',
    color: 'default',
    detail: '',
    settingsUrl: null
  };
}

module.exports = {
  describeMonitoringExecution
};
