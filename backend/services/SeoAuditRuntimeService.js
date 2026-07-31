const { createSeoAuditService, normalizeWebsiteUrl } = require('./SeoAuditService');
const { createSeoSiteAuditService } = require('./SeoSiteAuditService');
const {
  createSeoSiteClient,
  createSeoAuditTargetPolicy
} = require('./SeoSiteClient');
const { createSeoRenderService } = require('./SeoRenderService');
const { createSeoAuditOriginCoordinator } = require('./SeoAuditCrawlerPolicy');
const { defaultSeoAuditRules } = require('../config/seoAuditRules');

const sharedOriginCoordinator = createSeoAuditOriginCoordinator();

const SITE_CRAWL_PROFILES = Object.freeze({
  standard: Object.freeze({
    key: 'standard',
    concurrency: defaultSeoAuditRules.crawl.concurrency,
    minOriginIntervalMs: defaultSeoAuditRules.crawl.minOriginIntervalMs
  }),
  ownedFast: Object.freeze({
    key: 'owned_fast',
    concurrency: 8,
    minOriginIntervalMs: 100
  })
});

function configuredOriginSet(values) {
  return new Set((Array.isArray(values) ? values : []).flatMap((value) => {
    try {
      return [new URL(value).origin];
    } catch {
      return [];
    }
  }));
}

function resolveSiteCrawlProfile(inputUrl, ownedOrigins = []) {
  const requestedUrl = normalizeWebsiteUrl(inputUrl);
  const isOwned = configuredOriginSet(ownedOrigins).has(new URL(requestedUrl).origin);
  return isOwned ? SITE_CRAWL_PROFILES.ownedFast : SITE_CRAWL_PROFILES.standard;
}

function rulesForProfile(profile) {
  if (profile.key === SITE_CRAWL_PROFILES.standard.key) return defaultSeoAuditRules;
  return {
    ...defaultSeoAuditRules,
    crawl: {
      ...defaultSeoAuditRules.crawl,
      concurrency: profile.concurrency,
      minOriginIntervalMs: profile.minOriginIntervalMs
    }
  };
}

function resolveSeoAuditTarget(inputUrl, options = {}) {
  const requestedUrl = normalizeWebsiteUrl(inputUrl);
  const policy = createSeoAuditTargetPolicy(requestedUrl, options);
  return { requestedUrl, policy };
}

function withClientLifecycle(service, siteClient) {
  return {
    async audit(...args) {
      try {
        return await service.audit(...args);
      } finally {
        siteClient.close?.();
      }
    }
  };
}

function createPageAuditRuntime(inputUrl, options = {}) {
  const target = resolveSeoAuditTarget(inputUrl, options);
  const clientOptions = options.clientOptions || {};
  const siteClient = createSeoSiteClient({
    ...clientOptions,
    allowedPrivateOrigin: target.policy.allowedPrivateOrigin,
    originCoordinator: clientOptions.originCoordinator ?? sharedOriginCoordinator,
    minOriginIntervalMs: clientOptions.minOriginIntervalMs
      ?? defaultSeoAuditRules.crawl.minOriginIntervalMs
  });
  const service = createSeoAuditService({ siteClient });
  return {
    ...target,
    siteClient,
    service: withClientLifecycle(service, siteClient)
  };
}

function createSiteAuditRuntime(inputUrl, options = {}) {
  const target = resolveSeoAuditTarget(inputUrl, options);
  const clientOptions = options.clientOptions || {};
  const ownedOrigins = configuredOriginSet(options.ownedOrigins);
  const crawlProfile = resolveSiteCrawlProfile(target.requestedUrl, Array.from(ownedOrigins));
  const ruleConfig = options.ruleConfig || rulesForProfile(crawlProfile);
  const configuredOriginIntervals = Object.fromEntries(
    Array.from(ownedOrigins).map((origin) => [
      origin,
      SITE_CRAWL_PROFILES.ownedFast.minOriginIntervalMs
    ])
  );
  const siteClient = createSeoSiteClient({
    ...clientOptions,
    allowedPrivateOrigin: target.policy.allowedPrivateOrigin,
    originCoordinator: clientOptions.originCoordinator ?? sharedOriginCoordinator,
    minOriginIntervalMs: clientOptions.minOriginIntervalMs
      ?? SITE_CRAWL_PROFILES.standard.minOriginIntervalMs,
    originIntervalOverrides: clientOptions.originIntervalOverrides
      ?? configuredOriginIntervals
  });
  const service = createSeoSiteAuditService({
    siteClient,
    networkScope: target.policy.networkScope,
    crawlProfile: crawlProfile.key,
    ruleConfig,
    renderService: options.renderService || (target.policy.networkScope === 'private'
      ? undefined
      : createSeoRenderService())
  });
  return {
    ...target,
    crawlProfile,
    siteClient,
    service: withClientLifecycle(service, siteClient)
  };
}

function withNetworkPolicy(report, policy, { mode = report?.mode } = {}) {
  const privateTarget = policy?.networkScope === 'private';
  if (!privateTarget) return report;
  return {
    ...report,
    networkPolicy: mode === 'site'
      ? {
          scope: 'private',
          externalLinkProbes: 'not_checked',
          javascriptRendering: 'not_checked'
        }
      : { scope: 'private' }
  };
}

module.exports = {
  resolveSeoAuditTarget,
  createPageAuditRuntime,
  createSiteAuditRuntime,
  resolveSiteCrawlProfile,
  SITE_CRAWL_PROFILES,
  withNetworkPolicy
};
