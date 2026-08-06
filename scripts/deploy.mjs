#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process';
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
const releaseRevisionPath = path.join(runtimeDirectory, 'release-revision');
const deploymentGateSource = path.join(
  projectRoot,
  'deploy',
  'ai-geo-deploy-gate.sh'
);
const deploymentGateTarget = process.env.AI_GEO_DEPLOY_GATE_PATH
  || '/home/ubuntu/.local/bin/ai-geo-deploy-gate';

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

async function git(args, options = {}) {
  const signal = options.signal || activeDeploymentSignal;
  const deadline = Number(options.deadline) || activeDeploymentDeadline;
  const { stdout } = await execFileAsync('git', args, {
    cwd: projectRoot,
    maxBuffer: 10 * 1024 * 1024,
    ...(signal ? { signal } : {}),
    ...(deadline ? { timeout: Math.max(1, deadline - Date.now()) } : {}),
  });
  return stdout.trim();
}

export async function checkPreconditions() {
  validateNodeVersion();
  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') {
    throw new Error(`当前分支是 ${branch}，只允许从 main 部署`);
  }

  const worktree = await git(['status', '--porcelain']);
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
    revision: await git(['rev-parse', 'HEAD']),
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

let activeDeploymentSignal = null;
let activeDeploymentDeadline = null;

function run(command, args, options = {}) {
  const signal = options.signal || activeDeploymentSignal;
  const deadline = Number(options.deadline) || activeDeploymentDeadline;
  if (signal?.aborted) return Promise.reject(signal.reason);
  if (deadline && Date.now() >= deadline) {
    return Promise.reject(new Error('部署超过服务器侧 345 分钟总 deadline'));
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
    let interruptionReason = null;
    let killTimer = null;
    const signalTree = (killSignal) => {
      try {
        if (detached && child.pid) process.kill(-child.pid, killSignal);
        else child.kill(killSignal);
      } catch (_) {}
    };
    const interrupt = (error) => {
      if (interruptionReason) return;
      interruptionReason = error instanceof Error ? error : new Error('部署被中断');
      signalTree('SIGTERM');
      killTimer = setTimeout(() => signalTree('SIGKILL'), 5_000);
      killTimer.unref?.();
    };
    const onAbort = () => interrupt(signal.reason);
    const deadlineTimer = deadline
      ? setTimeout(() => interrupt(new Error('部署超过服务器侧 345 分钟总 deadline')), Math.max(1, deadline - Date.now()))
      : null;
    deadlineTimer?.unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    child.once('error', (error) => finish(reject, error));
    child.once('exit', (code, exitSignal) => {
      if (interruptionReason) {
        signalTree('SIGKILL');
        finish(reject, interruptionReason);
      } else if (code === 0) finish(resolve);
      else {
        finish(
          reject,
          new Error(
            `${options.label || command}失败${exitSignal ? `，信号 ${exitSignal}` : `，退出码 ${code}`}`
          )
        );
      }
    });
  });
}

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
  deadline = null,
  signal = null,
  previousRevision = '',
  dependenciesPreflighted = false,
  servicesAlreadyStopped = false
} = {}) {
  activeDeploymentSignal = signal;
  activeDeploymentDeadline = Number(deadline) || null;
  const initial = await checkPreconditions();
  assertPreparedRevision(preparedRevision, initial.revision);
  if (!lockAlreadyAcquired) await acquireDeploymentLock();
  let servicesStopped = servicesAlreadyStopped;
  let databaseBackupReference = '';
  let databaseBackupManifest = '';

  try {
    let revision;
    if (preparedRevision) {
      console.log('1/13 校验已上传的预置版本');
      revision = await git(['rev-parse', 'HEAD']);
      assertPreparedRevision(preparedRevision, revision);
    } else {
      console.log('1/13 拉取 origin/main');
      await run('git', ['pull', '--ff-only', 'origin', 'main'], {
        label: 'git pull',
      });
      revision = await git(['rev-parse', 'HEAD']);
      const remoteRevision = await git(['rev-parse', 'origin/main']);
      if (revision !== remoteRevision) {
        throw new Error('HEAD 与 origin/main 不一致，拒绝部署服务器本地提交');
      }
    }
    const checked = await checkPreconditions();
    await installDeploymentGate();

    if (!servicesAlreadyStopped) {
      console.log('2/13 停止受管生产进程');
      await run(process.execPath, [productionScript, 'stop'], {
        label: '停止生产进程',
      });
      servicesStopped = true;
    } else {
      console.log('2/13 生产进程已由 Bundle 启动器停止');
    }

    if (checked.databaseType === 'sqlite') {
      console.log('3/13 创建不可覆盖的 release 备份并更新 SQLite 最新备份');
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
      console.log('3/13 使用外部 Postgres，检查外部备份确认');
      databaseBackupReference = String(
        process.env.AI_GEO_DATABASE_BACKUP_REFERENCE || ''
      ).trim();
      if (!databaseBackupReference) {
        throw new Error(
          'Postgres 部署前必须通过 AI_GEO_DATABASE_BACKUP_REFERENCE 确认外部备份'
        );
      }
    }

    const changedDependencyFiles = previousRevision && /^[a-f0-9]{40}$/u.test(previousRevision)
      ? await git([
          'diff', '--name-only', previousRevision, revision, '--',
          'backend/package.json', 'backend/package-lock.json',
          'nextjs-frontend/package.json', 'nextjs-frontend/package-lock.json'
        ])
      : 'unknown';
    const reusableBridgeDependencies = LAUNCHER_ONLY_BRIDGE
      && changedDependencyFiles === ''
      && fs.existsSync(path.join(backendDirectory, 'node_modules'))
      && fs.existsSync(path.join(frontendDirectory, 'node_modules'));
    if (LAUNCHER_ONLY_BRIDGE && !reusableBridgeDependencies) {
      throw new Error('launcher-only bridge 依赖复用门禁失败，拒绝停服后联网安装');
    }
    console.log('4/13 安装后端依赖');
    if (!reusableBridgeDependencies) {
      await run('npm', ['ci', ...(dependenciesPreflighted ? ['--offline'] : []), '--include=dev'], {
        cwd: backendDirectory,
        label: '后端 npm ci',
      });
    } else {
      console.log('launcher-only bridge 锁文件未变，复用现役后端依赖');
    }
    console.log('5/13 运行后端测试');
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
    console.log('6/13 安装并静态检查前端依赖');
    if (!reusableBridgeDependencies) {
      await run('npm', ['ci', ...(dependenciesPreflighted ? ['--offline'] : []), '--include=dev'], {
        cwd: frontendDirectory,
        label: '前端 npm ci',
      });
    } else {
      console.log('launcher-only bridge 锁文件未变，复用现役前端依赖');
    }
    await run('npm', ['test'], {
      cwd: frontendDirectory,
      label: '前端营销单元测试',
    });
    await run('npm', ['run', 'lint'], {
      cwd: frontendDirectory,
      label: '前端 lint',
    });
    console.log('7/13 构建并验收前端生产产物');
    await run('npm', ['run', 'build'], {
      cwd: frontendDirectory,
      env: { ...process.env, AI_GEO_BUILD_REVISION: revision },
      label: '前端生产构建',
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
    console.log('8/13 迁移并复审 v5 快照字段');
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

    console.log('9/13 迁移并复审 GEO 指标语义');
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
    await run(process.execPath, [geoMetricMigrationScript], {
      cwd: backendDirectory,
      env: migrationEnvironment,
      label: 'GEO 指标语义迁移复审',
    });

    console.log('10/13 应用并复审营销模块迁移');
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

    console.log('11/13 应用并复审官网数据迁移');
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

    console.log('12/13 应用并复审原始咨询迁移');
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

    console.log('13/13 启动并检查前后端');
    await fs.promises.mkdir(runtimeDirectory, { recursive: true });
    await fs.promises.writeFile(releaseRevisionPath, `${revision}\n`, {
      mode: 0o600
    });
    await run(process.execPath, [productionScript, 'start'], {
      label: '启动生产进程',
    });
    servicesStopped = false;

    const shortRevision = revision.slice(0, 12);
    await appendDeploymentLog(`SUCCESS ${shortRevision}`);
    console.log(`部署成功: ${shortRevision}`);
  } catch (error) {
    await appendDeploymentLog(`FAILED ${error.message}`).catch(() => {});
    if (servicesStopped) {
      console.error('部署失败，网站保持停止；修复问题后重新执行部署命令。');
    }
    throw error;
  } finally {
    if (!lockAlreadyAcquired) await releaseDeploymentLock();
    activeDeploymentSignal = null;
    activeDeploymentDeadline = null;
  }

  return initial;
}

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

// 本 revision 只升级 Bundle 启动器，不包含 GEO 运行时代码。现役启动器会
// 从候选 revision 调用本函数，因此桥接提交必须明确声明自身不触发业务硬切；
// 后续统一候选自带完整、不可伪造的运行合同指纹实现。
export async function isGeo010ContractChanged() {
  return false;
}

export const LAUNCHER_ONLY_BRIDGE = true;
export const LAUNCHER_ONLY_BRIDGE_BASE_REVISION = '387ae45ae6b58bf5a89b59ed43d6e6cc52209fff';

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
