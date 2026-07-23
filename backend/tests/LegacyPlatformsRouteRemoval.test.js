const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('legacy platform ping route is removed from the production app', () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
  const legacyRoute = path.resolve(__dirname, '../routes/platforms.js');

  assert.equal(fs.existsSync(legacyRoute), false);
  assert.doesNotMatch(appSource, /routes\/platforms|\/api\/platforms/);
  assert.match(appSource, /\/api\/ai-platforms/);
  assert.match(appSource, /\/api\/admin\/ai-platforms/);
});
