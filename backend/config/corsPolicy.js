const net = require('node:net');

function parseAllowedOrigins(value) {
  if (typeof value !== 'string') {
    return [];
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function normalizeRemoteAddress(value) {
  let address = String(value || '').trim().toLowerCase();
  const scopeIndex = address.indexOf('%');
  if (scopeIndex !== -1) {
    address = address.slice(0, scopeIndex);
  }
  if (address.startsWith('::ffff:')) {
    address = address.slice('::ffff:'.length);
  }
  return address;
}

function isLoopbackAddress(value) {
  const address = normalizeRemoteAddress(value);
  const family = net.isIP(address);

  if (family === 4) {
    return address.split('.')[0] === '127';
  }
  return family === 6 && address === '::1';
}

function createCorsOptionsDelegate({
  allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS)
} = {}) {
  const allowedOriginSet = new Set(allowedOrigins);

  return (req, callback) => {
    const origin = req.headers?.origin;
    const isTrustedSameMachineProxy = isLoopbackAddress(req.socket?.remoteAddress);

    if (!origin) {
      callback(null, { origin: false, credentials: true });
      return;
    }

    if (isTrustedSameMachineProxy || allowedOriginSet.has(origin)) {
      callback(null, { origin: true, credentials: true });
      return;
    }

    const error = new Error('不允许的跨域请求');
    error.status = 403;
    error.code = 'CORS_ORIGIN_DENIED';
    callback(error);
  };
}

module.exports = {
  createCorsOptionsDelegate,
  isLoopbackAddress,
  parseAllowedOrigins
};
