'use client';

import { useCallback, useEffect, useState } from 'react';
import axios from '@/lib/axiosConfig';

export type MarketingCapabilities = {
  pilotDataAccess: boolean;
  formalNavigation: boolean;
  adsRead: boolean;
  trafficRead: boolean;
  refreshAds: boolean;
};

const BLOCKED_CAPABILITIES: MarketingCapabilities = {
  pilotDataAccess: false,
  formalNavigation: false,
  adsRead: false,
  trafficRead: false,
  refreshAds: false
};

type MarketingCapabilityState = {
  moduleState: string | null;
  capabilities: MarketingCapabilities;
  loading: boolean;
  error: boolean;
  reload: () => Promise<void>;
};

export default function useMarketingCapabilities(
  enabled = true
): MarketingCapabilityState {
  const [moduleState, setModuleState] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState(BLOCKED_CAPABILITIES);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    if (!enabled) {
      setModuleState(null);
      setCapabilities(BLOCKED_CAPABILITIES);
      setLoading(false);
      setError(false);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const response = await axios.get('/api/marketing/status');
      setModuleState(response.data.moduleState || null);
      setCapabilities({
        ...BLOCKED_CAPABILITIES,
        ...(response.data.capabilities || {})
      });
    } catch {
      setModuleState(null);
      setCapabilities(BLOCKED_CAPABILITIES);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { moduleState, capabilities, loading, error, reload };
}
