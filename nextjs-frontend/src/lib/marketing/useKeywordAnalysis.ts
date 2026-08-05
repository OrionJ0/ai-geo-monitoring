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
  type KeywordAnalysisModel,
  type KeywordAnalysisPayload,
  type MarketingKeywordResourceResponse
} from '@/lib/marketing/keywordAnalysisAdapter';
import {
  assertMarketingDashboardRootResponse,
  marketingSnapshotWarning
} from '@/lib/marketing/adPerformanceAdapter';
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
      if (!from || !to || !revision) {
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
      const resourceResponse = await axios.get<MarketingKeywordResourceResponse>(
        endpoint,
        {
          params: {
            revision: response.data.revision,
            from,
            to,
            page: resourceQuery.page,
            pageSize: resourceQuery.pageSize,
            sortBy: resourceQuery.sortBy,
            sortOrder: resourceQuery.sortOrder,
            query: resourceQuery.query || undefined,
            campaignId: resourceQuery.campaignId,
            adGroupId: resourceQuery.adGroupId
          },
          timeout: 10_000
        }
      );
      if (requestId !== requestSequence.current) return;
      assertMarketingKeywordResourceResponse(
        resourceResponse.data,
        projectId,
        revision,
        { from, to }
      );
      setData(adaptMarketingKeywordResource(
        resourceResponse.data,
        response.data,
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
