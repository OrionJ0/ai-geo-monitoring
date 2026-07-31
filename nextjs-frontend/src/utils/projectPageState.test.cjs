/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../app/geo/projects/page.tsx'), 'utf8');

test('retired project management page redirects to the administrator workspace', () => {
  assert.match(source, /redirect\('\/admin\/settings#workspace'\)/);
  assert.doesNotMatch(source, /axios/);
  assert.doesNotMatch(source, /competitor/);
  assert.doesNotMatch(source, /platforms/);
});

test('prompt run analysis configuration errors include a safe settings action', () => {
  const promptSource = fs.readFileSync(
    path.resolve(__dirname, '../app/geo/prompts/page.tsx'),
    'utf8',
  );
  assert.match(promptSource, /settings_url === '\/admin\/settings'/);
  assert.match(promptSource, /showRunError/);
  assert.doesNotMatch(promptSource, /getWebPreflightPrompt/);
  assert.match(promptSource, /前往设置中心/);
  assert.match(promptSource, /router\.push\(settingsUrl\)/);
});
