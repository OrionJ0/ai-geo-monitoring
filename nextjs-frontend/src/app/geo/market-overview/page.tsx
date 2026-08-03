// @ts-nocheck
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dayjs from 'dayjs';
import { Bar, Line } from '@ant-design/plots';
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  DatePicker,
  Empty,
  Select,
  Skeleton,
  Tooltip,
  Typography
} from 'antd';
import {
  FundProjectionScreenOutlined,
  GlobalOutlined,
  InfoCircleOutlined
} from '@ant-design/icons';
import useDefaultProjectContext from '@/lib/useDefaultProjectContext';
import useMarketingCapabilities from '@/lib/useMarketingCapabilities';
import useMarketOverview from '@/lib/marketing/useMarketOverview';
import { groupDigits } from '@/utils/marketingValues.cjs';
import {
  buildPeriodRows,
  calculateRate,
  divideScaledAmount,
  formatAverage,
  formatPeriodChange,
  formatRatioChange,
  formatScaledAmount,
  relativeCoordinate,
  sumValues,
  summarizeMetric
} from '@/utils/marketOverviewPresentation.cjs';
import styles from './market-overview.module.css';

const { RangePicker } = DatePicker;
const { Title } = Typography;

const PAID_SOURCE = 'BAIDU_PAID';
const TONGJI_ALL_SOURCE = 'BAIDU_TONGJI_ALL';
const TONGJI_SOURCE_KEYS = Object.freeze({
  BAIDU_TONGJI_DIRECT: 'DIRECT',
  BAIDU_TONGJI_SEARCH: 'SEARCH',
  BAIDU_TONGJI_EXTERNAL: 'EXTERNAL'
});
const MISSING_ATTRIBUTION = '缺少可信的按来源关联，当前不能计算该指标。';

const TREND_METRICS = [
  {
    key: 'costAmountScaled',
    label: '广告投入',
    unit: '金额',
    header: '广告投入'
  },
  {
    key: 'impressions',
    label: '展现',
    unit: '次',
    header: '展现'
  },
  {
    key: 'clicks',
    label: '访问（点击）',
    unit: '次',
    header: '访问（点击）'
  }
];

const TRAFFIC_TREND_METRICS = [
  {
    key: 'visits',
    label: '访问次数',
    unit: '次'
  },
  {
    key: 'visitors',
    label: '访客数（UV）',
    unit: '人'
  },
  {
    key: 'pageviews',
    label: '浏览量（PV）',
    unit: '次'
  }
];

const TREND_SOURCES = [
  { value: PAID_SOURCE, label: '百度推广' },
  { value: TONGJI_ALL_SOURCE, label: '官网全站（百度统计）' },
  { value: 'BAIDU_TONGJI_DIRECT', label: '直接访问（百度统计）' },
  { value: 'BAIDU_TONGJI_SEARCH', label: '搜索引擎（百度统计）' },
  { value: 'BAIDU_TONGJI_EXTERNAL', label: '外部链接（百度统计）' }
];

const KPI_DEFINITIONS = [
  {
    key: 'ROAS',
    title: '投入产出',
    formula: '成交金额 ÷ 广告投入。越高越好。',
    missing: '销售系统尚未提供可信成交金额，当前无法计算。'
  },
  {
    key: 'CPL',
    title: '线索入池成本',
    formula: '广告投入 ÷ 线索入池数。越低越好。',
    missing: '落地页与销售系统尚无可信线索入池关联，当前无法计算。'
  },
  {
    key: 'CPA',
    title: '成交成本',
    formula: '广告投入 ÷ 可验证成交记录数。越低越好。',
    missing: '销售系统尚未提供 CPA 的可信正式分母，当前无法计算。'
  },
  {
    key: 'CPC',
    title: '平均点击成本',
    formula: '广告投入 ÷ 访问（点击）数。越低越好。',
    missing: '当前范围没有可用于计算的广告投入或点击。'
  }
];

function useReducedMotion() {
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

function InfoTip({ label, children }) {
  return (
    <Tooltip title={children} placement="top" trigger={['hover', 'focus']}>
      <button
        type="button"
        className={styles.infoButton}
        aria-label={`${label}口径说明`}
      >
        <InfoCircleOutlined aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

function MissingValue({ reason = MISSING_ATTRIBUTION, label = '数据缺失' }) {
  return (
    <Tooltip title={reason}>
      <span className={styles.missingValue} tabIndex={0} aria-label={`${label}：${reason}`}>
        —
      </span>
    </Tooltip>
  );
}

function groupDecimal(value) {
  if (value == null) return '—';
  const [whole, fraction] = String(value).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  return fraction == null ? grouped : `${grouped}.${fraction}`;
}

function sumField(rows, field) {
  const values = rows
    .map((row) => row?.[field])
    .filter((value) => value != null);
  return values.length ? sumValues(values) : null;
}

function hasCompletePeriod(rows, expectedDays, field) {
  return (
    rows.length === expectedDays
    && rows.every((row) => row?.[field] != null)
  );
}

function trendValue(value, metric, coverage) {
  if (value == null) return '—';
  if (metric.key === 'costAmountScaled') {
    return formatScaledAmount(
      value,
      coverage?.costScale ?? 0,
      coverage?.currency || 'CNY'
    );
  }
  return groupDigits(value);
}

function trendAverage(total, days, metric, coverage) {
  if (total == null || !days) return '—';
  if (metric.key === 'costAmountScaled') {
    return divideScaledAmount(
      total,
      String(days),
      coverage?.costScale ?? 0,
      coverage?.currency || 'CNY'
    ) || '—';
  }
  return groupDecimal(formatAverage(total, days, 1));
}

function changeTone(change, lowerIsBetter = false) {
  if (!change || change.startsWith('0')) return 'neutral';
  const rising = change.startsWith('+');
  if (lowerIsBetter) return rising ? 'bad' : 'good';
  return rising ? 'good' : 'bad';
}

function EfficiencyCard({ metric, current, previous, change, loading, period }) {
  const tone = changeTone(change, metric.key !== 'ROAS');
  const missingReason = metric.missing;
  return (
    <Card className={styles.kpiCard}>
      <div className={styles.kpiTitleRow}>
        <h3>{metric.title} <span>{metric.key}</span></h3>
        <InfoTip label={metric.key}>
          <span>{metric.formula}</span>
          <br />
          <span>本期：{period ? `${period.currentFrom} 至 ${period.currentTo}` : '日期范围暂缺'}</span>
          <br />
          <span>上期：{period ? `${period.previousFrom} 至 ${period.previousTo}` : '日期范围暂缺'}</span>
          <br />
          <span>{metric.key === 'CPC' && current ? '按广告投入与点击数计算。' : metric.missing}</span>
        </InfoTip>
      </div>
      {loading ? (
        <Skeleton active paragraph={{ rows: 2 }} title={false} />
      ) : (
        <>
          <div className={styles.kpiPeriods}>
            <div>
              <span>本期</span>
              <strong>{current || <MissingValue reason={missingReason} label={`${metric.key} 本期`} />}</strong>
            </div>
            <div>
              <span>上期</span>
              <strong className={styles.previousValue}>
                {previous || <MissingValue reason="等长上一周期数据不完整，无法比较。" label={`${metric.key} 上期`} />}
              </strong>
            </div>
          </div>
          <div className={styles.kpiChange}>
            <span>较上一周期</span>
            {change ? (
              <strong data-tone={tone}>{change}</strong>
            ) : (
              <MissingValue reason="等长上一周期数据不完整，无法计算周期变化。" label={`${metric.key} 周期变化`} />
            )}
          </div>
        </>
      )}
    </Card>
  );
}

const FUNNEL_SHAPE = [
  { stage: '展现', width: 52 },
  { stage: '访问', width: 36 },
  { stage: '咨询', width: 24 },
  { stage: '入池', width: 12 },
  { stage: '成交', width: 4 }
];

function MicroFunnel({ rate }) {
  return (
    <div className={styles.microFunnel}>
      <div className={styles.funnelChart} aria-hidden="true">
        <Bar
          data={FUNNEL_SHAPE}
          xField="width"
          yField="stage"
          height={56}
          axis={false}
          legend={false}
          tooltip={false}
          padding={0}
          style={{ fill: '#2f6bff', fillOpacity: 0.82 }}
          animate={false}
        />
      </div>
      <div className={styles.funnelRate}>
        <span>整体转化率</span>
        {rate ? <strong>{rate}</strong> : <MissingValue label="整体转化率" />}
      </div>
    </div>
  );
}

function MetricHeader({ metric, targetMetric, selected, setTrendMetric }) {
  return (
    <th scope="col" className={selected ? styles.selectedHeader : undefined}>
      <button
        type="button"
        className={styles.headerButton}
        onClick={() => targetMetric && setTrendMetric(targetMetric)}
        disabled={!targetMetric}
        aria-pressed={selected}
        aria-label={targetMetric
          ? `选择${metric.label}作为趋势指标`
          : `${metric.label}不适用于当前趋势来源`}
      >
        {metric.header}
      </button>
    </th>
  );
}

function TrafficSourceRow({ source, dateRange }) {
  const sourcePeriod = dateRange
    ? buildPeriodRows(source.trend || [], dateRange[0], dateRange[1])
    : null;
  const sourceTotals = {
    visits: sourcePeriod ? sumField(sourcePeriod.current, 'visits') : null
  };
  const noAdReason = '百度统计来源报告不包含广告投入，这不是 0。';
  const noImpressionReason = '百度统计记录站内访问，不提供搜索结果展现。';
  return (
    <tr>
      <th scope="row">
        <Link href="/geo/website-traffic" className={styles.sourceLink}>
          <span className={styles.sourceIcon}><GlobalOutlined /></span>
          <span><strong>{source.sourceLabel}</strong><small>百度统计</small></span>
        </Link>
      </th>
      <td className={styles.metricCell}>
        <MissingValue reason={noAdReason} label={`${source.sourceLabel}广告投入`} />
      </td>
      <td className={styles.metricCell}>
        <MissingValue reason={noImpressionReason} label={`${source.sourceLabel}展现`} />
      </td>
      <td className={styles.metricCell}>
        <strong>{sourceTotals.visits == null
          ? <MissingValue label={`${source.sourceLabel}访问`} />
          : groupDigits(sourceTotals.visits)}</strong>
        <small>站内访问来源</small>
      </td>
      <td className={styles.metricCell}>
        <MissingValue label={`${source.sourceLabel}客服咨询`} />
        <small>咨询率 —</small>
      </td>
      <td className={styles.metricCell}>
        <MissingValue label={`${source.sourceLabel}线索入池`} />
        <small>入池率 —</small>
      </td>
      <td className={styles.metricCell}>
        <MissingValue label={`${source.sourceLabel}成交结果`} />
        <small>成交率 — · 金额 —</small>
      </td>
      <td><MicroFunnel rate={null} /></td>
    </tr>
  );
}

function StatusMessages({ defaultContext, marketing, overview }) {
  const messages = [];
  if (defaultContext.errorMessage) {
    messages.push({
      key: 'project',
      type: 'warning',
      title: '默认项目不可用',
      description: defaultContext.errorMessage
    });
  } else if (marketing.error) {
    messages.push({
      key: 'capability',
      type: 'error',
      title: '无法确认市场数据权限',
      description: '当前没有读取任何来源数据，请稍后重试。',
      action: <Button size="small" onClick={marketing.reload}>重试</Button>
    });
  } else if (!marketing.capabilities.adsRead) {
    messages.push({
      key: 'blocked',
      type: 'info',
      title: '广告数据尚未开放',
      description: '页面结构可用，但不会越过现有能力门读取或展示数据。'
    });
  }
  if (overview.ad.state === 'STALE') {
    const timestamp = overview.ad.data?.coverage?.lastSuccessfulAt;
    messages.push({
      key: 'stale',
      type: 'warning',
      title: '广告数据陈旧',
      description: timestamp
        ? `当前保留最后成功快照：${new Date(timestamp).toLocaleString('zh-CN')}`
        : '当前保留最后成功快照，请前往广告表现检查刷新状态。',
      action: <Link href="/geo/ad-performance">查看广告表现</Link>
    });
  }
  if (overview.ad.state === 'SOURCE_ERROR') {
    messages.push({
      key: 'ad-error',
      type: 'error',
      title: '广告来源读取失败',
      description: overview.ad.errorMessage || '无法读取广告快照。',
      action: <Button size="small" onClick={overview.reload}>重试</Button>
    });
  }
  if (overview.traffic.state === 'SOURCE_ERROR') {
    messages.push({
      key: 'traffic-error',
      type: 'warning',
      title: '网站流量来源读取失败',
      description: overview.traffic.errorMessage || '百度统计暂时不可用。',
      action: <Link href="/geo/website-traffic">查看网站流量</Link>
    });
  }
  if (overview.trafficSources.state === 'SOURCE_ERROR') {
    messages.push({
      key: 'traffic-sources-error',
      type: 'warning',
      title: '网站来源读取失败',
      description: overview.trafficSources.errorMessage || '百度统计来源暂时不可用。',
      action: <Button size="small" onClick={overview.reload}>重试</Button>
    });
  }
  if (!messages.length) return null;
  return (
    <div className={styles.statusStack} aria-live="polite">
      {messages.map((message) => (
        <Alert
          key={message.key}
          type={message.type}
          showIcon
          title={message.title}
          description={message.description}
          action={message.action}
        />
      ))}
    </div>
  );
}

export default function MarketOverviewPage() {
  const defaultContext = useDefaultProjectContext();
  const marketing = useMarketingCapabilities();
  const projectId = defaultContext.project?.id || '';
  const enabled = marketing.capabilities.adsRead || marketing.capabilities.trafficRead;
  const overview = useMarketOverview({ projectId, enabled });
  const reducedMotion = useReducedMotion();
  const [dateRange, setDateRange] = useState(null);
  const [efficiencySource, setEfficiencySource] = useState(PAID_SOURCE);
  const [trendSource, setTrendSource] = useState(PAID_SOURCE);
  const [trendMetric, setTrendMetric] = useState('clicks');

  const ad = overview.ad;
  const coverage = ad.data?.coverage || overview.traffic.data?.coverage || null;
  const defaultRange = ad.data?.filter || coverage;

  useEffect(() => {
    if (!coverage?.from || !coverage?.to || !defaultRange?.from || !defaultRange?.to) return;
    setDateRange((current) => {
      if (
        current
        && current[0] >= coverage.from
        && current[1] <= coverage.to
      ) return current;
      return [defaultRange.from, defaultRange.to];
    });
  }, [coverage?.from, coverage?.to, defaultRange?.from, defaultRange?.to]);

  const period = useMemo(() => {
    if (!dateRange) return null;
    return buildPeriodRows(ad.data?.trend || [], dateRange[0], dateRange[1]);
  }, [ad.data?.trend, dateRange]);

  const currentTotals = useMemo(() => ({
    costAmountScaled: period ? sumField(period.current, 'costAmountScaled') : null,
    impressions: period ? sumField(period.current, 'impressions') : null,
    clicks: period ? sumField(period.current, 'clicks') : null
  }), [period]);

  const previousTotals = useMemo(() => {
    if (!period) return {
      costAmountScaled: null,
      impressions: null,
      clicks: null
    };
    return {
      costAmountScaled: hasCompletePeriod(
        period.previous,
        period.days,
        'costAmountScaled'
      ) ? sumField(period.previous, 'costAmountScaled') : null,
      impressions: hasCompletePeriod(
        period.previous,
        period.days,
        'impressions'
      ) ? sumField(period.previous, 'impressions') : null,
      clicks: hasCompletePeriod(
        period.previous,
        period.days,
        'clicks'
      ) ? sumField(period.previous, 'clicks') : null
    };
  }, [period]);

  const cpcCurrent = divideScaledAmount(
    currentTotals.costAmountScaled,
    currentTotals.clicks,
    coverage?.costScale ?? 0,
    coverage?.currency || 'CNY'
  );
  const cpcPrevious = divideScaledAmount(
    previousTotals.costAmountScaled,
    previousTotals.clicks,
    coverage?.costScale ?? 0,
    coverage?.currency || 'CNY'
  );
  const cpcChange = formatRatioChange(
    currentTotals.costAmountScaled,
    currentTotals.clicks,
    previousTotals.costAmountScaled,
    previousTotals.clicks,
    1
  );

  const kpiValues = {
    ROAS: { current: null, previous: null, change: null },
    CPL: { current: null, previous: null, change: null },
    CPA: { current: null, previous: null, change: null },
    CPC: { current: cpcCurrent, previous: cpcPrevious, change: cpcChange }
  };

  const trafficSources = (
    overview.trafficSources.data?.attribution?.level === 'WEBSITE_TRAFFIC_SOURCE'
    && overview.trafficSources.data?.attribution?.isCrossSystemVerified === false
  ) ? overview.trafficSources.data?.sources || [] : [];
  const selectedTrafficSourceKey = TONGJI_SOURCE_KEYS[trendSource] || null;
  const selectedTrafficSource = selectedTrafficSourceKey
    ? trafficSources.find((source) => (
        source.sourceKey === selectedTrafficSourceKey
      )) || null
    : null;
  const selectedTrendRows = useMemo(() => (
    trendSource === PAID_SOURCE
      ? ad.data?.trend || []
      : trendSource === TONGJI_ALL_SOURCE
        ? overview.traffic.data?.trend || []
        : selectedTrafficSource?.trend || []
  ), [
    ad.data?.trend,
    overview.traffic.data?.trend,
    selectedTrafficSource?.trend,
    trendSource
  ]);
  const selectedTrendCoverage = trendSource === PAID_SOURCE
    ? ad.data?.coverage || coverage
    : trendSource === TONGJI_ALL_SOURCE
      ? overview.traffic.data?.coverage || coverage
      : overview.trafficSources.data?.coverage || coverage;
  const availableTrendMetrics = trendSource === PAID_SOURCE
    ? TREND_METRICS
    : TRAFFIC_TREND_METRICS;
  const selectedMetric = availableTrendMetrics.find(
    (metric) => metric.key === trendMetric
  ) || availableTrendMetrics[0];
  const trendPeriod = useMemo(() => {
    if (!dateRange) return null;
    return buildPeriodRows(selectedTrendRows, dateRange[0], dateRange[1]);
  }, [dateRange, selectedTrendRows]);
  const currentMetricRows = (trendPeriod?.current || []).map((row) => ({
    date: row.date,
    value: row[selectedMetric.key]
  }));
  const previousMetricRows = (trendPeriod?.previous || []).map((row) => ({
    date: row.date,
    value: row[selectedMetric.key]
  }));
  const currentSummary = summarizeMetric(currentMetricRows);
  const previousComplete = trendPeriod && hasCompletePeriod(
    trendPeriod.previous,
    trendPeriod.days,
    selectedMetric.key
  );
  const previousSummary = previousComplete
    ? summarizeMetric(previousMetricRows)
    : summarizeMetric([]);
  const chartMaximum = [currentSummary.peak?.value, previousSummary.peak?.value]
    .filter(Boolean)
    .reduce((largest, value) => (
      BigInt(value) > BigInt(largest) ? value : largest
    ), '0');
  const chartData = [
    ...currentMetricRows.map((row, index) => ({
      slot: row.date.slice(5),
      actualDate: row.date,
      exactValue: row.value,
      displayValue: trendValue(row.value, selectedMetric, selectedTrendCoverage),
      coordinate: row.value == null
        ? null
        : relativeCoordinate(row.value, chartMaximum),
      period: '当前周期',
      index
    })),
    ...(previousComplete ? previousMetricRows.map((row, index) => ({
      slot: currentMetricRows[index]?.date.slice(5) || `第${index + 1}天`,
      actualDate: row.date,
      exactValue: row.value,
      displayValue: trendValue(row.value, selectedMetric, selectedTrendCoverage),
      coordinate: row.value == null
        ? null
        : relativeCoordinate(row.value, chartMaximum),
      period: '上一周期',
      index
    })) : [])
  ].filter((row) => row.coordinate != null);

  const trendChange = formatPeriodChange(
    currentSummary.total,
    previousSummary.total,
    1
  );
  const selectedTrendError = trendSource === PAID_SOURCE
    ? overview.ad.errorMessage
    : trendSource === TONGJI_ALL_SOURCE
      ? overview.traffic.errorMessage
      : overview.trafficSources.errorMessage;
  const loading = (
    defaultContext.loading
    || marketing.loading
    || (enabled && overview.status === 'LOADING' && !ad.data)
  );
  const canShowAdRow = ['AVAILABLE', 'ZERO', 'STALE'].includes(ad.state);
  const canShowTrafficSourceRows = ['AVAILABLE', 'NO_DATA'].includes(
    overview.trafficSources.state
  ) && trafficSources.length > 0;

  return (
    <div className={styles.page}>
      <h1 className={styles.visuallyHidden}>市场总览</h1>
      <div className={styles.breadcrumbRow}>
        <Breadcrumb items={[{ title: '首页' }, { title: '市场总览' }]} />
        <RangePicker
          aria-label="全局日期范围"
          value={dateRange
            ? [dayjs(dateRange[0]), dayjs(dateRange[1])]
            : null}
          format="YYYY-MM-DD"
          separator="至"
          allowClear={false}
          allowEmpty={[true, true]}
          disabled={!coverage?.from || !coverage?.to}
          disabledDate={(current) => (
            !coverage?.from
            || !coverage?.to
            || current.isBefore(dayjs(coverage.from), 'day')
            || current.isAfter(dayjs(coverage.to), 'day')
          )}
          onChange={(values) => {
            if (!values?.[0] || !values?.[1]) return;
            setDateRange([
              values[0].format('YYYY-MM-DD'),
              values[1].format('YYYY-MM-DD')
            ]);
          }}
        />
      </div>

      <StatusMessages
        defaultContext={defaultContext}
        marketing={marketing}
        overview={overview}
      />

      {!defaultContext.errorMessage ? (
        <>
      <section className={styles.efficiencySection} aria-labelledby="efficiency-title">
        <div className={styles.moduleHeader}>
          <div className={styles.moduleTitleWithFilter}>
            <Title level={2} id="efficiency-title">投放效率</Title>
            <Select
              aria-label="投放效率付费来源"
              value={efficiencySource}
              onChange={setEfficiencySource}
              options={[{ value: PAID_SOURCE, label: '百度推广' }]}
              popupMatchSelectWidth={false}
            />
          </div>
        </div>
        <div className={styles.kpiGrid}>
          {KPI_DEFINITIONS.map((metric) => (
            <EfficiencyCard
              key={metric.key}
              metric={metric}
              current={kpiValues[metric.key].current}
              previous={kpiValues[metric.key].previous}
              change={kpiValues[metric.key].change}
              loading={loading}
              period={period}
            />
          ))}
        </div>
      </section>

      <section className={styles.whiteModule} aria-labelledby="journey-title">
        <div className={styles.moduleHeader}>
          <div className={styles.titleWithInfo}>
            <Title level={2} id="journey-title">来源全链路</Title>
            <InfoTip label="全链路">
              点击率＝访问（点击）÷展现；咨询率＝客服咨询÷访问（点击）；
              入池率＝线索入池÷客服咨询；成交率与整体转化率需要可信成交数量。
              百度统计来源只是站内访问证据，不是跨系统归因。
            </InfoTip>
          </div>
        </div>
        <div className={styles.tableScroller} tabIndex={0} role="region" aria-label="来源全链路表格">
          <table className={styles.journeyTable}>
            <caption>来源全链路</caption>
            <thead>
              <tr>
                <th scope="col">来源</th>
                {TREND_METRICS.map((metric) => (
                  <MetricHeader
                    key={metric.key}
                    metric={metric}
                    targetMetric={trendSource === PAID_SOURCE
                      ? metric.key
                      : metric.key === 'clicks' ? 'visits' : null}
                    selected={trendMetric === (
                      trendSource === PAID_SOURCE
                        ? metric.key
                        : metric.key === 'clicks' ? 'visits' : null
                    )}
                    setTrendMetric={setTrendMetric}
                  />
                ))}
                <th scope="col">客服咨询</th>
                <th scope="col">线索入池</th>
                <th scope="col">成交结果</th>
                <th scope="col">全链路</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8}><Skeleton active paragraph={{ rows: 1 }} title={false} /></td>
                </tr>
              ) : (canShowAdRow || canShowTrafficSourceRows) ? (
                <>
                {canShowAdRow ? <tr>
                  <th scope="row">
                    <Link href="/geo/ad-performance" className={styles.sourceLink}>
                      <span className={styles.sourceIcon}><FundProjectionScreenOutlined /></span>
                      <span><strong>百度推广</strong><small>广告</small></span>
                    </Link>
                  </th>
                  <td className={styles.metricCell}>
                    <strong>{currentTotals.costAmountScaled == null
                      ? <MissingValue label="广告投入" />
                      : formatScaledAmount(
                        currentTotals.costAmountScaled,
                        coverage?.costScale ?? 0,
                        coverage?.currency || 'CNY'
                      )}</strong>
                  </td>
                  <td className={styles.metricCell}>
                    <strong>{currentTotals.impressions == null
                      ? <MissingValue label="展现" />
                      : groupDigits(currentTotals.impressions)}</strong>
                  </td>
                  <td className={styles.metricCell}>
                    <strong>{currentTotals.clicks == null
                      ? <MissingValue label="访问（点击）" />
                      : groupDigits(currentTotals.clicks)}</strong>
                    <small>点击率 {calculateRate(
                      currentTotals.clicks,
                      currentTotals.impressions,
                      2
                    ) || '—'}</small>
                  </td>
                  <td className={styles.metricCell}>
                    <MissingValue label="客服咨询" />
                    <small>咨询率 —</small>
                  </td>
                  <td className={styles.metricCell}>
                    <MissingValue label="线索入池" />
                    <small>入池率 —</small>
                  </td>
                  <td className={styles.metricCell}>
                    <MissingValue label="成交结果" />
                    <small>成交率 — · 金额 —</small>
                  </td>
                  <td><MicroFunnel rate={null} /></td>
                </tr> : null}
                {trafficSources.map((source) => (
                  <TrafficSourceRow
                    key={source.sourceKey}
                    source={source}
                    dateRange={dateRange}
                  />
                ))}
                </>
              ) : (
                <tr>
                  <td colSpan={8}>
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={ad.errorMessage || '当前范围没有可展示的广告来源数据'}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.whiteModule} aria-labelledby="trend-title">
        <div className={styles.trendHeader}>
          <div className={styles.trendControls}>
            <Title level={2} id="trend-title">每日趋势</Title>
            <label>
              <span>来源</span>
              <Select
                aria-label="趋势来源"
                value={trendSource}
                onChange={(value) => {
                  setTrendSource(value);
                  setTrendMetric(value === PAID_SOURCE ? 'clicks' : 'visits');
                }}
                options={TREND_SOURCES}
                popupMatchSelectWidth={false}
              />
            </label>
            <label>
              <span>指标</span>
              <Select
                aria-label="趋势指标"
                value={selectedMetric.key}
                onChange={setTrendMetric}
                options={availableTrendMetrics.map((metric) => ({
                  value: metric.key,
                  label: metric.label
                }))}
                popupMatchSelectWidth={false}
              />
            </label>
          </div>
          <dl className={styles.trendSummary} aria-label="趋势摘要">
            <div><dt>区间总量</dt><dd>{trendValue(currentSummary.total, selectedMetric, selectedTrendCoverage)}</dd></div>
            <div><dt>日均</dt><dd>{trendAverage(currentSummary.total, trendPeriod?.days, selectedMetric, selectedTrendCoverage)}</dd></div>
            <div>
              <dt>较上一周期</dt>
              <dd data-tone={changeTone(trendChange, selectedMetric.key === 'costAmountScaled')}>
                {trendChange || <MissingValue reason="等长上一周期数据不完整，无法比较。" label="趋势周期变化" />}
              </dd>
            </div>
            <div>
              <dt>峰值</dt>
              <dd>{currentSummary.peak
                ? `${trendValue(currentSummary.peak.value, selectedMetric, selectedTrendCoverage)} · ${currentSummary.peak.date.slice(5)}`
                : '—'}</dd>
            </div>
          </dl>
        </div>

        {loading ? (
          <Skeleton active paragraph={{ rows: 6 }} title={false} />
        ) : chartData.length ? (
          <>
            <div
              className={styles.chartRegion}
              role="img"
              aria-label={`${selectedMetric.label}每日趋势。当前周期${trendValue(currentSummary.total, selectedMetric, selectedTrendCoverage)}；上一周期${trendValue(previousSummary.total, selectedMetric, selectedTrendCoverage)}。`}
            >
              <Line
                data={chartData}
                xField="slot"
                yField="coordinate"
                seriesField="period"
                colorField="period"
                height={232}
                scale={{
                  x: { tickCount: 7 },
                  color: {
                    domain: ['当前周期', '上一周期'],
                    range: ['#2f6bff', '#94a3b8']
                  },
                  y: { domain: [0, 100] }
                }}
                axis={{
                  x: { title: false, tick: false, labelAutoRotate: false },
                  y: { title: false, label: false, grid: true }
                }}
                legend={{ color: { position: 'bottom' } }}
                point={{ size: 3 }}
                style={{
                  lineWidth: 2,
                  lineDash: (datum) => (
                    (Array.isArray(datum) ? datum[0]?.period : datum?.period) === '上一周期'
                      ? [6, 4]
                      : [0, 0]
                  )
                }}
                tooltip={{
                  title: { field: 'actualDate' },
                  items: [
                    (datum) => ({
                      name: datum.period,
                      value: datum.displayValue,
                      color: datum.period === '当前周期' ? '#2f6bff' : '#94a3b8'
                    })
                  ]
                }}
                animate={reducedMotion ? false : {
                  enter: { type: 'fadeIn', duration: 180 },
                  update: { type: 'fadeIn', duration: 180 }
                }}
              />
            </div>
            <details className={styles.dataDetails}>
              <summary>查看每日趋势等价数据表</summary>
              <div className={styles.tableScroller} tabIndex={0} role="region" aria-label="每日趋势等价数据">
                <table className={styles.equivalentTable}>
                  <caption>每日趋势等价数据表</caption>
                  <thead>
                    <tr>
                      <th scope="col">当前日期</th>
                      <th scope="col">当前周期</th>
                      <th scope="col">上一日期</th>
                      <th scope="col">上一周期</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentMetricRows.map((row, index) => (
                      <tr key={row.date}>
                        <th scope="row">{row.date}</th>
                        <td>{trendValue(row.value, selectedMetric, selectedTrendCoverage)}</td>
                        <td>{previousComplete ? previousMetricRows[index]?.date || '—' : '—'}</td>
                        <td>{previousComplete
                          ? trendValue(previousMetricRows[index]?.value, selectedMetric, selectedTrendCoverage)
                          : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={selectedTrendError || '当前范围没有趋势数据'}
          />
        )}
      </section>
        </>
      ) : null}
    </div>
  );
}
