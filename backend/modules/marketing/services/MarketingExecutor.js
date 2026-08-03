const crypto = require('node:crypto');
const { QueryTypes } = require('sequelize');

const ownedDatabases = new WeakSet();

class MarketingExecutor {
  constructor({
    sequelize,
    refreshService,
    queueLimit = 32
  }) {
    this.sequelize = sequelize;
    this.refreshService = refreshService;
    this.queueLimit = queueLimit;
    this.queue = [];
    this.running = null;
    this.jobs = new Map();
    this.accepting = false;
    this.started = false;
  }

  async start() {
    if (ownedDatabases.has(this.sequelize)) {
      const error = new Error('营销执行器 singleton 已被占用');
      error.code = 'MARKETING_EXECUTOR_SINGLETON_UNAVAILABLE';
      throw error;
    }
    ownedDatabases.add(this.sequelize);
    try {
      const now = new Date().toISOString();
      await this.sequelize.query(
        `UPDATE baidu_marketing_refresh_runs
         SET status = 'INTERRUPTED',
             active_project_key = NULL,
             execution_token = :invalidToken,
             failure_code = 'PROCESS_RESTARTED',
             finished_at = :now,
             updated_at = :now
         WHERE status IN ('QUEUED', 'RUNNING')`,
        {
          replacements: {
            invalidToken: crypto.randomBytes(32).toString('hex'),
            now
          }
        }
      );
      this.started = true;
      this.accepting = true;
    } catch (error) {
      ownedDatabases.delete(this.sequelize);
      throw error;
    }
  }

  enqueue(runId) {
    if (
      this.running === runId
      || this.queue.includes(runId)
    ) return this.jobs.get(runId)?.promise;
    if (!this.accepting) {
      const error = new Error('营销执行器未接收新运行');
      error.code = 'MARKETING_EXECUTOR_NOT_ACCEPTING';
      throw error;
    }
    if (this.queue.length >= this.queueLimit) {
      const error = new Error('营销刷新队列已满');
      error.code = 'MARKETING_EXECUTOR_QUEUE_FULL';
      throw error;
    }
    let resolveJob;
    const promise = new Promise((resolve) => {
      resolveJob = resolve;
    });
    this.jobs.set(runId, { promise, resolve: resolveJob });
    this.queue.push(runId);
    this.drain().catch(() => {});
    return promise;
  }

  async drain() {
    if (this.running || !this.queue.length) return;
    const runId = this.queue.shift();
    this.running = runId;
    const job = this.jobs.get(runId);
    try {
      const value = await this.refreshService.executeRun(runId);
      job?.resolve({ ok: true, value });
    } catch (error) {
      // RefreshService persists the stable terminal error.
      job?.resolve({ ok: false, error });
    } finally {
      this.jobs.delete(runId);
      this.running = null;
      if (this.queue.length) setImmediate(() => this.drain().catch(() => {}));
    }
  }

  async stop() {
    this.accepting = false;
    for (const runId of this.queue) {
      this.jobs.get(runId)?.resolve({
        ok: false,
        error: Object.assign(new Error('营销执行器已停止'), {
          code: 'MARKETING_EXECUTOR_STOPPED'
        })
      });
      this.jobs.delete(runId);
    }
    this.queue = [];
    if (this.started) {
      const now = new Date().toISOString();
      await this.sequelize.query(
        `UPDATE baidu_marketing_refresh_runs
         SET status = 'INTERRUPTED',
             active_project_key = NULL,
             execution_token = :invalidToken,
             failure_code = 'APPLICATION_SHUTDOWN',
             finished_at = :now,
             updated_at = :now
         WHERE status IN ('QUEUED', 'RUNNING')`,
        {
          replacements: {
            invalidToken: crypto.randomBytes(32).toString('hex'),
            now
          },
          type: QueryTypes.UPDATE
        }
      );
    }
    if (this.started) ownedDatabases.delete(this.sequelize);
    this.started = false;
  }
}

module.exports = {
  MarketingExecutor
};
