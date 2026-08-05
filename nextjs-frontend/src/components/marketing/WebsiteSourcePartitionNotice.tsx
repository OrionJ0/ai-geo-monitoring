'use client';

import { Alert } from 'antd';
import type { WebsiteSourcePartition } from '@/lib/marketing/websiteTrafficTypes';

function count(value: string | null): string {
  return value == null
    ? '暂不可用'
    : value.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
}

const REASON_LABELS: Record<Exclude<
  WebsiteSourcePartition['reasonCode'],
  null
>, string> = {
  SOURCE_METRIC_MISSING: '至少一个必需来源指标不可用。',
  SOURCE_COVERAGE_INCOMPLETE: '已分类访问少于全站访问。',
  SOURCE_TOTAL_UNAVAILABLE: '全站访问总量不可用。'
};

export default function WebsiteSourcePartitionNotice({
  partition
}: {
  partition?: WebsiteSourcePartition | null;
}) {
  if (!partition) return null;
  const complete = partition.state === 'COMPLETE';
  const evidence = [
    `全站访问 ${count(partition.totalVisits)}`,
    `当前来源已分类 ${count(partition.classifiedVisits)}`,
    `未覆盖 ${count(partition.unclassifiedVisits)}`
  ].join('；');
  const reason = partition.reasonCode
    ? REASON_LABELS[partition.reasonCode]
    : '';
  const boundary = '差额仅表示当前分类未覆盖，不代表任何业务来源，也不参与归因。';

  return (
    <Alert
      type={complete ? 'success' : 'warning'}
      showIcon
      title={complete ? '来源分类覆盖完整' : '来源分类覆盖不完整'}
      description={`${evidence}。${reason}${complete ? '' : boundary}`}
    />
  );
}
