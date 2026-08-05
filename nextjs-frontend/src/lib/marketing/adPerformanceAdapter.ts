import type {
  MarketingAdCampaign,
  MarketingAdGroup,
  MarketingAdHierarchyResponse,
  MarketingAdKeyword,
  MarketingDailyMetrics,
  MarketingDashboardResponse,
  MarketingExactMetrics
} from './generated/marketingAdReadApi';

export type {
  MarketingAdHierarchyResponse,
  MarketingDashboardResponse
} from './generated/marketingAdReadApi';

export type AdHierarchyLevel = 'project' | 'scheme' | 'unit' | 'keyword';

export type AdDeliveryStatus = 'active' | 'paused' | 'unknown';

export type AdExactMetrics = MarketingExactMetrics;

export type AdDailyMetrics = MarketingDailyMetrics;

export type AdDetailItem = {
  label: string;
  value: string;
  status?: AdDeliveryStatus;
};

export type AdHierarchyNode = {
  key: string;
  id: string;
  name: string;
  level: AdHierarchyLevel;
  status: AdDeliveryStatus;
  budgetAmountScaled: string | null;
  metrics: AdExactMetrics;
  currentTrend: AdDailyMetrics[];
  previousTrend: AdDailyMetrics[];
  details: AdDetailItem[];
  children?: AdHierarchyNode[];
};

export type AdPeriod = {
  currentFrom: string;
  currentTo: string;
  previousFrom: string;
  previousTo: string;
  days: number;
};

export type AdPerformanceModel = {
  source: 'dashboard' | 'development-fixture';
  dataState: 'ready' | 'empty';
  projectId: string;
  projectName: string;
  currency: string;
  costScale: number;
  availableFrom: string;
  availableTo: string;
  period: AdPeriod;
  summary: AdExactMetrics;
  previousState: 'READY' | 'UNAVAILABLE' | 'ERROR';
  previousSummary: AdExactMetrics | null;
  previousUnavailableReason: string;
  currentTrend: AdDailyMetrics[];
  previousTrend: AdDailyMetrics[];
  structure: AdHierarchyNode[];
};

export type AdPreviousHierarchyResult =
  | {
      state: 'READY';
      hierarchy: MarketingAdHierarchyResponse;
      reason: '';
    }
  | {
      state: 'UNAVAILABLE' | 'ERROR';
      hierarchy: null;
      reason: string;
    };

export function classifyAdPreviousHierarchyError(
  error: unknown
): AdPreviousHierarchyResult {
  const response = (
    error && typeof error === 'object' && 'response' in error
      ? (error as {
          response?: {
            data?: { error?: { code?: unknown; message?: unknown } };
          };
        }).response
      : undefined
  );
  const code = typeof response?.data?.error?.code === 'string'
    ? response.data.error.code
    : null;
  const message = typeof response?.data?.error?.message === 'string'
    ? response.data.error.message
    : null;
  if (code === 'DASHBOARD_DATE_OUT_OF_RANGE') {
    return {
      state: 'UNAVAILABLE',
      hierarchy: null,
      reason: message || '上一周期超出广告快照覆盖范围。'
    };
  }
  return {
    state: 'ERROR',
    hierarchy: null,
    reason: message || '上一周期广告数据读取失败，请重试。'
  };
}

const EMPTY_METRICS: AdExactMetrics = Object.freeze({
  costAmountScaled: '0',
  impressions: '0',
  clicks: '0'
});

function decimalText(value: unknown): string {
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) {
    const error = new TypeError('营销看板响应合同无效');
    (error as TypeError & { code: string }).code =
      'MARKETING_DASHBOARD_RESPONSE_INVALID';
    throw error;
  }
  return BigInt(value).toString();
}

function invalidDashboard(): never {
  const error = new TypeError('营销看板响应合同无效');
  (error as TypeError & { code: string }).code =
    'MARKETING_DASHBOARD_RESPONSE_INVALID';
  throw error;
}

function objectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, maximum = 512): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function dateText(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

function exactMetrics(value: unknown): value is AdExactMetrics {
  if (!objectRecord(value)) return false;
  return ['costAmountScaled', 'impressions', 'clicks'].every((field) => (
    typeof value[field] === 'string' && /^\d+$/u.test(value[field])
  ));
}

function exactTrend(value: unknown): boolean {
  return Array.isArray(value) && value.every((row) => (
    objectRecord(row) && dateText(row.date) && exactMetrics(row)
  ));
}

function dashboardCampaign(value: unknown): value is MarketingAdCampaign {
  if (!objectRecord(value)) return false;
  const row = value as Record<string, unknown>;
  const metricsValid = exactMetrics(row);
  const trendValid = row.trend === undefined || exactTrend(row.trend);
  return text(value.accountId, 128)
    && text(value.campaignId, 128)
    && text(value.campaignName)
    && metricsValid
    && trendValid;
}

function dashboardAdGroup(value: unknown): value is MarketingAdGroup {
  return dashboardCampaign(value)
    && text((value as unknown as Record<string, unknown>).adGroupId, 128)
    && text((value as unknown as Record<string, unknown>).adGroupName);
}

function dashboardKeyword(value: unknown): value is MarketingAdKeyword {
  if (!dashboardAdGroup(value)) return false;
  const row = value as unknown as Record<string, unknown>;
  return text(row.keywordId, 128)
    && text(row.keywordName, 1024)
    && ['KEYWORD', 'WORD_PACKAGE', 'AUTO_EXPANSION']
      .includes(String(row.targetingType));
}

function identity(...parts: unknown[]): string {
  return parts.map((part) => String(part)).join('\u0000');
}

function uniqueMap<T>(
  rows: T[],
  keyOf: (row: T) => string
): Map<string, T> | null {
  const result = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    if (result.has(key)) return null;
    result.set(key, row);
  }
  return result;
}

function metricsEqual(left: AdExactMetrics, right: AdExactMetrics): boolean {
  return left.costAmountScaled === right.costAmountScaled
    && left.impressions === right.impressions
    && left.clicks === right.clicks;
}

function sumMetrics(rows: AdExactMetrics[]): AdExactMetrics {
  return rows.reduce((sum, row) => ({
    costAmountScaled: (
      BigInt(sum.costAmountScaled) + BigInt(row.costAmountScaled)
    ).toString(),
    impressions: (BigInt(sum.impressions) + BigInt(row.impressions)).toString(),
    clicks: (BigInt(sum.clicks) + BigInt(row.clicks)).toString()
  }), { ...EMPTY_METRICS });
}

function hierarchyItemTrendValid(
  row: MarketingAdCampaign,
  range: { from: string; to: string }
): boolean {
  if (!Array.isArray(row.trend) || !exactTrend(row.trend)) return false;
  if (
    new Set(row.trend.map((point) => point.date)).size !== row.trend.length
    || row.trend.some((point) => point.date < range.from || point.date > range.to)
  ) return false;
  return metricsEqual(sumMetrics(row.trend as AdDailyMetrics[]), row);
}

export function assertMarketingAdHierarchyResponse(
  value: unknown,
  dashboard: MarketingDashboardResponse,
  expectedRange: { from: string; to: string },
  options: { requireDashboardSummary?: boolean } = {}
): asserts value is MarketingAdHierarchyResponse {
  if (!objectRecord(value)) invalidDashboard();
  const coverage = value.coverage;
  const filter = value.filter;
  const summary = value.summary;
  const campaigns = value.campaigns;
  const adGroups = value.adGroups;
  const keywords = value.keywords;
  const counts = value.hierarchyCounts;
  if (
    value.schemaVersion !== 'marketing_ad_hierarchy_v1'
    || value.projectId !== dashboard.projectId
    || value.revision !== dashboard.revision
    || 'searchTerms' in value
    || !objectRecord(coverage)
    || coverage.from !== dashboard.coverage?.from
    || coverage.to !== dashboard.coverage?.to
    || coverage.currency !== dashboard.coverage?.currency
    || coverage.costScale !== dashboard.coverage?.costScale
    || coverage.lastSuccessfulAt !== dashboard.coverage?.lastSuccessfulAt
    || !objectRecord(filter)
    || filter.from !== expectedRange.from
    || filter.to !== expectedRange.to
    || !exactMetrics(summary)
    || !exactMetrics(dashboard.summary)
    || (
      options.requireDashboardSummary !== false
      && !metricsEqual(summary, dashboard.summary as AdExactMetrics)
    )
    || !Array.isArray(campaigns) || !campaigns.every(dashboardCampaign)
    || !Array.isArray(adGroups) || !adGroups.every(dashboardAdGroup)
    || !Array.isArray(keywords) || !keywords.every(dashboardKeyword)
    || !objectRecord(counts)
    || counts.campaigns !== campaigns.length
    || counts.adGroups !== adGroups.length
    || counts.keywords !== keywords.length
  ) invalidDashboard();
  const verifiedCampaigns = campaigns as MarketingAdCampaign[];
  const verifiedAdGroups = adGroups as MarketingAdGroup[];
  const verifiedKeywords = keywords as MarketingAdKeyword[];
  if (
    ![...verifiedCampaigns, ...verifiedAdGroups, ...verifiedKeywords]
      .every((row) => hierarchyItemTrendValid(row, expectedRange))
    || !metricsEqual(sumMetrics(verifiedCampaigns), summary as AdExactMetrics)
    || (
      dashboard.states?.snapshotContentState === 'ZERO'
      && (verifiedCampaigns.length > 0
        || verifiedAdGroups.length > 0
        || verifiedKeywords.length > 0)
    )
  ) invalidDashboard();
  const accountIds = new Set((dashboard.bindings || []).map((row) => row.accountId));
  const campaignMap = uniqueMap(
    verifiedCampaigns,
    (row) => identity(row.accountId, row.campaignId)
  );
  const adGroupMap = uniqueMap(
    verifiedAdGroups,
    (row) => identity(row.accountId, row.campaignId, row.adGroupId)
  );
  const keywordMap = uniqueMap(
    verifiedKeywords,
    (row) => identity(row.accountId, row.campaignId, row.adGroupId, row.keywordId)
  );
  if (!campaignMap || !adGroupMap || !keywordMap) invalidDashboard();
  if (!verifiedCampaigns.every((row) => accountIds.has(row.accountId))) {
    invalidDashboard();
  }
  for (const row of verifiedAdGroups) {
    const parent = campaignMap.get(identity(row.accountId, row.campaignId));
    if (!parent || parent.campaignName !== row.campaignName) invalidDashboard();
  }
  for (const row of verifiedKeywords) {
    const parent = adGroupMap.get(identity(
      row.accountId,
      row.campaignId,
      row.adGroupId
    ));
    if (
      !parent
      || parent.campaignName !== row.campaignName
      || parent.adGroupName !== row.adGroupName
    ) invalidDashboard();
  }
}

export function assertMarketingDashboardRootResponse(
  value: unknown,
  expectedProjectId: string
): asserts value is MarketingDashboardResponse {
  if (
    !objectRecord(value)
    || value.schemaVersion !== 'marketing_dashboard_v2'
    || !text(value.projectId, 128)
    || value.projectId !== expectedProjectId
    || !text(value.projectName)
    || !objectRecord(value.states)
    || ['campaigns', 'adGroups', 'keywords', 'searchTerms']
      .some((field) => Object.hasOwn(value, field))
  ) invalidDashboard();
  const snapshotState = value.states.snapshotContentState;
  const freshnessState = value.states.snapshotFreshnessState;
  if (
    !text(value.states.moduleState, 64)
    || !['ACTIVE', 'ARCHIVED'].includes(String(value.states.projectState))
    || !['NOT_CONNECTED', 'ACTION_REQUIRED', 'DISCONNECTED', 'CONNECTED']
      .includes(String(value.states.sourceSummaryState))
    || !['NONE', 'BLOCKED', 'ACTIVE']
      .includes(String(value.states.bindingSummaryState))
    || !['NONE', 'ZERO', 'DATA'].includes(String(snapshotState))
    || !['NA', 'FRESH', 'STALE'].includes(String(freshnessState))
    || !text(value.states.refreshState, 32)
  ) invalidDashboard();
  const coverage = value.coverage;
  if (snapshotState === 'NONE') {
    if (coverage !== null || value.revision !== null || freshnessState !== 'NA') {
      invalidDashboard();
    }
  } else if (
    !text(value.revision, 128)
    || !objectRecord(coverage)
    || !dateText(coverage.from)
    || !dateText(coverage.to)
    || coverage.from > coverage.to
    || !text(coverage.currency, 16)
    || !text(coverage.lastSuccessfulAt, 64)
    || !Number.isFinite(Date.parse(coverage.lastSuccessfulAt))
    || !Number.isSafeInteger(coverage.costScale)
    || Number(coverage.costScale) < 0
    || Number(coverage.costScale) > 12
    || !['FRESH', 'STALE'].includes(String(freshnessState))
  ) invalidDashboard();
  const filter = value.filter;
  if (snapshotState === 'NONE') {
    if (filter !== null) invalidDashboard();
  } else if (
    !objectRecord(filter)
    || !dateText(filter.from)
    || !dateText(filter.to)
    || filter.from > filter.to
    || filter.from < String((coverage as Record<string, unknown>).from)
    || filter.to > String((coverage as Record<string, unknown>).to)
  ) invalidDashboard();
  if (
    !exactMetrics(value.summary)
    || !exactTrend(value.trend)
    || !Array.isArray(value.bindings)
    || !value.bindings.every((row) => objectRecord(row)
      && text(row.bindingId, 128)
      && text(row.accountId, 128)
      && text(row.accountName)
      && text(row.sourceState, 64)
      && text(row.bindingState, 64)
      && (row.blockingCode === null || text(row.blockingCode, 128)))
  ) invalidDashboard();
  const verifiedTrend = value.trend as AdDailyMetrics[];
  if (
    !metricsEqual(sumMetrics(verifiedTrend), value.summary as AdExactMetrics)
    || (
      objectRecord(coverage)
      && (
        new Set(verifiedTrend.map((row) => row.date)).size !== verifiedTrend.length
        || verifiedTrend.some((row) => (
          row.date < String(coverage.from) || row.date > String(coverage.to)
        ))
      )
    )
  ) {
    invalidDashboard();
  }
  const hierarchyCounts = value.hierarchyCounts;
  if (
    !objectRecord(hierarchyCounts)
    || !['campaigns', 'adGroups', 'keywords', 'searchTerms'].every((field) => (
      Number.isSafeInteger(hierarchyCounts[field])
      && Number(hierarchyCounts[field]) >= 0
    ))
  ) invalidDashboard();
  const activeRun = value.activeRun;
  const lastRun = value.lastRun;
  if (
    !(
      activeRun === null
      || (objectRecord(activeRun)
        && text(activeRun.runId, 128)
        && text(activeRun.status, 32))
    )
    || !(
      lastRun === null
      || (objectRecord(lastRun)
        && text(lastRun.runId, 128)
        && text(lastRun.status, 32)
        && (lastRun.failureCode === null || text(lastRun.failureCode, 128)))
    )
  ) invalidDashboard();
  if (
    ['NONE', 'ZERO'].includes(String(snapshotState))
    && (
      verifiedTrend.length !== 0
      || !metricsEqual(value.summary as AdExactMetrics, EMPTY_METRICS)
      || ['campaigns', 'adGroups', 'keywords', 'searchTerms']
        .some((field) => Number(hierarchyCounts[field]) !== 0)
    )
  ) invalidDashboard();
}

export function marketingSnapshotWarning(
  dashboard: MarketingDashboardResponse
): string {
  if (dashboard.states?.snapshotFreshnessState !== 'STALE') return '';
  const cutoff = dashboard.coverage?.to;
  const failureCode = dashboard.lastRun?.failureCode;
  const cutoffText = cutoff ? `截至 ${cutoff}` : '最后成功';
  return failureCode
    ? `广告快照刷新失败（${failureCode}），当前展示${cutoffText}的数据。`
    : `广告快照已过期，当前展示${cutoffText}的数据。`;
}
export function shiftIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new TypeError('日期无效');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function inclusiveDayCount(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00.000Z`).getTime();
  const end = new Date(`${to}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
    throw new RangeError('日期范围无效');
  }
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function buildAdPeriod(from: string, to: string): AdPeriod {
  const days = inclusiveDayCount(from, to);
  const previousTo = shiftIsoDate(from, -1);
  return {
    currentFrom: from,
    currentTo: to,
    previousFrom: shiftIsoDate(previousTo, -(days - 1)),
    previousTo,
    days
  };
}

function normalizeMetrics(value?: Partial<AdExactMetrics>): AdExactMetrics {
  return {
    costAmountScaled: decimalText(value?.costAmountScaled),
    impressions: decimalText(value?.impressions),
    clicks: decimalText(value?.clicks)
  };
}

function normalizeTrend(
  rows: MarketingDashboardResponse['trend'] = []
): AdDailyMetrics[] {
  return rows.map((row) => ({
    date: row.date,
    ...normalizeMetrics(row)
  }));
}

function sumCampaignTrends(
  campaigns: MarketingAdCampaign[]
): AdDailyMetrics[] {
  const totals = new Map<string, AdExactMetrics>();
  for (const campaign of campaigns) {
    for (const row of normalizeTrend(campaign.trend)) {
      const previous = totals.get(row.date) || EMPTY_METRICS;
      totals.set(row.date, sumAdMetrics([previous, row]));
    }
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, metrics]) => ({ date, ...metrics }));
}

function hierarchyKey(...parts: string[]): string {
  return parts.join('\u0000');
}

function appendGrouped<T>(map: Map<string, T[]>, key: string, row: T): void {
  const current = map.get(key);
  if (current) current.push(row);
  else map.set(key, [row]);
}

function targetingTypeLabel(value: MarketingAdKeyword['targetingType']): string {
  if (value === 'WORD_PACKAGE') return '词包';
  if (value === 'AUTO_EXPANSION') return '自动扩量';
  return '关键词';
}

export function sumAdMetrics(rows: AdExactMetrics[]): AdExactMetrics {
  return rows.reduce<AdExactMetrics>((total, row) => ({
    costAmountScaled: (
      BigInt(total.costAmountScaled) + BigInt(row.costAmountScaled)
    ).toString(),
    impressions: (
      BigInt(total.impressions) + BigInt(row.impressions)
    ).toString(),
    clicks: (
      BigInt(total.clicks) + BigInt(row.clicks)
    ).toString()
  }), { ...EMPTY_METRICS });
}

function emptyModel(
  dashboard: MarketingDashboardResponse,
  projectName: string,
  from: string,
  to: string,
  previous: AdPreviousHierarchyResult
): AdPerformanceModel {
  const coverage = dashboard.coverage;
  return {
    source: 'dashboard',
    dataState: 'empty',
    projectId: String(dashboard.projectId),
    projectName,
    currency: coverage?.currency || 'CNY',
    costScale: coverage?.costScale ?? 2,
    availableFrom: coverage?.from || from,
    availableTo: coverage?.to || to,
    period: buildAdPeriod(from, to),
    summary: { ...EMPTY_METRICS },
    previousState: previous.state,
    previousSummary: previous.state === 'READY'
      ? normalizeMetrics(previous.hierarchy.summary)
      : null,
    previousUnavailableReason: previous.reason,
    currentTrend: [],
    previousTrend: previous.state === 'READY'
      ? sumCampaignTrends(previous.hierarchy.campaigns)
      : [],
    structure: []
  };
}

export function adaptMarketingAdHierarchy(
  dashboard: MarketingDashboardResponse,
  hierarchy: MarketingAdHierarchyResponse | null,
  previous: AdPreviousHierarchyResult,
  fallbackProjectName = '默认监控项目'
): AdPerformanceModel {
  const projectName = dashboard.projectName || fallbackProjectName;
  const coverage = dashboard.coverage;
  const from = dashboard.filter?.from || coverage?.from || shiftIsoDate(
    new Date().toISOString().slice(0, 10),
    -29
  );
  const to = dashboard.filter?.to || coverage?.to
    || new Date().toISOString().slice(0, 10);
  if (
    !coverage
    || dashboard.states?.snapshotContentState === 'NONE'
  ) {
    return emptyModel(dashboard, projectName, from, to, previous);
  }

  const currentTrend = normalizeTrend(dashboard.trend);
  const previousHierarchy = previous.state === 'READY'
    ? previous.hierarchy
    : null;
  const previousCampaigns = new Map((previousHierarchy?.campaigns || []).map(
    (row) => [hierarchyKey(row.accountId, row.campaignId), row]
  ));
  const previousAdGroups = new Map((previousHierarchy?.adGroups || []).map(
    (row) => [hierarchyKey(row.accountId, row.campaignId, row.adGroupId), row]
  ));
  const previousKeywords = new Map((previousHierarchy?.keywords || []).map(
    (row) => [hierarchyKey(
      row.accountId,
      row.campaignId,
      row.adGroupId,
      row.keywordId
    ), row]
  ));
  const campaigns = hierarchy?.campaigns || [];
  const adGroups = hierarchy?.adGroups || [];
  const keywords = hierarchy?.keywords || [];
  const adGroupsByCampaign = new Map<string, MarketingAdGroup[]>();
  const keywordsByAdGroup = new Map<string, MarketingAdKeyword[]>();
  for (const adGroup of adGroups) {
    appendGrouped(
      adGroupsByCampaign,
      hierarchyKey(adGroup.accountId, adGroup.campaignId),
      adGroup
    );
  }
  for (const keyword of keywords) {
    appendGrouped(
      keywordsByAdGroup,
      hierarchyKey(
        keyword.accountId,
        keyword.campaignId,
        keyword.adGroupId
      ),
      keyword
    );
  }
  const projectStatus: AdDeliveryStatus = 'unknown';
  const projectStateLabel = dashboard.states?.projectState === 'ACTIVE'
    ? '已启用'
    : dashboard.states?.projectState === 'ARCHIVED' ? '已归档' : '—';
  const schemeNodes: AdHierarchyNode[] = campaigns.map((campaign) => {
    const campaignKey = hierarchyKey(
      campaign.accountId,
      campaign.campaignId
    );
    const unitNodes: AdHierarchyNode[] = (
      adGroupsByCampaign.get(campaignKey) || []
    ).map((adGroup) => {
      const adGroupKey = hierarchyKey(
        adGroup.accountId,
        adGroup.campaignId,
        adGroup.adGroupId
      );
      const keywordNodes: AdHierarchyNode[] = (
        keywordsByAdGroup.get(adGroupKey) || []
      ).map((keyword) => {
        const previousKeyword = previousKeywords.get(hierarchyKey(
          keyword.accountId,
          keyword.campaignId,
          keyword.adGroupId,
          keyword.keywordId
        ));
        return {
          key: `keyword:${keyword.accountId}:${keyword.campaignId}:${keyword.adGroupId}:${keyword.keywordId}`,
          id: String(keyword.keywordId),
          name: keyword.keywordName,
          level: 'keyword',
          status: 'unknown',
          budgetAmountScaled: null,
          metrics: normalizeMetrics(keyword),
          currentTrend: normalizeTrend(keyword.trend),
          previousTrend: normalizeTrend(previousKeyword?.trend),
          details: [
            { label: '关键词 ID', value: String(keyword.keywordId) },
            { label: '所属单元', value: keyword.adGroupName },
            {
              label: '定向类型',
              value: targetingTypeLabel(keyword.targetingType)
            },
            { label: '投放状态', value: '—', status: 'unknown' }
          ]
        };
      });
      const previousAdGroup = previousAdGroups.get(adGroupKey);
      return {
        key: `unit:${adGroup.accountId}:${adGroup.campaignId}:${adGroup.adGroupId}`,
        id: String(adGroup.adGroupId),
        name: adGroup.adGroupName,
        level: 'unit',
        status: 'unknown',
        budgetAmountScaled: null,
        metrics: normalizeMetrics(adGroup),
        currentTrend: normalizeTrend(adGroup.trend),
        previousTrend: normalizeTrend(previousAdGroup?.trend),
        details: [
          { label: '单元 ID', value: String(adGroup.adGroupId) },
          { label: '所属计划', value: campaign.campaignName },
          { label: '下属关键词数', value: String(keywordNodes.length) },
          { label: '投放状态', value: '—', status: 'unknown' }
        ],
        children: keywordNodes
      };
    });
    const previousCampaign = previousCampaigns.get(campaignKey);
    return {
      key: `scheme:${campaign.accountId}:${campaign.campaignId}`,
      id: String(campaign.campaignId),
      name: campaign.campaignName,
      level: 'scheme',
      status: 'unknown',
      budgetAmountScaled: null,
      metrics: normalizeMetrics(campaign),
      currentTrend: normalizeTrend(campaign.trend),
      previousTrend: normalizeTrend(previousCampaign?.trend),
      details: [
        { label: '计划 ID', value: String(campaign.campaignId) },
        { label: '所属项目', value: projectName },
        { label: '下属单元数', value: String(unitNodes.length) },
        { label: '投放设备', value: '—' },
        { label: '投放地域', value: '—' },
        { label: '出价策略', value: '—' },
        { label: '周期预算', value: '—' },
        { label: '投放状态', value: '—', status: 'unknown' }
      ],
      children: unitNodes
    };
  });
  const summary = normalizeMetrics(hierarchy?.summary || dashboard.summary);
  const previousSummary = previousHierarchy
    ? normalizeMetrics(previousHierarchy.summary)
    : null;
  const previousTrend = previousHierarchy
    ? sumCampaignTrends(previousHierarchy.campaigns)
    : [];
  const projectNode: AdHierarchyNode = {
    key: `project:${dashboard.projectId}`,
    id: String(dashboard.projectId),
    name: projectName,
    level: 'project',
    status: projectStatus,
    budgetAmountScaled: null,
    metrics: summary,
    currentTrend,
    previousTrend,
    details: [
      { label: '项目 ID', value: String(dashboard.projectId) },
      { label: '项目状态', value: projectStateLabel },
      { label: '优化目标', value: '—' },
      { label: '项目预算', value: '—' },
      { label: '下属计划数', value: String(schemeNodes.length) },
      {
        label: '投放状态',
        value: '—',
        status: projectStatus
      }
    ],
    children: schemeNodes
  };

  return {
    source: 'dashboard',
    dataState: (
      dashboard.states?.snapshotContentState === 'ZERO'
        ? 'empty'
        : 'ready'
    ),
    projectId: String(dashboard.projectId),
    projectName,
    currency: coverage.currency || 'CNY',
    costScale: coverage.costScale,
    availableFrom: coverage.from,
    availableTo: coverage.to,
    period: buildAdPeriod(from, to),
    summary,
    previousState: previous.state,
    previousSummary,
    previousUnavailableReason: previous.reason,
    currentTrend,
    previousTrend,
    structure: [projectNode]
  };
}
