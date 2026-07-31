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

function createSeoAuditOriginCoordinator({
  wafCooldownMs = 5 * 60 * 1000,
  defaultRateLimitCooldownMs = 60 * 1000
} = {}) {
  const origins = new Map();

  const originState = (url) => {
    const origin = new URL(url).origin;
    if (!origins.has(origin)) {
      origins.set(origin, {
        nextStartAt: 0,
        circuit: null,
        circuitUntil: 0,
        participants: new Set()
      });
    }
    return origins.get(origin);
  };

  return {
    async beforeRequest({ policyId, url, intervalMs, now, wait }) {
      const currentTime = now();
      origins.forEach((candidate, origin) => {
        if (candidate.circuit && candidate.circuitUntil <= currentTime) {
          candidate.circuit = null;
          candidate.circuitUntil = 0;
        }
        if (
          candidate.participants.size === 0
          && !candidate.circuit
          && candidate.nextStartAt <= currentTime
        ) {
          origins.delete(origin);
        }
      });
      const state = originState(url);
      state.participants.add(policyId);
      if (state.circuit) throw circuitError(state.circuit);

      const reservedStartAt = Math.max(currentTime, state.nextStartAt);
      state.nextStartAt = reservedStartAt + intervalMs;
      if (reservedStartAt > currentTime) {
        await wait(reservedStartAt - currentTime);
      }
      if (state.circuit) throw circuitError(state.circuit);
    },

    observeResponse({ policyId, url, classification, now }) {
      if (!['waf_blocked', 'rate_limited'].includes(classification?.outcome)) return;
      const state = originState(url);
      state.participants.add(policyId);
      state.circuit = classification;
      const currentTime = now();
      const explicitRetryAt = Date.parse(classification.retryAt || '');
      const retryAfterMs = Number.isFinite(classification.retryAfterMs)
        ? classification.retryAfterMs
        : defaultRateLimitCooldownMs;
      state.circuitUntil = Number.isFinite(explicitRetryAt) && explicitRetryAt > currentTime
        ? explicitRetryAt
        : currentTime + (
          classification.outcome === 'rate_limited'
            ? retryAfterMs
            : wafCooldownMs
        );
    },

    release(policyId) {
      origins.forEach((state) => {
        state.participants.delete(policyId);
      });
    }
  };
}

function createSeoAuditCrawlerPolicy({
  minOriginIntervalMs = 250,
  originIntervalOverrides = {},
  originCoordinator = null,
  now = Date.now,
  wait = defaultWait
} = {}) {
  if (!Number.isInteger(minOriginIntervalMs) || minOriginIntervalMs < 0) {
    throw new TypeError('同域请求间隔必须是非负整数');
  }
  const intervalOverrides = new Map(
    Object.entries(originIntervalOverrides).map(([origin, interval]) => {
      if (!Number.isInteger(interval) || interval < 0) {
        throw new TypeError('自有站点请求间隔必须是非负整数');
      }
      return [new URL(origin).origin, interval];
    })
  );

  const origins = new Map();
  const policyId = Symbol('seo-audit-policy');
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

  const intervalFor = (url) => (
    intervalOverrides.get(new URL(url).origin) ?? minOriginIntervalMs
  );

  return {
    async beforeRequest({ url, requestKind = 'link_probe', redirectHop = false }) {
      const state = originState(url);
      if (state.circuit) throw circuitError(state.circuit);

      if (originCoordinator) {
        await originCoordinator.beforeRequest({
          policyId,
          url,
          intervalMs: intervalFor(url),
          now,
          wait
        });
      } else {
        const currentTime = now();
        const reservedStartAt = Math.max(currentTime, state.nextStartAt);
        state.nextStartAt = reservedStartAt + intervalFor(url);
        if (reservedStartAt > currentTime) {
          await wait(reservedStartAt - currentTime);
        }
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
      originCoordinator?.observeResponse({
        policyId,
        url,
        classification: state.circuit,
        now
      });
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
    },

    close() {
      originCoordinator?.release(policyId);
    }
  };
}

module.exports = {
  createSeoAuditOriginCoordinator,
  createSeoAuditCrawlerPolicy
};
