const REQUEST_KINDS = Object.freeze(['page', 'robots', 'sitemap', 'link_probe']);

function defaultWait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function circuitError(classification) {
  const rateLimited = classification.outcome === 'rate_limited';
  const error = new Error(rateLimited
    ? '目标站点已限制当前 GoodieAI 审计请求，请根据 Retry-After 稍后重试。'
    : '当前 GoodieAI 审计身份或出口被目标站点安全策略拦截，无法完成检测；不能据此判断搜索引擎是否也被阻止。');
  error.name = 'SeoAuditCrawlerPolicyError';
  error.code = rateLimited ? 'SEO_AUDIT_RATE_LIMITED' : 'SEO_AUDIT_BLOCKED_BY_WAF';
  error.status = 502;
  error.stopReason = rateLimited ? 'rate_limited' : 'waf_blocked';
  error.retryAt = classification.retryAt || null;
  error.classification = classification;
  return error;
}

function createSeoAuditCrawlerPolicy({
  minOriginIntervalMs = 250,
  now = Date.now,
  wait = defaultWait
} = {}) {
  if (!Number.isInteger(minOriginIntervalMs) || minOriginIntervalMs < 0) {
    throw new TypeError('同域请求间隔必须是非负整数');
  }

  const origins = new Map();
  const diagnostics = {
    networkRequests: {
      total: 0,
      byKind: Object.fromEntries(REQUEST_KINDS.map((kind) => [kind, 0])),
      redirectHops: 0
    },
    renderAttempts: 0,
    stopReason: null
  };

  const originState = (url) => {
    const origin = new URL(url).origin;
    if (!origins.has(origin)) {
      origins.set(origin, {
        nextStartAt: 0,
        circuit: null
      });
    }
    return origins.get(origin);
  };

  return {
    async beforeRequest({ url, requestKind = 'link_probe', redirectHop = false }) {
      const state = originState(url);
      if (state.circuit) throw circuitError(state.circuit);

      const currentTime = now();
      const reservedStartAt = Math.max(currentTime, state.nextStartAt);
      state.nextStartAt = reservedStartAt + minOriginIntervalMs;
      if (reservedStartAt > currentTime) {
        await wait(reservedStartAt - currentTime);
      }

      if (state.circuit) throw circuitError(state.circuit);
      const normalizedKind = REQUEST_KINDS.includes(requestKind) ? requestKind : 'link_probe';
      diagnostics.networkRequests.total += 1;
      diagnostics.networkRequests.byKind[normalizedKind] += 1;
      if (redirectHop) diagnostics.networkRequests.redirectHops += 1;
    },

    observeResponse({ url, classification }) {
      if (!['waf_blocked', 'rate_limited'].includes(classification?.outcome)) return;
      const state = originState(url);
      const retryAt = classification.retryAt
        || (Number.isFinite(classification.retryAfterMs)
          ? new Date(now() + classification.retryAfterMs).toISOString()
          : null);
      state.circuit = {
        ...classification,
        retryAt
      };
      diagnostics.stopReason = classification.outcome;
    },

    recordRenderAttempts(count = 1) {
      if (Number.isInteger(count) && count > 0) diagnostics.renderAttempts += count;
    },

    setStopReason(stopReason) {
      diagnostics.stopReason = stopReason || null;
    },

    snapshot() {
      return {
        networkRequests: {
          total: diagnostics.networkRequests.total,
          byKind: { ...diagnostics.networkRequests.byKind },
          redirectHops: diagnostics.networkRequests.redirectHops
        },
        renderAttempts: diagnostics.renderAttempts,
        stopReason: diagnostics.stopReason
      };
    }
  };
}

module.exports = {
  createSeoAuditCrawlerPolicy
};
