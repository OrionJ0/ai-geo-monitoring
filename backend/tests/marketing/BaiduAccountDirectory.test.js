const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeSearchAccounts
} = require('../../modules/marketing/services/BaiduBindingService');

test('account directory keeps opaque ids lossless and excludes unsupported products', () => {
  assert.deepEqual(normalizeSearchAccounts([
    {
      accountId: '0009007199254740993123',
      accountName: '甲',
      product: 'SEARCH',
      readOnly: true
    },
    {
      accountId: '2',
      accountName: '乙',
      product: 'UNSUPPORTED_PRODUCT',
      readOnly: true
    }
  ]), [{
    accountId: '0009007199254740993123',
    accountName: '甲'
  }]);
});

test('account directory rejects numeric external identifiers', () => {
  assert.throws(
    () => normalizeSearchAccounts([{
      accountId: 9007199254740993,
      accountName: '危险 ID',
      product: 'SEARCH',
      readOnly: true
    }]),
    { code: 'ACCOUNT_DIRECTORY_INVALID' }
  );
});
