// @ts-nocheck
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Col, Empty, Row, Select, Space, Statistic, Table, Tag, Tooltip, Typography, message } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import axios from '@/lib/axiosConfig';
import { Column, Line } from '@ant-design/plots';
import { shouldRenderMetricChart } from '@/utils/dashboardChartState.cjs';
import { getBrandSentimentDisplay } from '@/utils/historyAnalysisDisplay.cjs';
import { getApiErrorMessage } from '@/utils/apiErrorMessage.cjs';
import { useAIPlatformCatalog } from '@/lib/useAIPlatformCatalog';
import useDefaultProjectContext from '@/lib/useDefaultProjectContext';
import WorkspacePageHeader from '@/components/WorkspacePageHeader';
import styles from './project-dashboard.module.css';

const { Text, Title } = Typography;

const sourceTypeColor = {
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
  if (rate === null) return `—（有效回答 ${valid}）`;
  return `${rate}%（${Number(numerator || 0)} / ${valid}）`;
}

function formatSov(summary) {
  const value = nullablePercent(summary?.average);
  const count = Number(summary?.calculable_answers || 0);
  return value === null ? `—（有效回答 ${count}）` : `${value}%（有效回答 ${count}）`;
}

function formatSovTitle(summary) {
  return summary?.kind === 'observed_competitor_mentions'
    && summary?.scope === 'open_discovery'
    && summary?.completeness === 'not_proven'
    ? '开放发现 SOV（仅基于本次已发现实体，不代表完整市场）'
    : '回答内竞品提及占比（SOV）';
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false });
}

function formatRank(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? Number(n.toFixed(2)) : '—';
}

function formatOpportunityScope(row, platformLabel = {}) {
  const platform = row?.platform ? (platformLabel[row.platform] || row.platform) : '';
  const domain = row?.domain || '';
  if (platform && domain) return `${platform} / ${domain}`;
  return platform || domain || row?.competitor || '—';
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

function metricTitle(label, explanation) {
  return (
    <Space size={6}>
      <span>{label}</span>
      <Tooltip title={explanation} trigger={['hover']}>
        <InfoCircleOutlined aria-label={`${label}计算口径`} style={{ color: '#7b8ba5' }} />
      </Tooltip>
    </Space>
  );
}

export default function GeoProjectDashboardPage() {
  const { labels: platformLabel } = useAIPlatformCatalog();
  const defaultContext = useDefaultProjectContext();
  const projectId = defaultContext.project?.id;
  const [dashboard, setDashboard] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [days, setDays] = useState(30);
  const [platform, setPlatform] = useState('all');
  const dashboardRequestRef = useRef(0);

  const invalidateDashboardRequest = () => {
    dashboardRequestRef.current += 1;
  };

  const handleDaysChange = (value) => {
    invalidateDashboardRequest();
    setDays(value);
    setDashboardLoading(true);
  };

  const handlePlatformChange = (value) => {
    invalidateDashboardRequest();
    setPlatform(value);
    setDashboardLoading(true);
  };

  const fetchDashboard = useCallback(async (id, targetDays, targetPlatform) => {
    const requestId = dashboardRequestRef.current + 1;
    dashboardRequestRef.current = requestId;
    if (!id) {
      setDashboard(null);
      setDashboardLoading(false);
      return;
    }
    setDashboardLoading(true);
    try {
      const res = await axios.get(`/api/geo-projects/${id}/dashboard`, {
        params: { days: targetDays, platform: targetPlatform }
      });
      if (dashboardRequestRef.current === requestId) setDashboard(res?.data?.data || null);
    } catch (error) {
      if (dashboardRequestRef.current === requestId) {
        message.error(getApiErrorMessage(error, '获取总体表现失败'));
      }
    } finally {
      if (dashboardRequestRef.current === requestId) setDashboardLoading(false);
    }
  }, []);

  useEffect(() => { fetchDashboard(projectId, days, platform); }, [fetchDashboard, projectId, days, platform]);

  const summary = useMemo(() => dashboard?.summary || {}, [dashboard]);
  const sovMetricTitle = formatSovTitle(summary.sov_summary);
  const recentMetrics = useMemo(() => (
    Array.isArray(dashboard?.recent_metrics) ? dashboard.recent_metrics : []
  ), [dashboard]);
  const platforms = useMemo(() => (
    Array.isArray(summary.platforms) ? summary.platforms : []
  ), [summary]);
  const availablePlatforms = useMemo(() => (
    Array.isArray(dashboard?.available_platforms) ? dashboard.available_platforms : []
  ), [dashboard]);
  const competitors = useMemo(() => (
    Array.isArray(summary.competitors) ? summary.competitors : []
  ), [summary]);
  const categories = useMemo(() => (
    Array.isArray(summary.categories) ? summary.categories : []
  ), [summary]);
  const sourceTypes = useMemo(() => (
    Array.isArray(summary.source_types) ? summary.source_types : []
  ), [summary]);
  const sourceDomains = useMemo(() => (
    Array.isArray(summary.source_domains) ? summary.source_domains : []
  ), [summary]);
  const sourceUrls = useMemo(() => (
    Array.isArray(summary.source_urls) ? summary.source_urls : []
  ), [summary]);
  const sourceSummary = useMemo(() => summary.source_summary || {}, [summary]);
  const sourceChanges = useMemo(() => summary.source_changes || {}, [summary]);
  const newSourceDomains = useMemo(() => (
    Array.isArray(sourceChanges.new_domains) ? sourceChanges.new_domains : []
  ), [sourceChanges]);
  const droppedSourceDomains = useMemo(() => (
    Array.isArray(sourceChanges.dropped_domains) ? sourceChanges.dropped_domains : []
  ), [sourceChanges]);
  const retainedSourceDomains = useMemo(() => (
    Array.isArray(sourceChanges.retained_domains) ? sourceChanges.retained_domains : []
  ), [sourceChanges]);
  const newSourceUrls = useMemo(() => (
    Array.isArray(sourceChanges.new_urls) ? sourceChanges.new_urls : []
  ), [sourceChanges]);
  const droppedSourceUrls = useMemo(() => (
    Array.isArray(sourceChanges.dropped_urls) ? sourceChanges.dropped_urls : []
  ), [sourceChanges]);
  const retainedSourceUrls = useMemo(() => (
    Array.isArray(sourceChanges.retained_urls) ? sourceChanges.retained_urls : []
  ), [sourceChanges]);
  const opportunities = useMemo(() => (
    Array.isArray(dashboard?.opportunities) ? dashboard.opportunities : []
  ), [dashboard]);

  const trendData = useMemo(() => {
    const rows = Array.isArray(dashboard?.trend) ? dashboard.trend : [];
    return rows.flatMap((item) => {
      const values = [
        ['品牌提及率', item.brand_mention_rate],
        [sovMetricTitle, item.sov_summary?.average],
        ['推荐率（AI 语义分析）', item.recommendation_rate],
      ];
      if (Number(item.citation_eligible_checks || 0) > 0) values.push(['引用率', item.citation_rate]);
      return values.flatMap(([type, value]) => {
        const normalized = nullablePercent(value);
        return normalized === null ? [] : [{ date: item.date, type, value: normalized }];
      });
    });
  }, [dashboard, sovMetricTitle]);

  const platformRateChartData = useMemo(() => (
    platforms.flatMap((item) => {
      const label = platformLabel[item.platform] || item.platform || '未知';
      const values = [
        ['提及率', item.brand_mention_rate],
        [sovMetricTitle, item.sov_summary?.average],
        ['推荐率（AI 语义分析）', item.recommendation_rate],
      ];
      if (Number(item.citation_eligible_checks || 0) > 0) values.push(['引用率', item.citation_rate]);
      return values.flatMap(([type, value]) => {
        const normalized = nullablePercent(value);
        return normalized === null ? [] : [{ platform: label, type, value: normalized }];
      });
    })
  ), [platforms, platformLabel, sovMetricTitle]);
  const platformCheckChartData = useMemo(() => (
    platforms.map((item) => ({
      platform: platformLabel[item.platform] || item.platform || '未知',
      checks: Number(item.checks || 0)
    }))
  ), [platforms, platformLabel]);
  const shouldShowTrendChart = useMemo(() => (
    shouldRenderMetricChart(summary, trendData)
  ), [summary, trendData]);
  const shouldShowPlatformRateChart = useMemo(() => (
    shouldRenderMetricChart(summary, platformRateChartData)
  ), [summary, platformRateChartData]);
  const shouldShowPlatformCheckChart = useMemo(() => (
    shouldRenderMetricChart(summary, platformCheckChartData)
  ), [summary, platformCheckChartData]);

  const metricColumns = [
    {
      title: '问题',
      key: 'question',
      width: 300,
      render: (_, row) => (
        <div style={{ wordBreak: 'break-word', lineHeight: 1.5 }}>
          {row?.prompt?.question || row?.questionRecord?.question || '—'}
        </div>
      ),
    },
    {
      title: '平台',
      dataIndex: 'platform',
      width: 110,
      render: (value) => <Tag>{platformLabel[value] || value || '未知'}</Tag>,
    },
    {
      title: '品牌提及',
      dataIndex: 'brand_mentioned',
      width: 100,
      render: (value) => value ? <Tag color="green">已提及</Tag> : <Tag>未提及</Tag>,
    },
    {
      title: '品牌次数',
      dataIndex: 'brand_mentions',
      width: 100,
      render: (value) => Number(value || 0),
    },
    {
      title: sovMetricTitle,
      dataIndex: 'sov',
      width: 180,
      render: (value) => value?.status === 'calculated'
        ? `${nullablePercent(value.value)}%（${value.numerator} / ${value.denominator}）`
        : '—',
    },
    {
      title: '排名/推荐',
      key: 'rank',
      width: 120,
      render: (_, row) => (
        <Space size={4}>
          <Tag>{row.brand_rank ? `第 ${row.brand_rank}` : '未上榜'}</Tag>
          {row.brand_recommended ? <Tag color="green">推荐</Tag> : null}
        </Space>
      ),
    },
    {
      title: '引用',
      key: 'citations',
      width: 120,
      render: (_, row) => row.citation_evidence_status === 'legacy_unverified'
        ? <Tag>历史混合来源（不计入）</Tag>
        : (Number(row.citation_count || 0)
            ? `${Number(row.citation_count || 0)} 条 / 自有 ${Number(row.owned_citation_count || 0)}`
            : '—'),
    },
    {
      title: '分类',
      dataIndex: 'prompt_category',
      width: 110,
      render: (value) => value || '未分类',
    },
    {
      title: '情绪（AI 语义分析）',
      dataIndex: 'sentiment',
      width: 100,
      render: (_, row) => {
        const display = getBrandSentimentDisplay(row);
        return <Tag color={display.sentimentColor}>{display.sentimentLabel}</Tag>;
      },
    },
    {
      title: '竞品提及',
      dataIndex: 'competition_entities',
      render: (items) => {
        const rows = Array.isArray(items)
          ? items.filter((item) => item?.relation === 'competitor' && Number(item?.mentions || 0) > 0)
          : [];
        if (!rows.length) return <Text type="secondary">无</Text>;
        return (
          <Space wrap size={[4, 4]}>
            {rows.slice(0, 6).map((item, index) => (
              <Tag key={`${item?.name || 'competitor'}-${index}`}>{item?.name || '竞品'} {Number(item?.mentions || 0)}</Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: '时间',
      dataIndex: 'created_at',
      width: 170,
      render: formatDate,
    },
  ];

  const competitorColumns = [
    { title: '竞品', dataIndex: 'name' },
    { title: '提及次数', dataIndex: 'mentions', width: 120, render: (value) => Number(value || 0) },
    { title: '出现回答数', dataIndex: 'appeared_answers', width: 130, render: (value) => Number(value || 0) },
  ];

  const categoryColumns = [
    { title: '分类', dataIndex: 'category' },
    { title: '问题数', dataIndex: 'prompt_count', width: 100, render: (value) => Number(value || 0) },
    { title: '启用问题', dataIndex: 'enabled_prompt_count', width: 110, render: (value) => Number(value || 0) },
    { title: '运行数', dataIndex: 'total_runs', width: 90, render: (value) => Number(value || 0) },
    { title: '失败数', dataIndex: 'failed_runs', width: 90, render: (value) => Number(value || 0) },
    { title: '失败率', dataIndex: 'failure_rate', width: 90, render: (value) => `${percent(value)}%` },
    { title: '已获取回答', dataIndex: 'acquired_answers', width: 110, render: (value) => Number(value || 0) },
    { title: '有效回答', dataIndex: 'valid_answers', width: 100, render: (value) => Number(value || 0) },
    {
      title: '分析覆盖率',
      dataIndex: 'analysis_coverage_rate',
      width: 130,
      render: (value, row) => formatRate(value, row.valid_answers, row.acquired_answers)
    },
    {
      title: '提及率',
      dataIndex: 'brand_mention_rate',
      width: 150,
      render: (value, row) => formatRate(value, row.brand_mentioned_answers, row.brand_mention_assessed_answers ?? row.valid_answers)
    },
    {
      title: sovMetricTitle,
      dataIndex: 'sov_summary',
      width: 210,
      render: formatSov
    },
    {
      title: '引用率',
      dataIndex: 'citation_rate',
      width: 110,
      render: (value, row) => Number(row.citation_eligible_checks || 0) > 0 ? `${percent(value)}%` : '暂无可验证样本'
    },
    {
      title: '推荐率（AI 语义分析）',
      dataIndex: 'recommendation_rate',
      width: 150,
      render: (value, row) => formatRate(value, row.recommended_answers, row.recommendation_assessed_answers ?? row.valid_answers)
    },
  ];

  const sourceTypeColumns = [
    {
      title: '类型',
      dataIndex: 'type',
      render: (value) => <Tag color={sourceTypeColor[value] || 'default'}>{value || '未知来源'}</Tag>
    },
    { title: '引用次数', dataIndex: 'citation_count', width: 120, render: (value) => Number(value || 0) },
    { title: '覆盖回答', dataIndex: 'response_count', width: 100, render: (value) => Number(value || 0) },
    { title: '域名数', dataIndex: 'domain_count', width: 90, render: (value) => Number(value || 0) },
  ];

  const sourceDomainColumns = [
    { title: '域名', dataIndex: 'domain', width: 220, ellipsis: true },
    {
      title: '类型',
      dataIndex: 'source_type',
      width: 110,
      render: (value) => <Tag color={sourceTypeColor[value] || 'default'}>{value || '未知来源'}</Tag>
    },
    { title: '引用次数', dataIndex: 'citation_count', width: 120, render: (value) => Number(value || 0) },
    { title: '覆盖回答', dataIndex: 'response_count', width: 100, render: (value) => Number(value || 0) },
    { title: '平台', dataIndex: 'platforms', width: 150, render: (value) => renderTags(value, platformLabel) },
    { title: '问题分类', dataIndex: 'categories', width: 180, render: (value) => renderTags(value) },
  ];

  const sourceUrlColumns = [
    {
      title: 'URL',
      dataIndex: 'url',
      width: 360,
      ellipsis: true,
      render: (value) => value ? <a href={value} target="_blank" rel="noreferrer">{value}</a> : '—'
    },
    { title: '域名', dataIndex: 'domain', width: 180, ellipsis: true },
    {
      title: '类型',
      dataIndex: 'source_type',
      width: 110,
      render: (value) => <Tag color={sourceTypeColor[value] || 'default'}>{value || '未知来源'}</Tag>
    },
    { title: '引用次数', dataIndex: 'citation_count', width: 120, render: (value) => Number(value || 0) },
    { title: '覆盖回答', dataIndex: 'response_count', width: 100, render: (value) => Number(value || 0) },
    { title: '平台', dataIndex: 'platforms', width: 150, render: (value) => renderTags(value, platformLabel) },
    { title: '问题分类', dataIndex: 'categories', width: 180, render: (value) => renderTags(value) },
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
      }
    },
    { title: '机会类型', dataIndex: 'type', width: 130, render: (value) => <Tag color="blue">{value || '机会'}</Tag> },
    {
      title: '平台/来源',
      key: 'scope',
      width: 130,
      render: (_, row) => formatOpportunityScope(row, platformLabel)
    },
    {
      title: '对象',
      key: 'target',
      width: 260,
      render: (_, row) => row.prompt || row.domain || row.competitor || row.prompt_category || '—'
    },
    { title: '证据', dataIndex: 'evidence', width: 300, render: (value) => value || '—' },
    { title: '建议动作', dataIndex: 'recommendation', render: (value) => value || '—' },
  ];

  return (
    <div className={styles.page}>
      <Space orientation="vertical" size={16} className={styles.pageStack}>
        <WorkspacePageHeader
          section="GEO 监测"
          title="总体表现"
          actions={(
            <Space wrap>
              <Select
                aria-label="统计周期"
                style={{ width: 120 }}
                value={days}
                options={periodOptions}
                onChange={handleDaysChange}
              />
              <Select
                aria-label="平台范围"
                style={{ width: 180 }}
                value={dashboard?.selected_platform || platform}
                onChange={handlePlatformChange}
                options={[
                  { label: '全部平台（合并）', value: 'all' },
                  ...availablePlatforms.map((item) => ({
                    label: platformLabel[item] || item,
                    value: item
                  }))
                ]}
              />
            </Space>
          )}
        />

        {defaultContext.errorMessage ? (
          <Alert
            type="warning"
            showIcon
            title="无法读取默认监控项目"
            description={defaultContext.errorMessage}
          />
        ) : null}

        <section aria-labelledby="core-metrics-title" className={`${styles.metricSection} ${styles.coreSection}`}>
          <div className={styles.sectionHeader}>
            <Title level={4} id="core-metrics-title" className={styles.sectionTitle}>核心表现</Title>
          </div>
          <Row gutter={[12, 12]}>
            <Col xs={24} sm={12} lg={8}>
              <Card className={styles.coreMetricCard}><Statistic title={metricTitle('品牌提及率', '目标事实已完成的回答中，提及目标品牌的回答数 ÷ 目标事实已完成回答数。')} value={formatRate(summary.brand_mention_rate, summary.brand_mentioned_answers, summary.brand_mention_assessed_answers ?? summary.valid_answers)} loading={dashboardLoading} /></Card>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Card className={styles.coreMetricCard}><Statistic title={metricTitle(sovMetricTitle, '目标品牌提及数 ÷ 品牌与本次开放发现的竞品提及总数，再按回答取平均；未证明竞品集合完整。')} value={formatSov(summary.sov_summary)} loading={dashboardLoading} /></Card>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Card className={styles.coreMetricCard}><Statistic title={metricTitle('推荐率（AI 语义分析）', '明确推荐目标品牌的回答数 ÷ 推荐语义已评估回答数；未解决或不可用不进入分母。')} value={formatRate(summary.recommendation_rate, summary.recommended_answers, summary.recommendation_assessed_answers ?? summary.valid_answers)} loading={dashboardLoading} /></Card>
            </Col>
          </Row>
        </section>

        <section aria-labelledby="performance-trend-title" className={styles.metricSection}>
          <div className={styles.sectionHeader}>
            <Title level={4} id="performance-trend-title" className={styles.sectionTitle}>表现趋势</Title>
          </div>
          <Row gutter={[12, 12]} className={styles.diagnosticRows}>
            <Col xs={24} xl={14}>
              <Card size="small" title="趋势" loading={dashboardLoading}>
                {shouldShowTrendChart ? (
                  <Line
                    data={trendData}
                    xField="date"
                    yField="value"
                    seriesField="type"
                    height={280}
                    point
                    legend={{ position: 'top' }}
                  />
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无趋势数据" />}
              </Card>
            </Col>
            <Col xs={24} xl={10}>
              <Card size="small" title="平台百分比指标" loading={dashboardLoading}>
                {shouldShowPlatformRateChart ? (
                  <Column
                    data={platformRateChartData}
                    xField="platform"
                    yField="value"
                    seriesField="type"
                    isGroup
                    height={280}
                    legend={{ position: 'top' }}
                  />
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无平台指标" />}
              </Card>
            </Col>
            <Col xs={24}>
              <Card size="small" title="平台有效分析数" loading={dashboardLoading}>
                {shouldShowPlatformCheckChart ? (
                  <Column
                    data={platformCheckChartData}
                    xField="platform"
                    yField="checks"
                    height={220}
                    legend={false}
                  />
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无平台数据" />}
              </Card>
            </Col>
          </Row>
        </section>

        <section aria-labelledby="run-quality-title" className={styles.metricSection}>
          <div className={styles.sectionHeader}>
            <Title level={4} id="run-quality-title" className={styles.sectionTitle}>运行质量</Title>
          </div>
          <Row gutter={[12, 12]}>
            <Col xs={24} sm={6}>
              <Card size="small" className={styles.supportMetricCard}><Statistic title="总运行数" value={summary.total_runs ?? summary.total_checks ?? 0} loading={dashboardLoading} /></Card>
            </Col>
            <Col xs={24} sm={6}>
              <Card size="small" className={styles.supportMetricCard}><Statistic title="已获取回答" value={summary.acquired_answers || 0} loading={dashboardLoading} /></Card>
            </Col>
            <Col xs={24} sm={6}>
              <Card size="small" className={styles.supportMetricCard}><Statistic title="分析覆盖率" value={formatRate(summary.analysis_coverage_rate, summary.valid_answers, summary.acquired_answers)} loading={dashboardLoading} /></Card>
            </Col>
            <Col xs={24} sm={6}>
              <Card size="small" className={styles.supportMetricCard}><Statistic title="失败数" value={summary.failed_runs || 0} loading={dashboardLoading} /></Card>
            </Col>
          </Row>
        </section>

        <section aria-labelledby="source-performance-title" className={styles.metricSection}>
          <div className={styles.sectionHeader}>
            <Title level={4} id="source-performance-title" className={styles.sectionTitle}>来源表现</Title>
          </div>
          <Row gutter={[12, 12]}>
            <Col xs={24} sm={12} lg={6}>
              <Card size="small" className={styles.supportMetricCard}><Statistic title="引用率" value={Number(summary.citation_eligible_checks || 0) > 0 ? percent(summary.citation_rate) : '暂无可验证样本'} suffix={Number(summary.citation_eligible_checks || 0) > 0 ? '%' : undefined} loading={dashboardLoading} /></Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card size="small" className={styles.supportMetricCard}><Statistic title="官网引用率" value={dashboard?.project?.website ? (Number(summary.citation_eligible_checks || 0) > 0 ? percent(summary.owned_citation_rate) : '暂无可验证样本') : '未配置官网'} suffix={dashboard?.project?.website && Number(summary.citation_eligible_checks || 0) > 0 ? '%' : undefined} loading={dashboardLoading} /></Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card size="small" className={styles.supportMetricCard}><Statistic title="引用源总数" value={sourceSummary.total_citations || 0} loading={dashboardLoading} /></Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card size="small" className={styles.supportMetricCard}><Statistic title="来源域名数" value={sourceSummary.source_domain_count || 0} loading={dashboardLoading} /></Card>
            </Col>
          </Row>
        </section>

        <section aria-labelledby="source-structure-title" className={styles.metricSection}>
          <div className={styles.sectionHeader}>
            <Title level={4} id="source-structure-title" className={styles.sectionTitle}>来源结构</Title>
          </div>
          <Row gutter={[12, 12]} className={styles.diagnosticRows}>
            <Col xs={24} xl={8}>
              <Card size="small" title="来源类型分布" loading={dashboardLoading}>
                <Table
                  size="small"
                  rowKey={(row) => row.type || 'unknown'}
                  columns={sourceTypeColumns}
                  dataSource={sourceTypes}
                  pagination={false}
                  locale={{ emptyText: '暂无来源类型' }}
                />
              </Card>
            </Col>
            <Col xs={24} xl={16}>
              <Card size="small" title="Top 引用域名" loading={dashboardLoading}>
                <Table
                  size="small"
                  rowKey={(row) => row.domain}
                  columns={sourceDomainColumns}
                  dataSource={sourceDomains}
                  pagination={{ pageSize: 6, showSizeChanger: false }}
                  scroll={{ x: 960 }}
                  locale={{ emptyText: '暂无引用域名' }}
                />
              </Card>
            </Col>
            <Col xs={24}>
              <Card size="small" title="Top 引用 URL" loading={dashboardLoading}>
                <Table
                  size="small"
                  rowKey={(row) => row.url || row.domain}
                  columns={sourceUrlColumns}
                  dataSource={sourceUrls}
                  pagination={{ pageSize: 6, showSizeChanger: false }}
                  scroll={{ x: 1180 }}
                  locale={{ emptyText: '暂无引用 URL' }}
                />
              </Card>
            </Col>
          </Row>
        </section>

        <section aria-labelledby="diagnosis-title" className={`${styles.metricSection} ${styles.diagnosisSection}`}>
          <div className={styles.sectionHeader}>
            <Title level={4} id="diagnosis-title" className={styles.sectionTitle}>变化与诊断</Title>
            <Button type="link" href="/geo/sources">查看引用来源明细</Button>
          </div>
          <Row gutter={[12, 12]} className={styles.diagnosticRows}>
            <Col xs={12} sm={8} lg={6}>
              <Card size="small" className={styles.diagnosticMetricCard}><Statistic title={metricTitle('明确有序榜单平均排名', '只统计明确给出顺序或名次的多品牌榜单。')} value={summary.avg_brand_rank === null || summary.avg_brand_rank === undefined ? `—（有效回答 ${Number(summary.ranked_answers || 0)}）` : `${formatRank(summary.avg_brand_rank)}（有效回答 ${Number(summary.ranked_answers || 0)}）`} loading={dashboardLoading} /></Card>
            </Col>
            <Col xs={12} sm={8} lg={6}>
              <Card size="small" className={styles.diagnosticMetricCard}><Statistic title="竞品提及次数" value={competitors.reduce((sum, item) => sum + Number(item.mentions || 0), 0)} loading={dashboardLoading} /></Card>
            </Col>
            <Col xs={12} sm={8} lg={6}>
              <Card size="small" className={styles.diagnosticMetricCard}><Statistic title="新增引用域名" value={newSourceDomains.length} loading={dashboardLoading} /></Card>
            </Col>
            <Col xs={12} sm={8} lg={6}>
              <Card size="small" className={styles.diagnosticMetricCard}><Statistic title="流失引用域名" value={droppedSourceDomains.length} loading={dashboardLoading} /></Card>
            </Col>
            <Col xs={12} sm={8} lg={6}>
              <Card size="small" className={styles.diagnosticMetricCard}><Statistic title="保留引用域名" value={retainedSourceDomains.length} loading={dashboardLoading} /></Card>
            </Col>
            <Col xs={12} sm={8} lg={6}>
              <Card size="small" className={styles.diagnosticMetricCard}><Statistic title="新增引用 URL" value={newSourceUrls.length} loading={dashboardLoading} /></Card>
            </Col>
            <Col xs={12} sm={8} lg={6}>
              <Card size="small" className={styles.diagnosticMetricCard}><Statistic title="流失引用 URL" value={droppedSourceUrls.length} loading={dashboardLoading} /></Card>
            </Col>
            <Col xs={12} sm={8} lg={6}>
              <Card size="small" className={styles.diagnosticMetricCard}><Statistic title="保留引用 URL" value={retainedSourceUrls.length} loading={dashboardLoading} /></Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]} className={styles.diagnosticRows}>
          <Col xs={24} xl={12}>
            <Card size="small" title="问题库分类覆盖" loading={dashboardLoading}>
              <Table
                size="small"
                rowKey={(row) => row.category}
                columns={categoryColumns}
                dataSource={categories}
                pagination={false}
                locale={{ emptyText: '暂无分类数据' }}
              />
            </Card>
          </Col>
          <Col xs={24} xl={12}>
            <Card size="small" title="竞品提及" loading={dashboardLoading}>
              <Table
                size="small"
                rowKey={(row) => row.name}
                columns={competitorColumns}
                dataSource={competitors}
                pagination={false}
                locale={{ emptyText: '暂无竞品提及' }}
              />
            </Card>
          </Col>
          </Row>

          <Row gutter={[12, 12]} className={styles.diagnosticRows}>
          <Col xs={24}>
            <Card size="small" title="最近指标" loading={dashboardLoading}>
              <Table
                size="small"
                rowKey={(row) => row.id}
                columns={metricColumns}
                dataSource={recentMetrics}
                pagination={{ pageSize: 8, showSizeChanger: false }}
                scroll={{ x: 1180 }}
              />
            </Card>
          </Col>
          </Row>
        </section>

        <section aria-labelledby="action-title" className={`${styles.metricSection} ${styles.actionSection}`}>
          <div className={styles.sectionHeader}>
            <Title level={4} id="action-title" className={styles.sectionTitle}>行动建议</Title>
          </div>
          <Card size="small" title="优化机会" loading={dashboardLoading}>
            <Table
              size="small"
              rowKey={(row) => row.key || `${row.type}-${row.prompt_id || ''}-${row.platform || ''}-${row.domain || ''}-${row.competitor || ''}`}
              columns={opportunityColumns}
              dataSource={opportunities}
              pagination={{ pageSize: 6, showSizeChanger: false }}
              scroll={{ x: 1170 }}
              locale={{ emptyText: '暂无需要优先处理的优化机会' }}
            />
          </Card>
        </section>
      </Space>
    </div>
  );
}
