'use client';

import React, {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import dayjs from 'dayjs';
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Empty,
  Input,
  Select,
  Skeleton,
  Table,
  Tooltip
} from 'antd';
import type { TableProps } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import MarketingPageFilters from '@/components/marketing/MarketingPageFilters';
import { useMarketingFilters } from '@/components/marketing/MarketingFiltersContext';
import MarketingMetricCard, {
  MarketingMetricGrid,
  MarketingMetricPlaceholderGrid
} from '@/components/marketing/MarketingMetricCard';
import useDefaultProjectContext from '@/lib/useDefaultProjectContext';
import useMarketingCapabilities from '@/lib/useMarketingCapabilities';
import type {
  AdSearchTermFilter,
  AdSearchTermRow,
  AdSearchTermResourceSort,
  AdSearchTermStatus
} from '@/lib/marketing/adSearchTermTypes';
import useAdSearchTerms, {
  AD_SEARCH_TERMS_FIXTURE_ENABLED,
  type AdSearchTermFixtureState
} from '@/lib/marketing/useAdSearchTerms';
import { KEYWORD_FIXTURE_RANGE } from '@/fixtures/keywordAnalysis.fixture.cjs';
import {
  buildAdSearchTermSummary,
  filterAdSearchTermRows,
  formatExactPercentChange,
  keywordEvidenceKey
} from '@/utils/adSearchTerms.cjs';
import sharedStyles from '../../ad-performance/ad-performance.module.css';
import styles from './search-terms.module.css';

const SUMMARY_PLACEHOLDERS = Object.freeze([
  { title: '广告搜索词数', metricKey: 'TERMS' },
  { title: '展现', metricKey: 'IMPRESSIONS' },
  { title: '点击', metricKey: 'CLICKS' },
  { title: '消费', metricKey: 'COST' }
]);

const STATUS_OPTIONS: Array<{
  value: 'all' | AdSearchTermStatus;
  label: string;
}> = [
  { value: 'all', label: '全部状态' },
  { value: 'ADDED', label: '已添加' },
  { value: 'NOT_ADDED', label: '未添加' },
  { value: 'NOT_ADDABLE', label: '不可添加' }
];

const STATUS_LABELS: Record<AdSearchTermStatus, string> = {
  ADDED: '已添加',
  NOT_ADDED: '未添加',
  NOT_ADDABLE: '不可添加'
};

const MATCH_TYPE_LABELS: Record<string, string> = {
  EXACT: '精确',
  PHRASE: '短语',
  BROAD: '广泛'
};

function fixtureStateFromLocation(): AdSearchTermFixtureState {
  if (!AD_SEARCH_TERMS_FIXTURE_ENABLED || typeof window === 'undefined') {
    return 'ready';
  }
  const value = new URLSearchParams(window.location.search).get('fixtureState');
  return ['loading', 'empty', 'error'].includes(value || '')
    ? value as AdSearchTermFixtureState
    : 'ready';
}

function groupDigits(value: string): string {
  return BigInt(value).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
}

function formatMoney(
  scaledValue: string,
  scale: number,
  digits = 2,
  currency = 'CNY'
): string {
  const factor = BigInt(10) ** BigInt(scale);
  const decimalFactor = BigInt(10) ** BigInt(digits);
  const rounded = (
    (BigInt(scaledValue) * decimalFactor * BigInt(2) + factor)
    / (factor * BigInt(2))
  );
  const whole = rounded / decimalFactor;
  const fraction = digits
    ? `.${(rounded % decimalFactor).toString().padStart(digits, '0')}`
    : '';
  return `${currency === 'CNY' ? '¥' : `${currency} `}${groupDigits(whole.toString())}${fraction}`;
}

function formatPercent(value: number | null): string {
  return value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(2)}%`;
}

function changeTone(value: string | null): 'good' | 'bad' | 'neutral' {
  if (value?.startsWith('+')) return 'good';
  if (value?.startsWith('-')) return 'bad';
  return 'neutral';
}

function LoadingPage() {
  return (
    <div className={styles.moduleStack} aria-busy="true">
      <MarketingMetricPlaceholderGrid
        items={SUMMARY_PLACEHOLDERS}
        ariaLabel="广告搜索词总览指标加载中"
        loading
      />
      <Card className={styles.filterCard}>
        <Skeleton.Input active block size="small" />
      </Card>
      <Card className={styles.tableCard}>
        <Skeleton active title paragraph={{ rows: 9 }} />
      </Card>
      <span className={sharedStyles.visuallyHidden}>正在加载广告搜索词</span>
    </div>
  );
}

function AdSearchTermsContent() {
  const pageRef = useRef<HTMLElement>(null);
  const searchParams = useSearchParams();
  const fixtureEnabled = AD_SEARCH_TERMS_FIXTURE_ENABLED;
  const defaultContext = useDefaultProjectContext();
  const marketing = useMarketingCapabilities(!fixtureEnabled);
  const { device, setDevice, dateRange, setDateRange } = useMarketingFilters();
  const [fixtureState, setFixtureState] = useState<AdSearchTermFixtureState>('ready');
  const [adGroupId, setAdGroupId] = useState('all');
  const [keywordEvidence, setKeywordEvidence] = useState('all');
  const [queryStatus, setQueryStatus] = useState<'all' | AdSearchTermStatus>('all');
  const [matchType, setMatchType] = useState('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortBy, setSortBy] = useState<AdSearchTermResourceSort>('costAmountScaled');
  const [sortOrder, setSortOrder] = useState<'ascend' | 'descend'>('descend');

  useEffect(() => setFixtureState(fixtureStateFromLocation()), []);

  const projectId = fixtureEnabled
    ? 'fixture-market-workspace'
    : defaultContext.project?.id || '';
  const enabled = fixtureEnabled || (
    Boolean(projectId) && marketing.capabilities.adsRead
  );
  const accountId = searchParams.get('accountId');
  const campaignId = searchParams.get('campaignId');
  const scopedAdGroupId = searchParams.get('adGroupId');
  const scopedAdGroupName = searchParams.get('adGroupName');
  const scopedKeywordName = searchParams.get('keywordName');
  const allRequested = searchParams.get('view') === 'all';
  const requestedScope = useMemo(() => (
    accountId && campaignId && scopedAdGroupId && scopedKeywordName
      ? {
          accountId,
          campaignId,
          adGroupId: scopedAdGroupId,
          adGroupName: scopedAdGroupName || scopedAdGroupId,
          keywordName: scopedKeywordName
        }
      : null
  ), [
    accountId,
    campaignId,
    scopedAdGroupId,
    scopedAdGroupName,
    scopedKeywordName
  ]);
  const resourceQuery = useMemo(() => ({
    page,
    pageSize,
    sortBy,
    sortOrder,
    query,
    adGroupId,
    keywordEvidence,
    queryStatus,
    matchType,
    scopeEvidence: requestedScope,
    scopeRequired: !allRequested
  }), [
    adGroupId,
    allRequested,
    keywordEvidence,
    matchType,
    page,
    pageSize,
    query,
    queryStatus,
    requestedScope,
    sortBy,
    sortOrder
  ]);
  const analysis = useAdSearchTerms({
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
  const current = model?.current || null;
  const scopeEvidence = requestedScope ? keywordEvidenceKey(requestedScope) : null;
  const invalidScope = !allRequested && !requestedScope;
  const filters = useMemo<AdSearchTermFilter>(() => ({
    keywordEvidence: scopeEvidence || keywordEvidence,
    adGroupId,
    queryStatus,
    matchType,
    query
  }), [adGroupId, keywordEvidence, matchType, query, queryStatus, scopeEvidence]);

  const visibleRows = useMemo(
    () => invalidScope
      ? []
      : current?.source === 'development-fixture'
        ? filterAdSearchTermRows(current.rows, filters)
        : current?.rows || [],
    [current, filters, invalidScope]
  );
  const currentSummary = useMemo(
    () => current?.source === 'development-fixture'
      ? buildAdSearchTermSummary(visibleRows)
      : current?.summary || buildAdSearchTermSummary([]),
    [current, visibleRows]
  );
  const previousSummary = useMemo(
    () => model?.previous?.summary || null,
    [model?.previous]
  );

  const adGroupOptions = useMemo(() => {
    const groups = new Map<string, string>();
    for (const row of current?.filterRows || []) groups.set(row.adGroupId, row.adGroupName);
    return [
      { value: 'all', label: '全部推广单元' },
      ...[...groups.entries()]
        .sort((left, right) => left[1].localeCompare(right[1], 'zh-CN'))
        .map(([value, label]) => ({ value, label }))
    ];
  }, [current?.filterRows]);

  const keywordOptions = useMemo(() => {
    const keywords = new Map<string, string>();
    for (const row of current?.filterRows || []) {
      keywords.set(
        keywordEvidenceKey(row),
        `${row.keywordName} · ${row.adGroupName}`
      );
    }
    return [
      { value: 'all', label: '全部广告关键词' },
      ...[...keywords.entries()]
        .sort((left, right) => left[1].localeCompare(right[1], 'zh-CN'))
        .map(([value, label]) => ({ value, label }))
    ];
  }, [current?.filterRows]);

  const matchTypeOptions = useMemo(() => {
    const values = new Set((current?.filterRows || []).map((row) => row.matchType));
    return [
      { value: 'all', label: '全部匹配方式' },
      ...[...values]
        .sort((left, right) => left.localeCompare(right, 'zh-CN'))
        .map((value) => ({
          value,
          label: MATCH_TYPE_LABELS[value] || value
        }))
    ];
  }, [current?.filterRows]);

  useEffect(() => {
    setPage(1);
  }, [adGroupId, dateRange, keywordEvidence, matchType, query, queryStatus, scopeEvidence]);

  useEffect(() => {
    const tableBody = pageRef.current?.querySelector<HTMLElement>('.ant-table-body');
    if (!tableBody) return;
    tableBody.tabIndex = 0;
    tableBody.setAttribute('aria-label', '广告搜索词明细，可横向和纵向滚动');
  }, [analysis.loading, pageSize, visibleRows.length]);

  const resetFilters = () => {
    setAdGroupId('all');
    setKeywordEvidence('all');
    setQueryStatus('all');
    setMatchType('all');
    setQuery('');
  };
  const hasFilters = adGroupId !== 'all'
    || (!scopeEvidence && keywordEvidence !== 'all')
    || queryStatus !== 'all'
    || matchType !== 'all'
    || Boolean(query);

  const columns = useMemo<TableProps<AdSearchTermRow>['columns']>(() => {
    if (!current) return [];
    return [
      {
        title: '广告搜索词',
        dataIndex: 'searchTerm',
        key: 'searchTerm',
        fixed: 'left',
        width: 224,
        sorter: true,
        sortOrder: sortBy === 'searchTerm' ? sortOrder : null,
        render: (value: string) => <strong className={styles.searchTerm}>{value}</strong>
      },
      {
        title: (
          <Tooltip title="百度搜索词报告不提供关键词 ID；此处保留报告返回的关键词名称证据。">
            <span className={styles.headerWithHelp}>命中广告关键词</span>
          </Tooltip>
        ),
        dataIndex: 'keywordName',
        key: 'keywordName',
        width: 190,
        sorter: true,
        sortOrder: sortBy === 'keywordName' ? sortOrder : null,
        render: (value: string) => <span className={styles.keywordName}>{value}</span>
      },
      {
        title: '推广单元',
        dataIndex: 'adGroupName',
        key: 'adGroupName',
        width: 178
      },
      {
        title: '匹配方式',
        dataIndex: 'matchType',
        key: 'matchType',
        width: 116,
        render: (value: string) => MATCH_TYPE_LABELS[value] || value
      },
      {
        title: '添加状态',
        dataIndex: 'queryStatus',
        key: 'queryStatus',
        width: 116,
        render: (value: AdSearchTermStatus) => (
          <span className={styles.status} data-status={value}>
            {STATUS_LABELS[value]}
          </span>
        )
      },
      {
        title: '消费',
        dataIndex: 'costAmountScaled',
        key: 'costAmountScaled',
        width: 136,
        align: 'right',
        sorter: true,
        sortOrder: sortBy === 'costAmountScaled' ? sortOrder : null,
        render: (value: string) => (
          <strong className={styles.primaryMetric}>
            {formatMoney(value, current.costScale, 2, current.currency)}
          </strong>
        )
      },
      {
        title: '展现',
        dataIndex: 'impressions',
        key: 'impressions',
        width: 112,
        align: 'right',
        sorter: true,
        sortOrder: sortBy === 'impressions' ? sortOrder : null,
        render: (value: string) => groupDigits(value)
      },
      {
        title: '点击',
        dataIndex: 'clicks',
        key: 'clicks',
        width: 104,
        align: 'right',
        sorter: true,
        sortOrder: sortBy === 'clicks' ? sortOrder : null,
        render: (value: string) => groupDigits(value)
      },
      {
        title: 'CTR',
        dataIndex: 'ctrPercent',
        key: 'ctr',
        width: 108,
        align: 'right',
        sorter: true,
        sortOrder: sortBy === 'ctr' ? sortOrder : null,
        render: (value: number | null) => formatPercent(value)
      },
      {
        title: '平均 CPC',
        dataIndex: 'averageCpc',
        key: 'averageCpc',
        width: 128,
        align: 'right',
        sorter: true,
        sortOrder: sortBy === 'averageCpc' ? sortOrder : null,
        render: (value: number | null) => value == null
          ? '—'
          : `${current.currency === 'CNY' ? '¥' : `${current.currency} `}${value.toFixed(2)}`
      }
    ];
  }, [current, sortBy, sortOrder]);

  const sourceMeta = current
    ? `百度推广 · ${current.source === 'development-fixture' ? '开发数据' : '真实数据'} · ${
        current.updatedAt
          ? `更新于 ${dayjs(current.updatedAt).format('MM-DD HH:mm')}`
          : `数据截至 ${current.range.to}`
      }`
    : '';
  const shellLoading = !fixtureEnabled && (defaultContext.loading || marketing.loading);
  const pageError = !fixtureEnabled
    ? defaultContext.errorMessage
      || (!marketing.capabilities.adsRead && !marketing.loading
        ? '广告搜索词数据尚未开放。'
        : analysis.error)
    : analysis.error;
  const previousMissingReason = model?.previousUnavailableReason
    || '上一周期没有可用的广告搜索词数据。';

  const summaryCards = current ? [
    {
      title: '广告搜索词数',
      metricKey: 'TERMS',
      current: currentSummary.searchTermCount,
      previous: previousSummary?.searchTermCount || null,
      info: '百度推广搜索词报告返回的用户真实广告搜索词数量。'
    },
    {
      title: '展现',
      metricKey: 'IMPRESSIONS',
      current: groupDigits(currentSummary.impressions),
      previous: previousSummary ? groupDigits(previousSummary.impressions) : null,
      info: '当前筛选范围内广告搜索词的展现总量。',
      changeCurrent: currentSummary.impressions,
      changePrevious: previousSummary?.impressions
    },
    {
      title: '点击',
      metricKey: 'CLICKS',
      current: groupDigits(currentSummary.clicks),
      previous: previousSummary ? groupDigits(previousSummary.clicks) : null,
      info: '当前筛选范围内广告搜索词的点击总量。',
      changeCurrent: currentSummary.clicks,
      changePrevious: previousSummary?.clicks
    },
    {
      title: '消费',
      metricKey: 'COST',
      current: formatMoney(
        currentSummary.costAmountScaled,
        current.costScale,
        0,
        current.currency
      ),
      previous: previousSummary
        ? formatMoney(
            previousSummary.costAmountScaled,
            model?.previous?.costScale ?? current.costScale,
            0,
            model?.previous?.currency ?? current.currency
          )
        : null,
      info: '当前筛选范围内广告搜索词的广告消费总额。',
      changeCurrent: currentSummary.costAmountScaled,
      changePrevious: previousSummary?.costAmountScaled
    }
  ] : [];
  if (summaryCards[0]) {
    summaryCards[0].changeCurrent = currentSummary.searchTermCount;
    summaryCards[0].changePrevious = previousSummary?.searchTermCount;
  }

  return (
    <section ref={pageRef} className={styles.page} aria-label="广告搜索词">
      <div className={sharedStyles.breadcrumbRow}>
        <Breadcrumb items={[
          { title: '首页' },
          { title: '投放与流量' },
          { title: <Link href="/geo/keyword-analysis">广告关键词</Link> },
          { title: '广告搜索词' }
        ]} />
        <MarketingPageFilters
          device={device}
          onDeviceChange={setDevice}
          availableDevices={['all']}
          dateRange={dateRange}
          onDateRangeChange={(nextRange) => {
            resetFilters();
            setDateRange(nextRange);
          }}
          dateAriaLabel="广告搜索词日期范围"
          minDate={current?.availableFrom || null}
          maxDate={current?.availableTo || null}
          presetAnchor={current?.availableTo || KEYWORD_FIXTURE_RANGE.to}
          after={sourceMeta || null}
        />
      </div>

      {pageError ? (
        <div className={styles.moduleStack}>
          <Alert
            type="error"
            showIcon
            title={pageError}
            action={<Button size="small" onClick={() => void analysis.reload()}>重试</Button>}
          />
          <MarketingMetricPlaceholderGrid
            items={SUMMARY_PLACEHOLDERS}
            ariaLabel="广告搜索词摘要"
            missingReason={pageError}
          />
        </div>
      ) : shellLoading || analysis.loading || !current || !model ? (
        <LoadingPage />
      ) : invalidScope ? (
        <div className={styles.moduleStack}>
          <Alert
            type="warning"
            showIcon
            title="下钻范围无效"
            description="当前链接未能匹配项目内的广告关键词。为避免扩大广告搜索词展示范围，请返回广告关键词页，或主动查看全部广告搜索词。"
            action={<Link href="/geo/keyword-analysis/search-terms?view=all">查看全部广告搜索词</Link>}
          />
          <MarketingMetricPlaceholderGrid
            items={SUMMARY_PLACEHOLDERS}
            ariaLabel="广告搜索词摘要"
            missingReason="下钻范围无效"
          />
        </div>
      ) : (
        <div className={styles.moduleStack}>
          {analysis.warning ? (
            <Alert
              type="warning"
              showIcon
              title={analysis.warning}
              action={<Button size="small" onClick={() => void analysis.reload()}>重试</Button>}
            />
          ) : null}
          {requestedScope ? (
            <Card className={styles.scopeCard}>
              <div className={styles.scopeContent}>
                <div>
                  <span>当前广告关键词</span>
                  <strong>{requestedScope.keywordName}</strong>
                  <small>{requestedScope.adGroupName}</small>
                </div>
                <Link href="/geo/keyword-analysis/search-terms?view=all">
                  查看全部广告搜索词
                </Link>
              </div>
            </Card>
          ) : null}

          <MarketingMetricGrid ariaLabel="广告搜索词摘要">
            {summaryCards.map((card) => {
              const change = card.changePrevious == null
                ? null
                : formatExactPercentChange(
                    card.changeCurrent || '0',
                    card.changePrevious
                  );
              return (
                <MarketingMetricCard
                  key={card.metricKey}
                  title={card.title}
                  metricKey={card.metricKey}
                  current={card.current}
                  previous={card.previous}
                  change={change}
                  tone={changeTone(change)}
                  info={card.info}
                  previousMissingReason={previousMissingReason}
                  changeMissingReason={change
                    ? undefined
                    : previousSummary
                      ? '上一周期为 0，无法计算变化率。'
                      : previousMissingReason}
                />
              );
            })}
          </MarketingMetricGrid>

          <Card className={styles.filterCard}>
            <div className={styles.filterRow} aria-label="广告搜索词筛选">
              <label className={styles.filterField}>
                <span>推广单元：</span>
                <Select
                  aria-label="推广单元"
                  value={adGroupId}
                  options={adGroupOptions}
                  onChange={setAdGroupId}
                  popupMatchSelectWidth={false}
                  showSearch
                  optionFilterProp="label"
                />
              </label>
              <label className={styles.filterField}>
                <span>命中广告关键词：</span>
                <Select
                  aria-label="命中广告关键词"
                  value={scopeEvidence || keywordEvidence}
                  options={requestedScope ? [{
                    value: scopeEvidence,
                    label: `${requestedScope.keywordName} · ${requestedScope.adGroupName}`
                  }] : keywordOptions}
                  onChange={setKeywordEvidence}
                  disabled={Boolean(requestedScope)}
                  popupMatchSelectWidth={false}
                  showSearch
                  optionFilterProp="label"
                />
              </label>
              <label className={styles.filterField}>
                <span>添加状态：</span>
                <Select
                  aria-label="添加状态"
                  value={queryStatus}
                  options={STATUS_OPTIONS}
                  onChange={setQueryStatus}
                  popupMatchSelectWidth={false}
                />
              </label>
              <label className={styles.filterField}>
                <span>匹配方式：</span>
                <Select
                  aria-label="匹配方式"
                  value={matchType}
                  options={matchTypeOptions}
                  onChange={setMatchType}
                  popupMatchSelectWidth={false}
                />
              </label>
              <Input
                className={styles.searchInput}
                aria-label="搜索广告搜索词"
                prefix={<SearchOutlined />}
                placeholder="搜索广告搜索词"
                value={query}
                allowClear
                onChange={(event) => setQuery(event.target.value)}
              />
              <Button type="link" disabled={!hasFilters} onClick={resetFilters}>重置</Button>
            </div>
          </Card>

          <Card className={styles.tableCard}>
            <div className={styles.tableToolbar}>
              <div>
                <h2>{requestedScope ? '命中该广告关键词的搜索词' : '全部广告搜索词'}</h2>
                <span>共 {groupDigits(String(
                  current.source === 'development-fixture'
                    ? visibleRows.length
                    : current.pagination.totalItems
                ))} 条</span>
              </div>
              <p>搜索词是用户真实搜索内容；命中广告关键词是百度报告返回的名称证据。</p>
            </div>
            <Table<AdSearchTermRow>
              className={styles.searchTermsTable}
              rowKey="key"
              columns={columns}
              dataSource={visibleRows}
              scroll={{ x: 1414, y: 560 }}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={requestedScope
                      ? '当前广告关键词在所选时间内没有命中的广告搜索词'
                      : '所选条件下没有广告搜索词'}
                  />
                )
              }}
              pagination={{
                current: page,
                pageSize,
                total: current.source === 'development-fixture'
                  ? visibleRows.length
                  : current.pagination.totalItems,
                showSizeChanger: true,
                pageSizeOptions: [20, 50, 100],
                showTotal: (total) => `共 ${total} 条`
              }}
              onChange={(pagination, _filters, sorter, extra) => {
                const selectedSorter = Array.isArray(sorter) ? sorter[0] : sorter;
                const nextPageSize = pagination.pageSize || pageSize;
                setPageSize(nextPageSize);
                setPage(nextPageSize === pageSize ? pagination.current || 1 : 1);
                if (
                  extra.action === 'sort'
                  &&
                  selectedSorter?.order
                  && typeof selectedSorter.columnKey === 'string'
                ) {
                  setSortBy(selectedSorter.columnKey as AdSearchTermResourceSort);
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

export default function AdSearchTermsPage() {
  return (
    <Suspense fallback={<LoadingPage />}>
      <AdSearchTermsContent />
    </Suspense>
  );
}
