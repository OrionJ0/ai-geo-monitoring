/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../app/admin/settings/AIPlatformSettings.tsx'), 'utf8');

test('admin platform settings explain manual API key configuration without echoing secrets', () => {
  assert.match(source, /API Key/);
  assert.match(source, /不会自动导入/);
  assert.match(source, /留空则保留现有密钥/);
  assert.doesNotMatch(source, /value=\{[^}]*api_key/);
});
