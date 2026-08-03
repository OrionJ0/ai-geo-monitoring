class MarketingOnDemandDashboardService {
  constructor({ dashboardService, refreshService, executeRefresh }) {
    this.dashboardService = dashboardService;
    this.refreshService = refreshService;
    this.executeRefresh = executeRefresh;
    this.refreshes = new Map();
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
    try {
      await this.refresh(input.projectId);
    } catch (error) {
      if (!current.revision) throw error;
    }
    return this.dashboardService.read(input);
  }
}

module.exports = {
  MarketingOnDemandDashboardService
};
