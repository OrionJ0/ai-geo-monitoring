import axios from '@/lib/axiosConfig';
import {
  clampMarketingDateRange
} from '@/components/marketing/MarketingFiltersContext';
import {
  assertMarketingDashboardRootResponse,
  type MarketingDashboardResponse
} from './adPerformanceAdapter';

type DateRange = [string, string] | null;

function responseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('response' in error)) {
    return null;
  }
  const response = (error as {
    response?: { data?: { error?: { code?: unknown } } };
  }).response;
  return typeof response?.data?.error?.code === 'string'
    ? response.data.error.code
    : null;
}

function sameRange(left: DateRange, right: DateRange): boolean {
  return left?.[0] === right?.[0] && left?.[1] === right?.[1];
}

export async function readMarketingDashboard({
  projectId,
  dateRange
}: {
  projectId: string;
  dateRange: DateRange;
}): Promise<{
  data: MarketingDashboardResponse;
  effectiveDateRange: DateRange;
}> {
  const endpoint = `/api/marketing/projects/${encodeURIComponent(projectId)}/dashboard`;
  const read = (range: DateRange) => axios.get<MarketingDashboardResponse>(
    endpoint,
    range ? { params: { from: range[0], to: range[1] } } : undefined
  );
  try {
    const response = await read(dateRange);
    return { data: response.data, effectiveDateRange: dateRange };
  } catch (error) {
    if (
      !dateRange
      || responseErrorCode(error) !== 'DASHBOARD_DATE_OUT_OF_RANGE'
    ) throw error;
    const coverageResponse = await read(null);
    assertMarketingDashboardRootResponse(coverageResponse.data, projectId);
    const coverage = coverageResponse.data.coverage;
    if (!coverage) return { data: coverageResponse.data, effectiveDateRange: null };
    const effectiveDateRange = clampMarketingDateRange(dateRange, coverage);
    if (sameRange(dateRange, effectiveDateRange)) throw error;
    const response = await read(effectiveDateRange);
    return { data: response.data, effectiveDateRange };
  }
}
