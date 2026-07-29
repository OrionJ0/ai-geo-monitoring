// @ts-nocheck
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from '@/lib/axiosConfig';
import {
  boundedPercent,
  formatScaled,
  groupDigits,
} from '@/utils/marketingValues.cjs';
import styles from './marketing.module.css';

const stateCopy = {
  FRESH: '快照新鲜',
  STALE: '快照已陈旧',
  NONE: '尚无快照',
  ZERO: '已同步，当前范围为零数据',
  DATA: '已有完整快照',
  ACTIVE: '绑定正常',
  BLOCKED: '绑定需处理',
  CONNECTED: '来源已连接',
  ACTION_REQUIRED: '来源需处理',
  DISCONNECTED: '来源已断开',
  NOT_CONNECTED: '尚未连接来源',
  IDLE: '当前空闲',
  QUEUED: '刷新已排队',
  RUNNING: '正在读取百度数据',
  SUCCEEDED: '最近刷新成功',
  FAILED: '最近刷新失败',
  INTERRUPTED: '最近刷新已中断',
  ARCHIVED: '项目已归档',
};

function copy(value) {
  return stateCopy[value] || value || '未知';
}

function moduleBoundary(status) {
  const code = status?.errorCode;
  const detail = code === 'MARKETING_CONTRACT_NOT_VERIFIED'
    ? '百度搜索推广真实契约仍待获批应用和测试账户核验。'
    : code === 'MARKETING_SCHEMA_MISSING'
      ? '营销数据库迁移尚未应用。'
      : status?.moduleState === 'DISABLED'
        ? '营销监控尚未启用。'
        : '营销监控配置尚未就绪。';
  return (
    <div className={styles.boundary} aria-labelledby="marketing-page-title">
      <p className={styles.eyebrow}>只读营销观察</p>
      <h1 id="marketing-page-title">营销监控</h1>
      <p>{detail}当前页面不会展示未经验证的外部数据。</p>
      <div className={styles.boundaryRule} aria-hidden="true" />
      <h2>当前边界</h2>
      <ul>
        <li>营销监控只用于观察，不在本站修改外部投放。</li>
        <li>落地页系统和销售系统尚未接入。</li>
        <li>不会展示模拟的咨询、订单或完整业务漏斗。</li>
      </ul>
      <p role="status" className={styles.notice}>
        完成百度只读契约与生产验收后，正式导航才会开放。
      </p>
    </div>
  );
}

export default function MarketingPage() {
  const [moduleStatus, setModuleStatus] = useState(null);
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [filter, setFilter] = useState({ from: '', to: '' });
  const requestVersion = useRef(0);
  const announcedRunState = useRef('');
  const autoRequestedRevision = useRef('');

  const loadDashboard = useCallback(async (targetProjectId, targetFilter = null) => {
    if (!targetProjectId) return;
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setError('');
    try {
      const response = await axios.get(
        `/api/marketing/projects/${targetProjectId}/dashboard`,
        targetFilter?.from && targetFilter?.to
          ? { params: targetFilter }
          : undefined
      );
      if (requestVersion.current !== version) return;
      setDashboard(response.data);
      if (response.data.coverage && !targetFilter) {
        setFilter({
          from: response.data.coverage.from,
          to: response.data.coverage.to,
        });
      }
    } catch (requestError) {
      if (requestVersion.current !== version) return;
      setError(
        requestError?.response?.data?.error?.message
        || '无法读取营销快照，请稍后重试。'
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
        `/api/marketing/projects/${projectId}/refresh-runs`,
        { triggerType }
      );
      setAnnouncement(copy(response.data.status));
      await loadDashboard(projectId);
    } catch (requestError) {
      setError(
        requestError?.response?.data?.error?.message
        || '无法创建刷新，请检查来源与绑定状态。'
      );
    }
  }, [loadDashboard, projectId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const statusResponse = await axios.get('/api/marketing/status');
        if (!active) return;
        setModuleStatus(statusResponse.data);
        if (statusResponse.data.moduleState !== 'READY') {
          setLoading(false);
          return;
        }
        const projectsResponse = await axios.get('/api/geo-projects');
        if (!active) return;
        const rows = projectsResponse?.data?.data
          || projectsResponse?.data
          || [];
        setProjects(Array.isArray(rows) ? rows : []);
        const queryId = new URLSearchParams(window.location.search)
          .get('project_id');
        const selected = (
          rows.find((row) => String(row.id) === String(queryId))?.id
          || rows[0]?.id
          || ''
        );
        setProjectId(String(selected));
        if (selected) await loadDashboard(String(selected));
        else setLoading(false);
      } catch (requestError) {
        if (!active) return;
        setError(
          requestError?.response?.data?.error?.message
          || '无法读取营销模块状态。'
        );
        setLoading(false);
      }
    })();
    return () => {
      active = false;
      requestVersion.current += 1;
    };
  }, [loadDashboard]);

  useEffect(() => {
    const refreshState = dashboard?.states?.refreshState;
    if (!refreshState || announcedRunState.current === refreshState) return;
    announcedRunState.current = refreshState;
    setAnnouncement(copy(refreshState));
  }, [dashboard?.states?.refreshState]);

  useEffect(() => {
    if (!dashboard || !projectId) return undefined;
    const refreshState = dashboard.states.refreshState;
    if (refreshState === 'QUEUED' || refreshState === 'RUNNING') {
      const timer = window.setTimeout(() => loadDashboard(projectId), 2000);
      return () => window.clearTimeout(timer);
    }
    const shouldAutoRefresh = (
      dashboard.states.projectState === 'ACTIVE'
      && dashboard.states.bindingSummaryState === 'ACTIVE'
      && (
        dashboard.states.snapshotContentState === 'NONE'
        || dashboard.states.snapshotFreshnessState === 'STALE'
      )
    );
    const autoKey = `${projectId}:${dashboard.revision || 'none'}`;
    if (shouldAutoRefresh && autoRequestedRevision.current !== autoKey) {
      autoRequestedRevision.current = autoKey;
      createRefresh(
        dashboard.states.snapshotContentState === 'NONE' ? 'INITIAL' : 'AUTO'
      );
    }
    return undefined;
  }, [createRefresh, dashboard, loadDashboard, projectId]);

  const maximumImpressions = useMemo(() => (
    (dashboard?.trend || []).reduce(
      (largest, row) => (
        BigInt(row.impressions) > BigInt(largest)
          ? row.impressions
          : largest
      ),
      '0'
    )
  ), [dashboard?.trend]);

  if (!moduleStatus && loading) {
    return <p role="status" className={styles.loading}>正在读取营销模块状态…</p>;
  }
  if (moduleStatus?.moduleState !== 'READY') return moduleBoundary(moduleStatus);

  const refreshBlocked = (
    dashboard?.states?.projectState !== 'ACTIVE'
    || dashboard?.states?.bindingSummaryState !== 'ACTIVE'
    || ['QUEUED', 'RUNNING'].includes(dashboard?.states?.refreshState)
  );

  return (
    <div className={styles.page} aria-labelledby="marketing-page-title">
      <div className={styles.liveRegion} aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>百度搜索 · 本地完整快照</p>
          <h1 id="marketing-page-title">营销监控</h1>
          <p>先看完整旧快照，再决定是否刷新；任何账户失败都不会混入新数据。</p>
        </div>
        <div className={styles.controls}>
          <label htmlFor="marketing-project">监控项目</label>
          <select
            id="marketing-project"
            value={projectId}
            onChange={(event) => {
              requestVersion.current += 1;
              setProjectId(event.target.value);
              setDashboard(null);
              setLoading(true);
              autoRequestedRevision.current = '';
              loadDashboard(event.target.value);
            }}
          >
            {projects.map((project) => (
              <option key={project.id} value={String(project.id)}>
                {project.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => createRefresh('MANUAL')}
            disabled={refreshBlocked}
            aria-describedby={refreshBlocked ? 'refresh-disabled-reason' : undefined}
          >
            立即刷新
          </button>
        </div>
      </header>

      {refreshBlocked && dashboard ? (
        <p id="refresh-disabled-reason" className={styles.assistiveReason}>
          {dashboard.states.projectState !== 'ACTIVE'
            ? '归档项目只能查看已保存快照。'
            : dashboard.states.bindingSummaryState !== 'ACTIVE'
              ? '先处理暂停或异常的账户绑定。'
              : '当前已有刷新正在进行。'}
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
        <p role="status" className={styles.loading}>正在读取本地快照…</p>
      ) : null}

      {dashboard ? (
        <>
          <section className={styles.ledger} aria-labelledby="snapshot-heading">
            <div>
              <p className={styles.kicker}>30 日观察账页</p>
              <h2 id="snapshot-heading">{dashboard.projectName}</h2>
              <p>
                {dashboard.coverage
                  ? `${dashboard.coverage.from} 至 ${dashboard.coverage.to}`
                  : '等待首次完整同步'}
              </p>
            </div>
            <dl className={styles.stateLedger}>
              {[
                ['项目', dashboard.states.projectState],
                ['来源', dashboard.states.sourceSummaryState],
                ['绑定', dashboard.states.bindingSummaryState],
                ['快照', dashboard.states.snapshotContentState],
                ['新鲜度', dashboard.states.snapshotFreshnessState],
                ['刷新', dashboard.states.refreshState],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{copy(value)}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className={styles.metrics} aria-label="营销指标汇总">
            <article>
              <span>展现</span>
              <strong>{groupDigits(dashboard.summary.impressions)}</strong>
            </article>
            <article>
              <span>点击</span>
              <strong>{groupDigits(dashboard.summary.clicks)}</strong>
            </article>
            <article>
              <span>广告消费</span>
              <strong>
                {formatScaled(
                  dashboard.summary.costAmountScaled,
                  dashboard.coverage?.costScale || 0,
                  dashboard.coverage?.currency || 'CNY'
                )}
              </strong>
            </article>
          </section>

          {dashboard.coverage ? (
            <form
              className={styles.dateFilter}
              onSubmit={(event) => {
                event.preventDefault();
                setLoading(true);
                loadDashboard(projectId, filter);
              }}
            >
              <fieldset>
                <legend>筛选当前本地覆盖范围</legend>
                <label>
                  开始日期
                  <input
                    type="date"
                    min={dashboard.coverage.from}
                    max={dashboard.coverage.to}
                    value={filter.from}
                    onChange={(event) => setFilter({
                      ...filter,
                      from: event.target.value,
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
                      to: event.target.value,
                    })}
                  />
                </label>
                <button type="submit">应用日期</button>
              </fieldset>
            </form>
          ) : null}

          <section className={styles.trendSection} aria-labelledby="trend-heading">
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.kicker}>逐日展现</p>
                <h2 id="trend-heading">覆盖范围内的变化</h2>
              </div>
              <p>图形只编码展现量；点击和消费在等价数据表中独立列出。</p>
            </div>
            {dashboard.trend.length ? (
              <>
                <div className={styles.bars} aria-hidden="true">
                  {dashboard.trend.map((row) => (
                    <div key={row.date} className={styles.barRow}>
                      <span>{row.date.slice(5)}</span>
                      <i
                        style={{
                          width: boundedPercent(
                            row.impressions,
                            maximumImpressions
                          ),
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div
                  className={styles.tableScroller}
                  role="region"
                  aria-label="逐日营销指标明细"
                  tabIndex={0}
                >
                  <table>
                    <caption>逐日营销指标等价数据表</caption>
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
              <p className={styles.empty}>本次完整同步成功，筛选范围内没有投放数据。</p>
            )}
          </section>

          <section className={styles.detailSection} aria-labelledby="campaign-heading">
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.kicker}>账户与推广计划</p>
                <h2 id="campaign-heading">完整明细</h2>
              </div>
              <a
                href="https://www2.baidu.com/"
                target="_blank"
                rel="noreferrer"
              >
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

          <aside className={styles.futureNote} aria-label="数据范围说明">
            <strong>数据范围说明</strong>
            <p>
              当前只观察百度搜索推广。落地页系统和销售系统尚未接入，
              页面不会用模拟咨询或订单补成完整漏斗。
            </p>
          </aside>
        </>
      ) : null}
    </div>
  );
}
