/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const { formatOptionalDateTimeShort } = require('./dateTimeDisplay.cjs');

test('未运行时间的空值显示占位符而不是 Unix 纪元', () => {
  assert.equal(formatOptionalDateTimeShort(null), '-');
  assert.equal(formatOptionalDateTimeShort(undefined), '-');
  assert.equal(formatOptionalDateTimeShort(''), '-');
  assert.equal(formatOptionalDateTimeShort('   '), '-');
});

test('有效时间按本地年月日时分显示', () => {
  const value = new Date(2026, 6, 27, 22, 6);
  assert.equal(formatOptionalDateTimeShort(value), '2026-07-27 22:06');
});

test('无效时间显示占位符', () => {
  assert.equal(formatOptionalDateTimeShort('not-a-date'), '-');
});
