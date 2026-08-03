const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('frontend exposes its own build-time revision instead of proxying backend health', () => {
  const root = path.resolve(__dirname, '../..');
  const route = fs.readFileSync(
    path.join(root, 'src/app/api/frontend-health/route.ts'),
    'utf8'
  );
  const config = fs.readFileSync(path.join(root, 'next.config.ts'), 'utf8');
  assert.match(route, /AI_GEO_BUILD_REVISION/);
  assert.doesNotMatch(route, /fetch\s*\(/);
  assert.match(config, /AI_GEO_BUILD_REVISION/);
});
