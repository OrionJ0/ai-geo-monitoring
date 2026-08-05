const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '../..');
const SECRET_CANARIES = [
  'access-token-canary',
  'refresh-token-canary',
  'race-access-canary',
  'race-refresh-canary'
];

test('production marketing source does not contain test credential canaries', () => {
  const sourceFiles = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (/\.(?:js|json)$/u.test(entry.name)) sourceFiles.push(target);
    }
  };
  visit(path.join(ROOT, 'modules/marketing'));
  const source = sourceFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  for (const canary of SECRET_CANARIES) {
    assert.doesNotMatch(source, new RegExp(canary, 'u'));
  }
});

test('authorization response contracts never expose credential-shaped fields', () => {
  const routes = fs.readFileSync(
    path.join(ROOT, 'modules/marketing/routes/baiduAuthorizationRoutes.js'),
    'utf8'
  );
  assert.doesNotMatch(routes, /\b(accessToken|refreshToken|clientSecret)\b/u);
});

test('connection directory exposes only sanitized versioned product status', () => {
  const service = fs.readFileSync(
    path.join(ROOT, 'modules/marketing/services/BaiduAuthorizationService.js'),
    'utf8'
  );
  assert.match(service, /tongjiUserName/u);
  assert.match(service, /products/u);
  assert.match(service, /publicProductState/u);
  assert.doesNotMatch(service, /tongji_access_token_ciphertext/iu);
  assert.doesNotMatch(service, /tongji_account_name/iu);
});
