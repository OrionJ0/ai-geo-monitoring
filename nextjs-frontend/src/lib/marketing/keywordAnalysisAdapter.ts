import type {
  KeywordCoverage,
  KeywordDailyFact,
  KeywordAnalysisRow,
  KeywordScatter,
  KeywordTag
} from '@/lib/marketing/keywordAnalysisTypes';
import {
  aggregateKeywordFacts,
  attachKeywordSearchTermEvidence,
  buildKeywordCoverage,
  buildKeywordScatter,
  explicitKeywordTagStrategy
} from '@/utils/keywordAnalysis.cjs';
import type {
  MarketingAdKeyword,
  MarketingAdSearchTerm,
  MarketingDailyMetrics,
  MarketingDashboardResponse,
  MarketingKeywordResponse
} from '@/lib/marketing/generated/marketingAdReadApi';

export type KeywordAnalysisPayload = {
  source: 'keyword-report' | 'development-fixture';
  dataState: 'ready' | 'empty';
  projectId: string;
  projectName: string;
  currency: string;
  costScale: number;
  updatedAt?: string;
  availableFrom: string;
  availableTo: string;
  facts: KeywordDailyFact[];
  searchTerms?: MarketingAdSearchTerm[];
};

export type KeywordAnalysisModel = Omit<
  KeywordAnalysisPayload,
  'facts'
> & {
  range: { from: string; to: string };
  rows: KeywordAnalysisRow[];
  coverage: KeywordCoverage;
  scatter: KeywordScatter;
  summary: {
    impressions: string;
    clicks: string;
    costAmountScaled: string;
  };
  previousState: 'READY' | 'PENDING' | 'UNAVAILABLE' | 'ERROR';
  previousSummary: {
    impressions: string;
    clicks: string;
    costAmountScaled: string;
  } | null;
  previousTotalItems: number | null;
  previousUnavailableReason: string;
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
};

export type MarketingKeywordResourceResponse = MarketingKeywordResponse;

export type KeywordPreviousResourceResult =
  | {
      state: 'READY';
      resource: MarketingKeywordResourceResponse;
      reason: '';
    }
  | {
      state: 'PENDING' | 'UNAVAILABLE' | 'ERROR';
      resource: null;
      reason: string;
    };

export function classifyKeywordPreviousError(
  error: unknown
): KeywordPreviousResourceResult {
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
      resource: null,
      reason: message || '上一周期超出关键词快照覆盖范围。'
    };
  }
  return {
    state: 'ERROR',
    resource: null,
    reason: message || '上一周期关键词数据读取失败，请重试。'
  };
}

function invalidKeywordResource(): never {
  const error = new TypeError('广告关键词资源响应合同无效');
  (error as TypeError & { code: string }).code =
    'MARKETING_KEYWORD_RESOURCE_RESPONSE_INVALID';
  throw error;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function dateText(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

function text(value: unknown, maximum = 512): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function decimalText(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/u.test(value);
}

function keywordItem(
  value: unknown,
  range: { from: string; to: string }
): value is MarketingAdKeyword {
  if (!record(value)) return false;
  const valid = text(value.accountId)
    && text(value.campaignId)
    && text(value.campaignName)
    && text(value.adGroupId)
    && text(value.adGroupName)
    && text(value.keywordId)
    && text(value.keywordName)
    && ['KEYWORD', 'WORD_PACKAGE', 'AUTO_EXPANSION']
      .includes(String(value.targetingType))
    && decimalText(value.impressions)
    && decimalText(value.clicks)
    && decimalText(value.costAmountScaled)
    && Array.isArray(value.trend)
    && value.trend.every((point) => record(point)
      && dateText(point.date)
      && point.date >= range.from
      && point.date <= range.to
      && decimalText(point.impressions)
      && decimalText(point.clicks)
      && decimalText(point.costAmountScaled));
  if (!valid) return false;
  const trend = value.trend as MarketingDailyMetrics[];
  if (new Set(trend.map((point) => point.date)).size !== trend.length) return false;
  const total = trend.reduce((sum, point) => ({
    impressions: sum.impressions + BigInt(point.impressions),
    clicks: sum.clicks + BigInt(point.clicks),
    costAmountScaled: sum.costAmountScaled + BigInt(point.costAmountScaled)
  }), {
    impressions: BigInt(0),
    clicks: BigInt(0),
    costAmountScaled: BigInt(0)
  });
  return total.impressions.toString() === value.impressions
    && total.clicks.toString() === value.clicks
    && total.costAmountScaled.toString() === value.costAmountScaled;
}

export function assertMarketingKeywordResourceResponse(
  value: unknown,
  expectedProjectId: string,
  expectedRevision: string,
  expectedRange: { from: string; to: string },
  expectedCoverage?: NonNullable<MarketingDashboardResponse['coverage']>,
  expectedBusinessFilter: {
    query?: string;
    campaignId?: string;
    adGroupId?: string;
  } = {}
): asserts value is MarketingKeywordResourceResponse {
  if (!record(value)) invalidKeywordResource();
  const coverage = value.coverage;
  const filter = value.filter;
  const summary = value.summary;
  const pagination = value.pagination;
  if (
    value.schemaVersion !== 'marketing_keywords_v1'
    || value.projectId !== expectedProjectId
    || value.revision !== expectedRevision
    || !record(coverage)
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
    || (
      expectedCoverage !== undefined
      && (
        coverage.from !== expectedCoverage.from
        || coverage.to !== expectedCoverage.to
        || coverage.currency !== expectedCoverage.currency
        || coverage.costScale !== expectedCoverage.costScale
        || coverage.lastSuccessfulAt !== expectedCoverage.lastSuccessfulAt
      )
    )
    || !record(filter)
    || filter.from !== expectedRange.from
    || filter.to !== expectedRange.to
    || filter.query !== expectedBusinessFilter.query
    || filter.campaignId !== expectedBusinessFilter.campaignId
    || filter.adGroupId !== expectedBusinessFilter.adGroupId
    || !record(summary)
    || !decimalText(summary.impressions)
    || !decimalText(summary.clicks)
    || !decimalText(summary.costAmountScaled)
    || !Array.isArray(value.items)
    || !value.items.every((item) => keywordItem(item, expectedRange))
    || !record(pagination)
    || !Number.isSafeInteger(pagination.page)
    || Number(pagination.page) < 1
    || !Number.isSafeInteger(pagination.pageSize)
    || Number(pagination.pageSize) < 1
    || Number(pagination.pageSize) > 200
    || !Number.isSafeInteger(pagination.totalItems)
    || Number(pagination.totalItems) < 0
    || !Number.isSafeInteger(pagination.totalPages)
    || Number(pagination.totalPages) < 0
    || Number(pagination.totalPages) !== (
      Number(pagination.totalItems) === 0
        ? 0
        : Math.ceil(Number(pagination.totalItems) / Number(pagination.pageSize))
    )
    || value.items.length > Number(pagination.pageSize)
  ) invalidKeywordResource();
}

function sumRows(rows: KeywordAnalysisRow[]) {
  return rows.reduce((total, row) => ({
    impressions: (BigInt(total.impressions) + BigInt(row.impressions)).toString(),
    clicks: (BigInt(total.clicks) + BigInt(row.clicks)).toString(),
    costAmountScaled: (
      BigInt(total.costAmountScaled) + BigInt(row.costAmountScaled)
    ).toString()
  }), { impressions: '0', clicks: '0', costAmountScaled: '0' });
}

export interface KeywordTagStrategy {
  resolve(fact: Partial<KeywordDailyFact>): KeywordTag | null;
}

export interface KeywordAnalysisDataAdapter {
  read(options: {
    projectId: string;
    from: string;
    to: string;
  }): Promise<KeywordAnalysisPayload>;
}

export const sourceProvidedKeywordTagStrategy: KeywordTagStrategy = {
  resolve: explicitKeywordTagStrategy
};

export function adaptKeywordAnalysis(
  payload: KeywordAnalysisPayload,
  range: { from: string; to: string },
  tagStrategy: KeywordTagStrategy = sourceProvidedKeywordTagStrategy
): KeywordAnalysisModel {
  const rows = attachKeywordSearchTermEvidence(aggregateKeywordFacts(payload.facts, {
    ...range,
    costScale: payload.costScale,
    tagStrategy: (fact: Partial<KeywordDailyFact>) => tagStrategy.resolve(fact)
  }), payload.searchTerms || []) as KeywordAnalysisRow[];
  return {
    source: payload.source,
    dataState: rows.length ? payload.dataState : 'empty',
    projectId: payload.projectId,
    projectName: payload.projectName,
    currency: payload.currency,
    costScale: payload.costScale,
    updatedAt: payload.updatedAt,
    availableFrom: payload.availableFrom,
    availableTo: payload.availableTo,
    range,
    rows,
    coverage: buildKeywordCoverage(rows),
    scatter: buildKeywordScatter(rows) as KeywordScatter,
    summary: sumRows(rows),
    previousState: 'UNAVAILABLE',
    previousSummary: null,
    previousTotalItems: null,
    previousUnavailableReason: '开发数据未提供上一周期关键词。',
    pagination: {
      page: 1,
      pageSize: Math.max(rows.length, 1),
      totalItems: rows.length,
      totalPages: rows.length ? 1 : 0
    }
  };
}

export function adaptMarketingKeywordResource(
  resource: MarketingKeywordResourceResponse,
  dashboard: MarketingDashboardResponse,
  previous: KeywordPreviousResourceResult,
  fallbackProjectName = '默认监控项目'
): KeywordAnalysisModel {
  const accountNames = new Map(
    (dashboard.bindings || []).map((binding) => [
      binding.accountId,
      binding.accountName
    ])
  );
  const projectName = dashboard.projectName || fallbackProjectName;
  const model = adaptKeywordAnalysis({
    source: 'keyword-report',
    dataState: resource.pagination.totalItems ? 'ready' : 'empty',
    projectId: resource.projectId,
    projectName,
    currency: resource.coverage.currency,
    costScale: resource.coverage.costScale,
    updatedAt: resource.coverage.lastSuccessfulAt,
    availableFrom: resource.coverage.from,
    availableTo: resource.coverage.to,
    facts: resource.items.flatMap((keyword) => keyword.trend.map((point) => ({
      date: point.date,
      accountId: keyword.accountId,
      accountName: accountNames.get(keyword.accountId) || keyword.accountId,
      projectId: resource.projectId,
      projectName,
      schemeId: keyword.campaignId,
      schemeName: keyword.campaignName,
      unitId: keyword.adGroupId,
      unitName: keyword.adGroupName,
      keywordId: keyword.keywordId,
      keyword: keyword.keywordName,
      tag: null,
      costAmountScaled: point.costAmountScaled,
      impressions: point.impressions,
      clicks: point.clicks
    })))
  }, resource.filter);
  return {
    ...model,
    dataState: resource.pagination.totalItems ? 'ready' : 'empty',
    summary: {
      impressions: BigInt(resource.summary.impressions).toString(),
      clicks: BigInt(resource.summary.clicks).toString(),
      costAmountScaled: BigInt(resource.summary.costAmountScaled).toString()
    },
    previousState: previous.state,
    previousSummary: previous.state === 'READY'
      ? {
          impressions: BigInt(previous.resource.summary.impressions).toString(),
          clicks: BigInt(previous.resource.summary.clicks).toString(),
          costAmountScaled: BigInt(
            previous.resource.summary.costAmountScaled
          ).toString()
        }
      : null,
    previousTotalItems: previous.state === 'READY'
      ? previous.resource.pagination.totalItems
      : null,
    previousUnavailableReason: previous.reason,
    pagination: resource.pagination
  };
}
