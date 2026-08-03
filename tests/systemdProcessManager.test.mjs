import assert from 'node:assert/strict';
import test from 'node:test';

import { createSystemdProcessManager } from '../scripts/systemdProcessManager.mjs';

test('reports both production services from systemd unit state', async () => {
  const states = {
    'ai-geo-backend.service': [
      'LoadState=loaded',
      'ActiveState=active',
      'SubState=running',
      'MainPID=4101',
      'User=ubuntu',
      '',
    ].join('\n'),
    'ai-geo-frontend.service': [
      'LoadState=loaded',
      'ActiveState=active',
      'SubState=running',
      'MainPID=4102',
      'User=ubuntu',
      '',
    ].join('\n'),
  };
  const calls = [];
  const manager = createSystemdProcessManager({
    runSystemctl: async (args) => {
      calls.push(args);
      return { stdout: states[args[1]] };
    },
  });

  const status = await manager.status();

  assert.deepEqual(calls, [
    [
      'show',
      'ai-geo-backend.service',
      '--no-pager',
      '--property=LoadState,ActiveState,SubState,MainPID,User',
    ],
    [
      'show',
      'ai-geo-frontend.service',
      '--no-pager',
      '--property=LoadState,ActiveState,SubState,MainPID,User',
    ],
  ]);
  assert.deepEqual(status, {
    backend: {
      running: true,
      pid: 4101,
      verified: true,
      unit: 'ai-geo-backend.service',
      loadState: 'loaded',
      activeState: 'active',
      subState: 'running',
      user: 'ubuntu',
    },
    frontend: {
      running: true,
      pid: 4102,
      verified: true,
      unit: 'ai-geo-frontend.service',
      loadState: 'loaded',
      activeState: 'active',
      subState: 'running',
      user: 'ubuntu',
    },
  });
});

test('starts backend before frontend and waits for public-path readiness', async () => {
  const unitState = {
    'ai-geo-backend.service': 'inactive',
    'ai-geo-frontend.service': 'inactive',
  };
  const calls = [];
  const readinessChecks = [];
  let revisionVerified = false;
  const manager = createSystemdProcessManager({
    runSystemctl: async (args, options = {}) => {
      calls.push({ args, privileged: options.privileged === true });
      if (args[0] === 'start') {
        unitState[args[1]] = 'active';
        return { stdout: '' };
      }
      const unit = args[1];
      const active = unitState[unit] === 'active';
      return {
        stdout: [
          'LoadState=loaded',
          `ActiveState=${active ? 'active' : 'inactive'}`,
          `SubState=${active ? 'running' : 'dead'}`,
          `MainPID=${active ? (unit.includes('backend') ? 5101 : 5102) : 0}`,
          'User=ubuntu',
          '',
        ].join('\n'),
      };
    },
    waitForHttp: async (url, label) => {
      readinessChecks.push({ url, label });
    },
    verifyRevision: async () => {
      revisionVerified = true;
    },
  });

  const status = await manager.start();

  const startCalls = calls.filter(({ args }) => args[0] === 'start');
  assert.deepEqual(startCalls, [
    {
      args: ['start', 'ai-geo-backend.service'],
      privileged: true,
    },
    {
      args: ['start', 'ai-geo-frontend.service'],
      privileged: true,
    },
  ]);
  assert.deepEqual(readinessChecks, [
    {
      url: 'http://127.0.0.1:3002/api/ready',
      label: '后端',
    },
    {
      url: 'http://127.0.0.1:3001/',
      label: '前端',
    },
    {
      url: 'http://127.0.0.1:3001/api/ready',
      label: '前端 API 代理',
    },
  ]);
  assert.equal(status.backend.running, true);
  assert.equal(status.frontend.running, true);
  assert.equal(revisionVerified, true);
});

test('rolls back both units when the running revision does not match', async () => {
  const calls = [];
  const manager = createSystemdProcessManager({
    runSystemctl: async (args, options = {}) => {
      calls.push({ args, privileged: options.privileged === true });
      if (args[0] !== 'show') return { stdout: '' };
      return {
        stdout: [
          'LoadState=loaded',
          'ActiveState=active',
          'SubState=running',
          'MainPID=7101',
          'User=ubuntu',
          '',
        ].join('\n'),
      };
    },
    waitForHttp: async () => {},
    verifyRevision: async () => {
      throw new Error('运行版本不匹配');
    },
  });

  await assert.rejects(manager.start(), /运行版本不匹配/);
  assert.deepEqual(
    calls.filter(({ args }) => args[0] === 'stop').map(({ args }) => args[1]),
    ['ai-geo-frontend.service', 'ai-geo-backend.service']
  );
});

test('stops frontend before backend through privileged systemd control', async () => {
  const unitState = {
    'ai-geo-backend.service': 'active',
    'ai-geo-frontend.service': 'active',
  };
  const calls = [];
  const manager = createSystemdProcessManager({
    runSystemctl: async (args, options = {}) => {
      calls.push({ args, privileged: options.privileged === true });
      if (args[0] === 'stop') {
        unitState[args[1]] = 'inactive';
        return { stdout: '' };
      }
      const unit = args[1];
      const active = unitState[unit] === 'active';
      return {
        stdout: [
          'LoadState=loaded',
          `ActiveState=${active ? 'active' : 'inactive'}`,
          `SubState=${active ? 'running' : 'dead'}`,
          `MainPID=${active ? (unit.includes('backend') ? 6101 : 6102) : 0}`,
          'User=ubuntu',
          '',
        ].join('\n'),
      };
    },
  });

  const status = await manager.stop();

  assert.deepEqual(
    calls.filter(({ args }) => args[0] === 'stop'),
    [
      {
        args: ['stop', 'ai-geo-frontend.service'],
        privileged: true,
      },
      {
        args: ['stop', 'ai-geo-backend.service'],
        privileged: true,
      },
    ]
  );
  assert.equal(status.backend.running, false);
  assert.equal(status.frontend.running, false);
});

test('rolls back both units when startup readiness fails', async () => {
  const calls = [];
  const manager = createSystemdProcessManager({
    runSystemctl: async (args, options = {}) => {
      calls.push({ args, privileged: options.privileged === true });
      if (args[0] !== 'show') return { stdout: '' };
      return {
        stdout: [
          'LoadState=loaded',
          'ActiveState=inactive',
          'SubState=dead',
          'MainPID=0',
          'User=ubuntu',
          '',
        ].join('\n'),
      };
    },
    waitForHttp: async () => {
      throw new Error('readiness failed');
    },
  });

  await assert.rejects(manager.start(), /readiness failed/);
  assert.deepEqual(
    calls.filter(({ args }) => args[0] === 'stop'),
    [
      {
        args: ['stop', 'ai-geo-frontend.service'],
        privileged: true,
      },
      {
        args: ['stop', 'ai-geo-backend.service'],
        privileged: true,
      },
    ]
  );
});
