const REAUTHORIZATION_CODES = new Set(['894062', '894063', '894064']);

class BaiduMarketingError extends Error {
  constructor(message, code, status = 502, retryable = false) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

class BaiduContractBlockedError extends BaiduMarketingError {
  constructor() {
    super(
      '百度营销契约尚未达到可运行状态',
      'BAIDU_CONTRACT_NOT_RUNNABLE',
      503
    );
  }
}

function isReauthorizationCode(value) {
  return REAUTHORIZATION_CODES.has(String(value));
}

module.exports = {
  BaiduContractBlockedError,
  BaiduMarketingError,
  isReauthorizationCode
};
