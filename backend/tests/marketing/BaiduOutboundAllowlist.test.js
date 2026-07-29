const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../../modules/marketing');
const manifest = JSON.parse(fs.readFileSync(
  path.join(
    root,
    'contracts/baidu/baidu-marketing-pending-2026-07-29/manifest.json'
  ),
  'utf8'
));

test('blocked contract has no production outbound allowlist', () => {
  assert.equal(manifest.status, 'BLOCKED');
  assert.deepEqual(manifest.productionAllowlist, []);
});

test('unverified Baidu adapter cannot issue network requests', () => {
  const source = fs.readFileSync(
    path.join(root, 'adapters/BaiduMarketingClient.js'),
    'utf8'
  );
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /\baxios\b/u);
  assert.doesNotMatch(source, /\.request\s*\(/u);
});
