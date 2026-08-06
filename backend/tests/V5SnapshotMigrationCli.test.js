const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { promisify } = require('node:util');
const sqlite3 = require('sqlite3');
const { backupDatabase } = require('../scripts/backupSqlite');

const testRevision = 'a'.repeat(40);

const execFileAsync = promisify(execFile);
const migrationScript = path.resolve(
  __dirname,
  '../scripts/migrateV5SnapshotFields.js'
);

function openDatabase(filename) {
  return new sqlite3.Database(filename);
}

function run(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.run(sql, params, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function all(database, sql) {
  return new Promise((resolve, reject) => {
    database.all(sql, (error, rows) => {
      if (error) reject(error);
      else resolve(rows);
    });
  });
}

function close(database) {
  return new Promise((resolve, reject) => {
    database.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function createLegacyDatabase(filename, marker) {
  const database = openDatabase(filename);
  await run(
    database,
    'CREATE TABLE question_records (id INTEGER PRIMARY KEY, question TEXT NOT NULL, status TEXT)'
  );
  await run(
    database,
    'INSERT INTO question_records (id, question, status) VALUES (?, ?, ?)',
    [1, marker, 'completed']
  );
  await close(database);
}

async function snapshot(filename) {
  const database = openDatabase(filename);
  const result = {
    columns: await all(database, "PRAGMA table_info('question_records')"),
    rows: await all(
      database,
      'SELECT id, question, status FROM question_records ORDER BY id'
    )
  };
  await close(database);
  return result;
}

async function executeMigration(args, environment = {}) {
  return execFileAsync(
    process.execPath,
    [migrationScript, ...args],
    { env: { ...process.env, ...environment } }
  );
}

async function createBackup(databasePath) {
  const backupPath = `${databasePath}.backup`;
  const manifestPath = `${backupPath}.manifest.json`;
  await backupDatabase({
    sourcePath: databasePath,
    backupPath,
    ifAbsent: true,
    manifestPath,
    revision: testRevision
  });
  return { backupPath, manifestPath, revision: testRevision };
}

function backupArguments(backup) {
  return [
    `--backup-reference=${backup.backupPath}`,
    `--backup-manifest=${backup.manifestPath}`,
    `--release-revision=${backup.revision}`
  ];
}

test('显式 --db 只迁移指定旧库，并保持历史记录不变', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v5-snapshot-migration-'));
  const targetPath = path.join(directory, 'target.sqlite');
  const otherPath = path.join(directory, 'other.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  await createLegacyDatabase(targetPath, '目标数据库历史问题');
  await createLegacyDatabase(otherPath, '其他数据库历史问题');
  const before = await snapshot(targetPath);
  const backup = await createBackup(targetPath);

  const environment = { ...process.env, DB_STORAGE: otherPath };
  delete environment.DATABASE_URL;
  const { stdout } = await executeMigration(
    ['--apply', `--db=${targetPath}`, ...backupArguments(backup)],
    environment
  );

  const result = JSON.parse(stdout);
  assert.deepEqual(result.applied_columns, [
    'question_records.competitor_snapshot'
  ]);
  assert.equal(result.migration_required, false);
  assert.equal(result.ready, true);
  assert.deepEqual(result.schema_mismatches, []);

  const after = await snapshot(targetPath);
  assert.deepEqual(after.rows, before.rows);
  assert.ok(after.columns.some((column) => column.name === 'competitor_snapshot'));
  const migrated = openDatabase(targetPath);
  assert.deepEqual(
    await all(
      migrated,
      'SELECT id, competitor_snapshot FROM question_records ORDER BY id'
    ),
    [{ id: 1, competitor_snapshot: null }]
  );
  await close(migrated);
  const other = await snapshot(otherPath);
  assert.equal(
    other.columns.some((column) => column.name === 'competitor_snapshot'),
    false
  );
});

test('重复执行迁移为幂等 no-op', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v5-snapshot-idempotent-'));
  const databasePath = path.join(directory, 'database.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await createLegacyDatabase(databasePath, '幂等历史问题');
  const backup = await createBackup(databasePath);

  const args = [
    '--apply',
    `--db=${databasePath}`,
    ...backupArguments(backup)
  ];
  await executeMigration(args);
  const second = await executeMigration(args);
  const result = JSON.parse(second.stdout);

  assert.deepEqual(result.applied_columns, []);
  assert.deepEqual(result.missing_columns, []);
  assert.equal(result.migration_required, false);
  assert.deepEqual((await snapshot(databasePath)).rows, [
    { id: 1, question: '幂等历史问题', status: 'completed' }
  ]);
});

test('数据库文件不存在时 fail-closed 且不创建空库', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v5-snapshot-missing-'));
  const databasePath = path.join(directory, 'missing.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  await assert.rejects(
    executeMigration(['--apply', `--db=${databasePath}`]),
    (error) => {
      const failure = JSON.parse(String(error.stderr));
      assert.equal(failure.error_code, 'V5_SNAPSHOT_DATABASE_NOT_FOUND');
      return true;
    }
  );
  assert.equal(fs.existsSync(databasePath), false);
});

test('缺少 question_records 时 fail-closed 且不创建业务表', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v5-snapshot-no-table-'));
  const databasePath = path.join(directory, 'database.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const database = openDatabase(databasePath);
  await run(database, 'CREATE TABLE sentinel (id INTEGER PRIMARY KEY)');
  await close(database);
  const backup = await createBackup(databasePath);

  await assert.rejects(
    executeMigration([
      '--apply',
      `--db=${databasePath}`,
      ...backupArguments(backup)
    ]),
    (error) => {
      const failure = JSON.parse(String(error.stderr));
      assert.equal(
        failure.error_code,
        'V5_SNAPSHOT_REQUIRED_TABLE_MISSING'
      );
      return true;
    }
  );

  const verify = openDatabase(databasePath);
  const tables = await all(
    verify,
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
  );
  await close(verify);
  assert.deepEqual(tables, [{ name: 'sentinel' }]);
});

test('未传 --db 时尊重既有 DB_STORAGE', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v5-snapshot-env-db-'));
  const databasePath = path.join(directory, 'configured.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await createLegacyDatabase(databasePath, '环境配置历史问题');
  const backup = await createBackup(databasePath);
  const environment = { ...process.env, DB_STORAGE: databasePath };
  delete environment.DATABASE_URL;

  const { stdout } = await executeMigration(
    ['--apply', ...backupArguments(backup)],
    environment
  );
  const result = JSON.parse(stdout);

  assert.deepEqual(result.missing_columns, []);
  assert.equal(result.migration_required, false);
  assert.ok(
    (await snapshot(databasePath)).columns
      .some((column) => column.name === 'competitor_snapshot')
  );
});

test('SQLite apply 在备份引用不存在时 fail-closed', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v5-snapshot-backup-'));
  const databasePath = path.join(directory, 'database.sqlite');
  const missingBackupPath = path.join(directory, 'missing-backup.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await createLegacyDatabase(databasePath, '备份门禁历史问题');

  await assert.rejects(
    executeMigration([
      '--apply',
      `--db=${databasePath}`,
      `--backup-reference=${missingBackupPath}`
    ]),
    (error) => {
      const failure = JSON.parse(String(error.stderr));
      assert.equal(failure.error_code, 'V5_SNAPSHOT_BACKUP_REQUIRED');
      return true;
    }
  );
  assert.equal(
    (await snapshot(databasePath)).columns
      .some((column) => column.name === 'competitor_snapshot'),
    false
  );
});

test('SQLite apply 拒绝非数据库、符号链接和活动库硬链接备份', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v5-snapshot-invalid-backup-'));
  const databasePath = path.join(directory, 'database.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await createLegacyDatabase(databasePath, '非法备份门禁');

  const textPath = path.join(directory, 'backup.txt');
  fs.writeFileSync(textPath, 'not a sqlite backup');
  fs.chmodSync(textPath, 0o600);
  const symlinkPath = path.join(directory, 'backup-link.sqlite');
  fs.symlinkSync(databasePath, symlinkPath);
  const hardlinkPath = path.join(directory, 'backup-hardlink.sqlite');
  fs.linkSync(databasePath, hardlinkPath);

  for (const backupPath of [textPath, symlinkPath, hardlinkPath]) {
    await assert.rejects(
      executeMigration([
        '--apply',
        `--db=${databasePath}`,
        `--backup-reference=${backupPath}`,
        `--backup-manifest=${path.join(directory, 'missing-manifest.json')}`,
        `--release-revision=${testRevision}`
      ]),
      (error) => {
        const failure = JSON.parse(String(error.stderr));
        assert.match(failure.error_code, /^V5_SNAPSHOT_BACKUP_/u);
        return true;
      }
    );
  }
  assert.equal(
    (await snapshot(databasePath)).columns
      .some((column) => column.name === 'competitor_snapshot'),
    false
  );
});

test('SQLite apply 拒绝内容不属于当前目标的有效备份', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v5-snapshot-wrong-backup-'));
  const databasePath = path.join(directory, 'database.sqlite');
  const otherPath = path.join(directory, 'other.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await createLegacyDatabase(databasePath, '相同历史内容');
  await createLegacyDatabase(otherPath, '相同历史内容');
  const target = openDatabase(databasePath);
  await run(target, 'CREATE TABLE business_data (value TEXT NOT NULL)');
  await run(target, "INSERT INTO business_data (value) VALUES ('target')");
  await close(target);
  const other = openDatabase(otherPath);
  await run(other, 'CREATE TABLE business_data (value TEXT NOT NULL)');
  await run(other, "INSERT INTO business_data (value) VALUES ('other')");
  await close(other);
  const wrongBackup = await createBackup(otherPath);

  await assert.rejects(
    executeMigration([
      '--apply',
      `--db=${databasePath}`,
      ...backupArguments(wrongBackup)
    ]),
    (error) => {
      const failure = JSON.parse(String(error.stderr));
      assert.equal(
        failure.error_code,
        'V5_SNAPSHOT_BACKUP_TARGET_MISMATCH'
      );
      return true;
    }
  );
});

test('严格参数解析拒绝缺值、空值、重复和未知参数', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v5-snapshot-args-'));
  const databasePath = path.join(directory, 'database.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await createLegacyDatabase(databasePath, '参数校验历史问题');

  const invalidArgumentSets = [
    ['--apply', '--db', databasePath],
    ['--apply', '--db='],
    ['--apply', `--db=${databasePath}`, `--db=${databasePath}`],
    ['--apply', `--bd=${databasePath}`]
  ];
  for (const args of invalidArgumentSets) {
    await assert.rejects(executeMigration(args), (error) => {
      const failure = JSON.parse(String(error.stderr));
      assert.equal(failure.error_code, 'V5_SNAPSHOT_ARGUMENT_INVALID');
      return true;
    });
  }
  assert.equal(
    (await snapshot(databasePath)).columns
      .some((column) => column.name === 'competitor_snapshot'),
    false
  );
});

test('require-ready 拒绝同名但类型、可空性或默认值不兼容的列', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v5-snapshot-schema-mismatch-'));
  const databasePath = path.join(directory, 'database.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const database = openDatabase(databasePath);
  await run(
    database,
    "CREATE TABLE question_records (id INTEGER PRIMARY KEY, question TEXT NOT NULL, competitor_snapshot TEXT NOT NULL DEFAULT '{}')"
  );
  await close(database);

  await assert.rejects(
    executeMigration(['--require-ready', `--db=${databasePath}`]),
    (error) => {
      const failure = JSON.parse(String(error.stderr));
      assert.equal(failure.error_code, 'V5_SNAPSHOT_AUDIT_NOT_READY');
      assert.deepEqual(failure.missing_columns, []);
      assert.deepEqual(failure.schema_mismatches, [
        'question_records.competitor_snapshot:type',
        'question_records.competitor_snapshot:nullable',
        'question_records.competitor_snapshot:default'
      ]);
      return true;
    }
  );
});

test('非缺表的 describeTable 故障保留为审计失败', async () => {
  const { V5SnapshotMigrationService } = require('../services/V5SnapshotMigrationService');
  const service = new V5SnapshotMigrationService();
  const database = {
    getDialect: () => 'sqlite',
    getQueryInterface: () => ({
      showAllTables: async () => ['question_records'],
      describeTable: async () => {
        throw new Error('synthetic lock failure');
      }
    })
  };

  await assert.rejects(
    service.audit({ sequelize: database }),
    (error) => {
      assert.equal(error.code, 'V5_SNAPSHOT_DATABASE_AUDIT_FAILED');
      return true;
    }
  );
});

test('require-ready 在缺列时阻断，迁移后返回 missing_columns=[]', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v5-snapshot-audit-'));
  const databasePath = path.join(directory, 'database.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await createLegacyDatabase(databasePath, '复审门禁历史问题');

  await assert.rejects(
    executeMigration(['--require-ready', `--db=${databasePath}`]),
    (error) => {
      const failure = JSON.parse(String(error.stderr));
      assert.equal(failure.error_code, 'V5_SNAPSHOT_AUDIT_NOT_READY');
      assert.deepEqual(failure.missing_columns, [
        'question_records.competitor_snapshot'
      ]);
      return true;
    }
  );

  const backup = await createBackup(databasePath);
  await executeMigration([
    '--apply',
    `--db=${databasePath}`,
    ...backupArguments(backup)
  ]);
  const { stdout } = await executeMigration([
    '--require-ready',
    '--quick-check',
    `--db=${databasePath}`
  ]);
  const result = JSON.parse(stdout);
  assert.deepEqual(result.missing_columns, []);
  assert.deepEqual(result.schema_mismatches, []);
  assert.equal(result.migration_required, false);
  assert.equal(result.ready, true);
  assert.equal(result.integrity, 'ok');
});
