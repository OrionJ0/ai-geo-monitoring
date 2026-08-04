'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import axios from '@/lib/axiosConfig';
import {
  buildKeywordFixture,
  KEYWORD_FIXTURE_RANGE
} from '@/fixtures/keywordAnalysis.fixture.cjs';
import {
  adaptAdSearchTermPayload,
  adaptMarketingDashboardSearchTerms
} from '@/lib/marketing/adSearchTermAdapter';
import type {
  AdKeywordScope,
  AdSearchTermAnalysisModel
} from '@/lib/marketing/adSearchTermTypes';
import {
  assertMarketingDashboardResponse,
  buildAdPeriod,
  marketingSnapshotWarning,
  type DashboardSearchTerm,
  type MarketingDashboardResponse
} from '@/lib/marketing/adPerformanceAdapter';
import type { KeywordAnalysisPayload } from '@/lib/marketing/keywordAnalysisAdapter';
import { KEYWORD_ANALYSIS_FIXTURE_ENABLED } from '@/lib/marketing/useKeywordAnalysis';
import { readMarketingDashboard } from '@/lib/marketing/readMarketingDashboard';
import {
  dashboardFilterMatchesRange,
  sameMarketingDashboardRevision
} from '@/utils/adSearchTerms.cjs';

export type AdSearchTermFixtureState = 'ready' | 'loading' | 'empty' | 'error';

type UseAdSearchTermsOptions = {
  projectId: string;
  projectName?: string;
  enabled: boolean;
  dateRange: [string, string] | null;
  fixtureEnabled?: boolean;
  fixtureState?: AdSearchTermFixtureState;
  onDateRangeAdjusted?: (range: [string, string]) => void;
};

type UseAdSearchTermsState = {
  data: AdSearchTermAnalysisModel | null;
  loading: boolean;
  error: string;
  warning: string;
  fixtureEnabled: boolean;
  reload: () => Promise<void>;
};

export const AD_SEARCH_TERMS_FIXTURE_ENABLED = KEYWORD_ANALYSIS_FIXTURE_ENABLED;

function readErrorMessage(error: unknown, fallback: string): string {
  const response = (
    error && typeof error === 'object' && 'response' in error
      ? (error as {
          response?: { data?: { error?: { message?: unknown } } };
        }).response
      : undefined
  );
  const message = response?.data?.error?.message;
  return typeof message === 'string' ? message : fallback;
}

function fixtureKeywords(payload: KeywordAnalysisPayload): AdKeywordScope[] {
  return payload.facts.map((fact) => ({
    accountId: fact.accountId,
    campaignId: fact.schemeId,
    campaignName: fact.schemeName,
    adGroupId: fact.unitId,
    adGroupName: fact.unitName,
    keywordId: fact.keywordId,
    keywordName: fact.keyword
  }));
}

export default function useAdSearchTerms({
  projectId,
  projectName,
  enabled,
  dateRange,
  fixtureEnabled = AD_SEARCH_TERMS_FIXTURE_ENABLED,
  fixtureState = 'ready',
  onDateRangeAdjusted
}: UseAdSearchTermsOptions): UseAdSearchTermsState {
  const [data, setData] = useState<AdSearchTermAnalysisModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const requestSequence = useRef(0);
  const skipAutomaticRangeReload = useRef('');

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
      let [from, to] = dateRange || [
        KEYWORD_FIXTURE_RANGE.from,
        KEYWORD_FIXTURE_RANGE.to
      ];
      if (fixtureEnabled) {
        await Promise.resolve();
        if (requestId !== requestSequence.current) return;
        if (fixtureState === 'error') {
          setData(null);
          setError('广告搜索词数据读取失败，请稍后重试。');
          return;
        }
        const fixture = buildKeywordFixture(
          fixtureState === 'empty'
        ) as KeywordAnalysisPayload;
        const current = adaptAdSearchTermPayload({
          source: 'development-fixture',
          dataState: fixture.dataState,
          projectId: fixture.projectId,
          projectName: fixture.projectName,
          currency: fixture.currency,
          costScale: fixture.costScale,
          updatedAt: fixture.updatedAt,
          availableFrom: fixture.availableFrom,
          availableTo: fixture.availableTo,
          keywords: fixtureKeywords(fixture),
          searchTerms: (fixture.searchTerms || []) as DashboardSearchTerm[]
        }, { from, to });
        const fixturePeriod = buildAdPeriod(from, to);
        const previousRange = {
          from: fixturePeriod.previousFrom,
          to: fixturePeriod.previousTo
        };
        setData({
          current,
          previous: null,
          previousRange,
          previousUnavailableReason: '开发数据未提供上一周期广告搜索词。'
        });
        return;
      }

      const endpoint = `/api/marketing/projects/${encodeURIComponent(projectId)}/dashboard`;
      const currentResult = await readMarketingDashboard({ projectId, dateRange });
      if (requestId !== requestSequence.current) return;
      assertMarketingDashboardResponse(currentResult.data, projectId);
      if (currentResult.effectiveDateRange) {
        const effectiveDateRange = currentResult.effectiveDateRange;
        [from, to] = effectiveDateRange;
        if (
          !dateRange
          || from !== dateRange[0]
          || to !== dateRange[1]
        ) {
          skipAutomaticRangeReload.current = `${from}:${to}`;
        }
        onDateRangeAdjusted?.(effectiveDateRange);
      } else {
        from = currentResult.data.filter?.from
          || currentResult.data.coverage?.from
          || from;
        to = currentResult.data.filter?.to
          || currentResult.data.coverage?.to
          || to;
      }
      if (!dashboardFilterMatchesRange(currentResult.data, { from, to })) {
        throw new TypeError('当前周期广告搜索词响应范围与请求不一致。');
      }
      const period = buildAdPeriod(from, to);
      const previousRange = {
        from: period.previousFrom,
        to: period.previousTo
      };
      setWarning(marketingSnapshotWarning(currentResult.data));
      const current = adaptMarketingDashboardSearchTerms(
        currentResult.data,
        projectName,
        { from, to }
      );
      setData({
        current,
        previous: null,
        previousRange,
        previousUnavailableReason: '上一周期广告搜索词正在读取。'
      });
      setLoading(false);
      const previousResult = await Promise.allSettled([
        axios.get<MarketingDashboardResponse>(endpoint, {
          params: previousRange,
          timeout: 10_000
        })
      ]).then(([result]) => result);
      if (requestId !== requestSequence.current) return;
      let previous = null;
      let previousUnavailableReason = '';
      if (previousResult.status === 'fulfilled') {
        try {
          assertMarketingDashboardResponse(previousResult.value.data, projectId);
          const previousDashboard = previousResult.value.data;
          if (!dashboardFilterMatchesRange(previousDashboard, previousRange)) {
            previousUnavailableReason = '上一周期广告搜索词响应范围与请求不一致，无法进行周期比较。';
          } else if (!sameMarketingDashboardRevision(
            currentResult.data.revision,
            previousDashboard.revision
          )) {
            previousUnavailableReason = '本期与上期广告快照版本不一致，无法进行周期比较。';
          } else if (
            currentResult.data.coverage?.currency
              !== previousDashboard.coverage?.currency
            || currentResult.data.coverage?.costScale
              !== previousDashboard.coverage?.costScale
          ) {
            previousUnavailableReason = '本期与上期广告计量单位不一致，无法进行周期比较。';
          } else if (
            previousDashboard.states?.snapshotContentState === 'NONE'
          ) {
            previousUnavailableReason = '上一周期没有完整的广告搜索词快照。';
          } else {
            previous = adaptMarketingDashboardSearchTerms(
              previousDashboard,
              projectName,
              previousRange
            );
          }
        } catch (previousError) {
          previousUnavailableReason = readErrorMessage(
            previousError,
            '上一周期广告搜索词响应无效。'
          );
        }
      } else {
        previousUnavailableReason = readErrorMessage(
          previousResult.reason,
          '上一周期广告搜索词暂不可用。'
        );
      }
      setData({
        current,
        previous,
        previousRange,
        previousUnavailableReason
      });
    } catch (requestError: unknown) {
      if (requestId !== requestSequence.current) return;
      setData(null);
      setWarning('');
      setError(readErrorMessage(
        requestError,
        '广告搜索词数据读取失败，请稍后重试。'
      ));
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

  return {
    data,
    loading,
    error,
    warning,
    fixtureEnabled,
    reload
  };
}
