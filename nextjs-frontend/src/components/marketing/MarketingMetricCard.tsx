'use client';

import React from 'react';
import { Card, Skeleton, Tooltip } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import styles from './marketing-shared.module.css';

export type MarketingMetricTone = 'good' | 'bad' | 'neutral';

function Value({
  value,
  missingReason,
  label
}: {
  value: React.ReactNode;
  missingReason?: React.ReactNode;
  label: string;
}) {
  if (value !== null && value !== undefined && value !== '') return value;
  return (
    <Tooltip title={missingReason || '当前没有可用数据。'} trigger={['hover']}>
      <span className={styles.missingValue} aria-label={`${label}：暂无数据`}>
        —
      </span>
    </Tooltip>
  );
}

export function MarketingMetricGrid({
  children,
  ariaLabel
}: {
  children: React.ReactNode;
  ariaLabel: string;
}) {
  return <div className={styles.metricGrid} aria-label={ariaLabel}>{children}</div>;
}

export function MarketingMetricPlaceholderGrid({
  items,
  ariaLabel,
  loading = false,
  missingReason
}: {
  items: ReadonlyArray<{ title: string; metricKey?: string }>;
  ariaLabel: string;
  loading?: boolean;
  missingReason?: React.ReactNode;
}) {
  return (
    <MarketingMetricGrid ariaLabel={ariaLabel}>
      {items.map(({ title, metricKey }) => (
        <MarketingMetricCard
          key={metricKey || title}
          title={title}
          metricKey={metricKey}
          current={null}
          previous={null}
          change={null}
          info={loading ? undefined : missingReason || '当前没有可用数据。'}
          loading={loading}
          currentMissingReason={missingReason}
          previousMissingReason={missingReason}
          changeMissingReason={missingReason}
        />
      ))}
    </MarketingMetricGrid>
  );
}

export default function MarketingMetricCard({
  title,
  metricKey,
  current,
  previous,
  change,
  info,
  loading = false,
  tone = 'neutral',
  currentMissingReason,
  previousMissingReason,
  changeMissingReason,
  testId,
  selected = false,
  onActivate
}: {
  title: string;
  metricKey?: string;
  current: React.ReactNode;
  previous: React.ReactNode;
  change: React.ReactNode;
  info?: React.ReactNode;
  loading?: boolean;
  tone?: MarketingMetricTone;
  currentMissingReason?: React.ReactNode;
  previousMissingReason?: React.ReactNode;
  changeMissingReason?: React.ReactNode;
  testId?: string;
  selected?: boolean;
  onActivate?: () => void;
}) {
  return (
    <Card
      className={styles.metricCard}
      data-testid={testId}
      data-selected={selected || undefined}
      role={onActivate ? 'button' : undefined}
      tabIndex={onActivate ? 0 : undefined}
      aria-pressed={onActivate ? selected : undefined}
      onClick={onActivate}
      onKeyDown={onActivate ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onActivate();
        }
      } : undefined}
    >
      <div className={styles.metricTitleRow}>
        <h3>{title}{metricKey ? <span>{metricKey}</span> : null}</h3>
        {info ? (
          <Tooltip title={info} placement="top" trigger={['hover']}>
            <span
              className={styles.infoButton}
              role="img"
              aria-label={`${metricKey || title}口径说明`}
              onClick={(event) => event.stopPropagation()}
            >
              <InfoCircleOutlined aria-hidden="true" />
            </span>
          </Tooltip>
        ) : null}
      </div>
      {loading ? (
        <Skeleton active paragraph={{ rows: 2 }} title={false} />
      ) : (
        <>
          <div className={styles.metricPeriods}>
            <div>
              <span>本期</span>
              <strong>
                <Value value={current} missingReason={currentMissingReason} label={`${title}本期`} />
              </strong>
            </div>
            <div>
              <span>上期</span>
              <strong className={styles.previousValue}>
                <Value value={previous} missingReason={previousMissingReason} label={`${title}上期`} />
              </strong>
            </div>
          </div>
          <div className={styles.metricChange}>
            <span>较上一周期</span>
            <strong data-tone={tone}>
              <Value value={change} missingReason={changeMissingReason} label={`${title}较上一周期`} />
            </strong>
          </div>
        </>
      )}
    </Card>
  );
}
