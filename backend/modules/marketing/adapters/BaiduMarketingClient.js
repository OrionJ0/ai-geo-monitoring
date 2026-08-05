const {
  BaiduContractBlockedError,
  BaiduMarketingError
} = require('./baidu/BaiduErrors');
const { BaiduHttpKernel } = require('./baidu/BaiduHttpKernel');
const { BaiduOAuthClient } = require('./baidu/BaiduOAuthClient');
const {
  BaiduSearchAdsClient,
  decimalNumberToScaledText
} = require('./baidu/BaiduSearchAdsClient');
const { BaiduTongjiClient } = require('./baidu/BaiduTongjiClient');

class BaiduMarketingClient {
  constructor({
    manifest,
    appId,
    secretKey,
    scope,
    redirectUri,
    timeoutMs = 10000,
    transport,
    monotonicClock,
    wait,
    searchReportBudgetLimits
  }) {
    this.httpKernel = new BaiduHttpKernel({
      manifest,
      timeoutMs,
      transport
    });
    this.oauthClient = new BaiduOAuthClient({
      manifest,
      appId,
      secretKey,
      scope,
      redirectUri,
      httpKernel: this.httpKernel
    });
    this.searchAdsClient = new BaiduSearchAdsClient({
      manifest,
      httpKernel: this.httpKernel,
      monotonicClock,
      wait,
      searchReportBudgetLimits
    });
    this.tongjiClient = new BaiduTongjiClient({
      manifest,
      httpKernel: this.httpKernel
    });
    this.timeoutMs = this.httpKernel.timeoutMs;
  }

  createSearchReportBudget() {
    return this.searchAdsClient.createSearchReportBudget();
  }

  async acquireSearchReportSlot(report) {
    return this.searchAdsClient.acquireSearchReportSlot(report);
  }

  assertAllowed(method, url) {
    return this.httpKernel.assertAllowed(method, url);
  }

  buildAuthorizationUrl(request) {
    return this.oauthClient.buildAuthorizationUrl(request);
  }

  verifyCallbackSignature(parameters) {
    return this.oauthClient.verifyCallbackSignature(parameters);
  }

  async requestJson(request) {
    return this.httpKernel.requestJson(request);
  }

  async exchangeAuthorizationCode(request) {
    return this.oauthClient.exchangeAuthorizationCode(request);
  }

  async refreshAccessToken(request) {
    return this.oauthClient.refreshAccessToken(request);
  }

  async listAccounts(request) {
    return this.oauthClient.listAccounts(request);
  }

  async fetchConfiguredSearchReport(request) {
    return this.searchAdsClient.fetchConfiguredSearchReport(request);
  }

  async fetchSearchReport(request) {
    return this.searchAdsClient.fetchSearchReport(request);
  }

  async fetchSearchAdGroupReport(request) {
    return this.searchAdsClient.fetchSearchAdGroupReport(request);
  }

  async fetchSearchKeywordReport(request) {
    return this.searchAdsClient.fetchSearchKeywordReport(request);
  }

  async fetchSearchTermReport(request) {
    return this.searchAdsClient.fetchSearchTermReport(request);
  }

  async fetchSearchReports(request) {
    return this.searchAdsClient.fetchSearchReports(request);
  }

  async listTongjiSites(request) {
    return this.tongjiClient.listTongjiSites(request);
  }

  async fetchTongjiTrend(request) {
    return this.tongjiClient.fetchTongjiTrend(request);
  }

  async fetchTongjiQualityTrend(request) {
    return this.tongjiClient.fetchTongjiQualityTrend(request);
  }

  async fetchTongjiPageReport(request) {
    return this.tongjiClient.fetchTongjiPageReport(request);
  }

  async fetchTongjiSourceSummary(request) {
    return this.tongjiClient.fetchTongjiSourceSummary(request);
  }
}

module.exports = {
  BaiduContractBlockedError,
  BaiduMarketingClient,
  BaiduMarketingError,
  decimalNumberToScaledText
};
