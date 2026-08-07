#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const scriptDirectory = path.dirname(scriptPath);
const projectRoot = path.resolve(
  process.env.AI_GEO_PROJECT_ROOT || path.join(scriptDirectory, '..')
);
const backendDirectory = path.join(projectRoot, 'backend');
const frontendDirectory = path.join(projectRoot, 'nextjs-frontend');
const runtimeDirectory =
  process.env.AI_GEO_RUNTIME_DIR || path.join(projectRoot, '.runtime');
const logDirectory =
  process.env.AI_GEO_LOG_DIR || path.join(projectRoot, 'logs');
const lockDirectory = path.join(runtimeDirectory, 'deploy.lock');
const productionScript = path.join(projectRoot, 'scripts', 'production.mjs');
const backupScript = path.join(
  projectRoot,
  'backend',
  'scripts',
  'backupSqlite.js'
);
const geoMetricMigrationScript = path.join(
  backendDirectory,
  'scripts',
  'migrateGeoMetricSemantics.js'
);
const v5SnapshotMigrationScript = path.join(
  backendDirectory,
  'scripts',
  'migrateV5SnapshotFields.js'
);
const deepSeekFlashConfigMigrationScript = path.join(
  backendDirectory,
  'scripts',
  'migrateDeepSeekFlashConfig.js'
);
const marketingMigrationScript = path.join(
  backendDirectory,
  'scripts',
  'migrateMarketing.js'
);
const marketingExpectedLatest = '016-revisioned-ad-snapshot-facts';
const websiteDataMigrationScript = path.join(
  backendDirectory,
  'scripts',
  'migrateWebsiteData.js'
);
const consultationRecordMigrationScript = path.join(
  backendDirectory,
  'scripts',
  'migrateConsultationRecords.js'
);
const geo010AcceptanceScript = path.join(
  backendDirectory,
  'scripts',
  'geo010Acceptance.js'
);
export const GEO010_CONTRACT_PATHS = Object.freeze([
  'backend/app.js',
  'backend/middleware/quota.js',
  'backend/models/AIPlatformConfig.js',
  'backend/models/QuestionRecord.js',
  'backend/models/Setting.js',
  'backend/models/VisibilityMetric.js',
  'backend/routes/detection.js',
  'backend/routes/geoProjects.js',
  'backend/routes/settings.js',
  'backend/scripts/geo010Acceptance.js',
  'backend/scripts/migrateDeepSeekFlashConfig.js',
  'backend/scripts/migrateGeoMetricSemantics.js',
  'backend/scripts/migrateV5SnapshotFields.js',
  'backend/services/AIAnalysisConfigService.js',
  'backend/services/AIAnalysisExecutionCoordinator.js',
  'backend/services/AIPlatformConfigService.js',
  'backend/services/AIPlatformRequestService.js',
  'backend/services/AIPlatformService.js',
  'backend/services/AIResponseAnalysisV5Service.js',
  'backend/services/AIResponseEntityExtractionService.js',
  'backend/services/AIResponseSemanticJudgmentService.js',
  'backend/services/ApplicationShutdownService.js',
  'backend/services/DeepSeekFlashConfigMigrationService.js',
  'backend/services/GeoMetricSemanticsMigrationService.js',
  'backend/services/ProjectRunService.js',
  'backend/services/SchedulerService.js',
  'scripts/deploy.mjs',
  'scripts/deploy-from-bundle.mjs'
]);
const GEO010_CONTRACT_LEAF_PATHS = new Set([
  'backend/app.js',
  'scripts/deploy.mjs',
  'scripts/deploy-from-bundle.mjs'
]);
const releaseRevisionPath = path.join(runtimeDirectory, 'release-revision');
const deploymentGateSource = path.join(
  projectRoot,
  'deploy',
  'ai-geo-deploy-gate.sh'
);
const deploymentGateTarget = process.env.AI_GEO_DEPLOY_GATE_PATH
  || '/home/ubuntu/.local/bin/ai-geo-deploy-gate';
const DEPLOYMENT_MAX_RUNTIME_MS = 345 * 60 * 1000;
let activeDeployment = null;

function parseEnvFile(filename) {
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

function validateNodeVersion() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 20 || (major === 20 && minor < 9)) {
    throw new Error(`Node.js ${process.versions.node} 不受支持，需要 20.9 或更高版本`);
  }
}

function validateEncryptionKey(value) {
  if (/^[a-fA-F0-9]{64}$/.test(value || '')) return;
  if (
    /^[A-Za-z0-9+/]+={0,2}$/.test(value || '') &&
    Buffer.from(value, 'base64').length === 32
  ) {
    return;
  }
  throw new Error('CONFIG_ENCRYPTION_KEY 必须是 32 字节 Base64 或 64 位十六进制');
}

function requirePrivateFile(filename, description) {
  if (process.platform === 'win32') return;
  const mode = fs.statSync(filename).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(`${description} 权限必须为 0600 或更严格`);
  }
}

function assertDatabaseEnvironmentMatchesConfig(config) {
  const configuredDatabaseUrl = String(config.DATABASE_URL || '').trim();
  const environmentDatabaseUrl = String(process.env.DATABASE_URL || '').trim();
  if (environmentDatabaseUrl && environmentDatabaseUrl !== configuredDatabaseUrl) {
    throw new Error('运行环境 DATABASE_URL 与已校验 .env 不一致');
  }
  if (configuredDatabaseUrl) {
    if (String(process.env.DB_STORAGE || '').trim()) {
      throw new Error('Postgres 部署环境不得同时覆盖 DB_STORAGE');
    }
    return;
  }
  if (environmentDatabaseUrl) {
    throw new Error('SQLite 部署环境不得覆盖 DATABASE_URL');
  }
  const environmentStorage = String(process.env.DB_STORAGE || '').trim();
  if (!environmentStorage) return;
  const configuredStorage = path.resolve(
    backendDirectory,
    config.DB_STORAGE || 'database.sqlite'
  );
  const resolvedEnvironmentStorage = path.resolve(
    backendDirectory,
    environmentStorage
  );
  if (resolvedEnvironmentStorage !== configuredStorage) {
    throw new Error('运行环境 DB_STORAGE 与已校验 .env 不一致');
  }
}

async function git(args, { signal = null, deadline = null } = {}) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: projectRoot,
    maxBuffer: 10 * 1024 * 1024,
    ...(signal ? { signal } : {}),
    ...(deadline ? { timeout: Math.max(1, deadline - Date.now()) } : {})
  });
  return stdout.trim();
}

export async function computeGeo010ContractFingerprint(
  revision,
  { root = projectRoot, paths = null, signal = null, deadline = null } = {}
) {
  const normalizedRevision = String(revision || '').trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/u.test(normalizedRevision)) {
    throw new Error('GEO 010 合同指纹要求完整的 40 位 Git commit');
  }
  const { stdout: treeOutput } = await execFileAsync('git', [
    'ls-tree', '-r', '--full-tree', normalizedRevision
  ], {
    cwd: root,
    maxBuffer: 10 * 1024 * 1024,
    ...(signal ? { signal } : {}),
    ...(deadline ? { timeout: Math.max(1, deadline - Date.now()) } : {})
  });
  const treeRows = treeOutput.trim().split(/\r?\n/u).filter(Boolean);
  const treeRowsByPath = new Map(treeRows.map((row) => [
    row.slice(row.indexOf('\t') + 1),
    row
  ]));
  const expanded = paths
    ? { paths: [...paths], externalPackages: new Set() }
    : await expandGeo010ContractDependencies({
        revision: normalizedRevision,
        root,
        treePaths: new Set(treeRowsByPath.keys()),
        signal,
        deadline
      });
  const contractPaths = expanded.paths;
  const treePaths = new Set(treeRowsByPath.keys());
  const missing = contractPaths.filter((filename) => !treePaths.has(filename));
  if (missing.length) {
    throw new Error(`GEO 010 合同指纹缺少受控文件: ${missing.join(', ')}`);
  }
  const rows = contractPaths.map((filename) => treeRowsByPath.get(filename));
  if (!paths) {
    rows.push(await selectedRuntimeLockRow({
      revision: normalizedRevision,
      root,
      externalPackages: expanded.externalPackages,
      signal,
      deadline
    }));
  }
  return createHash('sha256').update(`${rows.sort().join('\n')}\n`).digest('hex');
}

function gitObjectOptions(root, signal, deadline) {
  return {
    cwd: root,
    maxBuffer: 10 * 1024 * 1024,
    ...(signal ? { signal } : {}),
    ...(deadline ? { timeout: Math.max(1, deadline - Date.now()) } : {})
  };
}

async function selectedRuntimeLockRow({
  revision,
  root,
  externalPackages,
  signal,
  deadline
}) {
  const { stdout } = await execFileAsync(
    'git',
    ['show', `${revision}:backend/package-lock.json`],
    gitObjectOptions(root, signal, deadline)
  );
  const lock = JSON.parse(stdout);
  const packageRows = lock?.packages && typeof lock.packages === 'object'
    ? lock.packages
    : {};
  const selectedNames = new Set(externalPackages);
  const selectedEntries = new Map();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [location, metadata] of Object.entries(packageRows)) {
      if (!location.includes('node_modules/')) continue;
      const packageName = location.split('node_modules/').at(-1);
      if (!selectedNames.has(packageName) || selectedEntries.has(location)) continue;
      selectedEntries.set(location, metadata);
      for (const dependencyName of Object.keys({
        ...(metadata?.dependencies || {}),
        ...(metadata?.optionalDependencies || {}),
        ...(metadata?.peerDependencies || {})
      })) selectedNames.add(dependencyName);
      changed = true;
    }
  }
  const normalized = [...selectedEntries.entries()].sort(([left], [right]) => (
    left.localeCompare(right)
  ));
  return `geo010-runtime-lock ${createHash('sha256').update(JSON.stringify(normalized)).digest('hex')}`;
}

async function expandGeo010ContractDependencies({
  revision,
  root,
  treePaths,
  signal,
  deadline
}) {
  const discovered = new Set(GEO010_CONTRACT_PATHS);
  const externalPackages = new Set();
  const pending = GEO010_CONTRACT_PATHS.filter(
    (filename) => !GEO010_CONTRACT_LEAF_PATHS.has(filename)
  );
  while (pending.length) {
    const filename = pending.shift();
    if (!treePaths.has(filename) || !/\.(?:c?js|mjs)$/u.test(filename)) continue;
    const { stdout } = await execFileAsync(
      'git',
      ['show', `${revision}:${filename}`],
      gitObjectOptions(root, signal, deadline)
    );
    const specifiers = [...stdout.matchAll(
      /(?:require\s*\(|from\s+)\s*['"]([^'"]+)['"]/gu
    )].map((match) => match[1]);
    for (const specifier of specifiers) {
      if (!specifier.startsWith('.')) {
        if (!specifier.startsWith('node:')) {
          externalPackages.add(specifier.startsWith('@')
            ? specifier.split('/').slice(0, 2).join('/')
            : specifier.split('/')[0]);
        }
        continue;
      }
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(filename), specifier));
      const candidates = path.posix.extname(base)
        ? [base]
        : [base, `${base}.js`, `${base}.cjs`, `${base}.mjs`, `${base}.json`, `${base}/index.js`];
      const dependency = candidates.find((candidate) => treePaths.has(candidate));
      if (!dependency || discovered.has(dependency)) continue;
      discovered.add(dependency);
      pending.push(dependency);
    }
  }
  return { paths: [...discovered], externalPackages };
}

export async function isGeo010ContractChanged({
  previousRevision,
  revision,
  root = projectRoot,
  signal = null,
  deadline = null
}) {
  const currentFingerprint = await computeGeo010ContractFingerprint(revision, {
    root,
    signal,
    deadline
  });
  if (!/^[a-f0-9]{40}$/u.test(String(previousRevision || ''))) return true;
  try {
    const previousFingerprint = await computeGeo010ContractFingerprint(previousRevision, {
      root,
      signal,
      deadline
    });
    return previousFingerprint !== currentFingerprint;
  } catch (_) {
    // 旧版本可能早于 010 合同文件；缺少旧指纹只能按“已变化”处理。
    return true;
  }
}

export async function checkPreconditions({ signal = null, deadline = null } = {}) {
  validateNodeVersion();
  const commandOptions = { signal, deadline };
  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], commandOptions);
  if (branch !== 'main') {
    throw new Error(`当前分支是 ${branch}，只允许从 main 部署`);
  }

  const worktree = await git(['status', '--porcelain'], commandOptions);
  if (worktree) {
    throw new Error('工作区存在未提交改动，拒绝部署');
  }

  const backendEnvPath = path.join(backendDirectory, '.env');
  if (!fs.existsSync(backendEnvPath)) {
    throw new Error(`后端环境文件不存在: ${backendEnvPath}`);
  }
  const config = parseEnvFile(backendEnvPath);
  requirePrivateFile(backendEnvPath, '后端环境文件');
  assertDatabaseEnvironmentMatchesConfig(config);
  if ((process.env.NODE_ENV || config.NODE_ENV) !== 'production') {
    throw new Error('NODE_ENV 必须显式设置为 production');
  }
  if (!config.JWT_SECRET || config.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET 缺失或少于 32 个字符');
  }
  validateEncryptionKey(config.CONFIG_ENCRYPTION_KEY);
  if (
    config.DEFAULT_ADMIN_BOOTSTRAP_ENABLED === 'true'
    || config.DEMO_USER_ENABLED === 'true'
  ) {
    throw new Error('生产部署禁止启动期管理员 bootstrap 或 demo 用户');
  }
  if (
    ['admin123456', 'password', 'changeme'].includes(
      String(config.DEFAULT_ADMIN_PASSWORD || '').toLocaleLowerCase('en-US')
    )
  ) {
    throw new Error('生产部署拒绝公开默认管理员密码');
  }
  if (
    config.DATABASE_URL
    && config.DB_SSL_REJECT_UNAUTHORIZED === 'false'
  ) {
    throw new Error('生产 Postgres 必须校验 TLS 证书');
  }

  const frontendProductionEnv = path.join(
    frontendDirectory,
    '.env.production'
  );
  const frontendConfig = fs.existsSync(frontendProductionEnv)
    ? parseEnvFile(frontendProductionEnv)
    : {};
  for (const key of [
    'NEXT_PUBLIC_AD_PERFORMANCE_FIXTURE',
    'NEXT_PUBLIC_KEYWORD_ANALYSIS_FIXTURE',
    'NEXT_PUBLIC_ORDER_RESULTS_DEMO'
  ]) {
    if (frontendConfig[key] === 'true' || process.env[key] === 'true') {
      throw new Error(`生产部署禁止启用 ${key}`);
    }
  }

  let databasePath = null;
  if (!config.DATABASE_URL) {
    databasePath = path.resolve(
      backendDirectory,
      config.DB_STORAGE || 'database.sqlite'
    );
    if (!fs.existsSync(databasePath)) {
      throw new Error(`SQLite 数据库不存在: ${databasePath}`);
    }
    requirePrivateFile(databasePath, 'SQLite 数据库');
  }

  return {
    branch,
    revision: await git(['rev-parse', 'HEAD'], commandOptions),
    databasePath,
    databaseType: config.DATABASE_URL ? 'postgres' : 'sqlite',
    node: process.versions.node,
    ok: true,
  };
}

function preparedRevisionArgument() {
  const prefix = '--prepared-revision=';
  const argument = process.argv.find((value) => value.startsWith(prefix));
  if (!argument) return '';
  const revision = argument.slice(prefix.length).trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    throw new Error('预置版本必须是完整的 40 位 Git commit');
  }
  return revision;
}

function assertPreparedRevision(expectedRevision, actualRevision) {
  if (expectedRevision && expectedRevision !== actualRevision) {
    throw new Error(
      `预置版本与当前 HEAD 不一致：期望 ${expectedRevision.slice(0, 12)}，实际 ${actualRevision.slice(0, 12)}`
    );
  }
}

export function buildV5SnapshotAuditArguments(databaseType, databasePath = '') {
  if (databaseType === 'sqlite') {
    return ['--require-ready', '--quick-check', `--db=${databasePath}`];
  }
  return ['--require-ready'];
}

export function runManagedCommand(command, args, options = {}) {
  const deployment = options.cleanup ? null : activeDeployment;
  const controller = options.controller || deployment?.controller;
  const deadline = Number(options.deadline) || deployment?.deadline || null;
  if (controller?.signal.aborted) {
    return Promise.reject(
      controller.signal.reason instanceof Error
        ? controller.signal.reason
        : new Error('部署被中断')
    );
  }
  if (deadline && Date.now() >= deadline) {
    const error = new Error('部署超过服务器侧 345 分钟总 deadline');
    controller?.abort(error);
    return Promise.reject(error);
  }
  return new Promise((resolve, reject) => {
    const detached = process.platform !== 'win32';
    const child = spawn(command, args, {
      cwd: options.cwd || projectRoot,
      env: options.env || process.env,
      stdio: 'inherit',
      detached,
    });
    let settled = false;
    let killTimer = null;
    let interruptionReason = null;
    const terminationGraceMs = Math.max(
      1_000,
      Number(options.terminationGraceMs) || 5_000
    );
    const remainingMs = deadline
      ? Math.max(1, deadline - Date.now())
      : null;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (remainingTimer) clearTimeout(remainingTimer);
      if (killTimer) clearTimeout(killTimer);
      controller?.signal.removeEventListener('abort', onAbort);
      callback(value);
    };
    const signalProcessTree = (signal) => {
      if (detached && Number.isInteger(child.pid) && child.pid > 0) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch (_) {}
      }
      child.kill(signal);
    };
    const interrupt = (reason) => {
      if (settled || interruptionReason) return;
      interruptionReason = reason;
      signalProcessTree('SIGTERM');
      killTimer = setTimeout(() => signalProcessTree('SIGKILL'), terminationGraceMs);
      killTimer.unref?.();
    };
    const onAbort = () => interrupt(
      controller.signal.reason instanceof Error
        ? controller.signal.reason
        : new Error('部署被中断')
    );
    const remainingTimer = remainingMs === null
      ? null
      : setTimeout(() => interrupt(new Error('部署超过服务器侧 345 分钟总 deadline')), remainingMs);
    remainingTimer?.unref?.();
    controller?.signal.addEventListener('abort', onAbort, { once: true });
    child.once('error', (error) => finish(reject, error));
    child.once('exit', (code, signal) => {
      if (settled) return;
      if (interruptionReason) {
        // 直接子进程可能先退出，而 npm/浏览器孙进程仍忽略 TERM；在发布锁
        // 释放前立即清除整个独立进程组，不能让 escalation timer 被 finish 清掉。
        signalProcessTree('SIGKILL');
        finish(reject, interruptionReason);
        return;
      }
      if (code === 0) finish(resolve);
      else {
        finish(
          reject,
          new Error(
            `${options.label || command}失败${signal ? `，信号 ${signal}` : `，退出码 ${code}`}`
          )
        );
      }
    });
  });
}

const run = runManagedCommand;

export async function acquireDeploymentLock() {
  await fs.promises.mkdir(runtimeDirectory, { recursive: true });
  try {
    await fs.promises.mkdir(lockDirectory);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error('已有部署正在执行；如确认是异常残留，请人工删除 deploy.lock');
    }
    throw error;
  }
}

export async function releaseDeploymentLock() {
  await fs.promises.rm(lockDirectory, { recursive: true, force: true });
}

async function appendDeploymentLog(message) {
  await fs.promises.mkdir(logDirectory, { recursive: true });
  await fs.promises.appendFile(
    path.join(logDirectory, 'deployments.log'),
    `${new Date().toISOString()} ${message}\n`
  );
}

async function installDeploymentGate() {
  const source = await fs.promises.lstat(deploymentGateSource);
  if (!source.isFile() || source.isSymbolicLink()) {
    throw new Error('仓库内 SSH 部署 gate 不是普通文件');
  }
  const targetDirectory = path.dirname(deploymentGateTarget);
  const directory = await fs.promises.lstat(targetDirectory);
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw new Error('SSH 部署 gate 目标目录无效');
  }
  const temporaryTarget = path.join(
    targetDirectory,
    `.ai-geo-deploy-gate.${process.pid}.${Date.now()}`
  );
  try {
    await fs.promises.copyFile(
      deploymentGateSource,
      temporaryTarget,
      fs.constants.COPYFILE_EXCL
    );
    await fs.promises.chmod(temporaryTarget, 0o755);
    await fs.promises.rename(temporaryTarget, deploymentGateTarget);
  } finally {
    await fs.promises.rm(temporaryTarget, { force: true }).catch(() => {});
  }
}

export async function deploy(preparedRevision = '', {
  lockAlreadyAcquired = false,
  deadline: inheritedDeadline = null,
  signal: inheritedSignal = null,
  previousRevision = '',
  requireGeo010Acceptance = false,
  dependenciesPreflighted = false,
  servicesAlreadyStopped = false
} = {}) {
  if (activeDeployment) throw new Error('当前进程已有部署正在执行');
  const controller = new AbortController();
  const forwardInheritedAbort = () => controller.abort(
    inheritedSignal?.reason instanceof Error
      ? inheritedSignal.reason
      : new Error('外层 Bundle 发布已中断')
  );
  if (inheritedSignal?.aborted) forwardInheritedAbort();
  else inheritedSignal?.addEventListener('abort', forwardInheritedAbort, { once: true });
  const signalHandlers = new Map(['SIGHUP', 'SIGINT', 'SIGTERM'].map((signal) => [
    signal,
    () => controller.abort(new Error(`部署收到 ${signal}，开始安全收敛`))
  ]));
  signalHandlers.forEach((handler, signal) => process.once(signal, handler));
  activeDeployment = {
    controller,
    deadline: Math.min(
      Date.now() + DEPLOYMENT_MAX_RUNTIME_MS,
      Number(inheritedDeadline) || Number.POSITIVE_INFINITY
    )
  };
  let initial;
  let lockAcquired = lockAlreadyAcquired;
  let servicesStopped = servicesAlreadyStopped;
  let enteredDowntime = servicesAlreadyStopped;
  let databaseBackupReference = '';
  let databaseBackupManifest = '';
  let currentStage = 'precondition';
  let deployRevision = '';
  let downtimeStartedAt = null;

  try {
    const deploymentCommandOptions = {
      signal: controller.signal,
      deadline: activeDeployment.deadline
    };
    initial = await checkPreconditions(deploymentCommandOptions);
    assertPreparedRevision(preparedRevision, initial.revision);
    if (!lockAlreadyAcquired) {
      await acquireDeploymentLock();
      lockAcquired = true;
    }
    let revision;
    if (preparedRevision) {
      console.log('1/14 校验已上传的预置版本');
      revision = await git(['rev-parse', 'HEAD'], deploymentCommandOptions);
      deployRevision = revision;
      assertPreparedRevision(preparedRevision, revision);
    } else {
      console.log('1/14 拉取 origin/main');
      await run('git', ['pull', '--ff-only', 'origin', 'main'], {
        label: 'git pull',
      });
      revision = await git(['rev-parse', 'HEAD'], deploymentCommandOptions);
      deployRevision = revision;
      const remoteRevision = await git(['rev-parse', 'origin/main'], deploymentCommandOptions);
      if (revision !== remoteRevision) {
        throw new Error('HEAD 与 origin/main 不一致，拒绝部署服务器本地提交');
      }
    }
    const checked = await checkPreconditions(deploymentCommandOptions);
    await installDeploymentGate();

    if (servicesAlreadyStopped) {
      console.log('2/14 启动桥已验证并停止受管生产进程');
    } else {
      console.log('2/14 停止受管生产进程');
      enteredDowntime = true;
      currentStage = 'stop';
      downtimeStartedAt = Date.now();
      await run(process.execPath, [productionScript, 'stop'], {
        label: '停止生产进程',
      });
      servicesStopped = true;
    }

    if (checked.databaseType === 'sqlite') {
      console.log('3/14 创建不可覆盖的 release 备份并更新 SQLite 最新备份');
      const backupPath =
        process.env.AI_GEO_SQLITE_BACKUP_PATH ||
        path.join(
          path.dirname(checked.databasePath),
          'database.latest.sqlite'
        );
      const releaseBackupDirectory =
        process.env.AI_GEO_SQLITE_RELEASE_BACKUP_DIR ||
        path.join(path.dirname(backupPath), 'releases');
      const conventionalReleaseBackupPath = path.join(
        releaseBackupDirectory,
        `database.pre-${revision}.sqlite`
      );
      const conventionalReleaseManifest = `${conventionalReleaseBackupPath}.manifest.json`;
      const releaseBackupPath = (
        fs.existsSync(conventionalReleaseBackupPath)
        || fs.existsSync(conventionalReleaseManifest)
      )
        ? path.join(
            releaseBackupDirectory,
            `database.retry-${revision}.sqlite`
          )
        : conventionalReleaseBackupPath;
      const releaseBackupManifest = `${releaseBackupPath}.manifest.json`;
      await run(process.execPath, [backupScript, checked.databasePath, backupPath], {
        label: 'SQLite 最新备份',
      });
      await run(
        process.execPath,
        [
          backupScript,
          checked.databasePath,
          releaseBackupPath,
          '--if-absent',
          `--manifest=${releaseBackupManifest}`,
          `--revision=${revision}`,
        ],
        { label: 'SQLite release 备份' }
      );
      databaseBackupReference = releaseBackupPath;
      databaseBackupManifest = releaseBackupManifest;
    } else {
      console.log('3/14 使用外部 Postgres，检查外部备份确认');
      databaseBackupReference = String(
        process.env.AI_GEO_DATABASE_BACKUP_REFERENCE || ''
      ).trim();
      if (!databaseBackupReference) {
        throw new Error(
          'Postgres 部署前必须通过 AI_GEO_DATABASE_BACKUP_REFERENCE 确认外部备份'
        );
      }
    }

    console.log('4/14 安装后端依赖');
    await run('npm', [
      'ci',
      ...(dependenciesPreflighted ? ['--offline'] : []),
      '--include=dev'
    ], {
      cwd: backendDirectory,
      label: '后端 npm ci',
    });
    console.log('5/14 运行后端测试');
    await run('npm', ['test'], { cwd: backendDirectory, label: '后端测试' });
    await run('npm', ['run', 'test:marketing'], {
      cwd: backendDirectory,
      label: '后端营销测试',
    });
    await run('npm', ['run', 'test:website-data'], {
      cwd: backendDirectory,
      label: '后端官网数据测试',
    });
    await run('npm', ['run', 'test:consultation-records'], {
      cwd: backendDirectory,
      label: '后端原始咨询测试',
    });
    console.log('6/14 安装并静态检查前端依赖');
    await run('npm', [
      'ci',
      ...(dependenciesPreflighted ? ['--offline'] : []),
      '--include=dev'
    ], {
      cwd: frontendDirectory,
      label: '前端 npm ci',
    });
    await run('npm', ['test'], {
      cwd: frontendDirectory,
      label: '前端营销单元测试',
    });
    await run('npm', ['run', 'lint'], {
      cwd: frontendDirectory,
      label: '前端 lint',
    });
    console.log('7/14 构建并验收前端生产产物');
    await run('npm', ['run', 'build'], {
      cwd: frontendDirectory,
      env: {
        ...process.env,
        AI_GEO_BUILD_REVISION: revision,
        // 2026-08-07 第七次部署实测：next build 在 3.6G 内存的服务器上
        // 用尽 RAM+swap 陷入换页风暴（44 分钟无输出、sshd 无法响应新连接）。
        // 限制 V8 堆上限避免越界换页；该前端生产构建 2G 堆实测充足。
        NODE_OPTIONS: '--max-old-space-size=2048'
      },
      label: '前端生产构建',
      // 构建超时兜底：历史基线 10-15 分钟，卡死时 30 分钟自动中断，
      // 避免部署无限期挂起（失败后重新执行部署命令即可恢复）。
      deadline: Date.now() + 30 * 60 * 1000
    });
    await run('npm', ['run', 'test:marketing:browser'], {
      cwd: frontendDirectory,
      label: '前端营销浏览器验收',
    });
    const backendConfig = parseEnvFile(path.join(backendDirectory, '.env'));
    const migrationEnvironment = { ...backendConfig, ...process.env };
    delete migrationEnvironment.DB_STORAGE;
    delete migrationEnvironment.DATABASE_URL;
    if (checked.databaseType === 'sqlite') {
      migrationEnvironment.DB_STORAGE = checked.databasePath;
    } else {
      migrationEnvironment.DATABASE_URL = backendConfig.DATABASE_URL;
    }
    console.log('8/14 迁移并复审 v5 快照字段');
    currentStage = 'migrate';
    const v5SnapshotTargetArguments = checked.databaseType === 'sqlite'
      ? [`--db=${checked.databasePath}`]
      : [];
    await run(
      process.execPath,
      [
        v5SnapshotMigrationScript,
        '--apply',
        ...v5SnapshotTargetArguments,
        `--backup-reference=${databaseBackupReference}`,
        ...(checked.databaseType === 'sqlite'
          ? [
              `--backup-manifest=${databaseBackupManifest}`,
              `--release-revision=${revision}`,
            ]
          : []),
      ],
      {
        cwd: backendDirectory,
        env: migrationEnvironment,
        label: 'v5 快照字段迁移',
      }
    );
    await run(
      process.execPath,
      [
        v5SnapshotMigrationScript,
        ...buildV5SnapshotAuditArguments(
          checked.databaseType,
          checked.databasePath
        ),
      ],
      {
        cwd: backendDirectory,
        env: migrationEnvironment,
        label: 'v5 快照字段迁移复审',
      }
    );

    console.log('9/14 迁移并复审 DeepSeek Flash 正式配置');
    const deepSeekConfigTargetArguments = checked.databaseType === 'sqlite'
      ? [`--db=${checked.databasePath}`]
      : [];
    await run(
      process.execPath,
      [
        deepSeekFlashConfigMigrationScript,
        '--apply',
        ...deepSeekConfigTargetArguments,
      ],
      {
        cwd: backendDirectory,
        env: migrationEnvironment,
        label: 'DeepSeek Flash 配置迁移',
      }
    );
    await run(
      process.execPath,
      [
        deepSeekFlashConfigMigrationScript,
        '--require-ready',
        ...deepSeekConfigTargetArguments,
      ],
      {
        cwd: backendDirectory,
        env: migrationEnvironment,
        label: 'DeepSeek Flash 配置迁移复审',
      }
    );

    console.log('10/14 迁移并复审 GEO 指标语义');
    await run(
      process.execPath,
      [
        geoMetricMigrationScript,
        '--apply',
        `--backup-reference=${databaseBackupReference}`,
      ],
      {
        cwd: backendDirectory,
        env: migrationEnvironment,
        label: 'GEO 指标语义迁移',
      }
    );
    await run(process.execPath, [geoMetricMigrationScript, '--require-ready'], {
      cwd: backendDirectory,
      env: migrationEnvironment,
      label: 'GEO 指标语义迁移复审',
    });

    console.log('11/14 应用并复审营销模块迁移');
    await run(process.execPath, [
      marketingMigrationScript,
      '--apply',
      `--expected-latest=${marketingExpectedLatest}`,
    ], {
      cwd: backendDirectory,
      env: migrationEnvironment,
      label: '营销模块迁移',
    });
    await run(process.execPath, [marketingMigrationScript], {
      cwd: backendDirectory,
      env: migrationEnvironment,
      label: '营销模块迁移复审',
    });

    console.log('12/14 应用并复审官网数据迁移');
    await run(process.execPath, [websiteDataMigrationScript, '--apply'], {
      cwd: backendDirectory,
      env: migrationEnvironment,
      label: '官网数据迁移',
    });
    await run(process.execPath, [websiteDataMigrationScript], {
      cwd: backendDirectory,
      env: migrationEnvironment,
      label: '官网数据迁移复审',
    });

    console.log('13/14 应用并复审原始咨询迁移');
    await run(process.execPath, [consultationRecordMigrationScript, '--apply'], {
      cwd: backendDirectory,
      env: migrationEnvironment,
      label: '原始咨询迁移',
    });
    await run(process.execPath, [consultationRecordMigrationScript], {
      cwd: backendDirectory,
      env: migrationEnvironment,
      label: '原始咨询迁移复审',
    });

    console.log('14/14 启动并检查前后端');
    await fs.promises.mkdir(runtimeDirectory, { recursive: true });
    await fs.promises.writeFile(releaseRevisionPath, `${revision}\n`, {
      mode: 0o600
    });
    currentStage = 'start';
    await run(process.execPath, [productionScript, 'start'], {
      label: '启动生产进程',
    });
    servicesStopped = false;

    currentStage = 'acceptance';
    if (requireGeo010Acceptance || await isGeo010ContractChanged({
      previousRevision,
      revision,
      signal: controller.signal,
      deadline: activeDeployment.deadline
    })) {
      console.log('Stage2 门禁：v5 运行合同已变化，执行四入口 v5 正式验收');
      await run(process.execPath, [geo010AcceptanceScript, `--revision=${revision}`], {
        cwd: backendDirectory,
        env: {
          ...migrationEnvironment,
          AI_GEO_DEPLOYMENT_DEADLINE_EPOCH_MS: String(activeDeployment.deadline),
          AI_GEO_ACCEPTANCE_STAGE: 'runtime'
        },
        label: '010 四入口 v5 正式验收',
        terminationGraceMs: 90_000,
      });
    } else {
      console.log('Stage2 门禁：相邻版本的 v5 运行合同未变化，无需重复四入口验收');
    }

    if (controller.signal.aborted) throw controller.signal.reason;
    const shortRevision = revision.slice(0, 12);
    const downtimeMs = downtimeStartedAt ? Date.now() - downtimeStartedAt : 0;
    await appendDeploymentLog(`SUCCESS ${shortRevision} | downtime_ms=${downtimeMs} | stage=${currentStage}`);
    console.log(`部署成功: ${shortRevision}（停机 ${downtimeMs} ms）`);
  } catch (error) {
    const failureContext =
      `revision=${deployRevision || 'unknown'}` +
      ` | stage=${currentStage}` +
      ` | downtime=${enteredDowntime ? 'stopped' : 'running'}`;
    await appendDeploymentLog(`FAILED ${error.message} | ${failureContext}`).catch(() => {});
    if (enteredDowntime) {
      try {
        const cleanupController = new AbortController();
        await run(process.execPath, [productionScript, 'stop'], {
          label: '部署失败后核验并停止全部生产进程',
          cleanup: true,
          controller: cleanupController,
          deadline: Date.now() + 90_000,
        });
        servicesStopped = true;
      } catch (stopError) {
        servicesStopped = false;
        console.error(`部署失败且无法确认全部生产进程停止: ${stopError.message}`);
      }
    }
    if (enteredDowntime && servicesStopped) {
      console.error('部署失败，网站保持停止；修复问题后重新执行部署命令。');
    } else if (!enteredDowntime) {
      console.error('部署在停服前失败，现役生产服务保持运行。');
    }
    throw error;
  } finally {
    if (!lockAlreadyAcquired && lockAcquired) await releaseDeploymentLock();
    signalHandlers.forEach((handler, signal) => process.removeListener(signal, handler));
    inheritedSignal?.removeEventListener('abort', forwardInheritedAbort);
    activeDeployment = null;
  }

  return initial;
}

export { DEPLOYMENT_MAX_RUNTIME_MS };

async function main() {
  const checkOnly = process.argv.includes('--check');
  const json = process.argv.includes('--json');
  const preparedRevision = preparedRevisionArgument();
  if (checkOnly) {
    const result = await checkPreconditions();
    assertPreparedRevision(preparedRevision, result.revision);
    if (json) console.log(JSON.stringify(result));
    else console.log('部署前置检查通过');
    return;
  }
  await deploy(preparedRevision);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
