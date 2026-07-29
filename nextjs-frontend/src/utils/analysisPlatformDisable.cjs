function shouldWarnAnalysisPlatformDisable(platformCode, nextEnabled, analysisPlatformCode) {
  return nextEnabled === false
    && Boolean(analysisPlatformCode)
    && platformCode === analysisPlatformCode;
}

module.exports = {
  shouldWarnAnalysisPlatformDisable
};
