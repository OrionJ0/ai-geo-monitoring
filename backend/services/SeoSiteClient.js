const axios = require('axios');
const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { privateTargetsEnabled } = require('../config/seoAuditNetworkPolicy');

const PAGE_TIMEOUT_MS = 10000;
const PAGE_LIMIT_BYTES = 2 * 1024 * 1024;
const PROBE_LIMIT_BYTES = 512 * 1024;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa'];

class SeoAuditRequestError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'SeoAuditRequestError';
    this.code = code;
    this.status = status;
  }
}

function isPublicIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;

  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (parts[2] === 0 || parts[2] === 2)) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && parts[2] === 100) return false;
  if (a === 203 && b === 0 && parts[2] === 113) return false;
  return true;
}

function expandIpv6(address) {
  let value = address.toLowerCase().split('%')[0];
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);

  const ipv4Match = value.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Match) {
    const parts = ipv4Match[1].split('.').map(Number);
    if (!isPublicIpv4(ipv4Match[1])) return { mappedPrivateIpv4: true };
    const high = ((parts[0] << 8) | parts[1]).toString(16);
    const low = ((parts[2] << 8) | parts[3]).toString(16);
    value = value.slice(0, -ipv4Match[1].length) + `${high}:${low}`;
  }

  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = halves.length === 2 ? [...left, ...Array(missing).fill('0'), ...right] : left;
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group}`), 0n);
}

function isPublicIpv6(address) {
  const expanded = expandIpv6(address);
  if (!expanded || expanded.mappedPrivateIpv4) return false;
  const value = expanded;
  if ((value >> 125n) !== 1n) return false; // Current global unicast allocation: 2000::/3.

  const firstGroup = Number(value >> 112n);
  const secondGroup = Number((value >> 96n) & 0xffffn);
  if (firstGroup === 0x2001 && secondGroup <= 0x01ff) return false; // IETF protocol assignments.
  if (firstGroup === 0x2002 || firstGroup === 0x3ffe) return false; // 6to4 and retired 6bone.
  if (firstGroup === 0x3fff && secondGroup <= 0x0fff) return false; // Documentation prefix.
  if ((value >> 96n) === 0x20010db8n) return false; // documentation prefix
  return true;
}

function isPublicAddress(address) {
  const family = net.isIP(String(address).replace(/^\[|\]$/g, ''));
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

function normalizedHostname(hostname) {
  return String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
}

function isPrivateAuditAddress(address) {
  const hostname = normalizedHostname(address);
  const family = net.isIP(hostname);
  if (family === 6) return expandIpv6(hostname) === 1n;
  if (family !== 4) return false;
  const [a, b] = hostname.split('.').map(Number);
  return a === 127
    || a === 10
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

function isLoopbackAddress(address) {
  const hostname = normalizedHostname(address);
  const family = net.isIP(hostname);
  if (family === 6) return expandIpv6(hostname) === 1n;
  return family === 4 && Number(hostname.split('.')[0]) === 127;
}

function normalizedPrivateOrigin(input) {
  if (!input) return '';
  const parsed = input instanceof URL ? new URL(input.toString()) : new URL(String(input));
  const hostname = normalizedHostname(parsed.hostname);
  if (
    !['http:', 'https:'].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || (hostname !== 'localhost' && !isPrivateAuditAddress(hostname))
  ) {
    throw new SeoAuditRequestError('私网检测目标必须是 localhost、回环地址或局域网 IP', 'PRIVATE_TARGET_NOT_ALLOWED');
  }
  return parsed.origin;
}

function createSeoAuditTargetPolicy(input, {
  allowPrivateTargets = privateTargetsEnabled()
} = {}) {
  let parsed;
  try {
    parsed = input instanceof URL ? new URL(input.toString()) : new URL(String(input));
  } catch {
    throw new SeoAuditRequestError('网址格式不正确', 'INVALID_URL');
  }

  const hostname = normalizedHostname(parsed.hostname);
  const privateTarget = hostname === 'localhost' || isPrivateAuditAddress(hostname);
  if (privateTarget) {
    const allowedPrivateOrigin = normalizedPrivateOrigin(parsed);
    if (!allowPrivateTargets) {
      throw new SeoAuditRequestError(
        '当前部署未开启本机或局域网检测',
        'PRIVATE_TARGETS_DISABLED',
        403
      );
    }
    return Object.freeze({ networkScope: 'private', allowedPrivateOrigin });
  }

  assertAllowedUrl(parsed);
  return Object.freeze({ networkScope: 'public', allowedPrivateOrigin: '' });
}

function assertAllowedUrl(input, { allowedPrivateOrigin = '' } = {}) {
  let parsed;
  try {
    parsed = input instanceof URL ? new URL(input.toString()) : new URL(String(input));
  } catch {
    throw new SeoAuditRequestError('网址格式不正确', 'INVALID_URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new SeoAuditRequestError('仅支持 HTTP 或 HTTPS 网站', 'UNSUPPORTED_PROTOCOL');
  }
  if (parsed.username || parsed.password) {
    throw new SeoAuditRequestError('网址不能包含用户名或密码', 'URL_CREDENTIALS_NOT_ALLOWED');
  }

  const hostname = normalizedHostname(parsed.hostname);
  const privateOrigin = normalizedPrivateOrigin(allowedPrivateOrigin);
  if (privateOrigin && parsed.origin !== privateOrigin) {
    throw new SeoAuditRequestError(
      '私网检测不能跳转或访问其他站点',
      'PRIVATE_TARGET_ORIGIN_CHANGED'
    );
  }
  if (privateOrigin) {
    if (hostname !== 'localhost' && !isPrivateAuditAddress(hostname)) {
      throw new SeoAuditRequestError('私网检测目标超出本次授权范围', 'PRIVATE_NETWORK_URL');
    }
    return parsed;
  }
  if (!hostname || hostname === 'localhost' || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new SeoAuditRequestError('不能检测本机或内网地址', 'PRIVATE_NETWORK_URL');
  }
  if (net.isIP(hostname) && !isPublicAddress(hostname)) {
    throw new SeoAuditRequestError('不能检测本机或内网地址', 'PRIVATE_NETWORK_URL');
  }
  return parsed;
}

async function defaultResolveHostname(hostname) {
  return dns.promises.lookup(hostname, { all: true, verbatim: true });
}

function normalizeAddresses(records) {
  const values = Array.isArray(records) ? records : [records];
  return values
    .map((record) => typeof record === 'string' ? { address: record, family: net.isIP(record) } : record)
    .filter((record) => record?.address && (record.family === 4 || record.family === 6));
}

function createPinnedLookup(records) {
  return (_hostname, options, callback) => {
    const selected = records.find((record) => !options?.family || record.family === options.family) || records[0];
    if (options?.all) return callback(null, records);
    return callback(null, selected.address, selected.family);
  };
}

function responseHeaders(headers) {
  if (!headers) return {};
  if (typeof headers.toJSON === 'function') return headers.toJSON();
  return { ...headers };
}

function createSeoSiteClient({
  resolveHostname = defaultResolveHostname,
  request = axios.request,
  allowedPrivateOrigin = ''
} = {}) {
  const privateOrigin = normalizedPrivateOrigin(allowedPrivateOrigin);

  async function resolvePublicTarget(parsed) {
    const hostname = normalizedHostname(parsed.hostname);
    if (net.isIP(hostname)) return [{ address: hostname, family: net.isIP(hostname) }];

    let records;
    try {
      records = normalizeAddresses(await resolveHostname(hostname));
    } catch {
      throw new SeoAuditRequestError('无法解析该网站域名', 'DNS_LOOKUP_FAILED', 422);
    }
    if (!records.length) throw new SeoAuditRequestError('无法解析该网站域名', 'DNS_LOOKUP_FAILED', 422);
    if (privateOrigin) {
      if (hostname !== 'localhost' || records.some((record) => !isLoopbackAddress(record.address))) {
        throw new SeoAuditRequestError('localhost 没有解析到回环地址', 'PRIVATE_NETWORK_URL');
      }
      return records;
    }
    if (records.some((record) => !isPublicAddress(record.address))) {
      throw new SeoAuditRequestError('不能检测解析到内网的地址', 'PRIVATE_NETWORK_URL');
    }
    return records;
  }

  async function requestWithRedirects(inputUrl, { maxBytes, accept }) {
    const startedAt = Date.now();
    let currentUrl = assertAllowedUrl(inputUrl, { allowedPrivateOrigin: privateOrigin });
    const redirectChain = [];
    const visitedUrls = new Set([currentUrl.toString()]);

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const addresses = await resolvePublicTarget(currentUrl);
      const lookup = createPinnedLookup(addresses);
      let response;
      try {
        response = await request({
          method: 'GET',
          url: currentUrl.toString(),
          timeout: PAGE_TIMEOUT_MS,
          maxRedirects: 0,
          maxContentLength: maxBytes,
          maxBodyLength: maxBytes,
          responseType: 'text',
          transformResponse: [(data) => data],
          decompress: true,
          validateStatus: () => true,
          proxy: false,
          httpAgent: new http.Agent({ keepAlive: false, lookup }),
          httpsAgent: new https.Agent({ keepAlive: false, lookup }),
          headers: {
            Accept: accept,
            'Accept-Encoding': 'gzip, deflate, br',
            'User-Agent': 'GoodieAI-SEO-Audit/1.0 (+https://gato.com.cn/)'
          }
        });
      } catch (error) {
        if (error instanceof SeoAuditRequestError) throw error;
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
          throw new SeoAuditRequestError('网站响应超时，请稍后重试', 'UPSTREAM_TIMEOUT', 504);
        }
        if (/maxContentLength|maxBodyLength|larger than/i.test(error.message || '')) {
          throw new SeoAuditRequestError('页面内容超过 2 MB，暂不支持检测', 'PAGE_TOO_LARGE', 422);
        }
        if (privateOrigin && error.code === 'ECONNREFUSED') {
          throw new SeoAuditRequestError(
            '目标服务拒绝连接，请检查服务是否监听局域网地址以及端口是否正确',
            'TARGET_CONNECTION_REFUSED',
            502
          );
        }
        if (privateOrigin && (error.code === 'EHOSTUNREACH' || error.code === 'ENETUNREACH')) {
          throw new SeoAuditRequestError(
            '后端服务器无法到达目标网络，请检查局域网路由和防火墙',
            'TARGET_NETWORK_UNREACHABLE',
            502
          );
        }
        throw new SeoAuditRequestError('无法连接该网站，请检查网址后重试', 'UPSTREAM_UNAVAILABLE', 502);
      }

      const headers = responseHeaders(response.headers);
      if (REDIRECT_STATUSES.has(response.status) && headers.location) {
        const nextUrl = assertAllowedUrl(new URL(headers.location, currentUrl), {
          allowedPrivateOrigin: privateOrigin
        });
        redirectChain.push({
          from: currentUrl.toString(),
          statusCode: response.status,
          to: nextUrl.toString()
        });
        if (visitedUrls.has(nextUrl.toString())) {
          const error = new SeoAuditRequestError('网站存在重定向循环', 'REDIRECT_LOOP', 422);
          error.redirectChain = redirectChain;
          throw error;
        }
        if (redirectCount === MAX_REDIRECTS) {
          const error = new SeoAuditRequestError('网站重定向次数过多', 'TOO_MANY_REDIRECTS', 422);
          error.redirectChain = redirectChain;
          throw error;
        }
        visitedUrls.add(nextUrl.toString());
        currentUrl = nextUrl;
        continue;
      }

      return {
        finalUrl: currentUrl.toString(),
        redirectChain,
        statusCode: response.status,
        durationMs: Date.now() - startedAt,
        headers,
        body: typeof response.data === 'string' ? response.data : String(response.data || '')
      };
    }
    throw new SeoAuditRequestError('网站重定向次数过多', 'TOO_MANY_REDIRECTS', 422);
  }

  return {
    async assertPublicUrl(url) {
      const parsed = assertAllowedUrl(url, { allowedPrivateOrigin: privateOrigin });
      await resolvePublicTarget(parsed);
      return parsed.toString();
    },

    async fetchPage(url) {
      const response = await requestWithRedirects(url, {
        maxBytes: PAGE_LIMIT_BYTES,
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5'
      });
      const contentType = String(response.headers['content-type'] || '').toLowerCase();
      if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        throw new SeoAuditRequestError('目标地址不是 HTML 页面', 'UNSUPPORTED_CONTENT_TYPE', 422);
      }
      return {
        requestedUrl: url,
        finalUrl: response.finalUrl,
        statusCode: response.statusCode,
        durationMs: response.durationMs,
        headers: response.headers,
        redirectChain: response.redirectChain,
        html: response.body
      };
    },

    async probe(url) {
      return requestWithRedirects(url, {
        maxBytes: PROBE_LIMIT_BYTES,
        accept: 'text/plain,application/xml,text/xml,*/*;q=0.5'
      });
    }
  };
}

const defaultClient = createSeoSiteClient();

module.exports = {
  ...defaultClient,
  createSeoSiteClient,
  SeoAuditRequestError,
  assertAllowedUrl,
  isPublicAddress,
  isPrivateAuditAddress,
  normalizedPrivateOrigin,
  privateTargetsEnabled,
  createSeoAuditTargetPolicy
};
