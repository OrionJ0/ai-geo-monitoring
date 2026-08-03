const REQUIRED_KEYS = Object.freeze([
  'GATO_WEBSITE_FORM_BASE_URL',
  'GATO_WEBSITE_FORM_PROJECT_ID',
  'GATO_WEBSITE_FORM_USERNAME',
  'GATO_WEBSITE_FORM_PASSWORD',
  'GATO_WEBSITE_FORM_HTTP_TIMEOUT_MS',
  'GATO_WEBSITE_FORM_CACHE_TTL_MS'
]);

function enabledState(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === 'false') return 'DISABLED';
  if (normalized === 'true') return 'ENABLED';
  return 'INVALID';
}

function validRootUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.origin === 'https://gato.com.cn'
      && parsed.protocol === 'https:'
      && parsed.pathname === '/'
      && !parsed.search
      && !parsed.hash
      && !parsed.username
      && !parsed.password;
  } catch {
    return false;
  }
}

function safeIntegerInRange(value, minimum, maximum) {
  if (!/^\d+$/u.test(String(value || ''))) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed)
    && parsed >= minimum
    && parsed <= maximum;
}

function auditWebsiteFormConsultationConfig(env = {}) {
  const toggle = enabledState(env.GATO_WEBSITE_FORM_ENABLED);
  if (toggle === 'DISABLED') {
    return { moduleState: 'DISABLED', errorCode: null, missingKeys: [] };
  }
  if (toggle === 'INVALID') {
    return {
      moduleState: 'MISCONFIGURED',
      errorCode: 'WEBSITE_FORM_CONFIG_INVALID',
      missingKeys: []
    };
  }

  const missingKeys = REQUIRED_KEYS.filter((key) => !String(env[key] || ''));
  if (missingKeys.length > 0) {
    return {
      moduleState: 'MISCONFIGURED',
      errorCode: 'WEBSITE_FORM_CONFIG_INCOMPLETE',
      missingKeys
    };
  }

  const valid = validRootUrl(env.GATO_WEBSITE_FORM_BASE_URL)
    && safeIntegerInRange(
      env.GATO_WEBSITE_FORM_PROJECT_ID,
      1,
      Number.MAX_SAFE_INTEGER
    )
    && String(env.GATO_WEBSITE_FORM_USERNAME).trim().length > 0
    && String(env.GATO_WEBSITE_FORM_PASSWORD).length > 0
    && safeIntegerInRange(env.GATO_WEBSITE_FORM_HTTP_TIMEOUT_MS, 100, 60000)
    && safeIntegerInRange(
      env.GATO_WEBSITE_FORM_CACHE_TTL_MS,
      60000,
      3600000
    )
    && (
      !env.GATO_WEBSITE_FORM_MAX_STALE_MS
      || (
        safeIntegerInRange(
          env.GATO_WEBSITE_FORM_MAX_STALE_MS,
          60000,
          604800000
        )
        && Number(env.GATO_WEBSITE_FORM_MAX_STALE_MS)
          >= Number(env.GATO_WEBSITE_FORM_CACHE_TTL_MS)
      )
    );

  return valid
    ? { moduleState: 'READY', errorCode: null, missingKeys: [] }
    : {
        moduleState: 'MISCONFIGURED',
        errorCode: 'WEBSITE_FORM_CONFIG_INVALID',
        missingKeys: []
      };
}

function loadWebsiteFormConsultationConfig(env = {}) {
  const audit = auditWebsiteFormConsultationConfig(env);
  if (audit.moduleState !== 'READY') return { audit };
  return {
    audit,
    baseUrl: env.GATO_WEBSITE_FORM_BASE_URL,
    projectId: String(env.GATO_WEBSITE_FORM_PROJECT_ID),
    username: String(env.GATO_WEBSITE_FORM_USERNAME).trim(),
    password: String(env.GATO_WEBSITE_FORM_PASSWORD),
    httpTimeoutMs: Number(env.GATO_WEBSITE_FORM_HTTP_TIMEOUT_MS),
    cacheTtlMs: Number(env.GATO_WEBSITE_FORM_CACHE_TTL_MS),
    maxStaleMs: Number(env.GATO_WEBSITE_FORM_MAX_STALE_MS || '86400000')
  };
}

module.exports = {
  auditWebsiteFormConsultationConfig,
  loadWebsiteFormConsultationConfig
};
