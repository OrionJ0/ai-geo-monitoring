/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

test('login form does not expose a user registration action', () => {
  const login = source('../components/Login.jsx');

  assert.doesNotMatch(login, /showRegister|\/register|没有账户.*注册/);
});

test('authenticated headers expose logout without a duplicate home action', () => {
  for (const relativePath of [
    '../app/geo/layout.tsx',
    '../app/admin/layout.tsx'
  ]) {
    const layout = source(relativePath);
    assert.match(layout, /<Button onClick=\{handleLogout\}>退出登录<\/Button>/);
    assert.doesNotMatch(layout, /返回首页/);
  }
});
