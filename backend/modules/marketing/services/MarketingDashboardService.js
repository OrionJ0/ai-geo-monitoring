const { Transaction, QueryTypes } = require('sequelize');
const { bindingFingerprint } = require('../domain/bindingFingerprint');
const { addDecimalText } = require('../domain/exactValues');
const { MarketingRefreshError } = require('./MarketingRefreshService');
const { fixedShanghaiWindow } = require('../domain/syncWindow');
const {
  parseProjectAllowlist,
  projectAllowed
} = require('../domain/projectAllowlist');

const FRESHNESS_MS = 10 * 60 * 1000;

function emptyTotals() {
  return {
    impressions: '0',
    clicks: '0',
    costAmountScaled: '0'
  };
}

function addMetric(target, row) {
  target.impressions = addDecimalText(
    target.impressions,
    row.impressions_text
  );
  target.clicks = addDecimalText(target.clicks, row.clicks_text);
  target.costAmountScaled = addDecimalText(
    target.costAmountScaled,
    row.cost_amount_scaled_text
  );
}

function aggregateRows(rows, keyOf, createItem) {
  const items = new Map();
  const dailyByItem = new WeakMap();
  for (const row of rows) {
    const key = keyOf(row);
    if (!items.has(key)) {
      const item = { ...createItem(row), trend: [] };
      items.set(key, item);
      dailyByItem.set(item, new Map());
    }
    const item = items.get(key);
    addMetric(item, row);
    const daily = dailyByItem.get(item);
    if (!daily.has(row.metric_date)) {
      const point = { date: row.metric_date, ...emptyTotals() };
      daily.set(row.metric_date, point);
      item.trend.push(point);
    }
    addMetric(daily.get(row.metric_date), row);
  }
  return [...items.values()];
}

function strictDate(value) {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/u.test(value)
  ) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

class MarketingDashboardService {
  constructor({
    sequelize,
    clock = () => Date.now(),
    allowedProjectIds = '*',
    moduleState = 'READY'
  }) {
    this.sequelize = sequelize;
    this.clock = clock;
    this.projectAllowlist = parseProjectAllowlist(allowedProjectIds);
    this.moduleState = moduleState;
  }

  async getProject(projectId, transaction) {
    const rows = await this.sequelize.query(
      `SELECT id, user_id, name, status
       FROM brand_projects
       WHERE id = :projectId
       LIMIT 1`,
      {
        replacements: { projectId },
        type: QueryTypes.SELECT,
        transaction
      }
    );
    if (!rows[0]) {
      throw new MarketingRefreshError(
        '项目不存在',
        'PROJECT_NOT_FOUND',
        404
      );
    }
    return rows[0];
  }

  async assertAccess({ projectId, user }) {
    if (!projectAllowed(this.projectAllowlist, projectId)) {
      throw new MarketingRefreshError(
        '项目不在营销监控试点范围',
        'MARKETING_PROJECT_NOT_ALLOWED',
        403
      );
    }
    const project = await this.getProject(projectId);
    if (
      user?.role !== 'admin'
      && String(project.user_id) !== String(user?.id)
    ) {
      throw new MarketingRefreshError(
        '无权查看该项目',
        'PROJECT_FORBIDDEN',
        403
      );
    }
    return project;
  }

  async read({ projectId, from, to }) {
    const transactionOptions = this.sequelize.getDialect() === 'postgres'
      ? {
          isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ,
          readOnly: true
        }
      : {};
    return this.sequelize.transaction(
      transactionOptions,
      async (transaction) => {
        const project = await this.getProject(projectId, transaction);
        const bindings = await this.sequelize.query(
          `SELECT b.*, c.status AS connection_status
           FROM baidu_project_bindings b
           JOIN baidu_marketing_connections c ON c.id = b.connection_id
           WHERE b.project_id = :projectId
           ORDER BY b.created_at ASC`,
          {
            replacements: { projectId },
            type: QueryTypes.SELECT,
            transaction
          }
        );
        const allActive = (
          bindings.length > 0
          && bindings.every((binding) => binding.status === 'ACTIVE')
        );
        const expectedFingerprint = allActive
          ? bindingFingerprint(bindings)
          : null;
        const successfulRuns = await this.sequelize.query(
          `SELECT *
           FROM baidu_marketing_refresh_runs
           WHERE project_id = :projectId
             AND status = 'SUCCEEDED'
           ORDER BY project_run_sequence DESC
           LIMIT 1`,
          {
            replacements: { projectId },
            type: QueryTypes.SELECT,
            transaction
          }
        );
        const latestSuccessfulRun = successfulRuns[0] || null;
        let snapshotRun = null;
        if (project.status === 'archived') {
          snapshotRun = latestSuccessfulRun;
        } else if (bindings.length > 0 && !allActive) {
          snapshotRun = latestSuccessfulRun;
        } else if (
          latestSuccessfulRun?.binding_fingerprint === expectedFingerprint
        ) {
          snapshotRun = latestSuccessfulRun;
        }
        if (!snapshotRun && (from !== undefined || to !== undefined)) {
          throw new MarketingRefreshError(
            '没有可筛选的营销快照',
            'DASHBOARD_FILTER_WITHOUT_SNAPSHOT',
            422
          );
        }

        let filter = null;
        let metrics = [];
        let adGroupMetrics = [];
        let keywordMetrics = [];
        let searchTermMetrics = [];
        if (snapshotRun) {
          const requestedFrom = from ?? snapshotRun.coverage_start;
          const requestedTo = to ?? snapshotRun.coverage_end;
          if (
            !strictDate(requestedFrom)
            || !strictDate(requestedTo)
            || requestedFrom > requestedTo
            || requestedFrom < snapshotRun.coverage_start
            || requestedTo > snapshotRun.coverage_end
          ) {
            throw new MarketingRefreshError(
              '日期筛选超出当前快照覆盖范围',
              'DASHBOARD_DATE_OUT_OF_RANGE',
              422
            );
          }
          filter = { from: requestedFrom, to: requestedTo };
          const replacements = {
            projectId,
            runId: snapshotRun.id,
            from: requestedFrom,
            to: requestedTo
          };
          const readFacts = (table, orderBy) => this.sequelize.query(
            `SELECT *
             FROM ${table}
             WHERE project_id = :projectId
               AND refresh_run_id = :runId
               AND metric_date >= :from
               AND metric_date <= :to
             ORDER BY metric_date ASC, binding_id ASC, ${orderBy}`,
            {
              replacements,
              type: QueryTypes.SELECT,
              transaction
            }
          );
          [
            metrics,
            adGroupMetrics,
            keywordMetrics,
            searchTermMetrics
          ] = await Promise.all([
            readFacts('baidu_campaign_daily_metrics', 'campaign_id ASC'),
            readFacts(
              'baidu_ad_group_daily_metrics',
              'campaign_id ASC, ad_group_id ASC'
            ),
            readFacts(
              'baidu_keyword_daily_metrics',
              'campaign_id ASC, ad_group_id ASC, keyword_id ASC'
            ),
            readFacts(
              'baidu_search_term_daily_metrics',
              'campaign_id ASC, ad_group_id ASC, search_term_key ASC'
            )
          ]);
        }

        const activeRuns = await this.sequelize.query(
          `SELECT *
           FROM baidu_marketing_refresh_runs
           WHERE project_id = :projectId
             AND status IN ('QUEUED', 'RUNNING')
           ORDER BY project_run_sequence DESC
           LIMIT 1`,
          {
            replacements: { projectId },
            type: QueryTypes.SELECT,
            transaction
          }
        );
        const lastRuns = await this.sequelize.query(
          `SELECT *
           FROM baidu_marketing_refresh_runs
           WHERE project_id = :projectId
           ORDER BY project_run_sequence DESC
           LIMIT 1`,
          {
            replacements: { projectId },
            type: QueryTypes.SELECT,
            transaction
          }
        );
        return this.present({
          project,
          bindings,
          snapshotRun,
          metrics,
          adGroupMetrics,
          keywordMetrics,
          searchTermMetrics,
          filter,
          activeRun: activeRuns[0] || null,
          lastRun: lastRuns[0] || null
        });
      }
    );
  }

  present({
    project,
    bindings,
    snapshotRun,
    metrics,
    adGroupMetrics,
    keywordMetrics,
    searchTermMetrics,
    filter,
    activeRun,
    lastRun
  }) {
    const summary = emptyTotals();
    const daily = new Map();
    for (const row of metrics) {
      addMetric(summary, row);
      if (!daily.has(row.metric_date)) {
        daily.set(row.metric_date, {
          date: row.metric_date,
          ...emptyTotals()
        });
      }
      addMetric(daily.get(row.metric_date), row);
    }
    const campaigns = aggregateRows(
      metrics,
      (row) => [
        row.external_account_id,
        row.campaign_id
      ].join('\u0000'),
      (row) => ({
          accountId: row.external_account_id,
          campaignId: row.campaign_id,
          campaignName: row.campaign_name,
          ...emptyTotals()
      })
    );
    const adGroups = aggregateRows(
      adGroupMetrics,
      (row) => [
        row.external_account_id,
        row.campaign_id,
        row.ad_group_id
      ].join('\u0000'),
      (row) => ({
        accountId: row.external_account_id,
        campaignId: row.campaign_id,
        campaignName: row.campaign_name,
        adGroupId: row.ad_group_id,
        adGroupName: row.ad_group_name,
        ...emptyTotals()
      })
    );
    const keywords = aggregateRows(
      keywordMetrics,
      (row) => [
        row.external_account_id,
        row.campaign_id,
        row.ad_group_id,
        row.keyword_id
      ].join('\u0000'),
      (row) => ({
        accountId: row.external_account_id,
        campaignId: row.campaign_id,
        campaignName: row.campaign_name,
        adGroupId: row.ad_group_id,
        adGroupName: row.ad_group_name,
        keywordId: row.keyword_id,
        keywordName: row.keyword_name,
        targetingType: row.targeting_type,
        ...emptyTotals()
      })
    );
    const searchTerms = aggregateRows(
      searchTermMetrics,
      (row) => [
        row.external_account_id,
        row.campaign_id,
        row.ad_group_id,
        row.search_term_key
      ].join('\u0000'),
      (row) => ({
        accountId: row.external_account_id,
        campaignId: row.campaign_id,
        campaignName: row.campaign_name,
        adGroupId: row.ad_group_id,
        adGroupName: row.ad_group_name,
        keywordName: row.keyword_name,
        searchTerm: row.search_term,
        queryStatus: row.query_status,
        matchType: row.match_type,
        ...emptyTotals()
      })
    );
    const blocked = bindings.some((binding) => (
      binding.status !== 'ACTIVE'
      || binding.connection_status !== 'CONNECTED'
    ));
    const connected = bindings.filter(
      (binding) => binding.connection_status === 'CONNECTED'
    );
    const lastSuccessfulAt = snapshotRun?.finished_at || null;
    const currentWindow = fixedShanghaiWindow(this.clock());
    const coverageRolled = (
      project.status === 'active'
      && snapshotRun
      && (snapshotRun.coverage_start !== currentWindow.from
        || snapshotRun.coverage_end !== currentWindow.to)
    );
    const stale = coverageRolled || (
      lastSuccessfulAt
        ? this.clock() - new Date(lastSuccessfulAt).getTime() > FRESHNESS_MS
        : false
    );
    const refreshState = activeRun?.status || lastRun?.status || 'IDLE';
    return {
      projectId: String(project.id),
      projectName: project.name,
      revision: snapshotRun?.id || null,
      states: {
        moduleState: this.moduleState,
        projectState: project.status === 'archived' ? 'ARCHIVED' : 'ACTIVE',
        sourceSummaryState: !bindings.length
          ? 'NOT_CONNECTED'
          : blocked
            ? (
                connected.length
                  ? 'ACTION_REQUIRED'
                  : 'DISCONNECTED'
              )
            : 'CONNECTED',
        bindingSummaryState: !bindings.length
          ? 'NONE'
          : blocked ? 'BLOCKED' : 'ACTIVE',
        snapshotContentState: snapshotRun?.snapshot_content_state || 'NONE',
        snapshotFreshnessState: snapshotRun
          ? (stale ? 'STALE' : 'FRESH')
          : 'NA',
        refreshState
      },
      bindings: bindings.map((binding) => ({
        bindingId: binding.id,
        accountId: binding.external_account_id,
        accountName: binding.external_account_name,
        sourceState: binding.connection_status,
        bindingState: binding.status,
        blockingCode: binding.paused_reason
          || (binding.connection_status !== 'CONNECTED'
            ? 'SOURCE_NOT_CONNECTED'
            : null)
      })),
      coverage: snapshotRun
        ? {
            from: snapshotRun.coverage_start,
            to: snapshotRun.coverage_end,
            lastSuccessfulAt,
            currency: snapshotRun.currency_code,
            costScale: Number(snapshotRun.cost_scale)
          }
        : null,
      filter,
      summary,
      trend: [...daily.values()],
      campaigns,
      adGroups,
      keywords,
      searchTerms,
      hierarchyCounts: {
        campaigns: campaigns.length,
        adGroups: adGroups.length,
        keywords: keywords.length,
        searchTerms: searchTerms.length
      },
      activeRun: activeRun
        ? {
            runId: activeRun.id,
            status: activeRun.status
          }
        : null,
      lastRun: lastRun
        ? {
            runId: lastRun.id,
            status: lastRun.status,
            failureCode: lastRun.failure_code || null
          }
        : null
    };
  }
}

module.exports = {
  MarketingDashboardService
};
