const FAILED_REFRESH_COOLDOWN_MS = 60 * 1000;

class MarketingOnDemandDashboardService {
  constructor({
    dashboardService,
    refreshService,
    executeRefresh,
    clock = () => Date.now(),
    failedRefreshCooldownMs = FAILED_REFRESH_COOLDOWN_MS
  }) {
    this.dashboardService = dashboardService;
    this.refreshService = refreshService;
    this.executeRefresh = executeRefresh;
    this.clock = clock;
    this.failedRefreshCooldownMs = failedRefreshCooldownMs;
    this.refreshes = new Map();
    this.failedRefreshes = new Map();
    if (
      !Number.isSafeInteger(failedRefreshCooldownMs)
      || failedRefreshCooldownMs < 1_000
      || failedRefreshCooldownMs > 10 * 60 * 1000
    ) throw new TypeError('营销按需刷新失败冷却时间无效');
  }

  assertAccess(input) {
    return this.dashboardService.assertAccess(input);
  }

  shouldRefresh(dashboard) {
    return (
      dashboard.states.projectState === 'ACTIVE'
      && dashboard.states.sourceSummaryState === 'CONNECTED'
      && dashboard.states.bindingSummaryState === 'ACTIVE'
      && ['NA', 'STALE'].includes(
        dashboard.states.snapshotFreshnessState
      )
    );
  }

  async refresh(projectId) {
    const key = String(projectId);
    if (!this.refreshes.has(key)) {
      const refresh = (async () => {
        const run = await this.refreshService.createRun({
          projectId,
          triggerType: 'ON_DEMAND',
          userId: null
        });
        try {
          return await this.executeRefresh(run.runId);
        } catch (error) {
          // rejectQueuedRun 是 CAS：只有仍处于 QUEUED 的运行会被释放，
          // 执行已开始或已失败到终态的运行不会被覆盖。
          await this.refreshService.rejectQueuedRun(
            run.runId,
            error?.code || 'MARKETING_EXECUTOR_REJECTED'
          );
          throw error;
        }
      })().finally(() => this.refreshes.delete(key));
      this.refreshes.set(key, refresh);
    }
    return this.refreshes.get(key);
  }

  enqueueBackgroundRefresh(runId, key) {
    if (this.refreshes.has(key)) return;
    const refresh = (async () => {
      try {
        return await this.executeRefresh(runId);
      } catch (error) {
        await this.refreshService.rejectQueuedRun(
          runId,
          error?.code || 'MARKETING_EXECUTOR_REJECTED'
        );
        this.failedRefreshes.set(key, this.clock());
        throw error;
      }
    })().finally(() => this.refreshes.delete(key));
    this.refreshes.set(key, refresh);
    // 后台刷新失败已由失败冷却承担，这里吞掉 rejection 避免进程告警。
    refresh.catch(() => {});
  }

  async read(input) {
    let current;
    let deferredFilterError = null;
    try {
      current = await this.dashboardService.read(input);
    } catch (error) {
      const hasDateFilter = input.from !== undefined || input.to !== undefined;
      if (
        !hasDateFilter
        || ![
          'DASHBOARD_DATE_OUT_OF_RANGE',
          'DASHBOARD_FILTER_WITHOUT_SNAPSHOT'
        ].includes(error?.code)
      ) {
        throw error;
      }
      deferredFilterError = error;
      current = await this.dashboardService.read({
        projectId: input.projectId
      });
      if (!this.shouldRefresh(current)) throw error;
    }
    if (!this.shouldRefresh(current)) return current;
    const key = String(input.projectId);
    const lastFailureAt = this.failedRefreshes.get(key);
    const coolingDown = Number.isFinite(lastFailureAt)
      && this.clock() - lastFailureAt < this.failedRefreshCooldownMs;
    if (coolingDown) {
      if (deferredFilterError) throw deferredFilterError;
      return current;
    }
    const defaultWindow = input.from === undefined && input.to === undefined;
    if (current.revision && defaultWindow) {
      // 默认窗口且有旧快照：后台刷新，立即返回旧快照，避免首页白等百度；
      // 本次响应携带刚创建的 activeRun 供前端轮询刷新结果。
      try {
        const run = await this.refreshService.createRun({
          projectId: input.projectId,
          triggerType: 'ON_DEMAND',
          userId: null
        });
        this.enqueueBackgroundRefresh(run.runId, key);
        this.failedRefreshes.delete(key);
        return {
          ...current,
          activeRun: {
            runId: run.runId,
            status: run.status,
            coverage: run.coverage
          }
        };
      } catch (error) {
        this.failedRefreshes.set(key, this.clock());
      }
    } else {
      // 无快照（首载）或带筛选读取：同步刷新，保证结果一致。
      try {
        await this.refresh(input.projectId);
        this.failedRefreshes.delete(key);
      } catch (error) {
        this.failedRefreshes.set(key, this.clock());
        if (!current.revision) throw error;
      }
    }
    return this.dashboardService.read(input);
  }
}

module.exports = {
  MarketingOnDemandDashboardService
};
