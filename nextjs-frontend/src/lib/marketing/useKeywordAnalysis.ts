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
import { clampMarketingDateRange } from '@/components/marketing/MarketingFiltersContext';
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
  previousLoading: boolean;
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
  const [previousLoading, setPreviousLoading] = useState(false);
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
  const dataRef = useRef<KeywordAnalysisModel | null>(null);
  const successfulResourceScope = useRef('');
  const currentRequestController = useRef<AbortController | null>(null);
  const activePreviousRequest = useRef<{
    key: string;
    controller: AbortController;
  } | null>(null);

  const load = useCallback(async (refreshRoot = false) => {
    const requestId = ++requestSequence.current;
    currentRequestController.current?.abort();
    const requestController = new AbortController();
    currentRequestController.current = requestController;
    let resourceScope = '';
    const cachedDashboard = dashboardCache.current?.result.data;
    const cachedCoverage = cachedDashboard?.coverage;
    const cachedRevision = cachedDashboard?.revision;
    const cachedRange = cachedCoverage
      ? dateRange
        ? clampMarketingDateRange(dateRange, cachedCoverage)
        : [
            cachedDashboard.filter?.from || cachedCoverage.from,
            cachedDashboard.filter?.to || cachedCoverage.to
          ] as [string, string]
      : null;
    const predictedPreviousKey = cachedRevision && cachedRange
      ? (() => {
          const period = buildAdPeriod(cachedRange[0], cachedRange[1]);
          return keywordPreviousSummaryKey({
            projectId,
            revision: cachedRevision,
            previousFrom: period.previousFrom,
            previousTo: period.previousTo,
            query: resourceQuery.query || undefined,
            campaignId: resourceQuery.campaignId,
            adGroupId: resourceQuery.adGroupId
          });
        })()
      : null;
    if (
      activePreviousRequest.current
      && (
        refreshRoot
        || (
          predictedPreviousKey
          && activePreviousRequest.current.key !== predictedPreviousKey
        )
      )
    ) {
      previousSummaryCache.clear();
      activePreviousRequest.current.controller.abort();
      activePreviousRequest.current = null;
    }
    if (!fixtureEnabled && (!enabled || !projectId)) {
      dataRef.current = null;
      successfulResourceScope.current = '';
      setData(null);
      setError('');
      setWarning('');
      setLoading(false);
      setPreviousLoading(false);
      return;
    }
    if (!refreshRoot) setError('');
    setWarning('');
    setPreviousLoading(false);
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
      resourceScope = JSON.stringify([
        projectId,
        revision,
        from,
        to,
        resourceQuery.query,
        resourceQuery.campaignId || '',
        resourceQuery.adGroupId || '',
        resourceQuery.sortBy,
        resourceQuery.sortOrder
      ]);
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
      const currentPromise = axios.get<MarketingKeywordResourceResponse>(
        endpoint,
        {
          params: {
            ...sharedParams,
            from,
            to,
            page: resourceQuery.page,
            pageSize: resourceQuery.pageSize
          },
          signal: requestController.signal,
          timeout: 10_000
        }
      );
      const currentResult = await currentPromise;
      if (requestId !== requestSequence.current) return;
      assertMarketingKeywordResourceResponse(
        currentResult.data,
        projectId,
        revision,
        { from, to },
        coverage,
        expectedBusinessFilter
      );
      const pendingPrevious: KeywordPreviousResourceResult = {
        state: 'PENDING',
        resource: null,
        reason: '上一周期关键词比较正在加载。'
      };
      const currentData = adaptMarketingKeywordResource(
        currentResult.data,
        response.data,
        pendingPrevious,
        projectName
      );
      dataRef.current = currentData;
      successfulResourceScope.current = resourceScope;
      setError('');
      setData(currentData);
      setLoading(false);
      setPreviousLoading(true);
      const previousKey = keywordPreviousSummaryKey({
        projectId,
        revision,
        previousFrom: period.previousFrom,
        previousTo: period.previousTo,
        ...expectedBusinessFilter
      });
      if (
        activePreviousRequest.current
        && (
          refreshRoot
          || activePreviousRequest.current.key !== previousKey
        )
      ) {
        previousSummaryCache.clear();
        activePreviousRequest.current.controller.abort();
        activePreviousRequest.current = null;
      }
      const previousPromise = previousSummaryCache.read(
        previousKey,
        async () => {
          const previousController = new AbortController();
          activePreviousRequest.current = {
            key: previousKey,
            controller: previousController
          };
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
                signal: previousController.signal,
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
            if (axios.isCancel(previousError)) throw previousError;
            return classifyKeywordPreviousError(previousError);
          } finally {
            if (activePreviousRequest.current?.controller === previousController) {
              activePreviousRequest.current = null;
            }
          }
        },
        refreshRoot
      );
      let previous: KeywordPreviousResourceResult;
      try {
        previous = await previousPromise;
      } catch (previousError) {
        previous = classifyKeywordPreviousError(previousError);
      }
      if (requestId !== requestSequence.current) return;
      const nextData = adaptMarketingKeywordResource(
        currentResult.data,
        response.data,
        previous,
        projectName
      );
      dataRef.current = nextData;
      successfulResourceScope.current = resourceScope;
      setData(nextData);
    } catch (requestError: unknown) {
      if (requestId !== requestSequence.current) return;
      const message = readErrorMessage(requestError);
      const preserveCurrentPage = Boolean(resourceScope)
        && Boolean(dataRef.current)
        && successfulResourceScope.current === resourceScope;
      if (!preserveCurrentPage) {
        dataRef.current = null;
        successfulResourceScope.current = '';
        setData(null);
        setWarning('');
      }
      setError(
        typeof message === 'string'
          ? message
          : '关键词数据读取失败，请稍后重试。'
      );
    } finally {
      if (requestId === requestSequence.current) {
        if (currentRequestController.current === requestController) {
          currentRequestController.current = null;
        }
        setLoading(false);
        setPreviousLoading(false);
      }
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

  useEffect(() => () => {
    requestSequence.current += 1;
    currentRequestController.current?.abort();
    activePreviousRequest.current?.controller.abort();
  }, []);

  return {
    data,
    loading,
    previousLoading,
    error,
    warning,
    fixtureEnabled,
    reload
  };
}
