const crypto = require('node:crypto');

const VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

function parseEncryptionKey(rawKey = process.env.CONFIG_ENCRYPTION_KEY) {
  const value = String(rawKey || '').trim();
  if (!value) throw new Error('平台密钥加密未配置');

  let key;
  if (/^[a-f0-9]{64}$/i.test(value)) {
    key = Buffer.from(value, 'hex');
  } else {
    try {
      key = Buffer.from(value, 'base64');
    } catch (_) {
      key = null;
    }
  }

  if (!key || key.length !== KEY_BYTES) {
    throw new Error('平台密钥加密未配置：CONFIG_ENCRYPTION_KEY 必须是 32 字节 Base64 或 64 位十六进制');
  }
  return key;
}

function isEncryptionConfigured(rawKey = process.env.CONFIG_ENCRYPTION_KEY) {
  try {
    parseEncryptionKey(rawKey);
    return true;
  } catch (_) {
    return false;
  }
}

function encryptSecret(secret, rawKey = process.env.CONFIG_ENCRYPTION_KEY) {
  const plaintext = String(secret || '');
  if (!plaintext) throw new Error('API Key 不能为空');

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', parseEncryptionKey(rawKey), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':');
}

function decryptSecret(ciphertext, rawKey = process.env.CONFIG_ENCRYPTION_KEY) {
  try {
    const [version, ivPart, tagPart, dataPart, extra] = String(ciphertext || '').split(':');
    if (version !== VERSION || !ivPart || !tagPart || !dataPart || extra !== undefined) {
      throw new Error('invalid ciphertext');
    }

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      parseEncryptionKey(rawKey),
      Buffer.from(ivPart, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  } catch (error) {
    if (String(error?.message || '').startsWith('平台密钥加密未配置')) throw error;
    throw new Error('平台密钥解密失败');
  }
}

module.exports = {
  encryptSecret,
  decryptSecret,
  isEncryptionConfigured,
  parseEncryptionKey
};
