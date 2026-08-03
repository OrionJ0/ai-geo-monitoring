export type WebsiteDevice = 'all' | 'pc' | 'mobile';
export type WebsiteSourceKey =
  | 'ALL'
  | 'BAIDU_SEARCH'
  | 'DIRECT'
  | 'BING_SEARCH'
  | 'OTHER';
export type WebsiteMetric =
  | 'visits'
  | 'visitors'
  | 'pageviews'
  | 'bounceRate'
  | 'averageVisitTime'
  | 'averageVisitPages';
export type WebsitePageView = 'landing' | 'visited';

export type CountComparison = {
  current: string | null;
  previous: string | null;
  changePercent: string | null;
};

export type WebsiteTrafficOverview = {
  projectId: string;
  source: 'BAIDU_TONGJI';
  mode: 'DATABASE_RANGE_SNAPSHOT';
  site: { domain: string };
  device: WebsiteDevice;
  coverage: { from: string; to: string };
  previousCoverage: { from: string; to: string };
  selectedSource: {
    sourceKey: WebsiteSourceKey;
    sourceLabel: string;
  };
  selectedMetric: WebsiteMetric;
  selectedMetricState: 'DATA' | 'NO_DATA' | 'UNAVAILABLE';
  dataState: 'DATA' | 'NO_DATA';
  summary: {
    visits: CountComparison;
    visitors: CountComparison;
    pageviews: CountComparison;
    bounceRate: {
      current: string | null;
      previous: string | null;
      changePoints: string | null;
    };
    averageVisitTime: {
      current: string | null;
      previous: string | null;
      changeSeconds: string | null;
    };
    averageVisitPages: {
      current: string | null;
      previous: string | null;
      changePages: string | null;
    };
  };
  trend: Array<{
    date: string;
    previousDate: string;
    current: string | null;
    previous: string | null;
  }>;
  sourceQuality: {
    allSiteBounceRate: string | null;
    rows: Array<{
      sourceKey: Exclude<WebsiteSourceKey, 'ALL'>;
      sourceLabel: string;
      visits: string | null;
      trafficShare: string | null;
      bounceRate: string | null;
      averageVisitTime: string | null;
      averageVisitPages: string | null;
      dataState: 'DATA' | 'NO_DATA';
    }>;
  };
  capabilities: {
    trafficCounts: boolean;
    sourceTraffic: boolean;
    qualityMetrics: boolean;
    pageReports: boolean;
    sourcePageCorrelation: boolean;
    unavailableReason: string;
  };
  cache: {
    state: 'HIT' | 'REFRESHED' | 'FALLBACK';
  };
};

export type WebsitePageRow = {
  key: string;
  pageId: string;
  title: string | null;
  path: string;
  visits?: string | null;
  contributionPageviews?: string | null;
  bounceRate?: string | null;
  averageVisitTime?: string | null;
  averageVisitPages?: string | null;
  pageviews?: string | null;
  visitors?: string | null;
  averageStayTime?: string | null;
  downstreamPageviews?: string | null;
  exitRate?: string | null;
};

export type WebsitePageReport = {
  projectId: string;
  source: 'BAIDU_TONGJI';
  device: WebsiteDevice;
  coverage: { from: string; to: string };
  view: WebsitePageView;
  dataState: 'DATA' | 'NO_DATA' | 'UNAVAILABLE';
  rows: WebsitePageRow[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number | null;
    totalPages: number | null;
  };
  sort: { field: string; order: 'ascend' | 'descend' };
  query: string;
  scope: { source: 'ALL'; label: '全部来源' };
  dataQuality: { excludedCrossDomainRows: number | null };
  capabilities: WebsiteTrafficOverview['capabilities'];
};

function invalidWebsiteTraffic(): never {
  const error = new TypeError('网站流量响应合同无效');
  (error as TypeError & { code: string }).code =
    'WEBSITE_TRAFFIC_RESPONSE_INVALID';
  throw error;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, nullable = false): boolean {
  return (nullable && value === null)
    || (typeof value === 'string' && value.length > 0 && value.length <= 1024);
}

function metric(value: unknown, nullable = true): boolean {
  return (nullable && value === null)
    || (typeof value === 'string'
      && /^-?\d+(?:\.\d+)?$/u.test(value)
      && value.length <= 64);
}

function coverage(value: unknown, from: string, to: string): boolean {
  return record(value) && value.from === from && value.to === to;
}

function capabilities(value: unknown): boolean {
  return record(value)
    && [
      'trafficCounts',
      'sourceTraffic',
      'qualityMetrics',
      'pageReports',
      'sourcePageCorrelation'
    ].every((key) => typeof value[key] === 'boolean')
    && typeof value.unavailableReason === 'string';
}

function comparison(value: unknown, changeKey: string): boolean {
  return record(value)
    && metric(value.current)
    && metric(value.previous)
    && metric(value[changeKey]);
}

export function assertWebsiteTrafficOverview(
  value: unknown,
  query: {
    projectId: string;
    device: WebsiteDevice;
    from: string;
    to: string;
    source: WebsiteSourceKey;
    metric: WebsiteMetric;
  }
): asserts value is WebsiteTrafficOverview {
  if (!record(value)) invalidWebsiteTraffic();
  const summary = value.summary;
  const selectedSource = value.selectedSource;
  const sourceQuality = value.sourceQuality;
  const responseCapabilities = value.capabilities;
  if (
    String(value.projectId) !== query.projectId
    || value.source !== 'BAIDU_TONGJI'
    || value.mode !== 'DATABASE_RANGE_SNAPSHOT'
    || value.device !== query.device
    || !coverage(value.coverage, query.from, query.to)
    || !record(selectedSource) || selectedSource.sourceKey !== query.source
    || value.selectedMetric !== query.metric
    || !['DATA', 'NO_DATA', 'UNAVAILABLE'].includes(String(value.selectedMetricState))
    || !['DATA', 'NO_DATA'].includes(String(value.dataState))
    || !record(summary)
    || !comparison(summary.visits, 'changePercent')
    || !comparison(summary.visitors, 'changePercent')
    || !comparison(summary.pageviews, 'changePercent')
    || !comparison(summary.bounceRate, 'changePoints')
    || !comparison(summary.averageVisitTime, 'changeSeconds')
    || !comparison(summary.averageVisitPages, 'changePages')
    || !Array.isArray(value.trend)
    || !value.trend.every((row) => record(row)
      && text(row.date) && text(row.previousDate)
      && metric(row.current) && metric(row.previous))
    || !record(sourceQuality)
    || !metric(sourceQuality.allSiteBounceRate)
    || !Array.isArray(sourceQuality.rows)
    || !sourceQuality.rows.every((row) => record(row)
      && ['BAIDU_SEARCH', 'DIRECT', 'BING_SEARCH', 'OTHER']
        .includes(String(row.sourceKey))
      && text(row.sourceLabel)
      && metric(row.visits)
      && metric(row.trafficShare)
      && metric(row.bounceRate)
      && metric(row.averageVisitTime)
      && metric(row.averageVisitPages)
      && ['DATA', 'NO_DATA'].includes(String(row.dataState)))
    || !capabilities(responseCapabilities)
    || !record(value.cache)
    || !['HIT', 'REFRESHED', 'FALLBACK'].includes(String(value.cache.state))
  ) invalidWebsiteTraffic();
  if (!record(responseCapabilities)) invalidWebsiteTraffic();
  const typedSummary = summary as WebsiteTrafficOverview['summary'];
  const typedSourceQuality = sourceQuality as WebsiteTrafficOverview['sourceQuality'];
  if (
    responseCapabilities.sourcePageCorrelation === false
    && typedSourceQuality.rows.some((row) => (
      row.bounceRate !== null
      || row.averageVisitTime !== null
      || row.averageVisitPages !== null
    ))
  ) invalidWebsiteTraffic();
  if (
    responseCapabilities.qualityMetrics === false
    && (
      typedSourceQuality.allSiteBounceRate !== null
      || typedSummary.bounceRate.current !== null
      || typedSummary.bounceRate.previous !== null
      || typedSummary.bounceRate.changePoints !== null
      || typedSummary.averageVisitTime.current !== null
      || typedSummary.averageVisitTime.previous !== null
      || typedSummary.averageVisitTime.changeSeconds !== null
      || typedSummary.averageVisitPages.current !== null
      || typedSummary.averageVisitPages.previous !== null
      || typedSummary.averageVisitPages.changePages !== null
    )
  ) invalidWebsiteTraffic();
}

const LANDING_FIELDS = new Set([
  'visits',
  'contributionPageviews',
  'bounceRate',
  'averageVisitTime',
  'averageVisitPages'
]);

const VISITED_FIELDS = new Set([
  'pageviews',
  'visitors',
  'averageStayTime',
  'downstreamPageviews',
  'exitRate'
]);

function exactPageRow(value: unknown, view: WebsitePageView): boolean {
  if (!record(value)) return false;
  const required = view === 'landing' ? LANDING_FIELDS : VISITED_FIELDS;
  const forbidden = view === 'landing' ? VISITED_FIELDS : LANDING_FIELDS;
  return typeof value.pageId === 'string'
    && /^\d+$/u.test(value.pageId)
    && value.key === `baidu-page:${value.pageId}`
    && value.title === null
    && typeof value.path === 'string'
    && /^\/(?!\/)[^\r\n]{0,2047}$/u.test(value.path)
    && [...required].every((field) => (
      Object.prototype.hasOwnProperty.call(value, field) && metric(value[field])
    ))
    && [...forbidden].every((field) => (
      !Object.prototype.hasOwnProperty.call(value, field)
    ));
}

export function assertWebsitePageReport(
  value: unknown,
  query: {
    projectId: string;
    device: WebsiteDevice;
    from: string;
    to: string;
    view: WebsitePageView;
    page: number;
    pageSize: number;
    sortBy: string;
    sortOrder: 'ascend' | 'descend';
    query: string;
  }
): asserts value is WebsitePageReport {
  if (!record(value)) invalidWebsiteTraffic();
  const pagination = value.pagination;
  const responseCapabilities = value.capabilities;
  const sort = value.sort;
  const scope = value.scope;
  const dataQuality = value.dataQuality;
  if (
    String(value.projectId) !== query.projectId
    || value.source !== 'BAIDU_TONGJI'
    || value.device !== query.device
    || !coverage(value.coverage, query.from, query.to)
    || value.view !== query.view
    || !['DATA', 'NO_DATA', 'UNAVAILABLE'].includes(String(value.dataState))
    || !Array.isArray(value.rows)
    || !value.rows.every((row) => exactPageRow(row, query.view))
    || !record(pagination)
    || pagination.page !== query.page
    || pagination.pageSize !== query.pageSize
    || !(pagination.totalItems === null
      || (Number.isSafeInteger(pagination.totalItems)
        && Number(pagination.totalItems) >= 0))
    || !(pagination.totalPages === null
      || (Number.isSafeInteger(pagination.totalPages)
        && Number(pagination.totalPages) >= 0))
    || !record(sort)
    || sort.field !== query.sortBy
    || sort.order !== query.sortOrder
    || value.query !== query.query.trim()
    || !record(scope)
    || scope.source !== 'ALL'
    || scope.label !== '全部来源'
    || !record(dataQuality)
    || !(dataQuality.excludedCrossDomainRows === null
      || (Number.isSafeInteger(dataQuality.excludedCrossDomainRows)
        && Number(dataQuality.excludedCrossDomainRows) >= 0))
    || !capabilities(responseCapabilities)
  ) invalidWebsiteTraffic();
  if (!record(responseCapabilities)) invalidWebsiteTraffic();
  const totalItems = pagination.totalItems as number | null;
  const totalPages = pagination.totalPages as number | null;
  const expectedRows = totalItems === null
    ? null
    : Math.min(
        query.pageSize,
        Math.max(totalItems - ((query.page - 1) * query.pageSize), 0)
      );
  if (
    value.rows.length > query.pageSize
    || (totalItems !== null && totalPages !== Math.ceil(totalItems / query.pageSize))
    || (expectedRows !== null && value.rows.length !== expectedRows)
    || (value.dataState === 'DATA' && totalItems === 0)
    || (value.dataState === 'NO_DATA' && totalItems !== 0)
  ) invalidWebsiteTraffic();
  if (
    responseCapabilities.pageReports === false
    && (
      value.dataState !== 'UNAVAILABLE'
      || value.rows.length !== 0
      || totalItems !== null
      || totalPages !== null
      || dataQuality.excludedCrossDomainRows !== null
    )
  ) invalidWebsiteTraffic();
  if (
    responseCapabilities.pageReports === true
    && (
      value.dataState === 'UNAVAILABLE'
      || totalItems === null
      || totalPages === null
      || dataQuality.excludedCrossDomainRows === null
    )
  ) invalidWebsiteTraffic();
}
