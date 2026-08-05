'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import axios from '@/lib/axiosConfig';
import {
  adaptMarketingAdHierarchy,
  assertMarketingAdHierarchyResponse,
  assertMarketingDashboardRootResponse,
  buildAdPeriod,
  classifyAdPreviousHierarchyError,
  marketingSnapshotWarning,
  type AdPerformanceModel,
  type AdPreviousHierarchyResult,
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

function readErrorMessage(error: unknown): string | null {
  const response = (
    error && typeof error === 'object' && 'response' in error
      ? (error as {
          response?: {
            data?: { error?: { code?: unknown; message?: unknown } };
          };
        }).response
      : undefined
  );
  return typeof response?.data?.error?.message === 'string'
    ? response.data.error.message
    : null;
}

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
        setData(adaptMarketingAdHierarchy(
          response.data,
          null,
          {
            state: 'UNAVAILABLE',
            hierarchy: null,
            reason: '当前没有可比较的上一周期广告快照。'
          },
          projectName
        ));
        return;
      }
      const period = buildAdPeriod(from, to);
      const endpoint = `/api/marketing/projects/${encodeURIComponent(projectId)}/ad-hierarchy`;
      const [currentResult, previousResult] = await Promise.allSettled([
        axios.get<MarketingAdHierarchyResponse>(endpoint, {
          params: { revision, from, to },
          timeout: 10_000
        }),
        axios.get<MarketingAdHierarchyResponse>(endpoint, {
          params: {
            revision,
            from: period.previousFrom,
            to: period.previousTo
          },
          timeout: 10_000
        })
      ]);
      if (requestId !== requestSequence.current) return;
      if (currentResult.status === 'rejected') throw currentResult.reason;
      assertMarketingAdHierarchyResponse(
        currentResult.value.data,
        response.data,
        { from, to }
      );
      let previous: AdPreviousHierarchyResult;
      if (previousResult.status === 'rejected') {
        previous = classifyAdPreviousHierarchyError(previousResult.reason);
      } else {
        try {
          assertMarketingAdHierarchyResponse(
            previousResult.value.data,
            response.data,
            { from: period.previousFrom, to: period.previousTo },
            { requireDashboardSummary: false }
          );
          previous = {
            state: 'READY',
            hierarchy: previousResult.value.data,
            reason: ''
          };
        } catch {
          previous = {
            state: 'ERROR',
            hierarchy: null,
            reason: '上一周期广告响应合同无效，请重试。'
          };
        }
      }
      setData(adaptMarketingAdHierarchy(
        response.data,
        currentResult.value.data,
        previous,
        projectName
      ));
    } catch (requestError: unknown) {
      if (requestId !== requestSequence.current) return;
      const message = readErrorMessage(requestError);
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
