'use client';

import React from 'react';
import { Line } from '@ant-design/plots';
import type { LineConfig } from '@ant-design/plots';

interface Props {
  data: LineConfig['data'];
}

export default function TrendLineChart({ data }: Props) {
  if (!data || data.length === 0) return null;
  return (
    <Line
      data={data}
      xField="date"
      yField="count"
      smooth
      point={{ size: 4 }}
      tooltip={{ showMarkers: true }}
    />
  );
}
