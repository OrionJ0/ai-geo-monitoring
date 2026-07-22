/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const forbiddenPlatformCopy = /kimi|qianwen|Kimi|千问|元宝/u;

test('public root reuses the login page instead of the retired landing page', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../app/page.tsx'), 'utf8');

  assert.match(source, /export \{ default \} from '\.\/login\/page'/);
});

test('legacy result display labels only expose supported mainland monitoring platforms', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../components/ResultsDisplay.jsx'), 'utf8');

  assert.match(source, /doubao/);
  assert.match(source, /deepseek/);
  assert.doesNotMatch(source, forbiddenPlatformCopy);
});
