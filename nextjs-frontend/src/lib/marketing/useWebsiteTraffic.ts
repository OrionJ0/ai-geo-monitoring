'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import axios from '@/lib/axiosConfig';
import type {
  WebsiteDevice,
  WebsiteMetric,
  WebsitePageReport,
  WebsitePageView,
  WebsiteSourceKey,
  WebsiteTrafficOverview
} from './websiteTrafficTypes';
import {
  assertWebsitePageReport,
  assertWebsiteTrafficOverview
} from './websiteTrafficTypes';

export type WebsiteTrafficQuery = {
  projectId: string;
  enabled: boolean;
  device: WebsiteDevice;
  from: string;
  to: string;
  source: WebsiteSourceKey;
  metric: WebsiteMetric;
};

export type WebsitePagesQuery = {
  projectId: string;
  enabled: boolean;
  device: WebsiteDevice;
  from: string;
  to: string;
  view: WebsitePageView;
  page: number;
  pageSize: number;
  sortBy: string;
  sortOrder: 'ascend' | 'descend';
  query: string;
};

function readError(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object' || !('response' in error)) {
    return fallback;
  }
  const response = error as {
    response?: { data?: { error?: { message?: unknown } } };
  };
  const message = response.response?.data?.error?.message;
  return typeof message === 'string' && message ? message : fallback;
}

export function useWebsiteTrafficOverview(query: WebsiteTrafficQuery) {
  const [data, setData] = useState<WebsiteTrafficOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestVersion = useRef(0);

  const reload = useCallback(async () => {
    if (!query.enabled || !query.projectId || !query.from || !query.to) return;
    const version = ++requestVersion.current;
    setLoading(true);
    setError('');
    try {
      const response = await axios.get<WebsiteTrafficOverview>(
        `/api/marketing/projects/${encodeURIComponent(query.projectId)}`
          + '/website-traffic-overview',
        {
          params: {
            device: query.device,
            from: query.from,
            to: query.to,
            source: query.source,
            metric: query.metric
          }
        }
      );
      if (requestVersion.current !== version) return;
      assertWebsiteTrafficOverview(response.data, query);
      setData(response.data);
    } catch (requestError) {
      if (requestVersion.current !== version) return;
      setError(readError(requestError, '网站流量读取失败，请稍后重试。'));
      setData((current) => current?.cache.state === 'FALLBACK' ? current : null);
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void reload();
    return () => {
      requestVersion.current += 1;
    };
  }, [reload]);

  return { data, loading, error, reload };
}

export function useWebsitePageReport(query: WebsitePagesQuery) {
  const [data, setData] = useState<WebsitePageReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestVersion = useRef(0);

  const reload = useCallback(async () => {
    if (!query.enabled || !query.projectId || !query.from || !query.to) return;
    const version = ++requestVersion.current;
    setLoading(true);
    setError('');
    try {
      const response = await axios.get<WebsitePageReport>(
        `/api/marketing/projects/${encodeURIComponent(query.projectId)}`
          + '/website-traffic-pages',
        {
          params: {
            device: query.device,
            from: query.from,
            to: query.to,
            view: query.view,
            page: query.page,
            pageSize: query.pageSize,
            sortBy: query.sortBy,
            sortOrder: query.sortOrder,
            query: query.query
          }
        }
      );
      if (requestVersion.current !== version) return;
      assertWebsitePageReport(response.data, query);
      setData(response.data);
    } catch (requestError) {
      if (requestVersion.current !== version) return;
      setData(null);
      setError(readError(requestError, '页面表现读取失败，请稍后重试。'));
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void reload();
    return () => {
      requestVersion.current += 1;
    };
  }, [reload]);

  return { data, loading, error, reload };
}
