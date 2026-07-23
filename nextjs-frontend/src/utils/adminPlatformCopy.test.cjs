/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../app/admin/settings/AIPlatformSettings.tsx'), 'utf8');

test('admin platform settings mask an existing API key and reveal it only through the password eye', () => {
  assert.match(source, /API Key/);
  assert.match(source, /不会自动导入/);
  assert.match(source, /点击眼睛查看完整密钥/);
  assert.match(source, /MASKED_API_KEY/);
  assert.match(source, /handleApiKeyVisibilityChange/);
  assert.doesNotMatch(source, /显示现有密钥/);
  assert.doesNotMatch(source, /末四位/);
  assert.doesNotMatch(source, /disabled=\{revealingKey\}/);
  assert.doesNotMatch(source, /正在读取完整密钥/);
  assert.doesNotMatch(source, /value=\{[^}]*api_key/);
});
