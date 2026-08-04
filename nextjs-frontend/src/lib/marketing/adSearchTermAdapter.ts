import type {
  AdKeywordScope,
  AdSearchTermRangeModel
} from '@/lib/marketing/adSearchTermTypes';
import type {
  DashboardKeyword,
  DashboardSearchTerm,
  MarketingDashboardResponse
} from '@/lib/marketing/adPerformanceAdapter';
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
  searchTerms: DashboardSearchTerm[];
};

function keywordScope(keyword: DashboardKeyword): AdKeywordScope {
  return {
    accountId: keyword.accountId,
    campaignId: keyword.campaignId,
    campaignName: keyword.campaignName,
    adGroupId: keyword.adGroupId,
    adGroupName: keyword.adGroupName,
    keywordId: keyword.keywordId,
    keywordName: keyword.keywordName
  };
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
    keywords: payload.keywords,
    summary: buildAdSearchTermSummary(rows)
  };
}

export function adaptMarketingDashboardSearchTerms(
  dashboard: MarketingDashboardResponse,
  fallbackProjectName = '默认监控项目',
  requestedRange?: { from: string; to: string }
): AdSearchTermRangeModel {
  const today = new Date().toISOString().slice(0, 10);
  const coverage = dashboard.coverage;
  const range = {
    from: dashboard.filter?.from
      || requestedRange?.from
      || coverage?.from
      || today,
    to: dashboard.filter?.to
      || requestedRange?.to
      || coverage?.to
      || today
  };
  return adaptAdSearchTermPayload({
    source: 'dashboard',
    dataState: (dashboard.searchTerms || []).length ? 'ready' : 'empty',
    projectId: String(dashboard.projectId),
    projectName: dashboard.projectName || fallbackProjectName,
    currency: coverage?.currency || 'CNY',
    costScale: coverage?.costScale ?? 2,
    updatedAt: coverage?.lastSuccessfulAt,
    availableFrom: coverage?.from || range.from,
    availableTo: coverage?.to || range.to,
    keywords: (dashboard.keywords || []).map(keywordScope),
    searchTerms: dashboard.searchTerms || []
  }, range);
}
