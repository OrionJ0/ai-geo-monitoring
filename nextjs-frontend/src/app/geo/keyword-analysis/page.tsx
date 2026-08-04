'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  KeywordAggregateRow,
  KeywordActionDistribution,
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
  type KeywordFixtureState
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
  { title: '有展现关键词' },
  { title: '有点击关键词' },
  { title: '点击覆盖率' },
  { title: '未获点击' }
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

function formatPercent(value: number | null, digits = 2): string {
  return value == null || !Number.isFinite(value)
    ? '—'
    : `${value.toFixed(digits)}%`;
}

function compareExact(left: string, right: string): number {
  const difference = BigInt(left) - BigInt(right);
  return difference < BigInt(0) ? -1 : difference > BigInt(0) ? 1 : 0;
}

function compareOptionalNumber(left: number | null, right: number | null): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left - right;
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

  useEffect(() => setFixtureState(fixtureStateFromLocation()), []);

  const projectId = fixtureEnabled
    ? 'fixture-market-workspace'
    : defaultContext.project?.id || '';
  const enabled = fixtureEnabled || (
    Boolean(projectId) && marketing.capabilities.adsRead
  );
  const analysis = useKeywordAnalysis({
    projectId,
    projectName: defaultContext.project?.name,
    enabled,
    dateRange,
    fixtureEnabled,
    fixtureState,
    onDateRangeAdjusted: setDateRange
  });
  const model = analysis.data;
  const rows = useMemo<KeywordAggregateRow[]>(() => model?.rows || [], [model?.rows]);
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

  const baseRows = useMemo<KeywordAggregateRow[]>(() => filterKeywordRows(rows, {
    stage: stageFilter,
    unitId: unitFilter,
    tag: tagFilter,
    costRange,
    costScale: model?.costScale,
    search: searchValue
  }) as KeywordAggregateRow[], [
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

  const filteredRows = useMemo<KeywordAggregateRow[]>(() => filterKeywordRows(baseRows, {
    anomaly: anomalyFilter,
    benchmarkCtrPercent: benchmark.ctrPercent,
    benchmarkAverageCpc: benchmark.averageCpc
  }) as KeywordAggregateRow[], [
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

  const selectedKeyword = selectedKeywordKey
    ? rowByKey.get(selectedKeywordKey) || null
    : null;

  const columns = useMemo<TableProps<KeywordAggregateRow>['columns']>(() => {
    if (!model) return [];
    return [
      {
        title: '关键词',
        dataIndex: 'keyword',
        key: 'keyword',
        width: 252,
        fixed: 'left',
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
        key: 'cost',
        width: 142,
        align: 'right',
        sorter: (left, right) => compareExact(left.costAmountScaled, right.costAmountScaled),
        defaultSortOrder: 'descend',
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
        sorter: (left, right) => compareExact(left.impressions, right.impressions),
        render: (value: string) => <span className={styles.secondaryMetric}>{groupDigits(value)}</span>
      },
      {
        title: '点击',
        dataIndex: 'clicks',
        key: 'clicks',
        width: 112,
        align: 'right',
        sorter: (left, right) => compareExact(left.clicks, right.clicks),
        render: (value: string) => <span className={styles.secondaryMetric}>{groupDigits(value)}</span>
      },
      {
        title: 'CTR',
        dataIndex: 'ctrPercent',
        key: 'ctr',
        width: 118,
        align: 'right',
        sorter: (left, right) => compareOptionalNumber(left.ctrPercent, right.ctrPercent),
        render: (value: number | null) => (
          <strong className={styles.primaryMetric}>{formatPercent(value)}</strong>
        )
      },
      {
        title: '平均 CPC',
        dataIndex: 'averageCpc',
        key: 'cpc',
        width: 142,
        align: 'right',
        sorter: (left, right) => compareOptionalNumber(left.averageCpc, right.averageCpc),
        render: (value: number | null) => (
          <strong className={styles.primaryMetric}>
            {value == null
              ? '—'
              : `${model.currency === 'CNY' ? '¥' : `${model.currency} `}${value.toFixed(2)}`}
          </strong>
        )
      }
    ];
  }, [model]);

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
              title="有展现关键词"
              current={String(model.coverage.impressionKeywordCount)}
              previous={null}
              change={null}
              info="有展现的关键词数；点击卡片可筛选。"
              previousMissingReason="当前关键词合同尚未提供上一周期覆盖摘要。"
              changeMissingReason="缺少上一周期摘要，无法比较。"
              selected={stageFilter === 'impressions'}
              onActivate={() => setStageFilter((current) => current === 'impressions' ? 'all' : 'impressions')}
            />
            <MarketingMetricCard
              title="有点击关键词"
              current={String(model.coverage.clickedKeywordCount)}
              previous={null}
              change={null}
              info="有点击的关键词数；点击卡片可筛选。"
              previousMissingReason="当前关键词合同尚未提供上一周期覆盖摘要。"
              changeMissingReason="缺少上一周期摘要，无法比较。"
              selected={stageFilter === 'clicked'}
              onActivate={() => setStageFilter((current) => current === 'clicked' ? 'all' : 'clicked')}
            />
            <MarketingMetricCard
              title="点击覆盖率"
              current={model.coverage.clickCoverageRate == null
                ? null
                : formatPercent(model.coverage.clickCoverageRate * 100)}
              previous={null}
              change={null}
              info="有点击关键词数 ÷ 有展现关键词数。"
              currentMissingReason="当前没有可用的关键词覆盖分母。"
              previousMissingReason="当前关键词合同尚未提供上一周期覆盖摘要。"
              changeMissingReason="缺少上一周期摘要，无法比较。"
            />
            <MarketingMetricCard
              title="未获点击"
              current={String(model.coverage.unclickedKeywordCount)}
              previous={null}
              change={null}
              tone="bad"
              info="有展现但没有点击的关键词数；点击卡片可筛选。"
              previousMissingReason="当前关键词合同尚未提供上一周期覆盖摘要。"
              changeMissingReason="缺少上一周期摘要，无法比较。"
              selected={stageFilter === 'unclicked'}
              onActivate={() => setStageFilter((current) => current === 'unclicked' ? 'all' : 'unclicked')}
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

          <Card className={styles.analysisCard}>
            <div className={styles.analysisGrid}>
              <div className={styles.chartPane}>
                <div className={styles.chartHeader}>
                  <div className={styles.chartTitleGroup}>
                    <h2>关键词效率分布</h2>
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
              <span>{filteredRows.length} 条</span>
            </div>
            <Table<KeywordAggregateRow>
              aria-label="全部关键词明细表"
              className={styles.keywordTable}
              rowKey="key"
              columns={columns}
              dataSource={filteredRows}
              tableLayout="fixed"
              size="middle"
              scroll={{ x: 1016, y: 312 }}
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
                total: filteredRows.length,
                showSizeChanger: true,
                pageSizeOptions: [10, 20, 50],
                showTotal: (total) => `共 ${total} 条`,
                onChange: (nextPage, nextPageSize) => {
                  setPage(nextPageSize !== pageSize ? 1 : nextPage);
                  setPageSize(nextPageSize);
                }
              }}
            />
          </Card>
        </div>
      )}
    </section>
  );
}
