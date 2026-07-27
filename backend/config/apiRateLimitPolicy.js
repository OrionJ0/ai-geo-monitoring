const PUBLIC_PATH_PREFIXES = Object.freeze([
  '/health',
  '/ready',
  '/captcha',
  '/settings/seo',
  '/settings/notice'
]);

const WEB_RUNTIME_STATUS_PATH = '/ai-platforms/deepseek-web/runtime-status';
const WEB_RUNTIME_STATUS_RATE_LIMIT = 1000;

function shouldSkipGeneralLimiter(pathname) {
  const path = String(pathname || '');
  return path === WEB_RUNTIME_STATUS_PATH
    || PUBLIC_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

module.exports = {
  shouldSkipGeneralLimiter,
  WEB_RUNTIME_STATUS_PATH,
  WEB_RUNTIME_STATUS_RATE_LIMIT
};
