const BLOCKED_CAPABILITIES = Object.freeze({
  pilotDataAccess: false,
  formalNavigation: false,
  adsRead: false,
  trafficRead: false,
  refreshAds: false
});

function buildMarketingCapabilities(moduleState) {
  if (moduleState === 'READY') {
    return {
      pilotDataAccess: true,
      formalNavigation: true,
      adsRead: true,
      trafficRead: true,
      refreshAds: true
    };
  }
  if (moduleState === 'PILOT_DATA_READY') {
    return {
      pilotDataAccess: true,
      formalNavigation: false,
      adsRead: true,
      trafficRead: true,
      refreshAds: true
    };
  }
  return { ...BLOCKED_CAPABILITIES };
}

function withMarketingCapabilities(status) {
  return {
    ...status,
    capabilities: buildMarketingCapabilities(status.moduleState)
  };
}

module.exports = {
  buildMarketingCapabilities,
  withMarketingCapabilities
};
