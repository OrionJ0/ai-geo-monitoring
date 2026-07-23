/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../app/geo/sources/page.tsx'), 'utf8');

test('source analysis explains media and other third-party classification', () => {
  assert.match(source, /媒体内容.*维护的媒体域名规则/);
  assert.match(source, /其他第三方来源.*未命中/);
  assert.match(source, /第三方来源总数包含媒体/);
  assert.match(source, /其他第三方来源/);
});
