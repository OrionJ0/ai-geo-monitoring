'use client';

import React, { useState, useEffect } from 'react';
import { Layout, Button, Menu, message } from 'antd';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import Login from '@/components/Login';
import { setAuthToken, clearAuth } from '@/lib/axiosConfig';

const { Header, Sider, Content } = Layout;

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [token, setToken] = useState('');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // 从 localStorage 读取用户信息
  useEffect(() => {
    const storedToken = localStorage.getItem('agd_token') || '';
    const storedUser = localStorage.getItem('agd_user');
    setToken(storedToken);
    if (storedUser) {
      try {
        const user = JSON.parse(storedUser);
        setCurrentUser(user);
      } catch {
        setCurrentUser(null);
      }
    }

    setLoading(false);
  }, []);

  const handleLogin = ({ token: tk, user }: { token: string; user: any }) => {
    setToken(tk);
    setCurrentUser(user);
    localStorage.setItem('agd_token', tk);
    localStorage.setItem('agd_user', JSON.stringify(user || null));
    if (user?.id) localStorage.setItem('agd_user_id', String(user.id));
    setAuthToken(tk);
  };

  const handleLogout = () => {
    setToken('');
    setCurrentUser(null);
    clearAuth();
    message.success('已退出登录');
  };

  // 获取当前选中的菜单项
  const pathname = usePathname();

  // 使用 <Link> 替代 router.push()，让 Next.js 在菜单可见时就预编译目标路由
  const menuItems = [
    { key: 'dashboard', label: <Link href="/admin">数据仪表</Link> },
    { key: 'history', label: <Link href="/admin/history">历史记录</Link> },
    { key: 'users', label: <Link href="/admin/users">用户管理</Link> },
    { key: 'memberships', label: <Link href="/admin/memberships">会员设置</Link> },
    { key: 'settings', label: <Link href="/admin/settings">设置中心</Link> },
    { key: 'notice', label: <Link href="/admin/notice">通知管理</Link> },
    { key: 'health', label: <Link href="/admin/health">系统健康</Link> },
  ];

  let selectedKey = 'dashboard';

  if (pathname.startsWith('/admin/')) {
    const pathWithoutPrefix = pathname.replace('/admin/', '');
    const firstSegment = pathWithoutPrefix.split('/')[0];
    if (firstSegment && menuItems.some(item => item.key === firstSegment)) {
      selectedKey = firstSegment;
    }
  } else if (pathname === '/admin') {
    selectedKey = 'dashboard';
  }

  // 加载中
  if (loading) {
    return <div style={{ textAlign: 'center', padding: '100px 0' }}>加载中...</div>;
  }

  // 未登录时显示登录页面
  if (!token || !currentUser) {
    return <Login onLogin={handleLogin} />;
  }

  // 验证管理员权限
  if (currentUser.role !== 'admin') {
    message.error('无权访问管理员后台');
    router.push('/');
    return null;
  }

  return (
    <Layout className="layout">
      <Header className="app-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="logo" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button
            type="text"
            aria-label={collapsed ? '展开侧栏' : '折叠侧栏'}
            icon={collapsed ? <MenuUnfoldOutlined style={{ color: '#fff' }} /> : <MenuFoldOutlined style={{ color: '#fff' }} />}
            onClick={() => setCollapsed(!collapsed)}
          />
          <span>管理员后台</span>
        </div>
        <Button onClick={handleLogout}>退出登录</Button>
      </Header>
      <Layout style={{ marginTop: 64 }}>
        <Sider
          width={200}
          collapsedWidth={0}
          theme="light"
          collapsible
          collapsed={collapsed}
          onCollapse={(val) => setCollapsed(val)}
          trigger={null}
          style={{ background: '#fff' }}
        >
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            style={{ height: '100%', borderRight: 0 }}
            items={menuItems}
          />
        </Sider>
        <Content style={{ padding: 24 }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
