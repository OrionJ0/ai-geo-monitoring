// @ts-nocheck
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Col, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import axios from 'axios';
import { getSelectableProjects, resolveSelectedProjectId } from '@/utils/projectSelection.cjs';
import { defaultThresholdForType, isCountThreshold, normalizeThresholdInput, thresholdMin, thresholdUnit } from '@/utils/alertRuleDisplay.cjs';
import { getApiErrorMessage } from '@/utils/apiErrorMessage.cjs';

const { Text, Title } = Typography;

const ruleTypes = [
  { value: 'visibility_drop', label: '可见度下降', description: '品牌提及率或声量占比（SOV）低于阈值' },
  { value: 'competitor_ahead', label: '竞品领先', description: '竞品可见度得分领先品牌达到阈值' },
  { value: 'negative_sentiment', label: '负面情绪', description: '品牌被提及回答中的负向占比超过阈值' },
  { value: 'citation_gap', label: '引用率低', description: 'AI 回答引用率低于阈值' },
  { value: 'platform_gap', label: '平台差异', description: '不同监测平台的品牌提及率差距超过阈值' },
  { value: 'source_drop', label: '来源流失', description: '流失引用域名或 URL 数达到阈值' },
  { value: 'task_failure', label: '任务失败', description: '检测任务失败次数超过阈值' },
];

function extractList(res) {
  const data = res?.data?.data ?? res?.data ?? [];
  return Array.isArray(data) ? data : [];
}

function formatDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('zh-CN', { hour12: false });
}

function ruleTypeMeta(type) {
  return ruleTypes.find((item) => item.value === type) || ruleTypes[0];
}

export default function GeoAlertsPage() {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState();
  const [rules, setRules] = useState([]);
  const [projectLoading, setProjectLoading] = useState(false);
  const [ruleLoading, setRuleLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [form] = Form.useForm();
  const rulesRequestRef = useRef(0);
  const currentProjectIdRef = useRef(null);
  const selectedRuleType = Form.useWatch('type', form) || editingRule?.type || 'visibility_drop';

  const invalidateRulesRequest = () => {
    rulesRequestRef.current += 1;
  };

  const fetchProjects = useCallback(async () => {
    setProjectLoading(true);
    try {
      const res = await axios.get('/api/geo-projects');
      const rows = getSelectableProjects(extractList(res));
      setProjects(rows);
      setProjectId((current) => resolveSelectedProjectId(rows, current));
    } catch (error) {
      message.error(getApiErrorMessage(error, '获取品牌项目失败'));
    } finally {
      setProjectLoading(false);
    }
  }, []);

  const fetchRules = useCallback(async (id) => {
    const requestId = rulesRequestRef.current + 1;
    rulesRequestRef.current = requestId;
    if (!id) {
      setRules([]);
      setRuleLoading(false);
      return;
    }
    setRules([]);
    setRuleLoading(true);
    try {
      const res = await axios.get(`/api/geo-projects/${id}/alerts`);
      if (rulesRequestRef.current === requestId) setRules(extractList(res));
    } catch (error) {
      if (rulesRequestRef.current === requestId) {
        message.error(getApiErrorMessage(error, '获取告警规则失败'));
      }
    } finally {
      if (rulesRequestRef.current === requestId) setRuleLoading(false);
    }
  }, []);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);
  useEffect(() => {
    currentProjectIdRef.current = projectId;
    fetchRules(projectId);
  }, [fetchRules, projectId]);

  const selectedProject = useMemo(() => projects.find((item) => item.id === projectId), [projects, projectId]);

  const refreshRulesForProject = (targetProjectId) => {
    if (currentProjectIdRef.current !== targetProjectId) return;
    fetchRules(targetProjectId);
  };

  const handleProjectChange = (nextProjectId) => {
    invalidateRulesRequest();
    setProjectId(nextProjectId);
    setRules([]);
    setRuleLoading(false);
    setModalOpen(false);
    setEditingRule(null);
    form.resetFields();
  };

  const openCreate = () => {
    setEditingRule(null);
    form.setFieldsValue({ type: 'visibility_drop', threshold: 10, enabled: true });
    setModalOpen(true);
  };

  const openEdit = (rule) => {
    setEditingRule(rule);
    form.setFieldsValue({
      type: rule.type,
      threshold: Number(rule.threshold || 0),
      enabled: !!rule.enabled,
    });
    setModalOpen(true);
  };

  const saveRule = async () => {
    if (!projectId) return;
    const mutationProjectId = projectId;
    try {
      const values = await form.validateFields();
      const payload = {
        type: values.type,
        threshold: normalizeThresholdInput(values.type, values.threshold),
        enabled: values.enabled !== false,
      };
      if (editingRule) {
        await axios.put(`/api/geo-projects/${mutationProjectId}/alerts/${editingRule.id}`, payload);
        if (currentProjectIdRef.current !== mutationProjectId) return;
        message.success('告警规则已更新');
      } else {
        await axios.post(`/api/geo-projects/${mutationProjectId}/alerts`, payload);
        if (currentProjectIdRef.current !== mutationProjectId) return;
        message.success('告警规则已创建');
      }
      setModalOpen(false);
      setEditingRule(null);
      refreshRulesForProject(mutationProjectId);
    } catch (error) {
      if (error?.errorFields) return;
      message.error(getApiErrorMessage(error, editingRule ? '更新告警规则失败' : '创建告警规则失败'));
    }
  };

  const toggleRule = async (rule) => {
    if (!projectId) return;
    const mutationProjectId = projectId;
    try {
      await axios.put(`/api/geo-projects/${mutationProjectId}/alerts/${rule.id}`, {
        enabled: !rule.enabled,
      });
      if (currentProjectIdRef.current !== mutationProjectId) return;
      message.success(rule.enabled ? '已停用告警规则' : '已启用告警规则');
      refreshRulesForProject(mutationProjectId);
    } catch (error) {
      message.error(getApiErrorMessage(error, '更新告警规则失败'));
    }
  };

  const deleteRule = async (rule) => {
    if (!projectId) return;
    const mutationProjectId = projectId;
    try {
      await axios.delete(`/api/geo-projects/${mutationProjectId}/alerts/${rule.id}`);
      if (currentProjectIdRef.current !== mutationProjectId) return;
      message.success('告警规则已删除');
      refreshRulesForProject(mutationProjectId);
    } catch (error) {
      message.error(getApiErrorMessage(error, '删除告警规则失败'));
    }
  };

  const columns = [
    {
      title: '规则类型',
      dataIndex: 'type',
      width: 180,
      render: (value) => {
        const meta = ruleTypeMeta(value);
        return (
          <Space orientation="vertical" size={0}>
            <Text strong>{meta.label}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>{meta.description}</Text>
          </Space>
        );
      },
    },
    {
      title: '阈值',
      dataIndex: 'threshold',
      width: 120,
      render: (value, row) => {
        const suffix = thresholdUnit(row.type);
        return `${Number(value || 0)}${suffix}`;
      },
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 120,
      render: (value, row) => (
        <Switch checked={!!value} checkedChildren="启用" unCheckedChildren="停用" onChange={() => toggleRule(row)} />
      ),
    },
    {
      title: '最近触发',
      dataIndex: 'last_triggered_at',
      width: 280,
      render: (value, row) => value ? (
        <Space orientation="vertical" size={2}>
          <Tag color="orange">{formatDate(value)}</Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.last_trigger_message || `触发值 ${Number(row.last_trigger_value || 0)}`}</Text>
        </Space>
      ) : <Text type="secondary">未触发</Text>,
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: 170,
      render: formatDate,
    },
    {
      title: '操作',
      width: 150,
      fixed: 'right',
      render: (_, row) => (
        <Space>
          <Button size="small" onClick={() => openEdit(row)}>编辑</Button>
          <Popconfirm title="删除告警规则？" okText="删除" cancelText="取消" onConfirm={() => deleteRule(row)}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        <Row align="middle" justify="space-between" gutter={[16, 12]}>
          <Col>
            <Title level={3} style={{ margin: 0 }}>告警规则</Title>
            <Text type="secondary">为 {selectedProject?.name || '品牌项目'} 配置 GEO 可见度监控规则</Text>
          </Col>
          <Col>
            <Space wrap>
              <Select
                loading={projectLoading}
                placeholder="选择品牌项目"
                style={{ width: 280 }}
                value={projectId}
                onChange={handleProjectChange}
                options={projects.map((item) => ({ label: item.name, value: item.id }))}
              />
              <Button type="primary" disabled={!projectId} onClick={openCreate}>新建规则</Button>
            </Space>
          </Col>
        </Row>

        <Row gutter={[12, 12]}>
          {ruleTypes.map((item) => (
            <Col xs={24} sm={12} xl={4} key={item.value}>
              <Card size="small">
                <Space orientation="vertical" size={4}>
                  <Text strong>{item.label}</Text>
                  <Text type="secondary">{item.description}</Text>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>

        <Card size="small" title="规则列表">
          <Table
            size="small"
            rowKey="id"
            loading={ruleLoading}
            columns={columns}
            dataSource={rules}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            scroll={{ x: 1040 }}
          />
        </Card>
      </Space>

      <Modal
        title={editingRule ? '编辑告警规则' : '新建告警规则'}
        open={modalOpen}
        onOk={saveRule}
        onCancel={() => { setModalOpen(false); setEditingRule(null); }}
        destroyOnHidden
        forceRender
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="type" label="规则类型" rules={[{ required: true, message: '请选择规则类型' }]}>
            <Select
              onChange={(type) => {
                form.setFieldValue('threshold', defaultThresholdForType(type));
              }}
              options={ruleTypes.map((item) => ({ label: item.label, value: item.value }))}
            />
          </Form.Item>
          <Form.Item
            label="阈值"
            extra={
              isCountThreshold(selectedRuleType)
                ? '任务失败表示失败任务条数，来源流失表示流失引用域名或 URL 数。'
                : selectedRuleType === 'competitor_ahead'
                  ? '竞品领先按可见度得分差值触发，例如竞品比品牌高 10 分时达到 10 分阈值。'
                  : selectedRuleType === 'negative_sentiment'
                    ? '负面情绪按品牌被提及的回答计算，至少 3 条品牌提及样本后触发。'
                    : '百分比类规则使用 0-100。'
            }
          >
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item name="threshold" noStyle rules={[{ required: true, message: '请输入阈值' }]}>
                <InputNumber
                  min={thresholdMin(selectedRuleType)}
                  max={isCountThreshold(selectedRuleType) || selectedRuleType === 'competitor_ahead' ? 1000 : 100}
                  step={1}
                  style={{ flex: 1 }}
                />
              </Form.Item>
              <Input
                aria-label="阈值单位"
                readOnly
                value={thresholdUnit(selectedRuleType)}
                style={{ width: 56, textAlign: 'center' }}
              />
            </Space.Compact>
          </Form.Item>
          <Form.Item name="enabled" label="启用状态" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
