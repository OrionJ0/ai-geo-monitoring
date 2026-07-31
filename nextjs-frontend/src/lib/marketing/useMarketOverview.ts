'use client';

import { useCallback, useEffect, useState } from 'react';
import axios from '@/lib/axiosConfig';

type SourceSlotState =
  | 'IDLE'
  | 'LOADING'
  | 'AVAILABLE'
  | 'ZERO'
  | 'NO_DATA'
  | 'STALE'
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

function adSlot(data: Record<string, any>, readAt: string): SourceSlot {
  const content = data?.states?.snapshotContentState;
  return {
    state: data?.states?.snapshotFreshnessState === 'STALE'
      ? 'STALE'
      : content === 'ZERO'
        ? 'ZERO'
        : content === 'NONE'
          ? 'NO_DATA'
          : 'AVAILABLE',
    data,
    errorCode: null,
    errorMessage: null,
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

function overallStatus(ad: SourceSlot, traffic: SourceSlot) {
  const successes = [ad, traffic].filter(
    (slot) => slot.state !== 'SOURCE_ERROR'
  );
  if (successes.length === 0) return 'SOURCE_ERROR' as const;
  if (successes.length === 1) return 'PARTIAL' as const;
  if (successes.every((slot) => ['ZERO', 'NO_DATA'].includes(slot.state))) {
    return 'EMPTY' as const;
  }
  return 'READY' as const;
}

export default function useMarketOverview({
  projectId,
  enabled
}: {
  projectId: string;
  enabled: boolean;
}): MarketOverviewState {
  const [ad, setAd] = useState<SourceSlot>(idleSlot);
  const [traffic, setTraffic] = useState<SourceSlot>(idleSlot);
  const [status, setStatus] = useState<MarketOverviewState['status']>('IDLE');

  const reload = useCallback(async () => {
    if (!enabled || !projectId) {
      setAd(idleSlot());
      setTraffic(idleSlot());
      setStatus('IDLE');
      return;
    }
    setStatus('LOADING');
    setAd((current) => ({ ...current, state: 'LOADING' }));
    setTraffic((current) => ({ ...current, state: 'LOADING' }));
    const encodedProjectId = encodeURIComponent(projectId);
    const [adResult, trafficResult] = await Promise.allSettled([
      axios.get(`/api/marketing/projects/${encodedProjectId}/dashboard`),
      axios.get(`/api/marketing/projects/${encodedProjectId}/tongji-trend`)
    ]);
    const readAt = new Date().toISOString();
    const nextAd = adResult.status === 'fulfilled'
      ? adSlot(adResult.value.data, readAt)
      : rejectedSlot(adResult.reason, '广告快照读取失败');
    const nextTraffic = trafficResult.status === 'fulfilled'
      ? trafficSlot(trafficResult.value.data, readAt)
      : rejectedSlot(trafficResult.reason, '网站流量读取失败');
    setAd(nextAd);
    setTraffic(nextTraffic);
    setStatus(overallStatus(nextAd, nextTraffic));
  }, [enabled, projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { status, ad, traffic, reload };
}
