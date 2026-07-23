/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('admin history platform filters use the dynamic catalog and stored historical names', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../app/admin/history/page.tsx'), 'utf8');

  assert.match(source, /useAIPlatformCatalog/);
  assert.match(source, /record\.platform_name/);
  assert.match(source, /dataIndex:\s*'model_name'/);
  assert.doesNotMatch(source, /\['doubao','deepseek'\]/);
});
