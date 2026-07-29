'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, Button, Card, Space } from 'antd';
import axios from '@/lib/axiosConfig';
import { getApiErrorMessage } from '@/utils/apiErrorMessage.cjs';

type AuthorizationResult = {
  status: 'SUCCEEDED' | 'FAILED' | 'OUTCOME_UNKNOWN';
  failureCode?: string | null;
  connectionId?: string | null;
  principalId?: string | null;
};

export default function BaiduAuthorizationResultPage() {
  const [result, setResult] = useState<AuthorizationResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get('/api/admin/marketing/baidu/authorization-results/current')
      .then((response) => setResult(response.data))
      .catch((requestError) => {
        setError(getApiErrorMessage(requestError, '无法读取本次授权结果'));
      });
  }, []);

  const type = result?.status === 'SUCCEEDED'
    ? 'success'
    : result?.status === 'OUTCOME_UNKNOWN' ? 'warning' : 'error';
  const message = result?.status === 'SUCCEEDED'
    ? '百度搜索推广连接已建立'
    : result?.status === 'OUTCOME_UNKNOWN'
      ? '授权结果暂时无法确认'
      : '百度搜索推广授权未完成';

  return (
    <Card title="百度搜索推广授权结果" style={{ maxWidth: 720 }}>
      {!result && !error ? <p role="status">正在读取本次授权结果…</p> : null}
      {error ? <Alert type="error" showIcon message={error} role="alert" /> : null}
      {result ? (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert
            type={type}
            showIcon
            message={message}
            description={
              result.status === 'OUTCOME_UNKNOWN'
                ? '系统不会盲目重试一次性授权码。请返回设置中心重新发起授权。'
                : result.failureCode || (
                  result.principalId
                    ? `授权主体：${result.principalId}`
                    : undefined
                )
            }
          />
          <Link href="/admin/settings#marketing">
            <Button type="primary">返回设置中心</Button>
          </Link>
        </Space>
      ) : null}
    </Card>
  );
}
