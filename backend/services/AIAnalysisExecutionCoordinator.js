class AIAnalysisExecutionQueueError extends Error {
  constructor(message = 'AI 分析队列已满，请稍后重试') {
    super(message);
    this.name = 'AIAnalysisExecutionQueueError';
    this.code = 'analysis_queue_full';
    this.retryable = true;
  }
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

class AIAnalysisExecutionCoordinator {
  constructor(options = {}) {
    this.concurrency = boundedInteger(
      options.concurrency ?? process.env.AI_ANALYSIS_CONCURRENCY,
      2,
      1,
      10
    );
    this.queueLimit = boundedInteger(
      options.queueLimit ?? process.env.AI_ANALYSIS_QUEUE_LIMIT,
      100,
      1,
      1000
    );
    this.active = 0;
    this.queue = [];
  }

  snapshot() {
    return {
      active: this.active,
      queued: this.queue.length,
      concurrency: this.concurrency,
      queue_limit: this.queueLimit
    };
  }

  run(work) {
    if (typeof work !== 'function') return Promise.reject(new TypeError('analysis work is required'));
    if (this.active < this.concurrency) return this.execute(work);
    if (this.queue.length >= this.queueLimit) {
      return Promise.reject(new AIAnalysisExecutionQueueError());
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ work, resolve, reject });
    });
  }

  execute(work, resolve = null, reject = null) {
    this.active += 1;
    const execution = Promise.resolve().then(work);
    const result = resolve ? execution.then(resolve, reject) : execution;
    return result.finally(() => {
      this.active -= 1;
      this.drain();
    });
  }

  drain() {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const next = this.queue.shift();
      this.execute(next.work, next.resolve, next.reject).catch(() => {});
    }
  }
}

module.exports = new AIAnalysisExecutionCoordinator();
module.exports.AIAnalysisExecutionCoordinator = AIAnalysisExecutionCoordinator;
module.exports.AIAnalysisExecutionQueueError = AIAnalysisExecutionQueueError;
