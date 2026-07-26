'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Collapse,
  Descriptions,
  Empty,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
} from 'antd';
import {
  CaretRightOutlined,
  DownloadOutlined,
  FilePdfOutlined,
  FileSearchOutlined,
  HistoryOutlined,
  ImportOutlined,
  LoadingOutlined,
  PauseCircleOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { getApiErrorMessage } from '@/utils/apiErrorMessage.cjs';
import { downloadQuestionSetReportPdf } from '@/utils/downloadQuestionSetReportPdf';
import { getSelectableProjects, resolveSelectedProjectId } from '@/utils/projectSelection.cjs';
import {
  PDF_COLUMN_WIDTHS,
  getRunStateNotice,
} from '@/utils/questionSetRunPresentation.cjs';
import QuestionSetRunHistoryDrawer, {
  type QuestionSetOption,
} from './QuestionSetRunHistoryDrawer';
import styles from './question-set-reports.module.css';

const { Paragraph, Text, Title } = Typography;

type Project = { id: number; name: string; status?: string; website?: string };
type CitationSource = {
  url?: string;
  domain?: string;
  title?: string;
  owned?: boolean;
  competitor_owned?: boolean;
};
type CitationSourceGroups = {
  explicit_citations?: CitationSource[];
  response_links?: CitationSource[];
  retrieval_sources?: CitationSource[];
  analysis_sources?: CitationSource[];
};
type ReportSummary = {
  total?: number;
  completed?: number;
  failed?: number;
  pending?: number;
  valid_analyses?: number;
  citation_valid_analyses?: number;
  citation_unverified_analyses?: number;
  competitor_baseline_count?: number;
  brand_mention_rate?: number;
  recommendation_rate?: number;
  avg_share_of_voice?: number;
  citation_rate?: number;
  owned_citation_rate?: number;
  avg_brand_rank?: number | null;
  total_citations?: number;
  total_owned_citations?: number;
};
type ExecutionSummary = {
  total?: number;
  completed?: number;
  failed?: number;
  pending?: number;
  failure_stages?: Record<string, number>;
};
type RunStateNotice = {
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  description: string;
};
type RunCapabilities = {
  can_pause: boolean;
  pause_disabled_reason?: string | null;
  can_resume: boolean;
  resume_disabled_reason?: string | null;
  can_retry: boolean;
  retry_disabled_reason?: string | null;
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
  failure?: {
    stage?: string;
    error_code?: string;
  } | null;
  retry?: {
    previous_record_id?: number | null;
    attempt?: number;
    kind?: 'analysis_only' | 'full_monitoring' | string;
  } | null;
  analysis_diagnostics?: {
    status?: string;
    error_code?: string;
    error_detail?: string;
    stage?: string;
    attempt_count?: number;
    platform?: string;
    model?: string;
    finish_reason?: string;
    output_length?: number;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  } | null;
  answer?: string;
  has_metrics?: boolean;
  brand_mentioned?: boolean;
  brand_recommended?: boolean;
  share_of_voice?: number;
  brand_rank?: number | null;
  citation_count?: number;
  owned_citation_count?: number;
  citation_evidence_status?: 'explicit' | 'legacy_unverified' | 'none';
  legacy_citation_count?: number;
  legacy_citation_sources?: CitationSource[];
  sentiment?: string;
  analysis_method?: string;
  analysis_platform?: string;
  analysis_model?: string;
  analysis_structure?: {
    schema_version?: string;
    target_entity_name?: string | null;
    entities?: Array<{ name?: string; type?: 'brand' | 'company' }>;
    mentions?: Array<{ entity_name?: string; surface_forms?: string[] }>;
    competitor_matches?: Array<{ configured_name?: string; entity_name?: string | null }>;
    candidate_lists?: Array<{ ordered?: boolean; entries?: string[] }>;
    recommendations?: Array<{ entity_name?: string; kind?: string }>;
    claims?: Array<{
      subject_name?: string;
      predicate?: string;
      value?: string;
      qualifier?: string;
    }>;
    citations?: {
      count?: number;
      official_count?: number;
      official_website_cited?: boolean;
      sources?: CitationSource[];
      source_groups?: CitationSourceGroups;
      semantics_version?: string;
    };
  };
  analysis_evidence?: {
    brand?: {
      mention?: string[];
      recommendation?: string[];
      rank?: string[];
    };
  };
  competitor_mentions?: Array<{ id?: number | null; name?: string; mentioned?: boolean }>;
  citation_sources?: CitationSource[];
};
type RunReport = {
  id: number;
  project_id: number;
  question_set_id?: number | null;
  question_set_name: string;
  source: 'native' | 'imported';
  status: 'running' | 'completed' | 'partial' | 'failed' | 'paused';
  started_at?: string;
  completed_at?: string | null;
  paused_at?: string | null;
  created_at?: string;
  integrity?: {
    status?: 'complete' | 'snapshot_only' | 'missing_records' | string;
    missing_record_count?: number;
    error_code?: string | null;
  };
  capabilities?: RunCapabilities;
  execution_summary?: ExecutionSummary;
  summary: ReportSummary;
  rows?: ReportRow[];
};

const HISTORY_PAGE_SIZE = 20;

const statusMeta = {
  running: { label: '运行中', color: 'processing' },
  paused: { label: '已暂停', color: 'warning' },
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
  const icon = status === 'running'
    ? <LoadingOutlined spin />
    : status === 'paused'
      ? <PauseCircleOutlined />
      : undefined;
  return (
    <Tag
      color={meta.color}
      icon={icon}
    >
      {meta.label}
    </Tag>
  );
}

function MetricLabel({ label, help }: { label: string; help: string }) {
  return (
    <span className={styles.metricLabel}>
      <Text>{label}</Text>
      <Tooltip title={help} trigger={['hover', 'focus']}>
        <QuestionCircleOutlined
          className={styles.metricHelp}
          aria-label={`${label}指标说明`}
          tabIndex={0}
        />
      </Tooltip>
    </span>
  );
}

function MetricItem({
  label,
  help,
  value,
}: {
  label: string;
  help: string;
  value: React.ReactNode;
}) {
  return (
    <div className={styles.metricCard}>
      <MetricLabel label={label} help={help} />
      <strong>{value}</strong>
    </div>
  );
}

export default function QuestionSetReportsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number>();
  const [history, setHistory] = useState<RunReport[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [questionSets, setQuestionSets] = useState<QuestionSetOption[]>([]);
  const [historyQuestionSetId, setHistoryQuestionSetId] = useState<number>();
  const [runId, setRunId] = useState<number>();
  const [report, setReport] = useState<RunReport | null>(null);
  const [projectLoading, setProjectLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [pdfLayout, setPdfLayout] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [metricsExpanded, setMetricsExpanded] = useState(false);
  const historyRequest = useRef(0);
  const questionSetRequest = useRef(0);
  const reportRequest = useRef(0);
  const reportSheetRef = useRef<HTMLElement>(null);
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
    targetPage = 1,
    targetQuestionSetId?: number,
    preferredRunId?: number,
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
        params: {
          page: targetPage,
          pageSize: HISTORY_PAGE_SIZE,
          questionSetId: targetQuestionSetId,
        },
      });
      if (historyRequest.current !== requestId) return;
      const rows = extractList(response) as RunReport[];
      const pagination = response?.data?.pagination;
      setHistory(rows);
      setHistoryPage(targetPage);
      setHistoryTotal(Number(pagination?.totalItems) || rows.length);
      setRunId((current) => {
        if (preferredRunId) return preferredRunId;
        if (selectFirst) return rows[0]?.id;
        return current;
      });
    } catch (error) {
      if (historyRequest.current === requestId) {
        setHistory([]);
        setHistoryTotal(0);
        if (selectFirst) setRunId(undefined);
        message.error(getApiErrorMessage(error, '获取问题集运行历史失败'));
      }
    } finally {
      if (historyRequest.current === requestId) setHistoryLoading(false);
    }
  }, []);

  const loadQuestionSets = useCallback(async (targetProjectId?: number) => {
    const requestId = questionSetRequest.current + 1;
    questionSetRequest.current = requestId;
    if (!targetProjectId) {
      setQuestionSets([]);
      return;
    }
    try {
      const response = await axios.get(`/api/geo-projects/${targetProjectId}/question-sets`);
      if (questionSetRequest.current !== requestId) return;
      setQuestionSets(extractList(response) as QuestionSetOption[]);
    } catch (error) {
      if (questionSetRequest.current === requestId) {
        setQuestionSets([]);
        message.error(getApiErrorMessage(error, '获取问题集列表失败'));
      }
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
    setHistoryQuestionSetId(undefined);
    loadHistory(projectId, 1, undefined, preferredIds.current.runId, true);
    loadQuestionSets(projectId);
    preferredIds.current.runId = undefined;
  }, [projectId, loadHistory, loadQuestionSets]);

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
    if (!projectId || !runId || (report?.status !== 'running' && report?.status !== 'paused')) return undefined;
    const timer = window.setInterval(() => {
      loadReport(projectId, runId, true);
      if (historyOpen) loadHistory(projectId, historyPage, historyQuestionSetId);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [
    projectId,
    runId,
    report?.status,
    historyOpen,
    historyPage,
    historyQuestionSetId,
    loadHistory,
    loadReport,
  ]);

  const selectedProject = useMemo(
    () => projects.find((item) => item.id === projectId),
    [projects, projectId],
  );
  const summary = report?.summary || {};
  const hasCompetitorBaseline = Number(summary.competitor_baseline_count || 0) > 0;
  const hasLegacyAnalysis = Boolean(report?.rows?.some(
    (row) => row.has_metrics && !['ai_structured_v1', 'ai_structured_v2'].includes(row.analysis_method || ''),
  ));
  const executionSummary: ExecutionSummary = report?.execution_summary || {
    total: summary.total,
    completed: summary.completed,
    failed: summary.failed,
    pending: summary.pending,
    failure_stages: {},
  };
  const runStateNotice = report ? getRunStateNotice({
    status: report.status,
    source: report.source,
    integrityStatus: report.integrity?.status,
    capabilities: report.capabilities,
    executionSummary,
  }) as RunStateNotice : null;

  const selectRun = (nextRunId: number) => setRunId(nextRunId);
  const reportRowKey = (row: ReportRow) => (
    `${row.record_id || 'imported'}-${row.question_id || row.question}-${row.platform}`
  );

  const brandEvidence = (row: ReportRow) => {
    const evidence = row.analysis_evidence?.brand || {};
    return [
      ...(Array.isArray(evidence.mention) ? evidence.mention : []),
      ...(Array.isArray(evidence.recommendation) ? evidence.recommendation : []),
      ...(Array.isArray(evidence.rank) ? evidence.rank : []),
    ].filter((item, index, rows) => item && rows.indexOf(item) === index);
  };

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

  const exportPdf = async () => {
    if (!report || !reportSheetRef.current) return;
    setPdfExporting(true);
    setPdfLayout(true);
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      }));
      await new Promise<void>((resolve) => window.setTimeout(resolve, 300));
      await downloadQuestionSetReportPdf(
        reportSheetRef.current,
        `${safeFilename(report.question_set_name)}-${report.id}`,
      );
      message.success('PDF 已下载');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出 PDF 失败');
    } finally {
      setPdfLayout(false);
      setPdfExporting(false);
    }
  };

  const pauseRun = async () => {
    if (!projectId || !report || !report.capabilities?.can_pause) return;
    try {
      await axios.post(`/api/geo-projects/${projectId}/question-set-runs/${report.id}/pause`);
      message.success('已发送暂停信号，运行会在当前任务完成后暂停');
      loadReport(projectId, report.id, true);
    } catch (error) {
      message.error(getApiErrorMessage(error, '暂停运行失败'));
    }
  };

  const resumeRun = async () => {
    if (!projectId || !report || !report.capabilities?.can_resume) return;
    try {
      await axios.post(`/api/geo-projects/${projectId}/question-set-runs/${report.id}/resume`);
      message.success('运行已恢复');
      loadReport(projectId, report.id, true);
    } catch (error) {
      message.error(getApiErrorMessage(error, '恢复运行失败'));
    }
  };

  const retryFailedRows = async () => {
    if (!projectId || !report || !report.capabilities?.can_retry) return;
    setRetrying(true);
    try {
      const idempotencyKey = window.crypto.randomUUID();
      const response = await axios.post(
        `/api/geo-projects/${projectId}/question-set-runs/${report.id}/retry-failed`,
        { idempotency_key: idempotencyKey },
      );
      message.success(response?.data?.message || '失败项已重新提交');
      await Promise.all([
        loadReport(projectId, report.id, true),
        loadHistory(projectId, historyPage, historyQuestionSetId),
      ]);
    } catch (error) {
      message.error(getApiErrorMessage(error, '重试失败项失败'));
    } finally {
      setRetrying(false);
    }
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
      setHistoryQuestionSetId(undefined);
      await loadHistory(projectId, 1);
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
      width: pdfLayout ? PDF_COLUMN_WIDTHS.question : 300,
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
      width: pdfLayout ? PDF_COLUMN_WIDTHS.platform : 180,
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
      width: pdfLayout ? PDF_COLUMN_WIDTHS.status : 90,
      render: (value: string) => value === 'completed'
        ? <Tag color="success">完成</Tag>
        : value === 'failed'
          ? <Tag color="error">失败</Tag>
          : <Tag color="processing" icon={<LoadingOutlined spin />}>进行中</Tag>,
    },
    {
      title: '品牌表现',
      key: 'brand',
      width: pdfLayout ? PDF_COLUMN_WIDTHS.brand : 180,
      render: (_: unknown, row: ReportRow) => row.has_metrics ? (
        <Space wrap size={[4, 4]}>
          <Tag color={row.brand_mentioned ? 'blue' : 'default'}>{row.brand_mentioned ? '已提及' : '未提及'}</Tag>
          {row.brand_recommended ? <Tag color="green">明确推荐</Tag> : null}
          {hasCompetitorBaseline ? <Text type="secondary">SOV {percent(row.share_of_voice)}%</Text> : null}
        </Space>
      ) : '-',
    },
    {
      title: '排名',
      dataIndex: 'brand_rank',
      width: pdfLayout ? PDF_COLUMN_WIDTHS.rank : 80,
      render: formatRank,
    },
    {
      title: '明确引用',
      dataIndex: 'citation_count',
      width: pdfLayout ? PDF_COLUMN_WIDTHS.citations : 70,
      render: (value: number) => Number(value || 0),
    },
    {
      title: '情绪',
      dataIndex: 'sentiment',
      width: pdfLayout ? PDF_COLUMN_WIDTHS.sentiment : 80,
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
            icon={<HistoryOutlined />}
            disabled={!projectId}
            onClick={() => setHistoryOpen(true)}
          >
            历史报告
          </Button>
          <Button
            icon={<ReloadOutlined />}
            loading={historyLoading || reportLoading}
            disabled={!projectId}
            onClick={() => {
              loadHistory(projectId, historyPage, historyQuestionSetId);
              loadReport(projectId, runId);
            }}
          >
            刷新
          </Button>
        </Space>
      </div>

      <QuestionSetRunHistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        items={history}
        loading={historyLoading}
        currentRunId={runId}
        page={historyPage}
        pageSize={HISTORY_PAGE_SIZE}
        total={historyTotal}
        questionSets={questionSets}
        selectedQuestionSetId={historyQuestionSetId}
        onQuestionSetChange={(nextQuestionSetId) => {
          setHistoryQuestionSetId(nextQuestionSetId);
          setHistory([]);
          loadHistory(projectId, 1, nextQuestionSetId);
        }}
        onPageChange={(page) => loadHistory(projectId, page, historyQuestionSetId)}
        onRefresh={() => loadHistory(projectId, historyPage, historyQuestionSetId)}
        onOpenReport={(nextRunId) => {
          selectRun(nextRunId);
          setHistoryOpen(false);
        }}
      />

      <main
        ref={reportSheetRef}
        className={`${styles.reportSheet} ${pdfLayout ? styles.pdfLayout : ''}`}
        aria-busy={reportLoading || pdfExporting}
      >
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
                      {report.source === 'imported'
                        ? <Tag>导入报告 · 只读</Tag>
                        : <Tag variant="filled">运行 #{report.id}</Tag>}
                      {report.integrity?.status === 'snapshot_only'
                        ? <Tag color="warning">仅快照</Tag>
                        : null}
                    </Space>
                    <Title level={2}>{report.question_set_name}</Title>
                    <Text type="secondary">
                      {selectedProject?.name || '品牌项目'} · 开始于 {formatDate(report.started_at || report.created_at)}
                    </Text>
                  </div>
                  <Space wrap className={styles.reportActions} data-pdf-exclude="true">
                    {report.capabilities?.can_retry ? (
                        <Popconfirm
                          title={`重试 ${summary.failed || 0} 条失败项？`}
                          description="已有完整原回答的分析失败项只会重做结构化分析；其余失败项才会使用当前设置中心的监测模型和参数重新调用。不可用平台会跳过。"
                          okText="确认重试"
                          cancelText="取消"
                          onConfirm={retryFailedRows}
                        >
                          <Button icon={<ReloadOutlined />} loading={retrying}>
                            重试失败项（{summary.failed || 0}）
                          </Button>
                        </Popconfirm>
                      ) : null}
                    {report.capabilities?.can_pause ? (
                      <Button
                        icon={<PauseCircleOutlined />}
                        onClick={pauseRun}
                      >
                        暂停
                      </Button>
                    ) : null}
                    {report.capabilities?.can_resume ? (
                      <Button
                        type="primary"
                        icon={<CaretRightOutlined />}
                        onClick={resumeRun}
                      >
                        继续运行
                      </Button>
                    ) : null}
                    <Button icon={<FilePdfOutlined />} loading={pdfExporting} onClick={exportPdf}>导出 PDF</Button>
                    <Button icon={<DownloadOutlined />} onClick={exportReport}>导出标准 CSV</Button>
                  </Space>
                </header>

                {runStateNotice ? (
                  <Alert
                    type={runStateNotice.type}
                    showIcon
                    title={runStateNotice.title}
                    description={runStateNotice.description}
                    className={styles.runningAlert}
                  />
                ) : null}

                {hasLegacyAnalysis ? (
                  <Alert
                    type="warning"
                    showIcon
                    title="这份历史报告包含旧规则指标"
                    description="旧记录沿用生成当时的文本规则，只用于历史回看，不代表当前结构化口径。重新运行问题集后，新记录才会使用“AI 抽取指标原料、程序统一计算指标”的口径。"
                    className={styles.runningAlert}
                  />
                ) : null}

                <section className={styles.metricsSection} aria-label="本次运行指标">
                  <div className={styles.metricsHeading}>
                    <div>
                      <Text className={styles.panelKicker}>OUTCOME METRICS</Text>
                      <Title level={4}>核心指标</Title>
                    </div>
                    <Text type="secondary">先确认样本是否充足，再看品牌有没有被提及、推荐和排在前面</Text>
                  </div>
                  <div className={styles.primaryMetrics}>
                    <MetricItem
                      label="有效样本"
                      value={`${summary.valid_analyses || 0} / ${summary.total || 0}`}
                      help="通过 JSON 结构校验、实体关系校验和短实体词原回答定位校验的已完成分析数 ÷ 本次计划任务数。调用失败、结构无效或仍在进行中的任务不进入各项比率计算。"
                    />
                    <MetricItem
                      label="品牌提及率"
                      value={`${percent(summary.brand_mention_rate)}%`}
                      help="至少存在 1 条目标品牌结构化提及记录的有效分析数 ÷ 有效分析数。分析模型先把目标品牌显式映射到回答实体；每条提及只保留品牌名或别名等短实体词，并须能按顺序在原回答中定位。是否提及和百分比由程序计数，分析模型不直接返回。"
                    />
                    <MetricItem
                      label="推荐率"
                      value={`${percent(summary.recommendation_rate)}%`}
                      help="至少存在 1 条目标品牌明确推荐关系的有效分析数 ÷ 有效分析数。仅客观列举不算推荐，程序根据明确推荐关系计算是否推荐和推荐率，分析模型不直接返回布尔值或比例。"
                    />
                    <MetricItem
                      label="平均品牌排名"
                      value={formatRank(summary.avg_brand_rank)}
                      help="程序读取分析模型显式映射的目标实体，并根据首个明确排序列表中的 entries 数组位置求平均。普通项目符号或正文首次出现位置不是排名；没有明确排序时显示“-”，是否配置竞品不影响目标品牌自身排名。"
                    />
                  </div>

                  <Collapse
                    className={styles.metricsCollapse}
                    activeKey={metricsExpanded || pdfLayout ? ['more-metrics'] : []}
                    onChange={(keys) => setMetricsExpanded(
                      Array.isArray(keys) ? keys.includes('more-metrics') : keys === 'more-metrics'
                    )}
                    items={[{
                      key: 'more-metrics',
                      label: (
                        <span className={styles.moreMetricsLabel}>
                          <Text strong>更多指标</Text>
                          <Text type="secondary">{hasCompetitorBaseline ? '竞品声量、明确引用和执行情况' : '明确引用和执行情况'}</Text>
                        </span>
                      ),
                      children: (
                        <div className={styles.secondaryMetrics}>
                          {hasCompetitorBaseline ? (
                            <MetricItem
                              label="平均 SOV"
                              value={`${percent(summary.avg_share_of_voice)}%`}
                              help="仅在项目配置竞品时展示。每条有效回答按结构化提及次数计数：品牌提及次数 ÷ 品牌与已配置竞品提及总次数；再对有效回答取平均。排名、推荐和未配置的其他品牌不加分。"
                            />
                          ) : null}
                          <MetricItem
                            label="明确引用率"
                            value={Number(summary.citation_valid_analyses || 0) > 0
                              ? `${percent(summary.citation_rate)}%`
                              : '暂无可验证样本'}
                            help="回答中至少包含 1 条平台明确引用标记的可验证分析数 ÷ 明确引用口径可验证分析数。正文链接、检索候选、分析模型补充来源和历史混合来源均不计入。"
                          />
                          <MetricItem
                            label="官网明确引用率"
                            value={selectedProject?.website
                              ? (Number(summary.citation_valid_analyses || 0) > 0
                                  ? `${percent(summary.owned_citation_rate)}%`
                                  : '暂无可验证样本')
                              : '未配置官网'}
                            help="至少明确引用 1 次品牌官网的可验证分析数 ÷ 明确引用口径可验证分析数。引用域名等于品牌项目中配置的官网域名或其子域名时，计为官网引用；未配置官网时无法识别。"
                          />
                          <MetricItem
                            label="官网明确引用次数"
                            value={selectedProject?.website ? (summary.total_owned_citations || 0) : '未配置官网'}
                            help="本次所有有效分析中，引用域名属于品牌官网或其子域名的引用条数合计。"
                          />
                          <MetricItem
                            label="明确引用总次数"
                            value={summary.total_citations || 0}
                            help="本次所有有效分析中，平台明确标注为引用的来源条数合计；历史混合来源不进入此指标。"
                          />
                          <MetricItem
                            label="执行状态"
                            value={`${summary.completed || 0} / ${summary.failed || 0} / ${summary.pending || 0}`}
                            help="依次为已完成、失败和进行中的任务数。三项合计应等于本次计划任务数。"
                          />
                        </div>
                      ),
                    }]}
                  />
                </section>

                <section className={styles.resultsSection} aria-labelledby="run-results-title">
                  <div className={styles.resultsHeading}>
                    <div>
                      <Text className={styles.panelKicker}>每个问题 × 全部项目模型</Text>
                      <Title level={4} id="run-results-title">逐问题结果</Title>
                    </div>
                    <Text type="secondary">有效分析 {summary.valid_analyses || 0} · 明确引用 {summary.total_citations || 0}</Text>
                  </div>
                  <Table<ReportRow>
                    size="small"
                    rowKey={reportRowKey}
                    columns={rowColumns}
                    dataSource={report.rows || []}
                    pagination={pdfLayout ? false : { pageSize: 20, showSizeChanger: false }}
                    scroll={{ x: pdfLayout ? 880 : 1080 }}
                    locale={{ emptyText: '本次运行暂无结果' }}
                    expandable={{
                      showExpandColumn: !pdfLayout,
                      expandedRowKeys: pdfLayout
                        ? (report.rows || []).map(reportRowKey)
                        : undefined,
                      expandedRowRender: (row) => (
                        <div className={styles.answerPanel}>
                          {row.error_message ? <Alert type="error" showIcon title={row.error_message} /> : null}
                          {row.analysis_diagnostics ? (
                            <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }} bordered>
                              <Descriptions.Item label="错误代码">
                                {row.analysis_diagnostics.error_code || '-'}
                              </Descriptions.Item>
                              <Descriptions.Item label="失败阶段">
                                {row.analysis_diagnostics.stage || '-'}
                              </Descriptions.Item>
                              <Descriptions.Item label="尝试次数">
                                {row.analysis_diagnostics.attempt_count ?? '-'}
                              </Descriptions.Item>
                              <Descriptions.Item label="分析模型">
                                {[row.analysis_diagnostics.platform, row.analysis_diagnostics.model]
                                  .filter(Boolean)
                                  .join(' · ') || '-'}
                              </Descriptions.Item>
                              <Descriptions.Item label="结束原因">
                                {row.analysis_diagnostics.finish_reason || '-'}
                              </Descriptions.Item>
                              <Descriptions.Item label="输出长度">
                                {row.analysis_diagnostics.output_length == null
                                  ? '-'
                                  : `${row.analysis_diagnostics.output_length} 字符`}
                              </Descriptions.Item>
                              {row.analysis_diagnostics.error_detail ? (
                                <Descriptions.Item label="校验详情" span={3}>
                                  {row.analysis_diagnostics.error_detail}
                                </Descriptions.Item>
                              ) : null}
                              {row.analysis_diagnostics.usage?.total_tokens != null ? (
                                <Descriptions.Item label="Token 用量" span={3}>
                                  输入 {row.analysis_diagnostics.usage.prompt_tokens ?? '-'} ·
                                  输出 {row.analysis_diagnostics.usage.completion_tokens ?? '-'} ·
                                  总计 {row.analysis_diagnostics.usage.total_tokens}
                                </Descriptions.Item>
                              ) : null}
                            </Descriptions>
                          ) : null}
                          {row.failure || row.retry ? (
                            <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }} bordered>
                              {row.failure ? (
                                <>
                                  <Descriptions.Item label="失败链路">
                                    {row.failure.stage || '-'}
                                  </Descriptions.Item>
                                  <Descriptions.Item label="链路错误代码">
                                    {row.failure.error_code || '-'}
                                  </Descriptions.Item>
                                </>
                              ) : null}
                              {row.retry ? (
                                <>
                                  <Descriptions.Item label="重试方式">
                                    {row.retry.kind === 'analysis_only' ? '仅重做结构化分析' : '重新调用监测平台'}
                                  </Descriptions.Item>
                                  <Descriptions.Item label="重试次数">
                                    {row.retry.attempt ?? '-'}
                                  </Descriptions.Item>
                                  <Descriptions.Item label="上一条记录">
                                    {row.retry.previous_record_id ?? '-'}
                                  </Descriptions.Item>
                                </>
                              ) : null}
                            </Descriptions>
                          ) : null}
                          {row.has_metrics ? (
                            <Space wrap size={6}>
                              <Text className={styles.answerLabel}>分析方式</Text>
                              {row.analysis_method === 'ai_structured_v2'
                                ? <Tag color="blue">AI 结构化 v2</Tag>
                                : row.analysis_method === 'ai_structured_v1'
                                  ? <Tag>AI 结构化 v1（历史）</Tag>
                                  : <Tag>历史规则</Tag>}
                              {row.analysis_platform ? (
                                <Text type="secondary">
                                  {row.analysis_platform}{row.analysis_model ? ` · ${row.analysis_model}` : ''}
                                </Text>
                              ) : null}
                            </Space>
                          ) : null}
                          {Array.isArray(row.analysis_structure?.entities)
                            && row.analysis_structure.entities.length ? (
                            <div>
                              <Text className={styles.answerLabel}>识别到的品牌 / 公司</Text>
                              <Space wrap size={[4, 4]}>
                                {row.analysis_structure.entities.map((entity, index) => (
                                  <Tag
                                    key={`${entity.name || 'entity'}-${index}`}
                                    color={entity.name === row.analysis_structure?.target_entity_name ? 'blue' : undefined}
                                  >
                                    {entity.name || '-'} · {entity.type === 'company' ? '公司' : '品牌'}
                                  </Tag>
                                ))}
                              </Space>
                              <div>
                                <Text type="secondary">
                                  目标品牌映射：
                                  {row.analysis_structure.target_entity_name || '回答中未识别到'}
                                </Text>
                              </div>
                            </div>
                          ) : null}
                          {Array.isArray(row.analysis_structure?.candidate_lists)
                            && row.analysis_structure.candidate_lists.length ? (
                            <div>
                              <Text className={styles.answerLabel}>候选顺序</Text>
                              <Space orientation="vertical" size={4}>
                                {row.analysis_structure.candidate_lists.map((list, index) => (
                                  <Text key={`candidate-list-${index}`}>
                                    {list.ordered ? '明确排序' : '普通列表'}：
                                    {(list.entries || []).join(' → ') || '-'}
                                  </Text>
                                ))}
                              </Space>
                            </div>
                          ) : null}
                          {Array.isArray(row.analysis_structure?.claims)
                            && row.analysis_structure.claims.length ? (
                            <div>
                              <Text className={styles.answerLabel}>待核验事实声明</Text>
                              <Space orientation="vertical" size={4}>
                                {row.analysis_structure.claims.map((claim, index) => (
                                  <Text key={`claim-${index}`}>
                                    {claim.subject_name || '-'} · {claim.predicate || '-'}：
                                    {claim.value || '-'}
                                    {claim.qualifier ? `（${claim.qualifier}）` : ''}
                                  </Text>
                                ))}
                              </Space>
                            </div>
                          ) : null}
                          {row.analysis_method === 'ai_structured_v1' && brandEvidence(row).length ? (
                            <div>
                              <Text className={styles.answerLabel}>历史 v1 分析依据</Text>
                              <Space orientation="vertical" size={4}>
                                {brandEvidence(row).map((quote) => (
                                  <Text key={quote}>“{quote}”</Text>
                                ))}
                              </Space>
                            </div>
                          ) : null}
                          <Text className={styles.answerLabel}>AI 原始回答</Text>
                          <Paragraph className={styles.answerText}>
                            {pdfLayout
                              ? (row.answer || '暂无回答内容').split(/\r?\n/).map((line, index) => (
                                  <span
                                    key={`answer-line-${index}`}
                                    className={styles.pdfAnswerLine}
                                    data-pdf-breakpoint="true"
                                  >
                                    {line || '\u00A0'}
                                  </span>
                                ))
                              : (row.answer || '暂无回答内容')}
                          </Paragraph>
                          {row.citation_evidence_status === 'legacy_unverified' ? (
                            <Alert
                              type="warning"
                              showIcon
                              title={`历史混合来源${row.legacy_citation_count ? ` · ${row.legacy_citation_count} 条` : ''}，不计入明确引用 KPI`}
                              description="旧记录无法可靠区分明确引用、正文链接和检索候选，因此只作历史参考，不再计入引用率和引用次数。"
                            />
                          ) : null}
                          {Array.isArray(row.citation_sources) && row.citation_sources.length ? (
                            <Space orientation="vertical" size={4}>
                              <Text className={styles.answerLabel}>明确引用来源（计入核心 KPI）</Text>
                              {row.citation_sources.map((source, index) => source.url ? (
                                <Space key={`${source.url}-${index}`} size={6}>
                                  {source.owned ? <Tag color="green">品牌官网</Tag> : null}
                                  <a href={source.url} target="_blank" rel="noreferrer">
                                    {source.title || source.domain || source.url}
                                  </a>
                                </Space>
                              ) : null)}
                            </Space>
                          ) : null}
                          {Array.isArray(row.legacy_citation_sources) && row.legacy_citation_sources.length ? (
                            <Collapse
                              size="small"
                              items={[{
                                key: 'legacy-mixed-sources',
                                label: `历史混合来源（仅供参考）· ${row.legacy_citation_sources.length}`,
                                children: (
                                  <Space orientation="vertical" size={4}>
                                    {row.legacy_citation_sources.slice(0, 20).map((source, index) => (
                                      <Text key={`${source.url || source.domain || 'legacy'}-${index}`}>
                                        {source.title || source.domain || source.url || '未知来源'}
                                      </Text>
                                    ))}
                                    {row.legacy_citation_sources.length > 20
                                      ? <Text type="secondary">仅展示前 20 条历史来源</Text>
                                      : null}
                                  </Space>
                                ),
                              }]}
                            />
                          ) : null}
                          {row.analysis_structure?.citations?.source_groups ? (
                            <Collapse
                              size="small"
                              items={[
                                {
                                  key: 'response-links',
                                  label: `回答正文链接（不计入 KPI）· ${
                                    row.analysis_structure.citations.source_groups.response_links?.length || 0
                                  }`,
                                  children: (
                                    <Space orientation="vertical" size={4}>
                                      {(row.analysis_structure.citations.source_groups.response_links || [])
                                        .slice(0, 20)
                                        .map((source, index) => source.url ? (
                                          <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer">
                                            {source.title || source.domain || source.url}
                                          </a>
                                        ) : null)}
                                    </Space>
                                  ),
                                },
                                {
                                  key: 'retrieval-sources',
                                  label: `平台检索候选（不计入 KPI）· ${
                                    row.analysis_structure.citations.source_groups.retrieval_sources?.length || 0
                                  }`,
                                  children: (
                                    <Space orientation="vertical" size={4}>
                                      {(row.analysis_structure.citations.source_groups.retrieval_sources || [])
                                        .slice(0, 20)
                                        .map((source, index) => source.url ? (
                                          <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer">
                                            {source.title || source.domain || source.url}
                                          </a>
                                        ) : null)}
                                      {(row.analysis_structure.citations.source_groups.retrieval_sources?.length || 0) > 20
                                        ? <Text type="secondary">仅展示前 20 条候选来源</Text>
                                        : null}
                                    </Space>
                                  ),
                                },
                                {
                                  key: 'analysis-sources',
                                  label: `分析模型补充来源（不计入 KPI）· ${
                                    row.analysis_structure.citations.source_groups.analysis_sources?.length || 0
                                  }`,
                                  children: (
                                    <Space orientation="vertical" size={4}>
                                      {(row.analysis_structure.citations.source_groups.analysis_sources || [])
                                        .slice(0, 20)
                                        .map((source, index) => source.url ? (
                                          <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer">
                                            {source.title || source.domain || source.url}
                                          </a>
                                        ) : null)}
                                    </Space>
                                  ),
                                },
                              ]}
                            />
                          ) : null}
                        </div>
                      ),
                      rowExpandable: (row) => Boolean(
                        row.answer
                        || row.error_message
                        || row.failure
                        || row.retry
                        || row.citation_sources?.length
                        || row.has_metrics
                      ),
                    }}
                  />
                </section>
              </>
            )}
      </main>
    </div>
  );
}
