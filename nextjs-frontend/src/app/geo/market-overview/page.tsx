// @ts-nocheck
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dayjs from 'dayjs';
import { Line } from '@ant-design/plots';
import {
  Alert,
  Breadcrumb,
  Button,
  Empty,
  Select,
  Skeleton,
  Tooltip,
  Typography
} from 'antd';
import {
  FundProjectionScreenOutlined,
  GlobalOutlined,
  InfoCircleOutlined,
  LinkOutlined,
  SearchOutlined
} from '@ant-design/icons';
import useDefaultProjectContext from '@/lib/useDefaultProjectContext';
import useMarketingCapabilities from '@/lib/useMarketingCapabilities';
import useMarketOverview from '@/lib/marketing/useMarketOverview';
import { useWebsiteTrafficOverview } from '@/lib/marketing/useWebsiteTraffic';
import useWebsiteFormConsultations from '@/lib/websiteData/useWebsiteFormConsultations';
import { MARKETING_SOURCE_LABELS } from '@/lib/marketing/sourceCatalog';
import MarketingPageFilters from '@/components/marketing/MarketingPageFilters';
import {
  clampMarketingDateRange,
  useMarketingFilters
} from '@/components/marketing/MarketingFiltersContext';
import MarketingMetricCard, {
  MarketingMetricGrid
} from '@/components/marketing/MarketingMetricCard';
import { groupDigits } from '@/utils/marketingValues.cjs';
import {
  buildPeriodRows,
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

const { Title } = Typography;

const PAID_SOURCE = 'BAIDU_PAID';
const TONGJI_ALL_SOURCE = 'BAIDU_TONGJI_ALL';
const TONGJI_SOURCE_KEYS = Object.freeze({
  BAIDU_PAID: 'BAIDU_PAID',
  BAIDU_TONGJI_DIRECT: 'DIRECT',
  BAIDU_TONGJI_BAIDU_SEARCH: 'BAIDU_SEARCH',
  BAIDU_TONGJI_BING_SEARCH: 'BING_SEARCH',
  BAIDU_TONGJI_GOOGLE_SEARCH: 'GOOGLE_SEARCH',
  BAIDU_TONGJI_OTHER_SEARCH: 'OTHER_SEARCH',
  BAIDU_TONGJI_EXTERNAL_REFERRAL: 'EXTERNAL_REFERRAL'
});
const TONGJI_CHANNEL_DEFINITIONS = Object.freeze([
  { sourceKey: 'BAIDU_PAID', sourceLabel: MARKETING_SOURCE_LABELS.BAIDU_PAID, sourceHost: 'e.baidu.com', sourceType: 'PAID' },
  { sourceKey: 'DIRECT', sourceLabel: MARKETING_SOURCE_LABELS.DIRECT, sourceHost: null, sourceType: 'DIRECT' },
  { sourceKey: 'BAIDU_SEARCH', sourceLabel: MARKETING_SOURCE_LABELS.BAIDU_SEARCH, sourceHost: 'baidu.com', sourceType: 'ORGANIC_SEARCH' },
  { sourceKey: 'BING_SEARCH', sourceLabel: MARKETING_SOURCE_LABELS.BING_SEARCH, sourceHost: 'bing.com', sourceType: 'ORGANIC_SEARCH' },
  { sourceKey: 'GOOGLE_SEARCH', sourceLabel: MARKETING_SOURCE_LABELS.GOOGLE_SEARCH, sourceHost: 'google.com', sourceType: 'ORGANIC_SEARCH' },
  { sourceKey: 'OTHER_SEARCH', sourceLabel: MARKETING_SOURCE_LABELS.OTHER_SEARCH, sourceHost: '多个搜索引擎', sourceType: 'ORGANIC_SEARCH' },
  { sourceKey: 'EXTERNAL_REFERRAL', sourceLabel: MARKETING_SOURCE_LABELS.EXTERNAL_REFERRAL, sourceHost: '多个网站', sourceType: 'REFERRAL' }
]);
const MISSING_ATTRIBUTION = '缺少可信的按来源关联，当前不能计算该指标。';
const FORM_ONLY_SOURCE_LABELS = Object.freeze({
  UTM_CAMPAIGN: `${MARKETING_SOURCE_LABELS.UTM_CAMPAIGN}（官网表单）`,
  UNKNOWN: `${MARKETING_SOURCE_LABELS.UNKNOWN}（官网表单）`
});

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
    key: 'visits',
    label: '访问',
    unit: '次',
    header: '访问'
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
  { value: 'BAIDU_TONGJI_DIRECT', label: MARKETING_SOURCE_LABELS.DIRECT },
  { value: 'BAIDU_TONGJI_BAIDU_SEARCH', label: MARKETING_SOURCE_LABELS.BAIDU_SEARCH },
  { value: 'BAIDU_TONGJI_BING_SEARCH', label: MARKETING_SOURCE_LABELS.BING_SEARCH },
  { value: 'BAIDU_TONGJI_GOOGLE_SEARCH', label: MARKETING_SOURCE_LABELS.GOOGLE_SEARCH },
  { value: 'BAIDU_TONGJI_OTHER_SEARCH', label: MARKETING_SOURCE_LABELS.OTHER_SEARCH },
  { value: 'BAIDU_TONGJI_EXTERNAL_REFERRAL', label: MARKETING_SOURCE_LABELS.EXTERNAL_REFERRAL }
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
    formula: '广告投入 ÷ 广告点击数；越低越好。',
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
    <Tooltip title={children} placement="top" trigger={['hover']}>
      <span
        className={styles.infoButton}
        role="img"
        aria-label={`${label}口径说明`}
      >
        <InfoCircleOutlined aria-hidden="true" />
      </span>
    </Tooltip>
  );
}

function MissingValue({ reason = MISSING_ATTRIBUTION, label = '数据缺失' }) {
  return (
    <Tooltip title={reason} trigger={['hover']}>
      <span className={styles.missingValue} aria-label={`${label}：${reason}`}>
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

function SourceIdentity({
  sourceKey,
  label,
  host,
  tag = null
}) {
  let icon = <GlobalOutlined aria-hidden="true" />;
  let brand = 'site';
  if (sourceKey === 'BAIDU_SEARCH') {
    icon = <span aria-hidden="true">度</span>;
    brand = 'baidu';
  } else if (sourceKey === 'BING_SEARCH') {
    icon = <span aria-hidden="true">b</span>;
    brand = 'bing';
  } else if (sourceKey === 'GOOGLE_SEARCH') {
    icon = <span aria-hidden="true">G</span>;
    brand = 'google';
  } else if (sourceKey === 'OTHER_SEARCH' || sourceKey === 'EXTERNAL_REFERRAL') {
    icon = <LinkOutlined aria-hidden="true" />;
    brand = 'other';
  } else if (sourceKey === PAID_SOURCE) {
    icon = <FundProjectionScreenOutlined aria-hidden="true" />;
    brand = 'paid';
  } else if (sourceKey === 'SEARCH') {
    icon = <SearchOutlined aria-hidden="true" />;
  }
  const sourceTag = tag || (
    sourceKey === PAID_SOURCE
      ? '广告'
      : ['BAIDU_SEARCH', 'BING_SEARCH', 'GOOGLE_SEARCH', 'OTHER_SEARCH'].includes(sourceKey)
        ? '自然搜索'
        : sourceKey === 'DIRECT'
          ? '直接访问'
          : sourceKey === 'EXTERNAL_REFERRAL'
            ? '外部引荐'
            : '未分类'
  );
  return (
    <span className={styles.sourceIdentity}>
      <span className={styles.sourceIcon} data-brand={brand}>{icon}</span>
      <span className={styles.sourceCopy}>
        <strong>{label}</strong>
        <span className={styles.sourceMeta}>
          <span className={styles.sourceHost}>{host}</span>
          <span className={sourceTag === '自然搜索' ? styles.naturalTag : styles.allDeviceTag}>
            {sourceTag}
          </span>
        </span>
      </span>
    </span>
  );
}

function WebsiteFormConsultationCell({ source, websiteForms, label }) {
  if (websiteForms.state === 'LOADING') {
    return <Skeleton active paragraph={false} title={{ width: 48 }} />;
  }
  if (source) {
    return (
      <>
        <strong>{groupDigits(source.attributedFormSubmissionSessions)}</strong>
        <small>官网可归因成功提交会话</small>
      </>
    );
  }
  const reason = websiteForms.state === 'SOURCE_ERROR'
    ? websiteForms.errorMessage || '官网表单咨询读取失败。'
    : websiteForms.state === 'IDLE'
      ? '等待项目与日期范围后读取官网表单咨询。'
      : '官网接口未提供该来源拆分，不能按 0 展示。';
  return <MissingValue reason={reason} label={`${label}官网表单咨询`} />;
}

function TrafficSourceRow({
  source,
  formConsultation,
  websiteForms
}) {
  const visits = source.summary?.visits ?? null;
  const noAdReason = '百度统计来源报告不包含广告投入，这不是 0。';
  const noImpressionReason = '百度统计记录站内访问，不提供搜索结果展现。';
  return (
    <tr>
      <th scope="row">
        <Link href="/geo/website-traffic" className={styles.sourceLink}>
          <SourceIdentity
            sourceKey={source.sourceKey}
            label={source.sourceLabel}
            host={source.sourceHost}
          />
        </Link>
      </th>
      <td className={styles.metricCell}>
        <MissingValue reason={noAdReason} label={`${source.sourceLabel}广告投入`} />
      </td>
      <td className={styles.metricCell}>
        <MissingValue reason={noImpressionReason} label={`${source.sourceLabel}展现`} />
      </td>
      <td className={styles.metricCell}>
        <strong>{visits == null
          ? <MissingValue label={`${source.sourceLabel}访问`} />
          : groupDigits(visits)}</strong>
        <small>所选区间的百度统计访问次数</small>
      </td>
      <td className={styles.metricCell}>
        <WebsiteFormConsultationCell
          source={formConsultation}
          websiteForms={websiteForms}
          label={source.sourceLabel}
        />
      </td>
      <td className={styles.metricCell}>
        <MissingValue label={`${source.sourceLabel}线索入池`} />
        <small>入池率 —</small>
      </td>
      <td className={styles.metricCell}>
        <MissingValue label={`${source.sourceLabel}成交结果`} />
        <small>成交率 — · 金额 —</small>
      </td>
      <td className={styles.conversionCell}>
        <MissingValue label={`${source.sourceLabel}整体转换率`} />
      </td>
    </tr>
  );
}

function WebsiteFormOnlyRow({ source, websiteForms }) {
  const label = FORM_ONLY_SOURCE_LABELS[source.sourceKey]
    || '其他官网表单来源';
  const sourceOnlyReason = '该官网表单来源没有可精确对齐的百度访问来源，单独展示。';
  return (
    <tr>
      <th scope="row">
        <SourceIdentity
          sourceKey={source.sourceKey}
          label={label}
          host="gato.com.cn"
          tag="官网表单"
        />
      </th>
      <td className={styles.metricCell}>
        <MissingValue reason={sourceOnlyReason} label={`${label}广告投入`} />
      </td>
      <td className={styles.metricCell}>
        <MissingValue reason={sourceOnlyReason} label={`${label}展现`} />
      </td>
      <td className={styles.metricCell}>
        <MissingValue reason={sourceOnlyReason} label={`${label}访问`} />
      </td>
      <td className={styles.metricCell}>
        <WebsiteFormConsultationCell
          source={source}
          websiteForms={websiteForms}
          label={label}
        />
      </td>
      <td className={styles.metricCell}>
        <MissingValue label={`${label}线索入池`} />
      </td>
      <td className={styles.metricCell}>
        <MissingValue label={`${label}成交结果`} />
        <small>成交率 — · 金额 —</small>
      </td>
      <td className={styles.conversionCell}>
        <MissingValue label={`${label}整体转换率`} />
      </td>
    </tr>
  );
}

function StatusMessages({
  defaultContext,
  marketing,
  overview,
  websiteForms
}) {
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
  if (overview.ad.state === 'SOURCE_ERROR') {
    messages.push({
      key: 'ad-error',
      type: 'error',
      title: '广告来源读取失败',
      description: overview.ad.errorMessage || '无法读取广告快照。',
      action: <Button size="small" onClick={overview.reload}>重试</Button>
    });
  } else if (overview.ad.state === 'STALE') {
    messages.push({
      key: 'ad-stale',
      type: 'warning',
      title: '广告快照刷新失败',
      description: overview.ad.errorMessage || '当前展示最后一份成功快照。',
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
  if (websiteForms.state === 'SOURCE_ERROR') {
    messages.push({
      key: 'website-forms-error',
      type: 'warning',
      title: '官网表单咨询读取失败',
      description: websiteForms.errorMessage || '官网表单咨询暂时不可用。',
      action: <Button size="small" onClick={websiteForms.reload}>重试</Button>
    });
  } else if (websiteForms.state === 'FALLBACK') {
    messages.push({
      key: 'website-forms-fallback',
      type: 'warning',
      title: '官网表单咨询使用缓存',
      description: '官网接口暂时不可用，当前展示相同日期范围的最后成功聚合快照。',
      action: <Button size="small" onClick={websiteForms.reload}>重试</Button>
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
  const {
    device: trafficDevice,
    setDevice: setTrafficDevice,
    dateRange,
    setDateRange
  } = useMarketingFilters();
  const projectId = defaultContext.project?.id || '';
  const enabled = marketing.capabilities.adsRead || marketing.capabilities.trafficRead;
  const [trendSource, setTrendSource] = useState(PAID_SOURCE);
  const selectedTrafficSourceKey = TONGJI_SOURCE_KEYS[trendSource] || null;
  const overview = useMarketOverview({
    projectId,
    enabled,
    device: trafficDevice,
    trafficTrendSource: selectedTrafficSourceKey
  });
  const reducedMotion = useReducedMotion();
  const websiteFallbackRange = useMemo(() => {
    const to = dayjs().subtract(1, 'day');
    return [
      to.subtract(29, 'day').format('YYYY-MM-DD'),
      to.format('YYYY-MM-DD')
    ];
  }, []);
  const [efficiencySource, setEfficiencySource] = useState(PAID_SOURCE);
  const [trendMetric, setTrendMetric] = useState('visits');
  const websiteForms = useWebsiteFormConsultations({
    projectId,
    enabled: Boolean(projectId && dateRange),
    from: dateRange?.[0] || null,
    to: dateRange?.[1] || null
  });
  const trafficRangeQuery = useMemo(() => ({
    projectId,
    enabled: Boolean(projectId && dateRange && marketing.capabilities.trafficRead),
    device: trafficDevice,
    from: dateRange?.[0] || websiteFallbackRange[0],
    to: dateRange?.[1] || websiteFallbackRange[1],
    source: 'ALL',
    metric: 'visits'
  }), [
    dateRange,
    marketing.capabilities.trafficRead,
    projectId,
    trafficDevice,
    websiteFallbackRange
  ]);
  const trafficRange = useWebsiteTrafficOverview(trafficRangeQuery);

  const ad = overview.ad;
  const trafficData = overview.traffic.data?.device === trafficDevice
    ? overview.traffic.data
    : null;
  const paidTrafficData = overview.paidTraffic.data?.device === trafficDevice
    ? overview.paidTraffic.data
    : null;
  const trafficTrendData = overview.trafficTrend.data?.device === trafficDevice
    ? overview.trafficTrend.data
    : null;
  const coverage = ad.data?.coverage || trafficData?.coverage || null;

  useEffect(() => {
    if (!coverage || !dateRange) return;
    const nextRange = clampMarketingDateRange(dateRange, coverage);
    if (nextRange[0] !== dateRange[0] || nextRange[1] !== dateRange[1]) {
      setDateRange(nextRange);
    }
  }, [coverage, dateRange, setDateRange]);

  const period = useMemo(() => {
    if (!dateRange) return null;
    return buildPeriodRows(ad.data?.trend || [], dateRange[0], dateRange[1]);
  }, [ad.data?.trend, dateRange]);

  const currentTotals = useMemo(() => ({
    costAmountScaled: period && hasCompletePeriod(
      period.current,
      period.days,
      'costAmountScaled'
    ) ? sumField(period.current, 'costAmountScaled') : null,
    impressions: period && hasCompletePeriod(
      period.current,
      period.days,
      'impressions'
    ) ? sumField(period.current, 'impressions') : null,
    clicks: period && hasCompletePeriod(
      period.current,
      period.days,
      'clicks'
    ) ? sumField(period.current, 'clicks') : null
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

  const rangeSourceRows = new Map(
    (trafficRange.data?.sourceQuality?.rows || []).map((source) => [source.sourceKey, source])
  );
  const trafficSources = TONGJI_CHANNEL_DEFINITIONS.map((definition) => {
    const rangeSource = rangeSourceRows.get(definition.sourceKey);
    return {
      ...definition,
      sourceHost: definition.sourceKey === 'DIRECT'
        ? trafficRange.data?.site?.domain || '官网'
        : definition.sourceHost,
      summary: { visits: rangeSource?.visits ?? null }
    };
  });
  const paidTrafficSource = trafficSources.find(
    (source) => source.sourceKey === PAID_SOURCE
  ) || null;
  const nonPaidTrafficSources = trafficSources.filter(
    (source) => source.sourceKey !== PAID_SOURCE
  );
  const websiteFormBySource = new Map(
    (websiteForms.data?.sourceBreakdown || []).map((source) => [
      source.sourceKey,
      source
    ])
  );
  const visibleAlignedFormKeys = new Set(
    TONGJI_CHANNEL_DEFINITIONS.map((source) => source.sourceKey)
  );
  const formOnlySources = (websiteForms.data?.sourceBreakdown || []).filter(
    (source) => (
      !visibleAlignedFormKeys.has(source.sourceKey)
      && BigInt(source.attributedFormSubmissionSessions) > BigInt(0)
    )
  );
  const paidTrafficTrend = paidTrafficData?.selectedTrend?.sourceKey === PAID_SOURCE
    ? paidTrafficData.selectedTrend
    : null;
  const selectedTrafficTrend = (
    trafficTrendData?.selectedTrend?.sourceKey === selectedTrafficSourceKey
  ) ? trafficTrendData.selectedTrend : null;
  const selectedTrendRows = useMemo(() => (
    trendSource === PAID_SOURCE
      ? trendMetric === 'visits'
        ? paidTrafficTrend?.trend || []
        : ad.data?.trend || []
      : trendSource === TONGJI_ALL_SOURCE
        ? trafficData?.trend || []
        : selectedTrafficTrend?.trend || []
  ), [
    ad.data?.trend,
    paidTrafficTrend?.trend,
    trafficData?.trend,
    selectedTrafficTrend?.trend,
    trendMetric,
    trendSource
  ]);
  const selectedTrendCoverage = trendSource === PAID_SOURCE
    ? trendMetric === 'visits'
      ? paidTrafficData?.coverage || coverage
      : ad.data?.coverage || coverage
    : trendSource === TONGJI_ALL_SOURCE
      ? trafficData?.coverage || coverage
      : trafficTrendData?.coverage || coverage;
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
      ? trendMetric === 'visits'
        ? overview.paidTraffic.errorMessage
        : overview.ad.errorMessage
      : trendSource === TONGJI_ALL_SOURCE
        ? overview.traffic.errorMessage
        : overview.trafficTrend.errorMessage;
  const loading = (
    defaultContext.loading
    || marketing.loading
    || (enabled && overview.status === 'LOADING' && !ad.data)
  );
  const paidVisits = paidTrafficSource?.summary?.visits ?? null;
  const canShowAdRow = ['AVAILABLE', 'ZERO', 'STALE'].includes(ad.state);
  const canShowTrafficSourceRows = ['AVAILABLE', 'NO_DATA'].includes(
    overview.trafficSources.state
  ) && nonPaidTrafficSources.length > 0;
  const canShowFormOnlyRows = formOnlySources.length > 0;

  return (
    <div className={styles.page}>
      <h1 className={styles.visuallyHidden}>市场总览</h1>
      <div className={styles.breadcrumbRow}>
        <Breadcrumb items={[{ title: '首页' }, { title: '市场总览' }]} />
        <MarketingPageFilters
          device={trafficDevice}
          onDeviceChange={setTrafficDevice}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          dateAriaLabel="市场总览日期范围"
          minDate={coverage?.from || dayjs(websiteFallbackRange[1]).subtract(179, 'day').format('YYYY-MM-DD')}
          maxDate={coverage?.to || websiteFallbackRange[1]}
          presetAnchor={coverage?.to || websiteFallbackRange[1]}
        />
      </div>

      <StatusMessages
        defaultContext={defaultContext}
        marketing={marketing}
        overview={overview}
        websiteForms={websiteForms}
      />
      {trafficRange.error ? (
        <Alert
          className={styles.rangeSourceAlert}
          type="warning"
          showIcon
          title="当前日期范围的渠道访问读取失败"
          description={trafficRange.error}
          action={<Button size="small" onClick={trafficRange.reload}>重试</Button>}
        />
      ) : null}

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
        <MarketingMetricGrid ariaLabel="投放效率指标">
          {KPI_DEFINITIONS.map((metric) => (
            <MarketingMetricCard
              key={metric.key}
              title={metric.title}
              metricKey={metric.key}
              current={kpiValues[metric.key].current}
              previous={kpiValues[metric.key].previous}
              change={kpiValues[metric.key].change}
              info={metric.formula}
              loading={loading}
              tone={changeTone(
                kpiValues[metric.key].change,
                metric.key !== 'ROAS'
              )}
              currentMissingReason={metric.missing}
              previousMissingReason={metric.missing}
              changeMissingReason={metric.missing}
            />
          ))}
        </MarketingMetricGrid>
      </section>

      <section className={styles.whiteModule} aria-labelledby="journey-title">
        <div className={styles.moduleHeader}>
          <div className={styles.titleWithInfo}>
            <Title level={2} id="journey-title">全链路数据</Title>
            <InfoTip label="全链路">
              渠道目录是内置且稳定的：百度推广的投入和展现来自百度推广报告，
              访问来自百度统计；其余渠道的访问均来自百度统计。
              官网表单咨询只展示可归因成功提交会话，不包含 53KF 客服咨询；
              这些数据是独立事实，不会因同期出现而伪造跨系统归因。
            </InfoTip>
          </div>
        </div>
        <div className={styles.tableScroller} tabIndex={0} role="region" aria-label="全链路数据表格">
          <table className={styles.journeyTable}>
            <caption>全链路数据</caption>
            <thead>
              <tr>
                <th scope="col">渠道</th>
                {TREND_METRICS.map((metric) => (
                  <MetricHeader
                    key={metric.key}
                    metric={metric}
                    targetMetric={trendSource === PAID_SOURCE
                      ? metric.key
                      : metric.key === 'visits' ? 'visits' : null}
                    selected={trendMetric === (
                      trendSource === PAID_SOURCE
                        ? metric.key
                        : metric.key === 'visits' ? 'visits' : null
                    )}
                    setTrendMetric={setTrendMetric}
                  />
                ))}
                <th scope="col">官网表单咨询</th>
                <th scope="col">线索入池</th>
                <th scope="col">成交结果</th>
                <th scope="col">整体转换率</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8}><Skeleton active paragraph={{ rows: 1 }} title={false} /></td>
                </tr>
              ) : (canShowAdRow || canShowTrafficSourceRows || canShowFormOnlyRows) ? (
                <>
                {canShowAdRow ? <tr>
                  <th scope="row">
                    <Link href="/geo/ad-performance" className={styles.sourceLink}>
                      <SourceIdentity
                        sourceKey={PAID_SOURCE}
                        label="百度推广"
                        host="e.baidu.com"
                      />
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
                    <strong>{paidVisits == null
                      ? <MissingValue reason="百度统计付费搜索访问暂时不可用，不能用广告点击代替。" label="百度推广访问" />
                      : groupDigits(paidVisits)}</strong>
                    <small>来自百度统计</small>
                  </td>
                  <td className={styles.metricCell}>
                    <WebsiteFormConsultationCell
                      source={websiteFormBySource.get(PAID_SOURCE)}
                      websiteForms={websiteForms}
                      label="百度推广"
                    />
                  </td>
                  <td className={styles.metricCell}>
                    <MissingValue label="线索入池" />
                    <small>入池率 —</small>
                  </td>
                  <td className={styles.metricCell}>
                    <MissingValue label="成交结果" />
                    <small>成交率 — · 金额 —</small>
                  </td>
                  <td className={styles.conversionCell}>
                    <MissingValue label="百度推广整体转换率" />
                  </td>
                </tr> : null}
                {nonPaidTrafficSources.map((source) => (
                  <TrafficSourceRow
                    key={source.sourceKey}
                    source={source}
                    formConsultation={websiteFormBySource.get(source.sourceKey)}
                    websiteForms={websiteForms}
                  />
                ))}
                {formOnlySources.map((source) => (
                  <WebsiteFormOnlyRow
                    key={`website-form-${source.sourceKey}`}
                    source={source}
                    websiteForms={websiteForms}
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
                  setTrendMetric('visits');
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
