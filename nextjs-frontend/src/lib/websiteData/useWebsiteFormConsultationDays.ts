'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import axios from '@/lib/axiosConfig';
import {
  readWebsiteFormDisabledMessage,
  rememberWebsiteFormDisabled
} from './moduleState';
import type {
  WebsiteFormConsultationData,
  WebsiteFormSource
} from './useWebsiteFormConsultations';
import { MARKETING_SOURCE_KEYS } from '@/lib/marketing/sourceCatalog';

export type WebsiteFormConsultationDay = {
  date: string;
  formConsultationRecords: string;
  sourceBreakdown: WebsiteFormSource[];
};

export type WebsiteFormConsultationDaysData = WebsiteFormConsultationData & {
  days: WebsiteFormConsultationDay[];
};

type State = {
  state: 'IDLE' | 'LOADING' | 'AVAILABLE' | 'ZERO' | 'FALLBACK' | 'SOURCE_ERROR';
  data: WebsiteFormConsultationDaysData | null;
  errorCode: string | null;
  errorMessage: string | null;
  reload: () => Promise<void>;
};

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
      || !MARKETING_SOURCE_KEYS.has((row as WebsiteFormSource).sourceKey)
      || seen.has((row as WebsiteFormSource).sourceKey)
      || !count((row as WebsiteFormSource).formConsultationRecords)
      || BigInt((row as WebsiteFormSource).formConsultationRecords) === BigInt(0)
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
    || data.dataCoverage !== 'ALL_FORM_RECORDS'
    || String(data.projectId) !== projectId
    || data.coverage?.from !== from
    || data.coverage?.to !== to
    || data.coverage?.timeZone !== 'Asia/Shanghai'
    || !['DATA', 'ZERO'].includes(data.dataState)
    || !count(data.summary?.formConsultationRecords)
    || !sources(data.sourceBreakdown)
    || !Array.isArray(data.days)
    || !['HIT', 'REFRESHED', 'FALLBACK'].includes(data.cache?.state)
  ) return false;
  const expectedDayCount = (
    Date.parse(`${to}T00:00:00.000Z`)
    - Date.parse(`${from}T00:00:00.000Z`)
  ) / 86400000 + 1;
  if (data.days.length !== expectedDayCount) return false;
  const sourceTotal = data.sourceBreakdown.reduce(
    (sum, row) => sum + BigInt(row.formConsultationRecords),
    BigInt(0)
  );
  if (sourceTotal !== BigInt(data.summary.formConsultationRecords)) return false;
  const expected = new Date(`${from}T00:00:00.000Z`);
  let total = BigInt(0);
  for (const [index, day] of data.days.entries()) {
    const date = new Date(expected);
    date.setUTCDate(date.getUTCDate() + index);
    if (
      day?.date !== date.toISOString().slice(0, 10)
      || !count(day.formConsultationRecords)
      || !sources(day.sourceBreakdown)
    ) return false;
    const dailySourceTotal = day.sourceBreakdown.reduce(
      (sum, row) => sum + BigInt(row.formConsultationRecords),
      BigInt(0)
    );
    if (dailySourceTotal !== BigInt(day.formConsultationRecords)) return false;
    total += BigInt(day.formConsultationRecords);
  }
  const summaryTotal = BigInt(data.summary.formConsultationRecords);
  return total === summaryTotal
    && data.dataState === (summaryTotal === BigInt(0) ? 'ZERO' : 'DATA');
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
    const disabledMessage = readWebsiteFormDisabledMessage();
    if (disabledMessage) {
      setState('SOURCE_ERROR');
      setData(null);
      setErrorCode('WEBSITE_FORM_MODULE_DISABLED');
      setErrorMessage(disabledMessage);
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
      if (details.code === 'WEBSITE_FORM_MODULE_DISABLED') {
        rememberWebsiteFormDisabled(details.message);
      }
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
