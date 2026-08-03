'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import axios from '@/lib/axiosConfig';
import type {
  WebsiteFormConsultationData,
  WebsiteFormSource
} from './useWebsiteFormConsultations';

export type WebsiteFormConsultationDay = {
  date: string;
  attributedFormSubmissionSessions: string;
  sourceBreakdown: WebsiteFormSource[];
};

export type WebsiteFormConsultationDaysData = WebsiteFormConsultationData & {
  capabilities: {
    dailyBreakdown: true;
    formRecordTotal: false;
    unattributedFormRecords: false;
    attributionRate: false;
  };
  attributionCoverage: {
    state: 'FORM_RECORD_TOTAL_UNAVAILABLE';
    attributedFormSubmissionSessions: string;
    formRecordTotal: null;
    unattributedFormRecords: null;
    attributionRatePercent: null;
  };
  days: WebsiteFormConsultationDay[];
};

type State = {
  state: 'IDLE' | 'LOADING' | 'AVAILABLE' | 'ZERO' | 'FALLBACK' | 'SOURCE_ERROR';
  data: WebsiteFormConsultationDaysData | null;
  errorCode: string | null;
  errorMessage: string | null;
  reload: () => Promise<void>;
};

const SOURCE_KEYS = new Set([
  'BAIDU_PAID',
  'DIRECT',
  'ORGANIC_SEARCH',
  'REFERRAL',
  'CAMPAIGN',
  'SOCIAL',
  'UNKNOWN'
]);

function count(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/u.test(value);
}

function sources(value: unknown): value is WebsiteFormSource[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  return value.every((row) => {
    if (
      !row
      || typeof row !== 'object'
      || !SOURCE_KEYS.has((row as WebsiteFormSource).sourceKey)
      || seen.has((row as WebsiteFormSource).sourceKey)
      || !count((row as WebsiteFormSource).attributedFormSubmissionSessions)
      || !Array.isArray((row as WebsiteFormSource).upstreamSources)
    ) return false;
    seen.add((row as WebsiteFormSource).sourceKey);
    return true;
  });
}

function validResponse(
  value: unknown,
  projectId: string,
  from: string,
  to: string
): value is WebsiteFormConsultationDaysData {
  if (!value || typeof value !== 'object') return false;
  const data = value as WebsiteFormConsultationDaysData;
  if (
    data.sourceSystem !== 'GATO_WEBSITE'
    || data.consultationType !== 'WEBSITE_FORM'
    || data.dataCoverage !== 'ATTRIBUTED_SESSION_SUBMISSIONS_ONLY'
    || data.formRecordTotalAvailable !== false
    || String(data.projectId) !== projectId
    || data.coverage?.from !== from
    || data.coverage?.to !== to
    || data.coverage?.timeZone !== 'Asia/Shanghai'
    || !count(data.summary?.attributedFormSubmissionSessions)
    || !sources(data.sourceBreakdown)
    || !Array.isArray(data.days)
    || data.capabilities?.dailyBreakdown !== true
  ) return false;
  const expected = new Date(`${from}T00:00:00.000Z`);
  let total = BigInt(0);
  for (const [index, day] of data.days.entries()) {
    const date = new Date(expected);
    date.setUTCDate(date.getUTCDate() + index);
    if (
      day?.date !== date.toISOString().slice(0, 10)
      || !count(day.attributedFormSubmissionSessions)
      || !sources(day.sourceBreakdown)
    ) return false;
    total += BigInt(day.attributedFormSubmissionSessions);
  }
  return total === BigInt(data.summary.attributedFormSubmissionSessions);
}

function errorDetails(error: unknown) {
  const response = error && typeof error === 'object' && 'response' in error
    ? (error as {
        response?: { data?: { error?: { code?: unknown; message?: unknown } } };
      }).response
    : undefined;
  return {
    code: typeof response?.data?.error?.code === 'string'
      ? response.data.error.code
      : 'WEBSITE_FORM_DAILY_FAILED',
    message: typeof response?.data?.error?.message === 'string'
      ? response.data.error.message
      : '官网表单逐日数据读取失败'
  };
}

export default function useWebsiteFormConsultationDays({
  projectId,
  enabled,
  from,
  to
}: {
  projectId: string;
  enabled: boolean;
  from: string | null;
  to: string | null;
}): State {
  const [state, setState] = useState<State['state']>('IDLE');
  const [data, setData] = useState<WebsiteFormConsultationDaysData | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const sequence = useRef(0);

  const read = useCallback(async () => {
    const request = sequence.current + 1;
    sequence.current = request;
    if (!enabled || !projectId || !from || !to) {
      setState('IDLE');
      setData(null);
      setErrorCode(null);
      setErrorMessage(null);
      return;
    }
    setState('LOADING');
    try {
      const response = await axios.get(
        `/api/website-data/projects/${encodeURIComponent(projectId)}`
          + '/form-consultation-days',
        { params: { from, to } }
      );
      if (request !== sequence.current) return;
      if (!validResponse(response.data, projectId, from, to)) {
        throw Object.assign(new Error('官网表单逐日响应合同无效'), {
          code: 'WEBSITE_FORM_DAILY_RESPONSE_INVALID'
        });
      }
      setData(response.data);
      setState(response.data.cache.state === 'FALLBACK'
        ? 'FALLBACK'
        : response.data.dataState === 'ZERO' ? 'ZERO' : 'AVAILABLE');
      setErrorCode(null);
      setErrorMessage(null);
    } catch (error) {
      if (request !== sequence.current) return;
      const details = errorDetails(error);
      setData(null);
      setState('SOURCE_ERROR');
      setErrorCode((error as { code?: string })?.code || details.code);
      setErrorMessage(details.message);
    }
  }, [enabled, from, projectId, to]);

  useEffect(() => {
    void read();
    return () => { sequence.current += 1; };
  }, [read]);

  return { state, data, errorCode, errorMessage, reload: read };
}
