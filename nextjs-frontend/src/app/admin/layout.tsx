'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Layout, Button, Menu, message } from 'antd';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import Login from '@/components/Login';
import { setAuthToken, clearAuth } from '@/lib/axiosConfig';
import {
  buildAdminNavigation,
  resolveAdminLocation
} from '@/utils/adminNavigation.cjs';

const { Header, Sider, Content } = Layout;

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

  const pathname = usePathname();
  const navigation = useMemo(
    () => buildAdminNavigation(),
    []
  ) as Array<NavigationPage | NavigationGroup>;
  const location = useMemo(
    () => resolveAdminLocation(pathname),
    [pathname]
  );
  const [openKeys, setOpenKeys] = useState<string[]>(
    location.activeGroupKey ? [location.activeGroupKey] : []
  );
  const menuItems = useMemo(() => navigation.map((item) => {
    if (item.type === 'group') {
      return {
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

  useEffect(() => {
    if (location.activeGroupKey) {
      setOpenKeys((current) => (
        current.includes(location.activeGroupKey)
          ? current
          : [...current, location.activeGroupKey]
      ));
    }
  }, [location.activeGroupKey]);

  const handleOpenChange = (keys: string[]) => {
    setOpenKeys(keys);
  };

  const handleSiderToggle = () => {
    if (collapsed && location.activeGroupKey) {
      setOpenKeys((current) => (
        current.includes(location.activeGroupKey)
          ? current
          : [...current, location.activeGroupKey]
      ));
    }
    setCollapsed(!collapsed);
  };

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
            aria-expanded={!collapsed}
            icon={collapsed ? <MenuUnfoldOutlined style={{ color: '#fff' }} /> : <MenuFoldOutlined style={{ color: '#fff' }} />}
            onClick={handleSiderToggle}
          />
          <span>管理员后台</span>
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
          className="geo-sider admin-sider"
          width={224}
          collapsedWidth={0}
          breakpoint="md"
          theme="light"
          collapsible
          collapsed={collapsed}
          onBreakpoint={setCollapsed}
          onCollapse={(val) => setCollapsed(val)}
          trigger={null}
          style={{ background: '#fff' }}
        >
          <nav aria-label="管理员后台主导航">
            <Menu
              className="workspace-navigation"
              mode="inline"
              selectedKeys={[location.selectedKey]}
              openKeys={openKeys}
              onOpenChange={handleOpenChange}
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
