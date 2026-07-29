const test = require('node:test');
const assert = require('node:assert/strict');
const { getWebPreflightPrompt } = require('./webPreflightPrompt.cjs');

test('builds an exact platform list only for Web preflight failures', () => {
  assert.deepEqual(getWebPreflightPrompt({
    message: '网页登录状态未就绪，本次运行未创建任务。',
    data: {
      error_code: 'web_platform_preflight_failed',
      settings_url: '/admin/settings',
      blocked_platforms: [
        { platform: 'doubao-web', name: '豆包网页版', message: '豆包网页版需要人工验证' },
        { platform: 'deepseek-web', name: 'DeepSeek 网页版', message: 'DeepSeek 网页版需要重新人工登录' }
      ]
    }
  }), {
    title: '运行前需要处理网页登录',
    message: '网页登录状态未就绪，本次运行未创建任务。',
    blockedMessages: [
      '豆包网页版需要人工验证',
      'DeepSeek 网页版需要重新人工登录'
    ],
    settingsUrl: '/admin/settings'
  });
  assert.equal(getWebPreflightPrompt({ data: { error_code: 'analysis_api_not_configured' } }), null);
});
