const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  getDeepSeekWebRuntimePresentation
} = require('./deepSeekWebRuntimeStatus.cjs');

test('maps idle and busy snapshots to queue-wide wording without ETA or exact position', () => {
  assert.deepEqual(getDeepSeekWebRuntimePresentation({
    enabled: true,
    state: 'idle',
    running_count: 0,
    queued_count: 0,
    pending_count: 0
  }), {
    type: 'info',
    title: 'DeepSeek Web 当前空闲',
    description: '当前没有等待中的 Web 问题。'
  });

  assert.deepEqual(getDeepSeekWebRuntimePresentation({
    enabled: true,
    state: 'busy',
    running_count: 1,
    queued_count: 4,
    pending_count: 5
  }), {
    type: 'info',
    title: 'DeepSeek Web 正在处理',
    description: '正在运行 1 条，等待 4 条。其他 Web 问题将按顺序执行。'
  });

  const waiting = getDeepSeekWebRuntimePresentation({
    enabled: true,
    state: 'busy',
    running_count: 0,
    queued_count: 3,
    pending_count: 3
  });
  assert.equal(waiting.description, '已有 3 条等待处理。Web 问题将按顺序执行。');
  assert.doesNotMatch(JSON.stringify(waiting), /ETA|预计|第\s*\d+\s*位/);
});

test('hides disabled status and keeps read failures non-blocking', () => {
  assert.equal(getDeepSeekWebRuntimePresentation({
    enabled: false,
    state: 'unavailable',
    reason_code: 'disabled'
  }), null);

  assert.deepEqual(getDeepSeekWebRuntimePresentation(null, { unavailable: true }), {
    type: 'info',
    title: 'DeepSeek Web 状态暂时无法读取',
    description: '不影响现有运行入口；提交时仍会执行通道检查。'
  });

  assert.deepEqual(getDeepSeekWebRuntimePresentation({
    enabled: false,
    state: 'unavailable',
    reason_code: 'disabled'
  }, { unavailable: true }), {
    type: 'info',
    title: 'DeepSeek Web 状态暂时无法读取',
    description: '不影响现有运行入口；提交时仍会执行通道检查。'
  });
});

test('maps login, verification, unavailable and shutdown to operator-safe guidance', () => {
  assert.deepEqual(getDeepSeekWebRuntimePresentation({
    enabled: true,
    state: 'login_required',
    reason_code: 'web_login_required'
  }), {
    type: 'warning',
    title: 'DeepSeek Web 登录已失效',
    description: '请联系虚拟机运维负责人处理；恢复后可从原运行报告重试。'
  });
  assert.deepEqual(getDeepSeekWebRuntimePresentation({
    enabled: true,
    state: 'verification_required',
    reason_code: 'web_verification_required'
  }), {
    type: 'warning',
    title: 'DeepSeek Web 需要人工验证',
    description: '请联系虚拟机运维负责人处理；不要在当前页面输入 DeepSeek 凭据。'
  });
  assert.deepEqual(getDeepSeekWebRuntimePresentation({
    enabled: true,
    state: 'unavailable',
    reason_code: 'web_profile_in_use'
  }), {
    type: 'error',
    title: 'DeepSeek Web 当前不可用',
    description: '专用浏览器会话正在被占用，请联系虚拟机运维负责人处理。'
  });
  assert.deepEqual(getDeepSeekWebRuntimePresentation({
    enabled: true,
    state: 'shutting_down'
  }), {
    type: 'info',
    title: 'DeepSeek Web 服务正在关闭',
    description: '暂不接受新的 Web 页面工作。'
  });
});

test('shared component polls only on visible pages and is mounted at both decision points', () => {
  const hookPath = path.resolve(__dirname, '../lib/useDeepSeekWebRuntimeStatus.ts');
  const componentPath = path.resolve(__dirname, '../components/DeepSeekWebRuntimeStatus.tsx');
  const promptsPath = path.resolve(__dirname, '../app/geo/prompts/page.tsx');
  const reportsPath = path.resolve(__dirname, '../app/geo/question-set-reports/page.tsx');

  assert.equal(fs.existsSync(hookPath), true);
  assert.equal(fs.existsSync(componentPath), true);

  const hook = fs.readFileSync(hookPath, 'utf8');
  const component = fs.readFileSync(componentPath, 'utf8');
  const prompts = fs.readFileSync(promptsPath, 'utf8');
  const reports = fs.readFileSync(reportsPath, 'utf8');

  assert.match(hook, /\/api\/ai-platforms\/deepseek-web\/runtime-status/);
  assert.match(hook, /POLL_INTERVAL_MS\s*=\s*30_000/);
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /document\.visibilityState\s*!==\s*'visible'/);
  assert.match(hook, /requestVersion/);
  assert.match(component, /getDeepSeekWebRuntimePresentation/);
  assert.match(component, /aria-live="polite"/);
  assert.match(prompts, /<DeepSeekWebRuntimeStatus\s*\/>/);
  assert.match(reports, /<DeepSeekWebRuntimeStatus\s*\/>/);
});
