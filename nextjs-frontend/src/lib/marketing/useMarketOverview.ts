'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import axios from '@/lib/axiosConfig';
import {
  assertMarketingDashboardRootResponse,
  marketingSnapshotWarning
} from './adPerformanceAdapter';
import type {
  MarketingDashboardResponse
} from './generated/marketingAdReadApi';

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
  status: 'IDLE' | 'LOADING' | 'READY' | 'EMPTY' | 'SOURCE_ERROR';
  ad: SourceSlot<MarketingDashboardResponse>;
  reload: () => Promise<void>;
};

const idleSlot = (): SourceSlot<MarketingDashboardResponse> => ({
  state: 'IDLE',
  data: null,
  errorCode: null,
  errorMessage: null,
  readAt: null
});

function rejectedSlot(reason: unknown, fallback: string): SourceSlot<MarketingDashboardResponse> {
  const response = (
    reason && typeof reason === 'object' && 'response' in reason
      ? (reason as {
        response?: {
          data?: { error?: { code?: unknown; message?: unknown } };
        };
      }).response
      : undefined
  );
  const ownCode = reason && typeof reason === 'object' && 'code' in reason
    ? reason.code
    : null;
  const code = response?.data?.error?.code || ownCode;
  const message = response?.data?.error?.message;
  return {
    state: 'SOURCE_ERROR',
    data: null,
    errorCode: typeof code === 'string' ? code : null,
    errorMessage: typeof message === 'string' ? message : fallback,
    readAt: null
  };
}

function adSlot(
  data: MarketingDashboardResponse,
  readAt: string
): SourceSlot<MarketingDashboardResponse> {
  const content = data.states?.snapshotContentState;
  const stale = data.states?.snapshotFreshnessState === 'STALE';
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
    readAt: data.coverage?.lastSuccessfulAt || readAt
  };
}

function fulfilledAdSlot(
  value: unknown,
  readAt: string,
  projectId: string
): SourceSlot<MarketingDashboardResponse> {
  try {
    assertMarketingDashboardRootResponse(value, projectId);
    return adSlot(value, readAt);
  } catch (error) {
    return rejectedSlot(error, '广告快照响应合同无效');
  }
}

function statusFor(slot: SourceSlot): MarketOverviewState['status'] {
  if (slot.state === 'SOURCE_ERROR') return 'SOURCE_ERROR';
  if (slot.state === 'ZERO' || slot.state === 'NO_DATA') return 'EMPTY';
  return 'READY';
}

export default function useMarketOverview({
  projectId,
  enabled
}: {
  projectId: string;
  enabled: boolean;
}): MarketOverviewState {
  const [ad, setAd] = useState<SourceSlot<MarketingDashboardResponse>>(idleSlot);
  const [status, setStatus] = useState<MarketOverviewState['status']>('IDLE');
  const requestSequence = useRef(0);
  const lastReadAt = useRef(0);

  const fetchOverview = useCallback(async (silent = false) => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    if (!enabled || !projectId) {
      setAd(idleSlot());
      setStatus('IDLE');
      return;
    }
    if (!silent) {
      setStatus('LOADING');
      setAd((current) => ({ ...current, state: 'LOADING' }));
    }
    let nextAd: SourceSlot<MarketingDashboardResponse>;
    try {
      const response = await axios.get(
        `/api/marketing/projects/${encodeURIComponent(projectId)}/dashboard`
      );
      nextAd = fulfilledAdSlot(response.data, new Date().toISOString(), projectId);
    } catch (error) {
      nextAd = rejectedSlot(error, '广告快照读取失败');
    }
    if (sequence !== requestSequence.current) return;
    setAd(nextAd);
    setStatus(statusFor(nextAd));
    lastReadAt.current = Date.now();
  }, [enabled, projectId]);

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
      requestSequence.current += 1;
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchOverview]);

  // 广告快照过期时后端已触发后台刷新并返回 STALE 旧快照 + activeRun；
  // 前端轮询刷新运行，成功后静默重拉拿到新数据（轮询用定时器递归，不用周期轮询）。
  useEffect(() => {
    const runId = ad.data?.activeRun?.runId;
    if (ad.state !== 'STALE' || !runId || !projectId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      if (cancelled) return;
      try {
        const response = await axios.get(
          `/api/marketing/projects/${encodeURIComponent(projectId)}`
            + `/refresh-runs/${runId}`
        );
        const status = response.data?.status;
        if (cancelled) return;
        if (status === 'SUCCEEDED') {
          void fetchOverview(true);
          return;
        }
        if (status === 'FAILED' || status === 'INTERRUPTED') return;
        timer = setTimeout(poll, 3000);
      } catch {
        // 轮询失败停止，保留 STALE 旧快照与失败提示。
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [ad.state, ad.data?.activeRun?.runId, projectId, fetchOverview]);

  return { status, ad, reload };
}
