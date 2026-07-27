/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatHistoryErrorMessage,
  formatHistoryParsingErrorMessage,
  getHistoryFailurePresentation
} = require('./historyErrorDisplay.cjs');

test('keeps safe business history error messages unchanged', () => {
  assert.equal(formatHistoryErrorMessage('监测平台返回内容为空'), '监测平台返回内容为空');
  assert.equal(formatHistoryErrorMessage('AI 平台返回内容为空'), '监测平台返回内容为空');
  assert.equal(formatHistoryErrorMessage('指标生成失败，请稍后重试'), '指标生成失败，请稍后重试');
  assert.equal(formatHistoryErrorMessage('AI 平台调用失败，请稍后重试'), '监测平台调用失败，请稍后重试');
  assert.equal(formatHistoryErrorMessage('监测平台调用失败，请稍后重试'), '监测平台调用失败，请稍后重试');
});

test('hides internal platform and storage errors from history display', () => {
  assert.equal(formatHistoryErrorMessage('指标生成失败: metric write failed'), '指标生成失败，请稍后重试');
  assert.equal(formatHistoryErrorMessage('[deepseek] 401 invalid api key'), '监测平台调用失败，请稍后重试');
  assert.equal(formatHistoryErrorMessage('network down'), '监测平台调用失败，请稍后重试');
});

test('returns a neutral placeholder for blank history errors', () => {
  assert.equal(formatHistoryErrorMessage(''), '-');
  assert.equal(formatHistoryErrorMessage(null), '-');
});

test('hides internal parsing errors from history display', () => {
  assert.equal(formatHistoryParsingErrorMessage('Unexpected token < in JSON at position 0'), '回答处理失败，请稍后重试');
  assert.equal(formatHistoryParsingErrorMessage('Cannot read properties of undefined'), '回答处理失败，请稍后重试');
  assert.equal(formatHistoryParsingErrorMessage(''), '-');
});

test('有原始回答的失败记录说明采集已完成且后续分析失败', () => {
  assert.deepEqual(getHistoryFailurePresentation({
    status: 'failed',
    error_message: 'AI 结构化分析失败，本条未计入有效样本',
    resultDetail: {
      ai_response_original: '这是已经完成采集的回答'
    },
    result_summary: {
      failure: {
        stage: 'analysis_validation',
        error_code: 'invalid_analysis_output'
      }
    }
  }), {
    title: '回答已采集，后续处理失败',
    message: 'AI 结构化分析失败，本条未计入有效样本',
    stage: '结构化分析校验',
    stageCode: 'analysis_validation',
    errorCode: 'invalid_analysis_output',
    hasCollectedAnswer: true
  });
});

test('没有原始回答的失败记录说明采集失败', () => {
  assert.deepEqual(getHistoryFailurePresentation({
    status: 'failed',
    error_message: '[deepseek] 401 invalid api key',
    result_summary: {
      failure: {
        stage: 'platform_request',
        error_code: 'platform_query_failed'
      }
    }
  }), {
    title: '回答采集失败',
    message: '监测平台调用失败，请稍后重试',
    stage: '监测平台请求',
    stageCode: 'platform_request',
    errorCode: 'platform_query_failed',
    hasCollectedAnswer: false
  });
});

test('非失败记录不生成失败说明', () => {
  assert.equal(getHistoryFailurePresentation({
    status: 'completed',
    resultDetail: { ai_response_original: '正常回答' }
  }), null);
});
