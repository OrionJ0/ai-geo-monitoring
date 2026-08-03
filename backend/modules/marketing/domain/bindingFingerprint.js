const crypto = require('node:crypto');

function bindingFingerprint(bindings) {
  const value = [...bindings]
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    .map((binding) => ({
      bindingId: String(binding.id),
      connectionId: String(binding.connection_id ?? binding.connectionId),
      accountId: String(
        binding.external_account_id ?? binding.externalAccountId
      ),
      tongjiSiteId: String(
        binding.tongji_site_id ?? binding.tongjiSiteId ?? ''
      ),
      tongjiSiteDomain: String(
        binding.tongji_site_domain ?? binding.tongjiSiteDomain ?? ''
      ),
      bindingVersion: Number(
        binding.binding_version ?? binding.bindingVersion
      )
    }));
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ version: 2, bindings: value }), 'utf8')
    .digest('hex');
}

module.exports = {
  bindingFingerprint
};
