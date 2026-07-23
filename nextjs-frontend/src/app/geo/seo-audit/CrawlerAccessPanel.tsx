// @ts-nocheck
'use client';

import React from 'react';
import { CheckCircleFilled, CloseCircleFilled, QuestionCircleFilled } from '@ant-design/icons';
import styles from './seo-audit.module.css';

const CATEGORY_ORDER = [
  { key: 'search', label: '搜索引擎', note: '影响传统搜索抓取与发现，纳入评分。' },
  { key: 'ai-search', label: 'AI 搜索', note: '影响 AI 搜索索引与答案引用，纳入评分。' },
  { key: 'user-triggered', label: '用户触发访问', note: '由用户请求触发，robots 规则可能不适用，不计分。' },
  { key: 'ai-training', label: 'AI 训练与数据使用', note: '开放与否属于内容授权策略，不计分。' },
];

const STATUS_COPY = {
  allowed: '允许',
  blocked: '禁止',
  unknown: '无法判断',
};

const SOURCE_COPY = {
  valid: '已解析 robots.txt',
  unavailable: 'robots.txt 未提供或返回 4xx',
  empty: 'robots.txt 内容为空',
  invalid: 'robots.txt 缺少有效规则',
  unreachable: 'robots.txt 暂时无法访问',
};

function StatusIcon({ status }) {
  if (status === 'allowed') return <CheckCircleFilled aria-hidden="true" />;
  if (status === 'blocked') return <CloseCircleFilled aria-hidden="true" />;
  return <QuestionCircleFilled aria-hidden="true" />;
}

export default function CrawlerAccessPanel({ access }) {
  const crawlers = Array.isArray(access?.crawlers) ? access.crawlers : [];
  if (!crawlers.length) return null;

  const groups = CATEGORY_ORDER.map((category) => ({
    ...category,
    crawlers: crawlers.filter((crawler) => crawler.category === category.key),
  })).filter((group) => group.crawlers.length > 0);
  const scored = crawlers.filter((crawler) => crawler.affectsScore);

  return (
    <section className={styles.crawlerSection} aria-labelledby="crawler-access-title">
      <header className={styles.crawlerHeader}>
        <div>
          <span className={styles.sectionKicker}>抓取路径矩阵</span>
          <h2 id="crawler-access-title">搜索与 AI 爬虫权限</h2>
          <p>
            当前路径 <code>{access.targetPath || '/'}</code> · {SOURCE_COPY[access.sourceStatus] || 'robots.txt 状态未知'}
          </p>
        </div>
        <dl className={styles.crawlerSummary} aria-label="重要抓取 UA 权限摘要">
          <div><dt>允许</dt><dd>{scored.filter((crawler) => crawler.status === 'allowed').length}</dd></div>
          <div><dt>禁止</dt><dd>{scored.filter((crawler) => crawler.status === 'blocked').length}</dd></div>
          <div><dt>未知</dt><dd>{scored.filter((crawler) => crawler.status === 'unknown').length}</dd></div>
        </dl>
      </header>

      <p className={styles.crawlerCaveat}>
        robots 允许不等于一定收录或引用；真实访问还受页面状态、WAF、登录、IP 校验与平台抓取策略影响。
      </p>

      <div className={styles.crawlerGroups}>
        {groups.map((group) => (
          <section key={group.key} className={styles.crawlerGroup} aria-labelledby={`crawler-group-${group.key}`}>
            <header>
              <div>
                <h3 id={`crawler-group-${group.key}`}>{group.label}</h3>
                <p>{group.note}</p>
              </div>
              <span className={group.crawlers.some((crawler) => crawler.affectsScore) ? styles.scoredTag : styles.informationalTag}>
                {group.crawlers.some((crawler) => crawler.affectsScore) ? '纳入评分' : '不计分'}
              </span>
            </header>
            <div className={styles.crawlerRows}>
              {group.crawlers.map((crawler) => (
                <article key={crawler.key} className={`${styles.crawlerRow} ${styles[`crawler_${crawler.status}`]}`}>
                  <div className={styles.crawlerIdentity}>
                    <StatusIcon status={crawler.status} />
                    <div>
                      <a href={crawler.docsUrl} target="_blank" rel="noreferrer">{crawler.label}</a>
                      <code>
                        {crawler.robotsPolicy === 'control-token' ? 'robots token' : 'User-agent'}: {crawler.token}
                      </code>
                    </div>
                  </div>
                  <div className={styles.crawlerDecision}>
                    <strong>{STATUS_COPY[crawler.status] || '未知'}</strong>
                    <small>{crawler.matchedRule || '未返回命中规则'}</small>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
