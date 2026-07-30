const { createSeoAuditService, normalizeWebsiteUrl } = require('./SeoAuditService');
const { createSeoSiteAuditService } = require('./SeoSiteAuditService');
const {
  createSeoSiteClient,
  createSeoAuditTargetPolicy
} = require('./SeoSiteClient');
const { createSeoRenderService } = require('./SeoRenderService');
const { defaultSeoAuditRules } = require('../config/seoAuditRules');

function resolveSeoAuditTarget(inputUrl, options = {}) {
  const requestedUrl = normalizeWebsiteUrl(inputUrl);
  const policy = createSeoAuditTargetPolicy(requestedUrl, options);
  return { requestedUrl, policy };
}

function createPageAuditRuntime(inputUrl, options = {}) {
  const target = resolveSeoAuditTarget(inputUrl, options);
  const clientOptions = options.clientOptions || {};
  const siteClient = createSeoSiteClient({
    ...clientOptions,
    allowedPrivateOrigin: target.policy.allowedPrivateOrigin,
    minOriginIntervalMs: clientOptions.minOriginIntervalMs
      ?? defaultSeoAuditRules.crawl.minOriginIntervalMs
  });
  return {
    ...target,
    siteClient,
    service: createSeoAuditService({ siteClient })
  };
}

function createSiteAuditRuntime(inputUrl, options = {}) {
  const target = resolveSeoAuditTarget(inputUrl, options);
  const clientOptions = options.clientOptions || {};
  const siteClient = createSeoSiteClient({
    ...clientOptions,
    allowedPrivateOrigin: target.policy.allowedPrivateOrigin,
    minOriginIntervalMs: clientOptions.minOriginIntervalMs
      ?? defaultSeoAuditRules.crawl.minOriginIntervalMs
  });
  return {
    ...target,
    siteClient,
    service: createSeoSiteAuditService({
      siteClient,
      networkScope: target.policy.networkScope,
      renderService: options.renderService || (target.policy.networkScope === 'private'
        ? undefined
        : createSeoRenderService())
    })
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
  withNetworkPolicy
};
