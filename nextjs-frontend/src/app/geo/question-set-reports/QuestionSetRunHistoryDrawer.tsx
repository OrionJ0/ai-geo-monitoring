'use client';

import React from 'react';
import {
  Button,
  Drawer,
  Empty,
  Pagination,
  Select,
  Spin,
  Tag,
  Typography,
} from 'antd';
import {
  ArrowRightOutlined,
  HistoryOutlined,
  LoadingOutlined,
  PauseCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import styles from './question-set-reports.module.css';

const { Text } = Typography;

export type QuestionSetRunHistoryItem = {
  id: number;
  question_set_name: string;
  source: 'native' | 'imported';
  status: 'running' | 'completed' | 'partial' | 'failed' | 'paused';
  started_at?: string;
  created_at?: string;
  summary?: {
    total?: number;
    completed?: number;
    failed?: number;
  };
};

export type QuestionSetOption = {
  id: number;
  name: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  items: QuestionSetRunHistoryItem[];
  loading: boolean;
  currentRunId?: number;
  page: number;
  pageSize: number;
  total: number;
  questionSets: QuestionSetOption[];
  selectedQuestionSetId?: number;
  onQuestionSetChange: (questionSetId?: number) => void;
  onPageChange: (page: number) => void;
  onRefresh: () => void;
  onOpenReport: (runId: number) => void;
};

const statusMeta = {
  running: { label: '运行中', color: 'processing' },
  paused: { label: '已暂停', color: 'warning' },
  completed: { label: '已完成', color: 'success' },
  partial: { label: '部分完成', color: 'warning' },
  failed: { label: '失败', color: 'error' },
} as const;

function formatDate(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', { hour12: false });
}

export default function QuestionSetRunHistoryDrawer({
  open,
  onClose,
  items,
  loading,
  currentRunId,
  page,
  pageSize,
  total,
  questionSets,
  selectedQuestionSetId,
  onQuestionSetChange,
  onPageChange,
  onRefresh,
  onOpenReport,
}: Props) {
  return (
    <Drawer
      title={(
        <div className={styles.drawerTitle}>
          <span><HistoryOutlined /> 历史报告</span>
          <small>每次问题或问题集运行都会单独成档</small>
        </div>
      )}
      open={open}
      onClose={onClose}
      placement="right"
      size={560}
      className={styles.historyDrawer}
      extra={(
        <Button
          type="text"
          aria-label="刷新运行历史报告"
          icon={<ReloadOutlined />}
          onClick={onRefresh}
          loading={loading}
        />
      )}
    >
      <div className={styles.historyFilter}>
        <div>
          <Text strong>按问题集查看</Text>
          <Text type="secondary">选择一个问题集，只看它的历次运行</Text>
        </div>
        <Select
          aria-label="按问题集筛选历史报告"
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="全部问题集"
          value={selectedQuestionSetId}
          options={questionSets.map((item) => ({ value: item.id, label: item.name }))}
          onChange={(value) => onQuestionSetChange(value)}
        />
        <Text type="secondary">共 {total} 份报告</Text>
      </div>

      {loading && items.length === 0 ? (
        <div className={styles.drawerLoading}>
          <Spin />
          <span>正在读取历史报告</span>
        </div>
      ) : items.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={selectedQuestionSetId ? '这个问题集还没有历史报告' : '还没有运行历史报告'}
        />
      ) : (
        <div className={styles.drawerHistoryList} aria-busy={loading}>
          {items.map((item) => {
            const status = statusMeta[item.status] || statusMeta.running;
            const active = item.id === currentRunId;
            return (
              <article
                key={item.id}
                className={`${styles.drawerHistoryItem} ${active ? styles.drawerHistoryItemActive : ''}`}
                aria-current={active ? 'true' : undefined}
              >
                <header>
                  <div>
                    <Text className={styles.historySequence}>
                      {item.source === 'imported' ? '导入报告' : `运行 #${item.id}`}
                    </Text>
                    <h3>{item.question_set_name}</h3>
                  </div>
                  <Tag
                    color={status.color}
                    icon={
                      item.status === 'running'
                        ? <LoadingOutlined spin />
                        : item.status === 'paused'
                          ? <PauseCircleOutlined />
                          : undefined
                    }
                  >
                    {status.label}
                  </Tag>
                </header>
                <footer>
                  <div>
                    <span>{formatDate(item.started_at || item.created_at)}</span>
                    <span>
                      {item.summary?.total || 0} 项 · 完成 {item.summary?.completed || 0}
                      {item.summary?.failed ? ` · 失败 ${item.summary.failed}` : ''}
                    </span>
                  </div>
                  <Button type="link" onClick={() => onOpenReport(item.id)}>
                    查看报告 <ArrowRightOutlined />
                  </Button>
                </footer>
              </article>
            );
          })}
        </div>
      )}

      {total > pageSize ? (
        <div className={styles.drawerPagination}>
          <Pagination
            current={page}
            pageSize={pageSize}
            total={total}
            showSizeChanger={false}
            size="small"
            onChange={onPageChange}
          />
        </div>
      ) : null}
    </Drawer>
  );
}
