'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import { Line } from '@ant-design/plots';
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  DatePicker,
  Empty,
  Input,
  Select,
  Skeleton,
  Table,
  Tabs,
  Tooltip
} from 'antd';
import type { TableProps } from 'antd';
import {
  CalendarOutlined,
  ReloadOutlined,
  SearchOutlined
} from '@ant-design/icons';
import useDefaultProjectContext from '@/lib/useDefaultProjectContext';
import useMarketingCapabilities from '@/lib/useMarketingCapabilities';
import {
  useWebsitePageReport,
  useWebsiteTrafficOverview
} from '@/lib/marketing/useWebsiteTraffic';
import type {
  WebsiteDevice,
  WebsiteMetric,
  WebsitePageRow,
  WebsitePageView,
  WebsiteSourceKey
} from '@/lib/marketing/websiteTrafficTypes';
import {
  formatDuration,
  formatDurationChange,
  formatPages,
  formatPagesChange,
  formatPercentChange,
  formatPointChange,
  formatRate,
  formatTrendChange,
  groupDigits
} from '@/utils/websiteTraffic.cjs';
import styles from './website-traffic.module.css';

const { RangePicker } = DatePicker;

const METRIC_OPTIONS: Array<{ value: WebsiteMetric; label: string }> = [
  { value: 'visits', label: '访问次数' },
  { value: 'visitors', label: '访客数（UV）' },
  { value: 'pageviews', label: '浏览量（PV）' },
  { value: 'bounceRate', label: '跳出率' },
  { value: 'averageVisitTime', label: '平均访问时长' },
  { value: 'averageVisitPages', label: '平均访问页数' }
];

const DEVICE_OPTIONS: Array<{ value: WebsiteDevice; label: string }> = [
  { value: 'all', label: '全部设备' },
  { value: 'pc', label: 'PC' },
  { value: 'mobile', label: '移动端' }
];

const DEFAULT_RANGE: [Dayjs, Dayjs] = [
  dayjs().subtract(29, 'day'),
  dayjs()
];

type SortOrder = 'ascend' | 'descend';

function metricDisplay(metric: WebsiteMetric, value: string | null): string {
  if (metric === 'bounceRate') return formatRate(value);
  if (metric === 'averageVisitTime') return formatDuration(value);
  if (metric === 'averageVisitPages') return formatPages(value);
  return groupDigits(value);
}

function SummaryMetric({
  label,
  value,
  comparison,
  quality = false
}: {
  label: string;
  value: string;
  comparison: string;
  quality?: boolean;
}) {
  return (
    <div className={`${styles.summaryItem} ${quality ? styles.qualityMetric : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{comparison === '—' ? '无可用环比' : `较上期 ${comparison}`}</small>
    </div>
  );
}

function PageName({ row }: { row: WebsitePageRow }) {
  return (
    <div className={styles.pageNameCell}>
      <span className={styles.pageTitle}>{row.title || '—'}</span>
      <Tooltip title={row.path} trigger={['hover', 'focus']}>
        <span className={styles.pagePath} tabIndex={0}>{row.path}</span>
      </Tooltip>
    </div>
  );
}

function AccessibleTableRegion({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scrollOwners = containerRef.current?.querySelectorAll<HTMLElement>(
      '.ant-table-content, .ant-table-body'
    );
    scrollOwners?.forEach((node, index) => {
      node.tabIndex = 0;
      node.setAttribute('role', 'region');
      node.setAttribute(
        'aria-label',
        `${label}${scrollOwners.length > 1 ? `滚动区 ${index + 1}` : '滚动区'}`
      );
    });
  });
  return (
    <div ref={containerRef} className={styles.tableScroller}>
      {children}
    </div>
  );
}

export default function WebsiteTrafficPage() {
  const defaultContext = useDefaultProjectContext();
  const marketing = useMarketingCapabilities();
  const [device, setDevice] = useState<WebsiteDevice>('all');
  const [range, setRange] = useState<[Dayjs, Dayjs]>(DEFAULT_RANGE);
  const [source, setSource] = useState<WebsiteSourceKey>('ALL');
  const [metric, setMetric] = useState<WebsiteMetric>('visits');
  const [view, setView] = useState<WebsitePageView>('landing');
  const [searchDraft, setSearchDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortBy, setSortBy] = useState('visits');
  const [sortOrder, setSortOrder] = useState<SortOrder>('descend');

  const projectId = defaultContext.project?.id || '';
  const enabled = Boolean(projectId) && marketing.capabilities.trafficRead;
  const from = range[0].format('YYYY-MM-DD');
  const to = range[1].format('YYYY-MM-DD');
  const overviewQuery = useMemo(() => ({
    projectId,
    enabled,
    device,
    from,
    to,
    source,
    metric
  }), [device, enabled, from, metric, projectId, source, to]);
  const pageQuery = useMemo(() => ({
    projectId,
    enabled,
    device,
    from,
    to,
    view,
    page,
    pageSize,
    sortBy,
    sortOrder,
    query: searchQuery
  }), [
    device,
    enabled,
    from,
    page,
    pageSize,
    projectId,
    searchQuery,
    sortBy,
    sortOrder,
    to,
    view
  ]);
  const overview = useWebsiteTrafficOverview(overviewQuery);
  const pages = useWebsitePageReport(pageQuery);

  const selectedMetricLabel = METRIC_OPTIONS.find(
    (option) => option.value === metric
  )?.label || '';
  const periodDays = range[1].diff(range[0], 'day') + 1;
  const currentPeriodLabel = `近 ${periodDays} 天`;
  const previousPeriodLabel = `较前 ${periodDays} 天`;
  const chartData = useMemo(() => (
    (overview.data?.trend || []).flatMap((row, slot) => [
      ...(row.current == null ? [] : [{
        slot,
        actualDate: row.date,
        value: Number(row.current),
        displayValue: metricDisplay(metric, row.current),
        changeDisplay: formatTrendChange(row.current, row.previous, metric),
        period: currentPeriodLabel
      }]),
      ...(row.previous == null ? [] : [{
        slot,
        actualDate: row.previousDate,
        value: Number(row.previous),
        displayValue: metricDisplay(metric, row.previous),
        changeDisplay: formatTrendChange(row.current, row.previous, metric),
        period: previousPeriodLabel
      }])
    ])
  ), [
    currentPeriodLabel,
    metric,
    overview.data?.trend,
    previousPeriodLabel
  ]);

  const summary = overview.data?.summary;
  const sourceColumns = useMemo<TableProps<NonNullable<
    typeof overview.data
  >['sourceQuality']['rows'][number]>['columns']>(() => [
    {
      title: '来源',
      dataIndex: 'sourceLabel',
      key: 'sourceLabel',
      width: 210,
      render: (value: string, row) => (
        <span className={styles.sourceName}>
          {value}
          {source === row.sourceKey ? <em>已选择</em> : null}
        </span>
      )
    },
    {
      title: '访问次数',
      dataIndex: 'visits',
      key: 'visits',
      width: 130,
      align: 'right',
      render: groupDigits
    },
    {
      title: '流量占比',
      dataIndex: 'trafficShare',
      key: 'trafficShare',
      width: 180,
      render: (value: string | null) => value == null ? '—' : (
        <div className={styles.shareCell}>
          <span>{Number(value).toFixed(1)}%</span>
          <i aria-hidden="true"><b style={{ width: `${Math.min(Number(value), 100)}%` }} /></i>
        </div>
      )
    },
    {
      title: `跳出率（全站 ${formatRate(overview.data?.sourceQuality.allSiteBounceRate || null)}）`,
      dataIndex: 'bounceRate',
      key: 'bounceRate',
      width: 190,
      align: 'right',
      render: formatRate
    },
    {
      title: '平均访问时长',
      dataIndex: 'averageVisitTime',
      key: 'averageVisitTime',
      width: 160,
      align: 'right',
      render: formatDuration
    },
    {
      title: '平均访问页数',
      dataIndex: 'averageVisitPages',
      key: 'averageVisitPages',
      width: 160,
      align: 'right',
      render: formatPages
    }
  ], [overview.data, source]);

  const pageColumns = useMemo<TableProps<WebsitePageRow>['columns']>(() => {
    const sortable = (field: string) => ({
      sorter: true,
      sortOrder: sortBy === field ? sortOrder : null
    });
    const pageColumn = {
      title: '页面',
      dataIndex: 'title',
      key: 'title',
      width: 300,
      render: (_: unknown, row: WebsitePageRow) => <PageName row={row} />
    };
    if (view === 'landing') return [
      pageColumn,
      { title: '访问次数', dataIndex: 'visits', key: 'visits', align: 'right', width: 130, render: groupDigits, ...sortable('visits') },
      { title: '贡献浏览量', dataIndex: 'contributionPageviews', key: 'contributionPageviews', align: 'right', width: 140, render: groupDigits, ...sortable('contributionPageviews') },
      { title: '跳出率', dataIndex: 'bounceRate', key: 'bounceRate', align: 'right', width: 120, render: formatRate, ...sortable('bounceRate') },
      { title: '平均访问时长', dataIndex: 'averageVisitTime', key: 'averageVisitTime', align: 'right', width: 160, render: formatDuration, ...sortable('averageVisitTime') },
      { title: '平均访问页数', dataIndex: 'averageVisitPages', key: 'averageVisitPages', align: 'right', width: 160, render: formatPages, ...sortable('averageVisitPages') }
    ];
    return [
      pageColumn,
      { title: 'PV', dataIndex: 'pageviews', key: 'pageviews', align: 'right', width: 120, render: groupDigits, ...sortable('pageviews') },
      { title: 'UV', dataIndex: 'visitors', key: 'visitors', align: 'right', width: 120, render: groupDigits, ...sortable('visitors') },
      { title: '平均停留时长', dataIndex: 'averageStayTime', key: 'averageStayTime', align: 'right', width: 160, render: formatDuration, ...sortable('averageStayTime') },
      { title: '贡献下游浏览量', dataIndex: 'downstreamPageviews', key: 'downstreamPageviews', align: 'right', width: 170, render: groupDigits, ...sortable('downstreamPageviews') },
      { title: '退出率', dataIndex: 'exitRate', key: 'exitRate', align: 'right', width: 120, render: formatRate, ...sortable('exitRate') }
    ];
  }, [sortBy, sortOrder, view]);

  const onTableChange: TableProps<WebsitePageRow>['onChange'] = (
    pagination,
    _filters,
    sorter
  ) => {
    if (pagination.current) setPage(pagination.current);
    if (pagination.pageSize) setPageSize(pagination.pageSize);
    const active = Array.isArray(sorter) ? sorter[0] : sorter;
    if (active?.field && active.order) {
      setSortBy(String(active.field));
      setSortOrder(active.order);
    }
  };

  if (defaultContext.loading || marketing.loading) {
    return <Skeleton active paragraph={{ rows: 12 }} />;
  }
  if (defaultContext.errorMessage) {
    return <Alert type="error" showIcon message={defaultContext.errorMessage} />;
  }
  if (!marketing.capabilities.trafficRead) {
    return <Alert type="info" showIcon message="网站流量尚未开放" />;
  }

  return (
    <main className={styles.page} aria-label="网站流量">
      <h1 className={styles.visuallyHidden}>网站流量</h1>
      <div className={styles.breadcrumbRow}>
        <Breadcrumb items={[
          { title: '首页' },
          { title: '投放与流量' },
          { title: '网站流量' }
        ]} />
        <div className={styles.filters} aria-label="网站流量筛选">
          <label>
            <span>设备：</span>
            <Select<WebsiteDevice>
              aria-label="设备"
              value={device}
              options={DEVICE_OPTIONS}
              onChange={(value) => {
                setDevice(value);
                setPage(1);
              }}
              popupMatchSelectWidth={false}
            />
          </label>
          <div className={styles.dateRangeControl}>
            <CalendarOutlined aria-hidden="true" />
            <span>近 {range[1].diff(range[0], 'day') + 1} 天</span>
            <RangePicker
              aria-label="统计周期"
              value={range}
              allowClear={false}
              format="YYYY-MM-DD"
              disabledDate={(date) => date.isAfter(dayjs(), 'day')}
              onChange={(dates) => {
                if (!dates?.[0] || !dates?.[1]) return;
                setRange([dates[0], dates[1]]);
                setPage(1);
              }}
            />
          </div>
        </div>
      </div>

      {overview.error ? (
        <Alert
          className={styles.pageAlert}
          type="error"
          showIcon
          message={overview.error}
          action={<Button onClick={overview.reload} icon={<ReloadOutlined />}>重试</Button>}
        />
      ) : null}
      {overview.data?.cache.state === 'FALLBACK' ? (
        <Alert
          className={styles.pageAlert}
          type="warning"
          showIcon
          message="上游暂时不可用，当前展示最后一份同口径缓存。"
        />
      ) : null}

      <div className={styles.moduleStack} aria-busy={overview.loading}>
        <section aria-labelledby="period-summary-heading">
          <h2 className={styles.visuallyHidden} id="period-summary-heading">周期汇总</h2>
          <Card className={styles.summaryCard}>
            {overview.loading && !overview.data ? (
              <Skeleton active paragraph={{ rows: 2 }} />
            ) : (
              <div className={styles.summaryGrid}>
                <SummaryMetric label="访问次数" value={groupDigits(summary?.visits.current || null)} comparison={formatPercentChange(summary?.visits.changePercent || null)} />
                <SummaryMetric label="访客数（UV）" value={groupDigits(summary?.visitors.current || null)} comparison={formatPercentChange(summary?.visitors.changePercent || null)} />
                <SummaryMetric label="浏览量（PV）" value={groupDigits(summary?.pageviews.current || null)} comparison={formatPercentChange(summary?.pageviews.changePercent || null)} />
                <SummaryMetric quality label="跳出率" value={formatRate(summary?.bounceRate.current || null)} comparison={formatPointChange(summary?.bounceRate.changePoints || null)} />
                <SummaryMetric quality label="平均访问时长" value={formatDuration(summary?.averageVisitTime.current || null)} comparison={formatDurationChange(summary?.averageVisitTime.changeSeconds || null)} />
                <SummaryMetric quality label="平均访问页数" value={formatPages(summary?.averageVisitPages.current || null)} comparison={formatPagesChange(summary?.averageVisitPages.changePages || null)} />
              </div>
            )}
          </Card>
        </section>

        <section aria-labelledby="traffic-trend-heading">
          <Card className={styles.trendCard}>
            <div className={styles.cardHeader}>
              <div className={styles.titleWithScope}>
                <h2 id="traffic-trend-heading">网站访问趋势</h2>
                {source === 'ALL' ? (
                  <span className={styles.trendScope}>
                    {selectedMetricLabel} · 全部来源 · {DEVICE_OPTIONS.find((option) => option.value === device)?.label}
                  </span>
                ) : null}
                {source !== 'ALL' ? (
                  <Button type="link" onClick={() => setSource('ALL')}>
                    当前：{overview.data?.selectedSource.sourceLabel || '所选来源'} · 恢复全部来源
                  </Button>
                ) : null}
              </div>
              <div className={styles.trendControls}>
                <label>
                  <span>来源：</span>
                  <Select<WebsiteSourceKey>
                    aria-label="趋势来源"
                    value={source}
                    onChange={setSource}
                    options={[
                      { value: 'ALL', label: '全部来源' },
                      ...(overview.data?.sourceQuality.rows || []).map((row) => ({
                        value: row.sourceKey,
                        label: row.sourceLabel
                      }))
                    ]}
                    popupMatchSelectWidth={false}
                  />
                </label>
                <label>
                  <span>指标：</span>
                  <Select<WebsiteMetric>
                    aria-label="趋势指标"
                    value={metric}
                    onChange={setMetric}
                    options={METRIC_OPTIONS}
                    popupMatchSelectWidth={false}
                  />
                </label>
              </div>
            </div>
            {chartData.length ? (
              <div
                className={styles.chartRegion}
                role="img"
                aria-label={`${overview.data?.selectedSource.sourceLabel || '全部来源'}${selectedMetricLabel}当前周期与上一周期趋势`}
              >
                <Line
                  data={chartData}
                  xField="slot"
                  yField="value"
                  seriesField="period"
                  colorField="period"
                  height={250}
                  scale={{
                    x: { domainMin: 0, domainMax: Math.max((overview.data?.trend.length || 1) - 1, 0), tickCount: 8 },
                    y: ['visits', 'visitors', 'pageviews'].includes(metric)
                      ? { domainMin: 0 }
                      : {},
                    color: { domain: [currentPeriodLabel, previousPeriodLabel], range: ['#2f6bff', '#7b8798'] }
                  }}
                  axis={{
                    x: {
                      title: false,
                      tick: false,
                      labelAutoRotate: false,
                      labelFormatter: (value: string) => overview.data?.trend[Math.round(Number(value))]?.date.slice(5) || ''
                    },
                    y: { title: false, grid: true, labelFormatter: (value: string) => metricDisplay(metric, value) }
                  }}
                  legend={{ color: { position: 'bottom', layout: { justifyContent: 'center' } } }}
                  point={{ size: 3 }}
                  style={{
                    lineWidth: 2,
                    lineDash: (datum: Record<string, unknown> | Array<Record<string, unknown>>) => (
                      (Array.isArray(datum) ? datum[0]?.period : datum?.period) === previousPeriodLabel
                        ? [7, 5]
                        : [0, 0]
                    )
                  }}
                  tooltip={{
                    title: { field: 'actualDate' },
                    items: [
                      (datum: { period: string; displayValue: string }) => ({
                        name: datum.period,
                        value: datum.displayValue,
                        color: datum.period === currentPeriodLabel ? '#2f6bff' : '#7b8798'
                      }),
                      (datum: { period: string; changeDisplay: string }) => (
                        datum.period === currentPeriodLabel
                          ? { name: '变化', value: datum.changeDisplay }
                          : { name: '__skip__', value: '' }
                      )
                    ]
                  }}
                  interaction={{
                    tooltip: {
                      shared: true,
                      filter: (item: { name?: string }) => item.name !== '__skip__'
                    }
                  }}
                  animate={false}
                />
              </div>
            ) : (
              <Empty
                className={styles.chartEmpty}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={overview.loading
                  ? '正在读取趋势…'
                  : overview.data?.selectedMetricState === 'UNAVAILABLE'
                    ? '当前指标尚未通过真实账号合同验证'
                    : '当前指标暂无真实数据'}
              />
            )}
            {overview.data?.trend.length ? (
              <details className={styles.dataDetails}>
                <summary>查看每日趋势等价数据</summary>
                <div className={styles.equivalentTableScroller} tabIndex={0} role="region" aria-label="每日趋势等价数据表">
                  <table className={styles.equivalentTable}>
                    <caption>网站访问趋势每日等价数据</caption>
                    <thead>
                      <tr>
                        <th scope="col">本期日期</th>
                        <th scope="col">本期</th>
                        <th scope="col">上期日期</th>
                        <th scope="col">上期</th>
                        <th scope="col">变化</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.data.trend.map((row) => (
                        <tr key={`${row.date}-${row.previousDate}`}>
                          <td>{row.date}</td>
                          <td>{metricDisplay(metric, row.current)}</td>
                          <td>{row.previousDate}</td>
                          <td>{metricDisplay(metric, row.previous)}</td>
                          <td>{formatTrendChange(row.current, row.previous, metric)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ) : null}
          </Card>
        </section>

        <section aria-labelledby="source-quality-heading">
          <Card className={styles.tableCard}>
            <div className={styles.tableHeader}>
              <h2 id="source-quality-heading">来源质量</h2>
              <span>默认按访问次数降序</span>
            </div>
            <AccessibleTableRegion label="来源质量表">
              <Table
                className={styles.sourceTable}
                rowKey="sourceKey"
                columns={sourceColumns}
                dataSource={overview.data?.sourceQuality.rows || []}
                loading={overview.loading && Boolean(overview.data)}
                pagination={false}
                scroll={{ x: 1030 }}
                rowClassName={(row) => source === row.sourceKey ? styles.selectedSourceRow : ''}
                onRow={(row) => ({
                  tabIndex: 0,
                  'aria-selected': source === row.sourceKey,
                  onClick: () => setSource(row.sourceKey),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSource(row.sourceKey);
                    }
                  }
                })}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前周期无来源数据" /> }}
              />
            </AccessibleTableRegion>
          </Card>
        </section>

        <section aria-labelledby="page-performance-heading">
          <Card className={styles.tableCard}>
            <div className={styles.pageTableHeader}>
              <div className={styles.pageHeadingGroup}>
                <h2 id="page-performance-heading">页面表现</h2>
                <Tabs
                  className={styles.pageTabs}
                  activeKey={view}
                  onChange={(key) => {
                    const nextView = key as WebsitePageView;
                    setView(nextView);
                    setPage(1);
                    setSortBy(nextView === 'landing' ? 'visits' : 'pageviews');
                    setSortOrder('descend');
                  }}
                  items={[
                    { key: 'landing', label: '入口页面' },
                    { key: 'visited', label: '受访页面' }
                  ]}
                />
                <span>当前范围：全部来源</span>
              </div>
              <Input.Search
                className={styles.searchInput}
                aria-label="搜索页面标题或路径"
                placeholder="搜索页面标题或路径"
                prefix={<SearchOutlined aria-hidden="true" />}
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                onSearch={(value) => {
                  setSearchQuery(value.trim());
                  setPage(1);
                }}
                allowClear
              />
            </div>
            {pages.error ? <Alert className={styles.inlineAlert} type="error" showIcon message={pages.error} /> : null}
            {pages.data?.dataState === 'UNAVAILABLE' ? (
              <Alert
                className={styles.inlineAlert}
                type="info"
                showIcon
                message="页面报告暂未接入"
                description={pages.data.capabilities.unavailableReason}
              />
            ) : null}
            <AccessibleTableRegion label={`${view === 'landing' ? '入口页面' : '受访页面'}表`}>
              <Table<WebsitePageRow>
                className={styles.pageTable}
                rowKey="key"
                columns={pageColumns}
                dataSource={pages.data?.rows || []}
                loading={pages.loading}
                onChange={onTableChange}
                scroll={{ x: 1030, y: 132 }}
                pagination={pages.data?.pagination.totalItems == null ? false : {
                  current: pages.data.pagination.page,
                  pageSize: pages.data.pagination.pageSize,
                  total: pages.data.pagination.totalItems,
                  showSizeChanger: true,
                  showTotal: (total) => `共 ${total} 条`
                }}
                locale={{
                  emptyText: pages.data?.dataState === 'UNAVAILABLE'
                    ? '未验证真实账号页面报告合同，不以 0 或模拟数据代替'
                    : '当前筛选范围无页面数据'
                }}
              />
            </AccessibleTableRegion>
          </Card>
        </section>
      </div>
    </main>
  );
}
