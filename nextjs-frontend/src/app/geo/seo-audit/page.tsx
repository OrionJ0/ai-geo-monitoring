// @ts-nocheck
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Form, Input, Segmented, Spin, Tooltip, Upload, message } from 'antd';
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  ExportOutlined,
  GlobalOutlined,
  HistoryOutlined,
  ImportOutlined,
  InfoCircleOutlined,
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
import TechnicalHealthOverview from './TechnicalHealthOverview';
import StageChecksPanel from './StageChecksPanel';
import { sortPriorities } from '@/utils/seoStagePresentation.cjs';
import styles from './seo-audit.module.css';

const ACTIVE_JOB_KEY = 'goodie-seo-active-job';
const EXPECTED_SCORE_VERSION = '2026-07-31-v5';
const EXPECTED_SCORE_MODEL = 'technical-health-v5';

const SEVERITY_LABELS = {
  critical: '严重',
  high: '高优先级',
  medium: '中优先级',
  low: '建议优化',
};

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

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  return bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;
}

function SeverityBadge({ severity }) {
  return <span className={`${styles.severityBadge} ${styles[`severity_${severity}`]}`}>{SEVERITY_LABELS[severity]}</span>;
}

function waitForNextPoll() {
  return new Promise((resolve) => setTimeout(resolve, 1200));
}

async function ensureCurrentScoreRuntime() {
  let runtime;
  try {
    const response = await axios.get('/api/seo-audits/runtime');
    runtime = response?.data?.data;
  } catch (error) {
    if (error?.response?.status === 401) throw error;
    const runtimeError = new Error(
      error?.response?.status === 404
        ? '后端评分服务仍为旧版，请重启后端后重试'
        : '无法确认后端评分版本，请检查后端服务后重试'
    );
    runtimeError.userMessage = runtimeError.message;
    throw runtimeError;
  }

  if (
    runtime?.scoreVersion === EXPECTED_SCORE_VERSION
    && runtime?.scoreModel === EXPECTED_SCORE_MODEL
  ) {
    return runtime;
  }

  const error = new Error('后端评分服务仍为旧版，请重启后端后重试');
  error.userMessage = error.message;
  throw error;
}

export default function SeoAuditPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('site');
  const [job, setJob] = useState(null);
  const [report, setReport] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [privateTargetsEnabled, setPrivateTargetsEnabled] = useState(null);
  const pollRef = useRef(0);

  const priorities = useMemo(
    () => sortPriorities(report?.priorities || []),
    [report]
  );

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
    let active = true;
    ensureCurrentScoreRuntime()
      .then((runtime) => {
        if (active) setPrivateTargetsEnabled(Boolean(runtime?.privateTargetsEnabled));
      })
      .catch(() => {});
    return () => { active = false; };
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
      const runtime = await ensureCurrentScoreRuntime();
      setPrivateTargetsEnabled(Boolean(runtime?.privateTargetsEnabled));
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
    } catch (error) {
      message.error(getApiErrorMessage(error, error?.userMessage || 'SEO 检测失败，请稍后重试'));
    } finally {
      if (pollRef.current === pollId) setLoading(false);
    }
  };

  const openHistoricalReport = (historicalReport) => {
    if (!historicalReport) return;
    setReport(historicalReport);
    setMode(historicalReport.mode === 'site' ? 'site' : 'page');
    setJob(null);
    if (historicalReport.finalUrl) form.setFieldValue('url', historicalReport.finalUrl);
    message.success('已打开历史报告');
  };

  const exportReport = async () => {
    if (!report?.auditId) return;
    setExporting(true);
    try {
      const response = await axios.get(`/api/seo-audits/${report.auditId}/export`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `seo-audit-${report.auditId}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      message.success('SEO 标准 CSV 已导出');
    } catch (error) {
      message.error(getApiErrorMessage(error, '导出 SEO 报告失败'));
    } finally {
      setExporting(false);
    }
  };

  const importReport = async (file) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      message.error('请选择 CSV 文件');
      return false;
    }
    if (file.size > 10 * 1024 * 1024) {
      message.error('CSV 文件不能超过 10MB');
      return false;
    }

    setImporting(true);
    try {
      const response = await axios.post('/api/seo-audits/import', file, {
        headers: { 'Content-Type': 'text/csv; charset=utf-8' },
      });
      const imported = response?.data?.data;
      if (!imported?.auditId) throw new Error('导入接口未返回报告编号');
      setReport(imported);
      setMode(imported.mode === 'site' ? 'site' : 'page');
      setJob(null);
      if (imported.finalUrl) form.setFieldValue('url', imported.finalUrl);
      setHistoryRefreshKey((value) => value + 1);
      message.success(`SEO 报告已导入为历史 #${imported.auditId}`);
    } catch (error) {
      message.error(getApiErrorMessage(error, '导入 SEO 报告失败'));
    } finally {
      setImporting(false);
    }
    return false;
  };

  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-label="技术 SEO 检测">
        <div className={styles.heroActions}>
          <Upload
            accept=".csv,text/csv"
            showUploadList={false}
            beforeUpload={importReport}
            disabled={importing || loading}
          >
            <Button
              className={styles.importButton}
              icon={<ImportOutlined />}
              loading={importing}
              disabled={loading}
            >
              导入 CSV
            </Button>
          </Upload>
          <Button
            className={styles.historyButton}
            icon={<HistoryOutlined />}
            onClick={() => setHistoryOpen(true)}
          >
            历史报告
          </Button>
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
          <span>
            {privateTargetsEnabled === true
            ? '本机与局域网检测已开启'
            : privateTargetsEnabled === false
              ? '当前仅允许检测公网地址'
              : '正在检查网络范围'}
          </span>
          <Tooltip title="检测由后端服务器发出；localhost 指后端所在机器，其他电脑请填写后端可访问的局域网 IP。全站模式只抓取同域页面，单页模式只检测输入页面及必要的站点级文件。">
            <InfoCircleOutlined tabIndex={0} aria-label="检测范围说明" />
          </Tooltip>
        </div>
      </section>

      <SeoAuditHistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onOpenReport={openHistoricalReport}
        currentAuditId={report?.auditId}
        refreshKey={historyRefreshKey}
      />

      {report?.auditId && (
        <section className={styles.reportTransfer} aria-label="报告数据导出">
          <Button icon={<ExportOutlined />} loading={exporting} onClick={exportReport}>
            导出标准 CSV
          </Button>
        </section>
      )}

      {!report && mode === 'site' && job && (loading || job.status === 'failed') && (
        <SeoAuditJobProgress job={job} progress={job.progress} />
      )}

      {loading && !report && mode === 'page' && (
        <section className={styles.loadingPanel} aria-live="polite">
          <Spin size="large" />
          <strong>正在检测</strong>
        </section>
      )}

      {report?.mode === 'site' && <SeoSiteAuditReport report={report} />}

      {report && report.mode !== 'site' && (
        <div className={styles.report} aria-live="polite" aria-busy={loading}>
          {report.networkPolicy?.scope === 'private' && (
            <section className={styles.networkPolicyNote}>
              <strong>私网检测报告</strong>
              <span>本次只访问输入页面的精确站点范围。</span>
            </section>
          )}
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

          <TechnicalHealthOverview report={report} />

          <section className={styles.priorityPanel} aria-label={`从 ${report.summary.total} 项检查中生成的修复清单`}>
            <header className={styles.sectionHeading}>
              <div>
                <h2>优先修复内容</h2>
                <p className={styles.priorityOrderNote}>按优先级从高到低</p>
              </div>
              <span className={styles.issueCount}>{priorities.length} 类问题</span>
            </header>

            {priorities.length === 0 ? (
              <div className={styles.allPassed}><CheckCircleFilled /> 当前关键项均已通过</div>
            ) : (
              <ol className={styles.priorityList}>
                {priorities.slice(0, 8).map((item, index) => (
                  <li key={item.id} className={`${styles.priorityItem} ${styles[`rail_${item.severity}`]}`}>
                    <span className={styles.priorityNumber}>{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <span className={styles.prioritySubject}>{item.title}</span>
                      <div className={styles.priorityTitle}>
                        <strong>{getCheckFinding(item)}</strong>
                        <SeverityBadge severity={item.severity} />
                      </div>
                      {item.stageLabel && (
                        <div className={styles.issueMetrics}>
                          <span>{item.stageLabel}</span>
                          <span>覆盖率 {Math.round(Number(item.coverage || 0) * 100)}%</span>
                          <span>{item.affectsHomepage ? '影响首页' : '不影响首页'}</span>
                          <strong>
                            {item.deduction === null || item.deduction === undefined
                              ? `分数上限 ${item.cap}`
                              : `实际扣分 ${Number(item.deduction).toFixed(2)}`}
                          </strong>
                        </div>
                      )}
                      <div className={styles.priorityFact}>
                        <span>检测事实</span>
                        <p>{item.findings?.[0]?.value || item.value || item.finding || '未返回事实数据'}</p>
                        {(item.affectedPages || [])[0] && <small>{item.affectedPages[0]}</small>}
                      </div>
                      {item.recommendation && (
                        <p className={styles.priorityRecommendation}>建议：{item.recommendation}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <StageChecksPanel report={report} />

          <SearchPlatformPanel platforms={report.platforms} />
          <CrawlerAccessPanel access={report.crawlerAccess} />

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
            <span>这是输入 URL 的单页技术检测；技术健康分不是 Google、Bing 或百度官方评分，不包含真实 Core Web Vitals、关键词排名或外链数据库。</span>
          </footer>
        </div>
      )}
    </main>
  );
}
