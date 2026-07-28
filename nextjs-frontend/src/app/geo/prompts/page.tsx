// @ts-nocheck
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Col, Descriptions, Empty, Form, Input, Modal, Popconfirm, Row, Select, Space, Switch, Table, Tag, Tooltip, Typography, message } from 'antd';
import axios from '@/lib/axiosConfig';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkKeywordHighlight from '@/utils/remarkKeywordHighlight';
import { resolveKeywordStats } from '@/utils/keywordStats.cjs';
import { buildBrandKeywords } from '@/utils/brandKeywords.cjs';
import { getHistoryAnalysisDisplay } from '@/utils/historyAnalysisDisplay.cjs';
import { normalizeHistoryCitationSources } from '@/utils/historyCitationSources.cjs';
import { formatHistoryErrorMessage, formatHistoryParsingErrorMessage } from '@/utils/historyErrorDisplay.cjs';
import { getRunResultNotice } from '@/utils/runResultMessage.cjs';
import { getApiErrorMessage } from '@/utils/apiErrorMessage.cjs';
import { getApiRunResultData } from '@/utils/apiRunResult.cjs';
import { createIdempotencyKey } from '@/utils/idempotencyKey.cjs';
import { formatOptionalDateTimeShort } from '@/utils/dateTimeDisplay.cjs';
import {
  describeSelectedPlatforms,
  formatUnavailablePlatformSummary
} from '@/utils/platformSelectionStatus.cjs';
import {
  getSelectablePromptProjects,
  resolveSelectedPromptProjectId,
  shouldClearGeneratedPromptSuggestions,
  shouldResetPromptListFilters,
  shouldResetPromptSelection
} from '@/utils/promptSelection.cjs';
import { getProjectPromptRunBlockReason } from '@/utils/projectPromptSummary.cjs';
import { filterPromptRows } from '@/utils/promptListFilters.cjs';
import { parseBatchQuestions } from '@/utils/questionBatchParser.cjs';
import { useAIPlatformCatalog } from '@/lib/useAIPlatformCatalog';
import WebCaptureEvidence from '@/components/WebCaptureEvidence';
import WebPlatformRuntimeStatus from '@/components/WebPlatformRuntimeStatus';

const { Text } = Typography;

const statusLabels = {
  completed: '已完成',
  failed: '失败',
  pending: '进行中',
};

const sourceTypeColors = {
  自有来源: 'green',
  竞品来源: 'red',
  第三方来源: 'default',
};

const periodOptions = [
  { label: '近 7 天', value: 7 },
  { label: '近 30 天', value: 30 },
  { label: '近 90 天', value: 90 },
];

const promptRunBlockMessages = {
  no_enabled_prompt: '问题已停用，启用后才能运行',
  platform_mismatch: '问题的监测平台与项目监测平台不一致，请检查品牌项目监测平台设置'
};

const percent = (value) => {
  const n = Number(value || 0);
  return Number.isFinite(n) ? `${Number(n.toFixed(2))}%` : '0%';
};

const formatRank = (value) => {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? Number(n.toFixed(2)) : '-';
};

export default function GeoPromptsPage() {
  const router = useRouter();
  const {
    platforms: platformCatalog,
    labels: platformLabels,
    selectableCodes,
    loading: platformCatalogLoading,
    error: platformCatalogError
  } = useAIPlatformCatalog();
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [prompts, setPrompts] = useState([]);
  const [questionSets, setQuestionSets] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [promptsLoading, setPromptsLoading] = useState(false);
  const [questionSetsLoading, setQuestionSetsLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(null);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [savingBatch, setSavingBatch] = useState(false);
  const [runningPromptId, setRunningPromptId] = useState(null);
  const [questionSetModalOpen, setQuestionSetModalOpen] = useState(false);
  const [editingQuestionSet, setEditingQuestionSet] = useState(null);
  const [savingQuestionSet, setSavingQuestionSet] = useState(false);
  const [runningQuestionSetId, setRunningQuestionSetId] = useState(null);
  const [selectedPromptIds, setSelectedPromptIds] = useState([]);
  const [promptSearch, setPromptSearch] = useState('');
  const [promptStatusFilter, setPromptStatusFilter] = useState('all');
  const [promptPlatformFilter, setPromptPlatformFilter] = useState('all');
  const [promptCategoryFilter, setPromptCategoryFilter] = useState('all');
  const [days, setDays] = useState(30);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPrompt, setHistoryPrompt] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [form] = Form.useForm();
  const [batchForm] = Form.useForm();
  const [questionSetForm] = Form.useForm();
  const previousProjectIdRef = useRef(null);
  const currentProjectIdRef = useRef(null);
  const promptsRequestRef = useRef(0);
  const questionSetsRequestRef = useRef(0);
  const batchRequestRef = useRef(0);
  const historyRequestRef = useRef(0);
  const runRequestRef = useRef(0);
  const promptRunIdempotencyRef = useRef(new Map());
  const questionSetRunRequestRef = useRef(0);
  const questionSetRunIdempotencyRef = useRef(new Map());
  const batchText = Form.useWatch('questions_text', batchForm);

  const selectedProject = useMemo(
    () => projects.find((item) => item.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  const normalizeList = (value) => Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];

  const projectPlatforms = useMemo(() => {
    return Array.from(new Set(normalizeList(selectedProject?.platforms)));
  }, [selectedProject]);

  const selectableProjectPlatforms = useMemo(
    () => projectPlatforms.filter((item) => selectableCodes.includes(item)),
    [projectPlatforms, selectableCodes]
  );

  const projectPlatformStatuses = useMemo(
    () => describeSelectedPlatforms(projectPlatforms, platformCatalog, {
      catalogReady: !platformCatalogLoading && !platformCatalogError
    }),
    [projectPlatforms, platformCatalog, platformCatalogLoading, platformCatalogError]
  );

  const unavailableProjectPlatformSummary = useMemo(
    () => formatUnavailablePlatformSummary(projectPlatformStatuses),
    [projectPlatformStatuses]
  );

  const batchPreview = useMemo(
    () => parseBatchQuestions(batchText || ''),
    [batchText]
  );

  const getProjectPlatforms = () => projectPlatforms;

  const filteredPrompts = useMemo(() => {
    return filterPromptRows(prompts, {
      search: promptSearch,
      status: promptStatusFilter,
      platform: promptPlatformFilter,
      category: promptCategoryFilter,
      projectPlatforms,
      platformLabels
    });
  }, [prompts, promptSearch, promptStatusFilter, promptPlatformFilter, promptCategoryFilter, projectPlatforms, platformLabels]);

  const selectedFilteredCount = useMemo(() => {
    const selected = new Set(selectedPromptIds);
    return filteredPrompts.filter((item) => selected.has(item.id)).length;
  }, [filteredPrompts, selectedPromptIds]);

  const promptCategoryOptions = useMemo(() => {
    const categories = Array.from(new Set(
      prompts
        .map((item) => String(item?.category || item?.prompt_category || '').trim())
        .filter(Boolean)
    )).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    return [
      { label: '全部分类', value: 'all' },
      ...categories.map((item) => ({ label: item, value: item }))
    ];
  }, [prompts]);

  const getPromptPlatforms = (row) => {
    const list = normalizeList(row?.platforms);
    return list.length ? list : getProjectPlatforms();
  };

  const getPromptRunDisabledReason = (row) => {
    const reason = getProjectPromptRunBlockReason([row], getProjectPlatforms());
    if (reason) return promptRunBlockMessages[reason];
    const hasSelectablePlatform = getPromptPlatforms(row)
      .some((item) => selectableProjectPlatforms.includes(item));
    return hasSelectablePlatform
      ? ''
      : '当前问题没有已配置且启用的监测平台，请联系管理员处理';
  };

  const getBrandKeywords = (row) => {
    return buildBrandKeywords({
      rowBrand: row?.brand,
      projectName: selectedProject?.name,
      aliases: selectedProject?.aliases,
      primaryKeywords: selectedProject?.primary_keywords,
      rowBrandKeywords: row?.brand_keywords
    });
  };

  const getKeywordStats = (row) => {
    const brandKeywords = getBrandKeywords(row);
    const originalText = row?.resultDetail?.ai_response_original || '';
    return resolveKeywordStats({
      text: originalText,
      keywords: brandKeywords,
      storedStats: row?.result_summary?.keyword_counts,
      englishWordBoundary: true
    });
  };

  const renderHistoryDetail = (row) => {
    const brandKeywords = getBrandKeywords(row);
    const keywordStats = getKeywordStats(row);
    const analysisDisplay = getHistoryAnalysisDisplay(row);
    const statusColor = row.status === 'completed' ? 'success' : row.status === 'failed' ? 'error' : 'processing';
    const originalText = row?.resultDetail?.ai_response_original || '';
    const citationSources = normalizeHistoryCitationSources(row?.visibilityMetric?.citation_sources);
    const citationEvidenceStatus = row?.visibilityMetric?.citation_evidence_status;
    const safeErrorMessage = formatHistoryErrorMessage(row.error_message);
    const safeParsingErrorMessage = formatHistoryParsingErrorMessage(row?.resultDetail?.parsing_error);

    return (
      <div style={{ background: '#fff', padding: 8 }}>
        <Descriptions bordered column={2} size="small" styles={{ label: { whiteSpace: 'nowrap', width: 90 } }}>
          <Descriptions.Item label="检测时间">{formatOptionalDateTimeShort(row.created_at)}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={statusColor}>{statusLabels[row.status] || row.status || '-'}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="问题" span={1}>
            <div style={{ wordBreak: 'break-word' }}>{row.question || historyPrompt?.question || '-'}</div>
          </Descriptions.Item>
          <Descriptions.Item label="检测关键词" span={1}>
            {brandKeywords.length ? (
              <Space wrap size="small">
                {brandKeywords.map((keyword, index) => <Tag key={`${keyword}-${index}`} color="blue">{keyword}</Tag>)}
              </Space>
            ) : <span>-</span>}
          </Descriptions.Item>
          <Descriptions.Item label="品牌" span={1}>{row.brand || selectedProject?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="检测平台" span={1}>
            <Tag color="processing">{row.platform_name || platformLabels[row.platform] || String(row.platform || '-')}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="实际模型" span={1}>{row.model_name || '-'}</Descriptions.Item>
          <Descriptions.Item label="声量占比（SOV）" span={1}>
            {analysisDisplay.sov}
          </Descriptions.Item>
          <Descriptions.Item label="情绪" span={1}>
            <Tag color={analysisDisplay.sentimentColor}>{analysisDisplay.sentimentLabel}</Tag>
          </Descriptions.Item>
          {analysisDisplay.sentimentReason ? (
            <Descriptions.Item label="情绪依据" span={2}>
              <Text>{analysisDisplay.sentimentReason}</Text>
            </Descriptions.Item>
          ) : null}
          {analysisDisplay.sentimentRiskTerms.length ? (
            <Descriptions.Item label="情绪风险词" span={2}>
              <Space wrap size="small">
                {analysisDisplay.sentimentRiskTerms.map((term, index) => <Tag key={`${term}-${index}`} color="red">{term}</Tag>)}
              </Space>
            </Descriptions.Item>
          ) : null}
          {row.status === 'failed' ? (
            <Descriptions.Item label="失败原因" span={2}>
              <div style={{ whiteSpace: 'pre-wrap', color: '#cf1322' }}>{safeErrorMessage}</div>
            </Descriptions.Item>
          ) : null}
          <Descriptions.Item label="关键词统计" span={2}>
            {keywordStats.length ? (
              <Space wrap size="small">
                {keywordStats.map((item, index) => (
                  <Tag key={`${item.keyword}-${index}`} color="gold">{`${item.keyword} × ${item.count}`}</Tag>
                ))}
              </Space>
            ) : <span>-</span>}
          </Descriptions.Item>
          <Descriptions.Item label="引用源" span={2}>
            {citationEvidenceStatus === 'legacy_unverified' ? (
              <Text type="warning">历史混合来源无法区分证据角色，不计入引用 KPI</Text>
            ) : citationSources.length ? (
              <Space orientation="vertical" size={4} style={{ width: '100%' }}>
                {citationSources.slice(0, 8).map((source) => (
                  <Space key={`${source.url || source.domain}-${source.source_type}`} size={[6, 4]} wrap>
                    <Tag color={sourceTypeColors[source.source_type] || 'default'}>{source.source_type}</Tag>
                    {source.url ? (
                      <a href={source.url} target="_blank" rel="noreferrer">{source.domain}</a>
                    ) : (
                      <Text>{source.domain}</Text>
                    )}
                  </Space>
                ))}
                {citationSources.length > 8 ? <Text type="secondary">还有 {citationSources.length - 8} 个引用来源</Text> : null}
              </Space>
            ) : <span>-</span>}
          </Descriptions.Item>
          {row?.resultDetail?.parsing_error ? (
            <Descriptions.Item label="处理提示" span={2}>
              <div style={{ whiteSpace: 'pre-wrap', color: 'red' }}>{safeParsingErrorMessage}</div>
            </Descriptions.Item>
          ) : null}
        </Descriptions>
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 500, color: '#1f1f1f', marginBottom: 8, textAlign: 'center' }}>回答详情</div>
          <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12, lineHeight: 1.7, overflow: 'visible' }}>
            {originalText ? (
              <ReactMarkdown
                remarkPlugins={[
                  remarkGfm,
                  [remarkKeywordHighlight, { keywords: brandKeywords, englishWordBoundary: true }]
                ]}
                components={{
                  em: ({ children }) => (
                    <mark style={{ backgroundColor: '#fff3a1' }}>{children}</mark>
                  )
                }}
              >
                {String(originalText)}
              </ReactMarkdown>
            ) : (
              <span style={{ color: '#999' }}>{row.status === 'failed' ? safeErrorMessage : '暂无回答内容'}</span>
            )}
          </div>
        </div>
        <WebCaptureEvidence record={row} />
      </div>
    );
  };

  const fetchProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const res = await axios.get('/api/geo-projects');
      const list = Array.isArray(res?.data?.data) ? res.data.data : [];
      const selectableProjects = getSelectablePromptProjects(list);
      setProjects(selectableProjects);
      setSelectedProjectId((prev) => {
        return resolveSelectedPromptProjectId(selectableProjects, prev);
      });
    } catch (error) {
      message.error(getApiErrorMessage(error, '获取品牌项目失败'));
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  const fetchPrompts = useCallback(async (projectId = selectedProjectId, targetDays = days) => {
    const requestId = promptsRequestRef.current + 1;
    promptsRequestRef.current = requestId;
    if (!projectId) {
      setPrompts([]);
      setPromptsLoading(false);
      return;
    }
    setPrompts([]);
    setPromptsLoading(true);
    try {
      const res = await axios.get(`/api/geo-projects/${projectId}/prompts`, { params: { days: targetDays } });
      if (promptsRequestRef.current === requestId) setPrompts(Array.isArray(res?.data?.data) ? res.data.data : []);
    } catch (error) {
      if (promptsRequestRef.current === requestId) {
        message.error(getApiErrorMessage(error, '获取问题列表失败'));
      }
    } finally {
      if (promptsRequestRef.current === requestId) setPromptsLoading(false);
    }
  }, [selectedProjectId, days]);

  const fetchQuestionSets = useCallback(async (projectId = selectedProjectId) => {
    const requestId = questionSetsRequestRef.current + 1;
    questionSetsRequestRef.current = requestId;
    if (!projectId) {
      setQuestionSets([]);
      setQuestionSetsLoading(false);
      return;
    }
    setQuestionSets([]);
    setQuestionSetsLoading(true);
    try {
      const res = await axios.get(`/api/geo-projects/${projectId}/question-sets`);
      if (questionSetsRequestRef.current === requestId) {
        setQuestionSets(Array.isArray(res?.data?.data) ? res.data.data : []);
      }
    } catch (error) {
      if (questionSetsRequestRef.current === requestId) {
        message.error(getApiErrorMessage(error, '获取问题集失败'));
      }
    } finally {
      if (questionSetsRequestRef.current === requestId) setQuestionSetsLoading(false);
    }
  }, [selectedProjectId]);

  const isCurrentPromptProject = (projectId) => currentProjectIdRef.current === projectId;

  const refreshPromptDataForProject = (projectId) => {
    if (!isCurrentPromptProject(projectId)) return;
    fetchPrompts(projectId);
    fetchQuestionSets(projectId);
    fetchProjects();
  };

  const handleProjectChange = (nextProjectId) => {
    setSelectedProjectId(nextProjectId);
    setSelectedPromptIds([]);
    setModalOpen(false);
    setEditingPrompt(null);
    setBatchModalOpen(false);
    setSavingBatch(false);
    setQuestionSetModalOpen(false);
    setEditingQuestionSet(null);
    setSavingQuestionSet(false);
    setRunningPromptId(null);
    setRunningQuestionSetId(null);
    form.resetFields();
    batchForm.resetFields();
    questionSetForm.resetFields();
  };

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    currentProjectIdRef.current = selectedProjectId;
    if (shouldResetPromptSelection(previousProjectIdRef.current, selectedProjectId)) {
      setSelectedPromptIds([]);
    }
    if (shouldResetPromptListFilters(previousProjectIdRef.current, selectedProjectId)) {
      setPromptSearch('');
      setPromptStatusFilter('all');
      setPromptPlatformFilter('all');
      setPromptCategoryFilter('all');
    }
    if (shouldClearGeneratedPromptSuggestions(previousProjectIdRef.current, selectedProjectId)) {
      batchRequestRef.current += 1;
      historyRequestRef.current += 1;
      runRequestRef.current += 1;
      questionSetRunRequestRef.current += 1;
      setBatchModalOpen(false);
      setSavingBatch(false);
      setHistoryOpen(false);
      setHistoryPrompt(null);
      setHistoryRows([]);
      setHistoryLoading(false);
      setSavingQuestionSet(false);
      setRunningPromptId(null);
      setRunningQuestionSetId(null);
    }
    previousProjectIdRef.current = selectedProjectId;
    fetchPrompts(selectedProjectId, days);
    fetchQuestionSets(selectedProjectId);
  }, [selectedProjectId, days, fetchPrompts, fetchQuestionSets]);

  const openCreate = () => {
    if (!selectableProjectPlatforms.length) {
      message.warning('当前项目没有已配置且启用的监测平台，请联系管理员处理');
      return;
    }
    setEditingPrompt(null);
    form.setFieldsValue({
      question: '',
      tags: [],
      question_set_id: null,
      platforms: selectableProjectPlatforms,
      enabled: true,
    });
    setModalOpen(true);
  };

  const openEdit = (record) => {
    const currentPlatforms = getPromptPlatforms(record)
      .filter((item) => selectableProjectPlatforms.includes(item));
    setEditingPrompt(record);
    form.setFieldsValue({
      question: record.question || '',
      tags: normalizeList(record.tags),
      question_set_id: record.question_set_id || null,
      platforms: currentPlatforms.length ? currentPlatforms : selectableProjectPlatforms,
      enabled: record.enabled !== false,
    });
    setModalOpen(true);
  };

  const openBatchCreate = () => {
    if (!selectableProjectPlatforms.length) {
      message.warning('当前项目没有已配置且启用的监测平台，请联系管理员处理');
      return;
    }
    batchForm.setFieldsValue({
      questions_text: '',
      tags: [],
      question_set_id: null,
      enabled: true
    });
    setBatchModalOpen(true);
  };

  const savePrompt = async () => {
    if (!selectedProjectId) {
      message.warning('请先选择品牌项目');
      return;
    }
    const mutationProjectId = selectedProjectId;
    try {
      const values = await form.validateFields();
      const payload = {
        question: String(values.question || '').trim(),
        tags: normalizeList(values.tags),
        question_set_id: values.question_set_id || null,
        platforms: normalizeList(values.platforms),
        enabled: values.enabled !== false,
      };
      if (editingPrompt?.id) {
        await axios.put(`/api/geo-projects/${mutationProjectId}/prompts/${editingPrompt.id}`, payload);
        if (!isCurrentPromptProject(mutationProjectId)) return;
        message.success('问题已更新');
      } else {
        await axios.post(`/api/geo-projects/${mutationProjectId}/prompts`, payload);
        if (!isCurrentPromptProject(mutationProjectId)) return;
        message.success('问题已创建');
      }
      setModalOpen(false);
      setEditingPrompt(null);
      form.resetFields();
      refreshPromptDataForProject(mutationProjectId);
    } catch (error) {
      if (error?.errorFields) return;
      message.error(getApiErrorMessage(error, '保存问题失败'));
    }
  };

  const saveBatchPrompts = async () => {
    if (!selectedProjectId) {
      message.warning('请先选择品牌项目');
      return;
    }
    const mutationProjectId = selectedProjectId;
    const requestId = batchRequestRef.current + 1;
    batchRequestRef.current = requestId;
    try {
      const values = await batchForm.validateFields();
      const parsed = parseBatchQuestions(values.questions_text || '');
      if (parsed.overflow_count > 0) {
        message.error(`单次最多新增 100 个问题，请减少 ${parsed.overflow_count} 个后重试`);
        return;
      }
      if (!parsed.questions.length) {
        message.warning('请至少输入一个问题');
        return;
      }
      setSavingBatch(true);
      const response = await axios.post(`/api/geo-projects/${mutationProjectId}/prompts/batch`, {
        questions: parsed.questions,
        tags: normalizeList(values.tags),
        question_set_id: values.question_set_id || null,
        platforms: selectableProjectPlatforms,
        enabled: values.enabled !== false
      });
      if (!(batchRequestRef.current === requestId && isCurrentPromptProject(mutationProjectId))) return;
      const data = response?.data?.data || {};
      const createdCount = Number(data.created_count || 0);
      const skippedCount = Number(data.skipped_count || 0);
      if (createdCount) message.success(`已新增 ${createdCount} 个问题`);
      if (skippedCount) message.warning(`已跳过 ${skippedCount} 个重复问题`);
      setBatchModalOpen(false);
      batchForm.resetFields();
      refreshPromptDataForProject(mutationProjectId);
    } catch (error) {
      if (error?.errorFields) return;
      if (batchRequestRef.current === requestId && isCurrentPromptProject(mutationProjectId)) {
        message.error(getApiErrorMessage(error, '批量新增问题失败'));
      }
    } finally {
      if (batchRequestRef.current === requestId && isCurrentPromptProject(mutationProjectId)) {
        setSavingBatch(false);
      }
    }
  };

  const openCreateQuestionSet = () => {
    setEditingQuestionSet(null);
    questionSetForm.setFieldsValue({
      name: '',
      description: '',
      question_ids: selectedPromptIds.length >= 2 ? selectedPromptIds : []
    });
    setQuestionSetModalOpen(true);
  };

  const openEditQuestionSet = (questionSet) => {
    setEditingQuestionSet(questionSet);
    questionSetForm.setFieldsValue({
      name: questionSet.name || '',
      description: questionSet.description || '',
      question_ids: Array.isArray(questionSet.questions)
        ? questionSet.questions.map((item) => item.id).filter(Boolean)
        : []
    });
    setQuestionSetModalOpen(true);
  };

  const saveQuestionSet = async () => {
    if (!selectedProjectId) {
      message.warning('请先选择品牌项目');
      return;
    }
    const mutationProjectId = selectedProjectId;
    try {
      const values = await questionSetForm.validateFields();
      const payload = {
        name: String(values.name || '').trim(),
        description: String(values.description || '').trim(),
        question_ids: Array.isArray(values.question_ids) ? values.question_ids : []
      };
      setSavingQuestionSet(true);
      if (editingQuestionSet?.id) {
        await axios.patch(`/api/geo-projects/${mutationProjectId}/question-sets/${editingQuestionSet.id}`, payload);
        if (!isCurrentPromptProject(mutationProjectId)) return;
        message.success('问题集已更新');
      } else {
        await axios.post(`/api/geo-projects/${mutationProjectId}/question-sets`, payload);
        if (!isCurrentPromptProject(mutationProjectId)) return;
        message.success('问题集已创建');
      }
      setQuestionSetModalOpen(false);
      setEditingQuestionSet(null);
      questionSetForm.resetFields();
      refreshPromptDataForProject(mutationProjectId);
    } catch (error) {
      if (error?.errorFields) return;
      if (isCurrentPromptProject(mutationProjectId)) {
        message.error(getApiErrorMessage(error, '保存问题集失败'));
      }
    } finally {
      if (isCurrentPromptProject(mutationProjectId)) setSavingQuestionSet(false);
    }
  };

  const deleteQuestionSet = async (questionSet) => {
    if (!selectedProjectId || !questionSet?.id) return;
    const mutationProjectId = selectedProjectId;
    try {
      await axios.delete(`/api/geo-projects/${mutationProjectId}/question-sets/${questionSet.id}`);
      if (!isCurrentPromptProject(mutationProjectId)) return;
      message.success('问题集已删除，集合内问题仍保留在问题库中');
      refreshPromptDataForProject(mutationProjectId);
    } catch (error) {
      if (isCurrentPromptProject(mutationProjectId)) {
        message.error(getApiErrorMessage(error, '删除问题集失败'));
      }
    }
  };

  const runQuestionSet = async (questionSet) => {
    if (!selectedProjectId || !questionSet?.id) return;
    const runProjectId = selectedProjectId;
    const requestId = questionSetRunRequestRef.current + 1;
    questionSetRunRequestRef.current = requestId;
    const idempotencyScope = `${runProjectId}:${questionSet.id}`;
    let idempotencyKey = questionSetRunIdempotencyRef.current.get(idempotencyScope);
    try {
      setRunningQuestionSetId(questionSet.id);
      if (!idempotencyKey) {
        idempotencyKey = createIdempotencyKey();
        questionSetRunIdempotencyRef.current.set(idempotencyScope, idempotencyKey);
      }
      const res = await axios.post(
        `/api/geo-projects/${runProjectId}/question-sets/${questionSet.id}/run`,
        { idempotency_key: idempotencyKey },
        { headers: { 'Idempotency-Key': idempotencyKey } }
      );
      const data = res?.data?.data || {};
      if (questionSetRunIdempotencyRef.current.get(idempotencyScope) === idempotencyKey) {
        questionSetRunIdempotencyRef.current.delete(idempotencyScope);
      }
      if (questionSetRunRequestRef.current === requestId && currentProjectIdRef.current === runProjectId) {
        if (data.idempotent_replay) {
          message.info('已恢复同一次运行，正在读取最新报告');
        } else {
          const notice = getRunResultNotice(data);
          message[notice.type](notice.text);
        }
        const reportUrl = data.report_url || (data.question_set_run_id
          ? `/geo/question-set-reports?project_id=${runProjectId}&run_id=${data.question_set_run_id}`
          : null);
        if (reportUrl) router.push(reportUrl);
      }
    } catch (error) {
      const data = getApiRunResultData(error);
      const errorCode = error?.response?.data?.data?.error_code;
      if (
        ['IDEMPOTENCY_KEY_REUSED', 'INVALID_IDEMPOTENCY_KEY'].includes(errorCode)
        && questionSetRunIdempotencyRef.current.get(idempotencyScope) === idempotencyKey
      ) {
        questionSetRunIdempotencyRef.current.delete(idempotencyScope);
      }
      if (data && questionSetRunRequestRef.current === requestId && currentProjectIdRef.current === runProjectId) {
        const notice = getRunResultNotice(data);
        message[notice.type](notice.text);
        if (data.report_url) router.push(data.report_url);
      } else if (questionSetRunRequestRef.current === requestId && currentProjectIdRef.current === runProjectId) {
        message.error(getApiErrorMessage(
          error,
          error instanceof Error ? error.message : '运行问题集失败'
        ));
      }
    } finally {
      if (questionSetRunRequestRef.current === requestId && currentProjectIdRef.current === runProjectId) {
        setRunningQuestionSetId(null);
      }
    }
  };

  const deletePrompt = async (record) => {
    if (!selectedProjectId) return;
    const mutationProjectId = selectedProjectId;
    try {
      await axios.delete(`/api/geo-projects/${mutationProjectId}/prompts/${record.id}`);
      if (!isCurrentPromptProject(mutationProjectId)) return;
      message.success('问题已删除');
      refreshPromptDataForProject(mutationProjectId);
    } catch (error) {
      message.error(getApiErrorMessage(error, '删除问题失败'));
    }
  };

  const batchDeletePrompts = async () => {
    if (!selectedProjectId || !selectedPromptIds.length) return;
    const mutationProjectId = selectedProjectId;
    try {
      const res = await axios.post(`/api/geo-projects/${mutationProjectId}/prompts/batch-delete`, {
        prompt_ids: selectedPromptIds
      });
      if (!isCurrentPromptProject(mutationProjectId)) return;
      const deleted = res?.data?.data?.deleted || 0;
      message.success(`已删除 ${deleted} 个问题`);
      setSelectedPromptIds([]);
      refreshPromptDataForProject(mutationProjectId);
    } catch (error) {
      message.error(getApiErrorMessage(error, '批量删除问题失败'));
    }
  };

  const selectAllPrompts = () => {
    setSelectedPromptIds(filteredPrompts.map((item) => item.id).filter(Boolean));
  };

  const togglePrompt = async (record) => {
    if (!selectedProjectId) return;
    const mutationProjectId = selectedProjectId;
    try {
      await axios.put(`/api/geo-projects/${mutationProjectId}/prompts/${record.id}`, { enabled: !record.enabled });
      if (!isCurrentPromptProject(mutationProjectId)) return;
      message.success(record.enabled ? '问题已停用' : '问题已启用');
      refreshPromptDataForProject(mutationProjectId);
    } catch (error) {
      message.error(getApiErrorMessage(error, '状态更新失败'));
    }
  };

  const runPrompt = async (record) => {
    if (!selectedProjectId || !record?.id) return;
    const disabledReason = getPromptRunDisabledReason(record);
    if (disabledReason) {
      message.warning(disabledReason);
      return;
    }
    const runProjectId = selectedProjectId;
    const requestId = runRequestRef.current + 1;
    runRequestRef.current = requestId;
    const idempotencyScope = `${runProjectId}:${record.id}`;
    let idempotencyKey = promptRunIdempotencyRef.current.get(idempotencyScope);
    try {
      setRunningPromptId(record.id);
      if (!idempotencyKey) {
        idempotencyKey = createIdempotencyKey();
        promptRunIdempotencyRef.current.set(idempotencyScope, idempotencyKey);
      }
      const res = await axios.post(
        `/api/geo-projects/${runProjectId}/prompts/${record.id}/run`,
        { idempotency_key: idempotencyKey },
        { headers: { 'Idempotency-Key': idempotencyKey } }
      );
      const data = res?.data?.data || {};
      if (promptRunIdempotencyRef.current.get(idempotencyScope) === idempotencyKey) {
        promptRunIdempotencyRef.current.delete(idempotencyScope);
      }
      if (runRequestRef.current === requestId && currentProjectIdRef.current === runProjectId) {
        if (data.idempotent_replay) {
          message.info('已恢复同一次运行，正在读取最新报告');
        } else {
          const notice = getRunResultNotice(data);
          message[notice.type](notice.text);
        }
        const reportUrl = data.report_url || (data.question_set_run_id
          ? `/geo/question-set-reports?project_id=${runProjectId}&run_id=${data.question_set_run_id}`
          : null);
        if (reportUrl) router.push(reportUrl);
      }
    } catch (error) {
      const data = getApiRunResultData(error);
      const errorCode = error?.response?.data?.data?.error_code;
      if (
        ['IDEMPOTENCY_KEY_REUSED', 'INVALID_IDEMPOTENCY_KEY'].includes(errorCode)
        && promptRunIdempotencyRef.current.get(idempotencyScope) === idempotencyKey
      ) {
        promptRunIdempotencyRef.current.delete(idempotencyScope);
      }
      if (data && runRequestRef.current === requestId && currentProjectIdRef.current === runProjectId) {
        const notice = getRunResultNotice(data);
        message[notice.type](notice.text);
        if (data.report_url) router.push(data.report_url);
      } else if (runRequestRef.current === requestId && currentProjectIdRef.current === runProjectId) {
        message.error(getApiErrorMessage(
          error,
          error instanceof Error ? error.message : '运行问题失败'
        ));
      }
    } finally {
      if (runRequestRef.current === requestId && currentProjectIdRef.current === runProjectId) setRunningPromptId(null);
    }
  };

  const openPromptHistory = async (record) => {
    if (!selectedProjectId || !record?.id) return;
    const historyProjectId = selectedProjectId;
    const requestId = historyRequestRef.current + 1;
    historyRequestRef.current = requestId;
    setHistoryPrompt(record);
    setHistoryOpen(true);
    setHistoryRows([]);
    setHistoryLoading(true);
    try {
      const res = await axios.get(`/api/geo-projects/${historyProjectId}/prompts/${record.id}/history`, {
        params: { limit: 30 }
      });
      if (historyRequestRef.current === requestId && currentProjectIdRef.current === historyProjectId) {
        setHistoryRows(Array.isArray(res?.data?.data) ? res.data.data : []);
      }
    } catch (error) {
      if (historyRequestRef.current === requestId && currentProjectIdRef.current === historyProjectId) {
        message.error(getApiErrorMessage(error, '获取问题历史失败'));
      }
    } finally {
      if (historyRequestRef.current === requestId && currentProjectIdRef.current === historyProjectId) {
        setHistoryLoading(false);
      }
    }
  };

  const columns = [
    {
      title: '问题',
      dataIndex: 'question',
      key: 'question',
      width: 420,
      render: (value) => <div style={{ wordBreak: 'break-word', lineHeight: 1.5 }}>{value}</div>
    },
    {
      title: '问题集',
      key: 'question_set',
      width: 160,
      render: (_, row) => row.question_set?.name
        ? <Tag color="purple">{row.question_set.name}</Tag>
        : <Text type="secondary">未分组</Text>
    },
    {
      title: '标签',
      dataIndex: 'tags',
      key: 'tags',
      width: 220,
      render: (values) => (
        <Space wrap size={[4, 4]}>
          {normalizeList(values).map((item) => <Tag key={item}>{item}</Tag>)}
        </Space>
      ),
    },
    {
      title: '监测平台',
      key: 'platforms',
      width: 140,
      render: (_, row) => (
        <Space wrap size={[4, 4]}>
          {describeSelectedPlatforms(getPromptPlatforms(row), platformCatalog, {
            catalogReady: !platformCatalogLoading && !platformCatalogError
          }).map((item) => (
            <Tag color={item.selectable ? 'processing' : 'error'} key={item.code}>
              {item.displayLabel}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: `近 ${days} 天`,
      dataIndex: ['performance', 'checks'],
      key: 'checks',
      width: 90,
      render: (value) => `${Number(value || 0)} 次`,
      sorter: (a, b) => Number(a.performance?.checks || 0) - Number(b.performance?.checks || 0),
    },
    {
      title: '提及率',
      dataIndex: ['performance', 'brand_mention_rate'],
      key: 'brand_mention_rate',
      width: 100,
      render: percent,
      sorter: (a, b) => Number(a.performance?.brand_mention_rate || 0) - Number(b.performance?.brand_mention_rate || 0),
    },
    {
      title: '声量占比（SOV）',
      dataIndex: ['performance', 'avg_share_of_voice'],
      key: 'avg_share_of_voice',
      width: 90,
      render: percent,
      sorter: (a, b) => Number(a.performance?.avg_share_of_voice || 0) - Number(b.performance?.avg_share_of_voice || 0),
    },
    {
      title: '排名',
      dataIndex: ['performance', 'avg_brand_rank'],
      key: 'avg_brand_rank',
      width: 90,
      render: formatRank,
      sorter: (a, b) => Number(a.performance?.avg_brand_rank || 0) - Number(b.performance?.avg_brand_rank || 0),
    },
    {
      title: '引用率',
      dataIndex: ['performance', 'citation_rate'],
      key: 'citation_rate',
      width: 100,
      render: (value, row) => Number(row.performance?.citation_eligible_checks || 0) > 0
        ? percent(value)
        : '暂无可验证样本',
      sorter: (a, b) => Number(a.performance?.citation_rate || 0) - Number(b.performance?.citation_rate || 0),
    },
    {
      title: '情绪',
      key: 'sentiment',
      width: 150,
      render: (_, row) => {
        const perf = row.performance || {};
        const positive = Number(perf.positive_sentiment_count || 0);
        const neutral = Number(perf.neutral_sentiment_count || 0);
        const negative = Number(perf.negative_sentiment_count || 0);
        if (!positive && !neutral && !negative) return '-';
        return (
          <Space size={[4, 4]} wrap>
            {positive ? <Tag color="success">正 {positive}</Tag> : null}
            {neutral ? <Tag>中 {neutral}</Tag> : null}
            {negative ? <Tag color="error">负 {negative}</Tag> : null}
          </Space>
        );
      }
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 100,
      render: (value) => value !== false ? <Tag color="success">启用中</Tag> : <Tag>已停用</Tag>,
    },
    {
      title: '最近运行',
      dataIndex: ['performance', 'last_run_at'],
      key: 'last_run_at',
      width: 180,
      render: formatOptionalDateTimeShort,
      sorter: (a, b) => new Date(a.performance?.last_run_at || 0) - new Date(b.performance?.last_run_at || 0),
    },
    {
      title: '操作',
      key: 'actions',
      width: 210,
      fixed: 'right',
      render: (_, row) => {
        const disabledReason = getPromptRunDisabledReason(row);
        return (
          <Space>
            <Tooltip title={disabledReason}>
              <span>
                <Button
                  size="small"
                  loading={runningPromptId === row.id}
                  disabled={!!getPromptRunDisabledReason(row)}
                  onClick={() => runPrompt(row)}
                >
                  运行
                </Button>
              </span>
            </Tooltip>
            <Button size="small" onClick={() => openPromptHistory(row)}>历史</Button>
            <Button size="small" onClick={() => togglePrompt(row)}>{row.enabled !== false ? '停用' : '启用'}</Button>
            <Button size="small" type="primary" onClick={() => openEdit(row)}>编辑</Button>
            <Popconfirm title="确认删除该问题？" onConfirm={() => deletePrompt(row)}>
              <Button size="small" danger>删除</Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      {platformCatalogError ? <Alert type="error" showIcon title={platformCatalogError} /> : null}
      {unavailableProjectPlatformSummary ? (
        <Alert
          type="warning"
          showIcon
          title="当前项目包含暂不可用的监测平台"
          description={`${unavailableProjectPlatformSummary}。这些平台不会参与新运行，请启用平台或编辑项目将其移除。`}
          action={<Button size="small" onClick={() => router.push('/admin/settings')}>前往设置中心</Button>}
        />
      ) : null}
      <WebPlatformRuntimeStatus platformCodes={projectPlatforms} />
      <Card title="问题库">
        <Row gutter={[12, 12]} align="middle">
          <Col flex="360px">
            <Select
              value={selectedProjectId}
              loading={projectsLoading}
              placeholder="选择品牌项目"
              style={{ width: '100%' }}
              showSearch
              optionFilterProp="label"
              onChange={handleProjectChange}
              options={projects.map((item) => ({ label: item.name, value: item.id }))}
            />
          </Col>
          <Col flex="140px">
            <Select
              value={days}
              style={{ width: '100%' }}
              options={periodOptions}
              onChange={setDays}
            />
          </Col>
          <Col flex="auto">
            <Space wrap>
              <Button size="small" onClick={() => refreshPromptDataForProject(selectedProjectId)} disabled={!selectedProjectId}>刷新</Button>
              <Tooltip title={!selectedProjectId ? '请先选择品牌项目' : !selectableProjectPlatforms.length ? '当前项目没有已配置且启用的监测平台' : ''}>
                <span>
                  <Button size="small" type="primary" onClick={openCreate} disabled={!selectedProjectId || platformCatalogLoading || !selectableProjectPlatforms.length}>新建问题</Button>
                </span>
              </Tooltip>
              <Tooltip title={!selectedProjectId ? '请先选择品牌项目' : !selectableProjectPlatforms.length ? '当前项目没有已配置且启用的监测平台' : ''}>
                <span>
                  <Button size="small" onClick={openBatchCreate} disabled={!selectedProjectId || platformCatalogLoading || !selectableProjectPlatforms.length}>批量新增</Button>
                </span>
              </Tooltip>
              <Text type="secondary">
                {selectedProject
                  ? `当前项目：${selectedProject.name}｜监测平台：${projectPlatformStatuses.map((item) => item.displayLabel).join('、') || '未配置'}`
                  : '请先在品牌项目中创建项目'}
              </Text>
            </Space>
          </Col>
        </Row>
      </Card>

      <Card
        title="问题集"
        extra={<Button type="primary" disabled={!selectedProjectId} onClick={openCreateQuestionSet}>新建问题集</Button>}
      >
        {selectedProjectId ? (
          <Table
            rowKey="id"
            size="small"
            loading={questionSetsLoading}
            dataSource={questionSets}
            pagination={false}
            locale={{ emptyText: '暂无问题集，可将两个或更多问题组成问题集后一起运行' }}
            columns={[
              {
                title: '名称',
                dataIndex: 'name',
                width: 180,
                render: (value) => <Text strong>{value}</Text>
              },
              {
                title: '说明',
                dataIndex: 'description',
                render: (value) => value || <Text type="secondary">-</Text>
              },
              {
                title: '成员问题',
                key: 'questions',
                width: 360,
                render: (_, questionSet) => {
                  const members = Array.isArray(questionSet.questions) ? questionSet.questions : [];
                  return members.length ? (
                    <Space wrap size={[4, 4]}>
                      {members.slice(0, 3).map((item) => (
                        <Tag key={item.id} color={item.enabled === false ? 'default' : 'blue'}>
                          {String(item.question || '').slice(0, 24)}{String(item.question || '').length > 24 ? '…' : ''}
                        </Tag>
                      ))}
                      {members.length > 3 ? <Text type="secondary">另有 {members.length - 3} 个</Text> : null}
                    </Space>
                  ) : <Text type="secondary">暂无成员</Text>;
                }
              },
              {
                title: '启用情况',
                key: 'counts',
                width: 120,
                render: (_, questionSet) => `${Number(questionSet.enabled_question_count || 0)} / ${Number(questionSet.question_count || 0)}`
              },
              {
                title: '操作',
                key: 'actions',
                width: 230,
                render: (_, questionSet) => (
                  <Space>
                    <Tooltip title={
                      Number(questionSet.enabled_question_count || 0) <= 0
                        ? '问题集中没有启用的问题'
                        : (!selectableProjectPlatforms.length ? '当前项目没有已配置且启用的监测平台' : '')
                    }>
                      <span>
                        <Button
                          size="small"
                          loading={runningQuestionSetId === questionSet.id}
                          disabled={
                            Number(questionSet.enabled_question_count || 0) <= 0
                            || !selectableProjectPlatforms.length
                          }
                          onClick={() => runQuestionSet(questionSet)}
                        >
                          运行问题集
                        </Button>
                      </span>
                    </Tooltip>
                    <Button size="small" type="primary" onClick={() => openEditQuestionSet(questionSet)}>编辑</Button>
                    <Popconfirm
                      title={`删除问题集“${questionSet.name}”？集合内问题会继续保留。`}
                      onConfirm={() => deleteQuestionSet(questionSet)}
                    >
                      <Button size="small" danger>删除问题集</Button>
                    </Popconfirm>
                  </Space>
                )
              }
            ]}
          />
        ) : (
          <Empty description="请先选择品牌项目" />
        )}
      </Card>

      <Card title="问题列表">
        {selectedProjectId ? (
          <Space orientation="vertical" size={12} style={{ width: '100%' }}>
            <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
              <Space wrap>
                <Input.Search
                  allowClear
                  placeholder="搜索问题、标签或平台"
                  style={{ width: 260 }}
                  value={promptSearch}
                  onChange={(event) => setPromptSearch(event.target.value)}
                />
                <Select
                  value={promptPlatformFilter}
                  style={{ width: 130 }}
                  onChange={setPromptPlatformFilter}
                  options={[
                    { label: '全部平台', value: 'all' },
                    ...platformCatalog.map((item) => ({ label: item.name || item.code, value: item.code })),
                  ]}
                />
                <Select
                  value={promptCategoryFilter}
                  style={{ width: 140 }}
                  onChange={setPromptCategoryFilter}
                  options={promptCategoryOptions}
                />
                <Select
                  value={promptStatusFilter}
                  style={{ width: 120 }}
                  onChange={setPromptStatusFilter}
                  options={[
                    { label: '全部状态', value: 'all' },
                    { label: '启用中', value: 'enabled' },
                    { label: '已停用', value: 'disabled' },
                  ]}
                />
                <Text type="secondary">
                  {promptsLoading
                    ? '正在加载问题…'
                    : `显示 ${filteredPrompts.length} / ${prompts.length} 条`}
                </Text>
              </Space>
              <Space wrap>
                <Button type="primary" disabled={selectedPromptIds.length < 2} onClick={openCreateQuestionSet}>
                  将所选组成问题集
                </Button>
                <Popconfirm
                  title={`确认删除选中的 ${selectedPromptIds.length} 个问题？`}
                  disabled={!selectedPromptIds.length}
                  onConfirm={batchDeletePrompts}
                >
                  <Button danger disabled={!selectedPromptIds.length}>批量删除</Button>
                </Popconfirm>
                <Button disabled={!filteredPrompts.length || selectedFilteredCount === filteredPrompts.length} onClick={selectAllPrompts}>全选筛选结果</Button>
                <Button disabled={!selectedPromptIds.length} onClick={() => setSelectedPromptIds([])}>清空选择</Button>
                <Text type="secondary">已选择 {selectedPromptIds.length} 条</Text>
              </Space>
            </Space>
            <Table
              rowKey="id"
              dataSource={filteredPrompts}
              columns={columns}
              loading={promptsLoading}
              size="small"
              pagination={{
                defaultPageSize: 20,
                pageSizeOptions: [10, 20, 50, 100],
                showSizeChanger: true,
                showTotal: (total) => `共 ${total} 条`,
                placement: ['topRight', 'bottomRight'],
              }}
              scroll={{ x: 'max-content' }}
              rowSelection={{
                selectedRowKeys: selectedPromptIds,
                preserveSelectedRowKeys: true,
                onChange: (keys) => setSelectedPromptIds(keys),
              }}
            />
          </Space>
        ) : (
          <Empty description="暂无可用品牌项目" />
        )}
      </Card>

      <Modal
        title={editingPrompt ? '编辑问题' : '新建问题'}
        open={modalOpen}
        onOk={savePrompt}
        onCancel={() => { setModalOpen(false); setEditingPrompt(null); }}
        okText="保存"
        cancelText="取消"
        forceRender
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item name="question" label="问题" rules={[{ required: true, message: '请输入问题' }]}>
            <Input.TextArea rows={4} placeholder="输入需要持续追踪的用户问题" />
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <Select mode="tags" tokenSeparators={[',', '，', ';', '\n']} placeholder="输入标签并回车添加" />
          </Form.Item>
          <Form.Item name="question_set_id" label="所属问题集">
            <Select
              allowClear
              placeholder="可选，单问题无需加入问题集"
              options={questionSets.map((item) => ({ label: item.name, value: item.id }))}
            />
          </Form.Item>
          <Form.Item
            name="platforms"
            label="监测平台"
            extra="只影响单问题独立运行；运行问题集时仍会覆盖项目的全部可用模型。"
            rules={[{ required: true, message: '请至少选择一个监测平台' }]}
          >
            <Select
              mode="multiple"
              placeholder="选择该问题独立运行时使用的平台"
              options={selectableProjectPlatforms.map((item) => ({
                label: platformLabels[item] || item,
                value: item
              }))}
            />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="批量新增问题"
        open={batchModalOpen}
        onOk={saveBatchPrompts}
        onCancel={() => {
          batchRequestRef.current += 1;
          setBatchModalOpen(false);
          setSavingBatch(false);
          batchForm.resetFields();
        }}
        confirmLoading={savingBatch}
        okText={`新增${batchPreview.questions.length ? ` ${batchPreview.questions.length} 个问题` : ''}`}
        cancelText="取消"
        width={720}
        forceRender
        destroyOnHidden
      >
        <Form form={batchForm} layout="vertical">
          <Form.Item
            name="questions_text"
            label="问题内容"
            extra="每行一个，也支持中英文分号；逗号保留。可粘贴带序号列表，单次最多 100 个。"
            rules={[{ required: true, message: '请输入至少一个问题' }]}
          >
            <Input.TextArea
              rows={10}
              placeholder={'例如：\n1. 这个品牌适合家庭用户吗？\n2. 价格高，是否值得买；售后服务怎么样？'}
            />
          </Form.Item>
          <Alert
            type={batchPreview.overflow_count > 0 ? 'error' : 'info'}
            showIcon
            title={batchPreview.overflow_count > 0
              ? `已识别 ${batchPreview.questions.length + batchPreview.overflow_count} 个问题，超出上限 ${batchPreview.overflow_count} 个`
              : `已识别 ${batchPreview.questions.length} 个问题`}
          />
          <Form.Item name="tags" label="统一标签" style={{ marginTop: 16 }}>
            <Select mode="tags" tokenSeparators={[',', '，', ';', '\n']} placeholder="可选，应用到本批次全部问题" />
          </Form.Item>
          <Form.Item name="question_set_id" label="统一加入问题集">
            <Select
              allowClear
              placeholder="可选；问题仍可单独运行"
              options={questionSets.map((item) => ({ label: item.name, value: item.id }))}
            />
          </Form.Item>
          <Form.Item name="enabled" label="新增后启用" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingQuestionSet ? '编辑问题集' : '新建问题集'}
        open={questionSetModalOpen}
        onOk={saveQuestionSet}
        onCancel={() => {
          setQuestionSetModalOpen(false);
          setEditingQuestionSet(null);
          questionSetForm.resetFields();
        }}
        confirmLoading={savingQuestionSet}
        okText="保存"
        cancelText="取消"
        forceRender
        destroyOnHidden
      >
        <Form form={questionSetForm} layout="vertical">
          <Form.Item name="name" label="问题集名称" rules={[{ required: true, message: '请输入问题集名称' }]}>
            <Input maxLength={120} placeholder="例如：购买决策核心问题" />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} placeholder="说明这组问题的监测目标（可选）" />
          </Form.Item>
          <Form.Item
            name="question_ids"
            label="成员问题"
            rules={[
              { required: true, message: '请选择成员问题' },
              { type: 'array', min: 2, message: '问题集至少需要两个问题' }
            ]}
          >
            <Select
              mode="multiple"
              showSearch
              optionFilterProp="label"
              placeholder="选择两个或更多问题"
              options={prompts.map((item) => ({
                label: item.question_set?.name
                  ? `${item.question}（当前：${item.question_set.name}）`
                  : item.question,
                value: item.id
              }))}
            />
          </Form.Item>
          <Text type="secondary">保存后，这些问题可作为一个问题集同时加入运行队列；每个问题仍可单独运行。</Text>
        </Form>
      </Modal>

      <Modal
        title={historyPrompt ? `问题历史：${historyPrompt.question}` : '问题历史'}
        open={historyOpen}
        onCancel={() => { setHistoryOpen(false); setHistoryPrompt(null); setHistoryRows([]); }}
        footer={null}
        width={980}
      >
        <Table
          rowKey="id"
          size="small"
          loading={historyLoading}
          dataSource={historyRows}
          pagination={{ pageSize: 8 }}
          expandable={{
            expandedRowRender: renderHistoryDetail
          }}
          columns={[
            {
              title: '平台',
              dataIndex: 'platform',
              width: 110,
              render: (value, row) => <Tag>{row.platform_name || platformLabels[value] || value}</Tag>
            },
            {
              title: '模型',
              dataIndex: 'model_name',
              width: 150,
              render: (value) => value || '-'
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (value) => {
                const color = value === 'completed' ? 'success' : value === 'failed' ? 'error' : 'processing';
                const label = value === 'completed' ? '完成' : value === 'failed' ? '失败' : '处理中';
                return <Tag color={color}>{label}</Tag>;
              }
            },
            {
              title: '声量占比（SOV）',
              width: 100,
              render: (_, row) => getHistoryAnalysisDisplay(row).sov
            },
            {
              title: '情绪',
              width: 100,
              render: (_, row) => {
                const display = getHistoryAnalysisDisplay(row);
                return <Tag color={display.sentimentColor}>{display.sentimentLabel}</Tag>;
              }
            },
            {
              title: '品牌提及',
              width: 110,
              render: (_, row) => {
                const display = getHistoryAnalysisDisplay(row);
                return <Tag color={display.brandMentionColor}>{display.brandMentionLabel}</Tag>;
              }
            },
            {
              title: '时间',
              dataIndex: 'created_at',
              width: 180,
              render: formatOptionalDateTimeShort
            }
          ]}
        />
      </Modal>
    </Space>
  );
}
