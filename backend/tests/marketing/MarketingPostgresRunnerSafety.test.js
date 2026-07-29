const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertDisposablePostgresUrl
} = require('../../scripts/runMarketingPostgresTests');

test('PostgreSQL runner rejects missing, production, and unmarked targets before DDL', () => {
  assert.throws(
    () => assertDisposablePostgresUrl(''),
    { code: 'MARKETING_POSTGRES_TEST_URL_REQUIRED' }
  );
  const production = 'postgres://app:secret@db.example.com/production';
  assert.throws(
    () => assertDisposablePostgresUrl(production, production),
    { code: 'MARKETING_POSTGRES_PRODUCTION_URL_REJECTED' }
  );
  assert.throws(
    () => assertDisposablePostgresUrl(production),
    { code: 'MARKETING_POSTGRES_TEST_URL_UNSAFE' }
  );
});

test('PostgreSQL runner accepts an explicitly disposable test target', () => {
  const value = 'postgres://tester:secret@127.0.0.1/marketing_test';
  assert.equal(assertDisposablePostgresUrl(value), value);
});
