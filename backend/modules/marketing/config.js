const REQUIRED_ENABLED_KEYS = Object.freeze([
  'MARKETING_MONITORING_ALLOWED_PROJECT_IDS',
  'BAIDU_MARKETING_CLIENT_ID',
  'BAIDU_MARKETING_CLIENT_SECRET',
  'BAIDU_MARKETING_REDIRECT_URI',
  'BAIDU_MARKETING_CONTRACT_VERSION',
  'BAIDU_MARKETING_HTTP_TIMEOUT_MS'
]);

function text(value) {
  return String(value ?? '').trim();
}

function result(moduleState, errorCode = null, missingKeys = []) {
  return {
    moduleState,
    errorCode,
    missingKeys: [...missingKeys]
  };
}

function isLoopbackHostname(hostname) {
  return ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(
    String(hostname || '').toLowerCase()
  );
}

function hasValidRedirectUri(env) {
  const raw = text(env.BAIDU_MARKETING_REDIRECT_URI);
  if (!raw) return true;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (url.search || url.hash || url.username || url.password) return false;
  if (url.protocol === 'https:') return true;

  return (
    url.protocol === 'http:'
    && text(env.NODE_ENV) === 'test'
    && isLoopbackHostname(url.hostname)
  );
}

function auditMarketingConfig(env = {}) {
  const enabledValue = text(env.MARKETING_MONITORING_ENABLED).toLowerCase();
  if (enabledValue && enabledValue !== 'true' && enabledValue !== 'false') {
    return result('MISCONFIGURED', 'MARKETING_ENABLED_VALUE_INVALID');
  }

  const enabled = enabledValue === 'true';
  const missingKeys = enabled
    ? REQUIRED_ENABLED_KEYS.filter((key) => !text(env[key]))
    : [];
  if (missingKeys.length > 0) {
    return result(
      'MISCONFIGURED',
      'MARKETING_CONFIG_INCOMPLETE',
      missingKeys
    );
  }

  if (!hasValidRedirectUri(env)) {
    return result('MISCONFIGURED', 'MARKETING_REDIRECT_URI_INVALID');
  }

  const timeout = text(env.BAIDU_MARKETING_HTTP_TIMEOUT_MS);
  if (
    timeout
    && (!/^\d+$/u.test(timeout) || Number(timeout) < 100 || Number(timeout) > 60000)
  ) {
    return result('MISCONFIGURED', 'MARKETING_HTTP_TIMEOUT_INVALID');
  }

  return result(enabled ? 'READY' : 'DISABLED');
}

module.exports = {
  REQUIRED_ENABLED_KEYS,
  auditMarketingConfig
};
