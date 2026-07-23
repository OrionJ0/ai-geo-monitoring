'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Card, Row, Col, Statistic, message, Empty, Spin } from 'antd';
import axios from '@/lib/axiosConfig';

const PlatformPieChart = dynamic(() => import('./PlatformPieChart'), {
  ssr: false,
  loading: () => <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>,
});
const TrendLineChart = dynamic(() => import('./TrendLineChart'), {
  ssr: false,
  loading: () => <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>,
});

export default function AdminDashboardPage() {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({
    total_users: 0,
    today_detections: 0,
    total_detections: 0,
    yesterday_detections: 0,
    today_completed: 0,
    today_failed: 0,
    today_success_rate: 0,
    platform_distribution_today: [],
    trend_7d: []
  });

  const fetchOverview = async () => {
    try {
      setLoading(true);
      const res = await axios.get('/api/statistics/overview');
      if (res.data?.success) {
        setStats(res.data.data || {});
      } else {
        message.error(res.data?.message || '获取统计失败');
      }
    } catch (e: any) {
      if (e?.response?.status === 401) {
        message.error('未授权：令牌缺失或无效');
      } else if (e?.response?.status === 403) {
        message.error('禁止访问：需要管理员权限');
      } else {
        message.error('获取统计失败');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, []);

  return (
    <>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} md={8}>
          <Card loading={loading}>
            <Statistic title="用户总数" value={stats.total_users || 0} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Card loading={loading}>
            <Statistic title="今日所有用户检测次数" value={stats.today_detections || 0} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Card loading={loading}>
            <Statistic title="累计所有检测次数" value={stats.total_detections || 0} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} md={8}>
          <Card loading={loading}>
            <Statistic title="昨日所有用户检测次数" value={stats.yesterday_detections || 0} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Card loading={loading}>
            <Statistic title="今日成功检测次数" value={stats.today_completed || 0} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Card loading={loading}>
            <Statistic title="今日失败检测次数" value={stats.today_failed || 0} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card loading={loading} title="今日平台分布">
            {(stats.platform_distribution_today || []).length > 0 ? (
              <PlatformPieChart data={stats.platform_distribution_today} />
            ) : (
              <Empty description="暂无数据" />
            )}
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card loading={loading} title="近7天检测趋势">
            {(stats.trend_7d || []).length > 0 ? (
              <TrendLineChart data={stats.trend_7d} />
            ) : (
              <Empty description="暂无数据" />
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24}>
          <Card loading={loading}>
            <Statistic title="今日成功率" value={stats.today_success_rate || 0} suffix="%" precision={2} />
          </Card>
        </Col>
      </Row>
    </>
  );
}
