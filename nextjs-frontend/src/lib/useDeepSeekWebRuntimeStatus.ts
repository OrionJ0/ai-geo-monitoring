'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import axios from '@/lib/axiosConfig';

export const POLL_INTERVAL_MS = 30_000;

export type DeepSeekWebRuntimeStatus = {
  schema_version: 'deepseek-web-runtime-v1';
  platform: 'deepseek-web';
  enabled: boolean;
  state: 'idle' | 'busy' | 'login_required' | 'verification_required' | 'unavailable' | 'shutting_down';
  running_count: number;
  queued_count: number;
  pending_count: number;
  needs_action: boolean;
  action_code: string | null;
  reason_code: string | null;
  observed_at: string;
};

export function useDeepSeekWebRuntimeStatus() {
  const [status, setStatus] = useState<DeepSeekWebRuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    try {
      const response = await axios.get('/api/ai-platforms/deepseek-web/runtime-status');
      if (requestVersion.current !== version) return;
      const nextStatus = response?.data?.data;
      if (!nextStatus || nextStatus.schema_version !== 'deepseek-web-runtime-v1') {
        throw new Error('invalid DeepSeek Web runtime status');
      }
      setStatus(nextStatus);
      setUnavailable(false);
    } catch {
      if (requestVersion.current !== version) return;
      setUnavailable(true);
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    const stopPolling = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const startPolling = () => {
      stopPolling();
      if (document.visibilityState !== 'visible') return;
      void refresh();
      timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') void refresh();
      }, POLL_INTERVAL_MS);
    };
    const handleVisibilityChange = () => {
      requestVersion.current += 1;
      if (document.visibilityState !== 'visible') {
        stopPolling();
        return;
      }
      startPolling();
    };

    startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      requestVersion.current += 1;
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refresh]);

  return { status, loading, unavailable, refresh };
}
