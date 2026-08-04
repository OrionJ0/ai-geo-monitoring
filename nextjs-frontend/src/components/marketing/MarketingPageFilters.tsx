'use client';

import React, { useMemo } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import { DatePicker, Select, Tooltip } from 'antd';
import { CalendarOutlined, DownOutlined } from '@ant-design/icons';
import styles from './marketing-shared.module.css';

const { RangePicker } = DatePicker;
const DEFAULT_PRESET_DAYS = [7, 14, 30, 90];

export type MarketingDevice = 'all' | 'pc' | 'mobile';
export type MarketingDateRange = [string, string] | null;

const DEVICE_OPTIONS: Array<{
  value: MarketingDevice;
  label: string;
}> = [
  { value: 'all', label: '全部设备' },
  { value: 'pc', label: 'PC 端' },
  { value: 'mobile', label: '移动端' }
];

export function buildMarketingDatePresets({
  anchor,
  minDate,
  days = [7, 14, 30, 90]
}: {
  anchor: string;
  minDate?: string | null;
  days?: number[];
}): Array<{ label: string; value: [Dayjs, Dayjs] }> {
  const end = dayjs(anchor);
  return days.flatMap((count) => {
    const start = end.subtract(count - 1, 'day');
    if (minDate && start.isBefore(dayjs(minDate), 'day')) return [];
    return [{ label: `最近 ${count} 天`, value: [start, end] }];
  });
}

export default function MarketingPageFilters({
  device,
  onDeviceChange,
  dateRange,
  onDateRangeChange,
  dateAriaLabel,
  disabled = false,
  deviceDisabled = false,
  minDate = null,
  maxDate = null,
  presetAnchor = null,
  availableDevices = ['all', 'pc', 'mobile'],
  presetDays = DEFAULT_PRESET_DAYS,
  onBeforeDateChange,
  after
}: {
  device: MarketingDevice;
  onDeviceChange: (device: MarketingDevice) => void;
  dateRange: MarketingDateRange;
  onDateRangeChange: (range: [string, string]) => void;
  dateAriaLabel: string;
  disabled?: boolean;
  deviceDisabled?: boolean;
  minDate?: string | null;
  maxDate?: string | null;
  presetAnchor?: string | null;
  availableDevices?: MarketingDevice[];
  presetDays?: number[];
  onBeforeDateChange?: () => void;
  after?: React.ReactNode;
}) {
  const anchor = presetAnchor || maxDate || dateRange?.[1] || dayjs().format('YYYY-MM-DD');
  const presets = useMemo(
    () => buildMarketingDatePresets({ anchor, minDate, days: presetDays }),
    [anchor, minDate, presetDays]
  );
  const days = dateRange
    ? dayjs(dateRange[1]).diff(dayjs(dateRange[0]), 'day') + 1
    : null;
  const rangeLabel = days ? `最近 ${days} 天` : '选择时间';
  const options = DEVICE_OPTIONS.map((option) => ({
    ...option,
    label: availableDevices.includes(option.value)
      ? option.label
      : `${option.label}（本页未应用）`,
    title: availableDevices.includes(option.value)
      ? option.label
      : `${option.label}：本页不支持，选择会保留到其他页面`
  }));
  const deviceScopeNotice = availableDevices.length === DEVICE_OPTIONS.length
    ? null
    : availableDevices.includes(device)
      ? '本页不支持设备筛选，选择会保留到其他页面。'
      : '本页仍显示全部设备数据。';

  return (
    <div className={styles.pageFilters} role="group" aria-label="页面筛选">
      <Tooltip title={deviceScopeNotice} trigger={['hover']}>
        <Select<MarketingDevice>
          className={`${styles.deviceSelect} ${
            availableDevices.includes(device) ? '' : styles.deviceSelectUnsupported
          }`}
          aria-label="设备"
          value={device}
          options={options}
          onChange={onDeviceChange}
          popupMatchSelectWidth={false}
          disabled={deviceDisabled}
        />
      </Tooltip>
      <div className={styles.dateFilter}>
        <CalendarOutlined aria-hidden="true" />
        <span>{rangeLabel}</span>
        <RangePicker
          aria-label={dateAriaLabel}
          value={dateRange
            ? [dayjs(dateRange[0]), dayjs(dateRange[1])]
            : null}
          format="YYYY-MM-DD"
          separator="至"
          allowClear={false}
          allowEmpty={[true, true]}
          presets={presets}
          variant="borderless"
          suffixIcon={<DownOutlined />}
          disabled={disabled}
          disabledDate={(current) => (
            Boolean(minDate && current.isBefore(dayjs(minDate), 'day'))
            || Boolean(maxDate && current.isAfter(dayjs(maxDate), 'day'))
          )}
          onChange={(values) => {
            if (!values?.[0] || !values?.[1]) return;
            onBeforeDateChange?.();
            onDateRangeChange([
              values[0].format('YYYY-MM-DD'),
              values[1].format('YYYY-MM-DD')
            ]);
          }}
        />
      </div>
      {after ? <div className={styles.filterMeta}>{after}</div> : null}
    </div>
  );
}
