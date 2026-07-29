#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
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

async function git(args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: projectRoot,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

async function checkPreconditions() {
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
  if (!config.JWT_SECRET || config.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET 缺失或少于 32 个字符');
  }
  validateEncryptionKey(config.CONFIG_ENCRYPTION_KEY);

  let databasePath = null;
  if (!config.DATABASE_URL) {
    databasePath = path.resolve(
      backendDirectory,
      config.DB_STORAGE || 'database.sqlite'
    );
    if (!fs.existsSync(databasePath)) {
      throw new Error(`SQLite 数据库不存在: ${databasePath}`);
    }
  }

  return {
    branch,
    databasePath,
    databaseType: config.DATABASE_URL ? 'postgres' : 'sqlite',
    node: process.versions.node,
    ok: true,
  };
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

async function acquireLock() {
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

async function releaseLock() {
  await fs.promises.rm(lockDirectory, { recursive: true, force: true });
}

async function appendDeploymentLog(message) {
  await fs.promises.mkdir(logDirectory, { recursive: true });
  await fs.promises.appendFile(
    path.join(logDirectory, 'deployments.log'),
    `${new Date().toISOString()} ${message}\n`
  );
}

async function deploy() {
  const initial = await checkPreconditions();
  await acquireLock();
  let servicesStopped = false;
  let databaseBackupReference = '';

  try {
    console.log('1/10 拉取 origin/main');
    await run('git', ['pull', '--ff-only', 'origin', 'main'], {
      label: 'git pull',
    });
    const revision = await git(['rev-parse', 'HEAD']);
    const remoteRevision = await git(['rev-parse', 'origin/main']);
    if (revision !== remoteRevision) {
      throw new Error('HEAD 与 origin/main 不一致，拒绝部署服务器本地提交');
    }
    const checked = await checkPreconditions();

    console.log('2/10 停止受管生产进程');
    await run(process.execPath, [productionScript, 'stop'], {
      label: '停止生产进程',
    });
    servicesStopped = true;

    if (checked.databaseType === 'sqlite') {
      console.log('3/10 更新唯一的 SQLite 最新备份');
      const backupPath =
        process.env.AI_GEO_SQLITE_BACKUP_PATH ||
        path.join(
          path.dirname(checked.databasePath),
          'database.latest.sqlite'
        );
      await run(process.execPath, [backupScript, checked.databasePath, backupPath], {
        label: 'SQLite 备份',
      });
      databaseBackupReference = backupPath;
    } else {
      console.log('3/10 使用外部 Postgres，检查外部备份确认');
      databaseBackupReference = String(
        process.env.AI_GEO_DATABASE_BACKUP_REFERENCE || ''
      ).trim();
      if (!databaseBackupReference) {
        throw new Error(
          'Postgres 部署前必须通过 AI_GEO_DATABASE_BACKUP_REFERENCE 确认外部备份'
        );
      }
    }

    console.log('4/10 安装后端依赖');
    await run('npm', ['ci'], { cwd: backendDirectory, label: '后端 npm ci' });
    console.log('5/10 运行后端测试');
    await run('npm', ['test'], { cwd: backendDirectory, label: '后端测试' });
    await run('npm', ['run', 'test:marketing'], {
      cwd: backendDirectory,
      label: '后端营销测试',
    });
    console.log('6/10 安装并检查前端依赖');
    await run('npm', ['ci'], { cwd: frontendDirectory, label: '前端 npm ci' });
    await run('npm', ['test'], {
      cwd: frontendDirectory,
      label: '前端营销单元测试',
    });
    await run('npm', ['run', 'test:marketing:browser'], {
      cwd: frontendDirectory,
      label: '前端营销浏览器验收',
    });
    await run('npm', ['run', 'lint'], {
      cwd: frontendDirectory,
      label: '前端 lint',
    });
    console.log('7/10 构建前端生产产物');
    await run('npm', ['run', 'build'], {
      cwd: frontendDirectory,
      label: '前端生产构建',
    });
    console.log('8/10 迁移并复审 GEO 指标语义');
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

    console.log('9/10 应用并复审营销模块迁移');
    await run(process.execPath, [marketingMigrationScript, '--apply'], {
      cwd: backendDirectory,
      env: migrationEnvironment,
      label: '营销模块迁移',
    });
    await run(process.execPath, [marketingMigrationScript], {
      cwd: backendDirectory,
      env: migrationEnvironment,
      label: '营销模块迁移复审',
    });

    console.log('10/10 启动并检查前后端');
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
    await releaseLock();
  }

  return initial;
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const json = process.argv.includes('--json');
  if (checkOnly) {
    const result = await checkPreconditions();
    if (json) console.log(JSON.stringify(result));
    else console.log('部署前置检查通过');
    return;
  }
  await deploy();
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
