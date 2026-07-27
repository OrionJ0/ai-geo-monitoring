'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ReloadOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Descriptions,
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
import type { AIPlatformCapabilities } from '@/lib/useAIPlatformCatalog';

const { Text } = Typography;
const MASKED_API_KEY = '********************************';

type TestStatus = 'untested' | 'success' | 'failed';
type WebSearchTestStatus = TestStatus | 'inconclusive';

type PlatformRecord = {
  id: number;
  code: string;
  name: string;
  adapter_type: 'openai_responses' | 'openai_chat_completions' | 'deepseek_web';
  base_url: string;
  default_model: string;
  request_timeout_seconds: number | null;
  max_tokens: number | null;
  request_options: Record<string, unknown>;
  enabled: boolean;
  builtin: boolean;
  configured: boolean;
  api_key_last4: string | null;
  test_status: TestStatus;
  last_tested_at: string | null;
  last_test_message: string | null;
  web_search_test_status: WebSearchTestStatus;
  last_web_search_tested_at: string | null;
  last_web_search_test_message: string | null;
  capabilities: AIPlatformCapabilities;
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
  request_options_text: string;
  enabled: boolean;
};

type WebSearchTestResult = {
  success: boolean;
  status: WebSearchTestStatus;
  message: string;
  evidence_type?: string;
  response_time_ms?: number;
  model_name?: string;
  input?: string;
  output?: {
    text?: string;
    provider_response?: unknown;
  } | null;
};

const adapterOptions = [
  { label: 'OpenAI 兼容 · Chat Completions', value: 'openai_chat_completions' },
  { label: 'OpenAI 兼容 · Responses（可返回搜索来源）', value: 'openai_responses' },
];

function adapterLabel(adapterType: PlatformRecord['adapter_type']) {
  if (adapterType === 'deepseek_web') return '真实网页 · 本机 Chrome';
  return adapterOptions.find((item) => item.value === adapterType)?.label || adapterType;
}

function testStatusTag(status: WebSearchTestStatus, kind: 'connection' | 'web_search' = 'connection') {
  if (status === 'success') return <Tag color="success">测试成功</Tag>;
  if (status === 'failed') return <Tag color="error">测试失败</Tag>;
  if (status === 'inconclusive') return <Tag color="warning">证据不足</Tag>;
  if (kind === 'web_search') return <Tag>未检测</Tag>;
  return <Tag>未测试</Tag>;
}

function stringifyRequestOptions(value: PlatformRecord['request_options']) {
  return JSON.stringify(value && typeof value === 'object' && !Array.isArray(value) ? value : {}, null, 2);
}

export default function AIPlatformSettings({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const [platforms, setPlatforms] = useState<PlatformRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [preserveExistingApiKey, setPreserveExistingApiKey] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testingWebSearchId, setTestingWebSearchId] = useState<number | null>(null);
  const [webSearchTestResult, setWebSearchTestResult] = useState<{
    platform: PlatformRecord;
    result: WebSearchTestResult;
  } | null>(null);
  const [editing, setEditing] = useState<PlatformRecord | null>(null);
  const [open, setOpen] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelLoading, setModelLoading] = useState(false);
  const [form] = Form.useForm<PlatformFormValues>();
  const apiKeyRevealRequest = useRef(0);
  const apiKeyRevealPending = useRef(false);

  const resetApiKeyEditor = (preserveExisting = false) => {
    apiKeyRevealRequest.current += 1;
    apiKeyRevealPending.current = false;
    setApiKeyVisible(false);
    setPreserveExistingApiKey(preserveExisting);
  };

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
    setModelDropdownOpen(false);
    setModelOptions([]);
    resetApiKeyEditor();
    form.setFieldsValue({
      code: '',
      name: '',
      adapter_type: 'openai_chat_completions',
      base_url: '',
      api_key: '',
      default_model: '',
      request_timeout_seconds: null,
      max_tokens: null,
      request_options_text: '{}',
      enabled: true,
    });
    setOpen(true);
  };

  const openEdit = (platform: PlatformRecord) => {
    setEditing(platform);
    setModelDropdownOpen(false);
    resetApiKeyEditor(platform.configured);
    form.setFieldsValue({
      code: platform.code,
      name: platform.name,
      adapter_type: platform.adapter_type,
      base_url: platform.base_url,
      api_key: platform.configured ? MASKED_API_KEY : '',
      default_model: platform.default_model,
      request_timeout_seconds: platform.request_timeout_seconds,
      max_tokens: platform.max_tokens,
      request_options_text: stringifyRequestOptions(platform.request_options),
      enabled: platform.enabled,
    });
    setOpen(true);
    if (platform.configured && platform.capabilities.model_listing) {
      void loadModels(platform.id, platform.default_model);
    } else {
      setModelOptions(platform.default_model ? [platform.default_model] : []);
    }
  };

  const loadModels = useCallback(async (
    platformId: number,
    fallbackModel = '',
    notifyResult = false,
  ) => {
    setModelLoading(true);
    setModelOptions(fallbackModel ? [fallbackModel] : []);
    try {
      const response = await axios.get(`/api/admin/ai-platforms/${platformId}/models`);
      const models: string[] = Array.isArray(response?.data?.data?.models)
        ? response.data.data.models.map((item: unknown) => String(item || '').trim()).filter(Boolean)
        : [];
      setModelOptions(Array.from(new Set([fallbackModel, ...models].filter(Boolean))));
      if (notifyResult) {
        message.success(`已从平台读取 ${models.length} 个模型，列表不会保存`);
        setModelDropdownOpen(true);
      }
    } catch (error) {
      message.warning(getApiErrorMessage(error, '未能获取模型列表，仍可使用当前默认模型'));
    } finally {
      setModelLoading(false);
    }
  }, []);

  const refreshModels = () => {
    if (!editing) {
      message.warning('保存平台后即可刷新模型列表');
      return;
    }
    if (!editing.configured) {
      message.warning('请先配置 API Key 和 Base URL');
      return;
    }
    const currentModel = String(form.getFieldValue('default_model') || editing.default_model || '');
    void loadModels(editing.id, currentModel, true);
  };

  const revealApiKey = async (platform: PlatformRecord) => {
    if (apiKeyRevealPending.current) return;
    const requestId = apiKeyRevealRequest.current + 1;
    apiKeyRevealRequest.current = requestId;
    apiKeyRevealPending.current = true;
    try {
      const response = await axios.get(`/api/admin/ai-platforms/${platform.id}/api-key`);
      if (apiKeyRevealRequest.current !== requestId) return;
      form.setFieldValue('api_key', response?.data?.data?.api_key || '');
      setApiKeyVisible(true);
    } catch (error) {
      if (apiKeyRevealRequest.current !== requestId) return;
      form.setFieldValue('api_key', MASKED_API_KEY);
      setApiKeyVisible(false);
      message.error(getApiErrorMessage(error, '读取 API Key 失败'));
    } finally {
      if (apiKeyRevealRequest.current === requestId) {
        apiKeyRevealPending.current = false;
      }
    }
  };

  const handleApiKeyVisibilityChange = (visible: boolean) => {
    if (!visible) {
      setApiKeyVisible(false);
      if (editing?.configured && preserveExistingApiKey) {
        form.setFieldValue('api_key', MASKED_API_KEY);
      }
      return;
    }

    if (editing?.configured && preserveExistingApiKey) {
      void revealApiKey(editing);
      return;
    }

    setApiKeyVisible(true);
  };

  const savePlatform = async () => {
    try {
      const values = await form.validateFields();
      const {
        request_options_text: requestOptionsText,
        ...editableValues
      } = values;
      const requestOptions = JSON.parse(requestOptionsText || '{}');
      setSaving(true);
      const payload = {
        ...editableValues,
        request_options: requestOptions,
        api_key: preserveExistingApiKey ? '' : values.api_key?.trim() || '',
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
      resetApiKeyEditor();
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
      await axios.patch(`/api/admin/ai-platforms/${platform.id}/enabled`, { enabled });
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

  const testWebSearch = async (platform: PlatformRecord) => {
    setTestingWebSearchId(platform.id);
    try {
      const response = await axios.post(`/api/admin/ai-platforms/${platform.id}/test-web-search`);
      const result = response?.data?.data?.web_search;
      if (result) setWebSearchTestResult({ platform, result });
      if (result?.status === 'success') {
        message.success(`${platform.name} 已检测到联网搜索证据`);
      } else if (result?.status === 'inconclusive') {
        message.warning(`${platform.name} 调用成功，但没有可验证的联网搜索证据`);
      } else {
        message.error(result?.message || `${platform.name} 联网能力检测失败`);
      }
      await fetchPlatforms();
    } catch (error) {
      message.error(getApiErrorMessage(error, '联网能力检测失败'));
    } finally {
      setTestingWebSearchId(null);
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

  const deletePlatform = async (platform: PlatformRecord) => {
    try {
      await axios.delete(`/api/admin/ai-platforms/${platform.id}`);
      message.success('AI 平台已删除');
      await fetchPlatforms();
    } catch (error) {
      message.error(getApiErrorMessage(error, '删除 AI 平台失败'));
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
      title: '接口参数',
      key: 'endpoint',
      render: (_, platform) => (
        <Space orientation="vertical" size={2} style={{ maxWidth: 440 }}>
          <Text type="secondary">{adapterLabel(platform.adapter_type)}</Text>
          <Text type="secondary" ellipsis={{ tooltip: platform.base_url }}>{platform.base_url}</Text>
          {platform.adapter_type === 'deepseek_web' ? (
            <Text type="secondary">登录方式：本机人工登录并复用专用会话</Text>
          ) : (
            <Text
              type="secondary"
              code
              ellipsis={{ tooltip: stringifyRequestOptions(platform.request_options) }}
              style={{ maxWidth: 420 }}
            >
              请求参数：{JSON.stringify(platform.request_options || {})}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: '当前模型',
      dataIndex: 'default_model',
      key: 'model',
      width: 240,
      render: (value: string) => <Text>{value || '-'}</Text>,
    },
    {
      title: '配置状态',
      key: 'configured',
      width: 130,
      render: (_, platform) => {
        if (platform.capabilities.interactive_login) {
          return <Tag color={platform.configured ? 'processing' : 'warning'}>需本机人工登录</Tag>;
        }
        return platform.configured
          ? <Tag color="success">已配置 · {platform.api_key_last4}</Tag>
          : <Tag color="warning">未配置</Tag>;
      },
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
      title: '连接测试',
      key: 'connection_test_status',
      width: 150,
      render: (_, platform) => platform.capabilities.connection_test ? (
        <Space orientation="vertical" size={2}>
          {testStatusTag(platform.test_status)}
          <Text type="secondary" style={{ fontSize: 12 }}>
            {platform.last_tested_at ? new Date(platform.last_tested_at).toLocaleString() : '尚未主动测试'}
          </Text>
        </Space>
      ) : <Text type="secondary">不适用</Text>,
    },
    {
      title: '联网能力',
      key: 'web_search_test_status',
      width: 170,
      render: (_, platform) => platform.capabilities.api_web_search_test ? (
        <Space orientation="vertical" size={2}>
          {testStatusTag(platform.web_search_test_status || 'untested', 'web_search')}
          <Text type="secondary" style={{ fontSize: 12 }}>
            {platform.last_web_search_tested_at
              ? new Date(platform.last_web_search_tested_at).toLocaleString()
              : '尚未检测'}
          </Text>
          {platform.last_web_search_test_message ? (
            <Text type="secondary" ellipsis={{ tooltip: platform.last_web_search_test_message }} style={{ maxWidth: 150, fontSize: 12 }}>
              {platform.last_web_search_test_message}
            </Text>
          ) : null}
        </Space>
      ) : <Text type="secondary">由真实页面采集验证</Text>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 330,
      fixed: 'right',
      render: (_, platform) => (
        <Space wrap>
          {platform.adapter_type !== 'deepseek_web' ? (
            <Button size="small" onClick={() => openEdit(platform)}>编辑</Button>
          ) : null}
          {platform.capabilities.connection_test ? (
            <Button size="small" loading={testingId === platform.id} onClick={() => testConnection(platform)}>测试连接</Button>
          ) : null}
          {platform.capabilities.api_web_search_test ? (
            <Button
              size="small"
              loading={testingWebSearchId === platform.id}
              onClick={() => testWebSearch(platform)}
            >
              检测联网能力
            </Button>
          ) : null}
          {platform.configured && platform.capabilities.api_key_management ? (
            <Popconfirm
              title="确认清除 API Key？"
              description="清除后该平台将不能参与运行，启用状态不会自动改变。"
              onConfirm={() => clearApiKey(platform)}
            >
              <Button size="small" danger>清除密钥</Button>
            </Popconfirm>
          ) : null}
          {!platform.builtin ? (
            <Popconfirm
              title="确认删除该平台？"
              description="删除后不再显示在平台列表中，历史运行记录仍保留平台和模型信息。"
              onConfirm={() => deletePlatform(platform)}
            >
              <Button size="small" danger>删除</Button>
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
        title="API 平台与真实网页监测使用独立能力"
        description="自定义平台继续使用 OpenAI 兼容协议；DeepSeek 网页版是受管监测平台，只允许启停，并通过本机专用 Chrome 人工登录，不配置 API Key 或模型目录。"
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
        scroll={{ x: 1560 }}
      />

      <Modal
        title={editing ? `编辑平台：${editing.name}` : '新增 AI 平台'}
        open={open}
        onOk={savePlatform}
        confirmLoading={saving}
        onCancel={() => {
          setOpen(false);
          resetApiKeyEditor();
          form.resetFields();
        }}
        okText="保存"
        cancelText="取消"
        width={720}
        forceRender
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
            label="Base URL"
            rules={[{ required: true, message: '请输入 Base URL' }, { type: 'url', message: '请输入有效 URL' }]}
            extra="可填写 API 根地址或完整请求地址；系统会按接口类型补全 /chat/completions 或 /responses。千问若需返回可提取的联网来源，请选 OpenAI Responses 兼容并确认当前模型支持。"
          >
            <Input placeholder="https://api.example.com/v1" />
          </Form.Item>
          <Form.Item
            label="默认模型"
            extra={(
              <Space orientation="vertical" size={0}>
                <span>可从供应商接口临时读取可用模型；系统仅保存最终选择的模型名称，不缓存模型列表。</span>
              </Space>
            )}
          >
            <Space.Compact block>
              <Form.Item
                name="default_model"
                noStyle
                rules={[{ required: true, message: '请选择或输入默认模型' }]}
              >
                <Select
                  showSearch
                  open={modelDropdownOpen}
                  onOpenChange={setModelDropdownOpen}
                  optionFilterProp="label"
                  loading={modelLoading}
                  placeholder="选择或输入模型名称"
                  mode={undefined}
                  style={{ width: '100%' }}
                  options={modelOptions.map((model) => ({ value: model, label: model }))}
                />
              </Form.Item>
              <Button
                icon={<ReloadOutlined />}
                loading={modelLoading}
                disabled={!editing || !editing.capabilities.model_listing}
                onClick={refreshModels}
              >
                刷新模型
              </Button>
            </Space.Compact>
          </Form.Item>
          <Form.Item
            name="api_key"
            label="API Key"
            extra={editing?.configured
              ? '已配置；点击眼睛查看完整密钥，直接输入新值可替换现有密钥。系统不会自动导入浏览器或环境中的密钥。'
              : '当前未配置；可以先保存，之后再补充。系统不会自动导入浏览器或环境中的密钥。'}
          >
            <Input.Password
              autoComplete="new-password"
              placeholder="请输入 API Key"
              visibilityToggle={{
                visible: apiKeyVisible,
                onVisibleChange: handleApiKeyVisibilityChange,
              }}
              onFocus={(event) => {
                if (editing?.configured && preserveExistingApiKey && !apiKeyVisible) {
                  event.currentTarget.select();
                }
              }}
              onChange={() => setPreserveExistingApiKey(false)}
            />
          </Form.Item>
          <Form.Item
            name="request_options_text"
            label="模型请求参数（JSON）"
            extra="没有明确需要时保留 {}。系统会按接口类型添加必要字段和联网工具，不需要重复填写。"
            rules={[
              { required: true, message: '请输入 JSON 对象，未配置时填写 {}' },
              {
                validator: async (_, value) => {
                  try {
                    const parsed = JSON.parse(value || '{}');
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                      throw new Error('请求参数必须是 JSON 对象');
                    }
                  } catch (error) {
                    throw new Error(error instanceof Error ? error.message : '请求参数 JSON 格式无效');
                  }
                },
              },
            ]}
          >
            <Input.TextArea
              rows={7}
              spellCheck={false}
              placeholder="{}"
              style={{ fontFamily: 'var(--font-geist-mono), monospace' }}
            />
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

      <Modal
        title={webSearchTestResult
          ? `联网能力测试：${webSearchTestResult.platform.name}`
          : '联网能力测试'}
        open={Boolean(webSearchTestResult)}
        onCancel={() => setWebSearchTestResult(null)}
        footer={<Button onClick={() => setWebSearchTestResult(null)}>关闭</Button>}
        width={860}
        destroyOnHidden
      >
        {webSearchTestResult ? (
          <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
            <Alert
              type={webSearchTestResult.result.status === 'success' ? 'success' : 'warning'}
              showIcon
              title={webSearchTestResult.result.message}
              description="本次测试的输入和 API 输出不会写入数据库；系统只保留状态、检测时间和简短结论。"
            />
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="测试输入">
                <Text style={{ whiteSpace: 'pre-wrap' }}>
                  {webSearchTestResult.result.input || '未返回测试输入'}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="模型文本输出">
                <Text style={{ whiteSpace: 'pre-wrap' }}>
                  {webSearchTestResult.result.output?.text || 'API 未返回文本'}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="联网证据">
                {webSearchTestResult.result.evidence_type
                  ? <Tag color="success">{webSearchTestResult.result.evidence_type}</Tag>
                  : <Tag color="warning">供应商未返回可验证证据</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label="供应商 API 输出">
                <pre style={{ maxHeight: 360, margin: 0, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(
                    webSearchTestResult.result.output?.provider_response ?? null,
                    null,
                    2,
                  )}
                </pre>
              </Descriptions.Item>
            </Descriptions>
          </Space>
        ) : null}
      </Modal>
    </Space>
  );
}
