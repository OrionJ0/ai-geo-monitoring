'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import axios from '@/lib/axiosConfig';

export type ConsultationType = 'WEBSITE_FORM' | 'ONLINE_CHAT';
export type ConsultationDevice = 'PC' | 'MOBILE' | 'OTHER' | 'UNKNOWN';
export type ConsultationSourceStatus = {
  sourceSystem: 'GATO_WEBSITE' | 'KF53';
  consultationType: ConsultationType;
  sourceState: 'AVAILABLE' | 'PARTIAL' | 'AGGREGATE_ONLY' | 'NOT_CONNECTED' | 'ERROR';
  recordCoverage: 'FULL' | 'PARTIAL' | 'NONE';
  reasonCode: string | null;
};

export type MaskedContact = {
  displayName: string | null;
  phone: string | null;
  email: string | null;
};

export type ConsultationRecordSummary = {
  id: string;
  sourceSystem: 'GATO_WEBSITE' | 'KF53';
  consultationType: ConsultationType;
  occurredAt: string;
  source: { key: string; label: string };
  landingPage: { label: string | null; path: string | null };
  contentSummary: string;
  maskedContact: MaskedContact;
  device: ConsultationDevice;
  detailAvailable: boolean;
};

export type WebsiteFormDetail = ConsultationRecordSummary & {
  consultationType: 'WEBSITE_FORM';
  externalRecordUrl: string | null;
  form: {
    content: string;
    fields: Array<{ label: string; value: string }>;
  };
};

export type OnlineChatDetail = ConsultationRecordSummary & {
  consultationType: 'ONLINE_CHAT';
  externalRecordUrl: string | null;
  conversation: {
    messages: Array<{
      sender: 'VISITOR' | 'AGENT';
      sentAt: string;
      content: string;
    }>;
  };
};

export type ConsultationRecordDetail = WebsiteFormDetail | OnlineChatDetail;

export type ConsultationRecordListData = {
  schemaVersion: 'consultation_records_v1';
  projectId: string;
  coverage: { from: string; to: string; timeZone: 'Asia/Shanghai' };
  coverageState: 'NONE' | 'PARTIAL' | 'COMPLETE';
  sources: ConsultationSourceStatus[];
  items: ConsultationRecordSummary[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
};

export type ConsultationRecordQuery = {
  from: string;
  to: string;
  page: number;
  pageSize: number;
  type: 'ALL' | ConsultationType;
  source: string;
  device: 'ALL' | ConsultationDevice;
  q: string;
  sortBy: 'occurredAt' | 'consultationType' | 'source';
  sortOrder: 'asc' | 'desc';
};

type State = {
  state: 'IDLE' | 'LOADING' | 'AVAILABLE' | 'EMPTY' | 'ERROR';
  data: ConsultationRecordListData | null;
  errorCode: string | null;
  errorMessage: string | null;
  reload: () => Promise<void>;
  loadDetail: (recordId: string) => Promise<ConsultationRecordDetail>;
};

const TYPES = new Set(['WEBSITE_FORM', 'ONLINE_CHAT']);
const SYSTEMS = new Set(['GATO_WEBSITE', 'KF53']);
const DEVICES = new Set(['PC', 'MOBILE', 'OTHER', 'UNKNOWN']);

function safeText(value: unknown, maximum: number, nullable = false) {
  if (nullable && value === null) return true;
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function containsRawPii(value: string) {
  return /\b(?:\d{1,3}\.){3}\d{1,3}\b/u.test(value)
    || /\b(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{1,4}\b/u.test(value)
    || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(value)
    || /(?:\+?86[-\s]?)?1[3-9]\d(?:[-\s]?\d){8}/u.test(value)
    || /\+[1-9]\d(?:[\s().-]?\d){8,14}/u.test(value);
}

function safePublicText(value: unknown, maximum: number) {
  return safeText(value, maximum) && !containsRawPii(value as string);
}

function validContact(value: unknown): value is MaskedContact {
  if (!value || typeof value !== 'object') return false;
  const contact = value as MaskedContact;
  const displayNameValid = contact.displayName === null || (
    safeText(contact.displayName, 40)
    && contact.displayName.includes('*')
    && [...contact.displayName].filter((character) => (
      character !== '*' && !/\s/u.test(character)
    )).length <= 2
  );
  const phoneValid = contact.phone === null || (
    safeText(contact.phone, 40)
    && contact.phone.includes('*')
    && contact.phone.replace(/\D/gu, '').length <= 7
  );
  const emailValid = contact.email === null || (
    safeText(contact.email, 120)
    && /^[^@]*\*[^@]*@[A-Za-z0-9.-]+$/u.test(contact.email)
    && !containsRawPii(contact.email)
  );
  return displayNameValid && phoneValid && emailValid;
}

function validSummary(value: unknown): value is ConsultationRecordSummary {
  if (!value || typeof value !== 'object') return false;
  const row = value as ConsultationRecordSummary;
  const date = new Date(row.occurredAt);
  return safeText(row.id, 128)
    && SYSTEMS.has(row.sourceSystem)
    && TYPES.has(row.consultationType)
    && ((row.sourceSystem === 'GATO_WEBSITE' && row.consultationType === 'WEBSITE_FORM')
      || (row.sourceSystem === 'KF53' && row.consultationType === 'ONLINE_CHAT'))
    && !Number.isNaN(date.getTime())
    && date.toISOString() === row.occurredAt
    && safeText(row.source?.key, 64)
    && safePublicText(row.source?.label, 80)
    && (row.landingPage?.label === null || safePublicText(row.landingPage?.label, 100))
    && (row.landingPage?.path === null
      || (safeText(row.landingPage?.path, 500)
        && row.landingPage.path.startsWith('/')
        && !row.landingPage.path.startsWith('//')))
    && safePublicText(row.contentSummary, 160)
    && validContact(row.maskedContact)
    && DEVICES.has(row.device)
    && typeof row.detailAvailable === 'boolean';
}

function validSourceStatus(value: unknown): value is ConsultationSourceStatus {
  if (!value || typeof value !== 'object') return false;
  const source = value as ConsultationSourceStatus;
  const validShape = SYSTEMS.has(source.sourceSystem)
    && TYPES.has(source.consultationType)
    && ['AVAILABLE', 'PARTIAL', 'AGGREGATE_ONLY', 'NOT_CONNECTED', 'ERROR']
      .includes(source.sourceState)
    && ['FULL', 'PARTIAL', 'NONE'].includes(source.recordCoverage)
    && (source.reasonCode === null || safeText(source.reasonCode, 100));
  if (!validShape) return false;
  const unavailable = ['AGGREGATE_ONLY', 'NOT_CONNECTED', 'ERROR']
    .includes(source.sourceState);
  if (unavailable && source.recordCoverage !== 'NONE') return false;
  if (source.sourceState === 'PARTIAL' && source.recordCoverage !== 'PARTIAL') {
    return false;
  }
  if (source.sourceState === 'AVAILABLE' && source.recordCoverage === 'NONE') {
    return false;
  }
  return !(
    (source.sourceState !== 'AVAILABLE' || source.recordCoverage !== 'FULL')
    && source.reasonCode === null
  );
}

function validList(
  value: unknown,
  projectId: string,
  query: ConsultationRecordQuery
): value is ConsultationRecordListData {
  if (!value || typeof value !== 'object') return false;
  const data = value as ConsultationRecordListData;
  const shapeValid = data.schemaVersion === 'consultation_records_v1'
    && String(data.projectId) === projectId
    && data.coverage?.from === query.from
    && data.coverage?.to === query.to
    && data.coverage?.timeZone === 'Asia/Shanghai'
    && ['NONE', 'PARTIAL', 'COMPLETE'].includes(data.coverageState)
    && Array.isArray(data.sources)
    && data.sources.length === 2
    && data.sources.every(validSourceStatus)
    && Array.isArray(data.items)
    && data.items.every(validSummary)
    && data.pagination?.page === query.page
    && data.pagination?.pageSize === query.pageSize
    && Number.isSafeInteger(data.pagination.totalItems)
    && data.pagination.totalItems >= 0
    && Number.isSafeInteger(data.pagination.totalPages)
    && data.pagination.totalPages >= 0;
  if (!shapeValid) return false;
  const sourceBySystem = new Map(data.sources.map((source) => (
    [source.sourceSystem, source]
  )));
  if (sourceBySystem.size !== 2) return false;
  const expectedCoverage = data.sources.every((source) => (
    source.recordCoverage === 'FULL'
  )) ? 'COMPLETE' : data.sources.some((source) => (
    source.recordCoverage !== 'NONE'
  )) ? 'PARTIAL' : 'NONE';
  const expectedPages = data.pagination.totalItems === 0
    ? 0
    : Math.ceil(data.pagination.totalItems / data.pagination.pageSize);
  const offset = (data.pagination.page - 1) * data.pagination.pageSize;
  const expectedItems = Math.min(
    data.pagination.pageSize,
    Math.max(data.pagination.totalItems - offset, 0)
  );
  return data.coverageState === expectedCoverage
    && data.pagination.totalPages === expectedPages
    && data.items.length === expectedItems
    && data.items.every((item) => {
      const status = sourceBySystem.get(item.sourceSystem);
      return Boolean(status)
        && status?.recordCoverage !== 'NONE'
        && (query.type === 'ALL' || item.consultationType === query.type)
        && (query.source === 'ALL' || item.source.key === query.source)
        && (query.device === 'ALL' || item.device === query.device);
    });
}

function validExternalUrl(value: unknown) {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function validIsoDateTime(value: unknown) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function validDetail(value: unknown, recordId: string): value is ConsultationRecordDetail {
  if (!validSummary(value)) return false;
  const detail = value as ConsultationRecordDetail;
  if (
    detail.id !== recordId
    || detail.detailAvailable !== true
    || !validExternalUrl(detail.externalRecordUrl)
  ) return false;
  if (detail.consultationType === 'WEBSITE_FORM') {
    return safePublicText(detail.form?.content, 20000)
      && Array.isArray(detail.form?.fields)
      && detail.form.fields.length <= 100
      && detail.form.fields.every((field) => (
        safePublicText(field?.label, 80) && safePublicText(field?.value, 4000)
      ))
      && detail.form.fields.reduce((total, field) => (
        total + field.label.length + field.value.length
      ), detail.form.content.length) <= 200000;
  }
  return Array.isArray(detail.conversation?.messages)
    && detail.conversation.messages.length <= 500
    && detail.conversation.messages.some((message) => message.sender === 'VISITOR')
    && detail.conversation.messages.every((message) => (
      ['VISITOR', 'AGENT'].includes(message?.sender)
      && safePublicText(message?.content, 10000)
      && validIsoDateTime(message?.sentAt)
    ))
    && detail.conversation.messages.reduce((total, message) => (
      total + message.content.length
    ), 0) <= 200000;
}

function errorDetails(error: unknown, fallback: string) {
  const response = error && typeof error === 'object' && 'response' in error
    ? (error as {
        response?: { data?: { error?: { code?: unknown; message?: unknown } } };
      }).response
    : undefined;
  return {
    code: typeof response?.data?.error?.code === 'string'
      ? response.data.error.code
      : 'CONSULTATION_RECORD_FAILED',
    message: typeof response?.data?.error?.message === 'string'
      ? response.data.error.message
      : fallback
  };
}

export default function useConsultationRecords({
  projectId,
  enabled,
  query
}: {
  projectId: string;
  enabled: boolean;
  query: ConsultationRecordQuery;
}): State {
  const [state, setState] = useState<State['state']>('IDLE');
  const [data, setData] = useState<ConsultationRecordListData | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const sequence = useRef(0);

  const read = useCallback(async () => {
    const request = sequence.current + 1;
    sequence.current = request;
    if (!enabled || !projectId) {
      setState('IDLE');
      setData(null);
      return;
    }
    setState('LOADING');
    try {
      const response = await axios.get(
        `/api/consultations/projects/${encodeURIComponent(projectId)}/records`,
        { params: query }
      );
      if (request !== sequence.current) return;
      if (!validList(response.data, projectId, query)) {
        throw Object.assign(new Error('咨询记录列表响应合同无效'), {
          code: 'CONSULTATION_RECORD_RESPONSE_INVALID'
        });
      }
      setData(response.data);
      setState(response.data.items.length === 0 ? 'EMPTY' : 'AVAILABLE');
      setErrorCode(null);
      setErrorMessage(null);
    } catch (error) {
      if (request !== sequence.current) return;
      const details = errorDetails(error, '咨询记录列表读取失败');
      setData(null);
      setState('ERROR');
      setErrorCode((error as { code?: string })?.code || details.code);
      setErrorMessage(details.message);
    }
  }, [enabled, projectId, query]);

  useEffect(() => {
    void read();
    return () => { sequence.current += 1; };
  }, [read]);

  const loadDetail = useCallback(async (recordId: string) => {
    try {
      const response = await axios.get(
        `/api/consultations/projects/${encodeURIComponent(projectId)}`
          + `/records/${encodeURIComponent(recordId)}`
      );
      if (
        response.data?.schemaVersion !== 'consultation_records_v1'
        || String(response.data?.projectId) !== projectId
        || !validDetail(response.data?.detail, recordId)
      ) throw new Error('咨询详情响应合同无效');
      return response.data.detail as ConsultationRecordDetail;
    } catch (error) {
      const details = errorDetails(error, '咨询详情读取失败');
      throw Object.assign(new Error(details.message), { code: details.code });
    }
  }, [projectId]);

  return { state, data, errorCode, errorMessage, reload: read, loadDetail };
}
