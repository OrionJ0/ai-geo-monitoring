import type {
  AdKeywordScope,
  AdSearchTermFilter,
  AdSearchTermRow,
  AdSearchTermSummary
} from '@/lib/marketing/adSearchTermTypes';
import type {
  DashboardKeyword,
  DashboardSearchTerm,
  MarketingDashboardResponse
} from '@/lib/marketing/adPerformanceAdapter';

export function keywordEvidenceKey(
  row: Pick<DashboardSearchTerm, 'accountId' | 'campaignId' | 'adGroupId' | 'keywordName'>
): string;
export function searchTermEntityKey(
  row: Pick<
    DashboardSearchTerm,
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
  searchTerms: DashboardSearchTerm[],
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
  keywords: Array<DashboardKeyword | AdKeywordScope>,
  accountId: string | null,
  keywordId: string | null
): DashboardKeyword | AdKeywordScope | null;
export function sameMarketingDashboardRevision(
  currentRevision: string | null,
  previousRevision: string | null
): boolean;
