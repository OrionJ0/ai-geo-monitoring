const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildPostgresTlsOptions
} = require('../config/postgresTls');

test('Postgres TLS verifies the server certificate by default', () => {
  assert.deepEqual(buildPostgresTlsOptions({}), {
    require: true,
    rejectUnauthorized: true
  });
  assert.deepEqual(buildPostgresTlsOptions({
    DB_SSL_CA: 'line-one\\nline-two'
  }), {
    require: true,
    rejectUnauthorized: true,
    ca: 'line-one\nline-two'
  });
});

test('production rejects disabling Postgres certificate verification', () => {
  assert.throws(
    () => buildPostgresTlsOptions({
      NODE_ENV: 'production',
      DB_SSL_REJECT_UNAUTHORIZED: 'false'
    }),
    (error) => error.code === 'POSTGRES_TLS_VERIFICATION_REQUIRED'
  );
  assert.equal(buildPostgresTlsOptions({
    NODE_ENV: 'development',
    DB_SSL_REJECT_UNAUTHORIZED: 'false'
  }).rejectUnauthorized, false);
});
