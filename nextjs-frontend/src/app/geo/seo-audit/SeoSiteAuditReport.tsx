// @ts-nocheck
'use client';

import React from 'react';
import { CheckCircleFilled, ClockCircleOutlined, ExclamationCircleFilled } from '@ant-design/icons';
import SearchPlatformPanel from './SearchPlatformPanel';
import CrawlerAccessPanel from './CrawlerAccessPanel';
import TechnicalHealthOverview from './TechnicalHealthOverview';
import StageChecksPanel from './StageChecksPanel';
import SitewideAuditPanel from './SitewideAuditPanel';
import { buildPriorityContent } from '@/utils/seoStagePresentation.cjs';
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
  const issues = buildPriorityContent(report);
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

      <TechnicalHealthOverview report={report} />

      <section className={styles.priorityPanel}>
        <header className={styles.sectionHeading}>
          <div><span className={styles.sectionKicker}>行动清单</span><h2>优先修复内容</h2></div>
          <span className={styles.issueCount}>{issues.length} 类问题</span>
        </header>
        {issues.length === 0 ? (
          <div className={styles.allPassed}><CheckCircleFilled /> 当前没有需要优先处理的问题</div>
        ) : (
          <ol className={styles.siteIssueList}>
            {issues.map((item, index) => (
              <li key={item.id} className={`${styles.siteIssue} ${styles[`rail_${item.severity}`]}`}>
                <span className={styles.priorityNumber}>{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <span className={styles.prioritySubject}>{item.sourceLabel} · {item.title}</span>
                  <div className={styles.priorityTitle}>
                    <strong>{item.finding || `${item.title}未通过`}</strong>
                    <SeverityBadge severity={item.severity} />
                  </div>
                  <div className={styles.issueMetrics}>
                    <span>{item.stageLabel || '其他问题'}</span>
                    {item.sourceKind === 'technical' ? (
                      <>
                        <span>覆盖率 {Math.round(Number(item.coverage || 0) * 100)}%</span>
                        <span>{item.affectsHomepage ? '影响首页' : '不影响首页'}</span>
                        <strong>
                          {item.deduction === null || item.deduction === undefined
                            ? item.cap ? `分数上限 ${item.cap}` : '旧版未记录扣分'
                            : `实际扣分 ${Number(item.deduction).toFixed(2)}`}
                        </strong>
                      </>
                    ) : (
                      <>
                        <span>
                          {item.sourceKind === 'platform'
                            ? `${item.platforms?.length || 0} 个平台需处理`
                            : `${item.count || item.affectedPages?.length || 0} 个页面受影响`}
                        </span>
                        <strong>专项提示，不计入技术健康分</strong>
                      </>
                    )}
                  </div>
                  <p className={styles.siteIssueScope}>
                    {item.sourceKind === 'platform'
                      ? '检查站点首页提供给搜索平台的所有权验证标签'
                      : `影响 ${item.count || item.affectedPages?.length || 0} / ${item.applicablePages || report.site.auditedPages} 个适用页面`}
                  </p>
                  <div className={styles.priorityFact}>
                    <span>检测事实</span>
                    <p>{item.findings?.[0]?.value || item.value || item.finding || '未返回事实数据'}</p>
                  </div>
                  {item.platforms?.length > 0 && (
                    <div className={styles.priorityPlatformList}>
                      {item.platforms.map((platform) => (
                        <span key={platform.key}>
                          <b>{platform.label}</b>
                          {platform.status === 'empty' ? '标签内容为空' : '标签缺失'}
                          <code>{platform.tag}</code>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className={styles.affectedUrls}>
                    {(item.affectedPages || []).slice(0, 6).map((url) => (
                      <a key={url} href={url} target="_blank" rel="noreferrer">{url}</a>
                    ))}
                    {(item.affectedPages?.length || 0) > 6 && <span>另有 {item.affectedPages.length - 6} 个页面</span>}
                  </div>
                  {item.detailHref && (
                    <a className={styles.priorityDetailLink} href={item.detailHref}>查看下方详细证据</a>
                  )}
                  {item.recommendation && <p className={styles.priorityRecommendation}>建议：{item.recommendation}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

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
