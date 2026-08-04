'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import axios from '@/lib/axiosConfig';
import {
  buildKeywordFixture,
  KEYWORD_FIXTURE_RANGE
} from '@/fixtures/keywordAnalysis.fixture.cjs';
import {
  adaptKeywordAnalysis,
  adaptMarketingDashboardKeywords,
  type KeywordAnalysisModel,
  type KeywordAnalysisPayload
} from '@/lib/marketing/keywordAnalysisAdapter';
import {
  assertMarketingDashboardResponse,
  marketingSnapshotWarning,
  type MarketingDashboardResponse
} from '@/lib/marketing/adPerformanceAdapter';

export type KeywordFixtureState = 'ready' | 'loading' | 'empty' | 'error';

type UseKeywordAnalysisOptions = {
  projectId: string;
  projectName?: string;
  enabled: boolean;
  dateRange: [string, string] | null;
  fixtureEnabled?: boolean;
  fixtureState?: KeywordFixtureState;
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
  fixtureState = 'ready'
}: UseKeywordAnalysisOptions): UseKeywordAnalysisState {
  const [data, setData] = useState<KeywordAnalysisModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const requestSequence = useRef(0);

  const reload = useCallback(async () => {
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
      const response = await axios.get<MarketingDashboardResponse>(
        `/api/marketing/projects/${encodeURIComponent(projectId)}/dashboard`,
        dateRange
          ? { params: { from: dateRange[0], to: dateRange[1] } }
          : undefined
      );
      if (requestId !== requestSequence.current) return;
      assertMarketingDashboardResponse(response.data, projectId);
      setWarning(marketingSnapshotWarning(response.data));
      setData(adaptMarketingDashboardKeywords(
        response.data,
        projectName,
        dateRange
          ? { from: dateRange[0], to: dateRange[1] }
          : undefined
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
    projectId,
    projectName
  ]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    data,
    loading,
    error,
    warning,
    fixtureEnabled,
    reload
  };
}
