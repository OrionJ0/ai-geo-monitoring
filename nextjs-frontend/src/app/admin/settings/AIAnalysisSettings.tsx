'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ReloadOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import axios from '@/lib/axiosConfig';
import { getApiErrorMessage } from '@/utils/apiErrorMessage.cjs';

const { Paragraph, Text, Title } = Typography;

type PlatformRecord = {
  id: number;
  code: string;
  name: string;
  adapter_type: 'openai_responses' | 'openai_chat_completions';
  default_model: string;
  enabled: boolean;
  configured: boolean;
  archived_at?: string | null;
};

type PromptDefinition = {
  version: string;
  template: string;
  runtime_fields: string[];
  expected_output: Record<string, unknown>;
  request_profile: {
    temperature: number;
    max_tokens: number;
    timeout_seconds: number;
    max_attempts: number;
    web_search: boolean;
    json_mode: string;
    deepseek_thinking: string;
  };
};

type AnalysisConfig = {
  platform_code: string;
  model_name: string;
  configured: boolean;
  unavailable_reason?: string | null;
  platform?: {
    code: string;
    name: string;
    model_name: string;
  } | null;
};

type AnalysisTestResult = {
  input: {
    brand_name: string;
    brand_aliases: string[];
    response_text: string;
  };
  output: Record<string, unknown> & {
    raw_output?: string;
  };
};

type TestValues = {
  brand_name: string;
  brand_aliases_text?: string;
  response_text: string;
};

type AnalysisConfigValues = {
  platform_code: string;
  model_name: string;
};

const sampleAnswer = [
  '1. 海康威视：综合安防能力强。',
  '2. 大华股份：教育行业项目覆盖广。',
  '3. 上海广拓（GATO）：在张力式电子围栏领域经验丰富，是专业领域的头部选择。',
].join('\n');

function adapterLabel(adapterType?: PlatformRecord['adapter_type']) {
  return adapterType === 'openai_responses'
    ? 'OpenAI 兼容 · Responses'
    : 'OpenAI 兼容 · Chat Completions';
}

function jsonModeLabel(
  platform?: PlatformRecord,
  profile?: PromptDefinition['request_profile'],
) {
  if (!platform) return '-';
  return platform.adapter_type === 'openai_chat_completions'
    && profile?.json_mode === 'chat_completions_only'
    ? '强制 JSON Object'
    : '提示词约束（Responses）';
}

function thinkingModeLabel(
  platform?: PlatformRecord,
  profile?: PromptDefinition['request_profile'],
) {
  if (platform?.code !== 'deepseek') return '不适用';
  return profile?.deepseek_thinking === 'disabled' ? '关闭' : '按平台配置';
}

export default function AIAnalysisSettings() {
  const [platforms, setPlatforms] = useState<PlatformRecord[]>([]);
  const [config, setConfig] = useState<AnalysisConfig | null>(null);
  const [promptDefinition, setPromptDefinition] = useState<PromptDefinition | null>(null);
  const [loading, setLoading] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AnalysisTestResult | null>(null);
  const [configForm] = Form.useForm<AnalysisConfigValues>();
  const [testForm] = Form.useForm<TestValues>();
  const selectedPlatformCode = Form.useWatch('platform_code', configForm);

  const loadModels = useCallback(async (
    platformId: number,
    fallbackModel = '',
    notifyResult = false,
  ) => {
    setModelLoading(true);
    setModelOptions(fallbackModel ? [fallbackModel] : []);
    try {
      const response = await axios.get(`/api/admin/ai-platforms/${platformId}/models`);
      const models = Array.isArray(response?.data?.data?.models)
        ? response.data.data.models.map((item: unknown) => String(item || '').trim()).filter(Boolean)
        : [];
      setModelOptions(Array.from(new Set([fallbackModel, ...models].filter(Boolean))));
      if (notifyResult) {
        message.success(`已从平台读取 ${models.length} 个模型，本次读取的列表不会保存`);
        setModelDropdownOpen(true);
      }
    } catch (error) {
      message.warning(getApiErrorMessage(error, '未能获取模型列表，仍可使用当前默认模型'));
    } finally {
      setModelLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [platformResponse, configResponse, promptResponse] = await Promise.all([
        axios.get('/api/admin/ai-platforms'),
        axios.get('/api/settings/analysis-api'),
        axios.get('/api/settings/analysis-api/prompt', {
          params: { cache_bust: Date.now() },
        }),
      ]);
      const nextPlatforms = Array.isArray(platformResponse?.data?.data)
        ? platformResponse.data.data
        : [];
      const nextConfig = configResponse?.data?.data || null;
      setPlatforms(nextPlatforms);
      setConfig(nextConfig);
      setPromptDefinition(promptResponse?.data?.data || null);
      configForm.setFieldsValue({
        platform_code: nextConfig?.platform_code || undefined,
        model_name: nextConfig?.model_name || undefined,
      });
      const selectedPlatform = nextPlatforms.find(
        (item: PlatformRecord) => item.code === nextConfig?.platform_code,
      );
      if (selectedPlatform) {
        await loadModels(selectedPlatform.id, nextConfig?.model_name || selectedPlatform.default_model);
      } else {
        setModelOptions(nextConfig?.model_name ? [nextConfig.model_name] : []);
      }
    } catch (error) {
      message.error(getApiErrorMessage(error, '获取 AI 分析 API 配置失败'));
    } finally {
      setLoading(false);
    }
  }, [configForm, loadModels]);

  useEffect(() => {
    load();
    testForm.setFieldsValue({
      brand_name: '上海广拓',
      brand_aliases_text: '广拓，GATO',
      response_text: sampleAnswer,
    });
  }, [load, testForm]);

  const availablePlatforms = useMemo(
    () => platforms.filter((item) => item.enabled && item.configured && !item.archived_at),
    [platforms],
  );
  const selectedPlatform = availablePlatforms.find((item) => item.code === selectedPlatformCode);

  const selectPlatform = (platformCode: string) => {
    const platform = availablePlatforms.find((item) => item.code === platformCode);
    const nextModel = platform?.default_model || '';
    setModelDropdownOpen(false);
    configForm.setFieldValue('model_name', nextModel || undefined);
    setModelOptions(nextModel ? [nextModel] : []);
    if (platform) void loadModels(platform.id, nextModel);
  };

  const refreshAnalysisModels = () => {
    if (!selectedPlatform) {
      message.warning('请先选择分析平台');
      return;
    }
    const currentModel = String(configForm.getFieldValue('model_name') || selectedPlatform.default_model);
    void loadModels(selectedPlatform.id, currentModel, true);
  };

  const save = async () => {
    try {
      const values = await configForm.validateFields();
      setSaving(true);
      const response = await axios.put('/api/settings/analysis-api', values);
      setConfig(response?.data?.data || null);
      setTestResult(null);
      message.success('AI 分析 API 已更新');
    } catch (error) {
      if (error && typeof error === 'object' && 'errorFields' in error) return;
      message.error(getApiErrorMessage(error, '保存 AI 分析 API 失败'));
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    try {
      const values = await testForm.validateFields();
      setTesting(true);
      setTestResult(null);
      const response = await axios.post('/api/settings/analysis-api/test', {
        brand_name: values.brand_name,
        brand_aliases: String(values.brand_aliases_text || '')
          .split(/[,，、;；\n]/u)
          .map((item) => item.trim())
          .filter(Boolean),
        response_text: values.response_text,
      });
      setTestResult(response?.data?.data || null);
      message.success('结构化测试完成');
    } catch (error) {
      if (error && typeof error === 'object' && 'errorFields' in error) return;
      message.error(getApiErrorMessage(error, 'AI 分析 API 测试失败'));
    } finally {
      setTesting(false);
    }
  };

  const structuredOutput = testResult
    ? Object.fromEntries(Object.entries(testResult.output).filter(([key]) => key !== 'raw_output'))
    : null;

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%', maxWidth: 920 }}>
      <Alert
        type="info"
        showIcon
        title="AI 只做结构化抽取，指标由程序统一计算"
        description="分析 API 返回回答中的全部品牌和公司、目标品牌/竞品实体映射、原文短实体词、候选顺序、明确推荐关系和待核验事实声明，不直接返回次数、排名、比例或分数。提及次数和顺序由服务端扫描原回答确定；结构化结果不重复整句原文，引用数据不由分析模型生成，而是从监测平台原始响应中直接提取。"
      />

      <Card
        size="small"
        title={(
          <Space>
            <span>当前分析提示词</span>
            {promptDefinition?.version ? <Tag>{promptDefinition.version}</Tag> : null}
          </Space>
        )}
        loading={loading && !promptDefinition}
      >
        <Paragraph type="secondary">
          这里展示正式分析运行时使用的同一份提示词模板；花括号字段会在每次分析时替换为实际品牌、竞品和模型回答。
        </Paragraph>
        <Input.TextArea
          readOnly
          value={promptDefinition?.template || '提示词加载中…'}
          autoSize={{ minRows: 12, maxRows: 24 }}
          spellCheck={false}
          style={{ fontFamily: 'var(--font-geist-mono), monospace' }}
        />
        <Title level={5}>期望返回结构</Title>
        <pre style={{ margin: 0, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
          {JSON.stringify(promptDefinition?.expected_output || {}, null, 2)}
        </pre>
      </Card>

      <Card size="small" title="分析 API">
        <Form form={configForm} layout="vertical" requiredMark={false}>
          <Form.Item
            name="platform_code"
            label="分析平台"
            extra="复用 AI 平台中已加密保存的连接配置；切换平台时会读取该平台可用的模型。"
            rules={[{ required: true, message: '请选择 AI 分析 API' }]}
          >
            <Select
              loading={loading}
              placeholder="选择已启用且已配置密钥的平台"
              onChange={selectPlatform}
              options={availablePlatforms.map((item) => ({
                value: item.code,
                label: item.name,
              }))}
            />
          </Form.Item>
          <Form.Item
            label="分析模型"
            extra={(
              <Space orientation="vertical" size={0}>
                <span>可独立于平台默认模型选择；结构化测试和正式分析都会使用这里保存的模型。</span>
                <span>模型列表只从供应商接口临时读取，系统仅保存最终选择的模型。</span>
              </Space>
            )}
          >
            <Space.Compact block>
              <Form.Item
                name="model_name"
                noStyle
                rules={[{ required: true, message: '请选择 AI 分析模型' }]}
              >
                <Select
                  showSearch
                  open={modelDropdownOpen}
                  onOpenChange={setModelDropdownOpen}
                  optionFilterProp="label"
                  loading={modelLoading}
                  placeholder="选择分析模型"
                  style={{ width: '100%' }}
                  options={modelOptions.map((model) => ({ value: model, label: model }))}
                />
              </Form.Item>
              <Button
                icon={<ReloadOutlined />}
                loading={modelLoading}
                disabled={!selectedPlatform}
                onClick={refreshAnalysisModels}
              >
                刷新模型列表
              </Button>
            </Space.Compact>
          </Form.Item>
          {selectedPlatform ? (
            <Paragraph type="secondary">
              当前调用类型：{adapterLabel(selectedPlatform.adapter_type)}。平台名称不决定协议，系统按这里的平台配置调用。
            </Paragraph>
          ) : null}
          <Title level={5}>分析专用调用参数</Title>
          <Paragraph type="secondary">
            这组参数只用于结构化分析，不会修改监测平台参数或平台默认配置。
          </Paragraph>
          <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }} bordered>
            <Descriptions.Item label="温度">
              {promptDefinition?.request_profile?.temperature ?? '-'}
            </Descriptions.Item>
            <Descriptions.Item label="最大输出 Token">
              {promptDefinition?.request_profile?.max_tokens ?? '-'}
            </Descriptions.Item>
            <Descriptions.Item label="请求超时">
              {promptDefinition?.request_profile?.timeout_seconds
                ? `${promptDefinition.request_profile.timeout_seconds} 秒`
                : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="最多尝试">
              {promptDefinition?.request_profile?.max_attempts
                ? `${promptDefinition.request_profile.max_attempts} 次（含首次）`
                : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="结构化输出">
              {jsonModeLabel(selectedPlatform, promptDefinition?.request_profile)}
            </Descriptions.Item>
            <Descriptions.Item label="联网搜索">
              {promptDefinition?.request_profile?.web_search === false ? '关闭' : '按平台配置'}
            </Descriptions.Item>
            <Descriptions.Item label="DeepSeek 思考模式">
              {thinkingModeLabel(selectedPlatform, promptDefinition?.request_profile)}
            </Descriptions.Item>
          </Descriptions>
          <Space>
            <Button type="primary" loading={saving} onClick={save}>保存分析 API</Button>
            <Button loading={loading} onClick={load}>恢复当前值</Button>
            {config?.configured && config.platform ? (
              <Tag color="success">{config.platform.name} · {config.platform.model_name}</Tag>
            ) : <Tag color="warning">尚未可用</Tag>}
          </Space>
        </Form>
      </Card>

      <Card size="small">
        <Title level={5} style={{ marginTop: 0 }}>临时结构化测试</Title>
        <Paragraph type="secondary">
          用一段真实回答检查实体、目标品牌映射、提及、候选顺序、推荐关系和待核验事实声明。系统不会保存测试输入和输出，只返回本次请求结果；引用来源要在真实监测运行中从平台响应提取。
        </Paragraph>
        <Form form={testForm} layout="vertical" requiredMark={false}>
          <Space align="start" size="middle" style={{ width: '100%' }}>
            <Form.Item
              name="brand_name"
              label="目标品牌"
              rules={[{ required: true, message: '请输入目标品牌' }]}
              style={{ flex: 1 }}
            >
              <Input />
            </Form.Item>
            <Form.Item name="brand_aliases_text" label="品牌别名" style={{ flex: 2 }}>
              <Input placeholder="多个别名用逗号分隔" />
            </Form.Item>
          </Space>
          <Form.Item
            name="response_text"
            label="待分析的 AI 回答"
            rules={[{ required: true, message: '请输入待分析回答' }]}
          >
            <Input.TextArea rows={9} maxLength={12000} showCount />
          </Form.Item>
          <Button type="primary" loading={testing} disabled={!config?.configured} onClick={runTest}>
            测试结构化
          </Button>
        </Form>
      </Card>

      {testResult ? (
        <Card size="small" title="本次测试结果">
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="测试输入">
              <Space orientation="vertical" size={2}>
                <Text>品牌：{testResult.input.brand_name}</Text>
                <Text>别名：{testResult.input.brand_aliases.join('、') || '无'}</Text>
                <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
                  {testResult.input.response_text}
                </Paragraph>
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="结构化原料与程序派生结果">
              <pre style={{ margin: 0, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(structuredOutput, null, 2)}
              </pre>
            </Descriptions.Item>
            <Descriptions.Item label="分析模型原始 JSON 输出">
              <pre style={{ margin: 0, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                {testResult.output.raw_output || '无原始输出'}
              </pre>
            </Descriptions.Item>
          </Descriptions>
        </Card>
      ) : null}
    </Space>
  );
}
