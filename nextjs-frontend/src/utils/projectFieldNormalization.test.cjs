/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { normalizeList, normalizeNullableText, isValidWebsiteInput } = require('./projectFieldNormalization.cjs');

test('normalizes project tag values before submit', () => {
  assert.deepEqual(
    normalizeList([' Goodie AI ', 'goodie ai', 'GoodieAI', 'Goodie AI'], { exclude: ['Goodie AI'] }),
    ['GoodieAI']
  );

  assert.deepEqual(
    normalizeList('米其林, Michelin\nmichelin； 米其林 '),
    ['米其林', 'Michelin']
  );
});

test('normalizes nullable project text fields', () => {
  assert.equal(normalizeNullableText('  AI   搜索优化  '), 'AI 搜索优化');
  assert.equal(normalizeNullableText('   '), null);
});

test('validates optional project website inputs before submit', () => {
  assert.equal(isValidWebsiteInput(''), true);
  assert.equal(isValidWebsiteInput(' www.goodie.ai/path '), true);
  assert.equal(isValidWebsiteInput('https://brand.cn'), true);
  assert.equal(isValidWebsiteInput('品牌官网'), false);
  assert.equal(isValidWebsiteInput('来源：竞品资料'), false);
});

test('administrator workspace validates brand and competitor website fields before submit', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../app/admin/settings/WorkspaceSettings.tsx'), 'utf8');
  assert.match(page, /isValidWebsiteInput/);
  assert.equal((page.match(/name="website" label="官网" rules=\{websiteRules\}/g) || []).length, 2);
});
