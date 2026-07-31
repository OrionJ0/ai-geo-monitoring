'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Form, Input, InputNumber, Select, Space, Tabs, message } from 'antd';
import axios from '@/lib/axiosConfig';
import { getApiErrorMessage } from '@/utils/apiErrorMessage.cjs';
import AIPlatformSettings from './AIPlatformSettings';
import AIAnalysisSettings from './AIAnalysisSettings';
import BaiduMarketingSettings from './BaiduMarketingSettings';
import WorkspaceSettings from './WorkspaceSettings';
import OwnedSeoDomainsSettings from './OwnedSeoDomainsSettings';

type SettingsResponse = {
  seo_title?: string;
  seo_description?: string;
  seo_keywords?: string;
  seo_robots?: string;
  ai_run_concurrency?: string | number;
  ai_retry_count?: string | number;
  ai_default_timeout_seconds?: string | number;
  ai_default_max_tokens?: string | number;
};

export default function AdminSettingsPage() {
  const [loading, setLoading] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [activeTab, setActiveTab] = useState('ai-platforms');
  const [seoForm] = Form.useForm();
  const [runtimeForm] = Form.useForm();

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/settings');
      const data: SettingsResponse = response?.data?.data || {};
      seoForm.setFieldsValue({
        seo_title: data.seo_title || '',
        seo_description: data.seo_description || '',
        seo_keywords: data.seo_keywords || '',
        seo_robots: data.seo_robots || 'index,follow',
      });
      runtimeForm.setFieldsValue({
        ai_run_concurrency: Number(data.ai_run_concurrency || 2),
        ai_retry_count: Number(data.ai_retry_count ?? 3),
        ai_default_timeout_seconds: Number(data.ai_default_timeout_seconds || 90),
        ai_default_max_tokens: Number(data.ai_default_max_tokens || 4096),
      });
    } catch (error) {
      message.error(getApiErrorMessage(error, '获取设置失败'));
    } finally {
      setLoading(false);
    }
  }, [runtimeForm, seoForm]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if ([
      'ai-platforms',
      'ai-analysis',
      'workspace',
      'marketing',
      'runtime',
      'seo',
      'seo-audit',
    ].includes(hash)) {
      setActiveTab(hash);
    }
  }, []);

  const refreshAll = () => {
    fetchSettings();
    setRefreshSignal((value) => value + 1);
  };

  const saveRuntimeSettings = async () => {
    try {
      const values = await runtimeForm.validateFields();
      await axios.put('/api/settings', values);
      message.success('运行设置已更新，将从下一次运行开始生效');
      await fetchSettings();
    } catch (error) {
      if (error && typeof error === 'object' && 'errorFields' in error) return;
      message.error(getApiErrorMessage(error, '保存运行设置失败'));
    }
  };

  const saveSeoSettings = async () => {
    try {
      const values = await seoForm.validateFields();
      await axios.put('/api/settings', {
        seo_title: values.seo_title || '',
        seo_description: values.seo_description || '',
        seo_keywords: values.seo_keywords || '',
        seo_robots: values.seo_robots || 'index,follow',
      });
      message.success('站点 SEO 设置已更新');
      await fetchSettings();
    } catch (error) {
      if (error && typeof error === 'object' && 'errorFields' in error) return;
      message.error(getApiErrorMessage(error, '保存站点 SEO 设置失败'));
    }
  };

  const runtimeSettings = (
    <Form form={runtimeForm} layout="vertical" requiredMark={false} disabled={loading} style={{ maxWidth: 640 }}>
      <Form.Item
        name="ai_run_concurrency"
        label="并发问题数"
        extra="同一批运行最多同时请求的平台任务数。"
        rules={[{ required: true, type: 'number', min: 1, max: 5 }]}
      >
        <InputNumber min={1} max={5} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item
        name="ai_retry_count"
        label="失败重试次数"
        extra="认证失败和配置错误不会重试。"
        rules={[{ required: true, type: 'number', min: 0, max: 3 }]}
      >
        <InputNumber min={0} max={3} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item
        name="ai_default_timeout_seconds"
        label="默认请求超时（秒）"
        rules={[{ required: true, type: 'number', min: 10, max: 180 }]}
      >
        <InputNumber min={10} max={180} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item
        name="ai_default_max_tokens"
        label="默认最大 Token"
        rules={[{ required: true, type: 'number', min: 256, max: 32768 }]}
      >
        <InputNumber min={256} max={32768} style={{ width: '100%' }} />
      </Form.Item>
      <Space>
        <Button type="primary" onClick={saveRuntimeSettings}>保存运行设置</Button>
        <Button onClick={fetchSettings}>恢复当前值</Button>
      </Space>
    </Form>
  );

  const seoSettings = (
    <Form form={seoForm} layout="vertical" requiredMark={false} disabled={loading} style={{ maxWidth: 760 }}>
      <Form.Item name="seo_title" label="站点标题（title）" extra="留空使用应用默认标题。">
        <Input placeholder="留空使用应用默认标题" />
      </Form.Item>
      <Form.Item name="seo_description" label="站点描述（meta description）">
        <Input.TextArea rows={4} placeholder="简要描述站点用途与价值" />
      </Form.Item>
      <Form.Item name="seo_keywords" label="关键词（meta keywords）">
        <Input placeholder="用逗号分隔多个关键词" />
      </Form.Item>
      <Form.Item name="seo_robots" label="Robots 指令">
        <Select
          options={[
            { value: 'index,follow', label: 'index, follow' },
            { value: 'index,nofollow', label: 'index, nofollow' },
            { value: 'noindex,follow', label: 'noindex, follow' },
            { value: 'noindex,nofollow', label: 'noindex, nofollow' },
          ]}
        />
      </Form.Item>
      <Space>
        <Button type="primary" onClick={saveSeoSettings}>保存站点 SEO</Button>
        <Button onClick={fetchSettings}>恢复当前值</Button>
      </Space>
    </Form>
  );

  return (
    <Card title="设置中心" extra={<Button onClick={refreshAll}>刷新全部设置</Button>}>
      <Tabs
        activeKey={activeTab}
        onChange={(key) => {
          setActiveTab(key);
          window.history.replaceState(
            null,
            '',
            `${window.location.pathname}${window.location.search}#${key}`
          );
        }}
        items={[
          { key: 'workspace', label: '工作台', children: <WorkspaceSettings />, destroyOnHidden: false },
          { key: 'ai-platforms', label: 'AI 平台', children: <AIPlatformSettings refreshSignal={refreshSignal} />, destroyOnHidden: false },
          { key: 'ai-analysis', label: 'AI 分析 API', children: <AIAnalysisSettings />, destroyOnHidden: false },
          { key: 'marketing', label: '营销监控', children: <BaiduMarketingSettings />, destroyOnHidden: false },
          { key: 'runtime', label: '运行设置', children: runtimeSettings, forceRender: true },
          { key: 'seo', label: '站点 SEO', children: seoSettings, forceRender: true },
          { key: 'seo-audit', label: '自有检测站点', children: <OwnedSeoDomainsSettings />, destroyOnHidden: false },
        ]}
      />
    </Card>
  );
}
