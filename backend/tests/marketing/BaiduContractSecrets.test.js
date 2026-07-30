const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const contractDirectory = path.resolve(
  __dirname,
  '../../modules/marketing/contracts/baidu/baidu-marketing-docs-2026-07-30'
);

test('Baidu contract artifacts contain no credential or raw callback material', () => {
  const files = fs.readdirSync(contractDirectory)
    .filter((filename) => filename.endsWith('.json'));
  assert.deepEqual(files, ['manifest.json']);

  const source = fs.readFileSync(
    path.join(contractDirectory, 'manifest.json'),
    'utf8'
  );
  assert.doesNotMatch(
    source,
    /"(?:clientSecret|accessToken|refreshToken|authorizationCode|rawState)"\s*:\s*"[^"]+"/u
  );
  assert.doesNotMatch(source, /"[12]\.[A-Za-z0-9._~-]{24,}"/u);
  assert.doesNotMatch(source, /[?&](?:code|state)=/iu);
});
