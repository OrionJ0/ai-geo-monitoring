const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('user routes do not expose internal error messages in 500 responses', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../routes/user.js'), 'utf8');

  assert.doesNotMatch(source, /status\(\s*500\s*\)\.json\(\{[\s\S]*?error:\s*error\.message[\s\S]*?\}\)/);
  assert.doesNotMatch(source, /error:\s*error\.message/);
});

test('production startup has no public administrator or demo credential fallback', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
  const envExample = fs.readFileSync(path.resolve(__dirname, '../.env.example'), 'utf8');

  assert.doesNotMatch(source, /DEFAULT_ADMIN_PASSWORD \|\| ['"]admin123456['"]/);
  assert.doesNotMatch(source, /bcrypt\.hash\(['"]demo-password['"]/);
  assert.match(source, /DEFAULT_ADMIN_BOOTSTRAP_ENABLED/);
  assert.match(source, /DEMO_USER_ENABLED/);
  assert.match(source, /NODE_ENV === 'production'/);
  assert.match(envExample, /^DEFAULT_ADMIN_USERNAME=admin$/m);
  assert.match(envExample, /^DEFAULT_ADMIN_PASSWORD=$/m);
  assert.match(envExample, /^DEFAULT_ADMIN_BOOTSTRAP_ENABLED=false$/m);
  assert.match(envExample, /^DEMO_USER_ENABLED=false$/m);
});

test('ordinary and administrator auth reject URL and cookie tokens', async () => {
  const { authRequired, adminRequired, authSseRequired } = require('../middleware/auth');
  const response = () => ({
    statusCode: 200,
    body: null,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; }
  });
  for (const middleware of [authRequired, adminRequired, authSseRequired]) {
    for (const request of [
      { headers: {}, query: { token: 'url-secret' }, cookies: {} },
      { headers: {}, query: {}, cookies: { token: 'cookie-secret' } }
    ]) {
      const res = response();
      let nextCalled = false;
      await middleware(request, res, () => { nextCalled = true; });
      assert.equal(res.statusCode, 401);
      assert.equal(nextCalled, false);
      assert.doesNotMatch(JSON.stringify(res.body), /url-secret|cookie-secret/u);
    }
  }
});

test('private SEO mode disables public self-registration', () => {
  const { selfRegistrationEnabled } = require('../config/seoAuditNetworkPolicy');
  const source = fs.readFileSync(path.resolve(__dirname, '../routes/user.js'), 'utf8');

  assert.equal(selfRegistrationEnabled('true'), false);
  assert.equal(selfRegistrationEnabled('TRUE'), false);
  assert.equal(selfRegistrationEnabled('false'), true);
  assert.equal(selfRegistrationEnabled(''), true);
  assert.match(source, /router\.post\('\/register'[\s\S]*selfRegistrationEnabled\(\)/);
  assert.match(source, /SELF_REGISTRATION_DISABLED/);
});
