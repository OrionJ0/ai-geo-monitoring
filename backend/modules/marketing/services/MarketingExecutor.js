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
    ) return;
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
    this.queue.push(runId);
    this.drain().catch(() => {});
  }

  async drain() {
    if (this.running || !this.queue.length) return;
    const runId = this.queue.shift();
    this.running = runId;
    try {
      await this.refreshService.executeRun(runId);
    } catch {
      // RefreshService persists the stable terminal error.
    } finally {
      this.running = null;
      if (this.queue.length) setImmediate(() => this.drain().catch(() => {}));
    }
  }

  async stop() {
    this.accepting = false;
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
