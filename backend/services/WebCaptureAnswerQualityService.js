function compact(value) {
  return String(value || '').replace(/\s+/gu, '').trim();
}

function isDoubaoCapture({ platform, webCapture } = {}) {
  return String(platform || '').trim().toLowerCase() === 'doubao-web'
    || String(webCapture?.schema_version || '').trim() === 'doubao-web-capture-v1';
}

function transientDoubaoReason(responseText) {
  const text = String(responseText || '').trim();
  const normalized = compact(text);
  if (/^(?:(?:正在)?(?:联网)?搜索(?:中)?|(?:正在)?(?:思考|生成|分析)(?:中)?)[.…·]*$/u.test(normalized)) {
    return 'transient_search_status';
  }
  if (/^搜索\d+个关键词[，,]参考\d+篇资料/u.test(normalized)) {
    return 'transient_search_summary';
  }
  if (
    text.length <= 800
    && /(?:我|接下来我)(?:将|会)/u.test(text)
    && /(?:梳理|搜索|搜集|查找|整理|分析|对比|汇总)/u.test(text)
    && /(?:为后续|下一步)[\s\S]{0,120}(?:做准备|准备工作)/u.test(text)
  ) {
    return 'transient_planning_status';
  }
  return null;
}

function evaluate({ platform, responseText, webCapture } = {}) {
  if (webCapture?.answer_quality?.status === 'invalid') {
    return {
      status: 'invalid',
      reason_code: String(webCapture.answer_quality.reason_code || 'capture_marked_invalid')
        .slice(0, 80)
    };
  }
  if (!isDoubaoCapture({ platform, webCapture })) return { status: 'valid' };
  const reasonCode = transientDoubaoReason(responseText);
  return reasonCode
    ? { status: 'invalid', reason_code: reasonCode }
    : { status: 'valid' };
}

module.exports = {
  evaluate,
  isInvalid(input) {
    return evaluate(input).status === 'invalid';
  },
  isTransientDoubaoAnswer(responseText) {
    return Boolean(transientDoubaoReason(responseText));
  }
};
