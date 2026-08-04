'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { Button, Layout, Menu, message } from 'antd';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  BookOutlined,
  FileSearchOutlined,
  FundProjectionScreenOutlined,
  GlobalOutlined,
  HomeOutlined,
  LinkOutlined,
  MessageOutlined,
  ProfileOutlined,
  ReadOutlined,
  SearchOutlined,
  ShoppingOutlined,
  UserOutlined
} from '@ant-design/icons';
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import Login from '@/components/Login';
import { MarketingFiltersProvider } from '@/components/marketing/MarketingFiltersContext';
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

const navigationIcons: Record<string, React.ReactNode> = {
  '/market-overview': <HomeOutlined />,
  '/ad-performance': <FundProjectionScreenOutlined />,
  '/keyword-analysis': <SearchOutlined />,
  '/website-traffic': <GlobalOutlined />,
  '/consultations': <MessageOutlined />,
  '/order-results': <ShoppingOutlined />,
  '/project-dashboard': <SearchOutlined />,
  '/sources': <LinkOutlined />,
  '/seo-audit': <FileSearchOutlined />,
  '/prompts': <BookOutlined />,
  '/question-set-reports': <ReadOutlined />,
  '/quick-links': <ProfileOutlined />,
  '/profile': <UserOutlined />
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
  const siderToggleRef = useRef<HTMLButtonElement>(null);

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
          icon: navigationIcons[child.key],
          label: (
            <Link href={child.href}>
              {child.label}
            </Link>
          )
        }))
      };
    }
    return {
      key: item.key,
      icon: navigationIcons[item.key],
      label: <Link href={item.href}>{item.label}</Link>
    };
  }), [navigation]);

  const handleSiderToggle = () => {
    setCollapsed(!collapsed);
  };

  const closeMobileSider = useCallback(() => {
    setCollapsed(true);
    window.requestAnimationFrame(() => siderToggleRef.current?.focus());
  }, []);

  useEffect(() => {
    if (collapsed) return undefined;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && window.innerWidth < 768) {
        closeMobileSider();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [closeMobileSider, collapsed]);

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
    <MarketingFiltersProvider>
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
              ref={siderToggleRef}
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
              onClick={closeMobileSider}
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
                    window.setTimeout(closeMobileSider, 0);
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
    </MarketingFiltersProvider>
  );
}
