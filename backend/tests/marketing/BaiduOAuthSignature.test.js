const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createBaiduCallbackSignature,
  verifyBaiduCallbackSignature
} = require('../../modules/marketing/domain/baiduOAuthSignature');

const parameters = Object.freeze({
  appId: 'app-fixture',
  authCode: 'auth-code-fixture',
  state: 'state-fixture',
  timestamp: '1611216626171',
  userId: '1234'
});
const secretKey = '0123456789abcdef-secret-key-fixture';
const expectedSignature = [
  'E96D35180111A0316D7B1A7502B4DEDEEB97E74B2D4C6936EF31DA03BEBC2E24',
  '0C1D35FBB9CEB21E5FBF7D2F9B86CD707C9181DFD5F21063A3FC271CA3C1B665',
  'CC0E987F09F835CCCDD0142FC0B7D778CC24DE799308CD21ABBDB113A9266CED84',
  'F684052C2E7E0A94E71B964CD3BABC55E49635433C76A69E431F2D4BCE579CDD7',
  'E651107B2EB34EA95F340E31D827F4EBC7565F3AC4FFAB9F135140E022B0BBAA9',
  '5ACE00F500C64FAC9614C30DF6B3'
].join('');

test('callback signature follows Baidu natural-key JSON, Base64 and AES-CBC fixture', () => {
  assert.equal(
    createBaiduCallbackSignature({ parameters, secretKey }),
    expectedSignature
  );
  assert.equal(
    verifyBaiduCallbackSignature({
      parameters: { ...parameters, signature: expectedSignature },
      secretKey
    }),
    true
  );
});

test('callback signature rejects tampering, malformed signatures and invalid AES keys', () => {
  assert.equal(
    verifyBaiduCallbackSignature({
      parameters: {
        ...parameters,
        authCode: 'tampered',
        signature: expectedSignature
      },
      secretKey
    }),
    false
  );
  assert.equal(
    verifyBaiduCallbackSignature({
      parameters: { ...parameters, signature: 'not-hex' },
      secretKey
    }),
    false
  );
  assert.throws(
    () => createBaiduCallbackSignature({
      parameters,
      secretKey: '短密钥'
    }),
    { code: 'BAIDU_SECRET_KEY_INVALID' }
  );
});
