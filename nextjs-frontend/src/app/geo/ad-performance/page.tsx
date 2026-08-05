'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Line } from '@ant-design/plots';
import {
  Alert,
  Badge,
  Breadcrumb,
  Button,
  Card,
  Descriptions,
  Empty,
  Input,
  Popover,
  Select,
  Skeleton,
  Table,
  Tooltip
} from 'antd';
import type { TableProps } from 'antd';
import {
  DownOutlined,
  LeftOutlined,
  RightOutlined,
  SearchOutlined
} from '@ant-design/icons';
import useDefaultProjectContext from '@/lib/useDefaultProjectContext';
import useMarketingCapabilities from '@/lib/useMarketingCapabilities';
import useAdPerformance, {
  AD_PERFORMANCE_FIXTURE_ENABLED,
  type AdPerformanceFixtureState
} from '@/lib/marketing/useAdPerformance';
import type {
  AdDailyMetrics,
  AdDeliveryStatus,
  AdExactMetrics,
  AdHierarchyLevel,
  AdHierarchyNode
} from '@/lib/marketing/adPerformanceAdapter';
import MarketingPageFilters from '@/components/marketing/MarketingPageFilters';
import { useMarketingFilters } from '@/components/marketing/MarketingFiltersContext';
import MarketingMetricCard, {
  MarketingMetricGrid,
  MarketingMetricPlaceholderGrid
} from '@/components/marketing/MarketingMetricCard';
import styles from './ad-performance.module.css';

type DateRange = [string, string] | null;
type DisplayLevel = 'all' | AdHierarchyLevel;
type TrendMetric = 'cost' | 'impressions' | 'clicks' | 'ctr' | 'cpc';
type SortOrder = 'ascend' | 'descend' | null;

const LEVEL_OPTIONS = [
  { value: 'all', label: '全部层级' },
  { value: 'project', label: '仅项目' },
  { value: 'scheme', label: '仅计划' },
  { value: 'unit', label: '仅单元' },
  { value: 'keyword', label: '仅关键词' }
];

const TREND_OPTIONS: Array<{ value: TrendMetric; label: string }> = [
  { value: 'cost', label: '消费' },
  { value: 'impressions', label: '展现' },
  { value: 'clicks', label: '点击' },
  { value: 'ctr', label: 'CTR' },
  { value: 'cpc', label: '平均 CPC' }
];

const AD_SUMMARY_PLACEHOLDERS = Object.freeze([
  { title: '总消费' },
  { title: '总展现' },
  { title: '总点击' },
  { title: '平均点击成本', metricKey: 'CPC' }
]);

function groupDigits(value: string): string {
  return BigInt(value).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
}

function powerOfTen(value: number): bigint {
  return BigInt(10) ** BigInt(value);
}

function roundedDivision(numerator: bigint, denominator: bigint): bigint {
  if (denominator === BigInt(0)) throw new RangeError('分母不能为零');
  return ((numerator * BigInt(2)) + denominator) / (denominator * BigInt(2));
}

function fixedDecimal(value: bigint, digits: number): string {
  const scale = powerOfTen(digits);
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  const whole = absolute / scale;
  if (!digits) return `${negative ? '-' : ''}${groupDigits(whole.toString())}`;
  const fraction = (absolute % scale).toString().padStart(digits, '0');
  return `${negative ? '-' : ''}${groupDigits(whole.toString())}.${fraction}`;
}

function signedRoundedDivision(numerator: bigint, denominator: bigint): bigint {
  return numerator < BigInt(0)
    ? -roundedDivision(-numerator, denominator)
    : roundedDivision(numerator, denominator);
}

function formatMoney(
  value: string | null,
  scale: number,
  digits = 0,
  currency = 'CNY'
): string {
  if (value == null) return '—';
  const amount = BigInt(value);
  const rounded = roundedDivision(amount * powerOfTen(digits), powerOfTen(scale));
  const symbol = currency === 'CNY' ? '¥' : `${currency} `;
  return `${symbol}${fixedDecimal(rounded, digits)}`;
}

function calculateRate(metrics: AdExactMetrics): string {
  const impressions = BigInt(metrics.impressions);
  if (impressions === BigInt(0)) return '—';
  const hundredthsOfAPercent = roundedDivision(
    BigInt(metrics.clicks) * BigInt(10_000),
    impressions
  );
  return `${fixedDecimal(hundredthsOfAPercent, 2)}%`;
}

function calculateCpc(
  metrics: AdExactMetrics,
  scale: number,
  currency: string
): string {
  const clicks = BigInt(metrics.clicks);
  if (clicks === BigInt(0)) return '—';
  const cents = roundedDivision(
    BigInt(metrics.costAmountScaled) * BigInt(100),
    clicks * powerOfTen(scale)
  );
  const symbol = currency === 'CNY' ? '¥' : `${currency} `;
  return `${symbol}${fixedDecimal(cents, 2)}`;
}

function formatExactChange(current: string, previous: string): string | null {
  const currentValue = BigInt(current);
  const previousValue = BigInt(previous);
  if (previousValue === BigInt(0)) return null;
  const tenths = signedRoundedDivision(
    (currentValue - previousValue) * BigInt(1000),
    previousValue
  );
  const sign = tenths > BigInt(0) ? '+' : '';
  return `${sign}${fixedDecimal(tenths, 1)}%`;
}

function formatRatioChange(
  currentNumerator: string,
  currentDenominator: string,
  previousNumerator: string,
  previousDenominator: string
): string | null {
  const currentDen = BigInt(currentDenominator);
  const previousDen = BigInt(previousDenominator);
  const previousNum = BigInt(previousNumerator);
  if (currentDen === BigInt(0) || previousDen === BigInt(0) || previousNum === BigInt(0)) {
    return null;
  }
  const currentNum = BigInt(currentNumerator);
  const tenths = signedRoundedDivision(
    (currentNum * previousDen - previousNum * currentDen) * BigInt(1000),
    previousNum * currentDen
  );
  const sign = tenths > BigInt(0) ? '+' : '';
  return `${sign}${fixedDecimal(tenths, 1)}%`;
}

function comparisonTone(change: string | null, lowerIsBetter = false) {
  if (!change || change.startsWith('0')) return 'neutral' as const;
  const rising = change.startsWith('+');
  if (lowerIsBetter) return rising ? 'bad' as const : 'good' as const;
  return rising ? 'good' as const : 'bad' as const;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);
  return reduced;
}

function fixtureStateFromLocation(
  fixtureEnabled: boolean
): AdPerformanceFixtureState {
  if (!fixtureEnabled || typeof window === 'undefined') {
    return 'ready';
  }
  const value = new URLSearchParams(window.location.search).get('fixtureState');
  return ['loading', 'empty', 'error'].includes(value || '')
    ? value as AdPerformanceFixtureState
    : 'ready';
}

function flattenNodes(nodes: AdHierarchyNode[]): AdHierarchyNode[] {
  return nodes.flatMap((node) => [
    node,
    ...flattenNodes(node.children || [])
  ]);
}

function withoutChildren(node: AdHierarchyNode): AdHierarchyNode {
  return { ...node, children: undefined };
}

function filterTree(
  nodes: AdHierarchyNode[],
  query: string
): AdHierarchyNode[] {
  if (!query) return nodes;
  const normalized = query.trim().toLocaleLowerCase('zh-CN');
  return nodes.flatMap((node) => {
    const children = filterTree(node.children || [], query);
    const matches = (
      node.name.toLocaleLowerCase('zh-CN').includes(normalized)
      || node.id.toLocaleLowerCase('zh-CN').includes(normalized)
    );
    if (!matches && !children.length) return [];
    return [{
      ...node,
      children: node.children?.length
        ? (matches ? node.children : children)
        : undefined
    }];
  });
}

function expandableKeys(nodes: AdHierarchyNode[]): string[] {
  return nodes.flatMap((node) => [
    ...(node.children?.length ? [node.key] : []),
    ...expandableKeys(node.children || [])
  ]);
}

function lastChildKeys(nodes: AdHierarchyNode[]): Set<string> {
  const keys = new Set<string>();
  const collect = (siblings: AdHierarchyNode[]) => {
    siblings.forEach((node) => {
      if (!node.children?.length) return;
      keys.add(node.children[node.children.length - 1].key);
      collect(node.children);
    });
  };
  collect(nodes);
  return keys;
}

function compareNodes(
  left: AdHierarchyNode,
  right: AdHierarchyNode,
  field: string
): number {
  if (field === 'name') return left.name.localeCompare(right.name, 'zh-CN');
  if (field === 'status') return left.status.localeCompare(right.status);
  const exactField = field === 'budget'
    ? 'budgetAmountScaled'
    : field === 'cost'
      ? 'costAmountScaled'
      : field;
  const leftValue = exactField === 'budgetAmountScaled'
    ? left.budgetAmountScaled
    : left.metrics[exactField as keyof AdExactMetrics];
  const rightValue = exactField === 'budgetAmountScaled'
    ? right.budgetAmountScaled
    : right.metrics[exactField as keyof AdExactMetrics];
  if (leftValue == null && rightValue == null) return 0;
  if (leftValue == null) return 1;
  if (rightValue == null) return -1;
  const difference = BigInt(leftValue) - BigInt(rightValue);
  return difference < BigInt(0) ? -1 : difference > BigInt(0) ? 1 : 0;
}

function sortTree(
  nodes: AdHierarchyNode[],
  field: string | null,
  order: SortOrder
): AdHierarchyNode[] {
  if (!field || !order) return nodes;
  const direction = order === 'ascend' ? 1 : -1;
  return [...nodes]
    .sort((left, right) => compareNodes(left, right, field) * direction)
    .map((node) => ({
      ...node,
      children: node.children
        ? sortTree(node.children, field, order)
        : undefined
    }));
}

function findNode(
  nodes: AdHierarchyNode[],
  key: string | null
): AdHierarchyNode | null {
  if (!key) return null;
  for (const node of nodes) {
    if (node.key === key) return node;
    const child = findNode(node.children || [], key);
    if (child) return child;
  }
  return null;
}

function chartMetricValue(
  row: AdDailyMetrics,
  metric: TrendMetric,
  costScale: number
): number | null {
  if (metric === 'impressions') return Number(row.impressions);
  if (metric === 'clicks') return Number(row.clicks);
  if (metric === 'cost') {
    return Number(row.costAmountScaled) / (10 ** costScale);
  }
  if (metric === 'ctr') {
    if (row.impressions === '0') return null;
    return (Number(row.clicks) / Number(row.impressions)) * 100;
  }
  if (row.clicks === '0') return null;
  return (
    Number(row.costAmountScaled) / (10 ** costScale) / Number(row.clicks)
  );
}

function formatChartValue(
  value: number,
  metric: TrendMetric,
  currency: string
): string {
  if (metric === 'ctr') return `${value.toFixed(2)}%`;
  if (metric === 'cpc') {
    return `${currency === 'CNY' ? '¥' : `${currency} `}${value.toFixed(2)}`;
  }
  if (metric === 'cost') {
    const symbol = currency === 'CNY' ? '¥' : `${currency} `;
    return `${symbol}${Math.round(value).toLocaleString('en-US')}`;
  }
  return Math.round(value).toLocaleString('en-US');
}

function statusLabel(status: AdDeliveryStatus): string {
  if (status === 'active') return '投放中';
  if (status === 'paused') return '已暂停';
  return '未提供';
}

function StatusBadge({ status }: { status: AdDeliveryStatus }) {
  if (status === 'unknown') {
    return (
      <Tooltip title="当前百度报表未提供该层级的实时投放状态。" trigger={['hover']}>
        <span className={styles.unknownStatus}>未提供</span>
      </Tooltip>
    );
  }
  return (
    <Badge
      status={status === 'active' ? 'success' : 'default'}
      text={statusLabel(status)}
    />
  );
}

function DetailPopover({
  node,
  open,
  onOpenChange
}: {
  node: AdHierarchyNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const descriptionId = `ad-detail-${node.key.replace(/[^a-z0-9-]/giu, '-')}`;
  const title = node.level === 'project'
    ? '项目详情'
    : node.level === 'scheme'
      ? '计划详情'
      : node.level === 'unit' ? '单元详情' : '关键词详情';
  return (
    <Popover
      title={title}
      content={(
        <Descriptions
          id={descriptionId}
          className={styles.detailDescriptions}
          size="small"
          column={1}
          colon={false}
          items={node.details.map((item) => ({
            key: item.label,
            label: item.label,
            children: item.status
              ? <StatusBadge status={item.status} />
              : item.value
          }))}
        />
      )}
      trigger={['hover']}
      placement="left"
      open={open}
      onOpenChange={onOpenChange}
      mouseEnterDelay={0.08}
      mouseLeaveDelay={0.16}
      autoAdjustOverflow
      destroyOnHidden
    >
      <Button
        type="link"
        size="small"
        aria-describedby={descriptionId}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        查看详情
      </Button>
    </Popover>
  );
}

function LoadingPage({ dateRange }: { dateRange: DateRange }) {
  return (
    <div className={styles.moduleStack} aria-busy="true">
      <MarketingMetricPlaceholderGrid
        items={AD_SUMMARY_PLACEHOLDERS}
        ariaLabel="广告表现指标加载中"
        loading
      />
      <Card className={styles.trendCard}>
        <Skeleton active title paragraph={{ rows: 7 }} />
      </Card>
      <Card className={styles.tableCard}>
        <Skeleton active title paragraph={{ rows: 6 }} />
      </Card>
      <span className={styles.visuallyHidden}>
        正在加载 {dateRange?.join(' 至 ') || '广告表现'}
      </span>
    </div>
  );
}

export default function AdPerformancePage() {
  const reducedMotion = useReducedMotion();
  const defaultContext = useDefaultProjectContext();
  const { device, setDevice, dateRange, setDateRange } = useMarketingFilters();
  const [fixtureEnabled, setFixtureEnabled] = useState(
    AD_PERFORMANCE_FIXTURE_ENABLED
  );
  const marketing = useMarketingCapabilities(!fixtureEnabled);
  const [fixtureState, setFixtureState] = useState<AdPerformanceFixtureState>('ready');
  const [trendMetric, setTrendMetric] = useState<TrendMetric>('cost');
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);
  const [displayLevel, setDisplayLevel] = useState<DisplayLevel>('all');
  const [searchValue, setSearchValue] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [openPopoverKey, setOpenPopoverKey] = useState<string | null>(null);
  const [sortState, setSortState] = useState<{
    field: string | null;
    order: SortOrder;
  }>({ field: null, order: null });

  useEffect(() => {
    const devFixtureRequested = process.env.NODE_ENV !== 'production'
      && new URLSearchParams(window.location.search).get('fixture')
        === 'ad-performance';
    const nextFixtureEnabled = AD_PERFORMANCE_FIXTURE_ENABLED
      || devFixtureRequested;
    setFixtureEnabled(nextFixtureEnabled);
    setFixtureState(fixtureStateFromLocation(nextFixtureEnabled));
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenPopoverKey(null);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, []);

  const projectId = fixtureEnabled
    ? 'fixture-market-workspace'
    : defaultContext.project?.id || '';
  const enabled = fixtureEnabled || (
    Boolean(projectId) && marketing.capabilities.adsRead
  );
  const performance = useAdPerformance({
    projectId,
    projectName: defaultContext.project?.name,
    enabled,
    fixtureEnabled,
    dateRange,
    fixtureState,
    onDateRangeAdjusted: setDateRange
  });

  const selectedNode = useMemo(() => findNode(
    performance.data?.structure || [],
    selectedNodeKey
  ), [performance.data?.structure, selectedNodeKey]);
  const currentTrend = useMemo(() => (
    selectedNode?.currentTrend || performance.data?.currentTrend || []
  ), [performance.data?.currentTrend, selectedNode]);
  const previousTrend = useMemo(() => (
    selectedNode?.previousTrend || performance.data?.previousTrend || []
  ), [performance.data?.previousTrend, selectedNode]);
  const currentOverviewMetrics = performance.data?.summary || {
    costAmountScaled: '0',
    impressions: '0',
    clicks: '0'
  };
  const previousOverviewMetrics = performance.data?.previousSummary || null;
  const previousUnavailableReason = performance.data?.previousState === 'READY'
    ? ''
    : performance.data?.previousUnavailableReason
      || '上一周期广告数据不可用。';
  const currentPeriodLabel = performance.data
    ? `近 ${performance.data.period.days} 天`
    : '当前周期';
  const previousPeriodLabel = performance.data
    ? `较前 ${performance.data.period.days} 天`
    : '上一周期';
  const chartData = useMemo(() => {
    if (!performance.data) return [];
    const createRows = (
      rows: AdDailyMetrics[],
      period: string
    ) => rows.flatMap((row, index) => {
      const value = chartMetricValue(
        row,
        trendMetric,
        performance.data?.costScale || 2
      );
      if (value == null || !Number.isFinite(value)) return [];
      return [{
        slot: index,
        actualDate: row.date,
        value,
        displayValue: formatChartValue(
          value,
          trendMetric,
          performance.data?.currency || 'CNY'
        ),
        period
      }];
    });
    return [
      ...createRows(currentTrend, currentPeriodLabel),
      ...createRows(previousTrend, previousPeriodLabel)
    ];
  }, [
    currentPeriodLabel,
    currentTrend,
    performance.data,
    previousPeriodLabel,
    previousTrend,
    trendMetric
  ]);

  const treeData = useMemo(() => {
    const source = performance.data?.structure || [];
    const levelRows = displayLevel === 'all'
      ? filterTree(source, searchValue)
      : flattenNodes(source)
          .filter((node) => node.level === displayLevel)
          .filter((node) => {
            const query = searchValue.trim().toLocaleLowerCase('zh-CN');
            return !query
              || node.name.toLocaleLowerCase('zh-CN').includes(query)
              || node.id.toLocaleLowerCase('zh-CN').includes(query);
          })
          .map(withoutChildren);
    return sortTree(treeDataCopy(levelRows), sortState.field, sortState.order);
  }, [displayLevel, performance.data?.structure, searchValue, sortState]);
  const terminalSiblingKeys = useMemo(
    () => lastChildKeys(treeData),
    [treeData]
  );
  const defaultExpandedKeys = useMemo(
    () => (performance.data?.structure || [])
      .filter((node) => Boolean(node.children?.length))
      .map((node) => node.key),
    [performance.data?.structure]
  );

  useEffect(() => {
    setExpandedKeys(defaultExpandedKeys);
  }, [defaultExpandedKeys]);

  useEffect(() => {
    if (!searchValue || displayLevel !== 'all') return;
    setExpandedKeys(expandableKeys(treeData));
  }, [displayLevel, searchValue, treeData]);

  const columns = useMemo<TableProps<AdHierarchyNode>['columns']>(() => {
    if (!performance.data) return [];
    const orderFor = (field: string) => (
      sortState.field === field ? sortState.order : null
    );
    return [
      {
        title: '名称',
        dataIndex: 'name',
        key: 'name',
        width: 260,
        fixed: 'left',
        sorter: true,
        sortOrder: orderFor('name'),
        render: (name: string) => (
          <Tooltip
            title={name}
            placement="topLeft"
            mouseEnterDelay={0.25}
            trigger={['hover']}
          >
            <span className={styles.nameCell}>{name}</span>
          </Tooltip>
        )
      },
      {
        title: '投放状态',
        dataIndex: 'status',
        key: 'status',
        width: 88,
        sorter: true,
        sortOrder: orderFor('status'),
        render: (status: AdDeliveryStatus) => <StatusBadge status={status} />
      },
      {
        title: '预算',
        dataIndex: 'budgetAmountScaled',
        key: 'budget',
        width: 108,
        align: 'right',
        sorter: true,
        sortOrder: orderFor('budget'),
        render: (value: string | null) => formatMoney(
          value,
          performance.data?.costScale || 2,
          0,
          performance.data?.currency
        )
      },
      {
        title: '消费',
        key: 'cost',
        width: 108,
        align: 'right',
        sorter: true,
        sortOrder: orderFor('cost'),
        render: (_, record) => formatMoney(
          record.metrics.costAmountScaled,
          performance.data?.costScale || 2,
          0,
          performance.data?.currency
        )
      },
      {
        title: '展现',
        key: 'impressions',
        width: 112,
        align: 'right',
        sorter: true,
        sortOrder: orderFor('impressions'),
        render: (_, record) => groupDigits(record.metrics.impressions)
      },
      {
        title: '点击',
        key: 'clicks',
        width: 84,
        align: 'right',
        sorter: true,
        sortOrder: orderFor('clicks'),
        render: (_, record) => groupDigits(record.metrics.clicks)
      },
      {
        title: 'CTR',
        key: 'ctr',
        width: 76,
        align: 'right',
        render: (_, record) => calculateRate(record.metrics)
      },
      {
        title: '平均 CPC',
        key: 'cpc',
        width: 104,
        align: 'right',
        render: (_, record) => calculateCpc(
          record.metrics,
          performance.data?.costScale || 2,
          performance.data?.currency || 'CNY'
        )
      },
      {
        title: '详情',
        key: 'details',
        width: 96,
        align: 'center',
        fixed: 'right',
        render: (_, record) => (
          <DetailPopover
            node={record}
            open={openPopoverKey === record.key}
            onOpenChange={(open) => setOpenPopoverKey(open ? record.key : null)}
          />
        )
      }
    ];
  }, [openPopoverKey, performance.data, sortState]);

  const shellLoading = !fixtureEnabled && (
    defaultContext.loading || marketing.loading
  );
  const pageError = !fixtureEnabled
    ? defaultContext.errorMessage
      || (!marketing.capabilities.adsRead && !marketing.loading
        ? '广告数据尚未开放。'
        : performance.error)
    : performance.error;
  return (
    <main className={styles.page} aria-label="广告表现">
      <div className={styles.breadcrumbRow}>
        <Breadcrumb
          items={[
            { title: '首页' },
            { title: '投放与流量' },
            { title: '广告表现' }
          ]}
        />
        <MarketingPageFilters
          device={device}
          onDeviceChange={setDevice}
          availableDevices={['all']}
          dateRange={dateRange}
          onDateRangeChange={(nextRange) => {
            setSelectedNodeKey(null);
            setDateRange(nextRange);
          }}
          dateAriaLabel="广告表现日期范围"
          minDate={performance.data?.availableFrom || null}
          maxDate={performance.data?.availableTo || null}
          presetAnchor={performance.data?.availableTo || dateRange?.[1] || null}
        />
      </div>

      {pageError ? (
        <Alert
          className={styles.pageAlert}
          type="error"
          showIcon
          title={pageError}
          action={(
            <Button size="small" onClick={() => void performance.reload()}>
              重试
            </Button>
          )}
        />
      ) : null}

      {!pageError && performance.warning ? (
        <Alert
          className={styles.pageAlert}
          type="warning"
          showIcon
          title={performance.warning}
          action={(
            <Button size="small" onClick={() => void performance.reload()}>
              重试
            </Button>
          )}
        />
      ) : null}

      {!pageError && performance.data?.previousState === 'ERROR' ? (
        <Alert
          className={styles.pageAlert}
          type="warning"
          showIcon
          title={`上一周期比较读取失败：${performance.data.previousUnavailableReason}`}
          action={(
            <Button size="small" onClick={() => void performance.reload()}>
              重试
            </Button>
          )}
        />
      ) : null}

      {shellLoading || performance.loading || !performance.data ? (
        pageError ? (
          <MarketingMetricPlaceholderGrid
            items={AD_SUMMARY_PLACEHOLDERS}
            ariaLabel="广告表现周期汇总指标"
            missingReason={pageError}
          />
        ) : <LoadingPage dateRange={dateRange} />
      ) : (
        <div className={styles.moduleStack}>
          <MarketingMetricGrid ariaLabel="广告表现周期汇总指标">
            {[
              {
                title: '总消费', key: 'cost', metricKey: undefined,
                current: formatMoney(currentOverviewMetrics.costAmountScaled, performance.data.costScale, 0, performance.data.currency),
                previous: previousOverviewMetrics
                  ? formatMoney(previousOverviewMetrics.costAmountScaled, performance.data.costScale, 0, performance.data.currency)
                  : null,
                change: previousOverviewMetrics
                  ? formatExactChange(currentOverviewMetrics.costAmountScaled, previousOverviewMetrics.costAmountScaled)
                  : null,
                lowerIsBetter: true,
                info: '所选周期的百度推广消费。',
                previousMissingReason: previousUnavailableReason,
                changeMissingReason: previousUnavailableReason
                  || '上一周期为 0，无法计算变化率。'
              },
              {
                title: '总展现', key: 'impressions', metricKey: undefined,
                current: groupDigits(currentOverviewMetrics.impressions),
                previous: previousOverviewMetrics
                  ? groupDigits(previousOverviewMetrics.impressions)
                  : null,
                change: previousOverviewMetrics
                  ? formatExactChange(currentOverviewMetrics.impressions, previousOverviewMetrics.impressions)
                  : null,
                info: '所选周期的百度推广展现数。',
                previousMissingReason: previousUnavailableReason,
                changeMissingReason: previousUnavailableReason
                  || '上一周期为 0，无法计算变化率。'
              },
              {
                title: '总点击', key: 'clicks', metricKey: undefined,
                current: groupDigits(currentOverviewMetrics.clicks),
                previous: previousOverviewMetrics
                  ? groupDigits(previousOverviewMetrics.clicks)
                  : null,
                change: previousOverviewMetrics
                  ? formatExactChange(currentOverviewMetrics.clicks, previousOverviewMetrics.clicks)
                  : null,
                info: '百度推广点击数，不等于站内访问数。',
                previousMissingReason: previousUnavailableReason,
                changeMissingReason: previousUnavailableReason
                  || '上一周期为 0，无法计算变化率。'
              },
              {
                title: '平均点击成本', key: 'cpc', metricKey: 'CPC',
                current: calculateCpc(currentOverviewMetrics, performance.data.costScale, performance.data.currency),
                previous: previousOverviewMetrics
                  ? calculateCpc(previousOverviewMetrics, performance.data.costScale, performance.data.currency)
                  : null,
                change: previousOverviewMetrics
                  ? formatRatioChange(
                      currentOverviewMetrics.costAmountScaled,
                      currentOverviewMetrics.clicks,
                      previousOverviewMetrics.costAmountScaled,
                      previousOverviewMetrics.clicks
                    )
                  : null,
                lowerIsBetter: true,
                info: '广告消费 ÷ 广告点击数，越低越好。',
                previousMissingReason: previousUnavailableReason
                  || '上一周期点击数为 0，无法计算平均点击成本。',
                changeMissingReason: previousUnavailableReason
                  || '本期或上期缺少可比较的平均点击成本基准。'
              }
            ].map((item) => (
              <MarketingMetricCard
                key={item.key}
                title={item.title}
                metricKey={item.metricKey}
                current={item.current === '—' ? null : item.current}
                previous={item.previous === '—' ? null : item.previous}
                change={item.change}
                tone={comparisonTone(item.change, item.lowerIsBetter)}
                info={item.info}
                previousMissingReason={item.previousMissingReason}
                changeMissingReason={item.changeMissingReason}
              />
            ))}
          </MarketingMetricGrid>

          <Card className={styles.trendCard}>
            <div className={styles.trendHeader}>
              <div className={styles.trendTitleGroup}>
                <h2>{selectedNode?.name || '总体'} · 每日趋势</h2>
                {selectedNode ? (
                  <Button
                    type="link"
                    size="small"
                    icon={<LeftOutlined />}
                    onClick={() => setSelectedNodeKey(null)}
                  >
                    返回总体
                  </Button>
                ) : null}
              </div>
              <label className={styles.metricSelect}>
                <span>指标：</span>
                <Select<TrendMetric>
                  aria-label="趋势指标"
                  value={trendMetric}
                  onChange={setTrendMetric}
                  options={TREND_OPTIONS}
                  popupMatchSelectWidth={false}
                />
              </label>
            </div>
            {chartData.length ? (
              <div
                className={styles.chartRegion}
                role="img"
                aria-label={`${selectedNode?.name || '总体'}${TREND_OPTIONS.find((item) => item.value === trendMetric)?.label || ''}每日趋势，${currentPeriodLabel}与${previousPeriodLabel}`}
              >
                <Line
                  data={chartData}
                  xField="slot"
                  yField="value"
                  seriesField="period"
                  colorField="period"
                  height={250}
                  scale={{
                    x: {
                      domainMin: 0,
                      domainMax: Math.max(currentTrend.length - 1, 0),
                      tickCount: 8
                    },
                    y: { domainMin: 0 },
                    color: {
                      domain: [currentPeriodLabel, previousPeriodLabel],
                      range: ['#2f6bff', '#94a3b8']
                    }
                  }}
                  axis={{
                    x: {
                      title: false,
                      tick: false,
                      labelAutoRotate: false,
                      labelFormatter: (value: string) => (
                        currentTrend[Math.round(Number(value))]?.date.slice(5)
                        || ''
                      )
                    },
                    y: {
                      title: false,
                      grid: true,
                      labelFormatter: (value: string) => formatChartValue(
                        Number(value),
                        trendMetric,
                        performance.data?.currency || 'CNY'
                      )
                    }
                  }}
                  legend={{
                    color: {
                      position: 'bottom',
                      layout: { justifyContent: 'center' }
                    }
                  }}
                  point={{ size: 3 }}
                  style={{
                    lineWidth: 2,
                    lineDash: (datum: Record<string, unknown> | Array<Record<string, unknown>>) => (
                      (Array.isArray(datum) ? datum[0]?.period : datum?.period)
                        === previousPeriodLabel
                        ? [6, 4]
                        : [0, 0]
                    )
                  }}
                  tooltip={{
                    title: { field: 'actualDate' },
                    items: [
                      (datum: { period: string; displayValue: string }) => ({
                        name: datum.period,
                        value: datum.displayValue,
                        color: datum.period === currentPeriodLabel
                          ? '#2f6bff'
                          : '#94a3b8'
                      })
                    ]
                  }}
                  animate={reducedMotion ? false : {
                    enter: { type: 'fadeIn', duration: 180 },
                    update: { type: 'fadeIn', duration: 180 }
                  }}
                />
              </div>
            ) : (
              <Empty
                className={styles.trendEmpty}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={selectedNode
                  ? '该对象的逐日趋势字段尚未接入'
                  : '当前日期范围没有趋势数据'}
              />
            )}
          </Card>

          <Card className={styles.tableCard}>
            <div className={styles.tableToolbar}>
              <div className={styles.tableToolbarLeft}>
                <h2>投放明细</h2>
                <label>
                  <span>显示层级：</span>
                  <Select<DisplayLevel>
                    aria-label="显示层级"
                    value={displayLevel}
                    options={LEVEL_OPTIONS}
                    onChange={(value) => {
                      setDisplayLevel(value);
                      setSelectedNodeKey(null);
                    }}
                    popupMatchSelectWidth={false}
                  />
                </label>
              </div>
              <Input
                className={styles.searchInput}
                aria-label="搜索名称或 ID"
                prefix={<SearchOutlined />}
                placeholder="搜索名称/ID"
                value={searchValue}
                allowClear
                onChange={(event) => setSearchValue(event.target.value)}
              />
            </div>
            <Table<AdHierarchyNode>
              aria-label="广告投放明细表格"
              className={styles.structureTable}
              rowKey="key"
              columns={columns}
              dataSource={treeData}
              pagination={false}
              size="middle"
              tableLayout="fixed"
              scroll={{ x: 1036 }}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={searchValue
                      ? '没有匹配的名称或 ID'
                      : '当前日期范围没有结构数据'}
                  />
                )
              }}
              expandable={{
                indentSize: 32,
                expandedRowKeys: displayLevel === 'all' ? expandedKeys : [],
                onExpandedRowsChange: (keys) => setExpandedKeys([...keys]),
                rowExpandable: (record) => (
                  displayLevel === 'all' && Boolean(record.children?.length)
                ),
                expandIcon: ({ expanded, onExpand, record, expandable }) => (
                  expandable ? (
                    <Button
                      className={styles.expandButton}
                      type="text"
                      size="small"
                      aria-label={expanded
                        ? `收起${record.name}`
                        : `展开${record.name}`}
                      icon={expanded ? <DownOutlined /> : <RightOutlined />}
                      onClick={(event) => {
                        event.stopPropagation();
                        onExpand(record, event);
                      }}
                    />
                  ) : (
                    <span
                      className={[
                        styles.expandPlaceholder,
                        displayLevel === 'all' && record.level === 'keyword'
                          ? styles.leafConnector
                          : '',
                        terminalSiblingKeys.has(record.key)
                          ? styles.leafConnectorLast
                          : ''
                      ].filter(Boolean).join(' ')}
                    />
                  )
                )
              }}
              rowClassName={(record) => (
                record.key === selectedNodeKey ? styles.selectedRow : ''
              )}
              onRow={(record) => ({
                tabIndex: 0,
                'aria-selected': record.key === selectedNodeKey,
                onClick: (event) => {
                  if ((event.target as HTMLElement).closest('button, a, input')) return;
                  setSelectedNodeKey((current) => (
                    current === record.key ? null : record.key
                  ));
                },
                onKeyDown: (event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  if ((event.target as HTMLElement).closest('button, a, input')) return;
                  event.preventDefault();
                  setSelectedNodeKey((current) => (
                    current === record.key ? null : record.key
                  ));
                }
              })}
              onChange={(_, __, sorter) => {
                const nextSorter = Array.isArray(sorter) ? sorter[0] : sorter;
                setSortState({
                  field: typeof nextSorter?.columnKey === 'string'
                    ? nextSorter.columnKey
                    : null,
                  order: nextSorter?.order || null
                });
              }}
            />
          </Card>
        </div>
      )}
    </main>
  );
}

function treeDataCopy(nodes: AdHierarchyNode[]): AdHierarchyNode[] {
  return nodes.map((node) => ({
    ...node,
    children: node.children ? treeDataCopy(node.children) : undefined
  }));
}
