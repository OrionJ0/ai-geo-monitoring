const { createSeoAuditService, normalizeWebsiteUrl } = require('./SeoAuditService');
const { createSeoSiteAuditService } = require('./SeoSiteAuditService');
const {
  createSeoSiteClient,
  createSeoAuditTargetPolicy
} = require('./SeoSiteClient');

function resolveSeoAuditTarget(inputUrl, options = {}) {
  const requestedUrl = normalizeWebsiteUrl(inputUrl);
  const policy = createSeoAuditTargetPolicy(requestedUrl, options);
  return { requestedUrl, policy };
}

function createPageAuditRuntime(inputUrl, options = {}) {
  const target = resolveSeoAuditTarget(inputUrl, options);
  const siteClient = target.policy.networkScope === 'private'
    ? createSeoSiteClient({ allowedPrivateOrigin: target.policy.allowedPrivateOrigin })
    : undefined;
  return {
    ...target,
    service: createSeoAuditService({ siteClient })
  };
}

function createSiteAuditRuntime(inputUrl, options = {}) {
  const target = resolveSeoAuditTarget(inputUrl, options);
  const siteClient = target.policy.networkScope === 'private'
    ? createSeoSiteClient({ allowedPrivateOrigin: target.policy.allowedPrivateOrigin })
    : undefined;
  return {
    ...target,
    service: createSeoSiteAuditService({
      siteClient,
      networkScope: target.policy.networkScope
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
