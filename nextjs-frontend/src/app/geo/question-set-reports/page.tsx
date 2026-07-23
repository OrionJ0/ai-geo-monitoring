'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Col,
  Empty,
  Pagination,
  Progress,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import {
  DownloadOutlined,
  FileSearchOutlined,
  ImportOutlined,
  PrinterOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { getApiErrorMessage } from '@/utils/apiErrorMessage.cjs';
import { getSelectableProjects, resolveSelectedProjectId } from '@/utils/projectSelection.cjs';
import styles from './question-set-reports.module.css';

const { Paragraph, Text, Title } = Typography;

type Project = { id: number; name: string; status?: string };
type ReportSummary = {
  total?: number;
  completed?: number;
  failed?: number;
  pending?: number;
  valid_analyses?: number;
  brand_mention_rate?: number;
  recommendation_rate?: number;
  avg_share_of_voice?: number;
  citation_rate?: number;
  avg_brand_rank?: number | null;
  total_citations?: number;
};
type ReportRow = {
  record_id?: number | null;
  question_id?: number | null;
  question: string;
  question_category?: string;
  platform?: string;
  platform_name?: string;
  model_name?: string;
  status: string;
  error_message?: string;
  answer?: string;
  has_metrics?: boolean;
  brand_mentioned?: boolean;
  brand_recommended?: boolean;
  share_of_voice?: number;
  brand_rank?: number | null;
  citation_count?: number;
  sentiment?: string;
  citation_sources?: Array<{ url?: string; domain?: string; title?: string }>;
};
type RunReport = {
  id: number;
  project_id: number;
  question_set_id?: number | null;
  question_set_name: string;
  source: 'native' | 'imported';
  status: 'running' | 'completed' | 'partial' | 'failed';
  started_at?: string;
  completed_at?: string | null;
  created_at?: string;
  summary: ReportSummary;
  rows?: ReportRow[];
};

const HISTORY_PAGE_SIZE = 20;

const statusMeta = {
  running: { label: '运行中', color: 'processing' },
  completed: { label: '已完成', color: 'success' },
  partial: { label: '部分完成', color: 'warning' },
  failed: { label: '失败', color: 'error' },
} as const;

const sentimentLabel: Record<string, string> = {
  positive: '正向',
  neutral: '中性',
  negative: '负向',
};

function extractList(response: unknown) {
  const payload = response as { data?: { data?: unknown } };
  const value = payload?.data?.data ?? [];
  return Array.isArray(value) ? value : [];
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function percent(value?: number) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

function formatRank(value?: number | null) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Number(number.toFixed(2)) : '-';
}

function safeFilename(value: string) {
  return String(value || '问题集报告').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
}

function reportStatusTag(status: RunReport['status']) {
  const meta = statusMeta[status] || statusMeta.running;
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

export default function QuestionSetReportsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number>();
  const [history, setHistory] = useState<RunReport[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [runId, setRunId] = useState<number>();
  const [report, setReport] = useState<RunReport | null>(null);
  const [projectLoading, setProjectLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const historyRequest = useRef(0);
  const reportRequest = useRef(0);
  const preferredIds = useRef<{ projectId?: number; runId?: number }>({});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const preferredProjectId = Number(params.get('project_id'));
    const preferredRunId = Number(params.get('run_id'));
    preferredIds.current = {
      projectId: Number.isInteger(preferredProjectId) && preferredProjectId > 0 ? preferredProjectId : undefined,
      runId: Number.isInteger(preferredRunId) && preferredRunId > 0 ? preferredRunId : undefined,
    };
  }, []);

  const loadProjects = useCallback(async () => {
    setProjectLoading(true);
    try {
      const response = await axios.get('/api/geo-projects');
      const rows = getSelectableProjects(extractList(response)) as Project[];
      setProjects(rows);
      setProjectId((current) => resolveSelectedProjectId(rows, current, preferredIds.current.projectId));
    } catch (error) {
      message.error(getApiErrorMessage(error, '获取品牌项目失败'));
    } finally {
      setProjectLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async (
    targetProjectId?: number,
    preferredRunId?: number,
    targetPage = 1,
    selectFirst = false,
  ) => {
    const requestId = historyRequest.current + 1;
    historyRequest.current = requestId;
    if (!targetProjectId) {
      setHistory([]);
      setHistoryTotal(0);
      setRunId(undefined);
      return;
    }
    setHistoryLoading(true);
    try {
      const response = await axios.get(`/api/geo-projects/${targetProjectId}/question-set-runs`, {
        params: { page: targetPage, pageSize: HISTORY_PAGE_SIZE },
      });
      if (historyRequest.current !== requestId) return;
      const rows = extractList(response) as RunReport[];
      const pagination = response?.data?.pagination;
      setHistory(rows);
      setHistoryPage(targetPage);
      setHistoryTotal(Number(pagination?.totalItems) || rows.length);
      setRunId((current) => {
        if (selectFirst) return rows[0]?.id;
        if (preferredRunId) return preferredRunId;
        return rows.some((item) => item.id === current) ? current : rows[0]?.id;
      });
    } catch (error) {
      if (historyRequest.current === requestId) {
        setHistory([]);
        setHistoryTotal(0);
        setRunId(undefined);
        message.error(getApiErrorMessage(error, '获取问题集运行历史失败'));
      }
    } finally {
      if (historyRequest.current === requestId) setHistoryLoading(false);
    }
  }, []);

  const loadReport = useCallback(async (targetProjectId?: number, targetRunId?: number, quiet = false) => {
    const requestId = reportRequest.current + 1;
    reportRequest.current = requestId;
    if (!targetProjectId || !targetRunId) {
      setReport(null);
      return;
    }
    if (!quiet) setReportLoading(true);
    try {
      const response = await axios.get(`/api/geo-projects/${targetProjectId}/question-set-runs/${targetRunId}`);
      if (reportRequest.current !== requestId) return;
      const nextReport = response?.data?.data || null;
      setReport(nextReport);
      setHistory((items) => items.map((item) => item.id === nextReport?.id ? { ...item, ...nextReport, rows: undefined } : item));
    } catch (error) {
      if (reportRequest.current === requestId) {
        setReport(null);
        message.error(getApiErrorMessage(error, '获取问题集运行报告失败'));
      }
    } finally {
      if (reportRequest.current === requestId && !quiet) setReportLoading(false);
    }
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  useEffect(() => {
    setReport(null);
    setHistoryPage(1);
    loadHistory(projectId, preferredIds.current.runId, 1);
    preferredIds.current.runId = undefined;
  }, [projectId, loadHistory]);

  useEffect(() => {
    loadReport(projectId, runId);
  }, [projectId, runId, loadReport]);

  useEffect(() => {
    if (!projectId || !runId) return;
    const params = new URLSearchParams(window.location.search);
    params.set('project_id', String(projectId));
    params.set('run_id', String(runId));
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }, [projectId, runId]);

  useEffect(() => {
    if (!projectId || !runId || report?.status !== 'running') return undefined;
    const timer = window.setInterval(() => {
      loadReport(projectId, runId, true);
      loadHistory(projectId, runId, historyPage);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [projectId, runId, report?.status, historyPage, loadHistory, loadReport]);

  const selectedProject = useMemo(
    () => projects.find((item) => item.id === projectId),
    [projects, projectId],
  );
  const summary = report?.summary || {};
  const progress = summary.total ? Math.round(((summary.completed || 0) + (summary.failed || 0)) / summary.total * 100) : 0;

  const selectRun = (nextRunId: number) => setRunId(nextRunId);

  const exportReport = async () => {
    if (!projectId || !report) return;
    try {
      const response = await axios.get(`/api/geo-projects/${projectId}/question-set-runs/${report.id}/export`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${safeFilename(report.question_set_name)}-${report.id}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      message.error(getApiErrorMessage(error, '导出问题集报告失败'));
    }
  };

  const printReport = () => {
    setPrinting(true);
    window.setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 0);
  };

  const importReport = async (file: File) => {
    if (!projectId) {
      message.warning('请先选择品牌项目');
      return false;
    }
    if (!file.name.toLowerCase().endsWith('.csv')) {
      message.error('请选择 CSV 文件');
      return false;
    }
    if (file.size > 5 * 1024 * 1024) {
      message.error('当前导入文件不能超过 5MB');
      return false;
    }
    setImporting(true);
    try {
      const csv = await file.text();
      const response = await axios.post(
        `/api/geo-projects/${projectId}/question-set-runs/import`,
        csv,
        { headers: { 'Content-Type': 'text/csv; charset=utf-8' } },
      );
      const imported = response?.data?.data as RunReport;
      message.success('问题集运行报告已导入');
      await loadHistory(projectId, imported.id, 1);
      selectRun(imported.id);
    } catch (error) {
      message.error(getApiErrorMessage(error, '导入问题集报告失败'));
    } finally {
      setImporting(false);
    }
    return false;
  };

  const rowColumns = [
    {
      title: '问题',
      dataIndex: 'question',
      width: 300,
      render: (value: string, row: ReportRow) => (
        <Space orientation="vertical" size={2}>
          <Text strong>{value || '-'}</Text>
          <Text type="secondary">{row.question_category || '未分类'}</Text>
        </Space>
      ),
    },
    {
      title: '平台 / 模型',
      key: 'platform',
      width: 180,
      render: (_: unknown, row: ReportRow) => (
        <Space orientation="vertical" size={2}>
          <Text>{row.platform_name || row.platform || '-'}</Text>
          <Text type="secondary">{row.model_name || '-'}</Text>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (value: string) => value === 'completed'
        ? <Tag color="success">完成</Tag>
        : value === 'failed' ? <Tag color="error">失败</Tag> : <Tag color="processing">等待</Tag>,
    },
    {
      title: '品牌表现',
      key: 'brand',
      width: 180,
      render: (_: unknown, row: ReportRow) => row.has_metrics ? (
        <Space wrap size={[4, 4]}>
          <Tag color={row.brand_mentioned ? 'blue' : 'default'}>{row.brand_mentioned ? '已提及' : '未提及'}</Tag>
          {row.brand_recommended ? <Tag color="green">明确推荐</Tag> : null}
          <Text type="secondary">SOV {percent(row.share_of_voice)}%</Text>
        </Space>
      ) : '-',
    },
    {
      title: '排名',
      dataIndex: 'brand_rank',
      width: 80,
      render: formatRank,
    },
    {
      title: '引用',
      dataIndex: 'citation_count',
      width: 70,
      render: (value: number) => Number(value || 0),
    },
    {
      title: '情绪',
      dataIndex: 'sentiment',
      width: 80,
      render: (value: string) => sentimentLabel[value] || '-',
    },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div>
          <Text className={styles.eyebrow}>QUESTION SET RUNS</Text>
          <Title level={2} className={styles.pageTitle}>问题集报告</Title>
          <Text type="secondary">每次运行独立成档，不与项目其他运行混合。</Text>
        </div>
        <Space wrap>
          <Select
            loading={projectLoading}
            placeholder="选择品牌项目"
            value={projectId}
            style={{ width: 240 }}
            options={projects.map((item) => ({ value: item.id, label: item.name }))}
            onChange={(value) => setProjectId(value)}
          />
          <Upload accept=".csv,text/csv" showUploadList={false} beforeUpload={importReport}>
            <Button icon={<ImportOutlined />} loading={importing} disabled={!projectId}>导入 CSV</Button>
          </Upload>
          <Button
            icon={<ReloadOutlined />}
            loading={historyLoading || reportLoading}
            disabled={!projectId}
            onClick={() => {
              loadHistory(projectId, runId, historyPage);
              loadReport(projectId, runId);
            }}
          >
            刷新
          </Button>
        </Space>
      </div>

      <Row gutter={[16, 16]} align="stretch">
        <Col xs={24} xl={7}>
          <aside className={styles.historyPanel} aria-labelledby="run-history-title">
            <div className={styles.panelHeading}>
              <div>
                <Text className={styles.panelKicker}>按时间倒序</Text>
                <Title level={4} id="run-history-title">运行历史</Title>
              </div>
              <Text type="secondary">共 {historyTotal} 次</Text>
            </div>
            {!projectId ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先选择项目" />
            ) : history.length ? (
              <>
                <div className={styles.historyList} aria-busy={historyLoading}>
                  {history.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className={`${styles.historyItem} ${item.id === runId ? styles.historyItemActive : ''}`}
                      onClick={() => selectRun(item.id)}
                    >
                      <span className={styles.historyMarker} />
                      <span className={styles.historyContent}>
                        <span className={styles.historyTitle}>{item.question_set_name}</span>
                        <span className={styles.historyMeta}>{formatDate(item.started_at || item.created_at)}</span>
                        <span className={styles.historyFooter}>
                          {reportStatusTag(item.status)}
                          {item.source === 'imported' ? <Tag>导入</Tag> : <Tag variant="filled">系统运行</Tag>}
                          <Text type="secondary">{item.summary?.total || 0} 项</Text>
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
                <Pagination
                  className={styles.historyPagination}
                  current={historyPage}
                  pageSize={HISTORY_PAGE_SIZE}
                  total={historyTotal}
                  showSizeChanger={false}
                  hideOnSinglePage
                  onChange={(page) => loadHistory(projectId, undefined, page, true)}
                />
              </>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无问题集运行报告" />
            )}
          </aside>
        </Col>

        <Col xs={24} xl={17}>
          <main className={styles.reportSheet} aria-busy={reportLoading}>
            {!report ? (
              <Empty
                image={<FileSearchOutlined className={styles.emptyIcon} />}
                description={selectedProject ? '运行一次问题集后，这里会生成独立报告' : '请选择品牌项目'}
              />
            ) : (
              <>
                <header className={styles.reportHeader}>
                  <div>
                    <Space wrap size={8}>
                      {reportStatusTag(report.status)}
                      {report.source === 'imported' ? <Tag>导入报告</Tag> : <Tag variant="filled">运行 #{report.id}</Tag>}
                    </Space>
                    <Title level={2}>{report.question_set_name}</Title>
                    <Text type="secondary">
                      {selectedProject?.name || '品牌项目'} · 开始于 {formatDate(report.started_at || report.created_at)}
                    </Text>
                  </div>
                  <Space wrap className={styles.reportActions}>
                    <Button icon={<PrinterOutlined />} onClick={printReport}>打印 / 导出 PDF</Button>
                    <Button icon={<DownloadOutlined />} onClick={exportReport}>导出标准 CSV</Button>
                  </Space>
                </header>

                {report.status === 'running' ? (
                  <Alert
                    type="info"
                    showIcon
                    title="问题集仍在运行，报告会自动更新"
                    description={<Progress percent={progress} size="small" />}
                    className={styles.runningAlert}
                  />
                ) : null}

                <section className={styles.runSummary} aria-label="本次运行摘要">
                  <div><Text>任务</Text><strong>{summary.total || 0}</strong></div>
                  <div><Text>完成 / 失败</Text><strong>{summary.completed || 0} / {summary.failed || 0}</strong></div>
                  <div><Text>品牌提及率</Text><strong>{percent(summary.brand_mention_rate)}%</strong></div>
                  <div><Text>推荐率</Text><strong>{percent(summary.recommendation_rate)}%</strong></div>
                  <div><Text>平均 SOV</Text><strong>{percent(summary.avg_share_of_voice)}%</strong></div>
                  <div><Text>平均品牌排名</Text><strong>{formatRank(summary.avg_brand_rank)}</strong></div>
                </section>

                <section className={styles.resultsSection} aria-labelledby="run-results-title">
                  <div className={styles.resultsHeading}>
                    <div>
                      <Text className={styles.panelKicker}>一行一个问题 × 平台</Text>
                      <Title level={4} id="run-results-title">逐问题结果</Title>
                    </div>
                    <Text type="secondary">有效分析 {summary.valid_analyses || 0} · 引用 {summary.total_citations || 0}</Text>
                  </div>
                  <Table<ReportRow>
                    size="small"
                    rowKey={(row) => `${row.record_id || 'imported'}-${row.question_id || row.question}-${row.platform}`}
                    columns={rowColumns}
                    dataSource={report.rows || []}
                    pagination={printing ? false : { pageSize: 20, showSizeChanger: false }}
                    scroll={{ x: 1080 }}
                    locale={{ emptyText: '本次运行暂无结果' }}
                    expandable={{
                      expandedRowRender: (row) => (
                        <div className={styles.answerPanel}>
                          {row.error_message ? <Alert type="error" showIcon title={row.error_message} /> : null}
                          <Text className={styles.answerLabel}>AI 原始回答</Text>
                          <Paragraph className={styles.answerText}>{row.answer || '暂无回答内容'}</Paragraph>
                          {Array.isArray(row.citation_sources) && row.citation_sources.length ? (
                            <Space orientation="vertical" size={4}>
                              <Text className={styles.answerLabel}>引用来源</Text>
                              {row.citation_sources.map((source, index) => source.url ? (
                                <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer">
                                  {source.title || source.domain || source.url}
                                </a>
                              ) : null)}
                            </Space>
                          ) : null}
                        </div>
                      ),
                      rowExpandable: (row) => Boolean(row.answer || row.error_message || row.citation_sources?.length),
                    }}
                  />
                </section>
              </>
            )}
          </main>
        </Col>
      </Row>
    </div>
  );
}
