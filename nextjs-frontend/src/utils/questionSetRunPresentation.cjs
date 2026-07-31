const PDF_TABLE_CONTENT_WIDTH = 880;
const PDF_COLUMN_WIDTHS = Object.freeze({
  question: 275,
  platform: 155,
  status: 80,
  brand: 150,
  rank: 60,
  citations: 70,
  sentiment: 90
});

const FAILURE_STAGE_LABELS = Object.freeze({
  monitoring_request: '监测平台调用',
  monitoring_response: '监测响应处理',
  analysis_request: '结构化分析调用',
  analysis_validation: '结构化分析校验',
  analysis_retry_context: '分析重试上下文',
  retry_dispatch: '重试调度',
  worker_exception: '执行器异常',
  recovery: '任务恢复',
  unknown: '未分类阶段'
});

const CAPABILITY_REASON_MESSAGES = Object.freeze({
  imported_report_read_only: '这是导入的只读报告，不能暂停、继续或重试。',
  snapshot_only_report: '这份旧报告仅保留了快照，底层运行记录不完整，因此不能重试失败项。',
  run_records_missing: '运行记录不完整，系统已将它收敛为失败；请保留此报告并联系管理员排查。',
  run_not_terminal: '运行尚未结束，暂不能重试失败项。',
  no_failed_records: '当前没有可重试的失败项。',
  not_running: '当前运行不处于可暂停状态。',
  not_paused: '当前运行未暂停。',
  no_pending_records: '当前没有待处理任务。'
});

function safeCount(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function formatFailureStages(failureStages) {
  if (!failureStages || typeof failureStages !== 'object' || Array.isArray(failureStages)) return '';
  return Object.entries(failureStages)
    .map(([stage, count]) => [stage, safeCount(count)])
    .filter(([, count]) => count > 0)
    .sort(([stageA, countA], [stageB, countB]) => (
      countB - countA || String(stageA).localeCompare(String(stageB))
    ))
    .map(([stage, count]) => `${FAILURE_STAGE_LABELS[stage] || stage} ${count} 条`)
    .join('、');
}

function formatSkippedPlatforms(skippedPlatforms) {
  if (!Array.isArray(skippedPlatforms)) return '';
  return skippedPlatforms
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const name = String(item.name || item.platform || '未知平台').trim();
      const message = String(item.message || '').trim();
      if (!message) return `${name}：暂不可用`;
      return message.startsWith(name) ? message : `${name}：${message}`;
    })
    .filter(Boolean)
    .join('；');
}

function getRunStateNotice({
  status,
  controlState,
  source,
  integrityStatus,
  capabilities = {},
  executionSummary = {}
}) {
  const counts = `已完成 ${safeCount(executionSummary.completed)} 条，失败 ${
    safeCount(executionSummary.failed)
  } 条，待处理 ${safeCount(executionSummary.pending)} 条。`;
  const pendingBreakdown = `正在执行 ${safeCount(executionSummary.executing)} 条，等待处理 ${
    safeCount(executionSummary.queued)
  } 条。`;
  const stages = formatFailureStages(executionSummary.failure_stages);
  const stageDescription = stages ? `主要失败阶段：${stages}。` : '';
  const retryDescription = capabilities.can_retry
    ? '可以重试失败项。'
    : (CAPABILITY_REASON_MESSAGES[capabilities.retry_disabled_reason] || '');

  if (source === 'imported') {
    return {
      type: 'info',
      title: '导入的只读报告',
      description: `${counts}${stageDescription}${CAPABILITY_REASON_MESSAGES.imported_report_read_only}`
    };
  }
  if (integrityStatus === 'snapshot_only') {
    return {
      type: 'warning',
      title: '历史报告仅保留快照',
      description: `${counts}${stageDescription}${CAPABILITY_REASON_MESSAGES.snapshot_only_report}`
    };
  }
  if (integrityStatus === 'missing_records') {
    return {
      type: 'error',
      title: '运行记录不完整',
      description: `${counts}${stageDescription}${CAPABILITY_REASON_MESSAGES.run_records_missing}`
    };
  }

  if (status === 'running') {
    return {
      type: 'info',
      title: '问题集仍在运行',
      description: `${counts}报告会自动更新。`
    };
  }
  if (controlState === 'pausing') {
    const nextStep = capabilities.can_resume
      ? '可以点击“继续运行”恢复。'
      : (CAPABILITY_REASON_MESSAGES[capabilities.resume_disabled_reason] || '');
    return {
      type: 'warning',
      title: '正在暂停，等待已启动任务收尾',
      description: `${counts}${pendingBreakdown}系统不会再启动新的等待任务；已启动任务完成后将完全暂停。${nextStep}`
    };
  }
  if (status === 'paused') {
    const nextStep = capabilities.can_resume
      ? '可以点击“继续运行”恢复。'
      : (CAPABILITY_REASON_MESSAGES[capabilities.resume_disabled_reason] || '');
    return {
      type: 'warning',
      title: '运行已暂停',
      description: `${counts}${nextStep}`
    };
  }
  if (status === 'partial') {
    return {
      type: 'warning',
      title: '本次运行部分完成',
      description: `${counts}${stageDescription}${retryDescription}`
    };
  }
  if (status === 'failed') {
    return {
      type: 'error',
      title: '本次运行失败',
      description: `${counts}${stageDescription}${retryDescription}`
    };
  }
  return {
    type: 'success',
    title: '本次运行已完成',
    description: counts
  };
}

module.exports = {
  PDF_TABLE_CONTENT_WIDTH,
  PDF_COLUMN_WIDTHS,
  FAILURE_STAGE_LABELS,
  CAPABILITY_REASON_MESSAGES,
  formatFailureStages,
  formatSkippedPlatforms,
  getRunStateNotice
};
