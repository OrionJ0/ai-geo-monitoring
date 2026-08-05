import type {
  AdKeywordScope,
  AdSearchTermFilter,
  AdSearchTermRow,
  AdSearchTermSummary
} from '@/lib/marketing/adSearchTermTypes';
import type {
  MarketingAdKeyword,
  MarketingAdSearchTerm,
  MarketingDashboardResponse
} from '@/lib/marketing/generated/marketingAdReadApi';

export function keywordEvidenceKey(
  row: Pick<MarketingAdSearchTerm, 'accountId' | 'campaignId' | 'adGroupId' | 'keywordName'>
): string;
export function searchTermEntityKey(
  row: Pick<
    MarketingAdSearchTerm,
    | 'accountId'
    | 'campaignId'
    | 'adGroupId'
    | 'keywordName'
    | 'searchTerm'
    | 'queryStatus'
    | 'matchType'
  >
): string;
export function buildAdSearchTermRows(
  searchTerms: MarketingAdSearchTerm[],
  costScale?: number
): AdSearchTermRow[];
export function buildAdSearchTermSummary(
  rows: AdSearchTermRow[]
): AdSearchTermSummary;
export function dashboardFilterMatchesRange(
  dashboard: Pick<MarketingDashboardResponse, 'filter'>,
  range: { from: string; to: string }
): boolean;
export function formatExactPercentChange(
  current: string,
  previous: string
): string | null;
export function filterAdSearchTermRows(
  rows: AdSearchTermRow[],
  filters?: Partial<AdSearchTermFilter>
): AdSearchTermRow[];
export function resolveAdKeywordScope(
  keywords: Array<MarketingAdKeyword | AdKeywordScope>,
  accountId: string | null,
  keywordId: string | null
): MarketingAdKeyword | AdKeywordScope | null;
export function sameMarketingDashboardRevision(
  currentRevision: string | null,
  previousRevision: string | null
): boolean;
