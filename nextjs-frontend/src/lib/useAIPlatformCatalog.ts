'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';

export type AIPlatformCatalogItem = {
  code: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  selectable: boolean;
  unavailable_reason?: string | null;
};

const unavailableLabels: Record<string, string> = {
  missing_api_key: '管理员尚未配置',
  missing_base_url: '接口地址未配置',
  missing_model: '默认模型未配置',
  disabled: '已停用',
  config_unavailable: '配置暂不可用'
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
        : `（${unavailableLabels[item.unavailable_reason || ''] || '当前不可用'}）`;
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
