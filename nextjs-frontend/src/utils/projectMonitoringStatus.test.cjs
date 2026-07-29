const test = require('node:test');
const assert = require('node:assert/strict');
const {
  describeMonitoringExecution
} = require('./projectMonitoringStatus.cjs');

test('describes Web login schedule failures with an actionable settings link', () => {
  assert.deepEqual(describeMonitoringExecution({
    status: 'failed',
    due_at: '2026-07-29T01:00:00.000Z',
    error_code: 'web_platform_preflight_failed',
    error_message: '豆包网页版需要重新人工登录，本次运行未创建任务。'
  }), {
    label: '最近一次失败',
    color: 'error',
    detail: '豆包网页版需要重新人工登录，本次运行未创建任务。',
    settingsUrl: '/admin/settings'
  });
});

test('describes successful and absent schedule executions without a settings link', () => {
  assert.deepEqual(describeMonitoringExecution({ status: 'completed' }), {
    label: '最近一次成功',
    color: 'success',
    detail: '',
    settingsUrl: null
  });
  assert.equal(describeMonitoringExecution(null), null);
});
