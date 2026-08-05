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

  async read(input) {
    const current = await this.dashboardService.read({
      projectId: input.projectId
    });
    if (!this.shouldRefresh(current)) {
      if (input.from === undefined && input.to === undefined) return current;
      return this.dashboardService.read(input);
    }
    const key = String(input.projectId);
    const lastFailureAt = this.failedRefreshes.get(key);
    const coolingDown = Number.isFinite(lastFailureAt)
      && this.clock() - lastFailureAt < this.failedRefreshCooldownMs;
    if (!coolingDown) {
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
