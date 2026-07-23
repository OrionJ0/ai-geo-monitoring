/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('public root reuses the login page instead of the retired landing page', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../app/page.tsx'), 'utf8');

  assert.match(source, /export \{ default \} from '\.\/login\/page'/);
});
