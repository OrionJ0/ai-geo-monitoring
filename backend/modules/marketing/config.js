const REQUIRED_ENABLED_KEYS = Object.freeze([
  'MARKETING_MONITORING_ALLOWED_PROJECT_IDS',
  'MARKETING_MONITORING_PILOT_MODE',
  'CONFIG_ENCRYPTION_KEY',
  'BAIDU_MARKETING_APP_ID',
  'BAIDU_MARKETING_SECRET_KEY',
  'BAIDU_MARKETING_SCOPE',
  'BAIDU_MARKETING_REDIRECT_URI',
  'BAIDU_MARKETING_CONTRACT_VERSION',
  'BAIDU_MARKETING_HTTP_TIMEOUT_MS'
]);
const {
  loadBaiduContract
} = require('./contracts/baidu/loadBaiduContract');
const {
  isEncryptionConfigured
} = require('../../services/SecretEncryptionService');

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

function hasValidSecretKey(env) {
  const value = text(env.BAIDU_MARKETING_SECRET_KEY);
  return (
    value.length >= 16
    && Buffer.byteLength(value.slice(0, 16), 'utf8') === 16
  );
}

function hasValidMoneyContract(manifest) {
  return (
    /^[A-Z]{3}$/u.test(String(manifest.money?.currencyCode || ''))
    && Number.isInteger(manifest.money?.costScale)
    && manifest.money.costScale >= 0
    && manifest.money.costScale <= 18
  );
}

function hasApprovedScope(manifest, scope) {
  return (
    Array.isArray(manifest.oauth?.authorization?.approvedScopeValues)
    && manifest.oauth.authorization.approvedScopeValues.includes(scope)
  );
}

function auditMarketingConfig(env = {}, {
  contractLoader = loadBaiduContract
} = {}) {
  const enabledValue = text(env.MARKETING_MONITORING_ENABLED).toLowerCase();
  if (enabledValue && enabledValue !== 'true' && enabledValue !== 'false') {
    return result('MISCONFIGURED', 'MARKETING_ENABLED_VALUE_INVALID');
  }

  const enabled = enabledValue === 'true';
  const pilotValue = text(env.MARKETING_MONITORING_PILOT_MODE).toLowerCase();
  if (pilotValue && pilotValue !== 'true' && pilotValue !== 'false') {
    return result('MISCONFIGURED', 'MARKETING_PILOT_VALUE_INVALID');
  }
  const pilot = pilotValue === 'true';
  if (pilot && !enabled) {
    return result('MISCONFIGURED', 'MARKETING_PILOT_REQUIRES_ENABLED');
  }
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

  if (enabled && !isEncryptionConfigured(env.CONFIG_ENCRYPTION_KEY)) {
    return result(
      'MISCONFIGURED',
      'MARKETING_ENCRYPTION_KEY_INVALID'
    );
  }

  if (enabled && !hasValidSecretKey(env)) {
    return result('MISCONFIGURED', 'MARKETING_SECRET_KEY_INVALID');
  }

  if (enabled && !hasValidRedirectUri(env)) {
    return result('MISCONFIGURED', 'MARKETING_REDIRECT_URI_INVALID');
  }

  const timeout = text(env.BAIDU_MARKETING_HTTP_TIMEOUT_MS);
  if (
    enabled
    && timeout
    && (!/^\d+$/u.test(timeout) || Number(timeout) < 100 || Number(timeout) > 60000)
  ) {
    return result('MISCONFIGURED', 'MARKETING_HTTP_TIMEOUT_INVALID');
  }

  if (enabled) {
    const manifest = contractLoader(
      text(env.BAIDU_MARKETING_CONTRACT_VERSION)
    );
    if (!manifest) {
      return result(
        'MISCONFIGURED',
        'MARKETING_CONTRACT_UNKNOWN'
      );
    }
    if (pilot) {
      if (manifest.status === 'PILOT_VERIFIED') {
        if (
          !Array.isArray(manifest.pilotOutboundAllowlist)
          || manifest.pilotOutboundAllowlist.length === 0
          || manifest.runtime?.adapterImplemented !== true
          || manifest.runtime?.reportResponseParserImplemented !== true
          || !hasApprovedScope(
            manifest,
            text(env.BAIDU_MARKETING_SCOPE)
          )
          || !hasValidMoneyContract(manifest)
        ) {
          return result(
            'MISCONFIGURED',
            'MARKETING_PILOT_CONTRACT_INVALID'
          );
        }
        return result('PILOT_DATA_READY');
      }
      if (
        manifest.status !== 'DOCUMENTED_PENDING_PILOT'
        || !Array.isArray(manifest.documentedOutboundAllowlist)
        || manifest.documentedOutboundAllowlist.length === 0
        || manifest.runtime?.adapterImplemented !== true
      ) {
        return result(
          'MISCONFIGURED',
          'MARKETING_PILOT_CONTRACT_INVALID'
        );
      }
      return result('PILOT_READY');
    }
    if (
      manifest.status !== 'VERIFIED'
      || !Array.isArray(manifest.productionAllowlist)
      || manifest.productionAllowlist.length === 0
      || (manifest.blockers?.length || 0) > 0
      || manifest.runtime?.adapterImplemented !== true
      || manifest.runtime?.reportResponseParserImplemented !== true
    ) {
      return result(
        'MISCONFIGURED',
        'MARKETING_CONTRACT_NOT_VERIFIED'
      );
    }
    if (!hasApprovedScope(
      manifest,
      text(env.BAIDU_MARKETING_SCOPE)
    )) {
      return result(
        'MISCONFIGURED',
        'MARKETING_SCOPE_NOT_APPROVED'
      );
    }
    if (!hasValidMoneyContract(manifest)) {
      return result(
        'MISCONFIGURED',
        'MARKETING_CONTRACT_INVALID'
      );
    }
  }

  return result(enabled ? 'READY' : 'DISABLED');
}

module.exports = {
  REQUIRED_ENABLED_KEYS,
  auditMarketingConfig
};
