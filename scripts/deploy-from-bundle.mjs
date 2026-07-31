#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  acquireDeploymentLock,
  deploy,
  releaseDeploymentLock
} from './deploy.mjs';

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
  expectedSha256
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
  await git(projectRoot, ['merge', '--ff-only', revision]);
  const actualRevision = await git(projectRoot, ['rev-parse', 'HEAD']);
  if (actualRevision !== revision) throw new Error('Bundle 快进后 HEAD 校验失败');

  return { previousRevision, revision };
}

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || '';
}

async function main() {
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

  await acquireDeploymentLock();
  try {
    const prepared = await prepareBundleRelease({
      projectRoot,
      bundlePath,
      expectedRevision: argument('revision'),
      expectedSha256: argument('sha256')
    });
    await deploy(prepared.revision, { lockAlreadyAcquired: true });
  } finally {
    await releaseDeploymentLock();
    await fs.promises.rm(bundlePath, { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
