'use client';

import React, {
  createContext,
  useContext,
  useMemo,
  useState
} from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import type {
  MarketingDateRange,
  MarketingDevice
} from './MarketingPageFilters';

export const DEFAULT_MARKETING_DEVICE: MarketingDevice = 'pc';
export const DEFAULT_MARKETING_RANGE_DAYS = 7;

export function buildDefaultMarketingDateRange(
  anchor: Dayjs = dayjs()
): [string, string] {
  const lastCompleteDay = anchor.subtract(1, 'day');
  return [
    lastCompleteDay
      .subtract(DEFAULT_MARKETING_RANGE_DAYS - 1, 'day')
      .format('YYYY-MM-DD'),
    lastCompleteDay.format('YYYY-MM-DD')
  ];
}

export function clampMarketingDateRange(
  range: [string, string],
  coverage: { from: string; to: string }
): [string, string] {
  const requestedDays = Math.max(
    1,
    dayjs(range[1]).diff(dayjs(range[0]), 'day') + 1
  );
  let end = dayjs(range[1]);
  if (end.isAfter(dayjs(coverage.to), 'day')) end = dayjs(coverage.to);
  if (end.isBefore(dayjs(coverage.from), 'day')) end = dayjs(coverage.from);
  let start = end.subtract(requestedDays - 1, 'day');
  if (start.isBefore(dayjs(coverage.from), 'day')) {
    start = dayjs(coverage.from);
  }
  return [start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD')];
}

type MarketingFiltersContextValue = {
  device: MarketingDevice;
  setDevice: React.Dispatch<React.SetStateAction<MarketingDevice>>;
  dateRange: Exclude<MarketingDateRange, null>;
  setDateRange: React.Dispatch<React.SetStateAction<Exclude<MarketingDateRange, null>>>;
};

const MarketingFiltersContext = createContext<MarketingFiltersContextValue | null>(null);

export function MarketingFiltersProvider({
  children
}: {
  children: React.ReactNode;
}) {
  const [device, setDevice] = useState<MarketingDevice>(DEFAULT_MARKETING_DEVICE);
  const [dateRange, setDateRange] = useState<[string, string]>(
    buildDefaultMarketingDateRange
  );
  const value = useMemo(() => ({
    device,
    setDevice,
    dateRange,
    setDateRange
  }), [dateRange, device]);

  return (
    <MarketingFiltersContext.Provider value={value}>
      {children}
    </MarketingFiltersContext.Provider>
  );
}

export function useMarketingFilters(): MarketingFiltersContextValue {
  const context = useContext(MarketingFiltersContext);
  if (!context) {
    throw new Error('useMarketingFilters 必须在 MarketingFiltersProvider 内使用');
  }
  return context;
}
