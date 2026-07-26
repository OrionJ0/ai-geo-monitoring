const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const databaseConfigPath = require.resolve('../config/database');

function loadDatabaseWithEnv(env) {
  const originalEnv = { ...process.env };
  Object.assign(process.env, env);
  for (const key of ['DATABASE_URL', 'DB_STORAGE', 'NODE_ENV']) {
    if (!(key in env)) {
      delete process.env[key];
    }
  }
  delete require.cache[databaseConfigPath];

  try {
    return require('../config/database');
  } finally {
    delete require.cache[databaseConfigPath];
    process.env = originalEnv;
  }
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function waitForResponse(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await fetch(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

test('sqlite connections apply the required concurrency pragmas before becoming usable', () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-sqlite-readiness-'));
  const databasePath = path.join(tempDirectory, 'readiness.sqlite');
  const script = `
    const sequelize = require('./config/database');

    (async () => {
      await sequelize.authenticate();
      const [journalRows] = await sequelize.query('PRAGMA journal_mode;');
      const [timeoutRows] = await sequelize.query('PRAGMA busy_timeout;');
      const [synchronousRows] = await sequelize.query('PRAGMA synchronous;');
      console.log(JSON.stringify({
        journalMode: String(journalRows[0].journal_mode).toLowerCase(),
        busyTimeout: Number(timeoutRows[0].timeout),
        synchronous: Number(synchronousRows[0].synchronous),
        readiness: sequelize.getReadiness()
      }));
      await sequelize.close();
    })().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  `;

  try {
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DB_LOGGING: 'false',
        DB_STORAGE: databasePath,
        DATABASE_URL: ''
      },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr);
    const pragmas = JSON.parse(result.stdout.trim());
    assert.equal(pragmas.journalMode, 'wal');
    assert.ok(pragmas.busyTimeout >= 5000);
    assert.equal(pragmas.synchronous, 1);
    assert.deepEqual(pragmas.readiness, {
      status: 'ready',
      dialect: 'sqlite',
      journal_mode: 'wal',
      busy_timeout_ms: 5000,
      synchronous: 'normal',
      last_error_code: null
    });
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('in-memory sqlite connections keep their supported journal mode and still become ready', () => {
  const script = `
    const sequelize = require('./config/database');

    (async () => {
      await sequelize.authenticate();
      console.log(JSON.stringify(sequelize.getReadiness()));
      await sequelize.close();
    })().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_LOGGING: 'false',
      DB_STORAGE: ':memory:',
      DATABASE_URL: ''
    },
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  const readiness = JSON.parse(result.stdout.trim());
  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.dialect, 'sqlite');
  assert.equal(readiness.journal_mode, 'memory');
  assert.ok(readiness.busy_timeout_ms >= 5000);
  assert.equal(readiness.synchronous, 'normal');
});

test('sqlite pragma failures reject connection startup and expose only a stable readiness code', () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-sqlite-failure-'));
  const databasePath = path.join(tempDirectory, 'readiness.sqlite');
  const preloadPath = path.join(__dirname, 'fixtures/failSqlitePragma.js');
  const script = `
    const sequelize = require('./config/database');

    (async () => {
      try {
        await sequelize.authenticate();
        throw new Error('expected sqlite configuration to fail');
      } catch (error) {
        console.log(JSON.stringify({
          errorMessage: error.message,
          readiness: sequelize.getReadiness()
        }));
      } finally {
        await sequelize.close();
      }
    })().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  `;

  try {
    const result = spawnSync(process.execPath, ['--require', preloadPath, '-e', script], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DB_LOGGING: 'false',
        DB_STORAGE: databasePath,
        DATABASE_URL: ''
      },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr);
    const failure = JSON.parse(result.stdout.trim());
    assert.equal(failure.errorMessage, 'forced sqlite pragma failure');
    assert.deepEqual(failure.readiness, {
      status: 'error',
      dialect: 'sqlite',
      last_error_code: 'sqlite_configuration_failed'
    });
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('uses Supabase Postgres when DATABASE_URL is configured without applying SQLite readiness fields', async () => {
  const sequelize = loadDatabaseWithEnv({
    DATABASE_URL: 'postgresql://postgres:secret@db.example.supabase.co:5432/postgres',
    NODE_ENV: 'production'
  });

  try {
    assert.equal(sequelize.getDialect(), 'postgres');
    assert.equal(sequelize.options.dialectOptions.ssl.require, true);
    assert.equal(sequelize.options.dialectOptions.ssl.rejectUnauthorized, false);
    assert.equal(sequelize.options.logging, false);
    assert.deepEqual(sequelize.getReadiness(), {
      status: 'initializing',
      dialect: 'postgres',
      last_error_code: null
    });
    await sequelize.runHooks('afterConnect', {}, sequelize.config);
    assert.deepEqual(sequelize.getReadiness(), {
      status: 'ready',
      dialect: 'postgres',
      last_error_code: null
    });
  } finally {
    await sequelize.close();
  }
});

test('keeps SQLite for local development when DATABASE_URL is not configured', async () => {
  const sequelize = loadDatabaseWithEnv({
    DB_STORAGE: 'local-test.sqlite',
    NODE_ENV: 'development'
  });

  try {
    assert.equal(sequelize.getDialect(), 'sqlite');
    assert.equal(sequelize.options.storage, 'local-test.sqlite');
    assert.equal(typeof sequelize.options.logging, 'function');
  } finally {
    await sequelize.close();
  }
});

test('existing SQLite schemas add indexed execution columns before model index sync', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-legacy-startup-'));
  const databasePath = path.join(tempDirectory, 'legacy.sqlite');
  const port = await reservePort();
  const prepareScript = `
    const { sequelize } = require('./models');
    (async () => {
      await sequelize.sync({ force: true });
      await sequelize.query('DROP INDEX IF EXISTS question_records_scheduled_execution_id');
      await sequelize.query('ALTER TABLE question_records DROP COLUMN scheduled_execution_id');
      await sequelize.close();
    })().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  `;
  const prepared = spawnSync(process.execPath, ['-e', prepareScript], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_LOGGING: 'false',
      DB_STORAGE: databasePath,
      DATABASE_URL: ''
    },
    encoding: 'utf8'
  });
  assert.equal(prepared.status, 0, prepared.stderr);

  const child = spawn(process.execPath, ['app.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_LOGGING: 'false',
      DB_STORAGE: databasePath,
      DATABASE_URL: '',
      HOST: '127.0.0.1',
      PORT: String(port),
      JWT_SECRET: 'test-legacy-startup-jwt-secret',
      CONFIG_ENCRYPTION_KEY: '0'.repeat(64),
      DEFAULT_ADMIN_PASSWORD: 'test-legacy-startup-admin-password'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    const response = await waitForResponse(`http://127.0.0.1:${port}/api/ready`, 3000);
    assert.equal(response.status, 200, stderr);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once('exit', resolve);
    });
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('ready endpoint reports verified database and scheduler startup state', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-ready-endpoint-'));
  const databasePath = path.join(tempDirectory, 'ready.sqlite');
  const port = await reservePort();
  const child = spawn(process.execPath, ['app.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_LOGGING: 'false',
      DB_STORAGE: databasePath,
      DATABASE_URL: '',
      HOST: '127.0.0.1',
      PORT: String(port),
      JWT_SECRET: 'test-readiness-jwt-secret',
      CONFIG_ENCRYPTION_KEY: '0'.repeat(64),
      DEFAULT_ADMIN_PASSWORD: 'test-readiness-admin-password'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    const response = await waitForResponse(`http://127.0.0.1:${port}/api/ready`);
    const body = await response.json();
    assert.equal(response.status, 200, stderr || JSON.stringify(body));
    assert.equal(body.status, 'ready');
    assert.equal(body.checks.database.status, 'ready');
    assert.equal(body.checks.database.journal_mode, 'wal');
    assert.ok(body.checks.database.busy_timeout_ms >= 5000);
    assert.equal(body.checks.scheduler.started, true);
    assert.ok(body.checks.scheduler.last_recovery_at);
    assert.deepEqual(body.checks.scheduler.scheduled_executions, {
      claimed: 0,
      duplicate_claims: 0,
      stale_claims: 0,
      completed: 0,
      failed: 0,
      last_claimed_at: null,
      last_error_code: null
    });
    assert.equal(body.checks.last_error, null);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once('exit', resolve);
    });
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('ready endpoint returns 503 when scheduler initialization fails', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-ready-failure-'));
  const databasePath = path.join(tempDirectory, 'ready.sqlite');
  const port = await reservePort();
  const preloadPath = path.join(__dirname, 'fixtures/failSchedulerRefresh.js');
  const child = spawn(process.execPath, ['app.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${preloadPath}`].filter(Boolean).join(' '),
      DB_LOGGING: 'false',
      DB_STORAGE: databasePath,
      DATABASE_URL: '',
      HOST: '127.0.0.1',
      PORT: String(port),
      JWT_SECRET: 'test-readiness-jwt-secret',
      CONFIG_ENCRYPTION_KEY: '0'.repeat(64),
      DEFAULT_ADMIN_PASSWORD: 'test-readiness-admin-password'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    const response = await waitForResponse(`http://127.0.0.1:${port}/api/ready`);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.status, 'not_ready');
    assert.equal(body.checks.database.status, 'ready');
    assert.equal(body.checks.scheduler.started, false);
    assert.equal(body.checks.last_error, 'scheduler_initialization_failed');
    const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(healthResponse.status, 200);
    assert.equal((await healthResponse.json()).status, 'OK');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once('exit', resolve);
    });
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});
