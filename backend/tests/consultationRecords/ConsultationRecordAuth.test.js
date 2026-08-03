const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const jwt = require('jsonwebtoken');

const User = require('../../models/User');
const { authHeaderRequired } = require('../../middleware/auth');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    }
  };
}

test('mounts consultation records behind header-only authentication', () => {
  const appSource = fs.readFileSync(
    path.resolve(__dirname, '../../app.js'),
    'utf8'
  );
  assert.match(
    appSource,
    /app\.use\(\s*'\/api\/consultations',\s*authHeaderRequired,\s*consultationRecordModule\.router\s*\)/u
  );
});

test('rejects a query-string JWT before loading an account', async () => {
  const response = responseRecorder();
  let nextCalled = false;
  await authHeaderRequired(
    { headers: {}, query: { token: 'secret-in-url' }, cookies: {} },
    response,
    () => { nextCalled = true; }
  );
  assert.equal(response.statusCode, 401);
  assert.equal(nextCalled, false);
  assert.doesNotMatch(JSON.stringify(response.body), /secret-in-url/u);
});

test('accepts only an active account presented through Authorization Bearer', async (t) => {
  const previousSecret = process.env.JWT_SECRET;
  const previousFindByPk = User.findByPk;
  process.env.JWT_SECRET = 'consultation-test-secret';
  t.after(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    User.findByPk = previousFindByPk;
  });
  User.findByPk = async () => ({
    id: 7,
    username: 'redacted-user',
    role: 'user',
    status: 'active',
    membership_level: 'free',
    membership_expires_at: null
  });
  const token = jwt.sign({ userId: 7 }, process.env.JWT_SECRET, {
    expiresIn: '5m'
  });
  const request = {
    headers: { authorization: `Bearer ${token}` },
    query: {},
    cookies: {}
  };
  const response = responseRecorder();
  let nextCalled = false;
  await authHeaderRequired(request, response, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.deepEqual(request.user, {
    id: 7,
    username: 'redacted-user',
    role: 'user',
    level: 'free',
    membershipExpiresAt: null
  });
});
