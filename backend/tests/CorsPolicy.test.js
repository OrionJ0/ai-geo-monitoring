const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createCorsOptionsDelegate,
  isLoopbackAddress,
  parseAllowedOrigins
} = require('../config/corsPolicy');

function resolveCors(delegate, { origin, remoteAddress }) {
  return new Promise((resolve) => {
    delegate({
      headers: origin ? { origin } : {},
      socket: { remoteAddress }
    }, (error, options) => resolve({ error, options }));
  });
}

test('loopback detection accepts IPv4, IPv6 and IPv4-mapped loopback only', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('127.12.34.56'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('192.168.9.224'), false);
  assert.equal(isLoopbackAddress('::ffff:192.168.9.224'), false);
});

test('CORS trusts a same-machine proxy even when the browser Origin uses a LAN IP', async () => {
  const delegate = createCorsOptionsDelegate({ allowedOrigins: [] });
  const result = await resolveCors(delegate, {
    origin: 'http://192.168.9.224:3001',
    remoteAddress: '127.0.0.1'
  });

  assert.equal(result.error, null);
  assert.equal(result.options.origin, true);
  assert.equal(result.options.credentials, true);
});

test('CORS rejects an external direct cross-origin request with HTTP 403 metadata', async () => {
  const delegate = createCorsOptionsDelegate({ allowedOrigins: [] });
  const result = await resolveCors(delegate, {
    origin: 'http://192.168.9.224:3001',
    remoteAddress: '192.168.9.50'
  });

  assert.equal(result.options, undefined);
  assert.equal(result.error?.status, 403);
  assert.equal(result.error?.code, 'CORS_ORIGIN_DENIED');
});

test('CORS keeps explicit cross-origin allowlists and server-to-server requests working', async () => {
  assert.deepEqual(parseAllowedOrigins(undefined), []);
  assert.deepEqual(
    parseAllowedOrigins(' https://geo.example.com, ,https://admin.example.com '),
    ['https://geo.example.com', 'https://admin.example.com']
  );

  const delegate = createCorsOptionsDelegate({
    allowedOrigins: ['https://geo.example.com']
  });
  const explicit = await resolveCors(delegate, {
    origin: 'https://geo.example.com',
    remoteAddress: '10.0.0.20'
  });
  const noOrigin = await resolveCors(delegate, {
    remoteAddress: '10.0.0.20'
  });

  assert.equal(explicit.error, null);
  assert.equal(explicit.options.origin, true);
  assert.equal(noOrigin.error, null);
  assert.equal(noOrigin.options.origin, false);
});
