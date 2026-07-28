const test = require('node:test');
const assert = require('node:assert/strict');

const { getApiRunResultData } = require('./apiRunResult.cjs');

test('reads run result data from non-2xx api responses', () => {
  const result = getApiRunResultData({
    response: {
      data: {
        success: false,
        message: '分析全部失败',
        data: { completed: 0, failed: 2, attempted: 2 }
      }
    }
  });

  assert.deepEqual(result, { completed: 0, failed: 2, attempted: 2 });
});

test('ignores api errors without object run result data', () => {
  assert.equal(getApiRunResultData({ response: { data: { data: null } } }), null);
  assert.equal(getApiRunResultData({ response: { data: { data: '分析失败' } } }), null);
  assert.equal(getApiRunResultData(null), null);
});

test('does not treat platform preflight errors as completed run results', () => {
  assert.equal(getApiRunResultData({
    response: {
      data: {
        success: false,
        message: 'DeepSeek Web 需要登录；豆包 Web 需要登录，无法运行。',
        data: {
          error_code: 'all_platforms_unavailable',
          skipped_platforms: [
            { platform: 'deepseek-web', reason: '需要登录' },
            { platform: 'doubao-web', reason: '需要登录' }
          ]
        }
      }
    }
  }), null);

  assert.equal(getApiRunResultData({
    response: {
      data: {
        success: false,
        message: '当前配额不足',
        data: {
          error_code: 'quota_exceeded',
          total: 2
        }
      }
    }
  }), null);
});
