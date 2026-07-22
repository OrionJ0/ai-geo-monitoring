// @ts-nocheck
'use client';

import React, { useMemo, useState } from 'react';
import { Button, Form, Input, Progress, Segmented, Spin, message } from 'antd';
import {
  ArrowRightOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  ExclamationCircleFilled,
  GlobalOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import axios from '@/lib/axiosConfig';
import { getApiErrorMessage } from '@/utils/apiErrorMessage.cjs';
import styles from './seo-audit.module.css';

const SEVERITY_LABELS = {
  critical: '严重',
  high: '高优先级',
  medium: '中优先级',
  low: '建议优化',
};

const FILTER_OPTIONS = [
  { label: '全部', value: 'all' },
  { label: '优先处理', value: 'urgent' },
  { label: '一般问题', value: 'normal' },
  { label: '已通过', value: 'passed' },
];

function scoreColor(score) {
  if (score >= 80) return '#15803d';
  if (score >= 60) return '#d97706';
  return '#dc2626';
}

function scoreCopy(score) {
  if (score >= 90) return '基础表现优秀';
  if (score >= 75) return '整体表现良好';
  if (score >= 60) return '仍有明显提升空间';
  return '建议优先修复核心问题';
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  return bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;
}

function checkMatchesFilter(check, filter) {
  if (filter === 'urgent') return check.status === 'failed' && ['critical', 'high'].includes(check.severity);
  if (filter === 'normal') return check.status === 'failed' && ['medium', 'low'].includes(check.severity);
  if (filter === 'passed') return check.status === 'passed';
  return true;
}

function SeverityBadge({ severity }) {
  return <span className={`${styles.severityBadge} ${styles[`severity_${severity}`]}`}>{SEVERITY_LABELS[severity]}</span>;
}

export default function SeoAuditPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [filter, setFilter] = useState('all');

  const visibleCategories = useMemo(() => {
    if (!report?.categories) return [];
    return report.categories
      .map((category) => ({
        ...category,
        checks: category.checks.filter((check) => checkMatchesFilter(check, filter)),
      }))
      .filter((category) => category.checks.length > 0);
  }, [filter, report]);

  const runAudit = async ({ url }) => {
    setLoading(true);
    try {
      const response = await axios.post('/api/seo-audits', { url });
      setReport(response?.data?.data || null);
      setFilter('all');
      message.success('SEO 检测完成');
    } catch (error) {
      message.error(getApiErrorMessage(error, 'SEO 检测失败，请稍后重试'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="seo-audit-title">
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}><SearchOutlined /> 单页关键项诊断</span>
          <h1 id="seo-audit-title">先找出最影响搜索表现的问题</h1>
          <p>检测页面是否可抓取、信息是否完整、内容结构和移动体验是否达标，并按修复优先级整理成行动清单。</p>
        </div>

        <Form form={form} onFinish={runAudit} initialValues={{ url: 'https://gato.com.cn/' }} className={styles.auditForm}>
          <label className={styles.srOnly} htmlFor="seo-audit-url">需要检测的网址</label>
          <Form.Item
            name="url"
            className={styles.urlField}
            rules={[{ required: true, whitespace: true, message: '请输入需要检测的网址' }]}
          >
            <Input
              id="seo-audit-url"
              size="large"
              prefix={<GlobalOutlined aria-hidden="true" />}
              placeholder="https://example.com/page"
              autoComplete="url"
              disabled={loading}
            />
          </Form.Item>
          <Button
            type="primary"
            size="large"
            htmlType="submit"
            icon={<SearchOutlined />}
            loading={loading}
          >
            开始检测
          </Button>
        </Form>
        <div className={styles.scopeNote}>
          <SafetyCertificateOutlined aria-hidden="true" />
          当前检测单个公开页面的 19 项关键 SEO 基础项，不抓取登录页，也不会保存页面内容。
        </div>
      </section>

      {loading && !report && (
        <section className={styles.loadingPanel} aria-live="polite">
          <Spin size="large" />
          <div>
            <strong>正在读取页面并检查关键信号</strong>
            <span>包括 robots.txt、站点地图、Meta 信息、标题结构和基础响应表现</span>
          </div>
        </section>
      )}

      {!loading && !report && (
        <section className={styles.startPanel} aria-label="检测范围">
          <article>
            <span>01</span>
            <h2>能否被搜索引擎读取</h2>
            <p>检查状态码、索引指令、HTTPS、robots.txt 与站点地图。</p>
          </article>
          <article>
            <span>02</span>
            <h2>页面主题是否表达清楚</h2>
            <p>检查标题、描述、Canonical、H1 和标题层级。</p>
          </article>
          <article>
            <span>03</span>
            <h2>结果是否值得点击</h2>
            <p>检查移动适配、图片替代文本、结构化数据与分享信息。</p>
          </article>
        </section>
      )}

      {report && (
        <div className={styles.report} aria-live="polite" aria-busy={loading}>
          <section className={styles.reportMeta}>
            <div>
              <span>检测页面</span>
              <a href={report.finalUrl} target="_blank" rel="noreferrer">{report.finalUrl}</a>
            </div>
            <dl>
              <div><dt>HTTP</dt><dd>{report.statusCode}</dd></div>
              <div><dt>响应</dt><dd>{report.durationMs} ms</dd></div>
              <div><dt>HTML</dt><dd>{formatBytes(report.page?.htmlBytes)}</dd></div>
              <div><dt>检测时间</dt><dd>{formatDate(report.checkedAt)}</dd></div>
            </dl>
          </section>

          <section className={styles.reportLead}>
            <article className={styles.priorityPanel}>
              <header className={styles.sectionHeading}>
                <div>
                  <span className={styles.sectionKicker}>行动清单</span>
                  <h2>优先修复</h2>
                </div>
                <span className={styles.issueCount}>{report.summary.issues} 个问题</span>
              </header>

              {report.priorities.length === 0 ? (
                <div className={styles.allPassed}><CheckCircleFilled /> 当前关键项均已通过</div>
              ) : (
                <ol className={styles.priorityList}>
                  {report.priorities.slice(0, 6).map((item, index) => (
                    <li key={item.id} className={`${styles.priorityItem} ${styles[`rail_${item.severity}`]}`}>
                      <span className={styles.priorityNumber}>{String(index + 1).padStart(2, '0')}</span>
                      <div>
                        <div className={styles.priorityTitle}>
                          <strong>{item.title}</strong>
                          <SeverityBadge severity={item.severity} />
                        </div>
                        <p>{item.recommendation}</p>
                      </div>
                      <ArrowRightOutlined className={styles.priorityArrow} aria-hidden="true" />
                    </li>
                  ))}
                </ol>
              )}
            </article>

            <aside className={styles.scorePanel} aria-label="SEO 基础分摘要">
              <span className={styles.sectionKicker}>SEO 基础分</span>
              <Progress
                type="circle"
                percent={report.score}
                size={154}
                strokeWidth={8}
                strokeColor={scoreColor(report.score)}
                railColor="#e8edf5"
                format={(value) => <span className={styles.scoreValue}>{value}</span>}
              />
              <strong>{scoreCopy(report.score)}</strong>
              <p>按 19 项基础检查的重要性加权计算</p>
              <div className={styles.scoreStats}>
                <div><span>{report.summary.passed}</span><small>已通过</small></div>
                <div><span>{report.summary.critical + report.summary.high}</span><small>优先处理</small></div>
                <div><span>{report.summary.medium + report.summary.low}</span><small>一般问题</small></div>
              </div>
            </aside>
          </section>

          <section className={styles.checksSection} aria-labelledby="all-checks-title">
            <header className={styles.checksHeader}>
              <div>
                <span className={styles.sectionKicker}>分类结果</span>
                <h2 id="all-checks-title">逐项检测</h2>
              </div>
              <div className={styles.filterControl}>
                <label id="priority-filter-label">按优先级筛选</label>
                <Segmented
                  aria-labelledby="priority-filter-label"
                  options={FILTER_OPTIONS}
                  value={filter}
                  onChange={setFilter}
                />
              </div>
            </header>

            <div className={styles.categoryGrid}>
              {visibleCategories.map((category) => (
                <article key={category.key} className={styles.categoryCard}>
                  <header>
                    <div>
                      <h3>{category.label}</h3>
                      <span>{category.checks.length} 项当前筛选结果</span>
                    </div>
                    <div className={styles.categoryScore} style={{ color: scoreColor(category.score) }}>{category.score}</div>
                  </header>
                  <Progress percent={category.score} showInfo={false} strokeColor={scoreColor(category.score)} railColor="#edf1f6" size="small" />
                  <div className={styles.checkList}>
                    {category.checks.map((check) => (
                      <div key={check.id} className={styles.checkRow}>
                        {check.status === 'passed'
                          ? <CheckCircleFilled className={styles.passedIcon} aria-label="已通过" />
                          : <ExclamationCircleFilled className={styles.failedIcon} aria-label="未通过" />}
                        <div>
                          <div className={styles.checkTitle}>
                            <strong>{check.title}</strong>
                            {check.status === 'failed' && <SeverityBadge severity={check.severity} />}
                          </div>
                          <span className={styles.checkValue}>{check.value}</span>
                          <p>{check.description}</p>
                          {check.recommendation && <p className={styles.recommendation}>建议：{check.recommendation}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>

            {visibleCategories.length === 0 && (
              <div className={styles.emptyFilter}>当前筛选条件下没有检测项。</div>
            )}
          </section>

          <section className={styles.previewSection} aria-labelledby="preview-title">
            <header>
              <span className={styles.sectionKicker}>呈现检查</span>
              <h2 id="preview-title">搜索与分享预览</h2>
            </header>
            <div className={styles.previewGrid}>
              <article className={styles.searchPreview}>
                <span className={styles.previewLabel}>搜索结果</span>
                <small>{report.previews.search.url}</small>
                <h3>{report.previews.search.title || '页面标题未设置'}</h3>
                <p>{report.previews.search.description || '页面描述未设置，搜索引擎可能从正文中自动截取内容。'}</p>
              </article>
              <article className={styles.socialPreview}>
                <div className={styles.socialImage}>
                  {report.previews.social.image ? <span>已配置分享图片</span> : <span>暂无分享图片</span>}
                </div>
                <div>
                  <span className={styles.previewLabel}>社交分享</span>
                  <h3>{report.previews.social.title || '页面标题未设置'}</h3>
                  <p>{report.previews.social.description || '补充 Open Graph 描述可改善分享卡片。'}</p>
                </div>
              </article>
            </div>
          </section>

          <footer className={styles.methodNote}>
            <ClockCircleOutlined aria-hidden="true" />
            <span>这是面向快速修复的单页基础检测，不包含全站爬取、真实 Core Web Vitals、关键词排名或外链数据库。</span>
          </footer>
        </div>
      )}
    </main>
  );
}
