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

export const KEYWORD_TAGS: readonly KeywordTag[];
export function keywordEntityKey(fact: Partial<KeywordDailyFact>): string;
export function explicitKeywordTagStrategy(
  fact: Partial<KeywordDailyFact>
): KeywordTag | null;
export function aggregateKeywordFacts(
  facts: KeywordDailyFact[],
  options: {
    from: string;
    to: string;
    costScale?: number;
    tagStrategy?: (
      fact: Partial<KeywordDailyFact>
    ) => KeywordTag | null;
  }
): KeywordAggregateRow[];
export function attachKeywordSearchTermEvidence<
  T extends Pick<
    KeywordAggregateRow,
    'accountId' | 'schemeId' | 'unitId' | 'keyword'
  >
>(
  rows: T[],
  searchTerms: Array<{
    accountId: string;
    campaignId: string;
    adGroupId: string;
    keywordName: string;
    searchTerm: string;
    queryStatus: KeywordSearchTermEvidence['queryStatus'];
    matchType: string;
    costAmountScaled: string;
    impressions: string;
    clicks: string;
  }>
): Array<T & { matchedSearchTerms: KeywordSearchTermEvidence[] }>;
export function buildKeywordCoverage(
  rows: Array<Pick<KeywordAggregateRow, 'impressions' | 'clicks'>>
): KeywordCoverage;
export function buildKeywordActionDistribution(
  rows: KeywordAggregateRow[]
): KeywordActionDistribution;
export function buildKeywordAverageBenchmark(
  rows: KeywordAggregateRow[],
  costScale?: number
): KeywordBenchmark;
export function buildKeywordScatter(
  rows: KeywordAggregateRow[],
  costScale?: number
): KeywordScatter;
export function filterKeywordRows(
  rows: KeywordAggregateRow[],
  filters?: {
    stage?: KeywordStageFilter;
    search?: string;
    tag?: 'all' | KeywordTag;
    unitId?: string;
    costRange?: KeywordCostRange;
    costScale?: number;
    anomaly?: KeywordAnomaly;
    benchmarkCtrPercent?: number | null;
    benchmarkAverageCpc?: number | null;
    more?: KeywordMoreFilter;
    key?: string | null;
  }
): KeywordAggregateRow[];
export function median(values: number[]): number | null;
