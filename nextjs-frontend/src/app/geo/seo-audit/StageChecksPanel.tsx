// @ts-nocheck
'use client';

import React, { useMemo, useState } from 'react';
import { Segmented } from 'antd';
import { CheckCircleFilled, ExclamationCircleFilled } from '@ant-design/icons';
import { buildStageGroups } from '@/utils/seoStagePresentation.cjs';
import styles from './seo-audit.module.css';

const FILTER_OPTIONS = [
  { label: '全部', value: 'all' },
  { label: '优先处理', value: 'urgent' },
  { label: '一般问题', value: 'normal' },
  { label: '已通过', value: 'passed' },
];

const SEVERITY_LABELS = {
  critical: '严重',
  high: '高优先级',
  medium: '中优先级',
  low: '建议优化',
};

const STAGE_DESCRIPTIONS = {
  access: '页面能否被稳定访问、发现和抓取。',
  index: '页面是否具备进入搜索索引的技术资格。',
  content: '搜索引擎能否理解页面主题、结构与语言。',
  enhancement: '移动体验、图片语义和增强展示信息是否完整。',
};

function stageStatus(groups, stageKey) {
  const stage = groups.find((item) => item.key === stageKey);
  const failed = stage?.checks.filter((check) => check.status === 'failed').length || 0;
  return {
    total: stage?.checks.length || 0,
    failed,
  };
}

function SeverityBadge({ severity }) {
  return (
    <span className={`${styles.severityBadge} ${styles[`severity_${severity}`]}`}>
      {SEVERITY_LABELS[severity] || '需要处理'}
    </span>
  );
}

function CheckFact({ check, isSite }) {
  if (isSite && check.status === 'passed') {
    return <p className={styles.stageCheckFact}>本次检测范围未发现该项问题。</p>;
  }
  return (
    <p className={styles.stageCheckFact}>
      {check.value || check.findings?.[0]?.value || check.finding || '未返回事实数据'}
    </p>
  );
}

export default function StageChecksPanel({ report }) {
  const [filter, setFilter] = useState('all');
  const allGroups = useMemo(() => buildStageGroups(report), [report]);
  const filteredGroups = useMemo(() => (
    buildStageGroups(report, filter).filter((stage) => stage.checks.length > 0)
  ), [filter, report]);
  const isSite = report.mode === 'site';

  if (report.scoreModel !== 'technical-health-v4' || allGroups.length === 0) return null;

  return (
    <section className={styles.stageChecksPanel} aria-labelledby="stage-checks-title">
      <header className={styles.stageChecksHeader}>
        <div>
          <span className={styles.sectionKicker}>检测明细</span>
          <h2 id="stage-checks-title">四阶段检测项目</h2>
          <p>四阶段是评分与修复顺序的唯一分类；每个检测项只属于一个阶段。</p>
        </div>
        <div className={styles.filterControl}>
          <label id="stage-filter-label">按状态筛选</label>
          <Segmented
            aria-labelledby="stage-filter-label"
            options={FILTER_OPTIONS}
            value={filter}
            onChange={setFilter}
          />
        </div>
      </header>

      <div className={styles.stageCheckGrid}>
        {filteredGroups.map((stage) => {
          const counts = stageStatus(allGroups, stage.key);
          const stageIndex = allGroups.findIndex((item) => item.key === stage.key);
          return (
            <article
              key={stage.key}
              className={`${styles.stageCheckCard} ${styles[`stage_${stage.key}`]}`}
            >
              <header>
                <span className={styles.stageSequence}>{String(stageIndex + 1).padStart(2, '0')}</span>
                <div>
                  <h3>{stage.label}</h3>
                  <p>{STAGE_DESCRIPTIONS[stage.key]}</p>
                </div>
                <div className={styles.stageCheckCount}>
                  <strong>{counts.total}</strong>
                  <span>{counts.failed ? `${counts.failed} 项未通过` : '全部通过'}</span>
                </div>
              </header>

              <div className={styles.stageCheckRows}>
                {stage.checks.map((check) => (
                  <div key={check.id} className={styles.stageCheckRow}>
                    <span className={check.status === 'failed' ? styles.failedIcon : styles.passedIcon}>
                      {check.status === 'failed'
                        ? <ExclamationCircleFilled aria-label="未通过" />
                        : <CheckCircleFilled aria-label="已通过" />}
                    </span>
                    <div>
                      <div className={styles.checkTitle}>
                        <strong>{check.title}</strong>
                        {check.status === 'failed'
                          ? <SeverityBadge severity={check.severity} />
                          : <span className={styles.passedBadge}>通过</span>}
                      </div>
                      <p className={styles.stageCheckDescription}>{check.description}</p>
                      <CheckFact check={check} isSite={isSite} />
                      {check.status === 'failed' && isSite && (
                        <div className={styles.stageCheckMetrics}>
                          <span>覆盖率 {Math.round(Number(check.coverage || 0) * 100)}%</span>
                          <span>
                            影响 {check.count || check.affectedPages?.length || 0}
                            {' / '}
                            {check.applicablePages || report.site?.auditedPages || 0} 页
                          </span>
                          {check.deduction !== null && check.deduction !== undefined && (
                            <strong>扣 {Number(check.deduction).toFixed(2)} 分</strong>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </div>

      {filteredGroups.length === 0 && (
        <div className={styles.emptyFilter}>当前筛选条件下没有检测项。</div>
      )}
    </section>
  );
}
