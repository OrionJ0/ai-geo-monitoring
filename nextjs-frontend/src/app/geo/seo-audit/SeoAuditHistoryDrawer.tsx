// @ts-nocheck
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Drawer, Empty, Pagination, Spin, message } from 'antd';
import { ArrowRightOutlined, HistoryOutlined, ReloadOutlined } from '@ant-design/icons';
import axios from '@/lib/axiosConfig';
import { getApiErrorMessage } from '@/utils/apiErrorMessage.cjs';
import styles from './seo-audit.module.css';

function formatHistoryDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function displayHost(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return value || '未知页面';
  }
}

function historyScoreColor(score) {
  if (score >= 80) return '#15803d';
  if (score >= 60) return '#d97706';
  return '#dc2626';
}

export default function SeoAuditHistoryDrawer({
  open,
  onClose,
  onOpenReport,
  currentAuditId,
  refreshKey,
}) {
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10, totalItems: 0, totalPages: 0 });
  const [loading, setLoading] = useState(false);
  const [detailLoadingId, setDetailLoadingId] = useState(null);
  const requestRef = useRef(0);

  const loadHistory = useCallback(async (nextPage) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    try {
      const response = await axios.get('/api/seo-audits', { params: { page: nextPage, pageSize: 10 } });
      if (requestRef.current !== requestId) return;
      const data = response?.data?.data || {};
      setItems(Array.isArray(data.items) ? data.items : []);
      setPagination(data.pagination || { page: nextPage, pageSize: 10, totalItems: 0, totalPages: 0 });
    } catch (error) {
      if (requestRef.current === requestId) {
        message.error(getApiErrorMessage(error, '读取 SEO 检测历史失败'));
      }
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    loadHistory(1);
  }, [loadHistory, open, refreshKey]);

  const openReport = async (auditId) => {
    setDetailLoadingId(auditId);
    try {
      const response = await axios.get(`/api/seo-audits/${auditId}`);
      onOpenReport(response?.data?.data || null);
      onClose();
    } catch (error) {
      message.error(getApiErrorMessage(error, '读取 SEO 检测报告失败'));
    } finally {
      setDetailLoadingId(null);
    }
  };

  return (
    <Drawer
      title={(
        <div className={styles.historyTitle}>
          <span><HistoryOutlined /> 历史报告</span>
          <small>每次成功检测都会保存到当前账户</small>
        </div>
      )}
      open={open}
      onClose={onClose}
      size={520}
      className={styles.historyDrawer}
      extra={(
        <Button
          type="text"
          aria-label="刷新历史报告"
          icon={<ReloadOutlined />}
          onClick={() => loadHistory(pagination.page || 1)}
          loading={loading}
        />
      )}
    >
      {loading && items.length === 0 ? (
        <div className={styles.historyLoading}><Spin /><span>正在读取历史报告</span></div>
      ) : items.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="还没有历史报告，完成一次检测后会出现在这里。"
        />
      ) : (
        <div className={styles.historyList}>
          {items.map((item) => (
            <article
              key={item.id}
              className={`${styles.historyItem} ${item.id === currentAuditId ? styles.historyItemActive : ''}`}
              aria-current={item.id === currentAuditId ? 'true' : undefined}
            >
              <header>
                <div>
                  <span className={styles.historySequence}>
                    {item.summary?.mode === 'site' ? '全站' : '单页'} · 报告 #{item.id}
                    {item.summary?.source === 'imported' ? ' · 导入' : ''}
                  </span>
                  <h3>{displayHost(item.finalUrl)}</h3>
                </div>
                <strong style={{ color: historyScoreColor(item.score) }}>{item.score}</strong>
              </header>
              <p title={item.finalUrl}>{item.finalUrl}</p>
              <footer>
                <div>
                  <span>{formatHistoryDate(item.checkedAt)}</span>
                  <span>
                    {item.summary?.issues || 0} 个问题 · {item.summary?.pages || 1} 页
                    {item.summary?.truncated ? ' · 已截断' : ''}
                  </span>
                </div>
                <Button
                  type="link"
                  onClick={() => openReport(item.id)}
                  loading={detailLoadingId === item.id}
                >
                  查看报告 <ArrowRightOutlined />
                </Button>
              </footer>
            </article>
          ))}
        </div>
      )}

      {pagination.totalItems > pagination.pageSize && (
        <div className={styles.historyPagination}>
          <Pagination
            current={pagination.page}
            pageSize={pagination.pageSize}
            total={pagination.totalItems}
            showSizeChanger={false}
            size="small"
            onChange={loadHistory}
          />
        </div>
      )}
    </Drawer>
  );
}
