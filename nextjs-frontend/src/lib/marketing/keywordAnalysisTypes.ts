export type KeywordTag = '优先加投' | '稳健保持' | '控制浪费' | '样本不足';

export type KeywordDailyFact = {
  date: string;
  accountId: string;
  accountName: string;
  projectId: string;
  projectName: string;
  schemeId: string;
  schemeName: string;
  unitId: string;
  unitName: string;
  keywordId: string;
  keyword: string;
  tag: KeywordTag | null;
  costAmountScaled: string;
  impressions: string;
  clicks: string;
};

export type KeywordAggregateRow = Omit<KeywordDailyFact, 'date'> & {
  key: string;
  ctrPercent: number | null;
  averageCpc: number | null;
  path: string;
};

export type KeywordSearchTermEvidence = {
  searchTerm: string;
  queryStatus: 'ADDED' | 'NOT_ADDED' | 'NOT_ADDABLE';
  matchType: string;
  costAmountScaled: string;
  impressions: string;
  clicks: string;
};

export type KeywordAnalysisRow = KeywordAggregateRow & {
  matchedSearchTerms: KeywordSearchTermEvidence[];
};

export type KeywordCoverage = {
  impressionKeywordCount: number;
  clickedKeywordCount: number;
  clickCoverageRate: number | null;
  unclickedKeywordCount: number;
};

export type KeywordScatterPoint = {
  key: string;
  keyword: string;
  tag: KeywordTag | null;
  path: string;
  costAmountScaled: string;
  impressions: string;
  clicks: number;
  ctrPercent: number;
  averageCpc: number;
};

export type KeywordScatter = {
  points: KeywordScatterPoint[];
  medianCtrPercent: number | null;
  medianAverageCpc: number | null;
};

export type KeywordActionDistribution = {
  items: Array<{ tag: KeywordTag; count: number }>;
  taggedTotal: number;
  unclassifiedCount: number;
  total: number;
};

export type KeywordBenchmark = {
  ctrPercent: number | null;
  averageCpc: number | null;
};

export type KeywordStageFilter = 'all' | 'impressions' | 'clicked' | 'unclicked';
export type KeywordMoreFilter = 'all' | 'with-cost' | 'plottable';
export type KeywordCostRange = 'all' | 'zero' | 'under-10000' | '10000-50000' | 'over-50000';
export type KeywordAnomaly = 'all' | 'high-ctr-low-cpc' | 'low-ctr-high-cpc' | 'high-ctr-high-cpc' | 'low-ctr-low-cpc';
