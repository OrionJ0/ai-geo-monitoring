const DEFAULT_SERVER_HOST = '127.0.0.1';

function resolveServerHost(value = process.env.HOST) {
  return String(value || '').trim() || DEFAULT_SERVER_HOST;
}

module.exports = {
  DEFAULT_SERVER_HOST,
  resolveServerHost
};
