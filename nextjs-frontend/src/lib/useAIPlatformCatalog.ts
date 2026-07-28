'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from '@/lib/axiosConfig';
import { getUnavailablePlatformLabel } from '@/utils/platformSelectionStatus.cjs';

export type AIPlatformCapabilities = {
  monitoring: boolean;
  analysis: boolean;
  prompt_generation: boolean;
  model_listing: boolean;
  api_key_management: boolean;
  connection_test: boolean;
  api_web_search_test: boolean;
  direct_stream: boolean;
  legacy_schedule: boolean;
  interactive_login: boolean;
};

export type AIPlatformCatalogItem = {
  code: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  selectable: boolean;
  unavailable_reason?: string | null;
  capabilities?: AIPlatformCapabilities;
};

export function useAIPlatformCatalog() {
  const [platforms, setPlatforms] = useState<AIPlatformCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await axios.get('/api/ai-platforms');
      setPlatforms(Array.isArray(response?.data?.data) ? response.data.data : []);
    } catch {
      setPlatforms([]);
      setError('监测平台目录加载失败，请刷新后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const labels = useMemo<Record<string, string>>(
    () => Object.fromEntries(platforms.map((item) => [item.code, item.name || item.code])),
    [platforms]
  );
  const selectableCodes = useMemo(
    () => platforms.filter((item) => item.selectable).map((item) => item.code),
    [platforms]
  );
  const options = useMemo(
    () => platforms.map((item) => {
      const suffix = item.selectable
        ? ''
        : `（${getUnavailablePlatformLabel(item.unavailable_reason)}）`;
      return {
        value: item.code,
        label: `${item.name || item.code}${suffix}`,
        disabled: !item.selectable
      };
    }),
    [platforms]
  );

  return { platforms, labels, selectableCodes, options, loading, error, refresh };
}
