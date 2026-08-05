const {
  BaiduContractBlockedError,
  BaiduMarketingError
} = require('./BaiduErrors');

const ONE_MEBIBYTE = 1024 * 1024;
const RAW_RESPONSE_BYTES = Symbol('baiduRawResponseBytes');

function documentedAllowlist(manifest) {
  if (
    manifest?.status === 'VERIFIED'
    && Array.isArray(manifest.productionAllowlist)
    && manifest.productionAllowlist.length > 0
  ) {
    return manifest.productionAllowlist;
  }
  if (
    manifest?.status === 'PILOT_VERIFIED'
    && Array.isArray(manifest.pilotOutboundAllowlist)
    && manifest.pilotOutboundAllowlist.length > 0
  ) {
    return manifest.pilotOutboundAllowlist;
  }
  if (
    manifest?.status === 'DOCUMENTED_PENDING_PILOT'
    && Array.isArray(manifest.documentedOutboundAllowlist)
    && manifest.documentedOutboundAllowlist.length > 0
  ) {
    return manifest.documentedOutboundAllowlist;
  }
  throw new BaiduContractBlockedError();
}

async function readBoundedBody(response, maxResponseBytes) {
  if (!response.body) return { source: '', totalBytes: 0 };
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxResponseBytes) {
      try {
        await reader.cancel();
      } catch {
        // The bounded-response error below remains the stable public outcome.
      }
      throw new BaiduMarketingError(
        '百度接口响应超过大小预算',
        'BAIDU_RESPONSE_TOO_LARGE',
        502
      );
    }
    chunks.push(Buffer.from(value));
  }
  return {
    source: Buffer.concat(chunks, totalBytes).toString('utf8'),
    totalBytes
  };
}

async function cancelResponseBody(response) {
  try {
    await response?.body?.cancel?.();
  } catch {
    // The original bounded transport failure remains the stable outcome.
  }
}

async function defaultTransport({
  method,
  url,
  headers,
  json,
  timeoutMs,
  maxResponseBytes
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(json),
      signal: controller.signal,
      redirect: 'error'
    });
    if (!response.ok) {
      await cancelResponseBody(response);
      throw new BaiduMarketingError(
        '百度接口返回 HTTP 错误',
        'BAIDU_HTTP_ERROR',
        502,
        response.status === 429 || response.status >= 500
      );
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > maxResponseBytes) {
      await cancelResponseBody(response);
      throw new BaiduMarketingError(
        '百度接口响应超过大小预算',
        'BAIDU_RESPONSE_TOO_LARGE',
        502
      );
    }
    const { source, totalBytes } = await readBoundedBody(
      response,
      maxResponseBytes
    );
    try {
      const parsed = JSON.parse(source);
      if (parsed && typeof parsed === 'object') {
        Object.defineProperty(parsed, RAW_RESPONSE_BYTES, {
          value: totalBytes,
          enumerable: false
        });
      }
      return parsed;
    } catch {
      throw new BaiduMarketingError(
        '百度接口返回非 JSON 响应',
        'BAIDU_RESPONSE_INVALID',
        502
      );
    }
  } catch (error) {
    if (error instanceof BaiduMarketingError) throw error;
    if (error?.name === 'AbortError') {
      throw new BaiduMarketingError(
        '百度接口请求超时',
        'BAIDU_REQUEST_TIMEOUT',
        504
      );
    }
    throw new BaiduMarketingError(
      '百度接口网络请求失败',
      'BAIDU_UPSTREAM_UNAVAILABLE',
      502,
      true
    );
  } finally {
    clearTimeout(timeout);
  }
}

class BaiduHttpKernel {
  constructor({ manifest, timeoutMs = 10000, transport = defaultTransport }) {
    this.allowlist = new Set(documentedAllowlist(manifest));
    this.timeoutMs = Number(timeoutMs);
    this.transport = transport;
    if (
      !Number.isInteger(this.timeoutMs)
      || this.timeoutMs < 100
      || this.timeoutMs > 60000
      || typeof this.transport !== 'function'
    ) {
      throw new BaiduMarketingError(
        '百度营销客户端配置无效',
        'BAIDU_CLIENT_CONFIG_INVALID',
        500
      );
    }
  }

  assertAllowed(method, url) {
    const parsed = new URL(url);
    const key = `${method} ${parsed.origin}${parsed.pathname}`;
    if (
      parsed.protocol !== 'https:'
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
      || !this.allowlist.has(key)
    ) {
      throw new BaiduMarketingError(
        '百度出站请求不在契约白名单内',
        'BAIDU_OUTBOUND_NOT_ALLOWED',
        500
      );
    }
  }

  async requestJson({
    method,
    url,
    json,
    maxResponseBytes = ONE_MEBIBYTE,
    timeoutMs = this.timeoutMs
  }) {
    this.assertAllowed(method, url);
    return this.transport({
      method,
      url,
      headers: {
        'Content-Type': 'application/json;charset:utf-8'
      },
      json,
      timeoutMs,
      maxResponseBytes
    });
  }
}

module.exports = {
  BaiduHttpKernel,
  RAW_RESPONSE_BYTES
};
