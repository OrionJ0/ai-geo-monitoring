'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import axios from '@/lib/axiosConfig';
import {
  adaptMarketingAdHierarchy,
  assertMarketingAdHierarchyResponse,
  assertMarketingDashboardRootResponse,
  marketingSnapshotWarning,
  type AdPerformanceModel,
  type MarketingAdHierarchyResponse
} from '@/lib/marketing/adPerformanceAdapter';
import { buildAdPerformanceFixture } from '@/fixtures/adPerformance.fixture';
import { readMarketingDashboard } from './readMarketingDashboard';

export type AdPerformanceFixtureState = 'ready' | 'loading' | 'empty' | 'error';

type DateRange = [string, string] | null;

type UseAdPerformanceOptions = {
  projectId: string;
  projectName?: string;
  enabled: boolean;
  fixtureEnabled?: boolean;
  dateRange: DateRange;
  fixtureState?: AdPerformanceFixtureState;
  onDateRangeAdjusted?: (range: [string, string]) => void;
};

type UseAdPerformanceState = {
  data: AdPerformanceModel | null;
  loading: boolean;
  error: string;
  warning: string;
  reload: () => Promise<void>;
};

export const AD_PERFORMANCE_FIXTURE_ENABLED = (
  process.env.NODE_ENV !== 'production'
  &&
  process.env.NEXT_PUBLIC_AD_PERFORMANCE_FIXTURE === 'true'
);

export default function useAdPerformance({
  projectId,
  projectName,
  enabled,
  fixtureEnabled = AD_PERFORMANCE_FIXTURE_ENABLED,
  dateRange,
  fixtureState = 'ready',
  onDateRangeAdjusted
}: UseAdPerformanceOptions): UseAdPerformanceState {
  const [data, setData] = useState<AdPerformanceModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const requestSequence = useRef(0);
  const skipAutomaticRangeReload = useRef('');

  const reload = useCallback(async () => {
    const requestId = ++requestSequence.current;
    if (fixtureEnabled) {
      setError('');
      setWarning('');
      if (fixtureState === 'loading') {
        setData(null);
        setLoading(true);
        return;
      }
      setLoading(true);
      await Promise.resolve();
      if (requestId !== requestSequence.current) return;
      if (fixtureState === 'error') {
        setData(null);
        setError('广告数据读取失败，请稍后重试。');
        setLoading(false);
        return;
      }
      const [from, to] = dateRange || ['2026-07-05', '2026-08-03'];
      setData(buildAdPerformanceFixture(from, to, fixtureState === 'empty'));
      setLoading(false);
      return;
    }

    if (!enabled || !projectId) {
      setData(null);
      setWarning('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    setWarning('');
    try {
      const response = await readMarketingDashboard({ projectId, dateRange });
      if (requestId !== requestSequence.current) return;
      assertMarketingDashboardRootResponse(response.data, projectId);
      if (response.effectiveDateRange) {
        if (
          !dateRange
          || response.effectiveDateRange[0] !== dateRange[0]
          || response.effectiveDateRange[1] !== dateRange[1]
        ) {
          skipAutomaticRangeReload.current = response.effectiveDateRange.join(':');
        }
        onDateRangeAdjusted?.(response.effectiveDateRange);
      }
      setWarning(marketingSnapshotWarning(response.data));
      const from = response.effectiveDateRange?.[0]
        || response.data.filter?.from
        || response.data.coverage?.from;
      const to = response.effectiveDateRange?.[1]
        || response.data.filter?.to
        || response.data.coverage?.to;
      const revision = response.data.revision;
      if (!from || !to || !revision) {
        setData(adaptMarketingAdHierarchy(response.data, null, projectName));
        return;
      }
      const hierarchyResponse = await axios.get<MarketingAdHierarchyResponse>(
        `/api/marketing/projects/${encodeURIComponent(projectId)}/ad-hierarchy`,
        {
          params: { revision: response.data.revision, from, to },
          timeout: 10_000
        }
      );
      if (requestId !== requestSequence.current) return;
      assertMarketingAdHierarchyResponse(
        hierarchyResponse.data,
        response.data,
        { from, to }
      );
      setData(adaptMarketingAdHierarchy(
        response.data,
        hierarchyResponse.data,
        projectName
      ));
    } catch (requestError: unknown) {
      if (requestId !== requestSequence.current) return;
      const response = (
        requestError && typeof requestError === 'object' && 'response' in requestError
          ? (requestError as {
              response?: { data?: { error?: { message?: unknown } } };
            }).response
          : undefined
      );
      const message = response?.data?.error?.message;
      setData(null);
      setWarning('');
      setError(
        typeof message === 'string'
          ? message
          : '广告数据读取失败，请稍后重试。'
      );
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [
    dateRange,
    enabled,
    fixtureEnabled,
    fixtureState,
    onDateRangeAdjusted,
    projectId,
    projectName
  ]);

  useEffect(() => {
    const rangeKey = dateRange?.join(':') || '';
    if (rangeKey && skipAutomaticRangeReload.current === rangeKey) {
      skipAutomaticRangeReload.current = '';
      return;
    }
    void reload();
  }, [dateRange, reload]);

  return { data, loading, error, warning, reload };
}
