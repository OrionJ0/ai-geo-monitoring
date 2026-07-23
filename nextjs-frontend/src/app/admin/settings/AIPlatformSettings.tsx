'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
  type TableProps,
} from 'antd';
import axios from '@/lib/axiosConfig';
import { getApiErrorMessage } from '@/utils/apiErrorMessage.cjs';

const { Text } = Typography;

type TestStatus = 'untested' | 'success' | 'failed';

type PlatformRecord = {
  id: number;
  code: string;
  name: string;
  adapter_type: 'doubao_responses' | 'openai_chat_completions';
  base_url: string;
  default_model: string;
  request_timeout_seconds: number | null;
  max_tokens: number | null;
  enabled: boolean;
  builtin: boolean;
  configured: boolean;
  api_key_last4: string | null;
  test_status: TestStatus;
  last_tested_at: string | null;
  last_test_message: string | null;
};

type PlatformFormValues = {
  code: string;
  name: string;
  adapter_type: PlatformRecord['adapter_type'];
  base_url: string;
  api_key?: string;
  default_model: string;
  request_timeout_seconds?: number | null;
  max_tokens?: number | null;
  enabled: boolean;
};

const adapterOptions = [
  { label: 'OpenAI Chat Completions 兼容', value: 'openai_chat_completions' },
  { label: '豆包 Responses', value: 'doubao_responses' },
];

function testStatusTag(status: TestStatus) {
  if (status === 'success') return <Tag color="success">测试成功</Tag>;
  if (status === 'failed') return <Tag color="error">测试失败</Tag>;
  return <Tag>未测试</Tag>;
}

export default function AIPlatformSettings({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const [platforms, setPlatforms] = useState<PlatformRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [editing, setEditing] = useState<PlatformRecord | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<PlatformFormValues>();

  const fetchPlatforms = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/admin/ai-platforms');
      setPlatforms(Array.isArray(response?.data?.data) ? response.data.data : []);
    } catch (error) {
      message.error(getApiErrorMessage(error, '获取 AI 平台失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlatforms();
  }, [fetchPlatforms, refreshSignal]);

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({
      code: '',
      name: '',
      adapter_type: 'openai_chat_completions',
      base_url: '',
      api_key: '',
      default_model: '',
      request_timeout_seconds: null,
      max_tokens: null,
      enabled: true,
    });
    setOpen(true);
  };

  const openEdit = (platform: PlatformRecord) => {
    setEditing(platform);
    form.setFieldsValue({
      code: platform.code,
      name: platform.name,
      adapter_type: platform.adapter_type,
      base_url: platform.base_url,
      api_key: '',
      default_model: platform.default_model,
      request_timeout_seconds: platform.request_timeout_seconds,
      max_tokens: platform.max_tokens,
      enabled: platform.enabled,
    });
    setOpen(true);
  };

  const savePlatform = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload = {
        ...values,
        api_key: values.api_key?.trim() || '',
        request_timeout_seconds: values.request_timeout_seconds ?? null,
        max_tokens: values.max_tokens ?? null,
      };
      if (editing) {
        await axios.put(`/api/admin/ai-platforms/${editing.id}`, payload);
        message.success('AI 平台已更新');
      } else {
        await axios.post('/api/admin/ai-platforms', payload);
        message.success('AI 平台已新增');
      }
      setOpen(false);
      form.resetFields();
      await fetchPlatforms();
    } catch (error) {
      if (error && typeof error === 'object' && 'errorFields' in error) return;
      message.error(getApiErrorMessage(error, '保存 AI 平台失败'));
    } finally {
      setSaving(false);
    }
  };

  const setEnabled = async (platform: PlatformRecord, enabled: boolean) => {
    try {
      await axios.put(`/api/admin/ai-platforms/${platform.id}/enabled`, { enabled });
      message.success(enabled ? '平台已启用' : '平台已停用');
      await fetchPlatforms();
    } catch (error) {
      message.error(getApiErrorMessage(error, '更新平台状态失败'));
    }
  };

  const testConnection = async (platform: PlatformRecord) => {
    setTestingId(platform.id);
    try {
      const response = await axios.post(`/api/admin/ai-platforms/${platform.id}/test`);
      const connection = response?.data?.data?.connection;
      if (connection?.success) message.success(`${platform.name} 连接成功`);
      else message.error(connection?.message || `${platform.name} 连接失败`);
      await fetchPlatforms();
    } catch (error) {
      message.error(getApiErrorMessage(error, '连接测试失败'));
    } finally {
      setTestingId(null);
    }
  };

  const clearApiKey = async (platform: PlatformRecord) => {
    try {
      await axios.delete(`/api/admin/ai-platforms/${platform.id}/api-key`);
      message.success(`${platform.name} 的 API Key 已清除`);
      await fetchPlatforms();
    } catch (error) {
      message.error(getApiErrorMessage(error, '清除 API Key 失败'));
    }
  };

  const archivePlatform = async (platform: PlatformRecord) => {
    try {
      await axios.delete(`/api/admin/ai-platforms/${platform.id}`);
      message.success('AI 平台已归档');
      await fetchPlatforms();
    } catch (error) {
      message.error(getApiErrorMessage(error, '归档 AI 平台失败'));
    }
  };

  const columns: TableProps<PlatformRecord>['columns'] = [
    {
      title: '平台',
      key: 'platform',
      width: 190,
      render: (_, platform) => (
        <Space orientation="vertical" size={2}>
          <Space size={6}>
            <Text strong>{platform.name}</Text>
            {platform.builtin ? <Tag color="blue">预置</Tag> : <Tag>自定义</Tag>}
          </Space>
          <Text type="secondary">{platform.code}</Text>
        </Space>
      ),
    },
    {
      title: '接口与模型',
      key: 'endpoint',
      render: (_, platform) => (
        <Space orientation="vertical" size={2} style={{ maxWidth: 440 }}>
          <Text>{platform.default_model}</Text>
          <Text type="secondary" ellipsis={{ tooltip: platform.base_url }}>{platform.base_url}</Text>
        </Space>
      ),
    },
    {
      title: '配置状态',
      key: 'configured',
      width: 130,
      render: (_, platform) => platform.configured
        ? <Tag color="success">已配置 · {platform.api_key_last4}</Tag>
        : <Tag color="warning">未配置</Tag>,
    },
    {
      title: '启用状态',
      key: 'enabled',
      width: 100,
      render: (_, platform) => (
        <Switch
          checked={platform.enabled}
          checkedChildren="启用"
          unCheckedChildren="停用"
          onChange={(checked) => setEnabled(platform, checked)}
        />
      ),
    },
    {
      title: '测试状态',
      key: 'test_status',
      width: 180,
      render: (_, platform) => (
        <Space orientation="vertical" size={2}>
          {testStatusTag(platform.test_status)}
          <Text type="secondary" style={{ fontSize: 12 }}>
            {platform.last_tested_at ? new Date(platform.last_tested_at).toLocaleString() : '尚未主动测试'}
          </Text>
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 260,
      fixed: 'right',
      render: (_, platform) => (
        <Space wrap>
          <Button size="small" onClick={() => openEdit(platform)}>编辑</Button>
          <Button size="small" loading={testingId === platform.id} onClick={() => testConnection(platform)}>测试连接</Button>
          {platform.configured ? (
            <Popconfirm
              title="确认清除 API Key？"
              description="清除后该平台将不能参与运行，启用状态不会自动改变。"
              onConfirm={() => clearApiKey(platform)}
            >
              <Button size="small" danger>清除密钥</Button>
            </Popconfirm>
          ) : null}
          {!platform.builtin ? (
            <Popconfirm title="确认归档该平台？" onConfirm={() => archivePlatform(platform)}>
              <Button size="small" danger>归档</Button>
            </Popconfirm>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        title="平台配置由管理员人工维护"
        description="系统不会自动导入 .env 中的 AI API 配置。平台启用与连接测试互相独立，是否测试由管理员自行决定。"
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Space>
          <Button onClick={fetchPlatforms}>刷新</Button>
          <Button type="primary" onClick={openCreate}>新增平台</Button>
        </Space>
      </div>
      <Table<PlatformRecord>
        rowKey="id"
        loading={loading}
        dataSource={platforms}
        columns={columns}
        pagination={false}
        scroll={{ x: 1180 }}
      />

      <Modal
        title={editing ? `编辑平台：${editing.name}` : '新增 AI 平台'}
        open={open}
        onOk={savePlatform}
        confirmLoading={saving}
        onCancel={() => { setOpen(false); form.resetFields(); }}
        okText="保存"
        cancelText="取消"
        width={720}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Space align="start" size="middle" style={{ width: '100%' }}>
            <Form.Item name="name" label="平台名称" rules={[{ required: true, message: '请输入平台名称' }]} style={{ flex: 1 }}>
              <Input placeholder="例如 Example AI" />
            </Form.Item>
            <Form.Item
              name="code"
              label="唯一标识"
              rules={[
                { required: true, message: '请输入唯一标识' },
                { pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, message: '仅支持小写字母、数字和连字符' },
              ]}
              style={{ flex: 1 }}
            >
              <Input disabled={Boolean(editing)} placeholder="example-ai" />
            </Form.Item>
          </Space>
          <Form.Item name="adapter_type" label="接口类型" rules={[{ required: true }]}>
            <Select options={adapterOptions} disabled={Boolean(editing?.builtin)} />
          </Form.Item>
          <Form.Item
            name="base_url"
            label="Base URL（完整请求地址）"
            rules={[{ required: true, message: '请输入 Base URL' }, { type: 'url', message: '请输入有效 URL' }]}
          >
            <Input placeholder="https://api.example.com/v1/chat/completions" />
          </Form.Item>
          <Form.Item name="default_model" label="默认模型" rules={[{ required: true, message: '请输入默认模型' }]}>
            <Input placeholder="example-model" />
          </Form.Item>
          <Form.Item
            name="api_key"
            label="API Key"
            extra={editing?.configured ? `已配置（末四位 ${editing.api_key_last4}），留空则保留现有密钥` : '当前未配置；可以先保存，之后再补充'}
          >
            <Input.Password autoComplete="new-password" placeholder={editing?.configured ? '留空则保留现有密钥' : '请输入 API Key'} />
          </Form.Item>
          <Space align="start" size="middle" style={{ width: '100%' }}>
            <Form.Item name="request_timeout_seconds" label="请求超时（秒）" style={{ flex: 1 }}>
              <InputNumber min={10} max={180} placeholder="继承全局设置" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="max_tokens" label="最大 Token" style={{ flex: 1 }}>
              <InputNumber min={256} max={32768} placeholder="继承全局设置" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="enabled" label="启用状态" valuePropName="checked" style={{ flex: 1 }}>
              <Switch checkedChildren="启用" unCheckedChildren="停用" />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </Space>
  );
}
