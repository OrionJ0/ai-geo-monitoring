'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import dayjs from 'dayjs';
import { Heatmap, Pie, Scatter } from '@ant-design/plots';
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Empty,
  Input,
  Radio,
  Segmented,
  Select,
  Skeleton,
  Table,
  Tooltip
} from 'antd';
import type { TableProps } from 'antd';
import {
  SearchOutlined
} from '@ant-design/icons';
import useDefaultProjectContext from '@/lib/useDefaultProjectContext';
import useMarketingCapabilities from '@/lib/useMarketingCapabilities';
import {
  KEYWORD_TAGS,
  buildKeywordActionDistribution,
  buildKeywordAverageBenchmark,
  buildKeywordScatter,
  filterKeywordRows
} from '@/utils/keywordAnalysis.cjs';
import type {
  KeywordActionDistribution,
  KeywordAnalysisRow,
  KeywordAnomaly,
  KeywordBenchmark,
  KeywordCostRange,
  KeywordScatter,
  KeywordScatterPoint,
  KeywordStageFilter,
  KeywordTag
} from '@/lib/marketing/keywordAnalysisTypes';
import {
  KEYWORD_FIXTURE_RANGE
} from '@/fixtures/keywordAnalysis.fixture.cjs';
import useKeywordAnalysis, {
  KEYWORD_ANALYSIS_FIXTURE_ENABLED,
  type KeywordFixtureState,
  type KeywordResourceSort
} from '@/lib/marketing/useKeywordAnalysis';
import MarketingPageFilters from '@/components/marketing/MarketingPageFilters';
import { useMarketingFilters } from '@/components/marketing/MarketingFiltersContext';
import MarketingMetricCard, {
  MarketingMetricGrid,
  MarketingMetricPlaceholderGrid
} from '@/components/marketing/MarketingMetricCard';
import sharedStyles from '../ad-performance/ad-performance.module.css';
import styles from './keyword-analysis.module.css';

const KEYWORD_SUMMARY_PLACEHOLDERS = Object.freeze([
  { title: '广告关键词数' },
  { title: '展现' },
  { title: '点击' },
  { title: '消费' }
]);
type TagFilter = 'all' | KeywordTag;
type BenchmarkMode = 'median' | 'account-average';
type ChartMode = 'scatter' | 'density';

const TYPED_KEYWORD_TAGS = KEYWORD_TAGS as readonly KeywordTag[];

const CONFIGURED_TAG_OPTIONS = [
  { value: 'all', label: '全部' },
  ...TYPED_KEYWORD_TAGS.map((tag) => ({ value: tag, label: tag }))
];

const COST_OPTIONS: Array<{ value: KeywordCostRange; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'zero', label: '无消费' },
  { value: 'under-10000', label: '0–1 万' },
  { value: '10000-50000', label: '1–5 万' },
  { value: 'over-50000', label: '5 万以上' }
];

const ANOMALY_OPTIONS: Array<{ value: KeywordAnomaly; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'high-ctr-low-cpc', label: '高 CTR · 低 CPC' },
  { value: 'low-ctr-high-cpc', label: '低 CTR · 高 CPC' },
  { value: 'high-ctr-high-cpc', label: '高 CTR · 高 CPC' },
  { value: 'low-ctr-low-cpc', label: '低 CTR · 低 CPC' }
];

const TAG_COLORS: Record<KeywordTag, string> = {
  优先加投: '#1677ff',
  稳健保持: '#20a464',
  控制浪费: '#ff4d4f',
  样本不足: '#aab2bf'
};

const TAG_CLASS_NAMES: Record<KeywordTag, string> = {
  优先加投: styles.tagPriority,
  稳健保持: styles.tagStable,
  控制浪费: styles.tagWaste,
  样本不足: styles.tagInsufficient
};

function groupDigits(value: string): string {
  return BigInt(value).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
}

function formatMoney(
  scaledValue: string,
  scale: number,
  digits = 0,
  currency = 'CNY'
): string {
  const factor = BigInt(10) ** BigInt(scale);
  const decimals = BigInt(10) ** BigInt(digits);
  const rounded = (
    (BigInt(scaledValue) * decimals * BigInt(2) + factor)
    / (factor * BigInt(2))
  );
  const whole = rounded / decimals;
  const fraction = digits
    ? `.${(rounded % decimals).toString().padStart(digits, '0')}`
    : '';
  const symbol = currency === 'CNY' ? '¥' : `${currency} `;
  return `${symbol}${groupDigits(whole.toString())}${fraction}`;
}

function roundedDivision(numerator: bigint, denominator: bigint): bigint {
  if (denominator === BigInt(0)) throw new RangeError('分母不能为零');
  const absolute = numerator < BigInt(0) ? -numerator : numerator;
  const rounded = ((absolute * BigInt(2)) + denominator)
    / (denominator * BigInt(2));
  return numerator < BigInt(0) ? -rounded : rounded;
}

function formatExactChange(current: string, previous: string): string | null {
  const previousValue = BigInt(previous);
  if (previousValue === BigInt(0)) return null;
  const tenths = roundedDivision(
    (BigInt(current) - previousValue) * BigInt(1000),
    previousValue
  );
  const sign = tenths > BigInt(0) ? '+' : '';
  const absolute = tenths < BigInt(0) ? -tenths : tenths;
  return `${tenths < BigInt(0) ? '-' : sign}${absolute / BigInt(10)}.${absolute % BigInt(10)}%`;
}

function changeTone(
  change: string | null,
  lowerIsBetter = false
): 'good' | 'bad' | 'neutral' {
  if (!change || change.startsWith('0')) return 'neutral';
  const rising = change.startsWith('+');
  if (lowerIsBetter) return rising ? 'bad' : 'good';
  return rising ? 'good' : 'bad';
}

function formatPercent(value: number | null, digits = 2): string {
  return value == null || !Number.isFinite(value)
    ? '—'
    : `${value.toFixed(digits)}%`;
}

function fixtureStateFromLocation(): KeywordFixtureState {
  if (!KEYWORD_ANALYSIS_FIXTURE_ENABLED || typeof window === 'undefined') {
    return 'ready';
  }
  const value = new URLSearchParams(window.location.search).get('fixtureState');
  return ['loading', 'empty', 'error'].includes(value || '')
    ? value as KeywordFixtureState
    : 'ready';
}

function KeywordTagValue({ tag }: { tag: KeywordTag | null }) {
  if (!tag) {
    return (
      <Tooltip title="当前百度关键词报告不提供优化标签。" trigger={['hover']}>
        <span className={`${styles.keywordTag} ${styles.tagUnconfigured}`}>未配置</span>
      </Tooltip>
    );
  }
  return <span className={`${styles.keywordTag} ${TAG_CLASS_NAMES[tag]}`}>{tag}</span>;
}

function MatchedSearchTermsValue({ record }: { record: KeywordAnalysisRow }) {
  return (
    <Link
      href={{
        pathname: '/geo/keyword-analysis/search-terms',
        query: {
          accountId: record.accountId,
          campaignId: record.schemeId,
          adGroupId: record.unitId,
          adGroupName: record.unitName,
          keywordName: record.keyword
        }
      }}
      className={styles.searchTermLink}
      aria-label={`查看“${record.keyword}”命中的广告搜索词`}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      查看
    </Link>
  );
}

function LoadingPage() {
  return (
    <div className={styles.moduleStack} aria-busy="true">
      <MarketingMetricPlaceholderGrid
        items={KEYWORD_SUMMARY_PLACEHOLDERS}
        ariaLabel="关键词总览指标加载中"
        loading
      />
      <Card className={styles.filterCard}><Skeleton.Input active block size="small" /></Card>
      <Card className={styles.analysisCard}><Skeleton active title paragraph={{ rows: 12 }} /></Card>
      <Card className={styles.tableCard}><Skeleton active title paragraph={{ rows: 6 }} /></Card>
      <span className={sharedStyles.visuallyHidden}>正在加载广告关键词</span>
    </div>
  );
}

function buildDensityRows(points: KeywordScatterPoint[], xMax: number, yMax: number) {
  const bins = new Map<string, { xIndex: number; yIndex: number; count: number }>();
  for (const point of points) {
    const xIndex = Math.min(Math.floor((point.ctrPercent / xMax) * 16), 15);
    const yIndex = Math.min(Math.floor((point.averageCpc / yMax) * 10), 9);
    const key = `${xIndex}-${yIndex}`;
    const current = bins.get(key);
    if (current) current.count += 1;
    else bins.set(key, { xIndex, yIndex, count: 1 });
  }
  return [...bins.values()].map((bin) => ({
    ctrPercent: ((bin.xIndex + 0.5) / 16) * xMax,
    averageCpc: ((bin.yIndex + 0.5) / 10) * yMax,
    count: bin.count,
    countDisplay: `${bin.count} 个关键词`
  }));
}

export default function KeywordAnalysisPage() {
  const pageRef = useRef<HTMLElement>(null);
  const fixtureEnabled = KEYWORD_ANALYSIS_FIXTURE_ENABLED;
  const defaultContext = useDefaultProjectContext();
  const marketing = useMarketingCapabilities(!fixtureEnabled);
  const { device, setDevice, dateRange, setDateRange } = useMarketingFilters();
  const [fixtureState, setFixtureState] = useState<KeywordFixtureState>('ready');
  const [stageFilter, setStageFilter] = useState<KeywordStageFilter>('all');
  const [unitFilter, setUnitFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState<TagFilter>('all');
  const [costRange, setCostRange] = useState<KeywordCostRange>('all');
  const [anomalyFilter, setAnomalyFilter] = useState<KeywordAnomaly>('all');
  const [searchValue, setSearchValue] = useState('');
  const [benchmarkMode, setBenchmarkMode] = useState<BenchmarkMode>('median');
  const [chartMode, setChartMode] = useState<ChartMode>('scatter');
  const [selectedKeywordKey, setSelectedKeywordKey] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortBy, setSortBy] = useState<KeywordResourceSort>('costAmountScaled');
  const [sortOrder, setSortOrder] = useState<'ascend' | 'descend'>('descend');

  useEffect(() => setFixtureState(fixtureStateFromLocation()), []);

  const projectId = fixtureEnabled
    ? 'fixture-market-workspace'
    : defaultContext.project?.id || '';
  const enabled = fixtureEnabled || (
    Boolean(projectId) && marketing.capabilities.adsRead
  );
  const resourceQuery = useMemo(() => ({
    page,
    pageSize,
    sortBy,
    sortOrder,
    query: searchValue,
    adGroupId: unitFilter === 'all' ? undefined : unitFilter
  }), [page, pageSize, searchValue, sortBy, sortOrder, unitFilter]);
  const analysis = useKeywordAnalysis({
    projectId,
    projectName: defaultContext.project?.name,
    enabled,
    dateRange,
    fixtureEnabled,
    fixtureState,
    resourceQuery,
    onDateRangeAdjusted: setDateRange
  });
  const model = analysis.data;
  const rows = useMemo<KeywordAnalysisRow[]>(() => model?.rows || [], [model?.rows]);
  const hasConfiguredTags = useMemo(
    () => rows.some((row) => row.tag !== null),
    [rows]
  );
  const tagOptions = hasConfiguredTags
    ? CONFIGURED_TAG_OPTIONS
    : [{ value: 'all' as const, label: '暂无已配置标签' }];

  const unitOptions = useMemo(() => {
    const units = new Map<string, string>();
    for (const row of rows) units.set(row.unitId, row.unitName);
    return [
      { value: 'all', label: '全部单元' },
      ...[...units.entries()]
        .sort((left, right) => left[1].localeCompare(right[1], 'zh-CN'))
        .map(([value, label]) => ({ value, label }))
    ];
  }, [rows]);

  const baseRows = useMemo<KeywordAnalysisRow[]>(() => filterKeywordRows(rows, {
    stage: stageFilter,
    unitId: unitFilter,
    tag: tagFilter,
    costRange,
    costScale: model?.costScale,
    search: searchValue
  }) as KeywordAnalysisRow[], [
    costRange,
    model?.costScale,
    rows,
    searchValue,
    stageFilter,
    tagFilter,
    unitFilter
  ]);

  const baseScatter = useMemo<KeywordScatter>(
    () => buildKeywordScatter(baseRows) as KeywordScatter,
    [baseRows]
  );
  const accountBenchmark = useMemo<KeywordBenchmark>(
    () => buildKeywordAverageBenchmark(rows, model?.costScale) as KeywordBenchmark,
    [model?.costScale, rows]
  );
  const benchmark = benchmarkMode === 'account-average'
    ? accountBenchmark
    : {
        ctrPercent: baseScatter.medianCtrPercent,
        averageCpc: baseScatter.medianAverageCpc
      };

  const filteredRows = useMemo<KeywordAnalysisRow[]>(() => filterKeywordRows(baseRows, {
    anomaly: anomalyFilter,
    benchmarkCtrPercent: benchmark.ctrPercent,
    benchmarkAverageCpc: benchmark.averageCpc
  }) as KeywordAnalysisRow[], [
    anomalyFilter,
    baseRows,
    benchmark.averageCpc,
    benchmark.ctrPercent
  ]);

  const scatter = useMemo<KeywordScatter>(
    () => buildKeywordScatter(filteredRows) as KeywordScatter,
    [filteredRows]
  );
  const scatterPoints = scatter.points;
  const rowByKey = useMemo(
    () => new Map(filteredRows.map((row) => [row.key, row])),
    [filteredRows]
  );

  useEffect(() => {
    setPage(1);
  }, [anomalyFilter, costRange, dateRange, searchValue, stageFilter, tagFilter, unitFilter]);

  useEffect(() => {
    if (!scatterPoints.length) {
      if (selectedKeywordKey) setSelectedKeywordKey(null);
      return;
    }
    if (selectedKeywordKey && scatterPoints.some((point) => point.key === selectedKeywordKey)) {
      return;
    }
    const preferred = scatterPoints.find((point) => point.keyword === '振动光纤价格');
    setSelectedKeywordKey((preferred || scatterPoints[0]).key);
  }, [scatterPoints, selectedKeywordKey]);

  useEffect(() => {
    const pageElement = pageRef.current;
    if (!pageElement) return;
    const dateInputs = pageElement.querySelectorAll<HTMLInputElement>('.ant-picker-input input');
    dateInputs[0]?.setAttribute('aria-label', '开始日期');
    dateInputs[1]?.setAttribute('aria-label', '结束日期');
    const tableBody = pageElement.querySelector<HTMLElement>('.ant-table-body');
    if (tableBody) {
      tableBody.tabIndex = 0;
      tableBody.setAttribute('aria-label', '关键词明细，可横向和纵向滚动');
    }
  }, [analysis.loading, filteredRows.length, pageSize]);

  const clearFilters = () => {
    setStageFilter('all');
    setUnitFilter('all');
    setTagFilter('all');
    setCostRange('all');
    setAnomalyFilter('all');
    setSearchValue('');
    setSelectedKeywordKey(null);
  };

  const hasFilters = stageFilter !== 'all'
    || unitFilter !== 'all'
    || tagFilter !== 'all'
    || costRange !== 'all'
    || anomalyFilter !== 'all'
    || Boolean(searchValue);
  const hasPageOnlyFilters = stageFilter !== 'all'
    || tagFilter !== 'all'
    || costRange !== 'all'
    || anomalyFilter !== 'all';

  const selectedKeyword = selectedKeywordKey
    ? rowByKey.get(selectedKeywordKey) || null
    : null;

  const columns = useMemo<TableProps<KeywordAnalysisRow>['columns']>(() => {
    if (!model) return [];
    return [
      {
        title: '关键词',
        dataIndex: 'keyword',
        key: 'keywordName',
        width: 252,
        fixed: 'left',
        sorter: true,
        sortOrder: sortBy === 'keywordName' ? sortOrder : null,
        render: (keyword: string, record) => (
          <Tooltip title={`${record.accountName} / ${record.path}`} placement="topLeft" trigger={['hover']}>
            <span className={styles.keywordCell}>
              <span className={styles.keywordName}>{keyword}</span>
              <span className={styles.keywordUnit}>{record.unitName}</span>
            </span>
          </Tooltip>
        )
      },
      {
        title: '命中广告搜索词',
        key: 'matchedSearchTerms',
        width: 170,
        fixed: 'left',
        render: (_, record) => <MatchedSearchTermsValue record={record} />
      },
      {
        title: '优化标签',
        dataIndex: 'tag',
        key: 'tag',
        width: 126,
        fixed: 'left',
        render: (tag: KeywordTag | null) => <KeywordTagValue tag={tag} />
      },
      {
        title: '消费',
        dataIndex: 'costAmountScaled',
        key: 'costAmountScaled',
        width: 142,
        align: 'right',
        sorter: true,
        sortOrder: sortBy === 'costAmountScaled' ? sortOrder : null,
        render: (value: string) => (
          <strong className={styles.primaryMetric}>
            {formatMoney(value, model.costScale, 0, model.currency)}
          </strong>
        )
      },
      {
        title: '展现',
        dataIndex: 'impressions',
        key: 'impressions',
        width: 124,
        align: 'right',
        sorter: true,
        sortOrder: sortBy === 'impressions' ? sortOrder : null,
        render: (value: string) => <span className={styles.secondaryMetric}>{groupDigits(value)}</span>
      },
      {
        title: '点击',
        dataIndex: 'clicks',
        key: 'clicks',
        width: 112,
        align: 'right',
        sorter: true,
        sortOrder: sortBy === 'clicks' ? sortOrder : null,
        render: (value: string) => <span className={styles.secondaryMetric}>{groupDigits(value)}</span>
      },
      {
        title: 'CTR',
        dataIndex: 'ctrPercent',
        key: 'ctr',
        width: 118,
        align: 'right',
        sorter: true,
        sortOrder: sortBy === 'ctr' ? sortOrder : null,
        render: (value: number | null) => (
          <strong className={styles.primaryMetric}>{formatPercent(value)}</strong>
        )
      },
      {
        title: '平均 CPC',
        dataIndex: 'averageCpc',
        key: 'averageCpc',
        width: 142,
        align: 'right',
        sorter: true,
        sortOrder: sortBy === 'averageCpc' ? sortOrder : null,
        render: (value: number | null) => (
          <strong className={styles.primaryMetric}>
            {value == null
              ? '—'
              : `${model.currency === 'CNY' ? '¥' : `${model.currency} `}${value.toFixed(2)}`}
          </strong>
        )
      }
    ];
  }, [model, sortBy, sortOrder]);

  const chartRows = useMemo(() => scatterPoints.map((point) => ({
    ...point,
    actionLabel: point.tag || '未配置',
    pointColor: point.tag ? TAG_COLORS[point.tag] : '#aab2bf',
    unitName: rowByKey.get(point.key)?.unitName || '—',
    costDisplay: model
      ? formatMoney(point.costAmountScaled, model.costScale, 0, model.currency)
      : '—',
    impressionsDisplay: groupDigits(point.impressions),
    clicksDisplay: groupDigits(String(point.clicks)),
    ctrDisplay: formatPercent(point.ctrPercent),
    cpcDisplay: model
      ? `${model.currency === 'CNY' ? '¥' : `${model.currency} `}${point.averageCpc.toFixed(2)}`
      : '—'
  })), [model, rowByKey, scatterPoints]);

  const xMax = Math.max(1, Math.ceil(Math.max(
    ...scatterPoints.map((point) => point.ctrPercent),
    benchmark.ctrPercent || 0,
    0
  ) * 1.12));
  const yMax = Math.max(20, Math.ceil(Math.max(
    ...scatterPoints.map((point) => point.averageCpc),
    benchmark.averageCpc || 0,
    0
  ) * 1.08 / 20) * 20);
  const baselineCtr = benchmark.ctrPercent;
  const baselineCpc = benchmark.averageCpc;
  const xSplit = baselineCtr == null ? 50 : Math.min(Math.max(baselineCtr / xMax * 100, 10), 90);
  const ySplit = baselineCpc == null ? 50 : Math.min(Math.max((1 - baselineCpc / yMax) * 100, 10), 90);
  const densityRows = useMemo(
    () => buildDensityRows(scatterPoints, xMax, yMax),
    [scatterPoints, xMax, yMax]
  );
  const annotations = scatterPoints.length && baselineCtr != null && baselineCpc != null
    ? [
        {
          type: 'lineX',
          data: [{ ctrPercent: baselineCtr }],
          encode: { x: 'ctrPercent' },
          style: { stroke: '#8796ad', lineWidth: 1, lineDash: [6, 4] }
        },
        {
          type: 'lineY',
          data: [{ averageCpc: baselineCpc }],
          encode: { y: 'averageCpc' },
          style: { stroke: '#8796ad', lineWidth: 1, lineDash: [6, 4] }
        },
        {
          type: 'text',
          data: [{
            ctrPercent: baselineCtr,
            averageCpc: yMax * 0.97,
            label: `CTR ${baselineCtr.toFixed(1)}%`
          }],
          encode: { x: 'ctrPercent', y: 'averageCpc', text: 'label' },
          style: { fill: '#526071', dx: 9, textAlign: 'left', fontSize: 12 }
        },
        {
          type: 'text',
          data: [{
            ctrPercent: xMax * 0.99,
            averageCpc: baselineCpc,
            label: `CPC ¥${baselineCpc.toFixed(0)}`
          }],
          encode: { x: 'ctrPercent', y: 'averageCpc', text: 'label' },
          style: { fill: '#526071', dy: -9, textAlign: 'right', fontSize: 12 }
        }
      ]
    : [];

  const distribution = useMemo<KeywordActionDistribution>(
    () => buildKeywordActionDistribution(filteredRows) as KeywordActionDistribution,
    [filteredRows]
  );
  const distributionRows = [
    ...distribution.items,
    ...(distribution.unclassifiedCount
      ? [{ tag: '未配置', count: distribution.unclassifiedCount }]
      : [])
  ];
  const donutRows = distributionRows.filter((item) => item.count > 0);

  const sourceMeta = model
    ? `百度推广 · ${model.source === 'development-fixture' ? '开发数据' : '真实数据'} · ${
        model.updatedAt
          ? `更新于 ${dayjs(model.updatedAt).format('MM-DD HH:mm')}`
          : `数据截至 ${model.range.to}`
      }`
    : '';
  const shellLoading = !fixtureEnabled && (defaultContext.loading || marketing.loading);
  const pageError = !fixtureEnabled
    ? defaultContext.errorMessage
      || (!marketing.capabilities.adsRead && !marketing.loading
        ? '广告关键词数据尚未开放。'
        : analysis.error)
    : analysis.error;

  return (
    <section ref={pageRef} className={styles.page} aria-label="广告关键词">
      <div className={sharedStyles.breadcrumbRow}>
        <Breadcrumb items={[
          { title: '首页' },
          { title: '投放与流量' },
          { title: '广告关键词' }
        ]} />
        <MarketingPageFilters
          device={device}
          onDeviceChange={setDevice}
          availableDevices={['all']}
          dateRange={dateRange}
          onDateRangeChange={(nextRange) => {
            clearFilters();
            setDateRange(nextRange);
          }}
          dateAriaLabel="广告关键词日期范围"
          minDate={model?.availableFrom || null}
          maxDate={model?.availableTo || null}
          presetAnchor={model?.availableTo || KEYWORD_FIXTURE_RANGE.to}
          after={sourceMeta || null}
        />
      </div>

      {!pageError && analysis.warning ? (
        <Alert
          type="warning"
          showIcon
          title={analysis.warning}
          action={<Button size="small" onClick={() => void analysis.reload()}>重试</Button>}
        />
      ) : null}

      {!pageError && model?.previousState === 'ERROR' ? (
        <Alert
          type="warning"
          showIcon
          title={`上一周期关键词比较读取失败：${model.previousUnavailableReason}`}
          action={<Button size="small" onClick={() => void analysis.reload()}>重试</Button>}
        />
      ) : null}

      {pageError ? (
        <div className={styles.moduleStack}>
          <Alert
            type="error"
            showIcon
            title={pageError}
            action={<Button size="small" onClick={() => void analysis.reload()}>重试</Button>}
          />
          <MarketingMetricPlaceholderGrid
            items={KEYWORD_SUMMARY_PLACEHOLDERS}
            ariaLabel="关键词覆盖摘要"
            missingReason={pageError}
          />
        </div>
      ) : shellLoading || analysis.loading || !model ? (
        <LoadingPage />
      ) : (
        <div className={styles.moduleStack}>
          <MarketingMetricGrid ariaLabel="关键词覆盖摘要">
            <MarketingMetricCard
              title="广告关键词数"
              current={String(model.pagination.totalItems)}
              previous={model.previousTotalItems == null
                ? null
                : String(model.previousTotalItems)}
              change={model.previousTotalItems == null
                ? null
                : formatExactChange(
                    String(model.pagination.totalItems),
                    String(model.previousTotalItems)
                  )}
              tone={changeTone(model.previousTotalItems == null
                ? null
                : formatExactChange(
                    String(model.pagination.totalItems),
                    String(model.previousTotalItems)
                  ))}
              info="当前服务端完整筛选范围内的广告关键词数，不受当前页大小影响。"
              previousMissingReason={model.previousUnavailableReason}
              changeMissingReason={model.previousUnavailableReason
                || '上一周期为 0，无法计算变化率。'}
            />
            <MarketingMetricCard
              title="展现"
              current={groupDigits(model.summary.impressions)}
              previous={model.previousSummary
                ? groupDigits(model.previousSummary.impressions)
                : null}
              change={model.previousSummary
                ? formatExactChange(
                    model.summary.impressions,
                    model.previousSummary.impressions
                  )
                : null}
              tone={changeTone(model.previousSummary
                ? formatExactChange(
                    model.summary.impressions,
                    model.previousSummary.impressions
                  )
                : null)}
              info="当前服务端完整筛选范围内的关键词展现总量。"
              previousMissingReason={model.previousUnavailableReason}
              changeMissingReason={model.previousUnavailableReason
                || '上一周期为 0，无法计算变化率。'}
            />
            <MarketingMetricCard
              title="点击"
              current={groupDigits(model.summary.clicks)}
              previous={model.previousSummary
                ? groupDigits(model.previousSummary.clicks)
                : null}
              change={model.previousSummary
                ? formatExactChange(
                    model.summary.clicks,
                    model.previousSummary.clicks
                  )
                : null}
              tone={changeTone(model.previousSummary
                ? formatExactChange(
                    model.summary.clicks,
                    model.previousSummary.clicks
                  )
                : null)}
              info="当前服务端完整筛选范围内的关键词点击总量。"
              previousMissingReason={model.previousUnavailableReason}
              changeMissingReason={model.previousUnavailableReason
                || '上一周期为 0，无法计算变化率。'}
            />
            <MarketingMetricCard
              title="消费"
              current={formatMoney(
                model.summary.costAmountScaled,
                model.costScale,
                0,
                model.currency
              )}
              previous={model.previousSummary
                ? formatMoney(
                    model.previousSummary.costAmountScaled,
                    model.costScale,
                    0,
                    model.currency
                  )
                : null}
              change={model.previousSummary
                ? formatExactChange(
                    model.summary.costAmountScaled,
                    model.previousSummary.costAmountScaled
                  )
                : null}
              tone={changeTone(model.previousSummary
                ? formatExactChange(
                    model.summary.costAmountScaled,
                    model.previousSummary.costAmountScaled
                  )
                : null, true)}
              info="当前服务端完整筛选范围内的关键词消费总额。"
              previousMissingReason={model.previousUnavailableReason}
              changeMissingReason={model.previousUnavailableReason
                || '上一周期为 0，无法计算变化率。'}
            />
          </MarketingMetricGrid>

          <Card className={styles.filterCard}>
            <div className={styles.filterRow} aria-label="关键词任务筛选">
              <label className={styles.filterField}>
                <span>推广单元：</span>
                <Select
                  aria-label="推广单元"
                  value={unitFilter}
                  options={unitOptions}
                  onChange={setUnitFilter}
                  popupMatchSelectWidth={false}
                  showSearch
                  optionFilterProp="label"
                />
              </label>
              <label className={styles.filterField}>
                <span>优化标签：</span>
                <Select<TagFilter>
                  aria-label="优化标签"
                  value={tagFilter}
                  options={tagOptions}
                  disabled={!hasConfiguredTags}
                  onChange={setTagFilter}
                  popupMatchSelectWidth={false}
                />
              </label>
              <label className={styles.filterField}>
                <span>消费区间：</span>
                <Select<KeywordCostRange>
                  aria-label="消费区间"
                  value={costRange}
                  options={COST_OPTIONS}
                  onChange={setCostRange}
                  popupMatchSelectWidth={false}
                />
              </label>
              <label className={styles.filterField}>
                <span>CTR/CPC 异常：</span>
                <Select<KeywordAnomaly>
                  aria-label="CTR/CPC 异常"
                  value={anomalyFilter}
                  options={ANOMALY_OPTIONS}
                  onChange={setAnomalyFilter}
                  popupMatchSelectWidth={false}
                />
              </label>
              <Input
                className={styles.searchInput}
                aria-label="搜索投放关键词"
                prefix={<SearchOutlined />}
                placeholder="搜索投放关键词"
                value={searchValue}
                allowClear
                onChange={(event) => setSearchValue(event.target.value)}
              />
              <Button type="link" disabled={!hasFilters} onClick={clearFilters}>重置</Button>
            </div>
          </Card>

          {hasPageOnlyFilters ? (
            <Alert
              type="info"
              showIcon
              title="优化标签、消费区间和 CTR/CPC 异常仅筛选当前页"
              description="关键词名称与推广单元由服务端筛选；当前冻结合同未提供其余全量筛选字段，因此不会把当前页结果冒充完整筛选范围。"
            />
          ) : null}

          <Card className={styles.analysisCard}>
            <div className={styles.analysisGrid}>
              <div className={styles.chartPane}>
                <div className={styles.chartHeader}>
                  <div className={styles.chartTitleGroup}>
                    <h2>当前页关键词效率分布</h2>
                    <Radio.Group
                      aria-label="四象限判断基准"
                      value={benchmarkMode}
                      onChange={(event) => setBenchmarkMode(event.target.value as BenchmarkMode)}
                    >
                      <Radio value="median">当前数据中位数</Radio>
                      <Radio value="account-average">账户平均值</Radio>
                    </Radio.Group>
                  </div>
                  <Segmented
                    aria-label="图表视图"
                    value={chartMode}
                    options={[
                      { value: 'scatter', label: '散点' },
                      { value: 'density', label: '密度' }
                    ]}
                    onChange={(value) => setChartMode(value as ChartMode)}
                  />
                </div>

                {chartRows.length ? (
                  <div
                      className={styles.scatterRegion}
                      role="img"
                      aria-label={`关键词效率分布，共 ${scatterPoints.length} 个有点击关键词。`}
                      aria-describedby="scatter-equivalent-note"
                    >
                      <span className={styles.chartYTitle} aria-hidden="true">平均 CPC (¥)</span>
                      <span className={styles.chartXTitle} aria-hidden="true">CTR</span>
                      <div
                        className={styles.quadrantBackdrop}
                        style={{
                          gridTemplateColumns: `${xSplit}% ${100 - xSplit}%`,
                          gridTemplateRows: `${ySplit}% ${100 - ySplit}%`
                        }}
                        aria-hidden="true"
                      >
                        <span className={styles.quadrantWaste}>控制浪费</span>
                        <span className={styles.quadrantQuality}>高质高价</span>
                        <span className={styles.quadrantObserve}>低效观察</span>
                        <span className={styles.quadrantScale}>优先扩量</span>
                      </div>
                      {chartMode === 'scatter' ? (
                        <Scatter
                          data={chartRows}
                          xField="ctrPercent"
                          yField="averageCpc"
                          colorField="actionLabel"
                          sizeField="clicks"
                          height={300}
                          paddingLeft={56}
                          paddingRight={20}
                          paddingTop={8}
                          paddingBottom={36}
                          scale={{
                            x: { domainMin: 0, domainMax: xMax, tickCount: 8 },
                            y: { domainMin: 0, domainMax: yMax, tickCount: 7 },
                            size: { type: 'sqrt', range: [3, 11] },
                            color: {
                              domain: [...TYPED_KEYWORD_TAGS, '未配置'],
                              range: [...TYPED_KEYWORD_TAGS.map((tag) => TAG_COLORS[tag]), '#aab2bf']
                            }
                          }}
                          axis={{
                            x: {
                              title: false,
                              grid: false,
                              labelFormatter: (value: string) => `${Number(value).toFixed(0)}%`
                            },
                            y: {
                              title: false,
                              grid: true,
                              labelFormatter: (value: string) => `¥${Number(value).toFixed(0)}`
                            }
                          }}
                          annotations={annotations}
                          legend={false}
                          style={{
                            fill: (datum: Record<string, unknown>) => String(
                              datum.pointColor || '#aab2bf'
                            ),
                            fillOpacity: (datum: Record<string, unknown>) => (
                              datum.key === selectedKeywordKey ? 0.96 : 0.56
                            ),
                            stroke: (datum: Record<string, unknown>) => (
                              datum.key === selectedKeywordKey ? '#0f5bd3' : '#ffffff'
                            ),
                            lineWidth: (datum: Record<string, unknown>) => (
                              datum.key === selectedKeywordKey ? 3 : 1
                            )
                          }}
                          interaction={{ elementHighlight: true }}
                          onEvent={(_, event) => {
                            if (event.type !== 'click') return;
                            const key = event.data?.data?.key;
                            if (typeof key === 'string' && rowByKey.has(key)) {
                              setSelectedKeywordKey(key);
                            }
                          }}
                          tooltip={{
                            title: { field: 'keyword' },
                            items: [
                              { field: 'ctrDisplay', name: 'CTR' },
                              { field: 'cpcDisplay', name: '平均 CPC' },
                              { field: 'clicksDisplay', name: '点击' },
                              { field: 'costDisplay', name: '消费' },
                              { field: 'impressionsDisplay', name: '展现' },
                              { field: 'unitName', name: '所属单元' }
                            ]
                          }}
                          animate={false}
                        />
                      ) : (
                        <Heatmap
                          data={densityRows}
                          xField="ctrPercent"
                          yField="averageCpc"
                          colorField="count"
                          mark="cell"
                          height={300}
                          paddingLeft={56}
                          paddingRight={20}
                          paddingTop={8}
                          paddingBottom={36}
                          scale={{
                            x: { domainMin: 0, domainMax: xMax, tickCount: 8 },
                            y: { domainMin: 0, domainMax: yMax, tickCount: 7 },
                            color: { range: ['#e8f1ff', '#69a7ff', '#0f5bd3'] }
                          }}
                          axis={{
                            x: {
                              title: false,
                              grid: false,
                              labelFormatter: (value: string) => `${Number(value).toFixed(0)}%`
                            },
                            y: {
                              title: false,
                              grid: true,
                              labelFormatter: (value: string) => `¥${Number(value).toFixed(0)}`
                            }
                          }}
                          annotations={annotations}
                          legend={false}
                          style={{ inset: 0.75, stroke: '#ffffff', lineWidth: 1 }}
                          tooltip={{
                            title: false,
                            items: [{ field: 'countDisplay', name: '密度' }]
                          }}
                          animate={false}
                        />
                      )}
                  </div>
                ) : (
                  <Empty
                    className={styles.scatterEmpty}
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="当前筛选没有可绘制的有点击关键词"
                  />
                )}
                <span id="scatter-equivalent-note" className={sharedStyles.visuallyHidden}>
                  散点图中的关键词和全部指标可在下方关键词明细表中读取和排序。
                </span>
              </div>

              <aside className={styles.detailPane} aria-label="当前选中关键词详情">
                <div className={styles.detailSection}>
                  <span className={styles.detailEyebrow}>当前选中关键词</span>
                  {selectedKeyword ? (
                    <>
                      <div className={styles.selectedKeywordTitle}>
                        <strong>{selectedKeyword.keyword}</strong>
                        <KeywordTagValue tag={selectedKeyword.tag} />
                      </div>
                      <dl className={styles.keywordMetrics}>
                        <div><dt>CTR</dt><dd>{formatPercent(selectedKeyword.ctrPercent)}</dd></div>
                        <div><dt>平均 CPC</dt><dd>{selectedKeyword.averageCpc == null
                          ? '—'
                          : `${model.currency === 'CNY' ? '¥' : `${model.currency} `}${selectedKeyword.averageCpc.toFixed(2)}`}</dd></div>
                        <div><dt>点击</dt><dd>{groupDigits(selectedKeyword.clicks)}</dd></div>
                        <div><dt>消费</dt><dd>{formatMoney(selectedKeyword.costAmountScaled, model.costScale, 0, model.currency)}</dd></div>
                        <div><dt>展现</dt><dd>{groupDigits(selectedKeyword.impressions)}</dd></div>
                      </dl>
                    </>
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择散点或表格行" />
                  )}
                </div>

                <div className={styles.distributionSection}>
                  <span className={styles.detailEyebrow}>优化标签分布</span>
                  {hasConfiguredTags && donutRows.length ? (
                    <div className={styles.distributionContent}>
                      <div
                        className={styles.donutChart}
                        role="img"
                        aria-label={`优化标签分布，共 ${distribution.total} 个关键词`}
                      >
                        <Pie
                          data={donutRows}
                          angleField="count"
                          colorField="tag"
                          innerRadius={0.63}
                          radius={0.9}
                          height={112}
                          legend={false}
                          label={false}
                          scale={{
                            color: {
                              domain: [...TYPED_KEYWORD_TAGS, '未配置'],
                              range: [...TYPED_KEYWORD_TAGS.map((tag) => TAG_COLORS[tag]), '#7f8a9b']
                            }
                          }}
                          style={{ stroke: '#ffffff', lineWidth: 2 }}
                          tooltip={{ items: [{ field: 'count', name: '关键词' }] }}
                          animate={false}
                        />
                        <div className={styles.donutCenter} aria-hidden="true">
                          <strong>{distribution.total}</strong>
                          <span>关键词</span>
                        </div>
                      </div>
                      <div className={styles.distributionList}>
                        {distributionRows.map((item) => (
                          <div key={item.tag}>
                            <span
                              className={styles.distributionDot}
                              style={{ background: item.tag === '未配置'
                                ? '#7f8a9b'
                                : TAG_COLORS[item.tag as KeywordTag] }}
                              aria-hidden="true"
                            />
                            <span>{item.tag}</span>
                            <strong>{item.count}</strong>
                          </div>
                        ))}
                        <div className={styles.distributionTotal}>
                          <span>合计</span>
                          <strong>{distribution.total}</strong>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.noTagState}>
                      <strong>{distribution.total} 个关键词未配置</strong>
                      <span>当前接入的百度关键词报告不提供优化标签，不会按象限自动生成。</span>
                    </div>
                  )}
                </div>
              </aside>
            </div>
          </Card>

          <Card className={styles.tableCard}>
            <div className={styles.tableToolbar}>
              <h2>全部关键词明细</h2>
              <span>
                当前页显示 {filteredRows.length} 条 · 全部 {model.pagination.totalItems} 条
              </span>
            </div>
            <Table<KeywordAnalysisRow>
              aria-label="全部关键词明细表"
              className={styles.keywordTable}
              rowKey="key"
              columns={columns}
              dataSource={filteredRows}
              tableLayout="fixed"
              size="middle"
              scroll={{ x: 1186, y: 312 }}
              rowClassName={(record) => record.key === selectedKeywordKey ? styles.selectedRow : ''}
              onRow={(record) => ({
                tabIndex: 0,
                'aria-selected': record.key === selectedKeywordKey,
                onClick: () => setSelectedKeywordKey(record.key),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedKeywordKey(record.key);
                  }
                }
              })}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={hasFilters
                      ? '没有符合当前筛选条件的关键词'
                      : '当前日期范围没有关键词数据'}
                  />
                )
              }}
              pagination={{
                current: page,
                pageSize,
                total: model.pagination.totalItems,
                showSizeChanger: true,
                pageSizeOptions: [10, 20, 50],
                showTotal: (total) => `共 ${total} 条`
              }}
              onChange={(pagination, _filters, sorter, extra) => {
                const selectedSorter = Array.isArray(sorter) ? sorter[0] : sorter;
                const nextPageSize = pagination.pageSize || pageSize;
                setPageSize(nextPageSize);
                setPage(nextPageSize === pageSize ? pagination.current || 1 : 1);
                if (
                  extra.action === 'sort'
                  && selectedSorter?.order
                  && typeof selectedSorter.columnKey === 'string'
                ) {
                  setSortBy(selectedSorter.columnKey as KeywordResourceSort);
                  setSortOrder(selectedSorter.order);
                  setPage(1);
                }
              }}
            />
          </Card>
        </div>
      )}
    </section>
  );
}
