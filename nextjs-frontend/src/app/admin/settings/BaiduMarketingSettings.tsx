'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Space, Table, Tag } from 'antd';
import axios from '@/lib/axiosConfig';
import { getApiErrorMessage } from '@/utils/apiErrorMessage.cjs';

type Connection = {
  id: string;
  status: 'CONNECTED' | 'REAUTH_REQUIRED' | 'DISCONNECTED';
  principalId: string;
  principalName?: string | null;
  accessTokenExpiresAt?: string | null;
  lastErrorCode?: string | null;
};

type Project = {
  id: string | number;
  name: string;
  status: 'active' | 'archived';
};

type Account = {
  accountId: string;
  accountName: string;
};

type Binding = {
  id: string;
  projectId: string;
  connectionId: string;
  externalAccountId: string;
  externalAccountName: string;
  status: 'ACTIVE' | 'PAUSED';
  pausedReason?: string | null;
};

export default function BaiduMarketingSettings() {
  const [moduleStatus, setModuleStatus] = useState<string>('LOADING');
  const [moduleErrorCode, setModuleErrorCode] = useState<string | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [bindingModalOpen, setBindingModalOpen] = useState(false);
  const [bindingConnectionId, setBindingConnectionId] = useState('');
  const [bindingAccountId, setBindingAccountId] = useState('');
  const [deletingBinding, setDeletingBinding] = useState<Binding | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [disconnecting, setDisconnecting] = useState<Connection | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const statusResponse = await axios.get('/api/marketing/status');
      const nextModuleStatus = statusResponse.data.moduleState;
      setModuleStatus(nextModuleStatus);
      setModuleErrorCode(statusResponse.data.errorCode || null);
      if ([
        'READY',
        'PILOT_READY',
        'PILOT_DATA_READY',
      ].includes(nextModuleStatus)) {
        const connectionsResponse = await axios.get(
          '/api/admin/marketing/baidu/connections'
        );
        setConnections(connectionsResponse.data);
        if (['READY', 'PILOT_DATA_READY'].includes(nextModuleStatus)) {
          const projectsResponse = await axios.get('/api/geo-projects');
          const projectRows = projectsResponse?.data?.data
            || projectsResponse?.data
            || [];
          setProjects(Array.isArray(projectRows) ? projectRows : []);
          setProjectId((current) => (
            projectRows.some(
              (project: Project) => String(project.id) === current
            )
              ? current
              : String(projectRows[0]?.id || '')
          ));
          return;
        }
        setProjects([]);
        setProjectId('');
        setBindings([]);
      } else {
        setConnections([]);
        setProjects([]);
        setProjectId('');
        setBindings([]);
      }
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, '无法读取百度营销连接状态'));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadBindings = useCallback(async (targetProjectId: string) => {
    if (!targetProjectId) {
      setBindings([]);
      return;
    }
    try {
      const response = await axios.get(
        `/api/marketing/projects/${encodeURIComponent(targetProjectId)}/baidu-bindings`
      );
      setBindings(response.data);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, '无法读取项目绑定'));
    }
  }, []);

  useEffect(() => {
    if (['READY', 'PILOT_DATA_READY'].includes(moduleStatus)) {
      loadBindings(projectId);
    }
  }, [loadBindings, moduleStatus, projectId]);

  useEffect(() => {
    if (!bindingModalOpen || !bindingConnectionId) {
      setAccounts([]);
      setBindingAccountId('');
      return;
    }
    let active = true;
    setError('');
    axios.get(
      `/api/admin/marketing/baidu/connections/${encodeURIComponent(bindingConnectionId)}/accounts`
    ).then((response) => {
      if (!active) return;
      const rows = Array.isArray(response.data) ? response.data : [];
      setAccounts(rows);
      setBindingAccountId(rows[0]?.accountId || '');
    }).catch((requestError) => {
      if (!active) return;
      setAccounts([]);
      setBindingAccountId('');
      setError(getApiErrorMessage(requestError, '无法读取百度搜索账户目录'));
    });
    return () => {
      active = false;
    };
  }, [bindingConnectionId, bindingModalOpen]);

  const authorize = async (
    operation: 'CONNECT' | 'REAUTHORIZE',
    targetConnectionId: string | null
  ) => {
    setBusy(true);
    setError('');
    try {
      const response = await axios.post(
        '/api/admin/marketing/baidu/authorization-attempts',
        { operation, targetConnectionId }
      );
      window.location.assign(response.data.launchUrl);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, '无法发起百度授权'));
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!disconnecting) return;
    setBusy(true);
    try {
      await axios.post(
        `/api/admin/marketing/baidu/connections/${disconnecting.id}/disconnect`
      );
      setDisconnecting(null);
      await load();
      window.setTimeout(() => returnFocusRef.current?.focus(), 0);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, '无法断开百度连接'));
    } finally {
      setBusy(false);
    }
  };

  const openBindingModal = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    returnFocusRef.current = event.currentTarget;
    const firstConnection = connections.find(
      (connection) => connection.status === 'CONNECTED'
    );
    setBindingConnectionId(firstConnection?.id || '');
    setBindingAccountId('');
    setBindingModalOpen(true);
  };

  const openAccountDirectory = (
    event: React.MouseEvent<HTMLElement>,
    connectionId: string
  ) => {
    returnFocusRef.current = event.currentTarget;
    setBindingConnectionId(connectionId);
    setBindingAccountId('');
    setBindingModalOpen(true);
  };

  const closeAccountModal = () => {
    setBindingModalOpen(false);
    window.setTimeout(() => returnFocusRef.current?.focus(), 0);
  };

  const createBinding = async () => {
    if (!projectId || !bindingConnectionId || !bindingAccountId) return;
    setBusy(true);
    setError('');
    try {
      await axios.post(
        `/api/marketing/projects/${encodeURIComponent(projectId)}/baidu-bindings`,
        {
          connectionId: bindingConnectionId,
          externalAccountId: bindingAccountId,
        }
      );
      setBindingModalOpen(false);
      await loadBindings(projectId);
      window.setTimeout(() => returnFocusRef.current?.focus(), 0);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, '无法创建项目绑定'));
    } finally {
      setBusy(false);
    }
  };

  const changeBindingState = async (
    binding: Binding,
    action: 'pause' | 'resume'
  ) => {
    setBusy(true);
    setError('');
    try {
      await axios.post(
        `/api/marketing/projects/${encodeURIComponent(projectId)}`
        + `/baidu-bindings/${encodeURIComponent(binding.id)}/${action}`
      );
      await loadBindings(projectId);
    } catch (requestError) {
      setError(getApiErrorMessage(
        requestError,
        action === 'pause' ? '无法暂停项目绑定' : '无法恢复项目绑定'
      ));
    } finally {
      setBusy(false);
    }
  };

  const deleteBinding = async () => {
    if (!deletingBinding) return;
    setBusy(true);
    setError('');
    try {
      await axios.delete(
        `/api/marketing/projects/${encodeURIComponent(projectId)}`
        + `/baidu-bindings/${encodeURIComponent(deletingBinding.id)}`
      );
      setDeletingBinding(null);
      await loadBindings(projectId);
      window.setTimeout(() => returnFocusRef.current?.focus(), 0);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, '无法解除项目绑定'));
    } finally {
      setBusy(false);
    }
  };

  const pilotAuthOnly = moduleStatus === 'PILOT_READY';
  const pilotDataMode = moduleStatus === 'PILOT_DATA_READY';
  if (![
    'READY',
    'PILOT_READY',
    'PILOT_DATA_READY',
  ].includes(moduleStatus)) {
    return (
      <Alert
        type={moduleStatus === 'LOADING' ? 'info' : 'warning'}
        showIcon
        title={moduleStatus === 'LOADING' ? '正在检查营销模块' : '百度营销尚未开放'}
        description={
          moduleErrorCode === 'MARKETING_CONTRACT_NOT_VERIFIED'
            ? '真实搜索推广契约尚待获批应用和测试账户核验；当前不会向百度发起请求。'
            : '完成配置、迁移和生产门禁后，可在这里管理只读连接。'
        }
        action={<Button onClick={load}>重新检查</Button>}
      />
    );
  }

  return (
    <section aria-labelledby="baidu-marketing-settings-title">
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <div>
          <h2 id="baidu-marketing-settings-title">百度搜索推广连接</h2>
          <p>只读取账户、推广计划、展现、点击和消费，不修改投放。</p>
        </div>
        {pilotAuthOnly ? (
          <Alert
            type="info"
            showIcon
            title="受限试点模式"
            description="当前只可验证百度授权、Token 和账户目录；项目绑定、报表刷新和调度尚未开放。"
          />
        ) : null}
        {pilotDataMode ? (
          <Alert
            type="warning"
            showIcon
            title="真实数据试点模式"
            description="当前只对项目白名单开放搜索账户绑定和最近 30 天只读报表；正式导航、币种与时区口径仍在验收。"
            action={<Button href="/geo/marketing">打开营销监控</Button>}
          />
        ) : null}
        {error ? <Alert type="error" showIcon title={error} role="alert" /> : null}
        <Space wrap>
          <Button
            type="primary"
            loading={busy}
            onClick={() => authorize('CONNECT', null)}
          >
            连接百度搜索推广
          </Button>
          <Button onClick={load}>刷新连接列表</Button>
        </Space>
        <Table
          rowKey="id"
          dataSource={connections}
          pagination={false}
          locale={{ emptyText: '尚未建立百度搜索推广连接' }}
          scroll={{ x: 760 }}
          columns={[
            {
              title: '授权主体',
              key: 'principal',
              render: (_, row) => (
                <span>
                  {row.principalName || '未命名主体'}
                  <br />
                  <code>{row.principalId}</code>
                </span>
              ),
            },
            {
              title: '状态',
              dataIndex: 'status',
              render: (status) => (
                <Tag color={status === 'CONNECTED' ? 'green' : 'orange'}>
                  {status === 'CONNECTED' ? '已连接' : status === 'DISCONNECTED' ? '已断开' : '需重新授权'}
                </Tag>
              ),
            },
            {
              title: '操作',
              key: 'actions',
              render: (_, row) => (
                <Space wrap>
                  <Button
                    onClick={(event) => openAccountDirectory(event, row.id)}
                    disabled={row.status !== 'CONNECTED'}
                  >
                    检查账户目录
                  </Button>
                  <Button
                    onClick={() => authorize('REAUTHORIZE', row.id)}
                    disabled={row.status === 'DISCONNECTED'}
                  >
                    重新授权
                  </Button>
                  <Button
                    danger
                    onClick={(event) => {
                      returnFocusRef.current = event.currentTarget;
                      setDisconnecting(row);
                    }}
                    disabled={row.status === 'DISCONNECTED'}
                  >
                    断开
                  </Button>
                </Space>
              ),
            },
          ]}
        />
        {!pilotAuthOnly ? (
          <>
        <div>
          <h2 id="baidu-marketing-bindings-title">项目账户绑定</h2>
          <p>
            一个绑定覆盖整个百度搜索账户；暂停或解除绑定不会修改百度来源数据。
          </p>
        </div>
        <Space wrap align="end">
          <label>
            监控项目
            <br />
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              disabled={!projects.length || busy}
            >
              {projects.map((project) => (
                <option key={project.id} value={String(project.id)}>
                  {project.name}
                  {project.status === 'archived' ? '（已归档）' : ''}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="primary"
            onClick={openBindingModal}
            disabled={
              busy
              || !projectId
              || projects.find(
                (project) => String(project.id) === projectId
              )?.status !== 'active'
              || !connections.some(
                (connection) => connection.status === 'CONNECTED'
              )
            }
          >
            绑定搜索账户
          </Button>
          <Button
            onClick={() => loadBindings(projectId)}
            disabled={!projectId || busy}
          >
            刷新绑定列表
          </Button>
        </Space>
        <Table
          aria-labelledby="baidu-marketing-bindings-title"
          rowKey="id"
          dataSource={bindings}
          pagination={false}
          locale={{ emptyText: projectId ? '当前项目尚未绑定搜索账户' : '暂无监控项目' }}
          scroll={{ x: 840 }}
          columns={[
            {
              title: '搜索账户',
              key: 'account',
              render: (_, row) => (
                <span>
                  {row.externalAccountName}
                  <br />
                  <code>{row.externalAccountId}</code>
                </span>
              ),
            },
            {
              title: '状态',
              dataIndex: 'status',
              render: (status, row) => (
                <span>
                  <Tag color={status === 'ACTIVE' ? 'green' : 'orange'}>
                    {status === 'ACTIVE' ? '活动' : '已暂停'}
                  </Tag>
                  {row.pausedReason ? ` ${row.pausedReason}` : ''}
                </span>
              ),
            },
            {
              title: '操作',
              key: 'actions',
              render: (_, row) => (
                <Space wrap>
                  <Button
                    onClick={() => changeBindingState(
                      row,
                      row.status === 'ACTIVE' ? 'pause' : 'resume'
                    )}
                    disabled={busy}
                  >
                    {row.status === 'ACTIVE' ? '暂停' : '恢复'}
                  </Button>
                  <Button
                    danger
                    onClick={(event) => {
                      returnFocusRef.current = event.currentTarget;
                      setDeletingBinding(row);
                    }}
                    disabled={busy}
                  >
                    解除绑定
                  </Button>
                </Space>
              ),
            },
          ]}
        />
          </>
        ) : null}
      </Space>
      <Modal
        title="断开百度搜索推广连接？"
        open={Boolean(disconnecting)}
        onOk={disconnect}
        onCancel={() => {
          setDisconnecting(null);
          window.setTimeout(() => returnFocusRef.current?.focus(), 0);
        }}
        okText="断开并暂停相关绑定"
        cancelText="保留连接"
        confirmLoading={busy}
        destroyOnHidden
      >
        <p>
          本站会立即清除 Token 并暂停相关项目绑定。百度侧撤权能力尚未核验时，
          还需由管理员在百度控制台确认撤权。
        </p>
      </Modal>
      <Modal
        title={pilotAuthOnly ? '检查百度搜索账户目录' : '绑定百度搜索账户'}
        open={bindingModalOpen}
        onOk={pilotAuthOnly
          ? closeAccountModal
          : createBinding}
        onCancel={closeAccountModal}
        okText={pilotAuthOnly ? '关闭' : '确认绑定'}
        cancelText="取消"
        okButtonProps={{
          disabled: pilotAuthOnly
            ? false
            : !bindingConnectionId || !bindingAccountId,
        }}
        confirmLoading={busy}
        destroyOnHidden
      >
        <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          <label>
            百度连接
            <br />
            <select
              value={bindingConnectionId}
              onChange={(event) => setBindingConnectionId(event.target.value)}
              disabled={busy}
            >
              {connections
                .filter((connection) => connection.status === 'CONNECTED')
                .map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.principalName || connection.principalId}
                  </option>
                ))}
            </select>
          </label>
          {pilotAuthOnly ? (
            <p>这里仅检查当前授权可见的搜索账户，不会创建项目绑定。</p>
          ) : null}
          <label>
            搜索推广账户
            <br />
            <select
              value={bindingAccountId}
              onChange={(event) => setBindingAccountId(event.target.value)}
              disabled={busy || !accounts.length}
            >
              {accounts.map((account) => (
                <option key={account.accountId} value={account.accountId}>
                  {account.accountName}（{account.accountId}）
                </option>
              ))}
            </select>
          </label>
          {!accounts.length ? (
            <Alert
              type="info"
              showIcon
              title={pilotAuthOnly
                ? '当前连接没有可见的只读搜索账户'
                : '当前连接没有可绑定的只读搜索账户'}
            />
          ) : null}
        </Space>
      </Modal>
      <Modal
        title="解除百度搜索账户绑定？"
        open={Boolean(deletingBinding)}
        onOk={deleteBinding}
        onCancel={() => {
          setDeletingBinding(null);
          window.setTimeout(() => returnFocusRef.current?.focus(), 0);
        }}
        okText="解除绑定"
        cancelText="保留绑定"
        okButtonProps={{ danger: true }}
        confirmLoading={busy}
        destroyOnHidden
      >
        <p>
          解除绑定不会修改百度来源数据。项目当前活动快照会因绑定口径变化而失效，
          直到新口径首次完整刷新成功。
        </p>
      </Modal>
    </section>
  );
}
