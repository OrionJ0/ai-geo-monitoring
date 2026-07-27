const SAFE_EMPTY_RESPONSE_MESSAGE = '监测平台返回内容为空';
const SAFE_METRIC_FAILURE_MESSAGE = '指标生成失败，请稍后重试';
const SAFE_PLATFORM_FAILURE_MESSAGE = '监测平台调用失败，请稍后重试';
const SAFE_PARSING_FAILURE_MESSAGE = '回答处理失败，请稍后重试';

const FAILURE_STAGE_LABELS = {
  platform_request: '监测平台请求',
  session_ready_checked: '网页登录状态检查',
  new_conversation_verified: '新会话创建',
  generation_finished: '网页回答生成',
  analysis_request: '结构化分析请求',
  analysis_validation: '结构化分析校验',
  analysis_retry_context: '结构化分析重试',
  metric_persist: '指标保存',
  retry_dispatch: '重试调度'
};

function formatHistoryErrorMessage(value) {
  const text = String(value || '').trim();
  if (!text) return '-';
  if (text === SAFE_EMPTY_RESPONSE_MESSAGE || text === 'AI 平台返回内容为空') return SAFE_EMPTY_RESPONSE_MESSAGE;
  if (text === SAFE_METRIC_FAILURE_MESSAGE) return text;
  if (text === SAFE_PLATFORM_FAILURE_MESSAGE || text === 'AI 平台调用失败，请稍后重试') return SAFE_PLATFORM_FAILURE_MESSAGE;
  if (/指标生成失败/i.test(text)) return SAFE_METRIC_FAILURE_MESSAGE;
  if (/\b(401|403|api key|invalid|unauthorized|network|timeout|ECONN|ENOTFOUND)\b/i.test(text)) {
    return SAFE_PLATFORM_FAILURE_MESSAGE;
  }
  return text;
}

function formatHistoryParsingErrorMessage(value) {
  const text = String(value || '').trim();
  return text ? SAFE_PARSING_FAILURE_MESSAGE : '-';
}

function getHistoryFailurePresentation(record) {
  if (!record || record.status !== 'failed') return null;

  const originalAnswer = String(record.resultDetail?.ai_response_original || '').trim();
  const failure = record.result_summary?.failure || {};
  const stageCode = String(failure.stage || '').trim();
  const errorCode = String(failure.error_code || '').trim();
  const hasCollectedAnswer = Boolean(originalAnswer);

  return {
    title: hasCollectedAnswer ? '回答已采集，后续处理失败' : '回答采集失败',
    message: formatHistoryErrorMessage(record.error_message),
    stage: FAILURE_STAGE_LABELS[stageCode] || stageCode || '-',
    stageCode: stageCode || '-',
    errorCode: errorCode || '-',
    hasCollectedAnswer
  };
}

module.exports = {
  formatHistoryErrorMessage,
  formatHistoryParsingErrorMessage,
  getHistoryFailurePresentation
};
