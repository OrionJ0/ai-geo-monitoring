'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Layout, Menu, message } from 'antd';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import Login from '@/components/Login';
import { clearAuth, setAuthToken } from '@/lib/axiosConfig';
import {
  buildGeoNavigation,
  resolveGeoLocation
} from '@/utils/geoNavigation.cjs';

const { Header, Content, Sider } = Layout;

type WorkspaceUser = {
  id?: string | number;
  role?: string;
};

type NavigationPage = {
  type: 'item';
  key: string;
  label: string;
  href: string;
};

type NavigationGroup = {
  type: 'group';
  key: string;
  label: string;
  children: NavigationPage[];
};

export default function GeoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedToken = localStorage.getItem('agd_token') || '';
    setToken(storedToken);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (pathname.startsWith('/geo')) {
      document.title = '广拓数据工作台';
    }
  }, [pathname]);

  const navigation = useMemo(
    () => buildGeoNavigation(),
    []
  ) as Array<NavigationPage | NavigationGroup>;
  const location = useMemo(
    () => resolveGeoLocation(pathname),
    [pathname]
  );
  const menuItems = useMemo(() => navigation.map((item) => {
    if (item.type === 'group') {
      return {
        type: 'group' as const,
        key: item.key,
        label: item.label,
        children: item.children.map((child) => ({
          key: child.key,
          label: <Link href={child.href}>{child.label}</Link>
        }))
      };
    }
    return {
      key: item.key,
      label: <Link href={item.href}>{item.label}</Link>
    };
  }), [navigation]);

  const handleSiderToggle = () => {
    setCollapsed(!collapsed);
  };

  const handleLogin = ({
    token: nextToken,
    user
  }: {
    token: string;
    user: WorkspaceUser;
  }) => {
    setToken(nextToken);
    localStorage.setItem('agd_token', nextToken);
    localStorage.setItem('agd_user', JSON.stringify(user || null));
    if (user?.id) localStorage.setItem('agd_user_id', String(user.id));
    setAuthToken(nextToken);
  };

  const handleLogout = () => {
    setToken('');
    clearAuth();
    message.success('已退出登录');
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '100px 0' }}>加载中...</div>;
  }
  if (!token) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <Layout className="layout">
      <Header
        className="app-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <div className="logo" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button
            type="text"
            aria-label={collapsed ? '展开侧栏' : '折叠侧栏'}
            aria-expanded={!collapsed}
            icon={collapsed
              ? <MenuUnfoldOutlined style={{ color: '#fff' }} />
              : <MenuFoldOutlined style={{ color: '#fff' }} />}
            onClick={handleSiderToggle}
          />
          <span>广拓数据工作台</span>
        </div>
        <Button onClick={handleLogout}>退出登录</Button>
      </Header>
      <Layout className="workspace-shell">
        {!collapsed ? (
          <button
            type="button"
            className="geo-sider-backdrop"
            aria-label="关闭侧栏"
            onClick={() => setCollapsed(true)}
          />
        ) : null}
        <Sider
          className="geo-sider"
          width={224}
          collapsedWidth={0}
          breakpoint="md"
          theme="light"
          collapsible
          collapsed={collapsed}
          onBreakpoint={setCollapsed}
          onCollapse={setCollapsed}
          trigger={null}
          style={{ background: '#fff' }}
        >
          <nav aria-label="工作台主导航">
            <Menu
              className="workspace-navigation"
              mode="inline"
              selectedKeys={location.selectedKey ? [location.selectedKey] : []}
              style={{ minHeight: '100%', borderRight: 0 }}
              items={menuItems}
              onClick={() => {
                if (window.innerWidth < 768) {
                  window.setTimeout(() => setCollapsed(true), 0);
                }
              }}
            />
          </nav>
        </Sider>
        <Content className="geo-content" style={{ padding: 24 }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
