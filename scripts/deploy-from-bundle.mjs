#!/usr/bin/env node

import { execFile } from 'node:child_process';
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

async function git(projectRoot, args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: projectRoot,
    maxBuffer: 10 * 1024 * 1024
  });
  return stdout.trim();
}

export async function prepareBundleRelease({
  projectRoot,
  bundlePath,
  expectedRevision,
  expectedSha256,
  deferFastForward = false
}) {
  const revision = fullCommit(expectedRevision, '预期版本');
  const checksum = sha256Value(expectedSha256);
  const resolvedBundle = await fs.promises.realpath(bundlePath);
  const bundleStat = await fs.promises.stat(resolvedBundle);
  if (!bundleStat.isFile()) throw new Error('Bundle 路径不是普通文件');
  if (await fileSha256(resolvedBundle) !== checksum) {
    throw new Error('Bundle SHA-256 校验失败');
  }

  const branch = await git(projectRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') throw new Error(`当前分支是 ${branch}，只允许更新 main`);
  if (await git(projectRoot, ['status', '--porcelain'])) {
    throw new Error('工作区存在未提交改动，拒绝导入 Bundle');
  }

  await git(projectRoot, ['bundle', 'verify', resolvedBundle]);
  const bundleHeads = await git(projectRoot, ['bundle', 'list-heads', resolvedBundle]);
  const containsExpectedMain = bundleHeads
    .split(/\r?\n/)
    .some((line) => line.trim() === `${revision} refs/heads/main`);
  if (!containsExpectedMain) {
    throw new Error('Bundle 的 main 与预期版本不一致');
  }

  const previousRevision = await git(projectRoot, ['rev-parse', 'HEAD']);
  await git(projectRoot, ['fetch', '--no-tags', resolvedBundle, 'refs/heads/main']);
  const fetchedRevision = await git(projectRoot, ['rev-parse', 'FETCH_HEAD']);
  if (fetchedRevision !== revision) throw new Error('Bundle 导入版本与预期版本不一致');
  try {
    await git(projectRoot, ['merge-base', '--is-ancestor', previousRevision, revision]);
  } catch {
    throw new Error('Bundle 版本不是当前 main 的快进更新，拒绝部署');
  }
  const prepared = { previousRevision, revision };
  if (!deferFastForward) {
    await fastForwardPreparedRelease({ projectRoot, ...prepared });
  }
  return prepared;
}

export async function fastForwardPreparedRelease({
  projectRoot,
  previousRevision,
  revision
}) {
  const expectedPrevious = fullCommit(previousRevision, '快进前版本');
  const expectedRevision = fullCommit(revision, '快进目标版本');
  if (await git(projectRoot, ['status', '--porcelain'])) {
    throw new Error('停服后工作区发生变化，拒绝快进 Bundle');
  }
  const actualPrevious = await git(projectRoot, ['rev-parse', 'HEAD']);
  if (actualPrevious !== expectedPrevious) {
    throw new Error('停服后 HEAD 发生变化，拒绝快进 Bundle');
  }
  await git(projectRoot, ['merge', '--ff-only', expectedRevision]);
  const actualRevision = await git(projectRoot, ['rev-parse', 'HEAD']);
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

async function stopProductionServices({ projectRoot }) {
  const productionScript = path.join(projectRoot, 'scripts', 'production.mjs');
  const { stdout } = await execFileAsync(
    process.execPath,
    [productionScript, 'stop', '--json'],
    { cwd: projectRoot, maxBuffer: 10 * 1024 * 1024 }
  );
  return JSON.parse(stdout.trim().split(/\r?\n/u).at(-1));
}

export async function activatePreparedRelease({
  projectRoot,
  prepared,
  stopProduction = stopProductionServices,
  fastForward = fastForwardPreparedRelease,
  loadDeploy = loadPreparedDeploy
}) {
  const stopped = await stopProduction({ projectRoot });
  const validStoppedState = (service) => (
    service?.running === false
    && (service.pid === null || service.pid === 0)
  );
  if (
    !validStoppedState(stopped?.backend)
    || !validStoppedState(stopped?.frontend)
  ) {
    if (
      typeof stopped?.backend?.running !== 'boolean'
      || typeof stopped?.frontend?.running !== 'boolean'
      || !Object.hasOwn(stopped.backend, 'pid')
      || !Object.hasOwn(stopped.frontend, 'pid')
    ) {
      throw new Error('生产停服状态无效，拒绝快进 Bundle');
    }
    throw new Error('生产进程未完全停止，拒绝快进 Bundle');
  }
  await fastForward({ projectRoot, ...prepared });
  const candidateDeploy = await loadDeploy({
    projectRoot,
    revision: prepared.revision
  });
  await candidateDeploy(prepared.revision, { lockAlreadyAcquired: true });
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
  const bundlePath = await fs.promises.realpath(argument('bundle'));
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
  try {
    // 在改动服务器 main 之前先验证现役环境、分支和工作区；候选代码本身
    // 已由发布工作流的测试/构建门禁验证。
    if (typeof bootstrapDeployment.checkPreconditions === 'function') {
      await bootstrapDeployment.checkPreconditions();
    }
    const prepared = await prepareBundleRelease({
      projectRoot,
      bundlePath,
      expectedRevision: argument('revision'),
      expectedSha256: argument('sha256'),
      deferFastForward: true
    });
    // main 已快进后必须绕过启动器加载阶段的 ESM 缓存，执行候选版本本身的
    // 部署器；否则旧启动器可能跳过候选版本新增的迁移和发布校验。
    await activatePreparedRelease({ projectRoot, prepared });
  } finally {
    await bootstrapDeployment.releaseDeploymentLock();
    await fs.promises.rm(bundlePath, { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
