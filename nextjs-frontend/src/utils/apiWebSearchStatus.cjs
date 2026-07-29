const labels = {
  success: '联网已验证',
  inconclusive: '联网未确认',
  failed: '联网检测失败',
  untested: '联网未检测'
};

function getApiWebSearchStatusLabel(status) {
  return labels[status] || labels.untested;
}

module.exports = {
  getApiWebSearchStatusLabel
};
