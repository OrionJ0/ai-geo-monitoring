const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeWebsiteUrl } = require('../services/SeoAuditService');

test('defaults a LAN IPv4 address without a protocol to HTTP', () => {
  assert.equal(
    normalizeWebsiteUrl('192.168.9.206:3003'),
    'http://192.168.9.206:3003/'
  );
});

test('defaults localhost without a protocol to HTTP', () => {
  assert.equal(normalizeWebsiteUrl('localhost:3003'), 'http://localhost:3003/');
});

test('keeps HTTPS as the default for public hosts without a protocol', () => {
  assert.equal(normalizeWebsiteUrl('example.com/path'), 'https://example.com/path');
});

test('preserves an explicitly supplied HTTP protocol', () => {
  assert.equal(
    normalizeWebsiteUrl('http://192.168.9.206:3003/about'),
    'http://192.168.9.206:3003/about'
  );
});

test('does not downgrade an explicitly supplied HTTPS protocol for a LAN address', () => {
  assert.equal(
    normalizeWebsiteUrl('https://192.168.9.206:3003/'),
    'https://192.168.9.206:3003/'
  );
});
