const crypto = require('node:crypto');

const SIGNED_CALLBACK_KEYS = Object.freeze([
  'appId',
  'authCode',
  'state',
  'timestamp',
  'userId'
]);

class BaiduOAuthSignatureError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function aesKey(secretKey) {
  const value = String(secretKey || '');
  const first16Characters = value.slice(0, 16);
  const key = Buffer.from(first16Characters, 'utf8');
  if (value.length < 16 || key.length !== 16) {
    throw new BaiduOAuthSignatureError(
      '百度应用 secretKey 无法生成 16 字节 AES 密钥',
      'BAIDU_SECRET_KEY_INVALID'
    );
  }
  return key;
}

function canonicalCallbackJson(parameters) {
  const canonical = {};
  for (const key of [...SIGNED_CALLBACK_KEYS].sort()) {
    if (typeof parameters?.[key] !== 'string') {
      throw new BaiduOAuthSignatureError(
        '百度授权回调签名参数无效',
        'BAIDU_CALLBACK_SIGNATURE_INPUT_INVALID'
      );
    }
    canonical[key] = parameters[key];
  }
  return JSON.stringify(canonical);
}

function zeroPad16(source) {
  if (source.length % 16 === 0) return source;
  const padded = Buffer.alloc(source.length + (16 - (source.length % 16)));
  source.copy(padded);
  return padded;
}

function createBaiduCallbackSignature({ parameters, secretKey }) {
  const encoded = Buffer.from(
    Buffer.from(canonicalCallbackJson(parameters), 'utf8').toString('base64'),
    'utf8'
  );
  const cipher = crypto.createCipheriv(
    'aes-128-cbc',
    aesKey(secretKey),
    Buffer.alloc(16)
  );
  cipher.setAutoPadding(false);
  return Buffer.concat([
    cipher.update(zeroPad16(encoded)),
    cipher.final()
  ]).toString('hex').toUpperCase();
}

function verifyBaiduCallbackSignature({ parameters, secretKey }) {
  const signature = parameters?.signature;
  if (
    typeof signature !== 'string'
    || !/^(?:[0-9A-F]{2})+$/u.test(signature)
  ) {
    return false;
  }
  const expected = createBaiduCallbackSignature({ parameters, secretKey });
  const actualBuffer = Buffer.from(signature, 'ascii');
  const expectedBuffer = Buffer.from(expected, 'ascii');
  return (
    actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

module.exports = {
  SIGNED_CALLBACK_KEYS,
  createBaiduCallbackSignature,
  verifyBaiduCallbackSignature
};
