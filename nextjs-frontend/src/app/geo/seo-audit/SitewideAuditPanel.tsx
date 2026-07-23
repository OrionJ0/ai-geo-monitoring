// @ts-nocheck
'use client';

import React from 'react';
import {
  CheckCircleFilled,
  ExclamationCircleFilled,
  QuestionCircleFilled
} from '@ant-design/icons';
import styles from './seo-audit.module.css';

const CHECK_LABELS = {
  'duplicate-titles': '重复页面标题',
  'duplicate-descriptions': '重复 Meta 描述',
  'canonical-conflicts': 'Canonical 冲突与聚类',
  redirects: '重定向链与循环',
  'broken-links': '失效内链与外链',
  'orphan-pages': '孤儿页面',
  hreflang: 'hreflang 国际化声明',
  'sitemap-coverage': 'Sitemap 与可访问页面差异',
  'javascript-rendering': 'JavaScript 渲染抽样'
};

const STATUS_LABELS = {
  passed: '通过',
  failed: '需处理',
  unknown: '证据不足'
};

function safeReportUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function StatusIcon({ status }) {
  if (status === 'passed') return <CheckCircleFilled aria-hidden="true" />;
  if (status === 'failed') return <ExclamationCircleFilled aria-hidden="true" />;
  return <QuestionCircleFilled aria-hidden="true" />;
}

function ChangeColumn({ title, items, tone }) {
  return (
    <div className={`${styles.sitewideChange} ${styles[`sitewideChange_${tone}`]}`}>
      <strong>{title}</strong>
      <span>{items.length}</span>
      {items.length ? (
        <ul>
          {items.slice(0, 5).map((item) => (
            <li key={item.key || `${item.id}-${item.url}`}>
              <b>{item.title || item.id}</b>
              {item.url ? <small>{item.url}</small> : null}
            </li>
          ))}
        </ul>
      ) : <small>无</small>}
    </div>
  );
}

export default function SitewideAuditPanel({ sitewide, comparison }) {
  if (!sitewide) return null;
  const checks = Array.isArray(sitewide.checks) ? sitewide.checks : [];
  const change = comparison || {
    status: 'no_baseline',
    added: [],
    resolved: [],
    persisting: [],
    unverified: []
  };
  const comparisonLabel = change.status === 'compared'
    ? `对比报告 #${change.previous_audit_id || '-'}`
    : change.status === 'partial'
      ? `部分对比报告 #${change.previous_audit_id || '-'}，证据不足项不判定为已解决`
      : change.status === 'not_comparable'
        ? '审计版本或覆盖范围不同，本次不做问题增减判断'
        : '首次审计，暂无可比基线';

  return (
    <section className={styles.sitewidePanel} aria-labelledby="sitewide-audit-title">
      <header className={styles.sectionHeading}>
        <div>
          <span className={styles.sectionKicker}>全站专项审计</span>
          <h2 id="sitewide-audit-title">跨页关系与真实渲染</h2>
        </div>
        <span className={styles.issueCount}>{sitewide.issues?.length || 0} 类问题</span>
      </header>
      <p className={styles.sitewideNote}>
        这些检查独立于 v4 技术健康分，覆盖跨页重复、链接关系、Sitemap 库存和浏览器渲染证据。
      </p>

      <div className={styles.sitewideCheckGrid}>
        {checks.map((check) => (
          <article key={check.id} className={styles[`sitewide_${check.status}`]}>
            <header>
              <span><StatusIcon status={check.status} /></span>
              <div>
                <h3>{CHECK_LABELS[check.id] || check.title}</h3>
                <small>{STATUS_LABELS[check.status] || check.status}</small>
              </div>
            </header>
            <strong>{check.finding}</strong>
            <p>{check.value}</p>
            {(check.affectedPages || []).length ? (
              <div className={styles.sitewideUrls}>
                {check.affectedPages.slice(0, 4).map((url) => {
                  const href = safeReportUrl(url);
                  return href
                    ? <a key={url} href={href} target="_blank" rel="noreferrer">{url}</a>
                    : <span key={url}>{url}</span>;
                })}
                {check.affectedPages.length > 4
                  ? <span>另有 {check.affectedPages.length - 4} 个页面</span>
                  : null}
              </div>
            ) : null}
            {check.recommendation ? <small>建议：{check.recommendation}</small> : null}
          </article>
        ))}
      </div>

      <div className={styles.sitewideComparison}>
        <header>
          <div>
            <span className={styles.sectionKicker}>审计变化</span>
            <h3>本次与上次问题差异</h3>
          </div>
          <small>
            {comparisonLabel}
          </small>
        </header>
        <div>
          <ChangeColumn title="新增问题" items={change.added || []} tone="added" />
          <ChangeColumn title="已解决" items={change.resolved || []} tone="resolved" />
          <ChangeColumn title="持续存在" items={change.persisting || []} tone="persisting" />
          <ChangeColumn title="本次未验证" items={change.unverified || []} tone="unverified" />
        </div>
      </div>
    </section>
  );
}
