// @ts-nocheck
'use client';

import React from 'react';
import { CheckCircleFilled, ExclamationCircleFilled } from '@ant-design/icons';
import styles from './seo-audit.module.css';

const STATUS_COPY = {
  detected: '已检测到',
  missing: '缺失',
  empty: '内容为空',
};

export default function SearchPlatformPanel({ platforms = [] }) {
  if (!platforms.length) return null;
  return (
    <section className={styles.platformSection} aria-labelledby="platform-status-title">
      <header>
        <div>
          <span className={styles.sectionKicker}>平台接入信号</span>
          <h2 id="platform-status-title">搜索平台验证标签</h2>
        </div>
        <p>统一检查站点首页 HTML 标签；标签存在不等于平台后台当前验证成功。</p>
      </header>
      <div className={styles.platformGrid}>
        {platforms.map((platform) => {
          const detected = platform.status === 'detected';
          return (
            <article key={platform.key} className={detected ? styles.platformDetected : styles.platformMissing}>
              <div className={styles.platformStatusIcon}>
                {detected ? <CheckCircleFilled aria-label="已检测到" /> : <ExclamationCircleFilled aria-label="未通过" />}
              </div>
              <div>
                <span>{platform.label}</span>
                <strong>{STATUS_COPY[platform.status] || '未检测到'}</strong>
                <code>{platform.tag}</code>
                <small title={platform.content || ''}>{platform.content || '未发现非空 content'}</small>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
