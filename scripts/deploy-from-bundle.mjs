#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as bootstrapDeployment from './deploy.mjs';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const scriptDirectory = path.dirname(scriptPath);
const OFFICIAL_BASE_URL = 'https://insight.guangtuo.com';
const BOOTSTRAP_MAX_RUNTIME_MS = 345 * 60 * 1000;

function remainingTimeout(deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('Bundle 发布超过服务器侧 345 分钟总 deadline');
  return remaining;
}

function runManagedCommand(command, args, {
  cwd,
  env = process.env,
  signal,
  deadline,
  terminationGraceMs = 5_000
} = {}) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const detached = process.platform !== 'win32';
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: 'inherit',
      detached
    });
    let reason = null;
    let killTimer = null;
    const timeout = setTimeout(() => interrupt(
      new Error('Bundle 发布超过服务器侧 345 分钟总 deadline')
    ), remainingTimeout(deadline));
    timeout.unref?.();
    const signalTree = (killSignal) => {
      try {
        if (detached && child.pid) process.kill(-child.pid, killSignal);
        else child.kill(killSignal);
      } catch (_) {}
    };
    const interrupt = (error) => {
      if (reason) return;
      reason = error instanceof Error ? error : new Error('Bundle 发布被中断');
      signalTree('SIGTERM');
      killTimer = setTimeout(() => signalTree('SIGKILL'), terminationGraceMs);
      killTimer.unref?.();
    };
    const onAbort = () => interrupt(signal.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    const finish = (callback, value) => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    child.once('error', (error) => finish(reject, error));
    child.once('exit', (code) => {
      if (reason) {
        signalTree('SIGKILL');
        finish(reject, reason);
      } else if (code === 0) finish(resolve);
      else finish(reject, new Error(`${command} 退出码 ${code}`));
    });
  });
}

function parseEnvFile(filename) {
  return Object.fromEntries(
    fs.readFileSync(filename, 'utf8')
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"'))
          || (value.startsWith("'") && value.endsWith("'"))
        ) value = value.slice(1, -1);
        return [key, value];
      })
  );
}

function fullCommit(value, label) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(normalized)) {
    throw new Error(`${label}必须是完整的 40 位 Git commit`);
  }
  return normalized;
}

function sha256Value(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error('Bundle SHA-256 必须是 64 位十六进制');
  }
  return normalized;
}

async function fileSha256(filename) {
  const hash = createHash('sha256');
  const stream = fs.createReadStream(filename);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function git(projectRoot, args, { signal, deadline } = {}) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: projectRoot,
    maxBuffer: 10 * 1024 * 1024,
    ...(signal ? { signal } : {}),
    ...(deadline ? { timeout: remainingTimeout(deadline) } : {})
  });
  return stdout.trim();
}

export async function prepareBundleRelease({
  projectRoot,
  bundlePath,
  expectedRevision,
  expectedSha256,
  deferFastForward = false,
  signal,
  deadline
}) {
  const revision = fullCommit(expectedRevision, '预期版本');
  const checksum = sha256Value(expectedSha256);
  const resolvedBundle = await fs.promises.realpath(bundlePath);
  const bundleStat = await fs.promises.stat(resolvedBundle);
  if (!bundleStat.isFile()) throw new Error('Bundle 路径不是普通文件');
  if (await fileSha256(resolvedBundle) !== checksum) {
    throw new Error('Bundle SHA-256 校验失败');
  }

  if (signal?.aborted) throw signal.reason;
  const commandOptions = { signal, deadline };
  const branch = await git(projectRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], commandOptions);
  if (branch !== 'main') throw new Error(`当前分支是 ${branch}，只允许更新 main`);
  if (await git(projectRoot, ['status', '--porcelain'], commandOptions)) {
    throw new Error('工作区存在未提交改动，拒绝导入 Bundle');
  }

  await git(projectRoot, ['bundle', 'verify', resolvedBundle], commandOptions);
  const bundleHeads = await git(projectRoot, ['bundle', 'list-heads', resolvedBundle], commandOptions);
  const containsExpectedMain = bundleHeads
    .split(/\r?\n/)
    .some((line) => line.trim() === `${revision} refs/heads/main`);
  if (!containsExpectedMain) {
    throw new Error('Bundle 的 main 与预期版本不一致');
  }

  const previousRevision = await git(projectRoot, ['rev-parse', 'HEAD'], commandOptions);
  await git(projectRoot, ['fetch', '--no-tags', resolvedBundle, 'refs/heads/main'], commandOptions);
  const fetchedRevision = await git(projectRoot, ['rev-parse', 'FETCH_HEAD'], commandOptions);
  if (fetchedRevision !== revision) throw new Error('Bundle 导入版本与预期版本不一致');
  try {
    await git(projectRoot, ['merge-base', '--is-ancestor', previousRevision, revision], commandOptions);
  } catch {
    throw new Error('Bundle 版本不是当前 main 的快进更新，拒绝部署');
  }
  const prepared = { previousRevision, revision };
  if (!deferFastForward) {
    await fastForwardPreparedRelease({ projectRoot, ...prepared, signal, deadline });
  }
  return prepared;
}

export async function fastForwardPreparedRelease({
  projectRoot,
  previousRevision,
  revision,
  signal,
  deadline
}) {
  const commandOptions = { signal, deadline };
  const expectedPrevious = fullCommit(previousRevision, '快进前版本');
  const expectedRevision = fullCommit(revision, '快进目标版本');
  if (await git(projectRoot, ['status', '--porcelain'], commandOptions)) {
    throw new Error('停服后工作区发生变化，拒绝快进 Bundle');
  }
  const actualPrevious = await git(projectRoot, ['rev-parse', 'HEAD'], commandOptions);
  if (actualPrevious !== expectedPrevious) {
    throw new Error('停服后 HEAD 发生变化，拒绝快进 Bundle');
  }
  await git(projectRoot, ['merge', '--ff-only', expectedRevision], commandOptions);
  const actualRevision = await git(projectRoot, ['rev-parse', 'HEAD'], commandOptions);
  if (actualRevision !== expectedRevision) {
    throw new Error('Bundle 快进后 HEAD 校验失败');
  }
}

export async function loadPreparedDeploy({ projectRoot, revision }) {
  const normalizedRevision = fullCommit(revision, '预置版本');
  const candidateUrl = pathToFileURL(
    path.join(path.resolve(projectRoot), 'scripts', 'deploy.mjs')
  );
  candidateUrl.searchParams.set('release', normalizedRevision);
  const candidateModule = await import(candidateUrl.href);
  if (typeof candidateModule.deploy !== 'function') {
    throw new Error('候选版本缺少正式 deploy() 入口');
  }
  return candidateModule.deploy;
}

async function readPublicJson(pathname, { signal, deadline }) {
  const timeout = AbortSignal.timeout(Math.min(10_000, remainingTimeout(deadline)));
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(`${OFFICIAL_BASE_URL}${pathname}`, {
    signal: combined,
    redirect: 'error',
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`${pathname} 返回 HTTP ${response.status}`);
  return response.json();
}

async function readManagedServiceStates() {
  return Promise.all(['ai-geo-backend.service', 'ai-geo-frontend.service'].map(async (unit) => {
    try {
      const { stdout } = await execFileAsync('systemctl', ['is-active', unit]);
      return stdout.trim();
    } catch (error) {
      return String(error?.stdout || '').trim() || 'unknown';
    }
  }));
}

export async function resolveCurrentReleaseState({
  prepared,
  signal,
  deadline,
  readJson = readPublicJson,
  readServiceStates = readManagedServiceStates
}) {
  try {
    const [health, frontend, ready] = await Promise.all([
      readJson('/api/health', { signal, deadline }),
      readJson('/api/frontend-health', { signal, deadline }),
      readJson('/api/ready', { signal, deadline })
    ]);
    if (
      health?.revision !== prepared.previousRevision
      || frontend?.revision !== prepared.previousRevision
      || ready?.status !== 'ready'
    ) {
      throw new Error('停服前公开 revision 或 ready 状态不符合当前生产基线');
    }
    return { recovery: false };
  } catch (publicError) {
    const states = await readServiceStates();
    if (states.length === 2 && states.every((state) => ['inactive', 'failed'].includes(state))) {
      return { recovery: true };
    }
    throw publicError;
  }
}

async function runProductionPreflight({ projectRoot, prepared, signal, deadline }) {
  const releaseState = await resolveCurrentReleaseState({ prepared, signal, deadline });
  const checkoutParent = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'ai-geo-preflight-')
  );
  const checkout = path.join(checkoutParent, 'candidate');
  let worktreeAdded = false;
  try {
    await git(projectRoot, ['worktree', 'add', '--detach', checkout, prepared.revision], {
      signal,
      deadline
    });
    worktreeAdded = true;
    const candidateDeploy = await import(
      `${pathToFileURL(path.join(checkout, 'scripts', 'deploy.mjs')).href}?preflight=${prepared.revision}`
    );
    const contractChanged = await candidateDeploy.isGeo010ContractChanged({
      previousRevision: prepared.previousRevision,
      revision: prepared.revision,
      root: checkout,
      signal,
      deadline
    });
    if (!contractChanged && !releaseState.recovery) {
      return { requireGeo010Acceptance: false, dependenciesPreflighted: false };
    }
    await runManagedCommand('npm', ['ci', '--include=dev'], {
      cwd: path.join(checkout, 'backend'),
      signal,
      deadline
    });
    await runManagedCommand('npm', ['ci', '--include=dev'], {
      cwd: path.join(checkout, 'nextjs-frontend'),
      signal,
      deadline
    });

    const backendConfig = parseEnvFile(path.join(projectRoot, 'backend', '.env'));
    const environment = {
      ...backendConfig,
      ...process.env,
      NODE_ENV: 'production',
      AI_GEO_DEPLOYMENT_DEADLINE_EPOCH_MS: String(deadline),
      AI_GEO_ACCEPTANCE_STAGE: 'preflight',
      AI_GEO_REQUIRE_FULL_ACCEPTANCE: String(contractChanged || releaseState.recovery)
    };
    delete environment.DB_STORAGE;
    delete environment.DATABASE_URL;
    if (backendConfig.DATABASE_URL) {
      environment.DATABASE_URL = backendConfig.DATABASE_URL;
    } else {
      environment.DB_STORAGE = path.resolve(
        projectRoot,
        'backend',
        backendConfig.DB_STORAGE || 'database.sqlite'
      );
    }
    const script = path.join(checkout, 'backend', 'scripts', 'geo010Acceptance.js');
    await runManagedCommand(process.execPath, [
      script,
      releaseState.recovery ? '--recovery-preflight' : '--preflight'
    ], {
      cwd: path.join(checkout, 'backend'),
      env: environment,
      signal,
      deadline,
      terminationGraceMs: 90_000
    });
    return {
      requireGeo010Acceptance: true,
      dependenciesPreflighted: true
    };
  } finally {
    if (worktreeAdded) {
      await git(projectRoot, ['worktree', 'remove', '--force', checkout]).catch(() => {});
    }
    await fs.promises.rm(checkoutParent, { recursive: true, force: true });
  }
}

export async function activatePreparedRelease({
  projectRoot,
  prepared,
  preflight = runProductionPreflight,
  fastForward = fastForwardPreparedRelease,
  loadDeploy = loadPreparedDeploy,
  stopProduction = ({ projectRoot: root, signal: stopSignal, deadline: stopDeadline }) => (
    runManagedCommand(
      process.execPath,
      [path.join(root, 'scripts', 'production.mjs'), 'stop'],
      { cwd: root, signal: stopSignal, deadline: stopDeadline, terminationGraceMs: 90_000 }
    )
  ),
  signal,
  deadline = Date.now() + BOOTSTRAP_MAX_RUNTIME_MS
}) {
  const preflightResult = await preflight({ projectRoot, prepared, signal, deadline });
  let stopAttempted = false;
  try {
    // 先在现役服务运行期间完成候选只读门禁和依赖缓存，再停服；停服后才
    // 快进 live worktree，杜绝旧进程延迟 require 候选文件形成混合版本。
    stopAttempted = true;
    await stopProduction({ projectRoot, signal, deadline });
    await fastForward({ projectRoot, ...prepared, signal, deadline });
    const candidateDeploy = await loadDeploy({
      projectRoot,
      revision: prepared.revision
    });
    await candidateDeploy(prepared.revision, {
      lockAlreadyAcquired: true,
      deadline,
      signal,
      previousRevision: prepared.previousRevision,
      requireGeo010Acceptance: preflightResult?.requireGeo010Acceptance === true,
      dependenciesPreflighted: preflightResult?.dependenciesPreflighted === true,
      servicesAlreadyStopped: true
    });
  } catch (error) {
    if (stopAttempted) {
      const cleanupController = new AbortController();
      await stopProduction({
        projectRoot,
        signal: cleanupController.signal,
        deadline: Date.now() + 90_000
      }).catch(() => {});
    }
    throw error;
  }
}

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || '';
}

async function main() {
  // 本入口只由生产机 forced-command 发布闸门调用；显式建立生产部署上下文，
  // 不依赖服务器历史 .env 是否已声明 NODE_ENV。
  process.env.NODE_ENV = 'production';
  const projectRoot = path.resolve(
    process.env.AI_GEO_PROJECT_ROOT || path.join(scriptDirectory, '..')
  );
  const controller = new AbortController();
  const deadline = Date.now() + BOOTSTRAP_MAX_RUNTIME_MS;
  const signalHandlers = new Map(['SIGHUP', 'SIGINT', 'SIGTERM'].map((signal) => [
    signal,
    () => controller.abort(new Error(`Bundle 发布收到 ${signal}，开始安全收敛`))
  ]));
  signalHandlers.forEach((handler, signal) => process.once(signal, handler));
  const deadlineTimer = setTimeout(() => {
    controller.abort(new Error('Bundle 发布超过服务器侧 345 分钟总 deadline'));
  }, BOOTSTRAP_MAX_RUNTIME_MS);
  deadlineTimer.unref?.();
  let bundlePath = '';
  let lockAcquired = false;
  try {
    bundlePath = await fs.promises.realpath(argument('bundle'));
    const temporaryRoot = await fs.promises.realpath(os.tmpdir());
    const relativeToTemporaryRoot = path.relative(temporaryRoot, bundlePath);
    if (
      relativeToTemporaryRoot.startsWith('..')
      || path.isAbsolute(relativeToTemporaryRoot)
      || path.extname(bundlePath) !== '.bundle'
    ) {
      throw new Error('发布 Bundle 必须是系统临时目录中的 .bundle 普通文件');
    }

    await bootstrapDeployment.acquireDeploymentLock();
    lockAcquired = true;
    // 在改动服务器 main 之前先验证现役环境、分支和工作区；候选代码本身
    // 已由发布工作流的测试/构建门禁验证。
    if (typeof bootstrapDeployment.checkPreconditions === 'function') {
      await bootstrapDeployment.checkPreconditions({
        signal: controller.signal,
        deadline
      });
    }
    const prepared = await prepareBundleRelease({
      projectRoot,
      bundlePath,
      expectedRevision: argument('revision'),
      expectedSha256: argument('sha256'),
      deferFastForward: true,
      signal: controller.signal,
      deadline
    });
    // main 已快进后必须绕过启动器加载阶段的 ESM 缓存，执行候选版本本身的
    // 部署器；否则旧启动器可能跳过候选版本新增的迁移和发布校验。
    await activatePreparedRelease({
      projectRoot,
      prepared,
      signal: controller.signal,
      deadline
    });
  } finally {
    clearTimeout(deadlineTimer);
    signalHandlers.forEach((handler, signal) => process.removeListener(signal, handler));
    if (lockAcquired) await bootstrapDeployment.releaseDeploymentLock();
    if (bundlePath) await fs.promises.rm(bundlePath, { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
