const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function shanghaiDate(epochMilliseconds) {
  return new Date(epochMilliseconds + SHANGHAI_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

function fixedShanghaiWindow(epochMilliseconds = Date.now()) {
  return {
    from: shanghaiDate(epochMilliseconds - (29 * DAY_MS)),
    to: shanghaiDate(epochMilliseconds)
  };
}

module.exports = {
  fixedShanghaiWindow
};
