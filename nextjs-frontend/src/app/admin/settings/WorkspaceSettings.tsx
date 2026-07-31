'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Select, Space, Tag, Typography, message } from 'antd';
import axios from '@/lib/axiosConfig';
import { getApiErrorMessage } from '@/utils/apiErrorMessage.cjs';

type Project = {
  id: string | number;
  name: string;
  website?: string | null;
  status: 'active' | 'archived';
};

type DefaultContext = {
  project: {
    id: string;
    name: string;
    website: string | null;
    status: 'active';
  };
  source: 'SYSTEM_DEFAULT';
};

function readErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('response' in error)) return null;
  const response = (
    error as { response?: { data?: { error?: { code?: unknown } } } }
  ).response;
  const code = response?.data?.error?.code;
  return typeof code === 'string' ? code : null;
}

export default function WorkspaceSettings() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [defaultContext, setDefaultContext] = useState<DefaultContext | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [contextErrorCode, setContextErrorCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadDefaultContext = useCallback(async () => {
    try {
      const response = await axios.get('/api/geo-projects/default-context');
      const context: DefaultContext = response.data.data;
      setDefaultContext(context);
      setSelectedProjectId(String(context.project.id));
      setContextErrorCode(null);
    } catch (requestError) {
      setDefaultContext(null);
      setSelectedProjectId('');
      setContextErrorCode(readErrorCode(requestError));
      if (readErrorCode(requestError) !== 'DEFAULT_PROJECT_NOT_CONFIGURED') {
        throw requestError;
      }
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const projectsResponse = await axios.get('/api/geo-projects');
      const rows = projectsResponse?.data?.data || [];
      setProjects(Array.isArray(rows) ? rows : []);
      await loadDefaultContext();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, '无法读取工作台设置'));
    } finally {
      setLoading(false);
    }
  }, [loadDefaultContext]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeProjects = useMemo(
    () => projects.filter((project) => project.status === 'active'),
    [projects]
  );

  const save = async () => {
    if (!selectedProjectId) return;
    setSaving(true);
    setError('');
    try {
      await axios.put(
        '/api/geo-projects/default-context',
        { projectId: selectedProjectId }
      );
      await loadDefaultContext();
      message.success('默认监控项目已更新');
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, '保存默认监控项目失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <div>
        <Typography.Title level={2} style={{ marginBottom: 8 }}>
          工作台上下文
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          普通用户进入市场监控和 AI 品牌监测时会自动使用这里指定的项目。
          系统不会根据项目列表顺序或浏览器记录猜测。
        </Typography.Paragraph>
      </div>

      {error ? <Alert type="error" showIcon title={error} role="alert" /> : null}
      {contextErrorCode === 'DEFAULT_PROJECT_NOT_CONFIGURED' ? (
        <Alert
          type="warning"
          showIcon
          title="尚未配置默认监控项目"
          description="请选择广拓对应的活动项目。保存前，普通业务页面将保持阻断状态。"
        />
      ) : null}

      <Card size="small" title="默认监控项目">
        <Space orientation="vertical" size="middle" style={{ width: '100%', maxWidth: 640 }}>
          {defaultContext ? (
            <div>
              当前项目：<strong>{defaultContext.project.name}</strong>{' '}
              <Tag color="green">使用中</Tag>
            </div>
          ) : null}
          <Select
            aria-label="选择默认监控项目"
            value={selectedProjectId || undefined}
            loading={loading}
            placeholder="选择一个活动项目"
            style={{ width: '100%' }}
            onChange={(value) => setSelectedProjectId(String(value))}
            options={activeProjects.map((project) => ({
              value: String(project.id),
              label: project.website
                ? `${project.name} · ${project.website}`
                : project.name
            }))}
          />
          <Space>
            <Button
              type="primary"
              loading={saving}
              disabled={loading || !selectedProjectId}
              onClick={save}
            >
              保存默认项目
            </Button>
            <Button disabled={saving} onClick={load}>重新读取</Button>
          </Space>
        </Space>
      </Card>
    </Space>
  );
}
