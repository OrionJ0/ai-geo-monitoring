const unavailableLabels = {
  missing_api_key: '管理员尚未配置',
  missing_base_url: '接口地址未配置',
  missing_model: '默认模型未配置',
  disabled: '已停用',
  config_unavailable: '配置暂不可用'
};

function getUnavailablePlatformLabel(reason) {
  return unavailableLabels[String(reason || '')] || '当前不可用';
}

module.exports = {
  getUnavailablePlatformLabel
};
