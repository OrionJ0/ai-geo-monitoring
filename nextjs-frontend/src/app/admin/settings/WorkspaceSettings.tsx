'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message
} from 'antd';
import axios from '@/lib/axiosConfig';
import { getApiErrorMessage } from '@/utils/apiErrorMessage.cjs';
import {
  isValidWebsiteInput,
  normalizeList,
  normalizeNullableText
} from '@/utils/projectFieldNormalization.cjs';

type ProjectSummary = {
  id: string | number;
  name: string;
  website?: string | null;
  status: 'active' | 'archived';
};

type Competitor = {
  id: string | number;
  name: string;
  aliases?: string[];
  website?: string | null;
};

type ProjectDetail = ProjectSummary & {
  aliases?: string[];
  industry?: string | null;
  primary_keywords?: string[];
  monitoring_enabled?: boolean;
  monitoring_time?: string;
  competitors?: Competitor[];
};

type BrandFormValues = {
  name: string;
  aliases?: string[];
  website?: string;
  industry?: string;
  primary_keywords?: string[];
  monitoring_enabled?: boolean;
  monitoring_time?: string;
};

type CompetitorFormValues = {
  name: string;
  aliases?: string[];
  website?: string;
};

const websiteRules = [{
  validator: (_: unknown, value: unknown) => (
    isValidWebsiteInput(value)
      ? Promise.resolve()
      : Promise.reject(new Error('请输入有效官网域名'))
  )
}];

function readErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('response' in error)) return null;
  const response = (
    error as { response?: { data?: { error?: { code?: unknown } } } }
  ).response;
  const code = response?.data?.error?.code;
  return typeof code === 'string' ? code : null;
}

function SelectTags(props: React.ComponentProps<typeof Select>) {
  return (
    <Select
      mode="tags"
      tokenSeparators={[',', '，', ';', '；', '\n']}
      style={{ width: '100%', ...props.style }}
      {...props}
    />
  );
}

export default function WorkspaceSettings() {
  const [brandForm] = Form.useForm<BrandFormValues>();
  const [competitorForm] = Form.useForm<CompetitorFormValues>();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [contextErrorCode, setContextErrorCode] = useState<string | null>(null);
  const [editingCompetitor, setEditingCompetitor] = useState<Competitor | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingBrand, setSavingBrand] = useState(false);
  const [savingDefault, setSavingDefault] = useState(false);
  const [savingCompetitor, setSavingCompetitor] = useState(false);
  const [error, setError] = useState('');

  const applyProject = useCallback((value: ProjectDetail) => {
    setProject(value);
    setSelectedProjectId(String(value.id));
    brandForm.setFieldsValue({
      name: value.name || '',
      aliases: normalizeList(value.aliases),
      website: value.website || '',
      industry: value.industry || '',
      primary_keywords: normalizeList(value.primary_keywords),
      monitoring_enabled: value.monitoring_enabled === true,
      monitoring_time: value.monitoring_time || '09:00'
    });
  }, [brandForm]);

  const loadProject = useCallback(async (projectId: string) => {
    const response = await axios.get(`/api/geo-projects/${projectId}`);
    applyProject(response.data.data as ProjectDetail);
  }, [applyProject]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const contextResponse = await axios.get('/api/geo-projects/default-context');
      const projectId = String(contextResponse.data.data.project.id);
      setContextErrorCode(null);
      await loadProject(projectId);
    } catch (requestError) {
      const code = readErrorCode(requestError);
      setContextErrorCode(code);
      setProject(null);
      setSelectedProjectId('');
      if (code === 'DEFAULT_PROJECT_NOT_CONFIGURED') {
        try {
          const projectsResponse = await axios.get('/api/geo-projects');
          const rows = Array.isArray(projectsResponse?.data?.data)
            ? projectsResponse.data.data
            : [];
          setProjects(rows);
        } catch (projectError) {
          setError(getApiErrorMessage(projectError, '无法读取可用品牌'));
        }
      } else {
        setError(getApiErrorMessage(requestError, '无法读取品牌设置'));
      }
    } finally {
      setLoading(false);
    }
  }, [loadProject]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeProjects = useMemo(
    () => projects.filter((item) => item.status === 'active'),
    [projects]
  );

  const saveDefaultProject = async () => {
    if (!selectedProjectId) return;
    setSavingDefault(true);
    setError('');
    try {
      await axios.put('/api/geo-projects/default-context', {
        projectId: selectedProjectId
      });
      await load();
      message.success('默认品牌已设置');
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, '保存默认品牌失败'));
    } finally {
      setSavingDefault(false);
    }
  };

  const saveBrand = async () => {
    if (!project?.id) return;
    try {
      const values = await brandForm.validateFields();
      const name = normalizeNullableText(values.name) || '';
      setSavingBrand(true);
      setError('');
      await axios.put(`/api/geo-projects/${project.id}`, {
        name,
        aliases: normalizeList(values.aliases, { exclude: [name] }),
        website: normalizeNullableText(values.website),
        industry: normalizeNullableText(values.industry),
        primary_keywords: normalizeList(values.primary_keywords, { exclude: [name] }),
        monitoring_enabled: values.monitoring_enabled === true,
        monitoring_time: normalizeNullableText(values.monitoring_time) || '09:00'
      });
      await loadProject(String(project.id));
      message.success('品牌资料已更新');
    } catch (requestError) {
      if (
        requestError
        && typeof requestError === 'object'
        && 'errorFields' in requestError
      ) return;
      setError(getApiErrorMessage(requestError, '保存品牌资料失败'));
    } finally {
      setSavingBrand(false);
    }
  };

  const resetCompetitorForm = () => {
    setEditingCompetitor(null);
    competitorForm.resetFields();
  };

  const editCompetitor = (competitor: Competitor) => {
    setEditingCompetitor(competitor);
    competitorForm.setFieldsValue({
      name: competitor.name || '',
      aliases: normalizeList(competitor.aliases),
      website: competitor.website || ''
    });
  };

  const saveCompetitor = async () => {
    if (!project?.id) return;
    try {
      const values = await competitorForm.validateFields();
      const name = normalizeNullableText(values.name) || '';
      const payload = {
        name,
        aliases: normalizeList(values.aliases, { exclude: [name] }),
        website: normalizeNullableText(values.website)
      };
      setSavingCompetitor(true);
      if (editingCompetitor) {
        await axios.put(
          `/api/geo-projects/${project.id}/competitors/${editingCompetitor.id}`,
          payload
        );
        message.success('竞品已更新');
      } else {
        await axios.post(`/api/geo-projects/${project.id}/competitors`, payload);
        message.success('竞品已添加');
      }
      resetCompetitorForm();
      await loadProject(String(project.id));
    } catch (requestError) {
      if (
        requestError
        && typeof requestError === 'object'
        && 'errorFields' in requestError
      ) return;
      message.error(getApiErrorMessage(requestError, '保存竞品失败'));
    } finally {
      setSavingCompetitor(false);
    }
  };

  const deleteCompetitor = async (competitor: Competitor) => {
    if (!project?.id) return;
    try {
      await axios.delete(
        `/api/geo-projects/${project.id}/competitors/${competitor.id}`
      );
      if (editingCompetitor?.id === competitor.id) resetCompetitorForm();
      await loadProject(String(project.id));
      message.success('竞品已删除');
    } catch (requestError) {
      message.error(getApiErrorMessage(requestError, '删除竞品失败'));
    }
  };

  const competitorColumns = [
    {
      title: '竞品名称',
      dataIndex: 'name',
      key: 'name',
      width: 160
    },
    {
      title: '别名',
      dataIndex: 'aliases',
      key: 'aliases',
      render: (values: string[]) => (
        <Space wrap size={[4, 4]}>
          {normalizeList(values).map((item) => <Tag key={item}>{item}</Tag>)}
        </Space>
      )
    },
    {
      title: '官网',
      dataIndex: 'website',
      key: 'website',
      render: (value: string | null) => value || '-'
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (_: unknown, competitor: Competitor) => (
        <Space>
          <Button size="small" onClick={() => editCompetitor(competitor)}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除该竞品？"
            onConfirm={() => deleteCompetitor(competitor)}
          >
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <div>
        <Typography.Title level={2} style={{ marginBottom: 8 }}>
          品牌工作台
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          当前系统按单品牌运行。品牌资料与竞品在这里维护；运行平台统一由
          “AI 平台”页签的启用状态决定。
        </Typography.Paragraph>
      </div>

      {error ? <Alert type="error" showIcon title={error} role="alert" /> : null}
      <Alert
        type="info"
        showIcon
        title="品牌资料变更仅影响后续运行"
        description="历史回答、引用和指标不会重算或删除；新的品牌名称、别名和官网会从下一次运行开始生效。"
      />

      {contextErrorCode === 'DEFAULT_PROJECT_NOT_CONFIGURED' ? (
        <Card size="small" title="首次设置默认品牌">
          <Space orientation="vertical" size="middle" style={{ width: '100%', maxWidth: 640 }}>
            <Alert
              type="warning"
              showIcon
              title="尚未设置默认品牌"
              description="请选择现有活动品牌。设置后，系统将直接进入单品牌工作方式。"
            />
            <Select
              aria-label="选择默认品牌"
              value={selectedProjectId || undefined}
              loading={loading}
              placeholder="选择一个活动品牌"
              style={{ width: '100%' }}
              onChange={(value) => setSelectedProjectId(String(value))}
              options={activeProjects.map((item) => ({
                value: String(item.id),
                label: item.website
                  ? `${item.name} · ${item.website}`
                  : item.name
              }))}
            />
            <Button
              type="primary"
              loading={savingDefault}
              disabled={loading || !selectedProjectId}
              onClick={saveDefaultProject}
            >
              设为默认品牌
            </Button>
          </Space>
        </Card>
      ) : null}

      {project ? (
        <>
          <Card
            size="small"
            title="品牌资料"
            extra={<Tag color="green">当前默认品牌</Tag>}
          >
            <Form
              form={brandForm}
              layout="vertical"
              requiredMark={false}
              style={{ maxWidth: 760 }}
            >
              <Form.Item
                name="name"
                label="品牌名称"
                rules={[{ required: true, message: '请输入品牌名称' }]}
              >
                <Input placeholder="例如：广拓" />
              </Form.Item>
              <Form.Item name="aliases" label="品牌别名">
                <SelectTags placeholder="输入别名并回车添加，例如：上海广拓、gato" />
              </Form.Item>
              <Form.Item name="website" label="官网" rules={websiteRules}>
                <Input placeholder="https://gato.com.cn/" />
              </Form.Item>
              <Form.Item name="industry" label="行业">
                <Input placeholder="例如：公共安全、物联网" />
              </Form.Item>
              <Form.Item name="primary_keywords" label="品牌核心关键词">
                <SelectTags placeholder="输入品牌词或产品词并回车添加" />
              </Form.Item>
              <Form.Item
                name="monitoring_enabled"
                label="自动监测"
                valuePropName="checked"
              >
                <Switch checkedChildren="开启" unCheckedChildren="关闭" />
              </Form.Item>
              <Form.Item
                name="monitoring_time"
                label="每日监测时间"
                extra="使用服务器配置的业务时区。运行时会自动覆盖全部已启用 AI 平台。"
                rules={[{
                  pattern: /^([01]?\d|2[0-3]):[0-5]?\d$/,
                  message: '请输入 HH:mm 格式时间'
                }]}
              >
                <Input placeholder="09:00" />
              </Form.Item>
              <Space>
                <Button type="primary" loading={savingBrand} onClick={saveBrand}>
                  保存品牌资料
                </Button>
                <Button disabled={savingBrand} onClick={() => loadProject(String(project.id))}>
                  恢复当前值
                </Button>
              </Space>
            </Form>
          </Card>

          <Card size="small" title="竞品">
            <Form
              form={competitorForm}
              layout="inline"
              onFinish={saveCompetitor}
              style={{ marginBottom: 16 }}
            >
              <Form.Item
                name="name"
                label="竞品名称"
                rules={[{ required: true, message: '请输入竞品名称' }]}
              >
                <Input placeholder="竞品名称" style={{ width: 160 }} />
              </Form.Item>
              <Form.Item name="aliases" label="别名">
                <SelectTags placeholder="别名" style={{ minWidth: 220 }} />
              </Form.Item>
              <Form.Item name="website" label="官网" rules={websiteRules}>
                <Input placeholder="https://example.com" style={{ width: 220 }} />
              </Form.Item>
              <Form.Item>
                <Space>
                  <Button
                    type="primary"
                    htmlType="submit"
                    loading={savingCompetitor}
                  >
                    {editingCompetitor ? '保存' : '添加'}
                  </Button>
                  {editingCompetitor ? (
                    <Button onClick={resetCompetitorForm}>取消编辑</Button>
                  ) : null}
                </Space>
              </Form.Item>
            </Form>
            <Table
              rowKey="id"
              size="small"
              dataSource={Array.isArray(project.competitors) ? project.competitors : []}
              columns={competitorColumns}
              pagination={false}
              scroll={{ x: 'max-content' }}
            />
          </Card>
        </>
      ) : null}
    </Space>
  );
}
