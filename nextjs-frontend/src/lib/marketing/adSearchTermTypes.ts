export type AdSearchTermStatus = 'ADDED' | 'NOT_ADDED' | 'NOT_ADDABLE';

export type AdSearchTermRow = {
  key: string;
  accountId: string;
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  adGroupName: string;
  keywordName: string;
  searchTerm: string;
  queryStatus: AdSearchTermStatus;
  matchType: string;
  costAmountScaled: string;
  impressions: string;
  clicks: string;
  ctrPercent: number | null;
  averageCpc: number | null;
};

export type AdSearchTermSummary = {
  searchTermCount: string;
  costAmountScaled: string;
  impressions: string;
  clicks: string;
};

export type AdKeywordScope = {
  accountId: string;
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  adGroupName: string;
  keywordId: string;
  keywordName: string;
};

export type AdSearchTermFilter = {
  keywordEvidence: string;
  adGroupId: string;
  queryStatus: 'all' | AdSearchTermStatus;
  matchType: string;
  query: string;
};

export type AdSearchTermRangeModel = {
  source: 'dashboard' | 'development-fixture';
  dataState: 'ready' | 'empty';
  projectId: string;
  projectName: string;
  currency: string;
  costScale: number;
  updatedAt?: string;
  availableFrom: string;
  availableTo: string;
  range: { from: string; to: string };
  rows: AdSearchTermRow[];
  filterRows: AdSearchTermRow[];
  keywords: AdKeywordScope[];
  summary: AdSearchTermSummary;
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
};

export type AdSearchTermResourceSort =
  | 'searchTerm'
  | 'keywordName'
  | 'impressions'
  | 'clicks'
  | 'costAmountScaled'
  | 'ctr'
  | 'averageCpc';

export type AdSearchTermResourceQuery = {
  page: number;
  pageSize: number;
  sortBy: AdSearchTermResourceSort;
  sortOrder: 'ascend' | 'descend';
  query: string;
  adGroupId: string;
  keywordEvidence: string;
  queryStatus: 'all' | AdSearchTermStatus;
  matchType: string;
  scopeAccountId: string | null;
  scopeKeywordId: string | null;
  scopeRequired: boolean;
};

export type AdSearchTermAnalysisModel = {
  current: AdSearchTermRangeModel;
  previous: AdSearchTermRangeModel | null;
  previousRange: { from: string; to: string };
  previousUnavailableReason: string;
};
