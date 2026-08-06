// @ts-nocheck
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Col, Descriptions, Empty, Row, Select, Space, Statistic, Table, Tag, Typography, message } from 'antd';
import axios from 'axios';
import { getSelectableProjects, resolveSelectedProjectId } from '@/utils/projectSelection.cjs';
import { buildReportCsv } from '@/utils/reportCsv.cjs';
import { getApiErrorMessage } from '@/utils/apiErrorMessage.cjs';
import { getSovPresentationTitle, isCurrentReportSnapshot } from '@/utils/metricSemantics.cjs';
import { useAIPlatformCatalog } from '@/lib/useAIPlatformCatalog';

const { Text, Title } = Typography;

const typeColor = {
  自有来源: 'green',
  竞品来源: 'red',
  社区问答: 'blue',
  电商平台: 'orange',
  百科资料: 'purple',
  视频内容: 'cyan',
  媒体内容: 'geekblue',
  第三方来源: 'default',
  未知来源: 'default',
};

const periodOptions = [
  { label: '近 7 天', value: 7 },
  { label: '近 30 天', value: 30 },
  { label: '近 90 天', value: 90 },
];

function extractList(res) {
  const data = res?.data?.data ?? res?.data ?? [];
  return Array.isArray(data) ? data : [];
}

function percent(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

function nullablePercent(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function formatRate(value, numerator, denominator) {
  const rate = nullablePercent(value);
  const valid = Number(denominator || 0);
  return rate === null
    ? `—（有效回答 ${valid}）`
    : `${rate}%（${Number(numerator || 0)} / ${valid}）`;
}

function formatSov(summary) {
  const value = nullablePercent(summary?.average);
  const count = Number(summary?.calculable_answers || 0);
  return value === null
    ? `—（有效回答 ${count}）`
    : `${value}%（有效回答 ${count}）`;
}

function formatCitationRate(value, row) {
  return Number(row?.citation_eligible_checks || 0) > 0 ? `${percent(value)}%` : '暂无可验证样本';
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false });
}

function safeFilePart(value, fallback = 'report') {
  const text = String(value || '').trim();
  const safe = text.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 80);
  return safe || fallback;
}

function formatRank(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? Number(n.toFixed(2)) : '—';
}

function renderTags(values, fallbackMap = {}) {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!list.length) return '—';
  return (
    <Space size={[4, 4]} wrap>
      {list.map((item) => <Tag key={item}>{fallbackMap[item] || item}</Tag>)}
    </Space>
  );
}

function formatOpportunityScope(item, platformLabel = {}) {
  const platform = item?.platform ? (platformLabel[item.platform] || item.platform) : '';
  const domain = item?.domain || '';
  if (platform && domain) return `${platform} / ${domain}`;
  return platform || domain || item?.competitor || '';
}

export default function GeoReportsPage() {
  const { labels: platformLabel } = useAIPlatformCatalog();
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState();
  const [report, setReport] = useState(null);
  const [days, setDays] = useState(30);
  const [platform, setPlatform] = useState('all');
  const [projectLoading, setProjectLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const reportRequestRef = useRef(0);

  const invalidateReportRequest = () => {
    reportRequestRef.current += 1;
  };

  const handleProjectChange = (value) => {
    invalidateReportRequest();
    setProjectId(value);
    setPlatform('all');
    setReport(null);
    setReportLoading(false);
  };

  const handleDaysChange = (value) => {
    invalidateReportRequest();
    setDays(value);
    setPlatform('all');
    setReport(null);
    setReportLoading(false);
  };

  const handlePlatformChange = (value) => {
    setPlatform(value);
  };

  const fetchProjects = useCallback(async () => {
    setProjectLoading(true);
    try {
      const res = await axios.get('/api/geo-projects');
      const rows = getSelectableProjects(extractList(res));
      setProjects(rows);
      setProjectId((current) => resolveSelectedProjectId(rows, current));
    } catch (error) {
      message.error(getApiErrorMessage(error, '获取品牌项目失败'));
    } finally {
      setProjectLoading(false);
    }
  }, []);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  const loadLatestReport = useCallback(async (targetProjectId, targetDays) => {
    const requestId = reportRequestRef.current + 1;
    reportRequestRef.current = requestId;
    if (!targetProjectId) {
      setReport(null);
      setReportLoading(false);
      return;
    }
    setReport(null);
    setReportLoading(true);
    try {
      const res = await axios.get(`/api/geo-projects/${targetProjectId}/reports/latest`, {
        params: { days: targetDays },
      });
      if (reportRequestRef.current === requestId) {
        setPlatform('all');
        setReport(res?.data?.data || null);
      }
    } catch (error) {
      if (reportRequestRef.current === requestId) {
        setReport(null);
        message.error(getApiErrorMessage(error, '获取最新报告失败'));
      }
    } finally {
      if (reportRequestRef.current === requestId) setReportLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLatestReport(projectId, days);
  }, [projectId, days, loadLatestReport]);

  const selectedProject = useMemo(() => projects.find((item) => item.id === projectId), [projects, projectId]);
  const summary = report?.summary || {};
  const isCurrentReport = isCurrentReportSnapshot(
    report?.metric_semantics_version,
    summary?.metric_semantics_version
  ) && summary?.metric_views;
  const availablePlatforms = Array.isArray(summary.available_platforms) ? summary.available_platforms : [];
  const metricViews = summary.metric_views || {};
  const selectedPlatformView = platform === 'all'
    ? metricViews.all
    : (Array.isArray(metricViews.platforms)
        ? metricViews.platforms.find((item) => item.platform === platform)
        : null);
  const metricSummary = isCurrentReport ? (selectedPlatformView?.summary || {}) : summary;
  const currentSovTitle = getSovPresentationTitle(metricSummary.sov_summary);
  const platforms = Array.isArray(summary.platforms) ? summary.platforms : [];
  const competitors = Array.isArray(summary.competitors) ? summary.competitors : [];
  const categories = Array.isArray(summary.categories) ? summary.categories : [];
  const trend = isCurrentReport
    ? (Array.isArray(selectedPlatformView?.trend) ? selectedPlatformView.trend : [])
    : (Array.isArray(summary.trend) ? summary.trend : []);
  const sourceSummary = summary.source_summary || {};
  const sourceTypes = Array.isArray(summary.source_types) ? summary.source_types : [];
  const sourceDomains = Array.isArray(summary.source_domains) ? summary.source_domains : [];
  const sourceUrls = Array.isArray(summary.source_urls) ? summary.source_urls : [];
  const sourceChanges = summary.source_changes || {};
  const newDomains = Array.isArray(sourceChanges.new_domains) ? sourceChanges.new_domains : [];
  const droppedDomains = Array.isArray(sourceChanges.dropped_domains) ? sourceChanges.dropped_domains : [];
  const retainedDomains = Array.isArray(sourceChanges.retained_domains) ? sourceChanges.retained_domains : [];
  const newUrls = Array.isArray(sourceChanges.new_urls) ? sourceChanges.new_urls : [];
  const droppedUrls = Array.isArray(sourceChanges.dropped_urls) ? sourceChanges.dropped_urls : [];
  const retainedUrls = Array.isArray(sourceChanges.retained_urls) ? sourceChanges.retained_urls : [];
  const opportunities = Array.isArray(summary.opportunities) ? summary.opportunities : [];

  const generateReport = async () => {
    if (!projectId) return;
    const requestId = reportRequestRef.current + 1;
    reportRequestRef.current = requestId;
    setReportLoading(true);
    try {
      const res = await axios.post(`/api/geo-projects/${projectId}/reports/generate`, { days });
      if (reportRequestRef.current === requestId) {
        setPlatform('all');
        setReport(res?.data?.data || null);
        message.success(`${days} 天报告快照已生成`);
      }
    } catch (error) {
      if (reportRequestRef.current === requestId) {
        message.error(getApiErrorMessage(error, '生成报告失败'));
      }
    } finally {
      if (reportRequestRef.current === requestId) setReportLoading(false);
    }
  };

  const exportCsv = () => {
    if (!report) return;
    let csv;
    try {
      csv = buildReportCsv({
        summary,
        reportMetricSemanticsVersion: report.metric_semantics_version,
        platformLabel,
        websiteConfigured: Boolean(selectedProject?.website || report?.project?.website)
      });
    } catch {
      message.error('报告指标版本不一致，无法导出 CSV');
      return;
    }
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `geo-report-${safeFilePart(selectedProject?.name || projectId)}-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const platformColumns = [
    { title: '平台', dataIndex: 'platform', render: (value) => platformLabel[value] || value || '未知' },
    { title: isCurrentReport ? '有效回答' : '检查数', dataIndex: isCurrentReport ? 'valid_answers' : 'checks', width: 100, render: (value) => Number(value || 0) },
    {
      title: '品牌提及率',
      dataIndex: 'brand_mention_rate',
      width: 160,
      render: (value, row) => isCurrentReport
        ? formatRate(value, row.brand_mentioned_answers, row.brand_mention_assessed_answers ?? row.valid_answers)
        : `${percent(value)}%`
    },
    {
      title: isCurrentReport ? currentSovTitle : '平均声量占比（SOV）',
      dataIndex: isCurrentReport ? 'sov_summary' : 'avg_share_of_voice',
      width: 210,
      render: (value) => isCurrentReport ? formatSov(value) : `${percent(value)}%`
    },
    { title: '引用率', dataIndex: 'citation_rate', width: 110, render: formatCitationRate },
    {
      title: isCurrentReport ? '推荐率（AI 语义分析）' : '推荐率',
      dataIndex: 'recommendation_rate',
      width: 150,
      render: (value, row) => isCurrentReport
        ? formatRate(value, row.recommended_answers, row.recommendation_assessed_answers ?? row.valid_answers)
        : `${percent(value)}%`
    },
    {
      title: isCurrentReport ? '明确有序榜单平均排名' : '平均排名',
      dataIndex: 'avg_brand_rank',
      width: 160,
      render: formatRank
    },
  ];

  const competitorColumns = isCurrentReport ? [
    { title: '竞品', dataIndex: 'name' },
    { title: '提及次数', dataIndex: 'mentions', width: 120, render: (value) => Number(value || 0) },
    { title: '出现回答数', dataIndex: 'appeared_answers', width: 130, render: (value) => Number(value || 0) },
  ] : [
    { title: '竞品', dataIndex: 'name' },
    { title: '提及次数', dataIndex: 'mentions', width: 120, render: (value) => Number(value || 0) },
    { title: '出现检查数', dataIndex: 'appeared_checks', width: 130, render: (value) => Number(value || 0) },
    { title: '可见度得分', dataIndex: 'visibility_score', width: 120, render: (value) => Number(value || 0) },
  ];

  const trendColumns = [
    { title: '日期', dataIndex: 'date', width: 140 },
    { title: isCurrentReport ? '有效回答' : '检查数', dataIndex: isCurrentReport ? 'valid_answers' : 'checks', width: 100, render: (value) => Number(value || 0) },
    {
      title: '品牌提及率',
      dataIndex: 'brand_mention_rate',
      width: 160,
      render: (value, row) => isCurrentReport
        ? formatRate(value, row.brand_mentioned_answers, row.brand_mention_assessed_answers ?? row.valid_answers)
        : `${percent(value)}%`
    },
    {
      title: isCurrentReport ? currentSovTitle : '平均声量占比（SOV）',
      dataIndex: isCurrentReport ? 'sov_summary' : 'avg_share_of_voice',
      width: 210,
      render: (value) => isCurrentReport ? formatSov(value) : `${percent(value)}%`
    },
    { title: '引用率', dataIndex: 'citation_rate', width: 110, render: formatCitationRate },
    {
      title: isCurrentReport ? '推荐率（AI 语义分析）' : '推荐率',
      dataIndex: 'recommendation_rate',
      width: 150,
      render: (value, row) => isCurrentReport
        ? formatRate(value, row.recommended_answers, row.recommendation_assessed_answers ?? row.valid_answers)
        : `${percent(value)}%`
    },
  ];

  const categoryColumns = [
    { title: '分类', dataIndex: 'category' },
    { title: '问题数', dataIndex: 'prompt_count', width: 100, render: (value) => Number(value || 0) },
    { title: '启用问题', dataIndex: 'enabled_prompt_count', width: 110, render: (value) => Number(value || 0) },
    { title: '运行数', dataIndex: 'total_runs', width: 90, render: (value) => Number(value || 0) },
    { title: '失败数', dataIndex: 'failed_runs', width: 90, render: (value) => Number(value || 0) },
    { title: '失败率', dataIndex: 'failure_rate', width: 90, render: (value) => `${percent(value)}%` },
    { title: isCurrentReport ? '有效回答' : '有效分析', dataIndex: isCurrentReport ? 'valid_answers' : 'checks', width: 100, render: (value) => Number(value || 0) },
    {
      title: '品牌提及率',
      dataIndex: 'brand_mention_rate',
      width: 160,
      render: (value, row) => isCurrentReport
        ? formatRate(value, row.brand_mentioned_answers, row.brand_mention_assessed_answers ?? row.valid_answers)
        : `${percent(value)}%`
    },
    {
      title: isCurrentReport ? currentSovTitle : '平均声量占比（SOV）',
      dataIndex: isCurrentReport ? 'sov_summary' : 'avg_share_of_voice',
      width: 210,
      render: (value) => isCurrentReport ? formatSov(value) : `${percent(value)}%`
    },
    { title: '引用率', dataIndex: 'citation_rate', width: 110, render: formatCitationRate },
    {
      title: isCurrentReport ? '推荐率（AI 语义分析）' : '推荐率',
      dataIndex: 'recommendation_rate',
      width: 150,
      render: (value, row) => isCurrentReport
        ? formatRate(value, row.recommended_answers, row.recommendation_assessed_answers ?? row.valid_answers)
        : `${percent(value)}%`
    },
  ];

  const sourceTypeColumns = [
    {
      title: '来源类型',
      dataIndex: 'type',
      render: (value) => <Tag color={typeColor[value] || 'default'}>{value || '未知来源'}</Tag>,
    },
    { title: '引用次数', dataIndex: 'citation_count', width: 120, render: (value) => Number(value || 0) },
    { title: '覆盖回答', dataIndex: 'response_count', width: 100, render: (value) => Number(value || 0) },
    { title: '域名数', dataIndex: 'domain_count', width: 100, render: (value) => Number(value || 0) },
  ];

  const sourceDomainColumns = [
    { title: '域名', dataIndex: 'domain', width: 220, ellipsis: true },
    {
      title: '类型',
      dataIndex: 'source_type',
      width: 110,
      render: (value) => <Tag color={typeColor[value] || 'default'}>{value || '未知来源'}</Tag>,
    },
    { title: '引用次数', dataIndex: 'citation_count', width: 120, render: (value) => Number(value || 0) },
    { title: '平台', dataIndex: 'platforms', width: 150, render: (value) => renderTags(value, platformLabel) },
    { title: '问题分类', dataIndex: 'categories', width: 180, render: (value) => renderTags(value) },
  ];

  const sourceUrlColumns = [
    {
      title: 'URL',
      dataIndex: 'url',
      width: 360,
      ellipsis: true,
      render: (value) => value ? <a href={value} target="_blank" rel="noreferrer">{value}</a> : '—',
    },
    { title: '域名', dataIndex: 'domain', width: 200, ellipsis: true },
    {
      title: '类型',
      dataIndex: 'source_type',
      width: 110,
      render: (value) => <Tag color={typeColor[value] || 'default'}>{value || '未知来源'}</Tag>,
    },
    { title: '覆盖回答', dataIndex: 'response_count', width: 100, render: (value) => Number(value || 0) },
    { title: '引用次数', dataIndex: 'citation_count', width: 120, render: (value) => Number(value || 0) },
    { title: '平台', dataIndex: 'platforms', width: 150, render: (value) => renderTags(value, platformLabel) },
    { title: '问题分类', dataIndex: 'categories', width: 180, render: (value) => renderTags(value) },
  ];

  const sourceChangeColumns = [
    { title: '域名', dataIndex: 'domain', width: 220, ellipsis: true },
    {
      title: '类型',
      dataIndex: 'source_type',
      width: 110,
      render: (value) => <Tag color={typeColor[value] || 'default'}>{value || '未知来源'}</Tag>,
    },
    { title: '引用次数', dataIndex: 'citation_count', width: 120, render: (value) => Number(value || 0) },
    { title: '平台', dataIndex: 'platforms', width: 150, render: (value) => renderTags(value, platformLabel) },
    { title: '问题分类', dataIndex: 'categories', width: 180, render: (value) => renderTags(value) },
    { title: '最近出现', dataIndex: 'last_seen_at', width: 180, render: formatDate },
  ];

  const sourceUrlChangeColumns = [
    {
      title: 'URL',
      dataIndex: 'url',
      width: 360,
      ellipsis: true,
      render: (value) => value ? <a href={value} target="_blank" rel="noreferrer">{value}</a> : '—',
    },
    { title: '域名', dataIndex: 'domain', width: 200, ellipsis: true },
    {
      title: '类型',
      dataIndex: 'source_type',
      width: 110,
      render: (value) => <Tag color={typeColor[value] || 'default'}>{value || '未知来源'}</Tag>,
    },
    { title: '引用次数', dataIndex: 'citation_count', width: 120, render: (value) => Number(value || 0) },
    { title: '平台', dataIndex: 'platforms', width: 150, render: (value) => renderTags(value, platformLabel) },
    { title: '问题分类', dataIndex: 'categories', width: 180, render: (value) => renderTags(value) },
    { title: '最近出现', dataIndex: 'last_seen_at', width: 180, render: formatDate },
  ];

  const opportunityColumns = [
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 90,
      render: (value) => {
        const color = value === 'high' ? 'red' : value === 'medium' ? 'orange' : 'default';
        const label = value === 'high' ? '高' : value === 'medium' ? '中' : '低';
        return <Tag color={color}>{label}</Tag>;
      },
    },
    { title: '机会类型', dataIndex: 'type', width: 130, render: (value) => <Tag color="blue">{value || '机会'}</Tag> },
    { title: '平台/来源', key: 'scope', width: 130, render: (_, row) => formatOpportunityScope(row, platformLabel) || '—' },
    { title: '对象', key: 'target', width: 240, render: (_, row) => row.prompt || row.domain || row.competitor || row.prompt_category || '—' },
    { title: '证据', dataIndex: 'evidence', width: 280, render: (value) => value || '—' },
    { title: '建议动作', dataIndex: 'recommendation', render: (value) => value || '—' },
  ];

  return (
    <div className="geo-report-page" style={{ padding: 24 }}>
      <style>{`
        html, body { max-width: 100%; overflow-x: clip; }
        .geo-report-page { box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%; overflow-x: hidden; contain: paint; }
        .geo-report-page .ant-space-item,
        .geo-report-page .ant-card-body,
        .geo-report-page .ant-col { min-width: 0; }
        .geo-report-page .ant-statistic-title { color: #42526e !important; }
        @media print {
          body * { visibility: hidden; }
          #geo-report-print, #geo-report-print * { visibility: visible; }
          #geo-report-print { position: absolute; left: 0; top: 0; width: 100%; padding: 24px; }
          .geo-report-actions { display: none !important; }
        }
      `}</style>
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        <Row align="middle" justify="space-between" gutter={[16, 12]} className="geo-report-actions">
          <Col>
            <Title level={3} style={{ margin: 0 }}>项目报告</Title>
            <Text style={{ color: '#42526e' }}>生成并查看指定周期的 GEO 可见度报告快照</Text>
          </Col>
          <Col>
            <Space wrap>
              <Select
                aria-label="品牌项目"
                loading={projectLoading}
                placeholder="选择品牌项目"
                style={{ width: 280 }}
                value={projectId}
                onChange={handleProjectChange}
                options={projects.map((item) => ({ label: item.name, value: item.id }))}
              />
              <Select
                aria-label="报告周期"
                style={{ width: 120 }}
                value={days}
                options={periodOptions}
                onChange={handleDaysChange}
              />
              {isCurrentReport ? (
                <Select
                  aria-label="报告核心指标平台范围"
                  style={{ width: 180 }}
                  value={platform}
                  onChange={handlePlatformChange}
                  options={[
                    { label: '全部平台（合并）', value: 'all' },
                    ...availablePlatforms.map((item) => ({
                      label: platformLabel[item] || item,
                      value: item
                    }))
                  ]}
                />
              ) : null}
              <Button type="primary" style={{ background: '#0b63ce', borderColor: '#0b63ce' }} loading={reportLoading} disabled={!projectId} onClick={generateReport}>生成 {days} 天报告</Button>
              <Button disabled={!report} onClick={() => window.print()}>打印</Button>
              <Button disabled={!report} onClick={exportCsv}>导出 CSV</Button>
            </Space>
          </Col>
        </Row>

        <div id="geo-report-print">
          {!report ? (
            <Card>
              <Empty description="请选择项目并生成报告" />
            </Card>
          ) : (
            <Space orientation="vertical" size={16} style={{ width: '100%' }}>
              <Card>
                <Row gutter={[16, 12]} align="middle" justify="space-between">
                  <Col>
                    <Title level={3} style={{ marginTop: 0 }}>{selectedProject?.name || report?.project?.name || '品牌项目'} {summary.period_days || days} 天可见度报告</Title>
                    <Descriptions size="small" column={{ xs: 1, md: 3 }}>
                      <Descriptions.Item label="周期开始">{formatDate(report.period_start)}</Descriptions.Item>
                      <Descriptions.Item label="周期结束">{formatDate(report.period_end)}</Descriptions.Item>
                      <Descriptions.Item label="生成时间">{formatDate(report.created_at)}</Descriptions.Item>
                    </Descriptions>
                    <Space orientation="vertical" size={4} style={{ marginTop: 12 }}>
                      <Tag color={isCurrentReport ? 'blue' : 'default'}>
                        {isCurrentReport ? '当前回答级竞品提及口径' : '历史竞品配置口径'}
                      </Tag>
                      {isCurrentReport ? (
                        <>
                          <Text type="secondary">{summary.usage_guidance?.monitoring_questions || 'SOV 监测问题应使用非品牌词问题。'}</Text>
                          <Text type="secondary">{summary.usage_guidance?.trend_comparison || '趋势只在稳定的问题集合内比较；问题变更后建立新的比较基线。'}</Text>
                          <Text type="secondary">平台选择只切换快照内的核心品牌指标和趋势；来源与机会仍为全部平台口径。</Text>
                        </>
                      ) : null}
                    </Space>
                  </Col>
                </Row>
              </Card>

              <Row id="geo-report-core-metrics" gutter={[12, 12]}>
                <Col xs={24} sm={12} lg={6}><Card size="small"><Statistic title="总运行数" value={metricSummary.total_runs ?? metricSummary.total_checks ?? 0} /></Card></Col>
                <Col xs={24} sm={12} lg={6}><Card size="small"><Statistic title={isCurrentReport ? '有效回答' : '有效分析数'} value={metricSummary.valid_answers ?? metricSummary.total_checks ?? 0} /></Card></Col>
                <Col xs={24} sm={12} lg={6}><Card size="small"><Statistic title="品牌提及率" value={isCurrentReport ? formatRate(metricSummary.brand_mention_rate, metricSummary.brand_mentioned_answers, metricSummary.brand_mention_assessed_answers ?? metricSummary.valid_answers) : `${percent(metricSummary.brand_mention_rate)}%`} /></Card></Col>
                <Col xs={24} sm={12} lg={6}><Card size="small"><Statistic title={isCurrentReport ? currentSovTitle : '平均声量占比（SOV）'} value={isCurrentReport ? formatSov(metricSummary.sov_summary) : `${percent(metricSummary.avg_share_of_voice)}%`} /></Card></Col>
                <Col xs={24} sm={12} lg={6}><Card size="small"><Statistic title="分析覆盖率" value={isCurrentReport ? formatRate(metricSummary.analysis_coverage_rate, metricSummary.valid_answers, metricSummary.acquired_answers) : '历史报告未记录'} /></Card></Col>
                <Col xs={24} sm={12} lg={6}><Card size="small"><Statistic title="失败数" value={metricSummary.failed_runs || 0} /></Card></Col>
                <Col xs={24} sm={12} lg={6}><Card size="small"><Statistic title="竞品提及次数" value={(isCurrentReport ? metricSummary.competitors || [] : competitors).reduce((sum, item) => sum + Number(item.mentions || 0), 0)} /></Card></Col>
                <Col xs={24} sm={12} lg={6}><Card size="small"><Statistic title="引用率" value={Number(metricSummary.citation_eligible_checks || 0) > 0 ? percent(metricSummary.citation_rate) : '暂无可验证样本'} suffix={Number(metricSummary.citation_eligible_checks || 0) > 0 ? '%' : undefined} /></Card></Col>
                <Col xs={24} sm={12} lg={6}><Card size="small"><Statistic title={isCurrentReport ? '官网引用率' : '自有来源覆盖率'} value={isCurrentReport && !(selectedProject?.website || report?.project?.website) ? '未配置官网' : (Number(metricSummary.citation_eligible_checks || 0) > 0 ? percent(metricSummary.owned_citation_rate) : '暂无可验证样本')} suffix={(!isCurrentReport || Boolean(selectedProject?.website || report?.project?.website)) && Number(metricSummary.citation_eligible_checks || 0) > 0 ? '%' : undefined} /></Card></Col>
                <Col xs={24} sm={12} lg={6}><Card size="small"><Statistic title={isCurrentReport ? '推荐率（AI 语义分析）' : '推荐率'} value={isCurrentReport ? formatRate(metricSummary.recommendation_rate, metricSummary.recommended_answers, metricSummary.recommendation_assessed_answers ?? metricSummary.valid_answers) : `${percent(metricSummary.recommendation_rate)}%`} /></Card></Col>
                <Col xs={24} sm={12} lg={6}><Card size="small"><Statistic title={isCurrentReport ? '明确有序榜单平均排名' : '平均品牌排名'} value={isCurrentReport ? (metricSummary.avg_brand_rank === null || metricSummary.avg_brand_rank === undefined ? `—（有效回答 ${Number(metricSummary.ranked_answers || 0)}）` : `${formatRank(metricSummary.avg_brand_rank)}（有效回答 ${Number(metricSummary.ranked_answers || 0)}）`) : formatRank(metricSummary.avg_brand_rank)} /></Card></Col>
                <Col xs={24} sm={12} lg={6}><Card size="small"><Statistic title="引用源总数" value={sourceSummary.total_citations || 0} /></Card></Col>
                <Col xs={24} sm={12} lg={6}><Card size="small"><Statistic title="来源域名数" value={sourceSummary.source_domain_count || 0} /></Card></Col>
              </Row>

              <Card size="small" title="平台表现">
                <Table size="small" rowKey={(row) => row.platform} columns={platformColumns} dataSource={platforms} pagination={false} />
              </Card>
              <Card size="small" title="问题库分类覆盖">
                <Table size="small" rowKey={(row) => row.category} columns={categoryColumns} dataSource={categories} pagination={false} locale={{ emptyText: '暂无分类数据' }} />
              </Card>
              <Card size="small" title="来源类型">
                <Table size="small" rowKey={(row) => row.type} columns={sourceTypeColumns} dataSource={sourceTypes} pagination={false} locale={{ emptyText: '暂无来源数据' }} />
              </Card>
              <Card size="small" title="Top 引用域名">
                <Table size="small" rowKey={(row) => row.domain} columns={sourceDomainColumns} dataSource={sourceDomains} pagination={false} scroll={{ x: 820 }} locale={{ emptyText: '暂无引用域名' }} />
              </Card>
              <Card size="small" title="Top 引用 URL">
                <Table size="small" rowKey={(row) => row.url || row.domain} columns={sourceUrlColumns} dataSource={sourceUrls} pagination={false} scroll={{ x: 1200 }} locale={{ emptyText: '暂无引用 URL' }} />
              </Card>
              <Row gutter={[12, 12]}>
                <Col xs={24} lg={8}>
                  <Card size="small" title="新增引用域名">
                    <Table size="small" rowKey={(row) => row.domain} columns={sourceChangeColumns} dataSource={newDomains} pagination={false} locale={{ emptyText: '暂无新增引用域名' }} />
                  </Card>
                </Col>
                <Col xs={24} lg={8}>
                  <Card size="small" title="流失引用域名">
                    <Table size="small" rowKey={(row) => row.domain} columns={sourceChangeColumns} dataSource={droppedDomains} pagination={false} locale={{ emptyText: '暂无流失引用域名' }} />
                  </Card>
                </Col>
                <Col xs={24} lg={8}>
                  <Card size="small" title="保留引用域名">
                    <Table size="small" rowKey={(row) => row.domain} columns={sourceChangeColumns} dataSource={retainedDomains} pagination={false} locale={{ emptyText: '暂无保留引用域名' }} />
                  </Card>
                </Col>
              </Row>
              <Row gutter={[12, 12]}>
                <Col xs={24} lg={8}>
                  <Card size="small" title="新增引用 URL">
                    <Table size="small" rowKey={(row) => row.url || row.domain} columns={sourceUrlChangeColumns} dataSource={newUrls} pagination={false} scroll={{ x: 1200 }} locale={{ emptyText: '暂无新增引用 URL' }} />
                  </Card>
                </Col>
                <Col xs={24} lg={8}>
                  <Card size="small" title="流失引用 URL">
                    <Table size="small" rowKey={(row) => row.url || row.domain} columns={sourceUrlChangeColumns} dataSource={droppedUrls} pagination={false} scroll={{ x: 1200 }} locale={{ emptyText: '暂无流失引用 URL' }} />
                  </Card>
                </Col>
                <Col xs={24} lg={8}>
                  <Card size="small" title="保留引用 URL">
                    <Table size="small" rowKey={(row) => row.url || row.domain} columns={sourceUrlChangeColumns} dataSource={retainedUrls} pagination={false} scroll={{ x: 1200 }} locale={{ emptyText: '暂无保留引用 URL' }} />
                  </Card>
                </Col>
              </Row>
              <Card size="small" title="优化机会">
                <Table size="small" rowKey={(row) => row.key || `${row.type}-${row.prompt_id || ''}-${row.platform || ''}-${row.domain || ''}-${row.competitor || ''}`} columns={opportunityColumns} dataSource={opportunities} pagination={false} scroll={{ x: 1110 }} locale={{ emptyText: '暂无需要优先处理的优化机会' }} />
              </Card>
              <Card size="small" title="竞品表现">
                <Table size="small" rowKey={(row) => row.name} columns={competitorColumns} dataSource={competitors} pagination={false} locale={{ emptyText: '暂无竞品提及' }} />
              </Card>
              <Card size="small" title="趋势明细">
                <Table size="small" rowKey={(row) => row.date} columns={trendColumns} dataSource={trend} pagination={false} />
              </Card>
            </Space>
          )}
        </div>
      </Space>
    </div>
  );
}
