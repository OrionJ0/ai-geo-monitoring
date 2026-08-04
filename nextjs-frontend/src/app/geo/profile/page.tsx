// @ts-nocheck
'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Card, Descriptions, Space, Button, Tag, message } from 'antd';
import axios from 'axios';
import { getApiErrorMessage } from '@/utils/apiErrorMessage.cjs';
import WorkspacePageHeader from '@/components/WorkspacePageHeader';

const levelColors = {
  free: 'default',
  basic: 'blue',
  pro: 'gold',
  enterprise: 'purple'
};

export default function GeoProfilePage() {
  const userId = Number(typeof window !== 'undefined' ? localStorage.getItem('agd_user_id') || 0 : 0);

  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState(null);

  const formatDateTimeShort = (v) => {
    try {
      const d = new Date(v);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${y}-${m}-${dd} ${hh}:${mm}`;
    } catch {
      return String(v || '—');
    }
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const pRes = await axios.get(`/api/users/profile/${userId}`);
      setProfile(pRes?.data?.data || null);
    } catch (error) {
      message.error(getApiErrorMessage(error, '获取个人信息失败'));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const level = profile?.membership_level || 'free';
  const expiresAt = profile?.membership_expires_at || null;

  const levelLabelMap = { free: '免费', basic: '基础', pro: '专业', enterprise: '企业' };
  const levelLabel = levelLabelMap[String(level).toLowerCase()] || level;

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <WorkspacePageHeader
        title="个人中心"
        actions={<Button onClick={fetchAll} loading={loading}>刷新</Button>}
      />
      <Card
        title="个人信息"
        loading={loading}
      >
        <Descriptions column={1} size="small" styles={{ label: { width: 120 } }}>
          <Descriptions.Item label="用户ID">{profile?.user_id ?? userId}</Descriptions.Item>
          <Descriptions.Item label="昵称">{profile?.nickname || profile?.username || '—'}</Descriptions.Item>
          <Descriptions.Item label="邮箱">{profile?.email || '—'}</Descriptions.Item>
          <Descriptions.Item label="角色">{profile?.role || '—'}</Descriptions.Item>
          <Descriptions.Item label="会员等级">
            <Tag color={levelColors[String(level).toLowerCase()] || 'default'}>{levelLabel}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="会员时长">
            {String(level).toLowerCase() === 'free'
              ? (<Tag>长期有效</Tag>)
              : (expiresAt ? `${formatDateTimeShort(expiresAt)}` : '—')}
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </Space>
  );
}
