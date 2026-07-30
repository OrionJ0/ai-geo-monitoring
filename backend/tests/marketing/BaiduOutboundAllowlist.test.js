const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../../modules/marketing');
const manifest = JSON.parse(fs.readFileSync(
  path.join(
    root,
    'contracts/baidu/baidu-marketing-docs-2026-07-30/manifest.json'
  ),
  'utf8'
));

test('documented contract has no production allowlist before a real pilot', () => {
  assert.equal(manifest.status, 'DOCUMENTED_PENDING_PILOT');
  assert.deepEqual(manifest.productionAllowlist, []);
});

test('documented allowlist contains only read-only OAuth, account and report requests', () => {
  assert.deepEqual(manifest.documentedOutboundAllowlist, [
    'GET https://u.baidu.com/oauth/page/index',
    'POST https://u.baidu.com/oauth/accessToken',
    'POST https://u.baidu.com/oauth/refreshToken',
    'POST https://u.baidu.com/oauth/getUserInfo',
    'POST https://api.baidu.com/json/sms/service/OpenApiReportService/getReportData'
  ]);
  assert.equal(
    manifest.documentedOutboundAllowlist.some((entry) => (
      /add|update|delete|pause|bid/iu.test(entry)
    )),
    false
  );
});
