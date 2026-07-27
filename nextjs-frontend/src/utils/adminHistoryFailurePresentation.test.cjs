/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../app/admin/history/page.tsx'), 'utf8');

test('管理历史展开区展示失败语义、原因、阶段和错误码', () => {
  assert.match(source, /getHistoryFailurePresentation/);
  assert.match(source, /failurePresentation\.title/);
  assert.match(source, /failurePresentation\.message/);
  assert.match(source, /失败阶段/);
  assert.match(source, /failurePresentation\.stage/);
  assert.match(source, /failurePresentation\.stageCode/);
  assert.match(source, /错误码/);
  assert.match(source, /failurePresentation\.errorCode/);
});

test('有回答的失败记录不再把回答标题写成无上下文的 AI 原始回答', () => {
  assert.match(source, /failurePresentation\?\.hasCollectedAnswer/);
  assert.match(source, /采集到的原始回答/);
});
