'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import axios from '@/lib/axiosConfig';
import {
  buildKeywordFixture,
  KEYWORD_FIXTURE_RANGE
} from '@/fixtures/keywordAnalysis.fixture.cjs';
import {
  adaptKeywordAnalysis,
  adaptMarketingKeywordResource,
  assertMarketingKeywordResourceResponse,
  classifyKeywordPreviousError,
  type KeywordAnalysisModel,
  type KeywordAnalysisPayload,
  type KeywordPreviousResourceResult,
  type MarketingKeywordResourceResponse
} from '@/lib/marketing/keywordAnalysisAdapter';
import {
  assertMarketingDashboardRootResponse,
  buildAdPeriod,
  marketingSnapshotWarning
} from '@/lib/marketing/adPerformanceAdapter';
import {
  createKeywordPreviousSummaryCache,
  keywordPreviousSummaryKey
} from '@/lib/marketing/keywordPreviousSummaryCache';
import { readMarketingDashboard } from './readMarketingDashboard';

export type KeywordFixtureState = 'ready' | 'loading' | 'empty' | 'error';
export type KeywordResourceSort =
  | 'keywordName'
  | 'impressions'
  | 'clicks'
  | 'costAmountScaled'
  | 'ctr'
  | 'averageCpc';

export type KeywordResourceQuery = {
  page: number;
  pageSize: number;
  sortBy: KeywordResourceSort;
  sortOrder: 'ascend' | 'descend';
  query: string;
  campaignId?: string;
  adGroupId?: string;
};

type UseKeywordAnalysisOptions = {
  projectId: string;
  projectName?: string;
  enabled: boolean;
  dateRange: [string, string] | null;
  fixtureEnabled?: boolean;
  fixtureState?: KeywordFixtureState;
  resourceQuery: KeywordResourceQuery;
  onDateRangeAdjusted?: (range: [string, string]) => void;
};

type UseKeywordAnalysisState = {
  data: KeywordAnalysisModel | null;
  loading: boolean;
  error: string;
  warning: string;
  fixtureEnabled: boolean;
  reload: () => Promise<void>;
};

export const KEYWORD_ANALYSIS_FIXTURE_ENABLED = (
  process.env.NODE_ENV !== 'production'
  &&
  process.env.NEXT_PUBLIC_KEYWORD_ANALYSIS_FIXTURE === 'true'
);

function readErrorMessage(error: unknown): string | null {
  const response = (
    error && typeof error === 'object' && 'response' in error
      ? (error as {
          response?: { data?: { error?: { message?: unknown } } };
        }).response
      : undefined
  );
  return typeof response?.data?.error?.message === 'string'
    ? response.data.error.message
    : null;
}

export default function useKeywordAnalysis({
  projectId,
  projectName,
  enabled,
  dateRange,
  fixtureEnabled = KEYWORD_ANALYSIS_FIXTURE_ENABLED,
  fixtureState = 'ready',
  resourceQuery,
  onDateRangeAdjusted
}: UseKeywordAnalysisOptions): UseKeywordAnalysisState {
  const [data, setData] = useState<KeywordAnalysisModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const requestSequence = useRef(0);
  const skipAutomaticRangeReload = useRef('');
  const dashboardCache = useRef<{
    keys: string[];
    result: Awaited<ReturnType<typeof readMarketingDashboard>>;
  } | null>(null);
  const [previousSummaryCache] = useState(
    () => createKeywordPreviousSummaryCache<KeywordPreviousResourceResult>()
  );

  const load = useCallback(async (refreshRoot = false) => {
    const requestId = ++requestSequence.current;
    if (!fixtureEnabled && (!enabled || !projectId)) {
      setData(null);
      setError('');
      setWarning('');
      setLoading(false);
      return;
    }
    setError('');
    setWarning('');
    if (fixtureEnabled && fixtureState === 'loading') {
      setData(null);
      setLoading(true);
      return;
    }
    setLoading(true);
    try {
      if (fixtureEnabled) {
        await Promise.resolve();
        if (requestId !== requestSequence.current) return;
        if (fixtureState === 'error') {
          setData(null);
          setError('开发关键词数据读取失败，请稍后重试。');
          return;
        }
        const [from, to] = dateRange || [
          KEYWORD_FIXTURE_RANGE.from,
          KEYWORD_FIXTURE_RANGE.to
        ];
        setData(adaptKeywordAnalysis(
          buildKeywordFixture(
            fixtureState === 'empty'
          ) as KeywordAnalysisPayload,
          { from, to }
        ));
        return;
      }
      const requestedDashboardKey = `${projectId}:${dateRange?.join(':') || 'default'}`;
      let response = !refreshRoot
        && dashboardCache.current?.keys.includes(requestedDashboardKey)
        ? dashboardCache.current.result
        : null;
      if (!response) {
        response = await readMarketingDashboard({ projectId, dateRange });
        const effectiveKey = response.effectiveDateRange
          ? `${projectId}:${response.effectiveDateRange.join(':')}`
          : requestedDashboardKey;
        dashboardCache.current = {
          keys: [...new Set([requestedDashboardKey, effectiveKey])],
          result: response
        };
      }
      if (requestId !== requestSequence.current) return;
      assertMarketingDashboardRootResponse(response.data, projectId);
      const from = response.effectiveDateRange?.[0]
        || response.data.filter?.from
        || response.data.coverage?.from;
      const to = response.effectiveDateRange?.[1]
        || response.data.filter?.to
        || response.data.coverage?.to;
      const revision = response.data.revision;
      const coverage = response.data.coverage;
      if (!from || !to || !revision || !coverage) {
        throw new TypeError('当前没有可用的广告关键词快照。');
      }
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
      const endpoint = `/api/marketing/projects/${encodeURIComponent(projectId)}/keywords`;
      const period = buildAdPeriod(from, to);
      const sharedParams = {
        revision,
        sortBy: resourceQuery.sortBy,
        sortOrder: resourceQuery.sortOrder,
        query: resourceQuery.query || undefined,
        campaignId: resourceQuery.campaignId,
        adGroupId: resourceQuery.adGroupId
      };
      const expectedBusinessFilter = {
        query: resourceQuery.query || undefined,
        campaignId: resourceQuery.campaignId,
        adGroupId: resourceQuery.adGroupId
      };
      const previousKey = keywordPreviousSummaryKey({
        projectId,
        revision,
        previousFrom: period.previousFrom,
        previousTo: period.previousTo,
        ...expectedBusinessFilter
      });
      const previousPromise = previousSummaryCache.read(
        previousKey,
        async () => {
          try {
            const previousResponse = await axios.get<MarketingKeywordResourceResponse>(
              endpoint,
              {
                params: {
                  ...sharedParams,
                  from: period.previousFrom,
                  to: period.previousTo,
                  page: 1,
                  pageSize: 1
                },
                timeout: 10_000
              }
            );
            try {
              assertMarketingKeywordResourceResponse(
                previousResponse.data,
                projectId,
                revision,
                { from: period.previousFrom, to: period.previousTo },
                coverage,
                expectedBusinessFilter
              );
              return {
                state: 'READY',
                resource: previousResponse.data,
                reason: ''
              };
            } catch {
              return {
                state: 'ERROR',
                resource: null,
                reason: '上一周期关键词响应合同无效，请重试。'
              };
            }
          } catch (previousError) {
            return classifyKeywordPreviousError(previousError);
          }
        },
        refreshRoot
      );
      const [currentResult, previousResult] = await Promise.allSettled([
        axios.get<MarketingKeywordResourceResponse>(endpoint, {
          params: {
            ...sharedParams,
            from,
            to,
            page: resourceQuery.page,
            pageSize: resourceQuery.pageSize
          },
          timeout: 10_000
        }),
        previousPromise
      ]);
      if (requestId !== requestSequence.current) return;
      if (currentResult.status === 'rejected') throw currentResult.reason;
      assertMarketingKeywordResourceResponse(
        currentResult.value.data,
        projectId,
        revision,
        { from, to },
        coverage,
        expectedBusinessFilter
      );
      let previous: KeywordPreviousResourceResult;
      if (previousResult.status === 'rejected') {
        previous = classifyKeywordPreviousError(previousResult.reason);
      } else {
        previous = previousResult.value;
      }
      setData(adaptMarketingKeywordResource(
        currentResult.value.data,
        response.data,
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
          : '关键词数据读取失败，请稍后重试。'
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
    previousSummaryCache,
    projectId,
    projectName,
    resourceQuery.adGroupId,
    resourceQuery.campaignId,
    resourceQuery.page,
    resourceQuery.pageSize,
    resourceQuery.query,
    resourceQuery.sortBy,
    resourceQuery.sortOrder
  ]);

  const reload = useCallback(() => load(true), [load]);

  useEffect(() => {
    const rangeKey = dateRange?.join(':') || '';
    if (rangeKey && skipAutomaticRangeReload.current === rangeKey) {
      skipAutomaticRangeReload.current = '';
      return;
    }
    void load();
  }, [dateRange, load]);

  return {
    data,
    loading,
    error,
    warning,
    fixtureEnabled,
    reload
  };
}
