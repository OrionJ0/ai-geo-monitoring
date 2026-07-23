// @ts-nocheck
'use client';

import React from 'react';
import {
  ExclamationCircleFilled,
  SafetyCertificateFilled,
  WarningFilled,
} from '@ant-design/icons';
import styles from './seo-audit.module.css';

const STAGE_FALLBACK = [
  { key: 'access', label: '访问与发现', budget: 30 },
  { key: 'index', label: '索引资格', budget: 25 },
  { key: 'content', label: '内容理解', budget: 30 },
  { key: 'enhancement', label: '展示与增强', budget: 15 },
];

const STATUS_LABELS = {
  blocked: '存在阻断',
  excellent: '优秀',
  healthy: '健康',
  needs_improvement: '需要改进',
  high_risk: '高风险',
  unknown: '无法判断',
};

function scoreTone(status, score) {
  if (status === 'unknown') return 'unknown';
  if (status === 'blocked' || Number(score) < 60) return 'danger';
  if (Number(score) < 80) return 'warning';
  return 'success';
}

function reportScope(report) {
  const isSite = report.mode === 'site';
  const failedChecks = Math.max(0, Number(report.summary?.total || 0) - Number(report.summary?.passed || 0));
  return [
    {
      label: '检测模式',
      value: isSite ? '全站检测' : '单页检测',
    },
    {
      label: '实际页面',
      value: isSite
        ? `${report.site?.auditedPages || 0} / 发现 ${report.site?.discoveredPages || 0}`
        : '1 页',
    },
    {
      label: '检查实例',
      value: `${report.summary?.total || 0} 项`,
    },
    {
      label: '通过 / 失败',
      value: `${report.summary?.passed || 0} / ${failedChecks}`,
    },
    {
      label: '聚合问题',
      value: `${report.summary?.issues || 0} 类`,
    },
    {
      label: '评分版本',
      value: report.scoreVersion || '旧版',
    },
  ];
}

export default function TechnicalHealthOverview({ report }) {
  const health = report.health;
  const isV4 = report.scoreModel === 'technical-health-v4' && health;
  const status = isV4 ? health.status : report.grade;
  const tone = scoreTone(status, report.score);
  const stages = isV4 && Array.isArray(health.stages) && health.stages.length
    ? health.stages
    : STAGE_FALLBACK;
  const blockers = isV4 && Array.isArray(health.blockers) ? health.blockers : [];
  const unknownReasons = isV4 && Array.isArray(health.unknownReasons) ? health.unknownReasons : [];
  const bottleneck = isV4 ? health.bottleneck : null;
  const hasScore = report.score !== null
    && report.score !== undefined
    && Number.isFinite(Number(report.score));
  const scorePercent = hasScore
    ? Math.max(0, Math.min(100, Number(report.score)))
    : 0;

  return (
    <section className={styles.healthOverview} aria-labelledby="technical-health-title">
      <div className={`${styles.healthScoreCard} ${styles[`healthTone_${tone}`]}`}>
        <span className={styles.sectionKicker}>唯一主指标</span>
        <h2 id="technical-health-title">技术健康分</h2>
        <div
          className={styles.healthScoreRing}
          role="img"
          aria-label={hasScore ? `技术健康分 ${report.score} 分，满分 100 分` : '技术健康分暂无数据'}
        >
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle className={styles.healthScoreRingTrack} cx="60" cy="60" r="52" pathLength="100" />
            <circle
              className={styles.healthScoreRingValue}
              cx="60"
              cy="60"
              r="52"
              pathLength="100"
              style={{ strokeDashoffset: 100 - scorePercent }}
            />
          </svg>
          <div className={styles.healthScoreLine}>
            <strong>{hasScore ? report.score : '—'}</strong>
            {hasScore && <span>/ 100</span>}
          </div>
        </div>
        <span className={styles.healthStatus}>{STATUS_LABELS[status] || '旧版评分'}</span>
        {isV4 ? (
          <p>
            {bottleneck
              ? <>主要瓶颈：<b>{bottleneck.label}</b></>
              : '四个技术阶段均未形成明确瓶颈'}
          </p>
        ) : (
          <p className={styles.healthLegacyNote}>旧版报告，不含阶段分。</p>
        )}
        {health?.rawScore !== null && health?.rawScore !== undefined && (
          <small>原始分 {Number(health.rawScore).toFixed(2)}</small>
        )}
      </div>

      <div className={styles.healthEvidence}>
        <header>
          <div>
            <span className={styles.sectionKicker}>评分解释</span>
            <h2>四阶段技术链路</h2>
          </div>
          <p>阶段分相加形成原始分；确定性阻断可限制最终分数上限。</p>
        </header>

        <div className={styles.healthStages}>
          {stages.map((stage) => {
            const stageScore = Number.isFinite(stage.score) ? stage.score : null;
            const percentage = stageScore === null ? 0 : Math.max(0, Math.min(100, (stageScore / stage.budget) * 100));
            return (
              <article
                key={stage.key}
                className={bottleneck?.key === stage.key ? styles.healthStageBottleneck : ''}
              >
                <div>
                  <span>{stage.label}</span>
                  <strong>{stageScore === null ? '—' : Number(stageScore.toFixed(1))}<small> / {stage.budget}</small></strong>
                </div>
                <div className={styles.healthStageTrack} aria-hidden="true">
                  <span style={{ width: `${percentage}%` }} />
                </div>
                <small>
                  {stageScore === null
                    ? '旧报告无阶段数据'
                    : stage.deduction > 0 ? `本阶段扣 ${Number(stage.deduction.toFixed(2))} 分` : '本阶段未扣分'}
                </small>
              </article>
            );
          })}
        </div>

        <dl className={styles.healthScope}>
          {reportScope(report).map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {blockers.length > 0 && (
        <div className={styles.healthBlockers} role="alert">
          <WarningFilled />
          <div>
            <strong>{blockers.length} 个确定性阻断限制了最终分数</strong>
            {blockers.map((blocker) => (
              <p key={blocker.id}>{blocker.finding} · 分数上限 {blocker.cap}</p>
            ))}
          </div>
        </div>
      )}

      {unknownReasons.length > 0 && (
        <div className={styles.healthUnknown} role="status">
          <ExclamationCircleFilled />
          <div>
            <strong>关键证据不足，暂不生成技术健康分</strong>
            {unknownReasons.map((reason) => <p key={reason}>{reason}</p>)}
          </div>
        </div>
      )}

      {report.site?.truncated && (
        <div className={styles.healthScopeLimit} role="status">
          <SafetyCertificateFilled />
          已达到 {report.site.limit} 页上限，分数只代表本次实际检测范围。
        </div>
      )}
    </section>
  );
}
