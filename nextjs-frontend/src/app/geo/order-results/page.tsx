'use client';

import React, {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { useSearchParams } from 'next/navigation';
import dayjs from 'dayjs';
import { Line, Pie } from '@ant-design/plots';
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Pagination,
  Select,
  Skeleton,
  Table,
  Tag,
  Tooltip
} from 'antd';
import type { TableColumnsType, TableProps } from 'antd';
import {
  ArrowRightOutlined,
  ExportOutlined,
  InfoCircleOutlined,
  SearchOutlined
} from '@ant-design/icons';
import type {
  OrderAttributionStatus,
  OrderConsultation,
  OrderResult,
  OrderResultFilters,
  OrderSourceCategory
} from '@/lib/orderResults/orderResultsTypes';
import { resolveOrderResultsDataSource } from '@/lib/orderResults/orderResultsDataSource';
import {
  SOURCE_LABELS,
  buildDailySeries,
  deriveOrderResultsView
} from '@/utils/orderResults.cjs';
import styles from './order-results.module.css';

const { RangePicker } = DatePicker;

const SOURCE_COLORS: Record<OrderSourceCategory, string> = {
  BAIDU_PAID: '#1462f3',
  ORGANIC_SEARCH: '#2f8fee',
  DIRECT: '#74bdf3',
  UNKNOWN: '#98a2b3',
  PENDING: '#f6a04d'
};

const STATUS_LABELS: Record<OrderAttributionStatus, string> = {
  TRUSTED: '已关联',
  SOURCE_UNKNOWN: '已关联·来源未知',
  PENDING: '待关联'
};

const CONSULTATION_TYPE_LABELS: Record<OrderConsultation['type'], string> = {
  WEBSITE_FORM: '表单咨询',
  ONLINE_CHAT: '在线客服'
};

function formatAmount(value: string) {
  return `¥${BigInt(value).toLocaleString('zh-CN')}`;
}

function formatComparison(current: string, previous: string) {
  const currentValue = BigInt(current);
  const previousValue = BigInt(previous);
  if (previousValue === BigInt(0)) return null;
  const tenths = ((currentValue - previousValue) * BigInt(1000)) / previousValue;
  const sign = tenths > BigInt(0) ? '+' : '';
  return `${sign}${Number(tenths) / 10}%`;
}

function sumSeries(rows: Array<{ value: string }>) {
  return rows.reduce(
    (total, row) => total + BigInt(row.value),
    BigInt(0)
  ).toString();
}

function sourceLabel(order: OrderResult) {
  if (order.attributionStatus === 'PENDING') return SOURCE_LABELS.PENDING;
  if (order.attributionStatus === 'SOURCE_UNKNOWN') return SOURCE_LABELS.UNKNOWN;
  return SOURCE_LABELS[order.sourceKey as keyof typeof SOURCE_LABELS];
}

function toneForStatus(status: OrderAttributionStatus) {
  if (status === 'TRUSTED') return 'trusted';
  if (status === 'SOURCE_UNKNOWN') return 'neutral';
  return 'pending';
}

function consultationText(order: OrderResult) {
  const consultation = order.primaryConsultation;
  if (!consultation) return '—';
  return `${CONSULTATION_TYPE_LABELS[consultation.type]} ${dayjs(consultation.occurredAt).format('MM-DD')}「${consultation.summary}」`;
}

function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip title={children} trigger={['hover', 'focus']}>
      <button type="button" className={styles.infoButton} aria-label={`${label}口径说明`}>
        <InfoCircleOutlined aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

function Metric({
  title,
  value,
  note,
  testId,
  info
}: {
  title: string;
  value: React.ReactNode;
  note: React.ReactNode;
  testId: string;
  info?: React.ReactNode;
}) {
  return (
    <section className={styles.summaryMetric} aria-label={title}>
      <div className={styles.metricTitle}>
        <span>{title}</span>
        {info ? <InfoTip label={title}>{info}</InfoTip> : null}
      </div>
      <strong data-testid={testId}>{value}</strong>
      <p className={styles.metricNote}>{note}</p>
    </section>
  );
}

function OrderDetailDrawer({
  open,
  order,
  demoMode,
  consultationOptions,
  draftConsultationId,
  temporaryNotice,
  onDraftChange,
  onApplyTemporary,
  onClose,
  afterOpenChange
}: {
  open: boolean;
  order: OrderResult | null;
  demoMode: boolean;
  consultationOptions: readonly OrderConsultation[];
  draftConsultationId: string | null;
  temporaryNotice: string | null;
  onDraftChange: (value: string) => void;
  onApplyTemporary: () => void;
  onClose: () => void;
  afterOpenChange: (nextOpen: boolean) => void;
}) {
  const consultation = order?.primaryConsultation || null;
  const status = order?.attributionStatus || 'PENDING';
  const relationshipSource = order ? sourceLabel(order) : '待关联';
  const temporaryNoticeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open && temporaryNotice) temporaryNoticeRef.current?.focus();
  }, [open, temporaryNotice]);

  return (
    <Drawer
      rootClassName={styles.detailDrawer}
      title="订单详情"
      placement="right"
      size={480}
      open={open}
      onClose={onClose}
      afterOpenChange={afterOpenChange}
      keyboard
      maskClosable
      destroyOnHidden
      aria-label="订单详情"
    >
      {order ? (
        <>
          <Descriptions
            className={styles.detailMeta}
            column={1}
            colon={false}
            size="small"
            items={[
              { key: 'number', label: '订单编号', children: order.orderNumber },
              { key: 'project', label: '订单/项目', children: order.projectName },
              { key: 'customer', label: '客户', children: order.customerName },
              { key: 'date', label: '签订日期', children: order.signedDate },
              { key: 'amount', label: '签订金额', children: formatAmount(order.signedAmountYuan) }
            ]}
          />

          <section className={styles.drawerSection} aria-labelledby="relationship-title">
            <h3 id="relationship-title">已确认的来源关系</h3>
            <div className={styles.relationship} aria-label={`${relationshipSource} 到主要咨询再到订单`}>
              <div className={styles.relationshipNode}>
                <span>来源</span>
                <strong>{relationshipSource}</strong>
              </div>
              <ArrowRightOutlined aria-hidden="true" />
              <div className={styles.relationshipNode}>
                <span>主要咨询</span>
                <strong>{consultation ? CONSULTATION_TYPE_LABELS[consultation.type] : '未选择'}</strong>
              </div>
              <ArrowRightOutlined aria-hidden="true" />
              <div className={styles.relationshipNode}>
                <span>订单</span>
                <strong>{order.orderNumber}</strong>
              </div>
            </div>
          </section>

          <section className={styles.drawerSection} aria-labelledby="consultation-title">
            <h3 id="consultation-title">主要归因咨询</h3>
            {consultation ? (
              <>
                <p className={styles.consultationSummary}>{consultation.summary}</p>
                <dl className={styles.consultationFacts}>
                  <div><dt>类型</dt><dd>{CONSULTATION_TYPE_LABELS[consultation.type]}</dd></div>
                  <div><dt>时间</dt><dd>{dayjs(consultation.occurredAt).format('YYYY-MM-DD HH:mm')}</dd></div>
                  <div><dt>联系人</dt><dd>{consultation.maskedContact}</dd></div>
                  <div><dt>落地页</dt><dd>{consultation.landingPage}</dd></div>
                </dl>
              </>
            ) : (
              <p className={styles.consultationSummary}>尚未确认主要归因咨询，当前不会自动匹配。</p>
            )}
          </section>

          {demoMode && status === 'PENDING' ? (
            <section className={styles.drawerSection} aria-labelledby="temporary-title">
              <h3 id="temporary-title">开发示例：临时关联</h3>
              <div className={styles.temporaryBox}>
                <p>仅在当前页面内演示人工选择；不调用接口、不持久化，刷新后重置。</p>
                <div className={styles.temporaryActions}>
                  <Select
                    aria-label="临时选择主要咨询"
                    value={draftConsultationId}
                    onChange={onDraftChange}
                    placeholder="选择一条主要咨询"
                    options={consultationOptions.map((item) => ({
                      value: item.id,
                      label: `${item.sourceLabel} · ${CONSULTATION_TYPE_LABELS[item.type]} · ${dayjs(item.occurredAt).format('MM-DD')}`
                    }))}
                  />
                  <Button type="primary" disabled={!draftConsultationId} onClick={onApplyTemporary}>
                    应用临时关联
                  </Button>
                </div>
              </div>
            </section>
          ) : null}

          {temporaryNotice ? (
            <div ref={temporaryNoticeRef} tabIndex={-1} className={styles.temporaryNoticeFocus}>
              <Alert className={styles.temporaryNotice} type="success" showIcon title={temporaryNotice} />
            </div>
          ) : null}

          <div className={styles.drawerActions}>
            <Button
              href={consultation ? '/geo/consultations' : undefined}
              disabled={!consultation}
            >
              查看原始咨询
            </Button>
            {order.salesSystemRecordUrl ? (
              <Button href={order.salesSystemRecordUrl} target="_blank" icon={<ExportOutlined />}>
                在销售系统查看
              </Button>
            ) : (
              <Tooltip title="销售系统尚未提供真实订单记录 URL">
                <Button disabled icon={<ExportOutlined />}>在销售系统查看</Button>
              </Tooltip>
            )}
            <p className={styles.disabledReason}>签订金额不代表回款、收入或利润。</p>
          </div>
        </>
      ) : null}
    </Drawer>
  );
}

function LoadingPage() {
  return (
    <div className={styles.page}>
      <div className={styles.breadcrumbRow}><Skeleton.Input active size="small" /></div>
      <Card className={styles.emptyCard}><Skeleton active paragraph={{ rows: 8 }} /></Card>
    </div>
  );
}

function OrderResultsContent() {
  const searchParams = useSearchParams();
  const demoRequested = searchParams.get('demo') === '1';
  const dataSource = useMemo(
    () => resolveOrderResultsDataSource(demoRequested),
    [demoRequested]
  );
  const initialRange = dataSource.coverage
    ? [dataSource.coverage.defaultFrom, dataSource.coverage.defaultTo]
    : [dayjs().subtract(29, 'day').format('YYYY-MM-DD'), dayjs().format('YYYY-MM-DD')];
  const [orders, setOrders] = useState<OrderResult[]>(() => [...dataSource.orders]);
  const [dateRange, setDateRange] = useState<[string, string]>(initialRange as [string, string]);
  const [metric, setMetric] = useState<'count' | 'amount'>('count');
  const [sourceFilter, setSourceFilter] = useState<'ALL' | OrderSourceCategory>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | OrderAttributionStatus>('ALL');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<OrderResultFilters['sortKey']>('signedDate');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [draftConsultationId, setDraftConsultationId] = useState<string | null>(null);
  const [temporaryNotice, setTemporaryNotice] = useState<string | null>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setOrders([...dataSource.orders]);
    if (dataSource.coverage) {
      setDateRange([dataSource.coverage.defaultFrom, dataSource.coverage.defaultTo]);
    }
  }, [dataSource]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [drawerOpen]);

  const filters = useMemo<OrderResultFilters>(() => ({
    from: dateRange[0],
    to: dateRange[1],
    source: sourceFilter,
    status: statusFilter,
    query,
    sortKey,
    sortOrder,
    page,
    pageSize,
    metric
  }), [dateRange, metric, page, pageSize, query, sortKey, sortOrder, sourceFilter, statusFilter]);
  const view = useMemo(
    () => deriveOrderResultsView(orders, filters),
    [filters, orders]
  );
  const countTrend = useMemo(
    () => buildDailySeries(orders, filters, 'count'),
    [filters, orders]
  );
  const amountTrend = useMemo(
    () => buildDailySeries(orders, filters, 'amount'),
    [filters, orders]
  );
  const selectedOrder = orders.find((order) => order.id === selectedOrderId) || null;
  const currentTrend = metric === 'count' ? countTrend : amountTrend;
  const previousCount = sumSeries(countTrend.previous);
  const previousAmount = sumSeries(amountTrend.previous);
  const countChange = formatComparison(String(view.summary.totalCount), previousCount);
  const amountChange = formatComparison(view.summary.signedAmountYuan, previousAmount);
  const defaultThirtyDayLabels = dateRange[0] === '2026-07-05' && dateRange[1] === '2026-08-03';
  const currentSeriesLabel = defaultThirtyDayLabels ? '近 30 天' : '当前范围';
  const previousSeriesLabel = defaultThirtyDayLabels ? '较前 30 天' : '较前等长周期';
  const chartData = [
    ...currentTrend.current.map((row) => ({
      slot: row.date.slice(5),
      actualDate: row.date,
      value: Number(row.value),
      exactValue: row.value,
      period: currentSeriesLabel
    })),
    ...currentTrend.previous.map((row, index) => ({
      slot: currentTrend.current[index]?.date.slice(5),
      actualDate: row.date,
      value: Number(row.value),
      exactValue: row.value,
      period: previousSeriesLabel
    }))
  ];

  const openDetail = (order: OrderResult, trigger: HTMLButtonElement) => {
    returnFocusRef.current = trigger;
    setSelectedOrderId(order.id);
    setDraftConsultationId(null);
    setTemporaryNotice(null);
    setDrawerOpen(true);
  };

  const applyTemporaryAssociation = () => {
    const candidate = dataSource.consultationOptions.find(
      (item) => item.id === draftConsultationId
    );
    if (!candidate || !selectedOrderId) return;
    setOrders((current) => current.map((order) => (
      order.id === selectedOrderId
        ? {
            ...order,
            sourceKey: candidate.sourceKey,
            attributionStatus: candidate.sourceKey === 'UNKNOWN' ? 'SOURCE_UNKNOWN' : 'TRUSTED',
            primaryConsultation: candidate
          }
        : order
    )));
    setTemporaryNotice('已在当前页面临时应用；刷新后会重置。');
  };

  const columns = useMemo<TableColumnsType<OrderResult>>(() => [
    {
      title: '订单编号', dataIndex: 'orderNumber', key: 'orderNumber', width: 130,
      sorter: true,
      sortOrder: sortKey === 'orderNumber' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
      render: (value: string) => <span className={styles.orderNumber}>{value}</span>
    },
    {
      title: '签订日期', dataIndex: 'signedDate', key: 'signedDate', width: 108,
      sorter: true,
      sortOrder: sortKey === 'signedDate' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null
    },
    {
      title: '订单/项目', dataIndex: 'projectName', key: 'projectName', width: 144,
      sorter: true, ellipsis: true
    },
    {
      title: '客户', dataIndex: 'customerName', key: 'customerName', width: 124,
      sorter: true, ellipsis: true
    },
    {
      title: '签订金额', dataIndex: 'signedAmountYuan', key: 'signedAmountYuan', width: 116,
      align: 'right', sorter: true,
      sortOrder: sortKey === 'signedAmountYuan' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
      render: (value: string) => <span className={styles.amount}>{formatAmount(value)}</span>
    },
    {
      title: '来源', key: 'source', width: 100, sorter: true,
      sortOrder: sortKey === 'source' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
      render: (_, order) => (
        <span className={styles.sourceText} data-tone={toneForStatus(order.attributionStatus)}>
          {sourceLabel(order)}
        </span>
      )
    },
    {
      title: '主要归因咨询', key: 'primaryConsultation', width: 200,
      render: (_, order) => (
        <Tooltip title={order.primaryConsultation?.summary}>
          <span className={styles.consultationCell} data-pending={!order.primaryConsultation}>
            {consultationText(order)}
          </span>
        </Tooltip>
      )
    },
    {
      title: '关联状态', dataIndex: 'attributionStatus', key: 'attributionStatus', width: 144,
      sorter: true,
      sortOrder: sortKey === 'attributionStatus' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
      render: (value: OrderAttributionStatus) => (
        <span className={styles.statusText} data-tone={toneForStatus(value)}>{STATUS_LABELS[value]}</span>
      )
    },
    {
      title: '查看', key: 'view', width: 70, align: 'center',
      render: (_, order) => (
        <Button
          type="link"
          size="small"
          aria-label={`${order.attributionStatus === 'PENDING' ? '关联咨询' : '查看'} ${order.orderNumber}`}
          onClick={(event) => openDetail(order, event.currentTarget as HTMLButtonElement)}
        >
          {order.attributionStatus === 'PENDING' ? '关联咨询' : '查看'}
        </Button>
      )
    }
  ], [sortKey, sortOrder]);

  const handleTableChange: TableProps<OrderResult>['onChange'] = (
    _pagination,
    _filters,
    sorter
  ) => {
    if (Array.isArray(sorter) || !sorter.columnKey || !sorter.order) return;
    setSortKey(String(sorter.columnKey) as OrderResultFilters['sortKey']);
    setSortOrder(sorter.order === 'ascend' ? 'asc' : 'desc');
    setPage(1);
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.visuallyHidden}>订单结果</h1>
      <div className={styles.breadcrumbRow}>
        <div className={styles.breadcrumbContext}>
          <Breadcrumb items={[
            { title: '首页' },
            { title: '转化结果' },
            { title: '订单结果' }
          ]} />
          {dataSource.state === 'DEMO' ? (
            <Tooltip title={dataSource.message}>
              <Tag>开发示例</Tag>
            </Tooltip>
          ) : null}
        </div>
        <RangePicker
          aria-label="订单日期范围"
          value={[dayjs(dateRange[0]), dayjs(dateRange[1])]}
          format="YYYY-MM-DD"
          separator="至"
          allowClear={false}
          disabledDate={(current) => dataSource.coverage ? (
            current.isBefore(dayjs(dataSource.coverage.from), 'day')
            || current.isAfter(dayjs(dataSource.coverage.to), 'day')
          ) : false}
          onChange={(values) => {
            if (!values?.[0] || !values?.[1]) return;
            setDateRange([
              values[0].format('YYYY-MM-DD'),
              values[1].format('YYYY-MM-DD')
            ]);
            setPage(1);
          }}
        />
      </div>

      {dataSource.state === 'UNAVAILABLE' ? (
        <Card className={styles.emptyCard}>
          <div className={styles.emptyState}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={dataSource.message}
            />
            <p className={styles.emptyHint}>不会使用 mock 数据替代真实订单，也不会从金额推导订单数。</p>
          </div>
        </Card>
      ) : (
        <>
          <Card className={styles.summaryCard}>
            <div className={styles.summaryLayout}>
              <div className={styles.summaryMetrics}>
                <Metric
                  title="成交订单"
                  value={view.summary.totalCount}
                  note={countChange ? <>较上一周期 <strong>{countChange}</strong></> : '上一周期无可比数据'}
                  testId="summary-order-count"
                  info="订单数按筛选范围内的去重订单记录计数，不由金额推导。"
                />
                <Metric
                  title="签订金额"
                  value={formatAmount(view.summary.signedAmountYuan)}
                  note={amountChange ? <>较上一周期 <strong>{amountChange}</strong></> : '上一周期无可比数据'}
                  testId="summary-signed-amount"
                  info="仅表示合同签订金额，不等于回款、收入或利润。"
                />
                <Metric
                  title="已关联订单"
                  value={`${view.summary.trustedCount} / ${view.summary.totalCount}`}
                  note={<>关联率 <strong>{view.summary.associationRate}</strong></>}
                  testId="summary-linked-orders"
                  info="只计来源关系已经确认且来源可信的订单。"
                />
                <Metric
                  title="待关联订单"
                  value={view.summary.unresolvedCount}
                  note="含来源无法证实的已关联记录"
                  testId="summary-pending-orders"
                  info="待处理关联包括未选择主要咨询，以及已关联但来源无法证实的订单。"
                />
              </div>

              <section className={styles.sourceOverview} aria-labelledby="source-overview-title">
                <div className={styles.sourceHeader}>
                  <h2 id="source-overview-title">来源概览</h2>
                  <span>按成交订单数 · 共 {view.summary.totalCount} 单</span>
                </div>
                <div className={styles.sourceContent}>
                  <div
                    className={styles.donutChart}
                    role="img"
                    aria-label={`订单来源概览，共 ${view.summary.totalCount} 单`}
                  >
                    <Pie
                      data={view.sourceOverview}
                      angleField="count"
                      colorField="key"
                      innerRadius={0.64}
                      radius={0.9}
                      height={130}
                      legend={false}
                      label={false}
                      scale={{
                        color: {
                          domain: Object.keys(SOURCE_COLORS),
                          range: Object.values(SOURCE_COLORS)
                        }
                      }}
                      style={{ stroke: '#ffffff', lineWidth: 2 }}
                      tooltip={{ items: [{ field: 'count', name: '订单数' }] }}
                      animate={false}
                    />
                    <div className={styles.donutCenter} aria-hidden="true">
                      <strong>{view.summary.totalCount}</strong>
                      <span>单</span>
                    </div>
                  </div>
                  <div className={styles.sourceLegend} aria-label="订单来源图例">
                    {view.sourceOverview.map((item) => (
                      <div
                        key={item.key}
                        className={styles.sourceLegendItem}
                        data-source-key={item.key}
                        data-source-count={item.count}
                        data-source-percentage={item.percentageLabel}
                      >
                        <span className={styles.legendLabel}>
                          <span
                            className={styles.legendDot}
                            style={{
                              backgroundColor: SOURCE_COLORS[item.key as OrderSourceCategory]
                            }}
                            aria-hidden="true"
                          />
                          <span>{item.label}</span>
                        </span>
                        <strong>{item.percentageLabel}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          </Card>

          <Card className={styles.trendCard}>
            <div className={styles.trendHeader}>
              <div className={styles.trendTitleRow}>
                <h2>订单趋势</h2>
                <span className={styles.trendUnit}>{metric === 'count' ? '单位：单' : '单位：元'}</span>
              </div>
              <Select
                aria-label="订单趋势指标"
                value={metric}
                onChange={setMetric}
                options={[
                  { value: 'count', label: '成交订单数' },
                  { value: 'amount', label: '签订金额' }
                ]}
              />
            </div>
            <div
              className={styles.chartRegion}
              role="img"
              aria-label={`${metric === 'count' ? '成交订单数' : '签订金额'}趋势，${currentSeriesLabel}与${previousSeriesLabel}对比`}
            >
              <Line
                data={chartData}
                xField="slot"
                yField="value"
                colorField="period"
                height={218}
                scale={{
                  x: { tickCount: 10 },
                  y: { domainMin: 0 },
                  color: {
                    domain: [currentSeriesLabel, previousSeriesLabel],
                    range: ['#1462f3', '#94a3b8']
                  }
                }}
                axis={{
                  x: { title: false, tick: false, labelAutoRotate: false },
                  y: { title: false, grid: true }
                }}
                legend={{ color: { position: 'bottom' } }}
                point={{ size: 3 }}
                style={{
                  lineWidth: 2,
                  lineDash: (datum: unknown) => (
                    (Array.isArray(datum)
                      ? (datum[0] as { period?: string } | undefined)?.period
                      : (datum as { period?: string } | undefined)?.period) === previousSeriesLabel
                      ? [6, 4]
                      : [0, 0]
                  )
                }}
                tooltip={{
                  title: { field: 'actualDate' },
                  items: [
                    (datum) => ({
                      name: datum.period,
                      value: metric === 'count' ? `${datum.exactValue} 单` : formatAmount(datum.exactValue),
                      color: datum.period === currentSeriesLabel ? '#1462f3' : '#94a3b8'
                    })
                  ]
                }}
                animate={false}
              />
            </div>
            <details className={styles.equivalentData}>
              <summary>查看订单趋势等价数据表</summary>
              <div className={styles.equivalentScroller} tabIndex={0} role="region" aria-label="订单趋势等价数据">
                <table className={styles.equivalentTable}>
                  <thead><tr><th>当前日期</th><th>{currentSeriesLabel}</th><th>上一日期</th><th>{previousSeriesLabel}</th></tr></thead>
                  <tbody>
                    {currentTrend.current.map((row, index) => (
                      <tr key={row.date}>
                        <th>{row.date}</th>
                        <td>{metric === 'count' ? `${row.value} 单` : formatAmount(row.value)}</td>
                        <td>{currentTrend.previous[index]?.date}</td>
                        <td>{metric === 'count'
                          ? `${currentTrend.previous[index]?.value} 单`
                          : formatAmount(currentTrend.previous[index]?.value || '0')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Card>

          <Card className={styles.tableCard}>
            <div className={styles.tableToolbar}>
              <h2>订单明细</h2>
              <div className={styles.tableFilters}>
                <Select
                  aria-label="订单来源筛选"
                  value={sourceFilter}
                  onChange={(value) => { setSourceFilter(value); setPage(1); }}
                  options={[
                    { value: 'ALL', label: '全部来源' },
                    ...(Object.entries(SOURCE_LABELS) as Array<[
                      OrderSourceCategory,
                      string
                    ]>).map(([value, label]) => ({ value, label }))
                  ]}
                  popupMatchSelectWidth={false}
                />
                <Select
                  aria-label="订单关联状态筛选"
                  value={statusFilter}
                  onChange={(value) => { setStatusFilter(value); setPage(1); }}
                  options={[
                    { value: 'ALL', label: '全部关联状态' },
                    { value: 'TRUSTED', label: '已关联' },
                    { value: 'SOURCE_UNKNOWN', label: '已关联·来源未知' },
                    { value: 'PENDING', label: '待关联' }
                  ]}
                  popupMatchSelectWidth={false}
                />
                <Input
                  className={styles.searchInput}
                  aria-label="搜索订单编号、项目或客户"
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); setPage(1); }}
                  prefix={<SearchOutlined aria-hidden="true" />}
                  placeholder="搜索订单编号、项目或客户"
                  allowClear
                />
              </div>
            </div>
            <Table<OrderResult>
              className={styles.orderTable}
              rowKey="id"
              columns={columns}
              dataSource={view.pageRows}
              pagination={false}
              onChange={handleTableChange}
              scroll={{ x: 1136 }}
              locale={{
                emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选条件下没有订单" />
              }}
            />
            <div className={styles.paginationRow}>
              <span data-testid="filtered-order-total">共 {view.pagination.totalItems} 条</span>
              <Pagination
                current={page}
                pageSize={pageSize}
                total={view.pagination.totalItems}
                showSizeChanger
                pageSizeOptions={[10, 20, 50]}
                showLessItems
                onChange={(nextPage, nextPageSize) => {
                  setPage(nextPageSize === pageSize ? nextPage : 1);
                  setPageSize(nextPageSize);
                }}
              />
            </div>
          </Card>

          <OrderDetailDrawer
            open={drawerOpen}
            order={selectedOrder}
            demoMode={dataSource.state === 'DEMO'}
            consultationOptions={dataSource.consultationOptions}
            draftConsultationId={draftConsultationId}
            temporaryNotice={temporaryNotice}
            onDraftChange={(value) => { setDraftConsultationId(value); setTemporaryNotice(null); }}
            onApplyTemporary={applyTemporaryAssociation}
            onClose={() => setDrawerOpen(false)}
            afterOpenChange={(nextOpen) => {
              if (nextOpen) {
                window.requestAnimationFrame(() => {
                  document.querySelector<HTMLElement>(
                    '.ant-drawer-section[aria-label="订单详情"] .ant-drawer-close'
                  )?.focus();
                });
              } else {
                window.requestAnimationFrame(() => returnFocusRef.current?.focus());
              }
            }}
          />
        </>
      )}
    </div>
  );
}

export default function OrderResultsPage() {
  return (
    <Suspense fallback={<LoadingPage />}>
      <OrderResultsContent />
    </Suspense>
  );
}
