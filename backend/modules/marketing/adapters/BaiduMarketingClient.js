class BaiduContractBlockedError extends Error {
  constructor() {
    super('百度营销真实契约尚未核验');
    this.code = 'BAIDU_CONTRACT_NOT_VERIFIED';
    this.status = 503;
  }
}

class BaiduMarketingClient {
  constructor({ manifest }) {
    if (
      manifest?.status !== 'VERIFIED'
      || !Array.isArray(manifest.productionAllowlist)
      || manifest.productionAllowlist.length === 0
      || (manifest.blockers?.length || 0) > 0
      || manifest.runtime?.adapterImplemented !== true
    ) {
      throw new BaiduContractBlockedError();
    }
    this.manifest = manifest;
  }

  buildAuthorizationUrl() {
    throw new BaiduContractBlockedError();
  }

  async exchangeAuthorizationCode() {
    throw new BaiduContractBlockedError();
  }

  async refreshAccessToken() {
    throw new BaiduContractBlockedError();
  }

  async listAccounts() {
    throw new BaiduContractBlockedError();
  }

  async fetchSearchReport() {
    throw new BaiduContractBlockedError();
  }
}

module.exports = {
  BaiduContractBlockedError,
  BaiduMarketingClient
};
