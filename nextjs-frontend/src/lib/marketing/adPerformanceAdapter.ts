export type AdHierarchyLevel = 'project' | 'scheme' | 'unit';

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

type DashboardCampaign = AdExactMetrics & {
  accountId: string;
  campaignId: string;
  campaignName: string;
};

export type MarketingDashboardResponse = {
  projectId: string;
  projectName?: string;
  states?: {
    projectState?: string;
    snapshotContentState?: string;
  };
  coverage: {
    from: string;
    to: string;
    currency: string;
    costScale: number;
  } | null;
  filter?: {
    from: string;
    to: string;
  } | null;
  summary?: Partial<AdExactMetrics>;
  trend?: Array<Partial<AdDailyMetrics> & { date: string }>;
  campaigns?: DashboardCampaign[];
};

const EMPTY_METRICS: AdExactMetrics = Object.freeze({
  costAmountScaled: '0',
  impressions: '0',
  clicks: '0'
});

function decimalText(value: unknown): string {
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) return '0';
  return BigInt(value).toString();
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
  const projectStatus: AdDeliveryStatus = (
    dashboard.states?.projectState === 'ACTIVE' ? 'active' : 'unknown'
  );
  const schemeNodes: AdHierarchyNode[] = campaigns.map((campaign) => ({
    key: `scheme:${campaign.accountId}:${campaign.campaignId}`,
    id: String(campaign.campaignId),
    name: campaign.campaignName,
    level: 'scheme',
    status: 'unknown',
    budgetAmountScaled: null,
    metrics: normalizeMetrics(campaign),
    currentTrend: [],
    previousTrend: [],
    details: [
      { label: '方案 ID', value: String(campaign.campaignId) },
      { label: '所属项目', value: projectName },
      { label: '投放设备', value: '—' },
      { label: '投放地域', value: '—' },
      { label: '出价策略', value: '—' },
      { label: '周期预算', value: '—' },
      { label: '投放状态', value: '—', status: 'unknown' }
    ]
  }));
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
      { label: '优化目标', value: '—' },
      { label: '项目预算', value: '—' },
      { label: '下属方案数', value: String(schemeNodes.length) },
      {
        label: '投放状态',
        value: projectStatus === 'active' ? '投放中' : '—',
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
