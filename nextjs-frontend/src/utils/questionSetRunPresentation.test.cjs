/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PDF_TABLE_CONTENT_WIDTH,
  PDF_COLUMN_WIDTHS,
  formatFailureStages,
  formatSkippedPlatforms,
  getRunStateNotice
} = require('./questionSetRunPresentation.cjs');

test('PDF 七列宽度总和不超过显式内容宽度', () => {
  assert.deepEqual(Object.keys(PDF_COLUMN_WIDTHS), [
    'question',
    'platform',
    'status',
    'brand',
    'rank',
    'citations',
    'sentiment'
  ]);
  assert.ok(
    Object.values(PDF_COLUMN_WIDTHS).reduce((total, width) => total + width, 0)
      <= PDF_TABLE_CONTENT_WIDTH
  );
});

test('失败阶段按数量排序并转换为用户可读说明', () => {
  assert.equal(
    formatFailureStages({
      analysis_validation: 2,
      monitoring_request: 3,
      worker_exception: 1
    }),
    '监测平台调用 3 条、结构化分析校验 2 条、执行器异常 1 条'
  );
});

test('被跳过的平台以用户可读原因进入报告提示', () => {
  assert.equal(
    formatSkippedPlatforms([
      {
        platform: 'deepseek-web',
        name: 'DeepSeek 网页版',
        message: 'DeepSeek 网页版需要重新人工登录'
      },
      {
        platform: 'qwen',
        name: '千问'
      }
    ]),
    'DeepSeek 网页版需要重新人工登录；千问：暂不可用'
  );
  assert.equal(formatSkippedPlatforms(null), '');
});

test('可重试 partial 同时说明数量、阶段和下一步', () => {
  const notice = getRunStateNotice({
    status: 'partial',
    source: 'native',
    integrityStatus: 'complete',
    capabilities: { can_retry: true },
    executionSummary: {
      completed: 55,
      failed: 5,
      pending: 0,
      failure_stages: {
        monitoring_request: 3,
        analysis_validation: 2
      }
    }
  });

  assert.equal(notice.type, 'warning');
  assert.equal(notice.title, '本次运行部分完成');
  assert.match(notice.description, /已完成 55 条，失败 5 条，待处理 0 条/);
  assert.match(notice.description, /主要失败阶段：监测平台调用 3 条、结构化分析校验 2 条/);
  assert.match(notice.description, /可以重试失败项/);
});

test('snapshot-only 和 imported 报告只给出只读说明', () => {
  const snapshot = getRunStateNotice({
    status: 'partial',
    source: 'native',
    integrityStatus: 'snapshot_only',
    capabilities: {
      can_retry: false,
      retry_disabled_reason: 'snapshot_only_report'
    },
    executionSummary: { completed: 1, failed: 1, pending: 0 }
  });
  const imported = getRunStateNotice({
    status: 'completed',
    source: 'imported',
    integrityStatus: 'complete',
    capabilities: {
      can_retry: false,
      retry_disabled_reason: 'imported_report_read_only'
    },
    executionSummary: { completed: 2, failed: 0, pending: 0 }
  });

  assert.equal(snapshot.title, '历史报告仅保留快照');
  assert.match(snapshot.description, /不能重试/);
  assert.doesNotMatch(snapshot.description, /可以重试/);
  assert.equal(imported.title, '导入的只读报告');
  assert.match(imported.description, /不能暂停、继续或重试/);
});

test('运行、暂停、完成和失败提示不互相矛盾', () => {
  const base = {
    source: 'native',
    integrityStatus: 'complete',
    executionSummary: { completed: 2, failed: 1, pending: 3 }
  };
  const running = getRunStateNotice({
    ...base,
    status: 'running',
    capabilities: { can_pause: true }
  });
  const paused = getRunStateNotice({
    ...base,
    status: 'paused',
    capabilities: { can_resume: true }
  });
  const completed = getRunStateNotice({
    ...base,
    status: 'completed',
    capabilities: {}
  });
  const failed = getRunStateNotice({
    ...base,
    status: 'failed',
    capabilities: { can_retry: true }
  });

  assert.equal(running.title, '问题集仍在运行');
  assert.doesNotMatch(running.description, /已暂停|运行已结束/);
  assert.equal(paused.title, '运行已暂停');
  assert.doesNotMatch(paused.description, /自动更新|运行已结束/);
  assert.equal(completed.title, '本次运行已完成');
  assert.doesNotMatch(completed.description, /自动更新|已暂停/);
  assert.equal(failed.title, '本次运行失败');
  assert.match(failed.description, /可以重试失败项/);
});

test('暂停收尾明确说明正在执行与等待处理数量', () => {
  const notice = getRunStateNotice({
    status: 'paused',
    controlState: 'pausing',
    source: 'native',
    integrityStatus: 'complete',
    capabilities: { can_resume: true },
    executionSummary: {
      completed: 4,
      failed: 0,
      pending: 6,
      executing: 2,
      queued: 4
    }
  });

  assert.equal(notice.title, '正在暂停，等待已启动任务收尾');
  assert.match(notice.description, /正在执行 2 条，等待处理 4 条/);
  assert.match(notice.description, /不会再启动新的等待任务/);
  assert.match(notice.description, /可以点击“继续运行”恢复/);
});
