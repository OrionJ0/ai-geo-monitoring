'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { Column, Line } from '@ant-design/plots';
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Pagination,
  Select,
  Skeleton,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography
} from 'antd';
import type { TableColumnsType, TableProps } from 'antd';
import {
  ExportOutlined,
  LineChartOutlined,
  SearchOutlined
} from '@ant-design/icons';
import useDefaultProjectContext from '@/lib/useDefaultProjectContext';
import useWebsiteFormConsultationDays from '@/lib/websiteData/useWebsiteFormConsultationDays';
import useConsultationRecords, {
  type ConsultationRecordDetail,
  type ConsultationRecordListData,
  type ConsultationRecordQuery,
  type ConsultationRecordSummary,
  type ConsultationType
} from '@/lib/consultations/useConsultationRecords';
import MarketingPageFilters from '@/components/marketing/MarketingPageFilters';
import { useMarketingFilters } from '@/components/marketing/MarketingFiltersContext';
import MarketingMetricCard, {
  MarketingMetricGrid
} from '@/components/marketing/MarketingMetricCard';
import { MARKETING_SOURCE_LABELS } from '@/lib/marketing/sourceCatalog';
import styles from './consultations.module.css';
const { Text, Title } = Typography;

const TYPE_LABELS: Record<ConsultationType, string> = {
  WEBSITE_FORM: '表单咨询',
  ONLINE_CHAT: '在线客服'
};

const SOURCE_LABELS: Record<string, string> = {
  ...MARKETING_SOURCE_LABELS
};

const DEVICE_LABELS: Record<string, string> = {
  PC: 'PC',
  MOBILE: '移动端',
  OTHER: '其他设备',
  UNKNOWN: '设备未知'
};

function formatCount(value: string | null | undefined) {
  if (!value) return '—';
  return BigInt(value).toLocaleString('zh-CN');
}

function formatCountChange(
  current: string | null | undefined,
  previous: string | null | undefined
) {
  if (current == null || previous == null || BigInt(previous) === BigInt(0)) return null;
  const currentValue = BigInt(current);
  const previousValue = BigInt(previous);
  const difference = currentValue - previousValue;
  const absoluteDifference = difference < BigInt(0) ? -difference : difference;
  const tenths = (
    (absoluteDifference * BigInt(1000) * BigInt(2) + previousValue)
    / (previousValue * BigInt(2))
  );
  const sign = difference > BigInt(0) ? '+' : difference < BigInt(0) ? '-' : '';
  return `${sign}${tenths / BigInt(10)}.${tenths % BigInt(10)}%`;
}

function formatTime(value: string) {
  return dayjs(value).format('MM-DD HH:mm');
}

function fullTime(value: string) {
  return dayjs(value).format('YYYY-MM-DD HH:mm');
}

function contactText(record: ConsultationRecordSummary) {
  return record.maskedContact.displayName
    || record.maskedContact.phone
    || record.maskedContact.email
    || '—';
}

function sourceStatusMessage(reasonCode: string | null | undefined) {
  if (reasonCode === 'WEBSITE_FORM_RECORD_API_UNVERIFIED') {
    return '官网目前只提供可归因表单聚合，尚不能读取逐条表单正文。';
  }
  if (reasonCode === 'WEBSITE_FORM_RECORD_PARTIAL') {
    return '官网逐条记录仅部分覆盖，未覆盖的表单正文不会补造。';
  }
  if (reasonCode === 'KF53_API_UNVERIFIED') {
    return '53KF 尚未完成真实账户接口、有效对话规则和历史覆盖验证。';
  }
  return '该来源的逐条咨询记录暂时不可用。';
}

function sourceReadyMessage(source: ConsultationRecordListData['sources'][number] | undefined) {
  if (source?.recordCoverage === 'FULL') {
    return source.consultationType === 'ONLINE_CHAT'
      ? '仅统计访客实际发送过消息的有效对话，机器人问候和纯系统消息不计入。'
      : '逐条表单记录已接入，可在最近咨询中查看脱敏摘要与审计详情。';
  }
  return sourceStatusMessage(source?.reasonCode);
}

function DetailDrawer({
  open,
  loading,
  errorMessage,
  detail,
  onClose,
  afterOpenChange
}: {
  open: boolean;
  loading: boolean;
  errorMessage: string | null;
  detail: ConsultationRecordDetail | null;
  onClose: () => void;
  afterOpenChange: (nextOpen: boolean) => void;
}) {
  return (
    <Drawer
      rootClassName={styles.detailDrawer}
      title="咨询详情"
      placement="right"
      width={440}
      open={open}
      onClose={onClose}
      afterOpenChange={afterOpenChange}
      keyboard
      maskClosable
      destroyOnHidden
      aria-label="咨询详情"
    >
      <div>
        {loading ? (
          <Skeleton active paragraph={{ rows: 10 }} />
        ) : errorMessage ? (
          <Alert type="error" showIcon title="详情读取失败" description={errorMessage} />
        ) : detail ? (
          <>
            <Descriptions
              className={styles.detailMeta}
              column={1}
              colon={false}
              size="small"
              items={[
                {
                  key: 'type',
                  label: '类型',
                  children: detail.consultationType === 'ONLINE_CHAT'
                    ? '在线客服有效对话'
                    : TYPE_LABELS[detail.consultationType]
                },
                { key: 'time', label: '时间', children: fullTime(detail.occurredAt) },
                { key: 'source', label: '来源', children: detail.source.label },
                {
                  key: 'landing',
                  label: '落地页',
                  children: (
                    <span>
                      {detail.landingPage.label || '—'}
                      {detail.landingPage.path ? (
                        <Text className={styles.detailPath}> {detail.landingPage.path}</Text>
                      ) : null}
                    </span>
                  )
                },
                { key: 'device', label: '设备', children: DEVICE_LABELS[detail.device] }
              ]}
            />

            {detail.consultationType === 'WEBSITE_FORM' ? (
              <section className={styles.drawerSection} aria-labelledby="form-content-title">
                <Title level={3} id="form-content-title">表单内容</Title>
                <p className={styles.fullContent}>{detail.form.content}</p>
                {detail.form.fields.length > 0 ? (
                  <dl className={styles.formFields}>
                    {detail.form.fields.map((field) => (
                      <div key={`${field.label}-${field.value}`}>
                        <dt>{field.label}</dt>
                        <dd>{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </section>
            ) : (
              <section className={styles.drawerSection} aria-labelledby="conversation-title">
                <Title level={3} id="conversation-title">对话内容</Title>
                <div className={styles.conversation}>
                  {detail.conversation.messages.map((message, index) => (
                    <article
                      key={`${message.sentAt}-${index}`}
                      className={styles.message}
                      data-sender={message.sender}
                    >
                      <header>
                        <strong>{message.sender === 'VISITOR' ? '访客' : '客服'}</strong>
                        <time dateTime={message.sentAt}>{dayjs(message.sentAt).format('HH:mm')}</time>
                      </header>
                      <p>{message.content}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section className={styles.drawerSection} aria-labelledby="contact-title">
              <Title level={3} id="contact-title">联系方式</Title>
              <p className={styles.contactLine}>
                {[detail.maskedContact.displayName, detail.maskedContact.phone, detail.maskedContact.email]
                  .filter(Boolean)
                  .join(' / ') || '—'}
              </p>
            </section>

            {detail.externalRecordUrl ? (
              <a
                className={styles.sourceRecordLink}
                href={detail.externalRecordUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {detail.sourceSystem === 'KF53'
                  ? '在 53KF 查看原记录'
                  : '在官网表单后台查看原记录'}
                <ExportOutlined aria-hidden="true" />
              </a>
            ) : null}
            <p className={styles.privacyNote}>个人信息默认脱敏 · 详情查看行为留有审计记录</p>
          </>
        ) : null}
      </div>
    </Drawer>
  );
}

export default function ConsultationsPage() {
  const defaultContext = useDefaultProjectContext();
  const { device, setDevice, dateRange, setDateRange } = useMarketingFilters();
  const [analysisView, setAnalysisView] = useState<'trend' | 'distribution'>('trend');
  const [analysisSource, setAnalysisSource] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState<'ALL' | ConsultationType>('ALL');
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortBy, setSortBy] = useState<ConsultationRecordQuery['sortBy']>('occurredAt');
  const [sortOrder, setSortOrder] = useState<ConsultationRecordQuery['sortOrder']>('desc');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConsultationRecordDetail | null>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRecordIdRef = useRef<string | null>(null);
  const projectId = defaultContext.project?.id || '';
  const queryDevice = device === 'all' ? 'ALL' : device === 'pc' ? 'PC' : 'MOBILE';
  const previousDateRange = useMemo<[string, string]>(() => {
    const days = dayjs(dateRange[1]).diff(dayjs(dateRange[0]), 'day') + 1;
    const previousTo = dayjs(dateRange[0]).subtract(1, 'day');
    return [
      previousTo.subtract(days - 1, 'day').format('YYYY-MM-DD'),
      previousTo.format('YYYY-MM-DD')
    ];
  }, [dateRange]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const drawer = document.querySelector<HTMLElement>(
        '.ant-drawer-section[aria-label="咨询详情"]'
      );
      if (!drawer) return;
      const focusable = [...drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), '
          + 'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )].filter((element) => (
        element.getAttribute('aria-hidden') !== 'true'
        && element.getClientRects().length > 0
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!drawer.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', trapFocus, true);
    return () => document.removeEventListener('keydown', trapFocus, true);
  }, [drawerOpen]);

  useEffect(() => {
    if (drawerOpen || !returnFocusRecordIdRef.current) return undefined;
    const timeout = window.setTimeout(() => {
      const target = [...document.querySelectorAll<HTMLButtonElement>(
        '[data-consultation-record-id]'
      )].find((button) => (
        button.dataset.consultationRecordId === returnFocusRecordIdRef.current
      ));
      target?.focus({ preventScroll: true });
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [drawerOpen]);

  const recordQuery = useMemo<ConsultationRecordQuery>(() => ({
    from: dateRange[0],
    to: dateRange[1],
    page,
    pageSize,
    type: typeFilter,
    source: sourceFilter,
    device: queryDevice,
    q: searchQuery,
    sortBy,
    sortOrder
  }), [dateRange, page, pageSize, queryDevice, searchQuery, sortBy, sortOrder, sourceFilter, typeFilter]);
  const chatCountQuery = useMemo<ConsultationRecordQuery>(() => ({
    from: dateRange[0],
    to: dateRange[1],
    page: 1,
    pageSize: 1,
    type: 'ONLINE_CHAT',
    source: 'ALL',
    device: queryDevice,
    q: '',
    sortBy: 'occurredAt',
    sortOrder: 'desc'
  }), [dateRange, queryDevice]);
  const previousChatCountQuery = useMemo<ConsultationRecordQuery>(() => ({
    ...chatCountQuery,
    from: previousDateRange[0],
    to: previousDateRange[1]
  }), [chatCountQuery, previousDateRange]);

  const formDays = useWebsiteFormConsultationDays({
    projectId,
    enabled: Boolean(projectId),
    from: dateRange[0],
    to: dateRange[1]
  });
  const previousFormDays = useWebsiteFormConsultationDays({
    projectId,
    enabled: Boolean(projectId),
    from: previousDateRange[0],
    to: previousDateRange[1]
  });
  const records = useConsultationRecords({
    projectId,
    enabled: Boolean(projectId),
    query: recordQuery
  });
  const chatCount = useConsultationRecords({
    projectId,
    enabled: Boolean(projectId),
    query: chatCountQuery
  });
  const previousChatCount = useConsultationRecords({
    projectId,
    enabled: Boolean(projectId),
    query: previousChatCountQuery
  });

  const chatRecordStatus = chatCount.data?.sources.find((source) => (
    source.sourceSystem === 'KF53'
  ));
  const chatCountValue = chatRecordStatus?.recordCoverage === 'FULL'
    ? String(chatCount.data?.pagination.totalItems ?? 0)
    : null;
  const previousChatRecordStatus = previousChatCount.data?.sources.find((source) => (
    source.sourceSystem === 'KF53'
  ));
  const previousChatCountValue = previousChatRecordStatus?.recordCoverage === 'FULL'
    ? String(previousChatCount.data?.pagination.totalItems ?? 0)
    : null;
  const formCount = device === 'all'
    ? formDays.data?.summary.formConsultationRecords || null
    : null;
  const previousFormCount = device === 'all'
    ? previousFormDays.data?.summary.formConsultationRecords || null
    : null;
  const recordSourceWarnings = (records.data?.sources || []).filter((source) => (
    source.recordCoverage !== 'FULL'
  ));

  const sourceOptions = useMemo(() => {
    const keys = new Set<string>();
    formDays.data?.sourceBreakdown.forEach((source) => keys.add(source.sourceKey));
    records.data?.items.forEach((record) => keys.add(record.source.key));
    return [...keys].sort().map((key) => ({
      value: key,
      label: SOURCE_LABELS[key] || key
    }));
  }, [formDays.data?.sourceBreakdown, records.data?.items]);

  const websiteTrend = useMemo(() => {
    if (!formDays.data || device !== 'all') return [];
    return formDays.data.days.map((day) => {
      const value = analysisSource === 'ALL'
        ? day.formConsultationRecords
        : day.sourceBreakdown.find((source) => (
          source.sourceKey === analysisSource
        ))?.formConsultationRecords || '0';
      return {
        date: day.date.slice(5),
        actualDate: day.date,
        value: Number(value),
        type: '表单咨询'
      };
    });
  }, [analysisSource, device, formDays.data]);

  const distribution = useMemo(() => {
    if (!formDays.data || device !== 'all') return [];
    return formDays.data.sourceBreakdown
      .filter((source) => analysisSource === 'ALL' || source.sourceKey === analysisSource)
      .map((source) => ({
        source: SOURCE_LABELS[source.sourceKey] || source.sourceKey,
        value: Number(source.formConsultationRecords),
        type: '表单咨询'
      }));
  }, [analysisSource, device, formDays.data]);

  const chatTrendStatus = chatRecordStatus?.recordCoverage === 'FULL'
    ? '逐条记录已接入，但当前分析合同尚未提供 53KF 逐日序列。'
    : '53KF 尚未完成真实接口验证，当前没有可绘制的有效对话序列。';
  const chatDistributionStatus = chatRecordStatus?.recordCoverage === 'FULL'
    ? '当前分析合同尚未提供 53KF 来源序列，不与表单咨询合计。'
    : '53KF 来源分布未接入，不与表单咨询合计。';

  const trendPanel = (
    <div className={styles.analysisPanel}>
      <p className={styles.analysisCaption}>
        按咨询发生日期统计；表单咨询与在线客服有效对话始终保持独立口径。
      </p>
      {formDays.state === 'SOURCE_ERROR' ? (
        <Alert
          className={styles.analysisAlert}
          type="error"
          showIcon
          title="表单咨询趋势读取失败"
          description={formDays.errorMessage || '官网表单逐日数据读取失败'}
          action={<Button size="small" onClick={() => void formDays.reload()}>重试</Button>}
        />
      ) : device !== 'all' ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="当前官网表单聚合合同未提供设备维度；不会按总量推断设备分布。"
        />
      ) : websiteTrend.length > 0 ? (
        <>
          <div
            className={styles.chartRegion}
            role="img"
            aria-label="咨询趋势图"
            aria-describedby="consultation-trend-data"
          >
            <Line
              data={websiteTrend}
              xField="date"
              yField="value"
              colorField="type"
              height={236}
              legend={false}
              scale={{ x: { tickCount: 8 }, y: { domainMin: 0 } }}
              axis={{
                x: { title: false, tick: false, labelAutoRotate: false },
                y: { title: false, grid: true }
              }}
              style={{ lineWidth: 2 }}
              point={{ size: 3 }}
              animate={false}
            />
          </div>
          <div id="consultation-trend-data" className={styles.visuallyHidden}>
            <p>{chatTrendStatus}</p>
            <table>
              <caption>表单咨询逐日数量</caption>
              <thead><tr><th>日期</th><th>数量</th></tr></thead>
              <tbody>
                {websiteTrend.map((point) => (
                  <tr key={point.actualDate}>
                    <th>{point.actualDate}</th>
                    <td>{point.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.chartLegend} aria-label="咨询趋势图例">
            <span data-series="form"><LineChartOutlined aria-hidden="true" />表单咨询</span>
            <span
              data-series="chat"
              data-unavailable="true"
              aria-label={chatTrendStatus}
            >
              <LineChartOutlined aria-hidden="true" />
              在线客服有效对话（{chatRecordStatus?.recordCoverage === 'FULL' ? '暂无逐日序列' : '未接入'}）
            </span>
          </div>
        </>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前范围没有表单咨询数据" />
      )}
    </div>
  );

  const distributionPanel = (
    <div className={styles.analysisPanel}>
      <p className={styles.analysisCaption}>
        按咨询来源比较；表单咨询与在线客服有效对话始终保持独立口径。
      </p>
      {formDays.state === 'SOURCE_ERROR' ? (
        <Alert
          className={styles.analysisAlert}
          type="error"
          showIcon
          title="表单咨询来源读取失败"
          description={formDays.errorMessage || '官网表单来源数据读取失败'}
          action={<Button size="small" onClick={() => void formDays.reload()}>重试</Button>}
        />
      ) : device !== 'all' ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="当前官网表单聚合合同未提供设备维度；不会按总量推断设备分布。"
        />
      ) : distribution.length > 0 ? (
        <>
          <div
            className={styles.chartRegion}
            role="img"
            aria-label="咨询来源分布图"
            aria-describedby="consultation-distribution-data"
          >
            <Column
              data={distribution}
              xField="source"
              yField="value"
              colorField="type"
              height={236}
              legend={false}
              axis={{
                x: { title: false, labelAutoRotate: false },
                y: { title: false, grid: true }
              }}
              animate={false}
            />
          </div>
          <div id="consultation-distribution-data" className={styles.visuallyHidden}>
            <p>{chatDistributionStatus}</p>
            <table>
              <caption>表单咨询来源数量</caption>
              <thead><tr><th>来源</th><th>数量</th></tr></thead>
              <tbody>
                {distribution.map((point) => (
                  <tr key={point.source}>
                    <th>{point.source}</th>
                    <td>{point.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.chartLegend} aria-label="咨询来源分布图例">
            <span data-series="form"><LineChartOutlined aria-hidden="true" />表单咨询</span>
            <span
              data-series="chat"
              data-unavailable="true"
              aria-label={chatDistributionStatus}
            >
              <LineChartOutlined aria-hidden="true" />
              在线客服有效对话（{chatRecordStatus?.recordCoverage === 'FULL' ? '暂无来源序列' : '未接入'}）
            </span>
          </div>
        </>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前范围没有表单咨询来源数据" />
      )}
    </div>
  );

  const handleAnalysisKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'tab') {
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextView = event.key === 'ArrowLeft' || event.key === 'Home'
      ? 'trend'
      : 'distribution';
    setAnalysisView(nextView);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[id$="-tab-${nextView}"]`)?.focus();
    });
  };

  const closeDrawer = () => setDrawerOpen(false);
  const openDetail = async (
    record: ConsultationRecordSummary,
    trigger: HTMLButtonElement
  ) => {
    returnFocusRef.current = trigger;
    returnFocusRecordIdRef.current = record.id;
    setDrawerOpen(true);
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    try {
      setDetail(await records.loadDetail(record.id));
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : '咨询详情读取失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const columns: TableColumnsType<ConsultationRecordSummary> = [
    {
      title: '时间',
      dataIndex: 'occurredAt',
      key: 'occurredAt',
      width: 122,
      sorter: true,
      sortDirections: ['ascend', 'descend', 'ascend'],
      sortOrder: sortBy === 'occurredAt'
        ? (sortOrder === 'asc' ? 'ascend' : 'descend')
        : null,
      render: (value: string) => <time dateTime={value}>{formatTime(value)}</time>
    },
    {
      title: '类型',
      dataIndex: 'consultationType',
      key: 'consultationType',
      width: 112,
      sorter: true,
      sortDirections: ['ascend', 'descend', 'ascend'],
      sortOrder: sortBy === 'consultationType'
        ? (sortOrder === 'asc' ? 'ascend' : 'descend')
        : null,
      render: (value: ConsultationType) => (
        <Tag color={value === 'WEBSITE_FORM' ? 'blue' : 'cyan'}>
          {TYPE_LABELS[value]}
        </Tag>
      )
    },
    {
      title: '来源',
      dataIndex: ['source', 'label'],
      key: 'source',
      width: 120,
      sorter: true,
      sortDirections: ['ascend', 'descend', 'ascend'],
      sortOrder: sortBy === 'source'
        ? (sortOrder === 'asc' ? 'ascend' : 'descend')
        : null,
      ellipsis: true
    },
    {
      title: '落地页',
      key: 'landingPage',
      width: 152,
      ellipsis: true,
      render: (_, record) => (
        <Tooltip title={record.landingPage.path || undefined} trigger={['hover']}>
          <span>{record.landingPage.label || record.landingPage.path || '—'}</span>
        </Tooltip>
      )
    },
    {
      title: '咨询内容摘要',
      dataIndex: 'contentSummary',
      key: 'contentSummary',
      ellipsis: true
    },
    {
      title: '联系人',
      key: 'contact',
      width: 112,
      ellipsis: true,
      render: (_, record) => contactText(record)
    },
    {
      title: '查看',
      key: 'view',
      width: 72,
      align: 'center',
      render: (_, record) => {
        if (record.detailAvailable) {
          return (
            <Button
              type="link"
              size="small"
              data-consultation-record-id={record.id}
              aria-label={`查看 ${fullTime(record.occurredAt)} 的${TYPE_LABELS[record.consultationType]}详情`}
              onClick={(event) => void openDetail(
                record,
                event.currentTarget as HTMLButtonElement
              )}
            >
              查看
            </Button>
          );
        }
        const reasonId = `consultation-detail-unavailable-${record.id.replace(/[^a-zA-Z0-9_-]/gu, '-')}`;
        return (
          <Tooltip title="来源明细接口尚未验证，当前不能查看详情。" trigger={['hover']}>
            <span className={styles.unavailableAction}>
              <Button
                type="link"
                size="small"
                aria-disabled="true"
                aria-describedby={reasonId}
                onClick={(event) => event.preventDefault()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                  }
                }}
              >
                查看
              </Button>
              <span id={reasonId} className={styles.visuallyHidden}>
                来源明细接口尚未验证，当前不能查看详情。
              </span>
            </span>
          </Tooltip>
        );
      }
    }
  ];

  const handleTableChange: TableProps<ConsultationRecordSummary>['onChange'] = (
    _pagination,
    _filters,
    sorter
  ) => {
    if (Array.isArray(sorter) || !sorter.columnKey || !sorter.order) return;
    const nextSort = String(sorter.columnKey) as ConsultationRecordQuery['sortBy'];
    if (!['occurredAt', 'consultationType', 'source'].includes(nextSort)) return;
    setSortBy(nextSort);
    setSortOrder(sorter.order === 'ascend' ? 'asc' : 'desc');
    setPage(1);
  };

  const tableEmptyDescription = records.state === 'ERROR'
    ? records.errorMessage || '咨询记录列表读取失败'
    : records.data?.coverageState === 'NONE'
      ? '逐条咨询明细尚未接入：官网目前仅提供聚合数据，53KF 尚未完成真实接口验证。'
      : '当前筛选条件下没有咨询记录';

  return (
    <div className={styles.page}>
      <h1 className={styles.visuallyHidden}>咨询数据</h1>
      <div className={styles.breadcrumbRow}>
        <Breadcrumb items={[
          { title: '首页' },
          { title: '转化结果' },
          { title: '咨询数据' }
        ]} />
        <MarketingPageFilters
          device={device}
          onDeviceChange={(nextDevice) => {
            setDevice(nextDevice);
            setPage(1);
          }}
          dateRange={dateRange}
          onDateRangeChange={(nextRange) => {
            setDateRange(nextRange);
            setPage(1);
          }}
          dateAriaLabel="咨询数据日期范围"
          maxDate={dayjs().format('YYYY-MM-DD')}
          presetAnchor={dayjs().format('YYYY-MM-DD')}
          presetDays={[7, 14, 30]}
        />
      </div>

      <div className={styles.visuallyHidden} aria-live="polite" aria-atomic="true">
        {drawerOpen
          ? detailLoading
            ? '咨询详情加载中'
            : detailError
              ? `咨询详情加载失败：${detailError}`
              : detail
                ? '咨询详情已加载'
                : '咨询详情已打开'
          : records.state === 'LOADING'
            ? '咨询记录加载中'
            : `第 ${page} 页，共 ${records.data?.pagination.totalItems ?? 0} 条咨询记录`}
      </div>

      {defaultContext.errorMessage ? (
        <Alert
          className={styles.pageAlert}
          type="error"
          showIcon
          title="无法读取默认监控项目"
          description={defaultContext.errorMessage}
        />
      ) : null}

      <div className={styles.metricSummary}>
      <h2 className={styles.visuallyHidden}>周期汇总</h2>
      <MarketingMetricGrid ariaLabel="咨询数据周期汇总指标">
        <MarketingMetricCard
          title="表单咨询"
          current={formCount == null ? null : formatCount(formCount)}
          previous={previousFormCount == null ? null : formatCount(previousFormCount)}
          change={formatCountChange(formCount, previousFormCount)}
          loading={formDays.state === 'LOADING' || previousFormDays.state === 'LOADING'}
          info="官网成功提交且能识别来源的表单数。"
          currentMissingReason={device !== 'all'
            ? '官网表单聚合合同不提供设备维度，不会用总量推断。'
            : formDays.errorMessage || '当前没有可用的表单咨询数据。'}
          previousMissingReason={previousFormDays.errorMessage || '上一周期表单咨询不可用。'}
          changeMissingReason="本期或上期数据不完整，无法比较。"
        />
        <MarketingMetricCard
          title="在线客服有效对话"
          current={chatCountValue == null ? null : formatCount(chatCountValue)}
          previous={previousChatCountValue == null ? null : formatCount(previousChatCountValue)}
          change={formatCountChange(chatCountValue, previousChatCountValue)}
          loading={chatCount.state === 'LOADING' || previousChatCount.state === 'LOADING'}
          info="访客主动发过消息的 53KF 对话；不含机器人和系统消息。"
          currentMissingReason={sourceReadyMessage(chatRecordStatus)}
          previousMissingReason={sourceReadyMessage(previousChatRecordStatus)}
          changeMissingReason="53KF 本期或上期有效对话不完整，无法比较。"
        />
      </MarketingMetricGrid>
      </div>

      {recordSourceWarnings.length > 0 ? (
        <div className={styles.sourceStatusStack} aria-label="咨询来源接入状态">
          {recordSourceWarnings.map((source) => (
            <Alert
              key={`${source.sourceSystem}:${source.consultationType}`}
              type="warning"
              showIcon
              title={`${TYPE_LABELS[source.consultationType]}数据范围受限`}
              description={sourceStatusMessage(source.reasonCode)}
            />
          ))}
        </div>
      ) : null}

      <Card className={styles.analysisCard}>
        <div className={styles.analysisShell} onKeyDown={handleAnalysisKeyDown}>
          <div className={styles.analysisFilters}>
            <label>
              <span>来源</span>
              <Select
                aria-label="咨询分析来源"
                value={analysisSource}
                onChange={setAnalysisSource}
                options={[{ value: 'ALL', label: '全部来源' }, ...sourceOptions]}
                popupMatchSelectWidth={false}
              />
            </label>
          </div>
          <Tabs
            className={styles.analysisTabs}
            activeKey={analysisView}
            onChange={(key) => setAnalysisView(key as 'trend' | 'distribution')}
            items={[
              { key: 'trend', label: '咨询趋势', children: trendPanel },
              { key: 'distribution', label: '来源分布', children: distributionPanel }
            ]}
          />
        </div>
      </Card>

      <Card className={styles.tableCard}>
        <div className={styles.tableToolbar}>
          <Title level={2}>最近咨询</Title>
          <div className={styles.tableFilters}>
            <label>
              <span>类型</span>
              <Select
                aria-label="最近咨询类型"
                value={typeFilter}
                onChange={(value) => { setTypeFilter(value); setPage(1); }}
                options={[
                  { value: 'ALL', label: '全部类型' },
                  { value: 'WEBSITE_FORM', label: '表单咨询' },
                  { value: 'ONLINE_CHAT', label: '在线客服' }
                ]}
                popupMatchSelectWidth={false}
              />
            </label>
            <label>
              <span>来源</span>
              <Select
                aria-label="最近咨询来源"
                value={sourceFilter}
                onChange={(value) => { setSourceFilter(value); setPage(1); }}
                options={[{ value: 'ALL', label: '全部来源' }, ...sourceOptions]}
                popupMatchSelectWidth={false}
              />
            </label>
            <Input
              className={styles.searchInput}
              aria-label="搜索咨询内容"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              prefix={<SearchOutlined aria-hidden="true" />}
              placeholder="搜索咨询内容"
              allowClear
            />
          </div>
        </div>
        {records.state === 'ERROR' ? (
          <Alert
            className={styles.tableAlert}
            type="error"
            showIcon
            title="最近咨询读取失败"
            description={records.errorMessage || '咨询记录列表读取失败'}
            action={<Button size="small" onClick={() => void records.reload()}>重试</Button>}
          />
        ) : null}
        <Table<ConsultationRecordSummary>
          className={styles.consultationTable}
          rowKey="id"
          columns={columns}
          dataSource={records.data?.items || []}
          loading={records.state === 'LOADING'}
          pagination={false}
          onChange={handleTableChange}
          scroll={{ x: 1040 }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={tableEmptyDescription}
              />
            )
          }}
        />
        <div className={styles.paginationRow}>
          <span>共 {records.data?.pagination.totalItems ?? 0} 条</span>
          <Pagination
            aria-label="最近咨询分页"
            current={page}
            pageSize={pageSize}
            total={records.data?.pagination.totalItems ?? 0}
            showSizeChanger
            pageSizeOptions={[10, 20, 50]}
            showLessItems
            onChange={(nextPage, nextPageSize) => {
              setPage(nextPageSize === pageSize ? nextPage : 1);
              setPageSize(nextPageSize);
            }}
          />
        </div>
      </Card>

      <DetailDrawer
        open={drawerOpen}
        loading={detailLoading}
        errorMessage={detailError}
        detail={detail}
        onClose={closeDrawer}
        afterOpenChange={(nextOpen) => {
          if (nextOpen) {
            window.requestAnimationFrame(() => {
              document.querySelector<HTMLElement>(
                '.ant-drawer-section[aria-label="咨询详情"] .ant-drawer-close'
              )?.focus();
            });
          } else {
            const restoreFocus = () => {
              const target = returnFocusRef.current?.isConnected
                ? returnFocusRef.current
                : [...document.querySelectorAll<HTMLButtonElement>(
                    '[data-consultation-record-id]'
                  )].find((button) => (
                    button.dataset.consultationRecordId === returnFocusRecordIdRef.current
                  ));
              target?.focus({ preventScroll: true });
            };
            window.requestAnimationFrame(() => {
              restoreFocus();
              window.setTimeout(restoreFocus, 80);
            });
          }
        }}
      />
    </div>
  );
}
