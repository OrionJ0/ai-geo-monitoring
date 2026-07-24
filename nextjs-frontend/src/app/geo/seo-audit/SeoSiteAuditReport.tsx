// @ts-nocheck
'use client';

import React from 'react';
import { CheckCircleFilled, ClockCircleOutlined, ExclamationCircleFilled } from '@ant-design/icons';
import SearchPlatformPanel from './SearchPlatformPanel';
import CrawlerAccessPanel from './CrawlerAccessPanel';
import TechnicalHealthOverview from './TechnicalHealthOverview';
import StageChecksPanel from './StageChecksPanel';
import SitewideAuditPanel from './SitewideAuditPanel';
import { sortPriorities } from '@/utils/seoStagePresentation.cjs';
import styles from './seo-audit.module.css';

const SEVERITY_LABELS = { critical: '严重', high: '高优先级', medium: '中优先级', low: '建议优化' };

function formatDate(value) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
}

function formatDuration(value) {
  const milliseconds = Number(value || 0);
  return milliseconds >= 1000 ? `${(milliseconds / 1000).toFixed(1)} 秒` : `${milliseconds} ms`;
}

function SeverityBadge({ severity }) {
  return <span className={`${styles.severityBadge} ${styles[`severity_${severity}`]}`}>{SEVERITY_LABELS[severity]}</span>;
}

export default function SeoSiteAuditReport({ report }) {
  const pages = Array.isArray(report.pages) ? report.pages : [];
  const issues = sortPriorities(
    Array.isArray(report.priorities) ? report.priorities : report.issues || []
  );
  return (
    <div className={styles.report} aria-live="polite">
      <section className={styles.reportMeta}>
        <div>
          <span>{report.auditId ? `全站报告 #${report.auditId}` : '全站检测报告'}</span>
          <a href={report.finalUrl} target="_blank" rel="noreferrer">{report.finalUrl}</a>
        </div>
        <dl>
          <div><dt>已检测</dt><dd>{report.site.auditedPages} / {report.site.discoveredPages} 页</dd></div>
          <div><dt>失败</dt><dd>{report.site.failedPages} 页</dd></div>
          <div><dt>耗时</dt><dd>{formatDuration(report.durationMs)}</dd></div>
          <div><dt>检测时间</dt><dd>{formatDate(report.checkedAt)}</dd></div>
        </dl>
      </section>

      <section className={styles.priorityPanel}>
        <header className={styles.sectionHeading}>
          <div><span className={styles.sectionKicker}>整站问题地图</span><h2>按技术链路优先修复</h2></div>
          <span className={styles.issueCount}>{issues.length} 类问题</span>
        </header>
        {issues.length === 0 ? (
          <div className={styles.allPassed}><CheckCircleFilled /> 已检测页面的关键项均通过</div>
        ) : (
          <ol className={styles.siteIssueList}>
            {issues.map((issue, index) => (
              <li key={issue.id} className={`${styles.siteIssue} ${styles[`rail_${issue.severity}`]}`}>
                <span className={styles.priorityNumber}>{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <span className={styles.prioritySubject}>{issue.title}</span>
                  <div className={styles.priorityTitle}>
                    <strong>{issue.finding || `${issue.title}未通过`}</strong>
                    <SeverityBadge severity={issue.severity} />
                  </div>
                  <div className={styles.issueMetrics}>
                    <span>{issue.stageLabel || '旧版问题'}</span>
                    <span>覆盖率 {Math.round(Number(issue.coverage || 0) * 100)}%</span>
                    <span>{issue.affectsHomepage ? '影响首页' : '不影响首页'}</span>
                    <strong>
                      {issue.deduction === null || issue.deduction === undefined
                        ? issue.cap ? `分数上限 ${issue.cap}` : '旧版未记录扣分'
                        : `实际扣分 ${Number(issue.deduction).toFixed(2)}`}
                    </strong>
                  </div>
                  <p className={styles.siteIssueScope}>
                    影响 {issue.count || issue.affectedPages?.length || 0} / {issue.applicablePages || report.site.auditedPages} 个适用页面
                  </p>
                  <div className={styles.priorityFact}>
                    <span>检测事实</span>
                    <p>{issue.findings?.[0]?.value || issue.value || issue.finding || '未返回事实数据'}</p>
                  </div>
                  <div className={styles.affectedUrls}>
                    {(issue.affectedPages || []).slice(0, 6).map((url) => (
                      <a key={url} href={url} target="_blank" rel="noreferrer">{url}</a>
                    ))}
                    {(issue.affectedPages?.length || 0) > 6 && <span>另有 {issue.affectedPages.length - 6} 个页面</span>}
                  </div>
                  {issue.recommendation && <p className={styles.priorityRecommendation}>建议：{issue.recommendation}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <TechnicalHealthOverview report={report} />
      <StageChecksPanel report={report} />
      <SitewideAuditPanel sitewide={report.sitewide} comparison={report.comparison} />

      <SearchPlatformPanel platforms={report.platforms} />
      <CrawlerAccessPanel access={report.crawlerAccess} />

      <section className={styles.pageLedger} aria-labelledby="page-ledger-title">
        <header>
          <div><span className={styles.sectionKicker}>页面账本</span><h2 id="page-ledger-title">逐页检测结果</h2></div>
          <p>同源链接与 Sitemap 合并去重；失败页面仍保留原因。</p>
        </header>
        <div className={styles.pageLedgerRows}>
          {pages.map((page, index) => (
            <details key={page.url} className={page.status === 'failed' ? styles.pageFailed : styles.pageCompleted}>
              <summary>
                <span className={styles.pageIndex}>{String(index + 1).padStart(3, '0')}</span>
                <span className={styles.pageStatusIcon}>
                  {page.status === 'failed' ? <ExclamationCircleFilled /> : <CheckCircleFilled />}
                </span>
                <span className={styles.pageUrl}>{page.url}</span>
                <span className={styles.pageIssueCount}>{page.issues?.length || 0} 个问题</span>
                <strong>{page.status === 'failed' ? '失败' : page.score ?? '—'}</strong>
              </summary>
              <div className={styles.pageDetail}>
                {page.errorMessage && <p>失败原因：{page.errorMessage}</p>}
                {(page.issues || []).length === 0 ? <p>当前页面关键项均已通过。</p> : (
                  <ul>{page.issues.map((issue) => <li key={issue.id}><b>{issue.finding}</b><span>{issue.value}</span></li>)}</ul>
                )}
              </div>
            </details>
          ))}
        </div>
      </section>

      <footer className={styles.methodNote}>
        <ClockCircleOutlined aria-hidden="true" />
        <span>技术健康分按本次实际检测范围和问题覆盖率计算，不是 Google、Bing 或百度的官方评分，也不代表排名保证。</span>
      </footer>
    </div>
  );
}
