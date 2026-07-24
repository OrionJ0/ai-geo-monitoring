const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveServerHost } = require('../config/serverBinding');

test('backend binds to loopback when HOST is not configured', () => {
  assert.equal(resolveServerHost(undefined), '127.0.0.1');
  assert.equal(resolveServerHost(''), '127.0.0.1');
  assert.equal(resolveServerHost('   '), '127.0.0.1');
});

test('container deployments can explicitly opt into an all-interface binding', () => {
  assert.equal(resolveServerHost('0.0.0.0'), '0.0.0.0');
  assert.equal(resolveServerHost(' :: '), '::');
});
