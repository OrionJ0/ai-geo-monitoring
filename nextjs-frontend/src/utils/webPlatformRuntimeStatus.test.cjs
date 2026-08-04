const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  getWebPlatformRuntimePresentation,
  selectManagedWebPlatformCodes
} = require('./webPlatformRuntimeStatus.cjs');

function present(status, options = {}) {
  return getWebPlatformRuntimePresentation(status, {
    platformName: 'DeepSeek Web',
    ...options
  });
}

test('maps idle and busy snapshots to queue-wide wording without ETA or exact position', () => {
  assert.deepEqual(present({
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

  assert.deepEqual(present({
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

  const waiting = present({
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
  assert.equal(present({
    enabled: false,
    state: 'unavailable',
    reason_code: 'disabled'
  }), null);

  assert.deepEqual(present(null, { unavailable: true }), {
    type: 'info',
    title: 'DeepSeek Web 状态暂时无法读取',
    description: '不影响现有运行入口；提交时仍会执行通道检查。'
  });

  assert.deepEqual(present({
    enabled: false,
    state: 'unavailable',
    reason_code: 'disabled'
  }, { unavailable: true }), {
    type: 'info',
    title: 'DeepSeek Web 状态暂时无法读取',
    description: '不影响现有运行入口；提交时仍会执行通道检查。'
  });
});

test('shows runtime status only for managed Web platforms used by the current project or run', () => {
  assert.deepEqual(
    selectManagedWebPlatformCodes([
      'doubao',
      'deepseek-web',
      'DOUBAO-WEB',
      'deepseek-web',
      '',
      null
    ]),
    ['deepseek-web', 'doubao-web']
  );
  assert.deepEqual(selectManagedWebPlatformCodes(['doubao', 'qwen']), []);
  assert.deepEqual(selectManagedWebPlatformCodes(undefined), []);
});

test('maps login, verification, unavailable and shutdown to operator-safe guidance', () => {
  assert.deepEqual(present({
    enabled: true,
    state: 'login_required',
    reason_code: 'web_login_required'
  }), {
    type: 'warning',
    title: 'DeepSeek Web 登录已失效',
    description: '请前往设置中心，在运行后端的机器上打开专用 Chrome 重新登录；恢复后可从原运行报告重试。',
    actionHref: '/admin/settings',
    actionLabel: '前往设置中心'
  });
  assert.deepEqual(present({
    enabled: true,
    state: 'verification_required',
    reason_code: 'web_verification_required'
  }), {
    type: 'warning',
    title: 'DeepSeek Web 需要人工验证',
    description: '请前往设置中心，在运行后端的机器上打开专用 Chrome 完成人工验证；不要在当前页面输入凭据。',
    actionHref: '/admin/settings',
    actionLabel: '前往设置中心'
  });
  assert.deepEqual(present({
    enabled: true,
    state: 'unavailable',
    reason_code: 'web_profile_in_use'
  }), {
    type: 'error',
    title: 'DeepSeek Web 当前不可用',
    description: '运行后端的机器上已有专用浏览器会话占用，请由管理员检查。',
    actionHref: '/admin/settings',
    actionLabel: '前往设置中心'
  });
  assert.deepEqual(present({
    enabled: true,
    state: 'shutting_down'
  }), {
    type: 'info',
    title: 'DeepSeek Web 服务正在关闭',
    description: '暂不接受新的 Web 页面工作。'
  });
});

test('shared component polls only on visible pages and is mounted at both decision points', () => {
  const hookPath = path.resolve(__dirname, '../lib/useWebPlatformRuntimeStatus.ts');
  const componentPath = path.resolve(__dirname, '../components/WebPlatformRuntimeStatus.tsx');
  const componentStylesPath = path.resolve(__dirname, '../components/WebPlatformRuntimeStatus.module.css');
  const promptsPath = path.resolve(__dirname, '../app/geo/prompts/page.tsx');
  const reportsPath = path.resolve(__dirname, '../app/geo/question-set-reports/page.tsx');

  assert.equal(fs.existsSync(hookPath), true);
  assert.equal(fs.existsSync(componentPath), true);

  const hook = fs.readFileSync(hookPath, 'utf8');
  const component = fs.readFileSync(componentPath, 'utf8');
  const componentStyles = fs.readFileSync(componentStylesPath, 'utf8');
  const prompts = fs.readFileSync(promptsPath, 'utf8');
  const reports = fs.readFileSync(reportsPath, 'utf8');

  assert.match(hook, /`\/api\/ai-platforms\/\$\{platformCode\}\/runtime-status`/);
  assert.match(hook, /POLL_INTERVAL_MS\s*=\s*30_000/);
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /document\.visibilityState\s*!==\s*'visible'/);
  assert.match(hook, /requestVersion/);
  assert.match(component, /getWebPlatformRuntimePresentation/);
  assert.match(component, /selectManagedWebPlatformCodes\(platformCodes\)/);
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /presentation\.actionHref/);
  assert.match(component, /前往设置中心|presentation\.actionLabel/);
  assert.doesNotMatch(component, /单通道队列|platform\.kicker/);
  assert.match(componentStyles, /\.runtimeStrip \+ \.runtimeStrip\s*\{[^}]*margin-top:\s*8px/);
  assert.match(componentStyles, /\.copy\s*\{[^}]*display:\s*flex[^}]*align-items:\s*baseline/);
  assert.match(prompts, /<WebPlatformRuntimeStatus\s+platformCodes=\{selectableCodes\}\s*\/>/);
  assert.match(reports, /<WebPlatformRuntimeStatus\s+platformCodes=\{relevantWebPlatformCodes\}\s*\/>/);
});
