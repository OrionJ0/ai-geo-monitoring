function privateTargetsEnabled(rawValue = process.env.SEO_AUDIT_ALLOW_PRIVATE_TARGETS) {
  return String(rawValue || '').trim().toLowerCase() === 'true';
}

function selfRegistrationEnabled(rawValue = process.env.SEO_AUDIT_ALLOW_PRIVATE_TARGETS) {
  return !privateTargetsEnabled(rawValue);
}

module.exports = { privateTargetsEnabled, selfRegistrationEnabled };
