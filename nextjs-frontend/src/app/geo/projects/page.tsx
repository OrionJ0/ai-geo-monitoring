// @ts-nocheck
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import axios from 'axios';
import { useRouter } from 'next/navigation';
import { isValidWebsiteInput, normalizeList, normalizeNullableText } from '@/utils/projectFieldNormalization.cjs';
import { getProjectPromptRunBlockReason, summarizeProjectPrompts } from '@/utils/projectPromptSummary.cjs';
import { getApiErrorMessage } from '@/utils/apiErrorMessage.cjs';
import { describeSelectedPlatforms } from '@/utils/platformSelectionStatus.cjs';
import { useAIPlatformCatalog } from '@/lib/useAIPlatformCatalog';

const { Text } = Typography;

const websiteRules = [
  {
    validator: (_, value) => (
      isValidWebsiteInput(value)
        ? Promise.resolve()
        : Promise.reject(new Error('请输入有效官网域名'))
    )
  }
];

export default function GeoProjectsPage() {
  const router = useRouter();
  const {
    platforms: platformCatalog,
    selectableCodes,
    options: platformOptions,
    loading: platformCatalogLoading,
    error: platformCatalogError
  } = useAIPlatformCatalog();
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState([]);
  const [projectOpen, setProjectOpen] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [competitorOpen, setCompetitorOpen] = useState(false);
  const [currentProject, setCurrentProject] = useState(null);
  const [editingCompetitor, setEditingCompetitor] = useState(null);
  const [savingCompetitor, setSavingCompetitor] = useState(false);
  const [projectForm] = Form.useForm();
  const [competitorForm] = Form.useForm();
  const currentCompetitorProjectIdRef = useRef(null);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/geo-projects');
      setProjects(Array.isArray(res?.data?.data) ? res.data.data : []);
    } catch (error) {
      message.error(getApiErrorMessage(error, '获取品牌项目失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const openCreate = () => {
    setEditingProject(null);
    projectForm.setFieldsValue({
      name: '',
      aliases: [],
      website: '',
      industry: '',
      primary_keywords: [],
      platforms: selectableCodes,
      monitoring_enabled: false,
      monitoring_time: '09:00',
    });
    setProjectOpen(true);
  };

  const openEdit = (record) => {
    if (record?.status === 'archived') {
      message.warning('归档项目请先恢复后再编辑');
      return;
    }
    setEditingProject(record);
    projectForm.setFieldsValue({
      name: record.name || '',
      aliases: normalizeList(record.aliases),
      website: record.website || '',
      industry: record.industry || '',
      primary_keywords: normalizeList(record.primary_keywords),
      platforms: normalizeList(record.platforms),
      monitoring_enabled: !!record.monitoring_enabled,
      monitoring_time: record.monitoring_time || '09:00',
    });
    setProjectOpen(true);
  };

  const saveProject = async () => {
    try {
      const values = await projectForm.validateFields();
      const name = normalizeNullableText(values.name) || '';
      const payload = {
        name,
        aliases: normalizeList(values.aliases, { exclude: [name] }),
        website: normalizeNullableText(values.website),
        industry: normalizeNullableText(values.industry),
        primary_keywords: normalizeList(values.primary_keywords, { exclude: [name] }),
        platforms: normalizeList(values.platforms).filter((item) => (
          selectableCodes.includes(item)
          || normalizeList(editingProject?.platforms).includes(item)
        )),
        monitoring_enabled: !!values.monitoring_enabled,
        monitoring_time: normalizeNullableText(values.monitoring_time) || '09:00',
      };
      if (editingProject?.id) {
        await axios.put(`/api/geo-projects/${editingProject.id}`, payload);
        message.success('品牌项目已更新');
      } else {
        await axios.post('/api/geo-projects', payload);
        message.success('品牌项目已创建');
      }
      setProjectOpen(false);
      setEditingProject(null);
      projectForm.resetFields();
      fetchProjects();
    } catch (error) {
      if (error?.errorFields) return;
      message.error(getApiErrorMessage(error, '保存品牌项目失败'));
    }
  };

  const updateStatus = async (record, status) => {
    try {
      if (status === 'archived') {
        await axios.delete(`/api/geo-projects/${record.id}`);
        message.success('品牌项目已归档');
      } else {
        await axios.put(`/api/geo-projects/${record.id}`, { status: 'active' });
        message.success('品牌项目已恢复');
      }
      fetchProjects();
    } catch (error) {
      message.error(getApiErrorMessage(error, '状态更新失败'));
    }
  };

  const deleteArchivedProject = async (record) => {
    try {
      await axios.delete(`/api/geo-projects/${record.id}`, { params: { permanent: true } });
      message.success('品牌项目已删除');
      fetchProjects();
    } catch (error) {
      message.error(getApiErrorMessage(error, '删除品牌项目失败'));
    }
  };

  const openCompetitors = (record) => {
    if (record?.status === 'archived') {
      message.warning('归档项目请先恢复后再管理竞品');
      return;
    }
    currentCompetitorProjectIdRef.current = record.id;
    setCurrentProject(record);
    setEditingCompetitor(null);
    setSavingCompetitor(false);
    competitorForm.resetFields();
    setCompetitorOpen(true);
  };

  const refreshCurrentProject = async (projectId) => {
    const res = await axios.get(`/api/geo-projects/${projectId}`);
    const project = res?.data?.data;
    if (currentCompetitorProjectIdRef.current === projectId) setCurrentProject(project);
    setProjects((prev) => prev.map((item) => (item.id === project.id ? project : item)));
  };

  const closeCompetitors = () => {
    currentCompetitorProjectIdRef.current = null;
    setSavingCompetitor(false);
    setCompetitorOpen(false);
    setCurrentProject(null);
    resetCompetitorForm();
  };

  const editCompetitor = (record) => {
    setEditingCompetitor(record);
    competitorForm.setFieldsValue({
      name: record.name || '',
      aliases: normalizeList(record.aliases),
      website: record.website || '',
    });
  };

  const resetCompetitorForm = () => {
    setEditingCompetitor(null);
    competitorForm.resetFields();
  };

  const saveCompetitor = async () => {
    if (!currentProject?.id) return;
    const mutationProjectId = currentProject.id;
    try {
      const values = await competitorForm.validateFields();
      const name = normalizeNullableText(values.name) || '';
      const payload = {
        name,
        aliases: normalizeList(values.aliases, { exclude: [name] }),
        website: normalizeNullableText(values.website),
      };
      setSavingCompetitor(true);
      if (editingCompetitor?.id) {
        await axios.put(`/api/geo-projects/${mutationProjectId}/competitors/${editingCompetitor.id}`, payload);
        if (currentCompetitorProjectIdRef.current !== mutationProjectId) return;
        message.success('竞品已更新');
      } else {
        await axios.post(`/api/geo-projects/${mutationProjectId}/competitors`, payload);
        if (currentCompetitorProjectIdRef.current !== mutationProjectId) return;
        message.success('竞品已添加');
      }
      resetCompetitorForm();
      await refreshCurrentProject(mutationProjectId);
    } catch (error) {
      if (error?.errorFields) return;
      if (currentCompetitorProjectIdRef.current === mutationProjectId) {
        message.error(getApiErrorMessage(error, '保存竞品失败'));
      }
    } finally {
      if (currentCompetitorProjectIdRef.current === mutationProjectId) setSavingCompetitor(false);
    }
  };

  const deleteCompetitor = async (record) => {
    if (!currentProject?.id) return;
    const mutationProjectId = currentProject.id;
    try {
      await axios.delete(`/api/geo-projects/${mutationProjectId}/competitors/${record.id}`);
      if (currentCompetitorProjectIdRef.current !== mutationProjectId) return;
      message.success('竞品已删除');
      await refreshCurrentProject(mutationProjectId);
    } catch (error) {
      if (currentCompetitorProjectIdRef.current === mutationProjectId) {
        message.error(getApiErrorMessage(error, '删除竞品失败'));
      }
    }
  };

  const projectColumns = [
    {
      title: '品牌',
      dataIndex: 'name',
      key: 'name',
      width: 180,
      render: (text, row) => (
        <Space orientation="vertical" size={2}>
          <Text strong>{text}</Text>
          <Space wrap size={[4, 4]}>
            {normalizeList(row.aliases).slice(0, 4).map((item) => <Tag key={item}>{item}</Tag>)}
          </Space>
        </Space>
      ),
    },
    { title: '行业', dataIndex: 'industry', key: 'industry', width: 130, render: (value) => value || '-' },
    { title: '官网', dataIndex: 'website', key: 'website', width: 220, ellipsis: true, render: (value) => value || '-' },
    {
      title: '监测平台',
      dataIndex: 'platforms',
      key: 'platforms',
      width: 150,
      render: (values) => {
        const platforms = normalizeList(values);
        if (!platforms.length) return <Text type="secondary">未配置</Text>;
        return (
          <Space wrap size={[4, 4]}>
            {describeSelectedPlatforms(platforms, platformCatalog, {
              catalogReady: !platformCatalogLoading && !platformCatalogError
            }).map((item) => (
              <Tag color={item.selectable ? 'processing' : 'error'} key={item.code}>
                {item.displayLabel}
              </Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: '品牌核心关键词',
      dataIndex: 'primary_keywords',
      key: 'primary_keywords',
      render: (values) => (
        <Space wrap size={[4, 4]}>
          {normalizeList(values).map((item) => <Tag color="blue" key={item}>{item}</Tag>)}
        </Space>
      ),
    },
    {
      title: '竞品',
      key: 'competitors',
      width: 180,
      render: (_, row) => {
        const competitors = Array.isArray(row.competitors) ? row.competitors : [];
        return (
          <Space orientation="vertical" size={2}>
            <Text>{competitors.length} 个</Text>
            <Text type="secondary" ellipsis style={{ maxWidth: 150 }}>
              {competitors.map((item) => item.name).filter(Boolean).join('、') || '-'}
            </Text>
          </Space>
        );
      },
    },
    {
      title: '问题',
      key: 'prompts',
      width: 100,
      render: (_, row) => {
        const summary = summarizeProjectPrompts(row.trackedPrompts, row.platforms);
        const blockReason = getProjectPromptRunBlockReason(row.trackedPrompts, row.platforms);
        return (
          <Space orientation="vertical" size={2}>
            <Text>{summary.total ? `${summary.enabled} / ${summary.total} 启用` : '0 条'}</Text>
            {blockReason === 'platform_mismatch' ? <Tag color="warning">平台不匹配</Tag> : null}
          </Space>
        );
      },
    },
    {
      title: '自动监测',
      key: 'monitoring',
      width: 150,
      render: (_, row) => row.monitoring_enabled ? (
        <Space orientation="vertical" size={2}>
          <Tag color="processing">每日 {row.monitoring_time || '09:00'}</Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>
            下次 {row.monitoring_next_run_at ? new Date(row.monitoring_next_run_at).toLocaleString() : '-'}
          </Text>
        </Space>
      ) : <Tag>未开启</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (value) => value === 'archived' ? <Tag>已归档</Tag> : <Tag color="success">启用中</Tag>,
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 180,
      render: (value) => value ? new Date(value).toLocaleString() : '-',
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 190,
      render: (_, row) => (
          <Space>
            <Button size="small" disabled={row.status === 'archived'} onClick={() => openCompetitors(row)}>竞品</Button>
            <Button size="small" type="primary" disabled={row.status === 'archived'} onClick={() => openEdit(row)}>编辑</Button>
            {row.status === 'archived' ? (
              <>
                <Button size="small" onClick={() => updateStatus(row, 'active')}>恢复</Button>
                <Popconfirm title="确认永久删除该品牌项目？" onConfirm={() => deleteArchivedProject(row)}>
                  <Button size="small" danger>删除</Button>
                </Popconfirm>
              </>
            ) : (
              <Popconfirm title="确认归档该品牌项目？" onConfirm={() => updateStatus(row, 'archived')}>
                <Button size="small" danger>归档</Button>
              </Popconfirm>
            )}
          </Space>
      ),
    },
  ];

  const competitorColumns = [
    { title: '竞品名称', dataIndex: 'name', key: 'name', width: 160 },
    {
      title: '别名',
      dataIndex: 'aliases',
      key: 'aliases',
      render: (values) => (
        <Space wrap size={[4, 4]}>
          {normalizeList(values).map((item) => <Tag key={item}>{item}</Tag>)}
        </Space>
      ),
    },
    { title: '官网', dataIndex: 'website', key: 'website', ellipsis: true, render: (value) => value || '-' },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (_, row) => (
        <Space>
          <Button size="small" onClick={() => editCompetitor(row)}>编辑</Button>
          <Popconfirm title="确认删除该竞品？" onConfirm={() => deleteCompetitor(row)}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card
      title="品牌项目"
      extra={<Space><Button size="small" onClick={fetchProjects}>刷新</Button><Button size="small" type="primary" onClick={openCreate} disabled={platformCatalogLoading || !selectableCodes.length}>新建项目</Button></Space>}
    >
      {platformCatalogError ? <Alert type="error" showIcon title={platformCatalogError} style={{ marginBottom: 12 }} /> : null}
      {!platformCatalogLoading && !platformCatalogError && !selectableCodes.length ? (
        <Alert
          type="warning"
          showIcon
          title="还不能新建项目"
          description="请先在设置中心启用并配置至少一个监测平台。网页版平台还需要完成登录验证。"
          action={(
            <Button size="small" onClick={() => router.push('/admin/settings')}>
              前往设置中心
            </Button>
          )}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      <Table
        rowKey="id"
        dataSource={projects}
        columns={projectColumns}
        loading={loading}
        size="small"
        pagination={{ pageSize: 10 }}
        scroll={{ x: 'max-content' }}
      />

      <Modal
        title={editingProject ? '编辑品牌项目' : '新建品牌项目'}
        open={projectOpen}
        onOk={saveProject}
        onCancel={() => { setProjectOpen(false); setEditingProject(null); }}
        okText="保存"
        cancelText="取消"
        forceRender
        destroyOnHidden
      >
        <Form form={projectForm} layout="vertical">
          <Form.Item name="name" label="品牌名称" rules={[{ required: true, message: '请输入品牌名称' }]}>
            <Input placeholder="例如 Goodie AI" />
          </Form.Item>
          <Form.Item name="aliases" label="品牌别名">
            <SelectTags placeholder="输入别名并回车添加" />
          </Form.Item>
          <Form.Item name="website" label="官网" rules={websiteRules}>
            <Input placeholder="https://example.com" />
          </Form.Item>
          <Form.Item name="industry" label="行业">
            <Input placeholder="例如 AI 营销、SaaS、消费品" />
          </Form.Item>
          <Form.Item name="primary_keywords" label="品牌核心关键词">
            <SelectTags placeholder="输入品牌词、产品词并回车添加" />
          </Form.Item>
          <Form.Item name="platforms" label="监测平台" rules={[{ required: true, message: '请选择监测平台' }]}>
            <Select
              mode="multiple"
              aria-label="监测平台"
              virtual={false}
              options={platformOptions}
              loading={platformCatalogLoading}
              placeholder="选择已配置的监测平台"
            />
          </Form.Item>
          <Form.Item name="monitoring_enabled" label="自动监测" valuePropName="checked">
            <Switch checkedChildren="开启" unCheckedChildren="关闭" />
          </Form.Item>
          <Form.Item name="monitoring_time" label="每日监测时间" rules={[{ pattern: /^([01]?\d|2[0-3]):[0-5]?\d$/, message: '请输入 HH:mm 格式时间' }]}>
            <Input placeholder="09:00" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`管理竞品${currentProject?.name ? `：${currentProject.name}` : ''}`}
        open={competitorOpen}
        onCancel={closeCompetitors}
        footer={null}
        width={860}
        forceRender
        destroyOnHidden
      >
        <Form form={competitorForm} layout="inline" onFinish={saveCompetitor} style={{ marginBottom: 12 }}>
          <Form.Item name="name" label="竞品名称" rules={[{ required: true, message: '请输入竞品名称' }]}>
            <Input placeholder="竞品名称" style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="aliases" label="别名">
            <SelectTags placeholder="别名" style={{ minWidth: 220 }} />
          </Form.Item>
          <Form.Item name="website" label="官网" rules={websiteRules}>
            <Input placeholder="https://example.com" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={savingCompetitor}>{editingCompetitor ? '保存' : '添加'}</Button>
              {editingCompetitor && <Button onClick={resetCompetitorForm}>取消编辑</Button>}
            </Space>
          </Form.Item>
        </Form>
        <Table
          rowKey="id"
          size="small"
          dataSource={Array.isArray(currentProject?.competitors) ? currentProject.competitors : []}
          columns={competitorColumns}
          pagination={false}
          scroll={{ x: 'max-content' }}
        />
      </Modal>
    </Card>
  );
}

function SelectTags(props) {
  const { style, ...rest } = props;
  return <Select mode="tags" tokenSeparators={[',', '，', ';', '；', '\n']} style={{ width: '100%', ...style }} {...rest} />;
}
