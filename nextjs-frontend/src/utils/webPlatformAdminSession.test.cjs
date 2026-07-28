const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isManagedWebAdapter,
  getWebPlatformAdminSessionPresentation,
  getWebPlatformAdminSessionMeta
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

test('always explains verification freshness without exposing account identity', () => {
  assert.deepEqual(
    getWebPlatformAdminSessionMeta({ last_verified_at: null }),
    {
      lastVerifiedDetail: '最近验证：尚未成功验证',
      accountDetail: '账号身份：系统不读取，请在专用 Chrome 中确认'
    }
  );

  const verified = getWebPlatformAdminSessionMeta({
    last_verified_at: '2026-07-27T08:00:00.000Z'
  });
  assert.match(verified.lastVerifiedDetail, /^最近验证：/);
  assert.doesNotMatch(verified.lastVerifiedDetail, /尚未成功验证/);
  assert.equal(
    verified.accountDetail,
    '账号身份：系统不读取，请在专用 Chrome 中确认'
  );
});
