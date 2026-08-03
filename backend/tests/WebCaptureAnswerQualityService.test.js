const test = require('node:test');
const assert = require('node:assert/strict');

const WebCaptureAnswerQualityService = require('../services/WebCaptureAnswerQualityService');

test('豆包已知搜索和计划过渡态使用稳定原因码标记为采集无效', () => {
  const evaluate = (responseText) => WebCaptureAnswerQualityService.evaluate({
    platform: 'doubao-web',
    responseText
  });

  assert.deepEqual(evaluate('正在搜索'), {
    status: 'invalid',
    reason_code: 'transient_search_status'
  });
  assert.deepEqual(evaluate('搜索1个关键词，参考6篇资料'), {
    status: 'invalid',
    reason_code: 'transient_search_summary'
  });
  assert.deepEqual(
    evaluate('梳理品牌核心特点\n我将梳理品牌信息，为后续对比表格制作做准备。'),
    {
      status: 'invalid',
      reason_code: 'transient_planning_status'
    }
  );
});

test('普通回答中的下一步建议不能仅因包含计划措辞被误判', () => {
  const quality = WebCaptureAnswerQualityService.evaluate({
    platform: 'doubao-web',
    responseText: '接下来我会分析这三项指标。下一步你可以先确认预算，再决定实施顺序。'
  });

  assert.deepEqual(quality, { status: 'valid' });
});

test('相同短文本不会污染其他平台，持久化无效标记仍优先', () => {
  assert.deepEqual(WebCaptureAnswerQualityService.evaluate({
    platform: 'deepseek',
    responseText: '正在搜索'
  }), { status: 'valid' });
  assert.deepEqual(WebCaptureAnswerQualityService.evaluate({
    platform: 'deepseek',
    responseText: '正式回答',
    webCapture: {
      answer_quality: {
        status: 'invalid',
        reason_code: 'transient_planning_status'
      }
    }
  }), {
    status: 'invalid',
    reason_code: 'transient_planning_status'
  });
});
