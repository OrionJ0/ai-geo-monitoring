'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import axios from '@/lib/axiosConfig';
import {
  MARKETING_SOURCE_KEYS,
  type MarketingSourceKey
} from '@/lib/marketing/sourceCatalog';

export type WebsiteFormSourceKey = MarketingSourceKey;

export type WebsiteFormSource = {
  sourceKey: WebsiteFormSourceKey;
  upstreamSources: string[];
  attributedFormSubmissionSessions: string;
};

export type WebsiteFormConsultationData = {
  projectId: string;
  sourceSystem: 'GATO_WEBSITE';
  consultationType: 'WEBSITE_FORM';
  dataCoverage: 'ATTRIBUTED_SESSION_SUBMISSIONS_ONLY';
  formRecordTotalAvailable: false;
  coverage: { from: string; to: string; timeZone: 'Asia/Shanghai' };
  dataState: 'DATA' | 'ZERO';
  summary: { attributedFormSubmissionSessions: string };
  sourceBreakdown: WebsiteFormSource[];
  cache: {
    state: 'HIT' | 'REFRESHED' | 'FALLBACK';
    refreshedAt: string;
    expiresAt: string;
  };
};

type WebsiteFormConsultationState = {
  state: 'IDLE' | 'LOADING' | 'AVAILABLE' | 'ZERO' | 'FALLBACK' | 'SOURCE_ERROR';
  data: WebsiteFormConsultationData | null;
  errorCode: string | null;
  errorMessage: string | null;
  reload: () => Promise<void>;
};

function exactCount(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/u.test(value);
}

function validResponse(
  value: unknown,
  projectId: string,
  from: string,
  to: string
): value is WebsiteFormConsultationData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, any>;
  if (
    data.sourceSystem !== 'GATO_WEBSITE'
    || data.consultationType !== 'WEBSITE_FORM'
    || data.dataCoverage !== 'ATTRIBUTED_SESSION_SUBMISSIONS_ONLY'
    || data.formRecordTotalAvailable !== false
    || String(data.projectId) !== projectId
    || data.coverage?.from !== from
    || data.coverage?.to !== to
    || data.coverage?.timeZone !== 'Asia/Shanghai'
    || !['DATA', 'ZERO'].includes(data.dataState)
    || !exactCount(data.summary?.attributedFormSubmissionSessions)
    || !Array.isArray(data.sourceBreakdown)
    || !['HIT', 'REFRESHED', 'FALLBACK'].includes(data.cache?.state)
  ) return false;
  const seen = new Set<string>();
  let sourceTotal = BigInt(0);
  for (const row of data.sourceBreakdown) {
    if (
      !MARKETING_SOURCE_KEYS.has(row?.sourceKey)
      || seen.has(row.sourceKey)
      || !Array.isArray(row?.upstreamSources)
      || row.upstreamSources.some((source: unknown) => (
        typeof source !== 'string' || !source || source.length > 64
      ))
      || !exactCount(row?.attributedFormSubmissionSessions)
    ) return false;
    seen.add(row.sourceKey);
    sourceTotal += BigInt(row.attributedFormSubmissionSessions);
  }
  return sourceTotal === BigInt(
    data.summary.attributedFormSubmissionSessions
  );
}

function errorDetails(error: unknown) {
  const response = error && typeof error === 'object' && 'response' in error
    ? (error as {
        response?: {
          data?: { error?: { code?: unknown; message?: unknown } };
        };
      }).response
    : undefined;
  return {
    code: typeof response?.data?.error?.code === 'string'
      ? response.data.error.code
      : 'WEBSITE_FORM_CONSULTATION_FAILED',
    message: typeof response?.data?.error?.message === 'string'
      ? response.data.error.message
      : '官网表单咨询读取失败'
  };
}

export default function useWebsiteFormConsultations({
  projectId,
  enabled,
  from,
  to
}: {
  projectId: string;
  enabled: boolean;
  from: string | null;
  to: string | null;
}): WebsiteFormConsultationState {
  const [state, setState] = useState<WebsiteFormConsultationState['state']>(
    'IDLE'
  );
  const [data, setData] = useState<WebsiteFormConsultationData | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const lastReadAt = useRef(0);

  const read = useCallback(async (silent = false) => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    if (!enabled || !projectId || !from || !to) {
      setState('IDLE');
      setData(null);
      setErrorCode(null);
      setErrorMessage(null);
      return;
    }
    if (!silent) setState('LOADING');
    try {
      const encodedProjectId = encodeURIComponent(projectId);
      const response = await axios.get(
        `/api/website-data/projects/${encodedProjectId}/form-consultations`,
        { params: { from, to } }
      );
      if (sequence !== requestSequence.current) return;
      if (!validResponse(response.data, projectId, from, to)) {
        const error = new Error('官网表单咨询响应合同无效');
        (error as Error & { code: string }).code =
          'WEBSITE_FORM_RESPONSE_INVALID';
        throw error;
      }
      setData(response.data);
      setState(response.data.cache.state === 'FALLBACK'
        ? 'FALLBACK'
        : response.data.dataState === 'ZERO' ? 'ZERO' : 'AVAILABLE');
      setErrorCode(null);
      setErrorMessage(null);
      lastReadAt.current = Date.now();
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      const details = errorDetails(error);
      setData(null);
      setState('SOURCE_ERROR');
      setErrorCode(
        (error as { code?: string })?.code || details.code
      );
      setErrorMessage(details.message);
      lastReadAt.current = Date.now();
    }
  }, [enabled, from, projectId, to]);

  useEffect(() => {
    void read(false);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void read(true);
    }, 10 * 60 * 1000);
    const handleVisibility = () => {
      if (
        document.visibilityState === 'visible'
        && Date.now() - lastReadAt.current >= 10 * 60 * 1000
      ) void read(true);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      requestSequence.current += 1;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [read]);

  return {
    state,
    data,
    errorCode,
    errorMessage,
    reload: () => read(false)
  };
}
