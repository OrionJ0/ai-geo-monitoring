const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('user routes do not expose internal error messages in 500 responses', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../routes/user.js'), 'utf8');

  assert.doesNotMatch(source, /status\(\s*500\s*\)\.json\(\{[\s\S]*?error:\s*error\.message[\s\S]*?\}\)/);
  assert.doesNotMatch(source, /error:\s*error\.message/);
});

test('default administrator bootstrap uses the documented local credentials', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
  const envExample = fs.readFileSync(path.resolve(__dirname, '../.env.example'), 'utf8');

  assert.match(source, /DEFAULT_ADMIN_USERNAME \|\| 'admin'/);
  assert.match(source, /DEFAULT_ADMIN_PASSWORD \|\| 'admin123456'/);
  assert.match(envExample, /^DEFAULT_ADMIN_USERNAME=admin$/m);
  assert.match(envExample, /^DEFAULT_ADMIN_PASSWORD=admin123456$/m);
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
