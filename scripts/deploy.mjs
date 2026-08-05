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
const marketingMigrationScript = path.join(
  backendDirectory,
  'scripts',
  'migrateMarketing.js'
);
const marketingExpectedLatest = '014-unified-oauth-context';
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

async function git(args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: projectRoot,
    maxBuffer: 10 * 1024 * 1024,
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

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || projectRoot,
      env: options.env || process.env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `${options.label || command}失败${signal ? `，信号 ${signal}` : `，退出码 ${code}`}`
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

export async function deploy(preparedRevision = '', { lockAlreadyAcquired = false } = {}) {
  const initial = await checkPreconditions();
  assertPreparedRevision(preparedRevision, initial.revision);
  if (!lockAlreadyAcquired) await acquireDeploymentLock();
  let servicesStopped = false;
  let databaseBackupReference = '';

  try {
    let revision;
    if (preparedRevision) {
      console.log('1/12 校验已上传的预置版本');
      revision = await git(['rev-parse', 'HEAD']);
      assertPreparedRevision(preparedRevision, revision);
    } else {
      console.log('1/12 拉取 origin/main');
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

    console.log('2/12 停止受管生产进程');
    await run(process.execPath, [productionScript, 'stop'], {
      label: '停止生产进程',
    });
    servicesStopped = true;

    if (checked.databaseType === 'sqlite') {
      console.log('3/12 创建不可覆盖的 release 备份并更新 SQLite 最新备份');
      const backupPath =
        process.env.AI_GEO_SQLITE_BACKUP_PATH ||
        path.join(
          path.dirname(checked.databasePath),
          'database.latest.sqlite'
        );
      const releaseBackupDirectory =
        process.env.AI_GEO_SQLITE_RELEASE_BACKUP_DIR ||
        path.join(path.dirname(backupPath), 'releases');
      const releaseBackupPath = path.join(
        releaseBackupDirectory,
        `database.pre-${revision}.sqlite`
      );
      await run(
        process.execPath,
        [backupScript, checked.databasePath, releaseBackupPath, '--if-absent'],
        { label: 'SQLite release 备份' }
      );
      await run(process.execPath, [backupScript, checked.databasePath, backupPath], {
        label: 'SQLite 最新备份',
      });
      databaseBackupReference = releaseBackupPath;
    } else {
      console.log('3/12 使用外部 Postgres，检查外部备份确认');
      databaseBackupReference = String(
        process.env.AI_GEO_DATABASE_BACKUP_REFERENCE || ''
      ).trim();
      if (!databaseBackupReference) {
        throw new Error(
          'Postgres 部署前必须通过 AI_GEO_DATABASE_BACKUP_REFERENCE 确认外部备份'
        );
      }
    }

    console.log('4/12 安装后端依赖');
    await run('npm', ['ci', '--include=dev'], {
      cwd: backendDirectory,
      label: '后端 npm ci',
    });
    console.log('5/12 运行后端测试');
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
    console.log('6/12 安装并静态检查前端依赖');
    await run('npm', ['ci', '--include=dev'], {
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
    console.log('7/12 构建并验收前端生产产物');
    await run('npm', ['run', 'build'], {
      cwd: frontendDirectory,
      env: { ...process.env, AI_GEO_BUILD_REVISION: revision },
      label: '前端生产构建',
    });
    await run('npm', ['run', 'test:marketing:browser'], {
      cwd: frontendDirectory,
      label: '前端营销浏览器验收',
    });
    console.log('8/12 迁移并复审 GEO 指标语义');
    const backendConfig = parseEnvFile(path.join(backendDirectory, '.env'));
    const migrationEnvironment = { ...backendConfig, ...process.env };
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

    console.log('9/12 应用并复审营销模块迁移');
    await run(process.execPath, [
      marketingMigrationScript,
      '--apply',
      `--expected-latest=${marketingExpectedLatest}`,
    ], {
      cwd: backendDirectory,
      env: migrationEnvironment,
      label: '营销模块迁移',
    });
    await run(process.execPath, [
      marketingMigrationScript,
      `--expected-latest=${marketingExpectedLatest}`,
    ], {
      cwd: backendDirectory,
      env: migrationEnvironment,
      label: '营销模块迁移复审',
    });

    console.log('10/12 应用并复审官网数据迁移');
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

    console.log('11/12 应用并复审原始咨询迁移');
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

    console.log('12/12 启动并检查前后端');
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

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
