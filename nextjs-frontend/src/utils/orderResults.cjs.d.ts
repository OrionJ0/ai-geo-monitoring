import type {
  OrderResult,
  OrderResultFilters,
  OrderSourceCategory
} from '@/lib/orderResults/orderResultsTypes';

export const SOURCE_LABELS: Readonly<Record<OrderSourceCategory, string>>;
export function sourceCategory(order: OrderResult): OrderSourceCategory;
export function filterOrders(
  orders: readonly OrderResult[],
  filters: OrderResultFilters
): OrderResult[];
export function summarizeOrders(orders: readonly OrderResult[]): {
  totalCount: number;
  signedAmountYuan: string;
  trustedCount: number;
  unresolvedCount: number;
  associationRate: string;
};
export function summarizeSources(orders: readonly OrderResult[]): Array<{
  key: OrderSourceCategory;
  label: string;
  count: number;
  percentage: number;
  percentageLabel: string;
}>;
export function buildDailySeries(
  orders: readonly OrderResult[],
  filters: OrderResultFilters,
  metric: 'count' | 'amount'
): {
  current: Array<{ date: string; value: string }>;
  previous: Array<{ date: string; value: string }>;
  previousFrom: string;
  previousTo: string;
};
export function deriveOrderResultsView(
  orders: readonly OrderResult[],
  filters: OrderResultFilters
): {
  filteredRows: OrderResult[];
  pageRows: OrderResult[];
  summary: ReturnType<typeof summarizeOrders>;
  sourceOverview: ReturnType<typeof summarizeSources>;
  trend: ReturnType<typeof buildDailySeries>;
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
};
