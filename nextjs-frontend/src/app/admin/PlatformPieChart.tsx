'use client';

import React from 'react';
import { Pie } from '@ant-design/plots';
import type { PieConfig } from '@ant-design/plots';

interface Props {
  data: PieConfig['data'];
}

export default function PlatformPieChart({ data }: Props) {
  if (!data || data.length === 0) return null;
  return (
    <Pie
      data={data}
      angleField="count"
      colorField="platform"
      radius={0.9}
      label={{ text: 'platform', position: 'outside' }}
      tooltip={{ fields: ['platform', 'count'] }}
      interactions={[{ type: 'element-active' }]}
    />
  );
}
