/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BATCH_QUESTION_LIMIT,
  parseBatchQuestions
} = require('./questionBatchParser.cjs');

test('批量问题按换行和中英文分号拆分，并保留问题中的逗号', () => {
  const result = parseBatchQuestions('1. 哪个品牌更适合家庭？\n价格高，是否值得买；售后怎么样?');

  assert.deepEqual(result.questions, [
    '哪个品牌更适合家庭？',
    '价格高，是否值得买',
    '售后怎么样?'
  ]);
  assert.equal(result.overflow_count, 0);
});

test('批量问题去除常见列表符号、空行和完全重复项', () => {
  const result = parseBatchQuestions('- 问题一\n• 问题二\n问题一\n\n（3）问题三');

  assert.deepEqual(result.questions, ['问题一', '问题二', '问题三']);
});

test('批量问题限制单次最多一百条并报告超出数量', () => {
  const result = parseBatchQuestions(
    Array.from({ length: BATCH_QUESTION_LIMIT + 2 }, (_, index) => `问题 ${index + 1}`).join('\n')
  );

  assert.equal(result.questions.length, BATCH_QUESTION_LIMIT);
  assert.equal(result.overflow_count, 2);
});
