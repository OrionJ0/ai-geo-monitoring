const test = require('node:test');
const assert = require('node:assert/strict');

const { createIdempotencyKey } = require('./idempotencyKey.cjs');

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('uses crypto.randomUUID when the browser provides it', () => {
  const expected = 'd79c052d-2c83-43ad-9bfc-0dfd20e95843';
  const actual = createIdempotencyKey({
    randomUUID: () => expected,
    getRandomValues: () => {
      throw new Error('fallback should not run');
    }
  });

  assert.equal(actual, expected);
});

test('generates an RFC 4122 UUID v4 when randomUUID is unavailable', () => {
  const actual = createIdempotencyKey({
    getRandomValues(bytes) {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = index;
      return bytes;
    }
  });

  assert.equal(actual, '00010203-0405-4607-8809-0a0b0c0d0e0f');
  assert.match(actual, UUID_V4_PATTERN);
});

test('fails explicitly when no secure random source is available', () => {
  assert.throws(
    () => createIdempotencyKey({}),
    /安全随机数/
  );
});
