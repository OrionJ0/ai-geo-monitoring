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
  DashboardSearchTerm,
  MarketingDashboardResponse
} from '@/lib/marketing/adPerformanceAdapter';

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
  searchTerms?: DashboardSearchTerm[];
};

export type KeywordAnalysisModel = Omit<
  KeywordAnalysisPayload,
  'facts'
> & {
  range: { from: string; to: string };
  rows: KeywordAnalysisRow[];
  coverage: KeywordCoverage;
  scatter: KeywordScatter;
};

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
    scatter: buildKeywordScatter(rows) as KeywordScatter
  };
}

export function adaptMarketingDashboardKeywords(
  dashboard: MarketingDashboardResponse,
  fallbackProjectName = '默认监控项目',
  requestedRange?: { from: string; to: string }
): KeywordAnalysisModel {
  const today = new Date().toISOString().slice(0, 10);
  const coverage = dashboard.coverage;
  const range = {
    from: dashboard.filter?.from
      || coverage?.from
      || requestedRange?.from
      || today,
    to: dashboard.filter?.to
      || coverage?.to
      || requestedRange?.to
      || today
  };
  const accountNames = new Map(
    (dashboard.bindings || []).map((binding) => [
      binding.accountId,
      binding.accountName
    ])
  );
  const projectName = dashboard.projectName || fallbackProjectName;
  return adaptKeywordAnalysis({
    source: 'keyword-report',
    dataState: (dashboard.keywords || []).length ? 'ready' : 'empty',
    projectId: String(dashboard.projectId),
    projectName,
    currency: coverage?.currency || 'CNY',
    costScale: coverage?.costScale ?? 2,
    availableFrom: coverage?.from || range.from,
    availableTo: coverage?.to || range.to,
    facts: (dashboard.keywords || []).map((keyword) => ({
      // Dashboard keyword rows are already aggregated for this exact range.
      // The range start is an internal bucket key, not a fabricated daily fact.
      date: range.from,
      accountId: keyword.accountId,
      accountName: accountNames.get(keyword.accountId) || keyword.accountId,
      projectId: String(dashboard.projectId),
      projectName,
      schemeId: keyword.campaignId,
      schemeName: keyword.campaignName,
      unitId: keyword.adGroupId,
      unitName: keyword.adGroupName,
      keywordId: keyword.keywordId,
      keyword: keyword.keywordName,
      tag: null,
      costAmountScaled: keyword.costAmountScaled,
      impressions: keyword.impressions,
      clicks: keyword.clicks
    })),
    searchTerms: dashboard.searchTerms || []
  }, range);
}
