const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'user-lifecycle-api-test-secret';

const userRouter = require('../routes/user');
const { User } = require('../models');
const { authRequired } = require('../middleware/auth');

function adminToken() {
  return jwt.sign(
    { userId: 1, username: 'admin', role: 'admin' },
    process.env.JWT_SECRET
  );
}

async function callRoute(method, routePath, body = {}) {
  const layer = userRouter.stack.find(
    (item) => item.route?.path === routePath
      && item.route.methods?.[method.toLowerCase()]
  );
  assert.ok(layer, `route ${method} ${routePath} should exist`);
  const request = {
    headers: { authorization: `Bearer ${adminToken()}` },
    params: { id: '9' },
    query: {},
    body
  };
  const response = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
  const handlers = layer.route.stack.map((item) => item.handle);
  const dispatch = async (index) => {
    if (!handlers[index]) return;
    await handlers[index](request, response, () => dispatch(index + 1));
  };
  await dispatch(0);
  return response;
}

test('daily user lifecycle only deactivates the account and has no delete route', async () => {
  assert.equal(
    userRouter.stack.some(
      (item) => item.route?.path === '/:id' && item.route.methods?.delete
    ),
    false
  );

  const originalFindByPk = User.findByPk;
  let updatedPayload;
  User.findByPk = async (id) => (
    Number(id) === 1
      ? {
          id: 1,
          username: 'admin',
          role: 'admin',
          status: 'active',
          membership_level: 'enterprise',
          membership_expires_at: null
        }
      : {
          membership_level: 'free',
          update: async (payload) => {
            updatedPayload = payload;
          }
        }
  );

  try {
    const response = await callRoute('PUT', '/:id', { status: 'inactive' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.message, '用户已停用');
    assert.deepEqual(updatedPayload, {
      status: 'inactive',
      membership_expires_at: null
    });
  } finally {
    User.findByPk = originalFindByPk;
  }
});

test('an inactive user cannot keep using an existing access token', async () => {
  const originalFindByPk = User.findByPk;
  User.findByPk = async () => ({
    id: 9,
    username: 'inactive-user',
    role: 'user',
    status: 'inactive',
    membership_level: 'free',
    membership_expires_at: null
  });
  const request = {
    headers: {
      authorization: `Bearer ${jwt.sign(
        { userId: 9, username: 'inactive-user', role: 'user' },
        process.env.JWT_SECRET
      )}`
    },
    query: {}
  };
  const response = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
  let nextCalled = false;

  try {
    await authRequired(request, response, () => {
      nextCalled = true;
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.payload.message, '账户已停用，请联系管理员');
    assert.equal(nextCalled, false);
  } finally {
    User.findByPk = originalFindByPk;
  }
});
