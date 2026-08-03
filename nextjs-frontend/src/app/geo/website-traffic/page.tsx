// @ts-nocheck
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from '@/lib/axiosConfig';
import useDefaultProjectContext from '@/lib/useDefaultProjectContext';
import useMarketingCapabilities from '@/lib/useMarketingCapabilities';
import { boundedPercent, groupDigits } from '@/utils/marketingValues.cjs';
import styles from '../marketing/marketing.module.css';

const ERROR_GUIDANCE = {
  TONGJI_CONNECTION_MISSING: '项目尚无可用百度授权连接，请联系管理员完成连接和绑定。',
  TONGJI_CONNECTION_AMBIGUOUS: '项目关联了多个百度连接，当前无法安全地自动选择统计站点。',
  BAIDU_TONGJI_SITE_MISSING: '当前百度连接下没有正常状态的统计站点。',
  BAIDU_TONGJI_SITE_AMBIGUOUS: '当前百度连接下存在多个正常站点，无法安全地自动选择。',
  PROJECT_ARCHIVED: '默认项目已归档，百度统计实时读取已停止。'
};

function readSafeError(requestError) {
  const code = requestError?.response?.data?.error?.code || '';
  return {
    code,
    message: ERROR_GUIDANCE[code]
      || requestError?.response?.data?.error?.message
      || '百度统计读取失败，请稍后重试。'
  };
}

export default function WebsiteTrafficPage() {
  const defaultContext = useDefaultProjectContext();
  const marketing = useMarketingCapabilities();
  const projectId = defaultContext.project?.id || '';
  const [traffic, setTraffic] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState({ code: '', message: '' });
  const [lastReadAt, setLastReadAt] = useState('');
  const requestVersion = useRef(0);

  const loadTraffic = useCallback(async (targetProjectId) => {
    if (!targetProjectId) return;
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setLoading(true);
    setError({ code: '', message: '' });
    try {
      const response = await axios.get(
        `/api/marketing/projects/${encodeURIComponent(targetProjectId)}/tongji-trend`
      );
      if (requestVersion.current !== version) return;
      setTraffic(response.data);
      setLastReadAt(new Date().toISOString());
    } catch (requestError) {
      if (requestVersion.current !== version) return;
      setTraffic(null);
      setError(readSafeError(requestError));
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (
      defaultContext.loading
      || marketing.loading
      || !projectId
      || !marketing.capabilities.trafficRead
    ) return;
    void loadTraffic(projectId);
    return () => {
      requestVersion.current += 1;
    };
  }, [
    defaultContext.loading,
    loadTraffic,
    marketing.capabilities.trafficRead,
    marketing.loading,
    projectId
  ]);

  const maximumVisitors = useMemo(() => (
    (traffic?.trend || []).reduce((largest, row) => {
      if (row.visitors == null) return largest;
      return BigInt(row.visitors) > BigInt(largest) ? row.visitors : largest;
    }, '0')
  ), [traffic?.trend]);

  if (defaultContext.loading || marketing.loading) {
    return <p role="status" className={styles.loading}>正在准备网站流量…</p>;
  }
  if (defaultContext.errorMessage) {
    return <div role="alert" className={styles.error}>{defaultContext.errorMessage}</div>;
  }
  if (!marketing.capabilities.trafficRead) {
    return (
      <p role="status" className={styles.notice}>网站流量尚未开放</p>
    );
  }

  return (
    <main className={styles.page} aria-label="网站流量">
      <p className={styles.notice}>网站流量可与广告数据同期联合观察，但不构成跨来源归因。</p>
      <div className={styles.pageActions} aria-label="数据操作">
        <div className={styles.controlsCompact}>
          <button
            type="button"
            disabled={loading}
            onClick={() => loadTraffic(projectId)}
          >
            {loading ? '正在读取…' : '刷新网站流量'}
          </button>
        </div>
      </div>

      {error.message ? (
        <div className={styles.error} role="alert">
          <span>
            {error.message}
            {error.code ? `（${error.code}）` : ''}
          </span>
          <button type="button" onClick={() => loadTraffic(projectId)}>
            重试读取
          </button>
        </div>
      ) : null}
      {loading && !traffic ? (
        <p role="status" className={styles.loading}>正在读取百度统计…</p>
      ) : null}

      {traffic ? (
        <>
          <section className={styles.ledger} aria-labelledby="traffic-source-heading">
            <div>
              <h2 id="traffic-source-heading">{traffic.site.domain}</h2>
              <p>{traffic.coverage.from} 至 {traffic.coverage.to}</p>
            </div>
            <dl className={styles.stateLedger}>
              <div>
                <dt>来源</dt>
                <dd>百度统计</dd>
              </div>
              <div>
                <dt>读取方式</dt>
                <dd>{traffic.mode === 'LIVE_PILOT' ? '实时试点' : '实时只读'}</dd>
              </div>
              <div>
                <dt>数据状态</dt>
                <dd>{traffic.dataState === 'DATA' ? '已有数据' : '无数据标记'}</dd>
              </div>
              <div>
                <dt>站点 ID</dt>
                <dd>{traffic.site.siteId}</dd>
              </div>
              <div>
                <dt>本次读取</dt>
                <dd>{new Date(lastReadAt).toLocaleString('zh-CN')}</dd>
              </div>
            </dl>
          </section>

          {traffic.dataState === 'NO_DATA' ? (
            <p role="status" className={styles.empty}>
              当前时间范围内百度返回无数据标记，不按 0 处理，也不推断为流量下降。
            </p>
          ) : null}

          {traffic.dataState === 'DATA' ? (
            <>
              <section className={styles.metrics} aria-label="网站流量指标汇总">
                <article>
                  <span>访客数（UV）</span>
                  <strong>
                    {traffic.summary.visitors == null
                      ? '—'
                      : groupDigits(traffic.summary.visitors)}
                  </strong>
                </article>
                <article>
                  <span>访问次数</span>
                  <strong>
                    {traffic.summary.visits == null
                      ? '—'
                      : groupDigits(traffic.summary.visits)}
                  </strong>
                </article>
                <article>
                  <span>浏览量（PV）</span>
                  <strong>
                    {traffic.summary.pageviews == null
                      ? '—'
                      : groupDigits(traffic.summary.pageviews)}
                  </strong>
                </article>
              </section>

              <section className={styles.trendSection} aria-labelledby="traffic-trend-heading">
                <div className={styles.sectionHeading}>
                  <h2 id="traffic-trend-heading">网站访问趋势</h2>
                </div>
                <div className={styles.bars} aria-hidden="true">
                  {traffic.trend.map((row) => (
                    <div key={row.date} className={styles.barRow}>
                      <span>{row.date.slice(5)}</span>
                      <i style={{
                        width: row.visitors == null
                          ? '0%'
                          : boundedPercent(row.visitors, maximumVisitors)
                      }} />
                    </div>
                  ))}
                </div>
                <div
                  className={styles.tableScroller}
                  role="region"
                  aria-label="百度统计逐日指标"
                  tabIndex={0}
                >
                  <table>
                    <caption>百度统计逐日数据表</caption>
                    <thead>
                      <tr>
                        <th scope="col">日期</th>
                        <th scope="col">访客数（UV）</th>
                        <th scope="col">访问次数</th>
                        <th scope="col">浏览量（PV）</th>
                      </tr>
                    </thead>
                    <tbody>
                      {traffic.trend.map((row) => (
                        <tr key={row.date}>
                          <th scope="row">{row.date}</th>
                          <td>{row.visitors == null ? '—' : groupDigits(row.visitors)}</td>
                          <td>{row.visits == null ? '—' : groupDigits(row.visits)}</td>
                          <td>{row.pageviews == null ? '—' : groupDigits(row.pageviews)}</td>
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
