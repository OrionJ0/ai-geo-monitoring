// @ts-nocheck
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Form, Input, Progress, Segmented, Spin, message } from 'antd';
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  ExclamationCircleFilled,
  GlobalOutlined,
  HistoryOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import axios from '@/lib/axiosConfig';
import { getApiErrorMessage } from '@/utils/apiErrorMessage.cjs';
import SeoAuditHistoryDrawer from './SeoAuditHistoryDrawer';
import SeoAuditJobProgress from './SeoAuditJobProgress';
import SeoSiteAuditReport from './SeoSiteAuditReport';
import SearchPlatformPanel from './SearchPlatformPanel';
import CrawlerAccessPanel from './CrawlerAccessPanel';
import styles from './seo-audit.module.css';

const ACTIVE_JOB_KEY = 'goodie-seo-active-job';

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

const LEGACY_FAILED_FINDINGS = {
  'http-status': '页面无法正常访问',
  indexability: '页面被禁止索引',
  https: '页面未使用 HTTPS',
  'robots-txt': 'robots.txt 缺失或不可用',
  sitemap: 'Sitemap 缺失或不可用',
  canonical: 'Canonical 链接缺失',
  'heading-order': '标题层级存在跳级',
  'content-depth': '页面正文内容较少',
  'crawlable-links': '未发现可抓取链接',
  viewport: 'Viewport 配置缺失或无效',
  language: '页面语言声明缺失',
  'structured-data': 'JSON-LD 结构化数据缺失',
  'open-graph': 'Open Graph 信息不完整',
  'twitter-card': 'Twitter Card 缺失',
  'response-time': '服务器响应偏慢',
  'html-size': 'HTML 体积偏大',
};

function getCheckFinding(check) {
  if (check.finding) return check.finding;
  if (check.status === 'passed') return '符合检查要求';

  if (check.id === 'title') {
    return /未设置|0\s*字符/.test(check.value || '') ? '页面标题缺失' : '页面标题长度需要优化';
  }
  if (check.id === 'meta-description') {
    return /未设置|0\s*字符/.test(check.value || '') ? 'Meta 描述缺失' : 'Meta 描述长度需要优化';
  }
  if (check.id === 'h1') {
    return /(^|\D)0\s*个/.test(check.value || '') ? '缺少 H1' : 'H1 数量需要优化';
  }
  if (check.id === 'image-alt') {
    const match = String(check.value || '').match(/(\d+)\s*\/\s*(\d+)/);
    if (match) return `${Math.max(0, Number(match[2]) - Number(match[1]))} 张图片缺少有效 Alt`;
    return '部分图片缺少有效 Alt';
  }

  return LEGACY_FAILED_FINDINGS[check.id] || `${check.title}未通过`;
}

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

function waitForNextPoll() {
  return new Promise((resolve) => setTimeout(resolve, 1200));
}

export default function SeoAuditPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('site');
  const [job, setJob] = useState(null);
  const [report, setReport] = useState(null);
  const [filter, setFilter] = useState('all');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const pollRef = useRef(0);

  const visibleCategories = useMemo(() => {
    if (!report?.categories) return [];
    return report.categories
      .map((category) => ({
        ...category,
        checks: category.checks.filter((check) => checkMatchesFilter(check, filter)),
      }))
      .filter((category) => category.checks.length > 0);
  }, [filter, report]);

  const pollSiteAudit = useCallback(async (jobId, pollId, restored = false) => {
    while (pollRef.current === pollId) {
      try {
        const response = await axios.get(`/api/seo-audits/jobs/${jobId}`);
        const nextJob = response?.data?.data;
        if (!nextJob || pollRef.current !== pollId) return null;
        setJob(nextJob);
        if (nextJob.status === 'completed') {
          window.localStorage.removeItem(ACTIVE_JOB_KEY);
          if (!nextJob.report) {
            const failedJob = { ...nextJob, status: 'failed', error: { message: '检测已结束，但完整报告不存在' } };
            setJob(failedJob);
            message.error(failedJob.error.message);
            return null;
          }
          setReport(nextJob.report);
          setHistoryRefreshKey((value) => value + 1);
          message.success(restored ? '已恢复完成的全站检测报告' : '全站 SEO 检测完成');
          return nextJob.report;
        }
        if (nextJob.status === 'failed') {
          window.localStorage.removeItem(ACTIVE_JOB_KEY);
          message.error(nextJob.error?.message || '全站 SEO 检测失败，请稍后重试');
          return null;
        }
        await waitForNextPoll();
      } catch (error) {
        if (pollRef.current === pollId) {
          window.localStorage.removeItem(ACTIVE_JOB_KEY);
          message.error(getApiErrorMessage(error, '读取全站检测进度失败'));
        }
        return null;
      }
    }
    return null;
  }, []);

  useEffect(() => {
    const storedJobId = Number(window.localStorage.getItem(ACTIVE_JOB_KEY));
    if (!Number.isInteger(storedJobId) || storedJobId < 1) return undefined;
    const pollId = pollRef.current + 1;
    pollRef.current = pollId;
    setMode('site');
    setLoading(true);
    setJob({ id: storedJobId, status: 'queued', progress: { phase: 'queued' } });
    pollSiteAudit(storedJobId, pollId, true).finally(() => {
      if (pollRef.current === pollId) setLoading(false);
    });
    return () => { pollRef.current += 1; };
  }, [pollSiteAudit]);

  const runAudit = async ({ url }) => {
    const pollId = pollRef.current + 1;
    pollRef.current = pollId;
    setLoading(true);
    setJob(null);
    try {
      if (mode === 'site') {
        const response = await axios.post('/api/seo-audits/site', { url });
        const createdJob = response?.data?.data;
        if (!createdJob?.id) throw new Error('未获得全站检测任务编号');
        setReport(null);
        setJob(createdJob);
        window.localStorage.setItem(ACTIVE_JOB_KEY, String(createdJob.id));
        await pollSiteAudit(createdJob.id, pollId);
      } else {
        window.localStorage.removeItem(ACTIVE_JOB_KEY);
        const response = await axios.post('/api/seo-audits', { url });
        setReport(response?.data?.data || null);
        setHistoryRefreshKey((value) => value + 1);
        message.success('单页 SEO 检测完成');
      }
      setFilter('all');
    } catch (error) {
      message.error(getApiErrorMessage(error, 'SEO 检测失败，请稍后重试'));
    } finally {
      if (pollRef.current === pollId) setLoading(false);
    }
  };

  const openHistoricalReport = (historicalReport) => {
    if (!historicalReport) return;
    setReport(historicalReport);
    setMode(historicalReport.mode === 'site' ? 'site' : 'page');
    setJob(null);
    setFilter('all');
    if (historicalReport.finalUrl) form.setFieldValue('url', historicalReport.finalUrl);
    message.success('已打开历史报告');
  };

  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="seo-audit-title">
        <Button
          className={styles.historyButton}
          icon={<HistoryOutlined />}
          onClick={() => setHistoryOpen(true)}
        >
          历史报告
        </Button>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}><SearchOutlined /> 技术 SEO 检测</span>
          <h1 id="seo-audit-title">把整站问题落到每一条 URL</h1>
          <p>从站内链接与 Sitemap 发现同域页面，检查 Google、Bing、百度共同关注的技术基础，并按严重程度和影响范围排出修复顺序。</p>
        </div>

        <div className={styles.modeControl}>
          <span>检测范围</span>
          <Segmented
            aria-label="检测范围"
            value={mode}
            disabled={loading}
            onChange={(value) => setMode(value)}
            options={[
              { label: '全站检测', value: 'site' },
              { label: '单页检测', value: 'page' },
            ]}
          />
          <small>{mode === 'site' ? '默认最多检测 200 个同域页面，异步执行' : '只检测输入的精确页面，适合快速复测'}</small>
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
              placeholder={mode === 'site' ? 'https://example.com/' : 'https://example.com/product/item'}
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
            {mode === 'site' ? '开始全站检测' : '检测这个页面'}
          </Button>
        </Form>
        <div className={styles.scopeNote}>
          <SafetyCertificateOutlined aria-hidden="true" />
          {mode === 'site'
            ? '只抓取同域公开页面；单页失败不会中断任务，达到上限会在报告中明确标记。'
            : '只检测输入的公开页面；额外验证根目录 robots.txt、Sitemap 与首页平台标签。'}
        </div>
      </section>

      <SeoAuditHistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onOpenReport={openHistoricalReport}
        currentAuditId={report?.auditId}
        refreshKey={historyRefreshKey}
      />

      {!report && mode === 'site' && job && (loading || job.status === 'failed') && (
        <SeoAuditJobProgress job={job} progress={job.progress} />
      )}

      {loading && !report && mode === 'page' && (
        <section className={styles.loadingPanel} aria-live="polite">
          <Spin size="large" />
          <div>
            <strong>正在读取页面并检查关键信号</strong>
            <span>包括 robots.txt、站点地图、Meta 信息、标题结构和基础响应表现</span>
          </div>
        </section>
      )}

      {!loading && !report && !job && (
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

      {report?.mode === 'site' && <SeoSiteAuditReport report={report} />}

      {report && report.mode !== 'site' && (
        <div className={styles.report} aria-live="polite" aria-busy={loading}>
          <section className={styles.reportMeta}>
            <div>
              <span>{report.auditId ? `检测报告 #${report.auditId}` : '检测页面'}</span>
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
                        <span className={styles.prioritySubject}>{item.title}</span>
                        <div className={styles.priorityTitle}>
                          <strong>{getCheckFinding(item)}</strong>
                          <SeverityBadge severity={item.severity} />
                        </div>
                        <div className={styles.priorityFact}>
                          <span>检测事实</span>
                          <p>{item.value || '未返回事实数据'}</p>
                        </div>
                        {item.recommendation && (
                          <p className={styles.priorityRecommendation}>建议：{item.recommendation}</p>
                        )}
                      </div>
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
              <p>按 {report.summary.total} 项基础检查的重要性加权计算</p>
              <div className={styles.scoreStats}>
                <div><span>{report.summary.passed}</span><small>已通过</small></div>
                <div><span>{report.summary.critical + report.summary.high}</span><small>优先处理</small></div>
                <div><span>{report.summary.medium + report.summary.low}</span><small>一般问题</small></div>
              </div>
            </aside>
          </section>

          <SearchPlatformPanel platforms={report.platforms} />
          <CrawlerAccessPanel access={report.crawlerAccess} />

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
                            <span className={styles.checkSubject}>{check.title}</span>
                            {check.status === 'failed'
                              ? <SeverityBadge severity={check.severity} />
                              : <span className={styles.passedBadge}>通过</span>}
                          </div>
                          <strong className={styles.checkFinding}>
                            {getCheckFinding(check)}
                          </strong>
                          <div className={styles.checkFact}>
                            <span>检测事实</span>
                            <p>{check.value || '未返回事实数据'}</p>
                          </div>
                          <p className={styles.checkImpact}>影响：{check.description}</p>
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
            <span>这是输入 URL 的单页技术检测；技术健康度不是 Google、Bing 或百度官方评分，不包含真实 Core Web Vitals、关键词排名或外链数据库。</span>
          </footer>
        </div>
      )}
    </main>
  );
}
