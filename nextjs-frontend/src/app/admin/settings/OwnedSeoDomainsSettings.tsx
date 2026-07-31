'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Space, Typography, message } from 'antd';
import axios from '@/lib/axiosConfig';
import { getApiErrorMessage } from '@/utils/apiErrorMessage.cjs';

type SeoAuditSettingsResponse = {
  ownedOrigins?: string[];
};

export default function OwnedSeoDomainsSettings() {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await axios.get('/api/settings/seo-audit');
      const data: SeoAuditSettingsResponse = response?.data?.data || {};
      setValue(Array.isArray(data.ownedOrigins) ? data.ownedOrigins.join('\n') : '');
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, '无法读取自有检测站点'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const ownedOrigins = value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    setSaving(true);
    setError('');
    try {
      const response = await axios.put('/api/settings/seo-audit', { ownedOrigins });
      const saved: SeoAuditSettingsResponse = response?.data?.data || {};
      setValue(Array.isArray(saved.ownedOrigins) ? saved.ownedOrigins.join('\n') : '');
      message.success('自有检测站点已更新，将从下一次全站检测开始生效');
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, '保存自有检测站点失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <div>
        <Typography.Title level={2} style={{ marginBottom: 8 }}>
          自有检测站点
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          明确登记由你方管理、允许高频检测的站点。只有精确匹配的 Origin
          会使用快速档；其他网站继续使用保守档。
        </Typography.Paragraph>
      </div>

      <Alert
        type="info"
        showIcon
        title="快速档：并发 8，同一 Origin 请求起始间隔 100ms"
        description="robots.txt 只用于判断爬虫访问规则，不作为站点所有权证明。WAF 或 429 仍会立即熔断。"
      />
      {error ? <Alert type="error" showIcon title={error} role="alert" /> : null}

      <Card size="small" title="允许快速检测的 Origin">
        <Space orientation="vertical" size="middle" style={{ width: '100%', maxWidth: 760 }}>
          <Input.TextArea
            aria-label="自有检测站点 Origin"
            value={value}
            disabled={loading}
            autoSize={{ minRows: 5, maxRows: 12 }}
            placeholder={'每行一个，例如：\nhttps://gato.com.cn\nhttps://insight.guangtuo.com'}
            onChange={(event) => setValue(event.target.value)}
          />
          <Typography.Text type="secondary">
            每行一个完整 Origin，最多 10 个。不能包含路径、通配符、账号、查询参数或锚点；
            子域名和不同端口需要分别登记。
          </Typography.Text>
          <Space>
            <Button type="primary" loading={saving} disabled={loading} onClick={save}>
              保存自有站点
            </Button>
            <Button disabled={saving} onClick={load}>重新读取</Button>
          </Space>
        </Space>
      </Card>
    </Space>
  );
}
