const crypto = require('node:crypto');
const { QueryTypes, Transaction } = require('sequelize');
const { bindingFingerprint } = require('../domain/bindingFingerprint');
const { normalizeMetricText } = require('../domain/exactValues');
const { fixedShanghaiWindow } = require('../domain/syncWindow');

class MarketingRefreshError extends Error {
  constructor(message, code, status = 400, retryable = false) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function assertDate(value) {
  const parsed = typeof value === 'string'
    ? new Date(`${value}T00:00:00.000Z`)
    : null;
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/u.test(value)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new MarketingRefreshError(
      '报表日期无效',
      'REPORT_ROW_INVALID',
      502
    );
  }
  return value;
}

function normalizeReportRow(row, binding, coverage) {
  if (
    typeof row?.accountId !== 'string'
    || row.accountId !== binding.external_account_id
    || typeof row?.campaignId !== 'string'
    || !row.campaignId
    || typeof row?.campaignName !== 'string'
  ) {
    throw new MarketingRefreshError(
      '报表账户或推广计划字段无效',
      'REPORT_ROW_INVALID',
      502
    );
  }
  const metricDate = assertDate(row.metricDate);
  if (metricDate < coverage.from || metricDate > coverage.to) {
    throw new MarketingRefreshError(
      '报表日期超出请求覆盖范围',
      'REPORT_DATE_OUT_OF_RANGE',
      502
    );
  }
  return {
    bindingId: binding.id,
    accountId: row.accountId,
    campaignId: row.campaignId,
    campaignName: row.campaignName.slice(0, 512),
    metricDate,
    impressions: normalizeMetricText(row.impressions),
    clicks: normalizeMetricText(row.clicks),
    costAmountScaled: normalizeMetricText(row.costAmountScaled)
  };
}

class MarketingRefreshService {
  constructor({
    sequelize,
    reportProvider,
    contractVersion,
    currencyCode,
    costScale,
    clock = () => Date.now(),
    maxRows = 50000
  }) {
    this.sequelize = sequelize;
    this.reportProvider = reportProvider;
    this.contractVersion = contractVersion;
    this.currencyCode = currencyCode;
    this.costScale = costScale;
    this.clock = clock;
    this.maxRows = maxRows;
  }

  async getProject(projectId, transaction, lock = false) {
    const lockClause = (
      lock && this.sequelize.getDialect() === 'postgres'
    ) ? ' FOR UPDATE' : '';
    const projects = await this.sequelize.query(
      `SELECT id, user_id, status, name
       FROM brand_projects
       WHERE id = :projectId
       LIMIT 1${lockClause}`,
      {
        replacements: { projectId },
        type: QueryTypes.SELECT,
        transaction
      }
    );
    if (!projects[0]) {
      throw new MarketingRefreshError(
        '项目不存在',
        'PROJECT_NOT_FOUND',
        404
      );
    }
    return projects[0];
  }

  async getBindings(projectId, transaction, lock = false) {
    const lockClause = (
      lock && this.sequelize.getDialect() === 'postgres'
    ) ? ' FOR UPDATE OF b, c' : '';
    return this.sequelize.query(
      `SELECT b.*, c.status AS connection_status,
              c.auth_generation, c.token_version
       FROM baidu_project_bindings b
       JOIN baidu_marketing_connections c ON c.id = b.connection_id
       WHERE b.project_id = :projectId
       ORDER BY b.id ASC${lockClause}`,
      {
        replacements: { projectId },
        type: QueryTypes.SELECT,
        transaction
      }
    );
  }

  validateRefreshable(project, bindings) {
    if (project.status !== 'active') {
      throw new MarketingRefreshError(
        '归档项目不能刷新',
        'PROJECT_ARCHIVED',
        409
      );
    }
    if (!bindings.length) {
      throw new MarketingRefreshError(
        '项目没有百度账户绑定',
        'BINDINGS_EMPTY',
        409
      );
    }
    if (bindings.some((binding) => (
      binding.status !== 'ACTIVE'
      || binding.connection_status !== 'CONNECTED'
    ))) {
      throw new MarketingRefreshError(
        '项目存在暂停或不可用的百度绑定',
        'BINDINGS_BLOCKED',
        409
      );
    }
  }

  async createRun({ projectId, triggerType, userId = null }) {
    if (!['AUTO', 'MANUAL', 'INITIAL'].includes(triggerType)) {
      throw new MarketingRefreshError(
        '刷新触发类型无效',
        'REFRESH_TRIGGER_INVALID'
      );
    }
    const project = await this.getProject(projectId);
    const bindings = await this.getBindings(projectId);
    this.validateRefreshable(project, bindings);
    const active = await this.sequelize.query(
      `SELECT *
       FROM baidu_marketing_refresh_runs
       WHERE active_project_key = :projectId
       LIMIT 1`,
      {
        replacements: { projectId },
        type: QueryTypes.SELECT
      }
    );
    if (active[0]) return this.publicRun(active[0]);

    const id = crypto.randomUUID();
    const now = new Date(this.clock()).toISOString();
    const coverage = fixedShanghaiWindow(this.clock());
    const sequenceRows = await this.sequelize.query(
      `SELECT MAX(project_run_sequence) AS max_sequence
       FROM baidu_marketing_refresh_runs
       WHERE project_id = :projectId`,
      {
        replacements: { projectId },
        type: QueryTypes.SELECT
      }
    );
    const projectRunSequence = (
      BigInt(String(sequenceRows[0]?.max_sequence || '0')) + 1n
    ).toString();
    try {
      await this.sequelize.query(
        `INSERT INTO baidu_marketing_refresh_runs (
          id, project_id, project_run_sequence,
          trigger_type, status, active_project_key,
          execution_token, binding_fingerprint, coverage_start, coverage_end,
          contract_version, currency_code, cost_scale,
          snapshot_content_state, started_at, finished_at, next_retry_at,
          failure_code, created_by_user_id, created_at, updated_at
        ) VALUES (
          :id, :projectId, :projectRunSequence,
          :triggerType, 'QUEUED', :projectId,
          :executionToken, :fingerprint, :coverageStart, :coverageEnd,
          :contractVersion, :currencyCode, :costScale,
          NULL, NULL, NULL, NULL,
          NULL, :userId, :now, :now
        )`,
        {
          replacements: {
            id,
            projectId,
            projectRunSequence,
            triggerType,
            executionToken: crypto.randomBytes(32).toString('hex'),
            fingerprint: bindingFingerprint(bindings),
            coverageStart: coverage.from,
            coverageEnd: coverage.to,
            contractVersion: this.contractVersion,
            currencyCode: this.currencyCode,
            costScale: this.costScale,
            userId,
            now
          }
        }
      );
    } catch (error) {
      const current = await this.sequelize.query(
        `SELECT *
         FROM baidu_marketing_refresh_runs
         WHERE active_project_key = :projectId
         LIMIT 1`,
        {
          replacements: { projectId },
          type: QueryTypes.SELECT
        }
      );
      if (current[0]) return this.publicRun(current[0]);
      throw error;
    }
    return this.getRun(projectId, id);
  }

  publicRun(row) {
    return {
      runId: row.id,
      projectId: String(row.project_id),
      triggerType: row.trigger_type,
      status: row.status,
      coverage: {
        from: row.coverage_start,
        to: row.coverage_end
      },
      createdAt: row.created_at,
      startedAt: row.started_at || null,
      finishedAt: row.finished_at || null,
      failure: row.failure_code
        ? {
            code: row.failure_code,
            retryable: false,
            retryAfterAt: row.next_retry_at || null
          }
        : null
    };
  }

  async getRun(projectId, runId) {
    const rows = await this.sequelize.query(
      `SELECT *
       FROM baidu_marketing_refresh_runs
       WHERE project_id = :projectId AND id = :runId
       LIMIT 1`,
      {
        replacements: { projectId, runId },
        type: QueryTypes.SELECT
      }
    );
    if (!rows[0]) {
      throw new MarketingRefreshError(
        '刷新运行不存在',
        'REFRESH_RUN_NOT_FOUND',
        404
      );
    }
    return this.publicRun(rows[0]);
  }

  async failRun(runId, code) {
    const now = new Date(this.clock()).toISOString();
    await this.sequelize.query(
      `UPDATE baidu_marketing_refresh_runs
       SET status = 'FAILED',
           active_project_key = NULL,
           failure_code = :code,
           finished_at = :now,
           updated_at = :now
       WHERE id = :runId AND status IN ('QUEUED', 'RUNNING')`,
      { replacements: { runId, code, now } }
    );
  }

  async rejectQueuedRun(runId, code) {
    const now = new Date(this.clock()).toISOString();
    const [, affected] = await this.sequelize.query(
      `UPDATE baidu_marketing_refresh_runs
       SET status = 'FAILED',
           active_project_key = NULL,
           failure_code = :code,
           finished_at = :now,
           updated_at = :now
       WHERE id = :runId AND status = 'QUEUED'`,
      {
        replacements: { runId, code, now },
        type: QueryTypes.UPDATE
      }
    );
    return affected === 1;
  }

  async executeRun(runId) {
    const rows = await this.sequelize.query(
      `SELECT *
       FROM baidu_marketing_refresh_runs
       WHERE id = :runId
       LIMIT 1`,
      {
        replacements: { runId },
        type: QueryTypes.SELECT
      }
    );
    const run = rows[0];
    if (!run || !['QUEUED', 'RUNNING'].includes(run.status)) {
      throw new MarketingRefreshError(
        '刷新运行不可执行',
        'REFRESH_RUN_NOT_EXECUTABLE',
        409
      );
    }
    const startedAt = new Date(this.clock()).toISOString();
    const [, claimed] = await this.sequelize.query(
      `UPDATE baidu_marketing_refresh_runs
       SET status = 'RUNNING', started_at = COALESCE(started_at, :startedAt),
           updated_at = :startedAt
       WHERE id = :runId AND status = 'QUEUED'`,
      {
        replacements: { runId, startedAt },
        type: QueryTypes.UPDATE
      }
    );
    if (run.status === 'QUEUED' && claimed !== 1) {
      throw new MarketingRefreshError(
        '刷新运行已被其他执行器领取',
        'REFRESH_RUN_ALREADY_CLAIMED',
        409
      );
    }

    try {
      const project = await this.getProject(run.project_id);
      const bindings = await this.getBindings(run.project_id);
      this.validateRefreshable(project, bindings);
      if (bindingFingerprint(bindings) !== run.binding_fingerprint) {
        throw new MarketingRefreshError(
          '绑定口径已变化',
          'BINDING_FINGERPRINT_CHANGED',
          409
        );
      }
      const coverage = {
        from: run.coverage_start,
        to: run.coverage_end
      };
      const normalizedRows = [];
      const factKeys = new Set();
      for (const binding of bindings) {
        const reportRows = await this.reportProvider.fetchSearchReport({
          binding: {
            id: binding.id,
            accountId: binding.external_account_id,
            accountName: binding.external_account_name
          },
          connection: {
            id: binding.connection_id,
            authGeneration: Number(binding.auth_generation),
            tokenVersion: Number(binding.token_version)
          },
          coverage,
          contractVersion: run.contract_version
        });
        if (!Array.isArray(reportRows)) {
          throw new MarketingRefreshError(
            '报表响应无效',
            'REPORT_RESPONSE_INVALID',
            502
          );
        }
        for (const row of reportRows) {
          const normalized = normalizeReportRow(row, binding, coverage);
          const factKey = [
            normalized.bindingId,
            normalized.campaignId,
            normalized.metricDate
          ].join('\u0000');
          if (factKeys.has(factKey)) {
            throw new MarketingRefreshError(
              '报表包含重复事实',
              'REPORT_DUPLICATE_FACT',
              502
            );
          }
          factKeys.add(factKey);
          normalizedRows.push(normalized);
          if (normalizedRows.length > this.maxRows) {
            throw new MarketingRefreshError(
              '项目报表超过安全行数预算',
              'REPORT_ROW_BUDGET_EXCEEDED',
              422
            );
          }
        }
      }

      await this.commitSnapshot({ run, normalizedRows });
      return this.getRun(run.project_id, run.id);
    } catch (error) {
      await this.failRun(run.id, error?.code || 'REFRESH_FAILED');
      throw error;
    }
  }

  async commitSnapshot({ run, normalizedRows }) {
    const transactionOptions = this.sequelize.getDialect() === 'sqlite'
      ? { type: Transaction.TYPES.IMMEDIATE }
      : {};
    await this.sequelize.transaction(transactionOptions, async (transaction) => {
      const project = await this.getProject(
        run.project_id,
        transaction,
        true
      );
      const bindings = await this.getBindings(
        run.project_id,
        transaction,
        true
      );
      this.validateRefreshable(project, bindings);
      if (bindingFingerprint(bindings) !== run.binding_fingerprint) {
        throw new MarketingRefreshError(
          '绑定口径已变化',
          'BINDING_FINGERPRINT_CHANGED',
          409
        );
      }
      const currentRows = await this.sequelize.query(
        `SELECT status, active_project_key, execution_token
         FROM baidu_marketing_refresh_runs
         WHERE id = :runId
         LIMIT 1${this.sequelize.getDialect() === 'postgres'
          ? ' FOR UPDATE'
          : ''}`,
        {
          replacements: { runId: run.id },
          type: QueryTypes.SELECT,
          transaction
        }
      );
      const current = currentRows[0];
      if (
        !current
        || current.status !== 'RUNNING'
        || String(current.active_project_key) !== String(run.project_id)
        || current.execution_token !== run.execution_token
      ) {
        throw new MarketingRefreshError(
          '刷新运行提交栅栏失效',
          'REFRESH_COMMIT_FENCE_REJECTED',
          409
        );
      }
      await this.sequelize.query(
        'DELETE FROM baidu_campaign_daily_metrics WHERE project_id = :projectId',
        {
          replacements: { projectId: run.project_id },
          transaction
        }
      );
      const createdAt = new Date(this.clock()).toISOString();
      const insertRows = normalizedRows.map((metric) => ({
        id: crypto.randomUUID(),
        project_id: run.project_id,
        binding_id: metric.bindingId,
        refresh_run_id: run.id,
        metric_date: metric.metricDate,
        external_account_id: metric.accountId,
        campaign_id: metric.campaignId,
        campaign_name: metric.campaignName,
        impressions_text: metric.impressions,
        clicks_text: metric.clicks,
        cost_amount_scaled_text: metric.costAmountScaled,
        created_at: createdAt
      }));
      for (let offset = 0; offset < insertRows.length; offset += 500) {
        await this.sequelize.getQueryInterface().bulkInsert(
          'baidu_campaign_daily_metrics',
          insertRows.slice(offset, offset + 500),
          { transaction }
        );
      }
      const [, finalized] = await this.sequelize.query(
        `UPDATE baidu_marketing_refresh_runs
         SET status = 'SUCCEEDED',
             active_project_key = NULL,
             snapshot_content_state = :contentState,
             failure_code = NULL,
             finished_at = :finishedAt,
             updated_at = :finishedAt
         WHERE id = :runId
           AND status = 'RUNNING'
           AND active_project_key = :projectId
           AND execution_token = :executionToken`,
        {
          replacements: {
            runId: run.id,
            projectId: run.project_id,
            executionToken: run.execution_token,
            contentState: normalizedRows.length ? 'DATA' : 'ZERO',
            finishedAt: createdAt
          },
          transaction,
          type: QueryTypes.UPDATE
        }
      );
      if (finalized !== 1) {
        throw new MarketingRefreshError(
          '刷新运行提交栅栏失效',
          'REFRESH_COMMIT_FENCE_REJECTED',
          409
        );
      }
    });
  }
}

module.exports = {
  MarketingRefreshError,
  MarketingRefreshService,
  normalizeReportRow
};
