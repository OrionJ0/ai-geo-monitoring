const dns = require('node:dns').promises;
const net = require('node:net');

function ipv4ToNumber(address) {
  return address.split('.').reduce((value, part) => ((value << 8) + Number(part)) >>> 0, 0);
}

function inIpv4Range(address, base, prefix) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToNumber(address) & mask) === (ipv4ToNumber(base) & mask);
}

function isBlockedIpv4(address) {
  return [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4]
  ].some(([base, prefix]) => inIpv4Range(address, base, prefix));
}

function isBlockedIpv6(address) {
  const normalized = String(address).toLowerCase().replace(/^\[|\]$/g, '');
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedIpv4) return isBlockedIpv4(mappedIpv4[1]);
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith('ff')) return true;
  if (normalized.startsWith('2001:db8:') || normalized === '2001:db8::') return true;
  return false;
}

function isBlockedAddress(address) {
  const family = net.isIP(String(address || ''));
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

function parseAllowlist(rawAllowlist = process.env.AI_PLATFORM_PRIVATE_HOST_ALLOWLIST) {
  return new Set(
    String(rawAllowlist || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
}

function normalizeHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
}

async function validatePlatformUrl(rawUrl, options = {}) {
  let url;
  try {
    url = new URL(String(rawUrl || '').trim());
  } catch (_) {
    throw new Error('Base URL 格式无效');
  }

  if (url.protocol !== 'https:') throw new Error('Base URL 必须是公网 HTTPS 地址');
  if (url.username || url.password) throw new Error('Base URL 不能包含用户名或密码');
  if (!url.hostname) throw new Error('Base URL 缺少主机名');

  const hostname = normalizeHost(url.hostname);
  const port = url.port || '443';
  const hostPort = `${hostname}:${port}`;
  const allowlist = parseAllowlist(options.allowlist);
  const allowPrivate = allowlist.has(hostPort);
  const lookup = options.lookup || ((host) => dns.lookup(host, { all: true, verbatim: true }));

  let addresses;
  if (net.isIP(hostname)) {
    addresses = [{ address: hostname, family: net.isIP(hostname) }];
  } else {
    try {
      addresses = await lookup(hostname);
    } catch (_) {
      throw new Error('Base URL 主机名无法解析');
    }
  }

  const normalizedAddresses = Array.isArray(addresses) ? addresses : [addresses];
  if (!normalizedAddresses.length) throw new Error('Base URL 主机名无法解析');
  if (!allowPrivate && normalizedAddresses.some((item) => isBlockedAddress(item?.address || item))) {
    throw new Error('Base URL 不能指向本机或私网地址');
  }

  url.hash = '';
  return {
    url: url.toString(),
    hostname,
    port,
    hostPort,
    addresses: normalizedAddresses.map((item) => item?.address || item),
    allowPrivate
  };
}

module.exports = {
  validatePlatformUrl,
  isBlockedAddress,
  parseAllowlist
};
