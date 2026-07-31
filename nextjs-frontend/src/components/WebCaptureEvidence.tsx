'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Card, Collapse, Descriptions, Image, Space, Spin, Tag, Typography } from 'antd';
import axios from '@/lib/axiosConfig';
import { buildWebCaptureEvidence } from '@/utils/webCaptureEvidence.cjs';

const { Text } = Typography;

type WebCaptureEvidenceProps = {
  record: Record<string, any>;
};

function formatCapturedAt(value: string) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
}

export default function WebCaptureEvidence({ record }: WebCaptureEvidenceProps) {
  const evidence = useMemo(() => buildWebCaptureEvidence(record), [record]);
  const evidenceKey = evidence
    ? evidence.artifacts.map((artifact: any) => artifact.url).join('|')
    : '';
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let failed = false;
    const createdUrls: string[] = [];
    setImageUrls({});
    setLoadError('');
    if (!evidence) {
      setLoading(false);
      return () => {};
    }

    setLoading(true);
    Promise.all(evidence.artifacts.map(async (artifact: any) => {
      const response = await axios.get(artifact.url, { responseType: 'blob' });
      const objectUrl = URL.createObjectURL(response.data);
      if (cancelled || failed) {
        URL.revokeObjectURL(objectUrl);
        return [artifact.kind, ''];
      }
      createdUrls.push(objectUrl);
      return [artifact.kind, objectUrl];
    }))
      .then((entries) => {
        if (!cancelled) setImageUrls(Object.fromEntries(entries));
      })
      .catch(() => {
        failed = true;
        createdUrls.splice(0).forEach((url) => URL.revokeObjectURL(url));
        if (!cancelled) setLoadError('证据图片读取失败，请确认登录状态和记录权限');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [evidence, evidenceKey]); // evidenceKey 只由后端受控的证据读取地址组成

  if (!evidence) return null;
  const isStandardDoubao = evidence.platformName === '豆包 Web'
    && evidence.captureMode === 'standard';
  const captureModeLabel = evidence.captureMode === 'web_search'
    ? '智能搜索'
    : evidence.captureMode || '网页搜索模式';

  const renderSources = (sources: any[], emptyText: string) => (
    sources.length ? (
      <Space orientation="vertical" size={4} style={{ width: '100%' }}>
        {sources.map((source) => (
          <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
            {source.displayIndex ? `【${source.displayIndex}】` : ''}
            {source.title || source.domain || source.url}
          </a>
        ))}
      </Space>
    ) : <Text type="secondary">{emptyText}</Text>
  );

  return (
    <Card size="small" title={`${evidence.platformName} 页面证据`} style={{ marginTop: 12 }}>
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="采集模式">
            {isStandardDoubao
              ? <Tag color="blue">普通模式（不启用深入研究）</Tag>
              : <Tag>{captureModeLabel}</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="联网搜索">
            {evidence.searchObserved === true
              ? <Tag color="success">本次已观察到网页检索</Tag>
              : isStandardDoubao
                ? <Tag color="blue">由豆包普通模式自动决定</Tag>
                : <Tag color="error">未确认</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="采集时间">
            {formatCapturedAt(evidence.capturedAt)}
          </Descriptions.Item>
          <Descriptions.Item label="选择器版本">
            {evidence.selectorVersion || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="实际模型" span={2}>
            {evidence.modelName || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="引用" span={2}>
            {renderSources(evidence.explicitCitations, '页面未显示引用')}
          </Descriptions.Item>
          <Descriptions.Item label="检索候选" span={2}>
            <Collapse
              size="small"
              items={[{
                key: 'retrieval-candidates',
                label: `查看检索候选（${evidence.retrievalCandidates.length}）`,
                children: (
                  <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                    <Text type="secondary">
                      这些页面仅在平台搜索过程中观察到，不代表回答引用，也不计入引用 KPI。
                    </Text>
                    {evidence.candidateObservation ? (
                      <Text type="secondary">
                        观察 {evidence.candidateObservation.observedCount} 条，接纳
                        {' '}{evidence.candidateObservation.acceptedCount} 条，过滤
                        {' '}{evidence.candidateObservation.droppedCount} 条
                        {evidence.candidateObservation.truncated ? '，结果已截断' : ''}。
                      </Text>
                    ) : null}
                    {renderSources(evidence.retrievalCandidates, '未记录检索候选')}
                  </Space>
                ),
              }]}
            />
          </Descriptions.Item>
        </Descriptions>

        {loadError ? <Alert type="error" showIcon title={loadError} /> : null}
        {loading ? (
          <Space size={8}>
            <Spin size="small" />
            <Text type="secondary">正在读取私有证据图片</Text>
          </Space>
        ) : null}
        <Space wrap align="start" size={12}>
          {evidence.artifacts.map((artifact: any) => imageUrls[artifact.kind] ? (
            <Card key={artifact.kind} size="small" title={artifact.label}>
              <Image
                src={imageUrls[artifact.kind]}
                alt={artifact.label}
                width={320}
                style={{ maxWidth: '100%', height: 'auto' }}
              />
            </Card>
          ) : null)}
        </Space>
      </Space>
    </Card>
  );
}
