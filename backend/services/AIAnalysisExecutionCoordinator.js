class AIAnalysisExecutionQueueError extends Error {
  constructor({
    message = 'AI 分析队列已满，请稍后重试',
    code = 'analysis_queue_full',
    retryAfterSeconds = 1
  } = {}) {
    super(message);
    this.name = 'AIAnalysisExecutionQueueError';
    this.code = code;
    this.retryable = true;
    this.status = 503;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

const DEFAULT_QUEUE_TIMEOUT_MS = 40 * 60 * 1000;
const MAX_QUEUE_TIMEOUT_MS = 120 * 60 * 1000;

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
    this.queueTimeoutMs = options.queueTimeoutMs !== undefined
      ? boundedInteger(options.queueTimeoutMs, DEFAULT_QUEUE_TIMEOUT_MS, 1000, MAX_QUEUE_TIMEOUT_MS)
      : boundedInteger(
          process.env.AI_ANALYSIS_QUEUE_TIMEOUT_MS,
          DEFAULT_QUEUE_TIMEOUT_MS,
          DEFAULT_QUEUE_TIMEOUT_MS,
          MAX_QUEUE_TIMEOUT_MS
        );
    this.now = options.now || Date.now;
    this.eventLogger = options.eventLogger || ((event) => {
      console.warn(`AI_ANALYSIS_QUEUE_EVENT ${JSON.stringify(event)}`);
    });
    this.active = 0;
    this.queue = [];
    this.shuttingDown = false;
    this.drainWaiters = [];
    this.metrics = {
      accepted: 0,
      started: 0,
      completed: 0,
      failed: 0,
      rejected: 0,
      timed_out: 0,
      peak_active: 0,
      peak_queued: 0,
      total_wait_ms: 0,
      total_execution_ms: 0
    };
  }

  snapshot() {
    return {
      active: this.active,
      queued: this.queue.length,
      concurrency: this.concurrency,
      queue_limit: this.queueLimit,
      queue_timeout_ms: this.queueTimeoutMs,
      accepting: !this.shuttingDown,
      ...this.metrics
    };
  }

  run(work) {
    if (typeof work !== 'function') return Promise.reject(new TypeError('analysis work is required'));
    if (this.shuttingDown) {
      return Promise.reject(new AIAnalysisExecutionQueueError({
        message: 'AI 分析服务正在关闭，请稍后重试',
        code: 'analysis_queue_shutdown'
      }));
    }
    if (this.active < this.concurrency) {
      this.metrics.accepted += 1;
      return this.execute({ work, queuedAt: this.now() });
    }
    if (this.queue.length >= this.queueLimit) {
      this.metrics.rejected += 1;
      this.eventLogger({
        event: 'analysis_queue_rejected',
        error_code: 'analysis_queue_full',
        active: this.active,
        queued: this.queue.length,
        rejected_total: this.metrics.rejected
      });
      return Promise.reject(new AIAnalysisExecutionQueueError());
    }
    this.metrics.accepted += 1;
    return new Promise((resolve, reject) => {
      const item = { work, resolve, reject, queuedAt: this.now(), timer: null };
      item.timer = setTimeout(() => {
        const index = this.queue.indexOf(item);
        if (index === -1) return;
        this.queue.splice(index, 1);
        this.metrics.timed_out += 1;
        this.eventLogger({
          event: 'analysis_queue_timeout',
          error_code: 'analysis_queue_timeout',
          active: this.active,
          queued: this.queue.length,
          timed_out_total: this.metrics.timed_out
        });
        item.reject(new AIAnalysisExecutionQueueError({
          message: 'AI 分析排队超时，请稍后重试',
          code: 'analysis_queue_timeout'
        }));
        this.resolveDrainWaiters();
      }, this.queueTimeoutMs);
      this.queue.push(item);
      this.metrics.peak_queued = Math.max(this.metrics.peak_queued, this.queue.length);
    });
  }

  execute(item) {
    if (item.timer) clearTimeout(item.timer);
    const startedAt = this.now();
    this.metrics.started += 1;
    this.metrics.total_wait_ms += Math.max(0, startedAt - item.queuedAt);
    this.active += 1;
    this.metrics.peak_active = Math.max(this.metrics.peak_active, this.active);
    const execution = Promise.resolve().then(item.work);
    const result = execution.then(
      (value) => {
        this.metrics.completed += 1;
        if (item.resolve) item.resolve(value);
        return value;
      },
      (error) => {
        this.metrics.failed += 1;
        if (item.reject) item.reject(error);
        throw error;
      }
    );
    return result.finally(() => {
      this.metrics.total_execution_ms += Math.max(0, this.now() - startedAt);
      this.active -= 1;
      this.pump();
      this.resolveDrainWaiters();
    });
  }

  pump() {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const next = this.queue.shift();
      this.execute(next).catch(() => {});
    }
  }

  beginShutdown() {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    const queued = this.queue.splice(0);
    queued.forEach((item) => {
      if (item.timer) clearTimeout(item.timer);
      item.reject(new AIAnalysisExecutionQueueError({
        message: 'AI 分析服务正在关闭，请稍后重试',
        code: 'analysis_queue_shutdown'
      }));
    });
    this.resolveDrainWaiters();
  }

  resolveDrainWaiters() {
    if (this.active !== 0 || this.queue.length !== 0) return;
    this.drainWaiters.splice(0).forEach((resolve) => resolve());
  }

  drain() {
    if (this.active === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.drainWaiters.push(resolve));
  }
}

module.exports = new AIAnalysisExecutionCoordinator();
module.exports.AIAnalysisExecutionCoordinator = AIAnalysisExecutionCoordinator;
module.exports.AIAnalysisExecutionQueueError = AIAnalysisExecutionQueueError;
module.exports.MAX_QUEUE_TIMEOUT_MS = MAX_QUEUE_TIMEOUT_MS;
module.exports.DEFAULT_QUEUE_TIMEOUT_MS = DEFAULT_QUEUE_TIMEOUT_MS;
