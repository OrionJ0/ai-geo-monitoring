const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routeSource = fs.readFileSync(path.resolve(__dirname, '../routes/statistics.js'), 'utf8');

test('statistics route errors do not expose internal exception messages', () => {
  assert.doesNotMatch(routeSource, /error:\s*error\.message/);
});

test('keyword statistics route loads stored keyword counts', () => {
  assert.match(routeSource, /attributes:\s*\[[^\]]*'result_summary'/);
});

test('statistics routes aggregate historical records for dynamic platforms', () => {
  assert.doesNotMatch(routeSource, /MAINLAND_MONITORING_PLATFORMS|withMainlandPlatformScope/);
  assert.match(routeSource, /where:\s*whereClause/);
  assert.match(routeSource, /where:\s*metricWhereClause/);
});

test('statistics aggregate columns use the Sequelize model alias instead of the physical table name', () => {
  assert.doesNotMatch(routeSource, /sequelize\.col\('question_records\.(?:id|created_at)'\)/);
  assert.match(routeSource, /sequelize\.fn\('COUNT', sequelize\.col\('id'\)\)/);
  assert.match(routeSource, /sequelize\.fn\('DATE', sequelize\.col\('created_at'\)\)/);
});
