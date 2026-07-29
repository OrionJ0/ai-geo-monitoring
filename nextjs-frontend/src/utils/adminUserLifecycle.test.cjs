/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../app/admin/users/page.tsx'),
  'utf8'
);

test('user management exposes reversible deactivation instead of deletion', () => {
  assert.doesNotMatch(source, /axios\.delete|handleDelete|确认删除|>删除</);
  assert.match(source, /status:\s*record\.status === 'active' \? 'inactive' : 'active'/);
  assert.match(source, /record\.status === 'active' \? '停用' : '启用'/);
  assert.match(source, /停用后该用户不能继续登录，历史项目和报告保持不变/);
  assert.doesNotMatch(source, /\bdisabled\b/);
});
