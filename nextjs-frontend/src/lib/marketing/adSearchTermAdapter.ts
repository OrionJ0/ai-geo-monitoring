import type {
  AdKeywordScope,
  AdSearchTermRangeModel,
  AdSearchTermSummary
} from '@/lib/marketing/adSearchTermTypes';
import type {
  MarketingAdSearchTerm,
  MarketingDashboardResponse,
  MarketingSearchTermFilter,
  MarketingSearchTermResponse
} from '@/lib/marketing/generated/marketingAdReadApi';
import {
  buildAdSearchTermRows,
  buildAdSearchTermSummary
} from '@/utils/adSearchTerms.cjs';

export type AdSearchTermPayload = {
  source: AdSearchTermRangeModel['source'];
  dataState: AdSearchTermRangeModel['dataState'];
  projectId: string;
  projectName: string;
  currency: string;
  costScale: number;
  updatedAt?: string;
  availableFrom: string;
  availableTo: string;
  keywords: AdKeywordScope[];
  searchTerms: MarketingAdSearchTerm[];
};

export type MarketingSearchTermResourceResponse = MarketingSearchTermResponse;

function invalidResource(): never {
  const error = new TypeError('广告搜索词资源响应合同无效');
  (error as TypeError & { code: string }).code =
    'MARKETING_SEARCH_TERM_RESOURCE_RESPONSE_INVALID';
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

function decimalText(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/u.test(value);
}

function text(value: unknown, maximum = 1024): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function resourceItem(value: unknown): value is MarketingAdSearchTerm {
  if (!record(value) || Object.hasOwn(value, 'keywordId')) return false;
  return text(value.accountId, 512)
    && text(value.campaignId, 512)
    && text(value.campaignName, 512)
    && text(value.adGroupId, 512)
    && text(value.adGroupName, 512)
    && text(value.keywordName, 512)
    && text(value.searchTerm)
    && ['ADDED', 'NOT_ADDED', 'NOT_ADDABLE'].includes(String(value.queryStatus))
    && text(value.matchType, 40)
    && decimalText(value.impressions)
    && decimalText(value.clicks)
    && decimalText(value.costAmountScaled);
}

function exactFilter(
  value: Record<string, unknown>,
  expected: MarketingSearchTermFilter
): boolean {
  const fields = [
    'from',
    'to',
    'query',
    'accountId',
    'campaignId',
    'adGroupId',
    'keywordName',
    'queryStatus',
    'matchType'
  ] as const;
  return Object.keys(value).every((field) => fields.includes(field as typeof fields[number]))
    && fields.every((field) => value[field] === expected[field]);
}

export function assertMarketingSearchTermResourceResponse(
  value: unknown,
  expectedProjectId: string,
  expectedRevision: string,
  expectedFilter: MarketingSearchTermFilter
): asserts value is MarketingSearchTermResourceResponse {
  if (!record(value)) invalidResource();
  const coverage = value.coverage;
  const filter = value.filter;
  const summary = value.summary;
  const pagination = value.pagination;
  if (
    value.schemaVersion !== 'marketing_search_terms_v1'
    || value.projectId !== expectedProjectId
    || value.revision !== expectedRevision
    || !record(coverage)
    || !dateText(coverage.from)
    || !dateText(coverage.to)
    || coverage.from > coverage.to
    || !text(coverage.currency, 16)
    || !Number.isSafeInteger(coverage.costScale)
    || Number(coverage.costScale) < 0
    || Number(coverage.costScale) > 12
    || !record(filter)
    || !exactFilter(filter, expectedFilter)
    || !record(summary)
    || !decimalText(summary.impressions)
    || !decimalText(summary.clicks)
    || !decimalText(summary.costAmountScaled)
    || !Array.isArray(value.items)
    || !value.items.every(resourceItem)
    || !record(pagination)
    || !Number.isSafeInteger(pagination.page)
    || Number(pagination.page) < 1
    || !Number.isSafeInteger(pagination.pageSize)
    || Number(pagination.pageSize) < 1
    || !Number.isSafeInteger(pagination.totalItems)
    || Number(pagination.totalItems) < 0
    || !Number.isSafeInteger(pagination.totalPages)
    || Number(pagination.totalPages) < 0
    || value.items.length > Number(pagination.pageSize)
  ) invalidResource();
}

export function adaptAdSearchTermPayload(
  payload: AdSearchTermPayload,
  range: { from: string; to: string }
): AdSearchTermRangeModel {
  const rows = buildAdSearchTermRows(payload.searchTerms, payload.costScale);
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
    filterRows: rows,
    keywords: payload.keywords,
    summary: buildAdSearchTermSummary(rows),
    pagination: {
      page: 1,
      pageSize: Math.max(rows.length, 1),
      totalItems: rows.length,
      totalPages: rows.length ? 1 : 0
    }
  };
}

export function adaptMarketingSearchTermResource(
  resource: MarketingSearchTermResourceResponse,
  dashboard: MarketingDashboardResponse,
  fallbackProjectName = '默认监控项目'
): AdSearchTermRangeModel {
  const rows = buildAdSearchTermRows(resource.items, resource.coverage.costScale);
  const summary: AdSearchTermSummary = {
    searchTermCount: String(resource.pagination.totalItems),
    costAmountScaled: BigInt(resource.summary.costAmountScaled).toString(),
    impressions: BigInt(resource.summary.impressions).toString(),
    clicks: BigInt(resource.summary.clicks).toString()
  };
  return {
    source: 'dashboard',
    dataState: resource.pagination.totalItems ? 'ready' : 'empty',
    projectId: resource.projectId,
    projectName: dashboard.projectName || fallbackProjectName,
    currency: resource.coverage.currency,
    costScale: resource.coverage.costScale,
    updatedAt: resource.coverage.lastSuccessfulAt,
    availableFrom: resource.coverage.from,
    availableTo: resource.coverage.to,
    range: resource.filter,
    rows,
    filterRows: rows,
    keywords: [],
    summary,
    pagination: resource.pagination
  };
}
