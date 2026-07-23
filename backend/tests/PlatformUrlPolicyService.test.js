const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validatePlatformUrl,
  isBlockedAddress
} = require('../services/PlatformUrlPolicyService');

test('allows a public HTTPS endpoint after resolving every address', async () => {
  const result = await validatePlatformUrl('https://api.example.com/v1/chat/completions', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    allowlist: ''
  });

  assert.equal(result.url, 'https://api.example.com/v1/chat/completions');
  assert.equal(result.hostPort, 'api.example.com:443');
});

test('rejects insecure, credentialed, and private endpoints', async () => {
  await assert.rejects(
    validatePlatformUrl('http://api.example.com/v1', { lookup: async () => [{ address: '93.184.216.34', family: 4 }] }),
    /公网 HTTPS/
  );
  await assert.rejects(
    validatePlatformUrl('https://user:pass@api.example.com/v1', { lookup: async () => [{ address: '93.184.216.34', family: 4 }] }),
    /不能包含用户名或密码/
  );
  await assert.rejects(
    validatePlatformUrl('https://internal.example.com/v1', { lookup: async () => [{ address: '10.0.0.9', family: 4 }] }),
    /本机或私网地址/
  );
});

test('allows private endpoints only by exact host and port allowlist', async () => {
  const options = {
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    allowlist: 'localhost:11434,model.internal:443'
  };

  const result = await validatePlatformUrl('https://localhost:11434/v1/chat/completions', options);
  assert.equal(result.hostPort, 'localhost:11434');

  await assert.rejects(
    validatePlatformUrl('https://localhost:11435/v1/chat/completions', options),
    /本机或私网地址/
  );
});

test('classifies common IPv4 and IPv6 local ranges as blocked', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.1.1', '::1', 'fd00::1', 'fe80::1']) {
    assert.equal(isBlockedAddress(address), true, address);
  }
  assert.equal(isBlockedAddress('8.8.8.8'), false);
  assert.equal(isBlockedAddress('2606:4700:4700::1111'), false);
});
