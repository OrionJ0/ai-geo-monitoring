const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routeSource = fs.readFileSync(path.resolve(__dirname, '../routes/schedules.js'), 'utf8');

test('schedule route resolves platform choices from the database catalog', () => {
  assert.match(routeSource, /await AIPlatformService\.getAvailablePlatforms\(\)/);
  assert.match(routeSource, /validatePlatformsWithinContext\(/);
  assert.match(routeSource, /defaultPlatformsForContext\(/);
  assert.match(routeSource, /定时任务平台必须包含在项目或问题的监测平台内/);
  assert.match(routeSource, /if \(!platformResult\.ok\)/);
  assert.match(routeSource, /SchedulerService\.runNowWithResult\(id\)/);
  assert.match(routeSource, /skipped_platforms/);
  assert.doesNotMatch(routeSource, /MAINLAND_MONITORING_PLATFORMS|\['doubao', 'deepseek'\]/);
});
