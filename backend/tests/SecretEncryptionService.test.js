const test = require('node:test');
const assert = require('node:assert/strict');

const {
  encryptSecret,
  decryptSecret,
  isEncryptionConfigured
} = require('../services/SecretEncryptionService');

const KEY_A = Buffer.alloc(32, 1).toString('base64');
const KEY_B = Buffer.alloc(32, 2).toString('base64');

test('encrypts an API key with authenticated versioned ciphertext', () => {
  const ciphertext = encryptSecret('sk-sensitive-value', KEY_A);

  assert.match(ciphertext, /^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
  assert.equal(ciphertext.includes('sk-sensitive-value'), false);
  assert.equal(decryptSecret(ciphertext, KEY_A), 'sk-sensitive-value');
});

test('rejects missing, malformed, or incorrect encryption keys', () => {
  const ciphertext = encryptSecret('sk-sensitive-value', KEY_A);

  assert.equal(isEncryptionConfigured(KEY_A), true);
  assert.equal(isEncryptionConfigured('short-key'), false);
  assert.throws(() => encryptSecret('secret', ''), /平台密钥加密未配置/);
  assert.throws(() => decryptSecret(ciphertext, KEY_B), /平台密钥解密失败/);
});

test('rejects empty secrets instead of creating ambiguous configured state', () => {
  assert.throws(() => encryptSecret('', KEY_A), /API Key 不能为空/);
});
