#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3');
const { verifyBackupManifest } = require('./backupSqlite');

const backendDirectory = path.resolve(__dirname, '..');
require('dotenv').config({
  path: path.join(backendDirectory, '.env'),
  override: false,
  quiet: true
});

function argumentError(message) {
  const error = new Error(message);
  error.code = 'V5_SNAPSHOT_ARGUMENT_INVALID';
  return error;
}

function parseArguments(values) {
  const options = {
    apply: false,
    requireReady: false,
    quickCheck: false,
    database: '',
    backupReference: '',
    backupManifest: '',
    releaseRevision: ''
  };
  const seen = new Set();
  for (const value of values) {
    let key;
    let parsedValue;
    if (
      value === '--apply'
      || value === '--require-ready'
      || value === '--quick-check'
    ) {
      key = value;
      parsedValue = true;
    } else if (value.startsWith('--db=')) {
      key = '--db';
      parsedValue = value.slice('--db='.length).trim();
    } else if (value.startsWith('--backup-reference=')) {
      key = '--backup-reference';
      parsedValue = value.slice('--backup-reference='.length).trim();
    } else if (value.startsWith('--backup-manifest=')) {
      key = '--backup-manifest';
      parsedValue = value.slice('--backup-manifest='.length).trim();
    } else if (value.startsWith('--release-revision=')) {
      key = '--release-revision';
      parsedValue = value.slice('--release-revision='.length).trim();
    } else {
      throw argumentError(`不支持的参数：${value}`);
    }
    if (seen.has(key)) throw argumentError(`参数不得重复：${key}`);
    if (parsedValue !== true && !parsedValue) {
      throw argumentError(`参数不得为空：${key}`);
    }
    seen.add(key);
    if (key === '--apply') options.apply = true;
    if (key === '--require-ready') options.requireReady = true;
    if (key === '--quick-check') options.quickCheck = true;
    if (key === '--db') options.database = parsedValue;
    if (key === '--backup-reference') options.backupReference = parsedValue;
    if (key === '--backup-manifest') options.backupManifest = parsedValue;
    if (key === '--release-revision') options.releaseRevision = parsedValue;
  }
  if (options.apply && options.requireReady) {
    throw argumentError('--apply 与 --require-ready 必须分两次执行');
  }
  if (options.quickCheck && !options.requireReady) {
    throw argumentError('--quick-check 仅允许与 --require-ready 一起执行');
  }
  if (
    !options.apply
    && (options.backupReference || options.backupManifest || options.releaseRevision)
  ) {
    throw argumentError('备份与 release 参数仅允许用于 --apply');
  }
  if (options.releaseRevision && !/^[a-f0-9]{40}$/u.test(options.releaseRevision)) {
    throw argumentError('--release-revision 必须是完整的 40 位 commit');
  }
  return options;
}

function configureDatabaseTarget(options) {
  const explicitDatabase = options.database;
  if (explicitDatabase) {
    process.env.DB_STORAGE = path.resolve(explicitDatabase);
    delete process.env.DATABASE_URL;
  } else if (!process.env.DATABASE_URL) {
    const configured = String(process.env.DB_STORAGE || 'database.sqlite').trim();
    process.env.DB_STORAGE = path.isAbsolute(configured)
      ? configured
      : path.resolve(backendDirectory, configured);
  }

  if (!process.env.DATABASE_URL) {
    const databasePath = process.env.DB_STORAGE;
    let stat;
    try {
      stat = fs.lstatSync(databasePath);
    } catch (error) {
      const missing = new Error(`SQLite 数据库不存在: ${databasePath}`, {
        cause: error
      });
      missing.code = 'V5_SNAPSHOT_DATABASE_NOT_FOUND';
      throw missing;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      const invalid = new Error(`SQLite 数据库不是普通文件: ${databasePath}`);
      invalid.code = 'V5_SNAPSHOT_DATABASE_INVALID';
      throw invalid;
    }
    options.sqliteIdentity = {
      path: fs.realpathSync(databasePath),
      dev: stat.dev,
      ino: stat.ino
    };
  }
}

function assertDatabaseTargetUnchanged(options) {
  if (!options.sqliteIdentity) return;
  const current = fs.lstatSync(options.sqliteIdentity.path);
  if (
    !current.isFile()
    || current.isSymbolicLink()
    || current.dev !== options.sqliteIdentity.dev
    || current.ino !== options.sqliteIdentity.ino
  ) {
    const error = new Error('SQLite 数据库在校验后发生替换');
    error.code = 'V5_SNAPSHOT_DATABASE_CHANGED';
    throw error;
  }
}

function openReadonly(filename) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(filename, sqlite3.OPEN_READONLY, (error) => {
      if (error) reject(error);
      else resolve(database);
    });
  });
}

function get(database, sql) {
  return new Promise((resolve, reject) => {
    database.get(sql, (error, row) => {
      if (error) reject(error);
      else resolve(row || {});
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

async function inspectSqliteDatabase(filename) {
  const database = await openReadonly(filename);
  try {
    const integrity = await get(database, 'PRAGMA quick_check');
    const table = await get(
      database,
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'question_records'"
    );
    if (table.present !== 1) {
      return {
        integrity: integrity.quick_check,
        requiredTablePresent: false
      };
    }
    return {
      integrity: integrity.quick_check,
      requiredTablePresent: true
    };
  } finally {
    await close(database);
  }
}

async function sqliteSnapshotColumnReady(filename) {
  const database = await openReadonly(filename);
  try {
    const column = await get(
      database,
      "SELECT type, \"notnull\" AS not_null, dflt_value FROM pragma_table_info('question_records') WHERE name = 'competitor_snapshot'"
    );
    const type = String(column.type || '').trim().toUpperCase();
    return (
      (type === 'JSON' || type === 'JSONB')
      && Number(column.not_null) === 0
      && column.dflt_value == null
    );
  } finally {
    await close(database);
  }
}

async function validateBackupReference(options) {
  const backupReference = options.backupReference;
  if (!backupReference) {
    const error = new Error('v5 快照字段迁移要求提供备份引用');
    error.code = 'V5_SNAPSHOT_BACKUP_REQUIRED';
    throw error;
  }
  if (process.env.DATABASE_URL) return backupReference;

  const backupPath = path.resolve(backupReference);
  let stat;
  try {
    stat = fs.lstatSync(backupPath);
  } catch (error) {
    const missing = new Error(`SQLite 备份不存在: ${backupPath}`, {
      cause: error
    });
    missing.code = 'V5_SNAPSHOT_BACKUP_REQUIRED';
    throw missing;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0) {
    const invalid = new Error(`SQLite 备份不是非空普通文件: ${backupPath}`);
    invalid.code = 'V5_SNAPSHOT_BACKUP_REQUIRED';
    throw invalid;
  }
  if (!options.backupManifest || !options.releaseRevision) {
    const error = new Error('SQLite 迁移要求备份 manifest 和 release revision');
    error.code = 'V5_SNAPSHOT_BACKUP_MANIFEST_REQUIRED';
    throw error;
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    const invalid = new Error('SQLite 备份权限必须为 0600 或更严格');
    invalid.code = 'V5_SNAPSHOT_BACKUP_INVALID';
    throw invalid;
  }
  const activePath = path.resolve(process.env.DB_STORAGE);
  const activeStat = fs.statSync(activePath);
  if (
    activePath === backupPath
    || (activeStat.dev === stat.dev && activeStat.ino === stat.ino)
  ) {
    const sameFile = new Error('SQLite 活动数据库不能同时作为迁移备份');
    sameFile.code = 'V5_SNAPSHOT_BACKUP_REQUIRED';
    throw sameFile;
  }
  try {
    await verifyBackupManifest({
      sourcePath: activePath,
      backupPath,
      manifestPath: options.backupManifest,
      revision: options.releaseRevision
    });
  } catch (error) {
    const invalid = new Error('SQLite 备份 manifest 与迁移目标不匹配', { cause: error });
    invalid.code = 'V5_SNAPSHOT_BACKUP_TARGET_MISMATCH';
    throw invalid;
  }
  return backupPath;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  configureDatabaseTarget(options);
  assertDatabaseTargetUnchanged(options);
  let backupValidated = false;
  if (options.apply) {
    const sqliteAlreadyReady = options.sqliteIdentity
      ? await sqliteSnapshotColumnReady(options.sqliteIdentity.path)
      : false;
    if (!sqliteAlreadyReady) {
      await validateBackupReference(options);
      backupValidated = true;
      assertDatabaseTargetUnchanged(options);
    }
  }
  const sequelize = require('../config/database');
  const migrationService = require('../services/V5SnapshotMigrationService');
  try {
    await sequelize.authenticate();
    assertDatabaseTargetUnchanged(options);
    const preflight = await migrationService.audit({ sequelize });
    if (
      options.apply
      && preflight.schema_mismatches.length > 0
    ) {
      const error = new Error('v5 快照字段存在不兼容结构');
      error.code = 'V5_SNAPSHOT_SCHEMA_MISMATCH';
      error.schema_mismatches = preflight.schema_mismatches;
      throw error;
    }
    if (options.apply && !preflight.ready && !backupValidated) {
      await validateBackupReference(options);
      assertDatabaseTargetUnchanged(options);
    }
    const result = options.apply
      ? await migrationService.apply({ sequelize })
      : preflight;
    if (options.requireReady && !result.ready) {
      const error = new Error('v5 快照字段复审未通过');
      error.code = 'V5_SNAPSHOT_AUDIT_NOT_READY';
      error.missing_columns = result.missing_columns;
      error.schema_mismatches = result.schema_mismatches;
      throw error;
    }
    if (options.quickCheck) {
      if (!options.sqliteIdentity) {
        throw argumentError('--quick-check 当前仅支持 SQLite');
      }
      let inspection;
      try {
        inspection = await inspectSqliteDatabase(options.sqliteIdentity.path);
      } catch (error) {
        const invalid = new Error('SQLite 迁移目标 quick_check 执行失败', { cause: error });
        invalid.code = 'V5_SNAPSHOT_DATABASE_INVALID';
        throw invalid;
      }
      if (inspection.integrity !== 'ok' || !inspection.requiredTablePresent) {
        const invalid = new Error('SQLite 迁移目标 quick_check 未通过');
        invalid.code = 'V5_SNAPSHOT_DATABASE_INVALID';
        throw invalid;
      }
      result.integrity = inspection.integrity;
    }
    process.stdout.write(JSON.stringify({
      phase: options.apply ? 'migration_complete' : 'preflight_audit',
      ...result
    }));
  } finally {
    await sequelize.close().catch(() => {});
  }
}

main().catch((error) => {
  process.stderr.write(JSON.stringify({
    phase: 'migration_failed',
    error_code: error?.code || 'V5_SNAPSHOT_MIGRATION_FAILED',
    message: error?.message || 'v5 快照字段迁移失败',
    missing_columns: error?.missing_columns || [],
    schema_mismatches: error?.schema_mismatches || []
  }));
  process.exitCode = 1;
});
