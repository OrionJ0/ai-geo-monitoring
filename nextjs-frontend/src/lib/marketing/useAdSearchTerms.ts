'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import axios from '@/lib/axiosConfig';
import {
  buildKeywordFixture,
  KEYWORD_FIXTURE_RANGE
} from '@/fixtures/keywordAnalysis.fixture.cjs';
import {
  adaptAdSearchTermPayload,
  adaptMarketingSearchTermResource,
  assertMarketingSearchTermResourceResponse,
  type MarketingSearchTermResourceResponse
} from '@/lib/marketing/adSearchTermAdapter';
import type {
  AdKeywordScope,
  AdSearchTermAnalysisModel,
  AdSearchTermResourceQuery
} from '@/lib/marketing/adSearchTermTypes';
import {
  assertMarketingDashboardRootResponse,
  buildAdPeriod,
  marketingSnapshotWarning,
  type DashboardSearchTerm
} from '@/lib/marketing/adPerformanceAdapter';
import type { KeywordAnalysisPayload } from '@/lib/marketing/keywordAnalysisAdapter';
import { KEYWORD_ANALYSIS_FIXTURE_ENABLED } from '@/lib/marketing/useKeywordAnalysis';
import { readMarketingDashboard } from '@/lib/marketing/readMarketingDashboard';
import {
  dashboardFilterMatchesRange,
} from '@/utils/adSearchTerms.cjs';

export type AdSearchTermFixtureState = 'ready' | 'loading' | 'empty' | 'error';

type UseAdSearchTermsOptions = {
  projectId: string;
  projectName?: string;
  enabled: boolean;
  dateRange: [string, string] | null;
  fixtureEnabled?: boolean;
  fixtureState?: AdSearchTermFixtureState;
  resourceQuery: AdSearchTermResourceQuery;
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

function evidenceParts(value: string): {
  accountId: string;
  campaignId: string;
  adGroupId: string;
  keywordName: string;
} | null {
  if (!value || value === 'all') return null;
  const [accountId, campaignId, adGroupId, keywordName, ...extra] =
    value.split('\u0000');
  if (extra.length || !accountId || !campaignId || !adGroupId || !keywordName) {
    return null;
  }
  return { accountId, campaignId, adGroupId, keywordName };
}

export default function useAdSearchTerms({
  projectId,
  projectName,
  enabled,
  dateRange,
  fixtureEnabled = AD_SEARCH_TERMS_FIXTURE_ENABLED,
  fixtureState = 'ready',
  resourceQuery,
  onDateRangeAdjusted
}: UseAdSearchTermsOptions): UseAdSearchTermsState {
  const [data, setData] = useState<AdSearchTermAnalysisModel | null>(null);
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

      const requestedDashboardKey = `${projectId}:${dateRange?.join(':') || 'default'}`;
      let currentResult = !refreshRoot
        && dashboardCache.current?.keys.includes(requestedDashboardKey)
        ? dashboardCache.current.result
        : null;
      if (!currentResult) {
        currentResult = await readMarketingDashboard({ projectId, dateRange });
        const effectiveKey = currentResult.effectiveDateRange
          ? `${projectId}:${currentResult.effectiveDateRange.join(':')}`
          : requestedDashboardKey;
        dashboardCache.current = {
          keys: [...new Set([requestedDashboardKey, effectiveKey])],
          result: currentResult
        };
      }
      if (requestId !== requestSequence.current) return;
      assertMarketingDashboardRootResponse(currentResult.data, projectId);
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
      const revision = currentResult.data.revision;
      if (!revision) {
        throw new TypeError('当前没有可用的广告搜索词快照。');
      }
      const scope = resourceQuery.scopeEvidence;
      if (resourceQuery.scopeRequired && !scope) {
        const emptyResource: MarketingSearchTermResourceResponse = {
          schemaVersion: 'marketing_search_terms_v1',
          projectId,
          revision,
          coverage: currentResult.data.coverage!,
          filter: { from, to },
          summary: {
            impressions: '0',
            clicks: '0',
            costAmountScaled: '0'
          },
          items: [],
          pagination: {
            page: resourceQuery.page,
            pageSize: resourceQuery.pageSize,
            totalItems: 0,
            totalPages: 0
          }
        };
        setData({
          current: adaptMarketingSearchTermResource(
            emptyResource,
            currentResult.data,
            projectName
          ),
          previous: null,
          previousRange,
          previousUnavailableReason: '当前下钻范围无效，未读取上一周期。'
        });
        return;
      }
      const selectedEvidence = scope || evidenceParts(resourceQuery.keywordEvidence);
      const commonParams = {
        revision: currentResult.data.revision,
        page: resourceQuery.page,
        pageSize: resourceQuery.pageSize,
        sortBy: resourceQuery.sortBy,
        sortOrder: resourceQuery.sortOrder,
        query: resourceQuery.query || undefined,
        accountId: selectedEvidence?.accountId,
        campaignId: selectedEvidence?.campaignId,
        adGroupId: selectedEvidence?.adGroupId
          || (resourceQuery.adGroupId === 'all'
            ? undefined
            : resourceQuery.adGroupId),
        keywordName: selectedEvidence?.keywordName,
        queryStatus: resourceQuery.queryStatus === 'all'
          ? undefined
          : resourceQuery.queryStatus,
        matchType: resourceQuery.matchType === 'all'
          ? undefined
          : resourceQuery.matchType
      };
      const resourceEndpoint = `/api/marketing/projects/${encodeURIComponent(projectId)}/search-terms`;
      const currentResponse = await axios.get<MarketingSearchTermResourceResponse>(
        resourceEndpoint,
        {
          params: { ...commonParams, from, to },
          timeout: 10_000
        }
      );
      if (requestId !== requestSequence.current) return;
      assertMarketingSearchTermResourceResponse(
        currentResponse.data,
        projectId,
        revision,
        { from, to }
      );
      const current = adaptMarketingSearchTermResource(
        currentResponse.data,
        currentResult.data,
        projectName
      );
      setData({
        current,
        previous: null,
        previousRange,
        previousUnavailableReason: '上一周期广告搜索词正在读取。'
      });
      setLoading(false);
      const previousResult = await Promise.allSettled([
        axios.get<MarketingSearchTermResourceResponse>(resourceEndpoint, {
          params: {
            ...commonParams,
            page: 1,
            pageSize: 1,
            from: previousRange.from,
            to: previousRange.to
          },
          timeout: 10_000
        })
      ]).then(([result]) => result);
      if (requestId !== requestSequence.current) return;
      let previous = null;
      let previousUnavailableReason = '';
      if (previousResult.status === 'fulfilled') {
        try {
          assertMarketingSearchTermResourceResponse(
            previousResult.value.data,
            projectId,
            revision,
            previousRange
          );
          previous = adaptMarketingSearchTermResource(
            previousResult.value.data,
            currentResult.data,
            projectName
          );
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
    projectName,
    resourceQuery.adGroupId,
    resourceQuery.keywordEvidence,
    resourceQuery.matchType,
    resourceQuery.page,
    resourceQuery.pageSize,
    resourceQuery.query,
    resourceQuery.queryStatus,
    resourceQuery.scopeEvidence,
    resourceQuery.scopeRequired,
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
