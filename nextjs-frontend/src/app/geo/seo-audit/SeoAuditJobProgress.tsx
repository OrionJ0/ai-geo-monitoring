// @ts-nocheck
'use client';

import React from 'react';
import { Progress } from 'antd';
import { CheckCircleFilled, LoadingOutlined } from '@ant-design/icons';
import { calculateSeoAuditProgressPercent } from '@/utils/seoAuditProgress.cjs';
import styles from './seo-audit.module.css';

const PHASES = [
  { key: 'queued', label: '任务入队' },
  { key: 'discovering', label: '发现路由' },
  { key: 'crawling', label: '逐页检测' },
  { key: 'completed', label: '生成报告' },
];

const PHASE_INDEX = { queued: 0, running: 1, discovering: 1, crawling: 2, completed: 3, failed: 3 };

export default function SeoAuditJobProgress({ job, progress = {} }) {
  const phase = progress.phase || job?.status || 'queued';
  const currentIndex = PHASE_INDEX[phase] ?? 0;
  const discovered = Number(progress.discoveredPages || 0);
  const audited = Number(progress.auditedPages || 0);
  const failed = Number(progress.failedPages || 0);
  const percent = calculateSeoAuditProgressPercent(progress, job?.status);

  return (
    <section className={styles.jobPanel} aria-live="polite" aria-label="全站检测进度">
      <header>
        <div>
          <span className={styles.sectionKicker}>任务 #{job?.id || '—'}</span>
          <h2>{phase === 'failed' ? '检测任务未完成' : '正在绘制站点检测路径'}</h2>
        </div>
        <strong>{percent}%</strong>
      </header>
      <Progress percent={percent} showInfo={false} strokeColor="#1f4dd2" railColor="#dfe7f5" />
      <div className={styles.jobRoute}>
        {PHASES.map((item, index) => {
          const done = currentIndex > index || phase === 'completed';
          const active = currentIndex === index && phase !== 'completed';
          return (
            <div key={item.key} className={`${styles.jobRouteStep} ${done ? styles.jobRouteDone : ''} ${active ? styles.jobRouteActive : ''}`}>
              <span>{done ? <CheckCircleFilled /> : active ? <LoadingOutlined spin /> : index + 1}</span>
              <small>{item.label}</small>
            </div>
          );
        })}
      </div>
      <dl className={styles.jobStats}>
        <div><dt>已发现</dt><dd>{discovered}</dd></div>
        <div><dt>已检测</dt><dd>{audited}</dd></div>
        <div><dt>失败页面</dt><dd>{failed}</dd></div>
        <div><dt>检测上限</dt><dd>200</dd></div>
      </dl>
      {phase === 'failed' && job?.error?.message && (
        <div className={styles.jobError} role="alert">{job.error.message}</div>
      )}
      <p>发现路由数量可能持续增加；进度按当前执行阶段和已检测页数前进，不会因新增路由回退。</p>
    </section>
  );
}
