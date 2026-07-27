const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isManagedWebAdapter,
  getWebPlatformAdminSessionPresentation
} = require('./webPlatformAdminSession.cjs');

test('recognizes both managed Web adapters without treating API adapters as Web', () => {
  assert.equal(isManagedWebAdapter('deepseek_web'), true);
  assert.equal(isManagedWebAdapter('doubao_web'), true);
  assert.equal(isManagedWebAdapter('openai_responses'), false);
  assert.equal(isManagedWebAdapter('openai_chat_completions'), false);
});

test('presents distinct browser and login configuration states', () => {
  assert.deepEqual(
    getWebPlatformAdminSessionPresentation({
      browser_configured: false,
      profile_initialized: false,
      login_state: 'unavailable',
      last_verified_at: null
    }),
    {
      color: 'error',
      label: '浏览器未配置',
      detail: '后端未找到可用的专用 Chrome。'
    }
  );
  assert.equal(
    getWebPlatformAdminSessionPresentation({
      browser_configured: true,
      profile_initialized: false,
      login_state: 'unchecked',
      last_verified_at: null
    }).label,
    '尚未登录'
  );
  assert.equal(
    getWebPlatformAdminSessionPresentation({
      browser_configured: true,
      profile_initialized: true,
      login_state: 'unchecked',
      last_verified_at: null
    }).label,
    '会话待验证'
  );
  assert.equal(
    getWebPlatformAdminSessionPresentation({
      browser_configured: true,
      profile_initialized: true,
      login_state: 'ready',
      last_verified_at: '2026-07-27T08:00:00.000Z'
    }).label,
    '网页登录已验证'
  );
  assert.equal(
    getWebPlatformAdminSessionPresentation({
      browser_configured: true,
      profile_initialized: true,
      login_state: 'login_required',
      last_verified_at: null
    }).label,
    '需要登录'
  );
  assert.equal(
    getWebPlatformAdminSessionPresentation({
      browser_configured: true,
      profile_initialized: true,
      login_state: 'verification_required',
      last_verified_at: null
    }).label,
    '需要人工验证'
  );
  assert.equal(
    getWebPlatformAdminSessionPresentation({
      browser_configured: true,
      profile_initialized: true,
      login_state: 'selector_mismatch',
      last_verified_at: null
    }).label,
    '页面结构异常'
  );
});
