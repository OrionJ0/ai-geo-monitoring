// @ts-nocheck
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Card, Col, Empty, Row, Select, Space, Statistic, Table, Tabs, Tag, Tooltip, Typography, message } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import axios from '@/lib/axiosConfig';
import { Column } from '@ant-design/plots';
import { normalizeSourceContextValues } from '@/utils/sourceDisplay.cjs';
import { getApiErrorMessage } from '@/utils/apiErrorMessage.cjs';
import { useAIPlatformCatalog } from '@/lib/useAIPlatformCatalog';
import useDefaultProjectContext from '@/lib/useDefaultProjectContext';
import WorkspacePageHeader from '@/components/WorkspacePageHeader';
import styles from './sources.module.css';

const { Text } = Typography;

const typeColor = {
  自有来源: 'green',
  竞品来源: 'red',
  社区问答: 'blue',
  电商平台: 'orange',
  百科资料: 'purple',
  视频内容: 'cyan',
  媒体内容: 'geekblue',
  其他第三方来源: 'default',
  第三方来源: 'default',
  未知来源: 'default',
};

const periodOptions = [
  { label: '近 7 天', value: 7 },
  { label: '近 30 天', value: 30 },
  { label: '近 90 天', value: 90 },
];

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false });
}

function renderTags(values, fallbackMap = {}) {
  const list = normalizeSourceContextValues(values);
  if (!list.length) return '—';
  return (
    <Space size={[4, 4]} wrap>
      {list.map((item) => <Tag key={item}>{fallbackMap[item] || item}</Tag>)}
    </Space>
  );
}

export default function GeoSourcesPage() {
  const { labels: platformLabel } = useAIPlatformCatalog();
  const defaultContext = useDefaultProjectContext();
  const projectId = defaultContext.project?.id;
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sources, setSources] = useState(null);
  const [days, setDays] = useState(30);
  const sourceRequestRef = useRef(0);

  const invalidateSourceRequest = () => {
    sourceRequestRef.current += 1;
  };

  const handleDaysChange = (value) => {
    invalidateSourceRequest();
    setDays(value);
    setSourceLoading(true);
  };

  const fetchSources = useCallback(async (id, targetDays) => {
    const requestId = sourceRequestRef.current + 1;
    sourceRequestRef.current = requestId;
    if (!id) {
      setSources(null);
      setSourceLoading(false);
      return;
    }
    setSourceLoading(true);
    try {
      const res = await axios.get(`/api/geo-projects/${id}/sources`, { params: { days: targetDays } });
      if (sourceRequestRef.current === requestId) setSources(res?.data?.data || null);
    } catch (error) {
      if (sourceRequestRef.current === requestId) {
        message.error(getApiErrorMessage(error, '获取引用来源分析失败'));
      }
    } finally {
      if (sourceRequestRef.current === requestId) setSourceLoading(false);
    }
  }, []);

  useEffect(() => { fetchSources(projectId, days); }, [projectId, days, fetchSources]);

  const selectedProject = defaultContext.project;
  const summary = sources?.summary || {};
  const sourceTypes = Array.isArray(sources?.source_types) ? sources.source_types : [];
  const domains = Array.isArray(sources?.domains) ? sources.domains : [];
  const urls = Array.isArray(sources?.urls) ? sources.urls : [];
  const opportunities = Array.isArray(sources?.opportunities) ? sources.opportunities : [];
  const records = Array.isArray(sources?.records) ? sources.records : [];
  const sourceChanges = sources?.source_changes || {};
  const newDomains = Array.isArray(sourceChanges?.new_domains) ? sourceChanges.new_domains : [];
  const droppedDomains = Array.isArray(sourceChanges?.dropped_domains) ? sourceChanges.dropped_domains : [];
  const retainedDomains = Array.isArray(sourceChanges?.retained_domains) ? sourceChanges.retained_domains : [];
  const newUrls = Array.isArray(sourceChanges?.new_urls) ? sourceChanges.new_urls : [];
  const droppedUrls = Array.isArray(sourceChanges?.dropped_urls) ? sourceChanges.dropped_urls : [];
  const retainedUrls = Array.isArray(sourceChanges?.retained_urls) ? sourceChanges.retained_urls : [];

  const sourceTypeChartData = sourceTypes.map((item) => ({
    type: item.type,
    citations: Number(item.citation_count || 0),
  }));

  const sourceTypeConfig = {
    data: sourceTypeChartData,
    xField: 'type',
    yField: 'citations',
    height: 260,
    autoFit: true,
    colorField: 'type',
    axis: { y: { title: '引用次数' } },
  };

  const domainColumns = [
    { title: '域名', dataIndex: 'domain', width: 220, ellipsis: true },
    {
      title: '类型',
      dataIndex: 'source_type',
      width: 110,
      render: (value) => <Tag color={typeColor[value] || 'default'}>{value || '未知来源'}</Tag>
    },
    { title: '引用次数', dataIndex: 'citation_count', width: 120, render: (value) => Number(value || 0), sorter: (a, b) => Number(a.citation_count || 0) - Number(b.citation_count || 0) },
    { title: '覆盖回答', dataIndex: 'response_count', width: 100, render: (value) => Number(value || 0) },
    { title: '平台', dataIndex: 'platforms', width: 150, render: (value) => renderTags(value, platformLabel) },
    { title: '问题分类', dataIndex: 'categories', width: 180, render: (value) => renderTags(value) },
  ];

  const urlColumns = [
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
      render: (value) => <Tag color={typeColor[value] || 'default'}>{value || '未知来源'}</Tag>
    },
    { title: '引用次数', dataIndex: 'citation_count', width: 120, render: (value) => Number(value || 0), sorter: (a, b) => Number(a.citation_count || 0) - Number(b.citation_count || 0) },
    { title: '平台', dataIndex: 'platforms', width: 150, render: (value) => renderTags(value, platformLabel) },
    { title: '问题分类', dataIndex: 'categories', width: 180, render: (value) => renderTags(value) },
  ];

  const sourceChangeColumns = [
    { title: '域名', dataIndex: 'domain', width: 220, ellipsis: true },
    {
      title: '类型',
      dataIndex: 'source_type',
      width: 110,
      render: (value) => <Tag color={typeColor[value] || 'default'}>{value || '未知来源'}</Tag>
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
      render: (value) => value ? <a href={value} target="_blank" rel="noreferrer">{value}</a> : '—'
    },
    { title: '域名', dataIndex: 'domain', width: 180, ellipsis: true },
    {
      title: '类型',
      dataIndex: 'source_type',
      width: 110,
      render: (value) => <Tag color={typeColor[value] || 'default'}>{value || '未知来源'}</Tag>
    },
    { title: '引用次数', dataIndex: 'citation_count', width: 120, render: (value) => Number(value || 0) },
    { title: '平台', dataIndex: 'platforms', width: 150, render: (value) => renderTags(value, platformLabel) },
    { title: '问题分类', dataIndex: 'categories', width: 180, render: (value) => renderTags(value) },
    { title: '最近出现', dataIndex: 'last_seen_at', width: 180, render: formatDate },
  ];

  const renderDomainChanges = (rows, emptyText) => (
    <Table
      rowKey="domain"
      dataSource={rows}
      columns={sourceChangeColumns}
      size="small"
      scroll={{ x: 940 }}
      pagination={{ pageSize: 10, showSizeChanger: false }}
      locale={{ emptyText }}
    />
  );

  const renderUrlChanges = (rows, emptyText) => (
    <Table
      rowKey="url"
      dataSource={rows}
      columns={sourceUrlChangeColumns}
      size="small"
      scroll={{ x: 1160 }}
      pagination={{ pageSize: 10, showSizeChanger: false }}
      locale={{ emptyText }}
    />
  );

  const opportunityColumns = [
    { title: '平台', dataIndex: 'platform', width: 110, render: (value) => platformLabel[value] || value || '—' },
    { title: '问题分类', dataIndex: 'prompt_category', width: 140, render: (value) => value || '未分类' },
    { title: '域名', dataIndex: 'domain', width: 180, ellipsis: true },
    {
      title: 'URL',
      dataIndex: 'url',
      width: 360,
      ellipsis: true,
      render: (value) => value ? <a href={value} target="_blank" rel="noreferrer">{value}</a> : '—'
    },
    { title: '时间', dataIndex: 'created_at', width: 180, render: formatDate },
  ];

  const recordColumns = [
    { title: '平台', dataIndex: 'platform', width: 110, render: (value) => platformLabel[value] || value || '—' },
    {
      title: '品牌提及',
      dataIndex: 'brand_mentioned',
      width: 100,
      render: (value) => <Tag color={value ? 'green' : 'default'}>{value ? '已提及' : '未提及'}</Tag>
    },
    {
      title: '来源类型',
      dataIndex: 'source_type',
      width: 110,
      render: (value) => <Tag color={typeColor[value] || 'default'}>{value || '未知来源'}</Tag>
    },
    { title: '域名', dataIndex: 'domain', width: 180, ellipsis: true },
    {
      title: 'URL',
      dataIndex: 'url',
      width: 360,
      ellipsis: true,
      render: (value) => value ? <a href={value} target="_blank" rel="noreferrer">{value}</a> : '—'
    },
    { title: '时间', dataIndex: 'created_at', width: 180, render: formatDate },
  ];

  return (
    <Space orientation="vertical" size={16} className={styles.pageStack}>
      <WorkspacePageHeader
        section="GEO 监测"
        title="引用来源"
        actions={(
          <Select
            aria-label="统计周期"
            value={days}
            style={{ width: 120 }}
            options={periodOptions}
            onChange={handleDaysChange}
          />
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

      <Row gutter={[12, 12]} className={styles.equalCardRow}>
        <Col xs={24} sm={12} lg={4}><Card size="small"><Statistic title="引用总数" value={summary.total_citations || 0} loading={sourceLoading} /></Card></Col>
        <Col xs={24} sm={12} lg={4}><Card size="small"><Statistic title="有引用回答" value={summary.cited_responses || 0} loading={sourceLoading} /></Card></Col>
        <Col xs={24} sm={12} lg={4}><Card size="small"><Statistic title="来源域名" value={summary.source_domain_count || 0} loading={sourceLoading} /></Card></Col>
        <Col xs={24} sm={12} lg={4}><Card size="small"><Statistic title="自有来源" value={summary.owned_citations || 0} loading={sourceLoading} /></Card></Col>
        <Col xs={24} sm={12} lg={4}><Card size="small"><Statistic title="竞品来源" value={summary.competitor_citations || 0} loading={sourceLoading} /></Card></Col>
        <Col xs={24} sm={12} lg={4}>
          <Card size="small">
            <Statistic
              title={(
                <Space size={5}>
                  <span>全部第三方来源</span>
                  <Tooltip title="包括媒体等外部来源，不含自有和竞品来源。" trigger={['hover']}>
                    <InfoCircleOutlined aria-label="来源类型口径" />
                  </Tooltip>
                </Space>
              )}
              value={summary.third_party_citations || 0}
              loading={sourceLoading}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]} className={styles.equalCardRow}>
        <Col xs={24} lg={8}>
              <Card size="small" title="来源类型分布" loading={sourceLoading}>
                <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                  <Text type="secondary">媒体内容按维护的媒体域名规则分类；其他第三方来源指未命中明确类别的外部来源。第三方来源总数包含媒体及其他外部来源。</Text>
                  {sourceTypeChartData.length ? <Column {...sourceTypeConfig} /> : <Empty description="暂无引用来源" />}
                </Space>
              </Card>
        </Col>
        <Col xs={24} lg={16}>
          <Card size="small" title={`Top 来源域名${selectedProject?.name ? `：${selectedProject.name}` : ''}`} loading={sourceLoading}>
            <Table
              rowKey="domain"
              dataSource={domains}
              columns={domainColumns}
              size="small"
              scroll={{ x: 960 }}
              pagination={{ pageSize: 6, showSizeChanger: false }}
            />
          </Card>
        </Col>
      </Row>

      <Card size="small" title="Top 引用 URL" loading={sourceLoading}>
        <Table
          rowKey="url"
          dataSource={urls}
          columns={urlColumns}
          size="small"
          scroll={{ x: 980 }}
          pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50] }}
        />
      </Card>

      <Card size="small" title="竞品来源缺口" loading={sourceLoading}>
        <Table
          rowKey={(row) => `${row.url}-${row.created_at}`}
          dataSource={opportunities}
          columns={opportunityColumns}
          size="small"
          scroll={{ x: 920 }}
          pagination={{ pageSize: 5, showSizeChanger: false }}
        />
      </Card>

      <Card size="small" title="引用域名变化" loading={sourceLoading}>
        <Tabs
          defaultActiveKey="new"
          items={[
            { key: 'new', label: `新增（${newDomains.length}）`, children: renderDomainChanges(newDomains, '暂无新增引用域名') },
            { key: 'dropped', label: `流失（${droppedDomains.length}）`, children: renderDomainChanges(droppedDomains, '暂无流失引用域名') },
            { key: 'retained', label: `保留（${retainedDomains.length}）`, children: renderDomainChanges(retainedDomains, '暂无保留引用域名') },
          ]}
        />
      </Card>

      <Card size="small" title="引用 URL 变化" loading={sourceLoading}>
        <Tabs
          defaultActiveKey="new"
          items={[
            { key: 'new', label: `新增（${newUrls.length}）`, children: renderUrlChanges(newUrls, '暂无新增引用 URL') },
            { key: 'dropped', label: `流失（${droppedUrls.length}）`, children: renderUrlChanges(droppedUrls, '暂无流失引用 URL') },
            { key: 'retained', label: `保留（${retainedUrls.length}）`, children: renderUrlChanges(retainedUrls, '暂无保留引用 URL') },
          ]}
        />
      </Card>

      <Card size="small" title="最近引用记录" loading={sourceLoading}>
        <Table
          rowKey={(row) => `${row.url}-${row.created_at}-${row.platform}`}
          dataSource={records}
          columns={recordColumns}
          size="small"
          scroll={{ x: 1040 }}
          pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50] }}
        />
      </Card>
    </Space>
  );
}
