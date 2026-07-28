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

function describeSelectedPlatforms(codes, catalog, options = {}) {
  const catalogReady = options.catalogReady !== false;
  const catalogByCode = new Map(
    (Array.isArray(catalog) ? catalog : []).map((item) => [String(item?.code || ''), item])
  );
  return Array.from(new Set(Array.isArray(codes) ? codes : []))
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .map((code) => {
      const item = catalogByCode.get(code);
      const name = String(item?.name || code);
      const selectable = item ? Boolean(item.selectable) : !catalogReady;
      const unavailableLabel = selectable
        ? null
        : (item ? getUnavailablePlatformLabel(item.unavailable_reason) : '平台已不存在');
      return {
        code,
        name,
        selectable,
        unavailableLabel,
        displayLabel: unavailableLabel ? `${name}（${unavailableLabel}）` : name
      };
    });
}

function formatUnavailablePlatformSummary(statuses) {
  return (Array.isArray(statuses) ? statuses : [])
    .filter((item) => item && !item.selectable)
    .map((item) => item.displayLabel)
    .join('、');
}

module.exports = {
  describeSelectedPlatforms,
  formatUnavailablePlatformSummary,
  getUnavailablePlatformLabel
};
