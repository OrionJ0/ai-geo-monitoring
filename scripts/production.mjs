#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createProcessManager } from './processManager.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDirectory =
  process.env.AI_GEO_RUNTIME_DIR || path.join(projectRoot, '.runtime');
const logDirectory =
  process.env.AI_GEO_LOG_DIR || path.join(projectRoot, 'logs');
const backendDirectory = path.join(projectRoot, 'backend');
const frontendDirectory = path.join(projectRoot, 'nextjs-frontend');
const backendEntry = path.join(backendDirectory, 'app.js');
const frontendEntry = path.join(
  frontendDirectory,
  'node_modules',
  'next',
  'dist',
  'bin',
  'next'
);

function parseEnvFile(filename) {
  if (!fs.existsSync(filename)) return {};
  return Object.fromEntries(
    fs.readFileSync(filename, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        return [key, value];
      })
  );
}

const backendConfig = parseEnvFile(path.join(backendDirectory, '.env'));
const backendPort = backendConfig.PORT || '3002';
const frontendPort = process.env.AI_GEO_FRONTEND_PORT || '3001';
const sharedEnvironment = { ...process.env, NODE_ENV: 'production' };
const services = {
  backend: {
    name: 'backend',
    command: process.execPath,
    args: [backendEntry],
    cwd: backendDirectory,
    env: sharedEnvironment,
    marker: backendEntry,
  },
  frontend: {
    name: 'frontend',
    command: process.execPath,
    args: [frontendEntry, 'start', '-H', '0.0.0.0', '-p', frontendPort],
    cwd: frontendDirectory,
    env: sharedEnvironment,
    marker: frontendEntry,
    alternateMarkers: ['next-server'],
  },
};
const manager = createProcessManager({ runtimeDirectory, logDirectory });

function requireFile(filename, description) {
  if (!fs.existsSync(filename)) {
    throw new Error(`${description}不存在: ${filename}`);
  }
}

async function waitForHttp(url, label, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(3_000),
        redirect: 'manual',
      });
      if (response.status >= 200 && response.status < 400) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label}健康检查超时: ${lastError || url}`);
}

async function getStatus() {
  return {
    backend: await manager.status(services.backend),
    frontend: await manager.status(services.frontend),
  };
}

async function start() {
  requireFile(path.join(backendDirectory, '.env'), '后端环境文件');
  requireFile(backendEntry, '后端入口');
  requireFile(frontendEntry, 'Next.js 生产入口');
  requireFile(path.join(frontendDirectory, '.next', 'BUILD_ID'), 'Next.js 构建产物');

  try {
    await manager.start(services.backend);
    await waitForHttp(
      `http://127.0.0.1:${backendPort}/api/health`,
      '后端'
    );
    await manager.start(services.frontend);
    await waitForHttp(`http://127.0.0.1:${frontendPort}/`, '前端');
    await waitForHttp(
      `http://127.0.0.1:${frontendPort}/api/health`,
      '前端 API 代理'
    );

    const status = await getStatus();
    if (!status.backend.running || !status.frontend.running) {
      throw new Error('健康检查通过，但受管进程已经退出');
    }
    return status;
  } catch (error) {
    await stop().catch(() => {});
    throw error;
  }
}

async function stop() {
  const [frontendResult, backendResult] = await Promise.allSettled([
    manager.stop(services.frontend),
    manager.stop(services.backend),
  ]);
  const failures = [
    ['frontend', frontendResult],
    ['backend', backendResult],
  ].filter(([, result]) => result.status === 'rejected');
  if (failures.length) {
    throw new Error(failures.map(([name, result]) => (
      `${name} 停止失败: ${result.reason?.message || result.reason}`
    )).join('；'));
  }
  return {
    backend: backendResult.value,
    frontend: frontendResult.value,
  };
}

function printHumanStatus(status) {
  for (const name of ['backend', 'frontend']) {
    const service = status[name];
    const state = service.running ? `运行中，PID ${service.pid}` : '已停止';
    console.log(`${name}: ${state}`);
  }
}

async function main() {
  const command = process.argv[2] || 'status';
  const json = process.argv.includes('--json');
  let result;

  if (command === 'start') result = await start();
  else if (command === 'stop') result = await stop();
  else if (command === 'status') result = await getStatus();
  else {
    throw new Error('用法: node scripts/production.mjs <start|stop|status> [--json]');
  }

  if (json) console.log(JSON.stringify(result));
  else printHumanStatus(result);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
