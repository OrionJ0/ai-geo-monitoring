export type AdHierarchyLevel = 'project' | 'scheme' | 'unit' | 'keyword';

export type AdDeliveryStatus = 'active' | 'paused' | 'unknown';

export type AdExactMetrics = {
  costAmountScaled: string;
  impressions: string;
  clicks: string;
};

export type AdDailyMetrics = AdExactMetrics & {
  date: string;
};

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
  currentTrend: AdDailyMetrics[];
  previousTrend: AdDailyMetrics[];
  structure: AdHierarchyNode[];
};

export type DashboardCampaign = AdExactMetrics & {
  accountId: string;
  campaignId: string;
  campaignName: string;
  trend?: Array<Partial<AdDailyMetrics> & { date: string }>;
};

export type DashboardAdGroup = DashboardCampaign & {
  adGroupId: string;
  adGroupName: string;
};

export type DashboardKeyword = DashboardAdGroup & {
  keywordId: string;
  keywordName: string;
  targetingType: 'KEYWORD' | 'WORD_PACKAGE' | 'AUTO_EXPANSION';
};

export type DashboardSearchTerm = DashboardAdGroup & {
  keywordName: string;
  searchTerm: string;
  queryStatus: 'ADDED' | 'NOT_ADDED' | 'NOT_ADDABLE';
  matchType: string;
};

export type MarketingDashboardResponse = {
  projectId: string;
  projectName?: string;
  revision: string | null;
  states?: {
    projectState?: string;
    snapshotContentState?: string;
    snapshotFreshnessState?: 'NA' | 'FRESH' | 'STALE';
  };
  coverage: {
    from: string;
    to: string;
    currency: string;
    costScale: number;
    lastSuccessfulAt?: string;
  } | null;
  filter?: {
    from: string;
    to: string;
  } | null;
  summary?: Partial<AdExactMetrics>;
  trend?: Array<Partial<AdDailyMetrics> & { date: string }>;
  bindings?: Array<{
    accountId: string;
    accountName: string;
  }>;
  campaigns?: DashboardCampaign[];
  adGroups?: DashboardAdGroup[];
  keywords?: DashboardKeyword[];
  searchTerms?: DashboardSearchTerm[];
  hierarchyCounts?: {
    campaigns: number;
    adGroups: number;
    keywords: number;
    searchTerms: number;
  };
  lastRun?: {
    runId: string;
    status: string;
    failureCode: string | null;
  } | null;
  activeRun?: {
    runId: string;
    status: string;
    coverage?: {
      from: string;
      to: string;
    };
  } | null;
};

export type MarketingAdHierarchyResponse = {
  schemaVersion: 'marketing_ad_hierarchy_v1';
  projectId: string;
  revision: string;
  coverage: NonNullable<MarketingDashboardResponse['coverage']>;
  filter: NonNullable<MarketingDashboardResponse['filter']>;
  summary: AdExactMetrics;
  campaigns: DashboardCampaign[];
  adGroups: DashboardAdGroup[];
  keywords: DashboardKeyword[];
  hierarchyCounts: {
    campaigns: number;
    adGroups: number;
    keywords: number;
  };
};

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

function dashboardCampaign(value: unknown): value is DashboardCampaign {
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

function dashboardAdGroup(value: unknown): value is DashboardAdGroup {
  return dashboardCampaign(value)
    && text((value as unknown as Record<string, unknown>).adGroupId, 128)
    && text((value as unknown as Record<string, unknown>).adGroupName);
}

function dashboardKeyword(value: unknown): value is DashboardKeyword {
  if (!dashboardAdGroup(value)) return false;
  const row = value as unknown as Record<string, unknown>;
  return text(row.keywordId, 128)
    && text(row.keywordName, 1024)
    && ['KEYWORD', 'WORD_PACKAGE', 'AUTO_EXPANSION']
      .includes(String(row.targetingType));
}

function dashboardSearchTerm(value: unknown): value is DashboardSearchTerm {
  if (!dashboardAdGroup(value)) return false;
  const row = value as unknown as Record<string, unknown>;
  return text(row.keywordName, 1024)
    && text(row.searchTerm, 1024)
    && ['ADDED', 'NOT_ADDED', 'NOT_ADDABLE'].includes(String(row.queryStatus))
    && text(row.matchType, 64);
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

function dashboardSemanticsValid(value: MarketingDashboardResponse): boolean {
  const bindings = value.bindings || [];
  const campaigns = value.campaigns || [];
  const adGroups = value.adGroups || [];
  const keywords = value.keywords || [];
  const searchTerms = value.searchTerms || [];
  const bindingMap = uniqueMap(bindings, (row) => row.accountId);
  const campaignMap = uniqueMap(
    campaigns,
    (row) => identity(row.accountId, row.campaignId)
  );
  const adGroupMap = uniqueMap(
    adGroups,
    (row) => identity(row.accountId, row.campaignId, row.adGroupId)
  );
  const keywordMap = uniqueMap(
    keywords,
    (row) => identity(row.accountId, row.keywordId)
  );
  if (!bindingMap || !campaignMap || !adGroupMap || !keywordMap) return false;

  const campaignMatches = (row: DashboardCampaign) => {
    const parent = campaignMap.get(identity(row.accountId, row.campaignId));
    return bindingMap.has(row.accountId)
      && Boolean(parent)
      && parent?.campaignName === row.campaignName;
  };
  const adGroupMatches = (row: DashboardAdGroup) => {
    const parent = adGroupMap.get(identity(
      row.accountId,
      row.campaignId,
      row.adGroupId
    ));
    return campaignMatches(row)
      && Boolean(parent)
      && parent?.campaignName === row.campaignName
      && parent?.adGroupName === row.adGroupName;
  };
  if (!campaigns.every((row) => bindingMap.has(row.accountId))) return false;
  if (!adGroups.every(adGroupMatches)) return false;
  if (!keywords.every(adGroupMatches)) return false;
  if (!searchTerms.every(adGroupMatches)) return false;

  const summary = value.summary as AdExactMetrics;
  const trend = value.trend as AdDailyMetrics[];
  if (!metricsEqual(sumMetrics(campaigns), summary)) return false;
  if (!metricsEqual(sumMetrics(trend), summary)) return false;
  if (value.states?.snapshotContentState === 'NONE') {
    return campaigns.length === 0
      && adGroups.length === 0
      && keywords.length === 0
      && searchTerms.length === 0
      && trend.length === 0
      && metricsEqual(summary, EMPTY_METRICS);
  }
  return true;
}

function hierarchyItemTrendValid(
  row: DashboardCampaign,
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
  expectedRange: { from: string; to: string }
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
    || !metricsEqual(summary, dashboard.summary as AdExactMetrics)
    || !Array.isArray(campaigns) || !campaigns.every(dashboardCampaign)
    || !Array.isArray(adGroups) || !adGroups.every(dashboardAdGroup)
    || !Array.isArray(keywords) || !keywords.every(dashboardKeyword)
    || !objectRecord(counts)
    || counts.campaigns !== campaigns.length
    || counts.adGroups !== adGroups.length
    || counts.keywords !== keywords.length
  ) invalidDashboard();
  const verifiedCampaigns = campaigns as DashboardCampaign[];
  const verifiedAdGroups = adGroups as DashboardAdGroup[];
  const verifiedKeywords = keywords as DashboardKeyword[];
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

export function assertMarketingDashboardResponse(
  value: unknown,
  expectedProjectId: string
): asserts value is MarketingDashboardResponse {
  if (
    !objectRecord(value)
    || !text(value.projectId, 128)
    || value.projectId !== expectedProjectId
  ) {
    invalidDashboard();
  }
  const states = value.states;
  const snapshotState = objectRecord(states)
    ? states.snapshotContentState
    : null;
  const freshnessState = objectRecord(states)
    ? states.snapshotFreshnessState
    : null;
  if (!['NONE', 'ZERO', 'DATA'].includes(String(snapshotState))) {
    invalidDashboard();
  }
  if (!['NA', 'FRESH', 'STALE'].includes(String(freshnessState))) {
    invalidDashboard();
  }
  const coverage = value.coverage;
  if (snapshotState === 'NONE') {
    if (
      coverage !== null
      || value.revision !== null
      || freshnessState !== 'NA'
    ) invalidDashboard();
  } else if (
    !text(value.revision, 128)
    || !['FRESH', 'STALE'].includes(String(freshnessState))
    || !objectRecord(coverage)
    || !dateText(coverage.from)
    || !dateText(coverage.to)
    || coverage.from > coverage.to
    || !text(coverage.currency, 16)
    || (
      coverage.lastSuccessfulAt !== undefined
      && (
        !text(coverage.lastSuccessfulAt, 64)
        || !Number.isFinite(Date.parse(coverage.lastSuccessfulAt))
      )
    )
    || !Number.isSafeInteger(coverage.costScale)
    || Number(coverage.costScale) < 0
    || Number(coverage.costScale) > 12
  ) invalidDashboard();
  if (!exactMetrics(value.summary) || !exactTrend(value.trend)) {
    invalidDashboard();
  }
  const verifiedTrend = value.trend as AdDailyMetrics[];
  if (
    snapshotState !== 'NONE'
    && objectRecord(coverage)
    && (
      new Set(verifiedTrend.map((row) => row.date)).size !== verifiedTrend.length
      || verifiedTrend.some((row) => (
        row.date < String(coverage.from) || row.date > String(coverage.to)
      ))
    )
  ) invalidDashboard();
  const bindings = value.bindings;
  const campaigns = value.campaigns;
  const adGroups = value.adGroups;
  const keywords = value.keywords;
  const searchTerms = value.searchTerms;
  const lastRun = value.lastRun;
  if (
    !Array.isArray(bindings)
    || !bindings.every((row) => objectRecord(row)
      && text(row.accountId, 128) && text(row.accountName))
    || !Array.isArray(campaigns) || !campaigns.every(dashboardCampaign)
    || !Array.isArray(adGroups) || !adGroups.every(dashboardAdGroup)
    || !Array.isArray(keywords) || !keywords.every(dashboardKeyword)
    || !Array.isArray(searchTerms) || !searchTerms.every(dashboardSearchTerm)
    || !objectRecord(value.hierarchyCounts)
    || value.hierarchyCounts.campaigns !== campaigns.length
    || value.hierarchyCounts.adGroups !== adGroups.length
    || value.hierarchyCounts.keywords !== keywords.length
    || value.hierarchyCounts.searchTerms !== searchTerms.length
    || (
      lastRun !== undefined
      && lastRun !== null
      && (
        !objectRecord(lastRun)
        || !text(lastRun.runId, 128)
        || !text(lastRun.status, 32)
        || (
          lastRun.failureCode !== null
          && !text(lastRun.failureCode, 128)
        )
      )
    )
  ) invalidDashboard();
  if (!dashboardSemanticsValid(value as MarketingDashboardResponse)) {
    invalidDashboard();
  }
}

export function assertMarketingDashboardRootResponse(
  value: unknown,
  expectedProjectId: string
): asserts value is MarketingDashboardResponse {
  if (
    !objectRecord(value)
    || !text(value.projectId, 128)
    || value.projectId !== expectedProjectId
    || !objectRecord(value.states)
  ) invalidDashboard();
  const snapshotState = value.states.snapshotContentState;
  const freshnessState = value.states.snapshotFreshnessState;
  if (
    !['NONE', 'ZERO', 'DATA'].includes(String(snapshotState))
    || !['NA', 'FRESH', 'STALE'].includes(String(freshnessState))
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
    || (
      coverage.lastSuccessfulAt !== undefined
      && (
        !text(coverage.lastSuccessfulAt, 64)
        || !Number.isFinite(Date.parse(coverage.lastSuccessfulAt))
      )
    )
    || !Number.isSafeInteger(coverage.costScale)
    || Number(coverage.costScale) < 0
    || Number(coverage.costScale) > 12
    || !['FRESH', 'STALE'].includes(String(freshnessState))
  ) invalidDashboard();
  if (
    value.filter !== null
    && value.filter !== undefined
    && (
      !objectRecord(value.filter)
      || !dateText(value.filter.from)
      || !dateText(value.filter.to)
      || value.filter.from > value.filter.to
    )
  ) invalidDashboard();
  if (
    !exactMetrics(value.summary)
    || !exactTrend(value.trend)
    || !Array.isArray(value.bindings)
    || !value.bindings.every((row) => objectRecord(row)
      && text(row.accountId, 128) && text(row.accountName))
  ) invalidDashboard();
  if (!metricsEqual(sumMetrics(value.trend as AdDailyMetrics[]), value.summary)) {
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

function hierarchyKey(...parts: string[]): string {
  return parts.join('\u0000');
}

function appendGrouped<T>(map: Map<string, T[]>, key: string, row: T): void {
  const current = map.get(key);
  if (current) current.push(row);
  else map.set(key, [row]);
}

function targetingTypeLabel(value: DashboardKeyword['targetingType']): string {
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
  to: string
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
    currentTrend: [],
    previousTrend: [],
    structure: []
  };
}

export function adaptMarketingDashboard(
  dashboard: MarketingDashboardResponse,
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
    return emptyModel(dashboard, projectName, from, to);
  }

  const currentTrend = normalizeTrend(dashboard.trend);
  const campaigns = dashboard.campaigns || [];
  const adGroups = dashboard.adGroups || [];
  const keywords = dashboard.keywords || [];
  const adGroupsByCampaign = new Map<string, DashboardAdGroup[]>();
  const keywordsByAdGroup = new Map<string, DashboardKeyword[]>();
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
      ).map((keyword) => ({
        key: `keyword:${keyword.accountId}:${keyword.campaignId}:${keyword.adGroupId}:${keyword.keywordId}`,
        id: String(keyword.keywordId),
        name: keyword.keywordName,
        level: 'keyword',
        status: 'unknown',
        budgetAmountScaled: null,
        metrics: normalizeMetrics(keyword),
        currentTrend: normalizeTrend(keyword.trend),
        previousTrend: [],
        details: [
          { label: '关键词 ID', value: String(keyword.keywordId) },
          { label: '所属单元', value: keyword.adGroupName },
          {
            label: '定向类型',
            value: targetingTypeLabel(keyword.targetingType)
          },
          { label: '投放状态', value: '—', status: 'unknown' }
        ]
      }));
      return {
        key: `unit:${adGroup.accountId}:${adGroup.campaignId}:${adGroup.adGroupId}`,
        id: String(adGroup.adGroupId),
        name: adGroup.adGroupName,
        level: 'unit',
        status: 'unknown',
        budgetAmountScaled: null,
        metrics: normalizeMetrics(adGroup),
        currentTrend: normalizeTrend(adGroup.trend),
        previousTrend: [],
        details: [
          { label: '单元 ID', value: String(adGroup.adGroupId) },
          { label: '所属计划', value: campaign.campaignName },
          { label: '下属关键词数', value: String(keywordNodes.length) },
          { label: '投放状态', value: '—', status: 'unknown' }
        ],
        children: keywordNodes
      };
    });
    return {
      key: `scheme:${campaign.accountId}:${campaign.campaignId}`,
      id: String(campaign.campaignId),
      name: campaign.campaignName,
      level: 'scheme',
      status: 'unknown',
      budgetAmountScaled: null,
      metrics: normalizeMetrics(campaign),
      currentTrend: normalizeTrend(campaign.trend),
      previousTrend: [],
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
  const summary = normalizeMetrics(dashboard.summary);
  const projectNode: AdHierarchyNode = {
    key: `project:${dashboard.projectId}`,
    id: String(dashboard.projectId),
    name: projectName,
    level: 'project',
    status: projectStatus,
    budgetAmountScaled: null,
    metrics: summary,
    currentTrend,
    previousTrend: [],
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
    currentTrend,
    previousTrend: [],
    structure: [projectNode]
  };
}

export function adaptMarketingAdHierarchy(
  dashboard: MarketingDashboardResponse,
  hierarchy: MarketingAdHierarchyResponse | null,
  fallbackProjectName = '默认监控项目'
): AdPerformanceModel {
  return adaptMarketingDashboard({
    ...dashboard,
    summary: hierarchy?.summary || dashboard.summary,
    campaigns: hierarchy?.campaigns || [],
    adGroups: hierarchy?.adGroups || [],
    keywords: hierarchy?.keywords || [],
    searchTerms: []
  }, fallbackProjectName);
}
