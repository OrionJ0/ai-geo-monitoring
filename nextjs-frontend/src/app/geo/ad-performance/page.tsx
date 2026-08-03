// @ts-nocheck
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from '@/lib/axiosConfig';
import useDefaultProjectContext from '@/lib/useDefaultProjectContext';
import useMarketingCapabilities from '@/lib/useMarketingCapabilities';
import {
  boundedPercent,
  formatScaled,
  groupDigits
} from '@/utils/marketingValues.cjs';
import styles from '../marketing/marketing.module.css';

const STATE_COPY = {
  FRESH: '快照新鲜',
  STALE: '数据陈旧',
  NONE: '尚无快照',
  ZERO: '已同步，当前范围为零数据',
  DATA: '已有完整快照',
  ACTIVE: '正常',
  BLOCKED: '需处理',
  CONNECTED: '已连接',
  ACTION_REQUIRED: '需处理',
  DISCONNECTED: '已断开',
  NOT_CONNECTED: '尚未连接',
  IDLE: '当前空闲',
  QUEUED: '刷新已排队',
  RUNNING: '正在读取百度数据',
  SUCCEEDED: '最近刷新成功',
  FAILED: '最近刷新失败',
  INTERRUPTED: '最近刷新已中断',
  ARCHIVED: '项目已归档'
};

function stateCopy(value) {
  return STATE_COPY[value] || value || '未知';
}

export default function AdPerformancePage() {
  const defaultContext = useDefaultProjectContext();
  const marketing = useMarketingCapabilities();
  const projectId = defaultContext.project?.id || '';
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [filter, setFilter] = useState({ from: '', to: '' });
  const requestVersion = useRef(0);
  const announcedRunState = useRef('');
  const autoRequestedRevision = useRef('');

  const loadDashboard = useCallback(async (
    targetProjectId,
    targetFilter = null
  ) => {
    if (!targetProjectId) return;
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setLoading(true);
    setError('');
    try {
      const response = await axios.get(
        `/api/marketing/projects/${encodeURIComponent(targetProjectId)}/dashboard`,
        targetFilter?.from && targetFilter?.to
          ? { params: targetFilter }
          : undefined
      );
      if (requestVersion.current !== version) return;
      setDashboard(response.data);
      if (response.data.coverage && !targetFilter) {
        setFilter({
          from: response.data.coverage.from,
          to: response.data.coverage.to
        });
      }
    } catch (requestError) {
      if (requestVersion.current !== version) return;
      setError(
        requestError?.response?.data?.error?.message
        || '无法读取广告快照，请稍后重试。'
      );
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }, []);

  const createRefresh = useCallback(async (triggerType) => {
    if (!projectId) return;
    setError('');
    try {
      const response = await axios.post(
        `/api/marketing/projects/${encodeURIComponent(projectId)}/refresh-runs`,
        { triggerType }
      );
      setAnnouncement(stateCopy(response.data.status));
      await loadDashboard(projectId);
    } catch (requestError) {
      setError(
        requestError?.response?.data?.error?.message
        || '无法创建刷新，请检查来源授权与账户绑定。'
      );
    }
  }, [loadDashboard, projectId]);

  useEffect(() => {
    if (
      defaultContext.loading
      || marketing.loading
      || !projectId
      || !marketing.capabilities.adsRead
    ) return;
    setDashboard(null);
    autoRequestedRevision.current = '';
    void loadDashboard(projectId);
    return () => {
      requestVersion.current += 1;
    };
  }, [
    defaultContext.loading,
    loadDashboard,
    marketing.capabilities.adsRead,
    marketing.loading,
    projectId
  ]);

  useEffect(() => {
    const refreshState = dashboard?.states?.refreshState;
    if (!refreshState || announcedRunState.current === refreshState) return;
    announcedRunState.current = refreshState;
    setAnnouncement(stateCopy(refreshState));
  }, [dashboard?.states?.refreshState]);

  useEffect(() => {
    if (!dashboard || !projectId) return undefined;
    const refreshState = dashboard.states.refreshState;
    if (['QUEUED', 'RUNNING'].includes(refreshState)) {
      const timer = window.setTimeout(() => loadDashboard(projectId), 2000);
      return () => window.clearTimeout(timer);
    }
    const refreshNeeded = (
      dashboard.states.projectState === 'ACTIVE'
      && dashboard.states.bindingSummaryState === 'ACTIVE'
      && (
        dashboard.states.snapshotContentState === 'NONE'
        || dashboard.states.snapshotFreshnessState === 'STALE'
      )
    );
    const autoKey = `${projectId}:${dashboard.revision || 'none'}`;
    if (refreshNeeded && autoRequestedRevision.current !== autoKey) {
      autoRequestedRevision.current = autoKey;
      void createRefresh(
        dashboard.states.snapshotContentState === 'NONE' ? 'INITIAL' : 'AUTO'
      );
    }
    return undefined;
  }, [createRefresh, dashboard, loadDashboard, projectId]);

  const maximumImpressions = useMemo(() => (
    (dashboard?.trend || []).reduce(
      (largest, row) => (
        BigInt(row.impressions) > BigInt(largest) ? row.impressions : largest
      ),
      '0'
    )
  ), [dashboard?.trend]);

  if (defaultContext.loading || marketing.loading) {
    return <p role="status" className={styles.loading}>正在准备广告表现…</p>;
  }
  if (defaultContext.errorMessage) {
    return (
      <div role="alert" className={styles.error}>
        {defaultContext.errorMessage}
      </div>
    );
  }
  if (!marketing.capabilities.adsRead) {
    return (
      <p role="status" className={styles.notice}>广告数据尚未开放</p>
    );
  }

  const refreshBlocked = (
    dashboard?.states?.projectState !== 'ACTIVE'
    || dashboard?.states?.bindingSummaryState !== 'ACTIVE'
    || ['QUEUED', 'RUNNING'].includes(dashboard?.states?.refreshState)
  );
  const hasSnapshot = (
    dashboard
    && dashboard.states.snapshotContentState !== 'NONE'
    && dashboard.coverage
  );

  return (
    <main className={styles.page} aria-label="广告表现">
      <div className={styles.liveRegion} aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      <div className={styles.pageActions} aria-label="数据操作">
        <div className={styles.controlsCompact}>
          <button
            type="button"
            onClick={() => createRefresh('MANUAL')}
            disabled={refreshBlocked}
            aria-describedby={refreshBlocked ? 'ad-refresh-disabled-reason' : undefined}
          >
            立即刷新
          </button>
        </div>
      </div>

      {dashboard?.states?.snapshotFreshnessState === 'STALE' ? (
        <p role="status" className={styles.notice}>
          当前展示的是最后一次完整快照；后台刷新完成前不会混入部分新数据。
        </p>
      ) : null}
      {refreshBlocked && dashboard ? (
        <p id="ad-refresh-disabled-reason" className={styles.assistiveReason}>
          {dashboard.states.projectState !== 'ACTIVE'
            ? '归档项目只能查看已保存快照。'
            : dashboard.states.bindingSummaryState !== 'ACTIVE'
              ? '请由管理员处理暂停或异常的账户绑定。'
              : '当前已有刷新正在进行，不会重复创建。'}
        </p>
      ) : null}
      {error ? (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => loadDashboard(projectId)}>
            重试读取
          </button>
        </div>
      ) : null}
      {loading && !dashboard ? (
        <p role="status" className={styles.loading}>正在读取本地广告快照…</p>
      ) : null}

      {dashboard ? (
        <>
          <section className={styles.ledger} aria-labelledby="ad-snapshot-heading">
            <div>
              <h2 id="ad-snapshot-heading">{dashboard.projectName}</h2>
              <p>
                {dashboard.coverage
                  ? `${dashboard.coverage.from} 至 ${dashboard.coverage.to}`
                  : '等待首次完整同步'}
              </p>
              <p>
                最后成功：
                {dashboard.coverage?.lastSuccessfulAt
                  ? new Date(dashboard.coverage.lastSuccessfulAt).toLocaleString('zh-CN')
                  : '尚无'}
              </p>
            </div>
            <dl className={styles.stateLedger}>
              {[
                ['项目', dashboard.states.projectState],
                ['来源', dashboard.states.sourceSummaryState],
                ['账户绑定', dashboard.states.bindingSummaryState],
                ['快照内容', dashboard.states.snapshotContentState],
                ['数据新鲜度', dashboard.states.snapshotFreshnessState],
                ['刷新任务', dashboard.states.refreshState]
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{stateCopy(value)}</dd>
                </div>
              ))}
            </dl>
          </section>

          {dashboard.states.snapshotContentState === 'NONE' ? (
            <p className={styles.empty}>
              尚无成功快照。来源和绑定正常时，系统会显式创建首次只读刷新。
            </p>
          ) : null}

          {hasSnapshot ? (
            <>
              <section className={styles.metrics} aria-label="广告指标汇总">
                <article>
                  <span>广告消费</span>
                  <strong>
                    {formatScaled(
                      dashboard.summary.costAmountScaled,
                      dashboard.coverage.costScale,
                      dashboard.coverage.currency
                    )}
                  </strong>
                </article>
                <article>
                  <span>展现</span>
                  <strong>{groupDigits(dashboard.summary.impressions)}</strong>
                </article>
                <article>
                  <span>点击</span>
                  <strong>{groupDigits(dashboard.summary.clicks)}</strong>
                </article>
              </section>

              <p className={styles.notice}>
                覆盖 {dashboard.bindings.length} 个百度账户；
                推广计划按账户标识与计划 ID 联合区分。
              </p>

              <form
                className={styles.dateFilter}
                onSubmit={(event) => {
                  event.preventDefault();
                  void loadDashboard(projectId, filter);
                }}
              >
                <fieldset>
                  <legend>筛选当前快照覆盖范围</legend>
                  <label>
                    开始日期
                    <input
                      type="date"
                      min={dashboard.coverage.from}
                      max={dashboard.coverage.to}
                      value={filter.from}
                      onChange={(event) => setFilter({
                        ...filter,
                        from: event.target.value
                      })}
                    />
                  </label>
                  <label>
                    结束日期
                    <input
                      type="date"
                      min={dashboard.coverage.from}
                      max={dashboard.coverage.to}
                      value={filter.to}
                      onChange={(event) => setFilter({
                        ...filter,
                        to: event.target.value
                      })}
                    />
                  </label>
                  <button type="submit">应用日期</button>
                </fieldset>
              </form>

              <section className={styles.trendSection} aria-labelledby="ad-trend-heading">
                <div className={styles.sectionHeading}>
                  <h2 id="ad-trend-heading">广告趋势</h2>
                </div>
                {dashboard.trend.length ? (
                  <>
                    <div className={styles.bars} aria-hidden="true">
                      {dashboard.trend.map((row) => (
                        <div key={row.date} className={styles.barRow}>
                          <span>{row.date.slice(5)}</span>
                          <i style={{
                            width: boundedPercent(
                              row.impressions,
                              maximumImpressions
                            )
                          }} />
                        </div>
                      ))}
                    </div>
                    <div
                      className={styles.tableScroller}
                      role="region"
                      aria-label="逐日广告指标明细"
                      tabIndex={0}
                    >
                      <table>
                        <caption>逐日广告指标等价数据表</caption>
                        <thead>
                          <tr>
                            <th scope="col">日期</th>
                            <th scope="col">展现</th>
                            <th scope="col">点击</th>
                            <th scope="col">广告消费</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dashboard.trend.map((row) => (
                            <tr key={row.date}>
                              <th scope="row">{row.date}</th>
                              <td>{groupDigits(row.impressions)}</td>
                              <td>{groupDigits(row.clicks)}</td>
                              <td>
                                {formatScaled(
                                  row.costAmountScaled,
                                  dashboard.coverage.costScale,
                                  dashboard.coverage.currency
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <p className={styles.empty}>
                    本次完整同步成功，筛选范围内没有投放数据。
                  </p>
                )}
              </section>

              <section className={styles.detailSection} aria-labelledby="campaign-heading">
                <div className={styles.sectionHeading}>
                  <h2 id="campaign-heading">完整明细</h2>
                  <a href="https://www2.baidu.com/" target="_blank" rel="noreferrer">
                    前往百度营销（将离开本站）
                  </a>
                </div>
                <div
                  className={styles.tableScroller}
                  role="region"
                  aria-label="推广计划完整明细"
                  tabIndex={0}
                >
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">百度账户</th>
                        <th scope="col">推广计划 ID / 名称</th>
                        <th scope="col">展现</th>
                        <th scope="col">点击</th>
                        <th scope="col">广告消费</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.campaigns.map((campaign) => (
                        <tr key={`${campaign.accountId}:${campaign.campaignId}`}>
                          <td>{campaign.accountId}</td>
                          <td>
                            <code>{campaign.campaignId}</code>
                            <span>{campaign.campaignName}</span>
                          </td>
                          <td>{groupDigits(campaign.impressions)}</td>
                          <td>{groupDigits(campaign.clicks)}</td>
                          <td>
                            {formatScaled(
                              campaign.costAmountScaled,
                              dashboard.coverage.costScale,
                              dashboard.coverage.currency
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
