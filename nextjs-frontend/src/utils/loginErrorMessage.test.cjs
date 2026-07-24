/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const { getLoginErrorMessage } = require('./loginErrorMessage.cjs');

test('login error distinguishes invalid credentials from proxy and server failures', () => {
  assert.equal(
    getLoginErrorMessage({ response: { status: 401, data: { message: '用户名或密码错误' } } }),
    '用户名或密码错误'
  );
  assert.equal(
    getLoginErrorMessage({ request: {} }),
    '无法连接服务器，请检查 API 代理或网络配置'
  );
  assert.equal(
    getLoginErrorMessage({ response: { status: 502, data: { message: 'Bad Gateway' } } }),
    '服务器暂时不可用，请稍后重试'
  );
  assert.equal(
    getLoginErrorMessage({ response: { status: 403, data: { message: '账户已被禁用' } } }),
    '被禁止登录：请联系管理员'
  );
});
