/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../app/admin/history/page.tsx'),
  'utf8',
);

test('admin history constrains untrusted answer heading sizes', () => {
  assert.match(source, /const historyMarkdownComponents/);
  assert.match(source, /h1:.*level=\{4\}/s);
  assert.match(source, /h2:.*level=\{5\}/s);
  assert.match(source, /components=\{historyMarkdownComponents\}/);
});
