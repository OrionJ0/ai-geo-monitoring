'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import axios from '@/lib/axiosConfig';
import {
  assertMarketingDashboardResponse,
  marketingSnapshotWarning,
  type MarketingDashboardResponse
} from './adPerformanceAdapter';

type SourceSlotState =
  | 'IDLE'
  | 'LOADING'
  | 'AVAILABLE'
  | 'STALE'
  | 'ZERO'
  | 'NO_DATA'
  | 'SOURCE_ERROR';

export type SourceSlot<T = unknown> = {
  state: SourceSlotState;
  data: T | null;
  errorCode: string | null;
  errorMessage: string | null;
  readAt: string | null;
};

type MarketOverviewState = {
  status: 'IDLE' | 'LOADING' | 'READY' | 'PARTIAL' | 'EMPTY' | 'SOURCE_ERROR';
  ad: SourceSlot;
  traffic: SourceSlot;
  trafficSources: SourceSlot;
  paidTraffic: SourceSlot;
  trafficTrend: SourceSlot;
  reload: () => Promise<void>;
};

const idleSlot = (): SourceSlot => ({
  state: 'IDLE',
  data: null,
  errorCode: null,
  errorMessage: null,
  readAt: null
});

function rejectedSlot(reason: unknown, fallback: string): SourceSlot {
  const response = (
    reason && typeof reason === 'object' && 'response' in reason
      ? (reason as {
        response?: {
          data?: { error?: { code?: unknown; message?: unknown } };
        };
      }).response
      : undefined
  );
  const code = response?.data?.error?.code;
  const message = response?.data?.error?.message;
  return {
    state: 'SOURCE_ERROR',
    data: null,
    errorCode: typeof code === 'string' ? code : null,
    errorMessage: typeof message === 'string' ? message : fallback,
    readAt: null
  };
}

function adSlot(data: MarketingDashboardResponse, readAt: string): SourceSlot {
  const content = data?.states?.snapshotContentState;
  const stale = data?.states?.snapshotFreshnessState === 'STALE';
  const warning = marketingSnapshotWarning(data);
  return {
    state: stale ? 'STALE' : content === 'ZERO'
      ? 'ZERO'
      : content === 'NONE'
        ? 'NO_DATA'
        : 'AVAILABLE',
    data,
    errorCode: stale ? data.lastRun?.failureCode || null : null,
    errorMessage: warning || null,
    readAt: data?.coverage?.lastSuccessfulAt || readAt
  };
}

function trafficSlot(data: Record<string, any>, readAt: string): SourceSlot {
  return {
    state: data?.dataState === 'NO_DATA' ? 'NO_DATA' : 'AVAILABLE',
    data,
    errorCode: null,
    errorMessage: null,
    readAt
  };
}

function objectRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactMetric(value: unknown): boolean {
  return value === null || (typeof value === 'string' && /^\d+$/u.test(value));
}

function validTrafficRows(value: unknown): boolean {
  return Array.isArray(value) && value.every((row) => (
    objectRecord(row)
    && typeof row.date === 'string'
    && exactMetric(row.pageviews)
    && exactMetric(row.visits)
    && exactMetric(row.visitors)
  ));
}

const TONGJI_SOURCE_KEYS = [
  'BAIDU_PAID',
  'DIRECT',
  'BAIDU_SEARCH',
  'BING_SEARCH',
  'GOOGLE_SEARCH',
  'OTHER_SEARCH',
  'EXTERNAL_REFERRAL'
] as const;

function validTrafficSources(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== TONGJI_SOURCE_KEYS.length) {
    return false;
  }
  const keys = value.map((source) => (
    objectRecord(source) ? String(source.sourceKey) : ''
  ));
  return new Set(keys).size === TONGJI_SOURCE_KEYS.length
    && TONGJI_SOURCE_KEYS.every((key) => keys.includes(key))
    && value.every((source: unknown) => objectRecord(source)
      && objectRecord(source.summary)
      && ['pageviews', 'visits', 'visitors']
        .every((key) => exactMetric(source.summary[key])));
}

function validSelectedSourceTrend(
  value: unknown,
  expectedSourceKey: string | null,
  device: 'all' | 'pc' | 'mobile'
): boolean {
  if (expectedSourceKey === null) return value === null;
  return objectRecord(value)
    && value.sourceKey === expectedSourceKey
    && value.device === device
    && ['DATA', 'NO_DATA'].includes(String(value.dataState))
    && objectRecord(value.coverage)
    && objectRecord(value.summary)
    && ['pageviews', 'visits', 'visitors']
      .every((key) => exactMetric(value.summary[key]))
    && validTrafficRows(value.trend)
    && objectRecord(value.cache)
    && ['HIT', 'REFRESHED', 'FALLBACK'].includes(String(value.cache.state));
}

function assertTongjiOverviewResponse(
  value: unknown,
  projectId: string,
  device: 'all' | 'pc' | 'mobile',
  kind: 'trend' | 'sources',
  selectedSourceKey: string | null = null
): asserts value is Record<string, any> {
  if (!objectRecord(value)) throw new TypeError('百度统计响应合同无效');
  const baseValid = String(value.projectId) === projectId
    && value.source === 'BAIDU_TONGJI'
    && value.mode === 'DATABASE_SNAPSHOT'
    && value.device === device
    && ['DATA', 'NO_DATA'].includes(String(value.dataState))
    && objectRecord(value.coverage)
    && objectRecord(value.cache)
    && ['HIT', 'REFRESHED', 'FALLBACK'].includes(String(value.cache.state));
  const valid = kind === 'trend'
    ? baseValid
      && objectRecord(value.summary)
      && ['pageviews', 'visits', 'visitors']
        .every((key) => exactMetric(value.summary[key]))
      && validTrafficRows(value.trend)
    : baseValid
      && objectRecord(value.attribution)
      && value.attribution.level === 'WEBSITE_TRAFFIC_SOURCE'
      && value.attribution.isCrossSystemVerified === false
      && validTrafficSources(value.sources)
      && validSelectedSourceTrend(
        value.selectedTrend,
        selectedSourceKey,
        device
      );
  if (!valid) {
    const error = new TypeError('百度统计响应合同无效');
    (error as TypeError & { code: string }).code =
      'TONGJI_RESPONSE_INVALID';
    throw error;
  }
}

function fulfilledAdSlot(
  value: unknown,
  readAt: string,
  projectId: string
): SourceSlot {
  try {
    assertMarketingDashboardResponse(value, projectId);
    return adSlot(value, readAt);
  } catch (error) {
    return rejectedSlot(error, '广告快照响应合同无效');
  }
}

function fulfilledTrafficSlot(
  value: unknown,
  readAt: string,
  projectId: string,
  device: 'all' | 'pc' | 'mobile',
  kind: 'trend' | 'sources',
  selectedSourceKey: string | null = null
): SourceSlot {
  try {
    assertTongjiOverviewResponse(
      value,
      projectId,
      device,
      kind,
      selectedSourceKey
    );
    return trafficSlot(value, readAt);
  } catch (error) {
    return rejectedSlot(error, '百度统计响应合同无效');
  }
}

function overallStatus(
  ad: SourceSlot,
  traffic: SourceSlot,
  trafficSources: SourceSlot
) {
  const successes = [ad, traffic, trafficSources].filter(
    (slot) => slot.state !== 'SOURCE_ERROR'
  );
  if (successes.length === 0) return 'SOURCE_ERROR' as const;
  if (successes.length < 3) return 'PARTIAL' as const;
  if (successes.every((slot) => ['ZERO', 'NO_DATA'].includes(slot.state))) {
    return 'EMPTY' as const;
  }
  return 'READY' as const;
}

export default function useMarketOverview({
  projectId,
  enabled,
  device,
  trafficTrendSource
}: {
  projectId: string;
  enabled: boolean;
  device: 'all' | 'pc' | 'mobile';
  trafficTrendSource:
    | 'BAIDU_PAID'
    | 'DIRECT'
    | 'BAIDU_SEARCH'
    | 'BING_SEARCH'
    | 'GOOGLE_SEARCH'
    | 'OTHER_SEARCH'
    | 'EXTERNAL_REFERRAL'
    | null;
}): MarketOverviewState {
  const [ad, setAd] = useState<SourceSlot>(idleSlot);
  const [traffic, setTraffic] = useState<SourceSlot>(idleSlot);
  const [trafficSources, setTrafficSources] = useState<SourceSlot>(idleSlot);
  const [paidTraffic, setPaidTraffic] = useState<SourceSlot>(idleSlot);
  const [trafficTrend, setTrafficTrend] = useState<SourceSlot>(idleSlot);
  const [status, setStatus] = useState<MarketOverviewState['status']>('IDLE');
  const requestSequence = useRef(0);
  const lastReadAt = useRef(0);

  const fetchOverview = useCallback(async (silent = false) => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    if (!enabled || !projectId) {
      setAd(idleSlot());
      setTraffic(idleSlot());
      setTrafficSources(idleSlot());
      setPaidTraffic(idleSlot());
      setTrafficTrend(idleSlot());
      setStatus('IDLE');
      return;
    }
    if (!silent) {
      setStatus('LOADING');
      setAd((current) => ({ ...current, state: 'LOADING' }));
      setTraffic((current) => ({ ...current, state: 'LOADING' }));
      setTrafficSources((current) => ({ ...current, state: 'LOADING' }));
      setPaidTraffic((current) => ({ ...current, state: 'LOADING' }));
      setTrafficTrend((current) => ({ ...current, state: 'LOADING' }));
    }
    const encodedProjectId = encodeURIComponent(projectId);
    const paidTrafficRequest = axios.get(
      `/api/marketing/projects/${encodedProjectId}/tongji-source-trends`,
      { params: { device, source: 'BAIDU_PAID' } }
    );
    const selectedTrendRequest = trafficTrendSource === 'BAIDU_PAID'
      ? paidTrafficRequest
      : trafficTrendSource
        ? axios.get(
            `/api/marketing/projects/${encodedProjectId}/tongji-source-trends`,
            { params: { device, source: trafficTrendSource } }
          )
        : null;
    const [
      adResult,
      trafficResult,
      trafficSourcesResult,
      paidTrafficResult,
      trafficTrendResult
    ] = await Promise.allSettled([
      axios.get(`/api/marketing/projects/${encodedProjectId}/dashboard`),
      axios.get(
        `/api/marketing/projects/${encodedProjectId}/tongji-trend`,
        { params: { device } }
      ),
      axios.get(
        `/api/marketing/projects/${encodedProjectId}/tongji-source-trends`,
        { params: { device } }
      ),
      paidTrafficRequest,
      selectedTrendRequest || Promise.resolve(null)
    ]);
    if (sequence !== requestSequence.current) return;
    const readAt = new Date().toISOString();
    const nextAd = adResult.status === 'fulfilled'
      ? fulfilledAdSlot(adResult.value.data, readAt, projectId)
      : rejectedSlot(adResult.reason, '广告快照读取失败');
    const nextTraffic = trafficResult.status === 'fulfilled'
      ? fulfilledTrafficSlot(
        trafficResult.value.data,
        readAt,
        projectId,
        device,
        'trend'
      )
      : rejectedSlot(trafficResult.reason, '网站流量读取失败');
    const nextTrafficSources = trafficSourcesResult.status === 'fulfilled'
      ? fulfilledTrafficSlot(
        trafficSourcesResult.value.data,
        readAt,
        projectId,
        device,
        'sources'
      )
      : rejectedSlot(trafficSourcesResult.reason, '网站来源读取失败');
    const nextPaidTraffic = paidTrafficResult.status === 'fulfilled'
      ? fulfilledTrafficSlot(
        paidTrafficResult.value.data,
        readAt,
        projectId,
        device,
        'sources',
        'BAIDU_PAID'
      )
      : rejectedSlot(paidTrafficResult.reason, '百度推广访问读取失败');
    const nextTrafficTrend = !selectedTrendRequest
      ? idleSlot()
      : trafficTrendResult.status === 'fulfilled'
        ? fulfilledTrafficSlot(
          trafficTrendResult.value?.data,
          readAt,
          projectId,
          device,
          'sources',
          trafficTrendSource
        )
        : rejectedSlot(trafficTrendResult.reason, '所选来源趋势读取失败');
    setAd(nextAd);
    setTraffic(nextTraffic);
    setTrafficSources(nextTrafficSources);
    setPaidTraffic(nextPaidTraffic);
    setTrafficTrend(nextTrafficTrend);
    setStatus(overallStatus(nextAd, nextTraffic, nextTrafficSources));
    lastReadAt.current = Date.now();
  }, [device, enabled, projectId, trafficTrendSource]);

  const reload = useCallback(() => fetchOverview(false), [fetchOverview]);

  useEffect(() => {
    void fetchOverview(false);
    const handleVisibility = () => {
      if (
        document.visibilityState === 'visible'
        && Date.now() - lastReadAt.current >= 10 * 60 * 1000
      ) void fetchOverview(true);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchOverview]);

  return {
    status,
    ad,
    traffic,
    trafficSources,
    paidTraffic,
    trafficTrend,
    reload
  };
}
