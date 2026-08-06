#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const backendDirectory = path.resolve(__dirname, '..');
require('dotenv').config({
  path: path.join(backendDirectory, '.env'),
  override: false,
  quiet: true
});

function argumentError(message) {
  const error = new Error(message);
  error.code = 'DEEPSEEK_FLASH_CONFIG_ARGUMENT_INVALID';
  return error;
}

function parseArguments(values) {
  const options = {
    apply: false,
    requireReady: false,
    database: ''
  };
  const seen = new Set();
  for (const value of values) {
    let key;
    let parsedValue = true;
    if (value === '--apply' || value === '--require-ready') {
      key = value;
    } else if (value.startsWith('--db=')) {
      key = '--db';
      parsedValue = value.slice('--db='.length).trim();
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
    if (key === '--db') options.database = parsedValue;
  }
  if (options.apply === options.requireReady) {
    throw argumentError('--apply 与 --require-ready 必须且只能选择一个');
  }
  return options;
}

function configureDatabaseTarget(options) {
  if (options.database) {
    process.env.DB_STORAGE = path.resolve(options.database);
    delete process.env.DATABASE_URL;
  } else if (!process.env.DATABASE_URL) {
    const configured = String(process.env.DB_STORAGE || 'database.sqlite').trim();
    process.env.DB_STORAGE = path.isAbsolute(configured)
      ? configured
      : path.resolve(backendDirectory, configured);
  }

  if (process.env.DATABASE_URL) return null;
  const databasePath = process.env.DB_STORAGE;
  let stat;
  try {
    stat = fs.lstatSync(databasePath);
  } catch (error) {
    const missing = new Error('SQLite 数据库不存在', { cause: error });
    missing.code = 'DEEPSEEK_FLASH_CONFIG_DATABASE_NOT_FOUND';
    throw missing;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    const invalid = new Error('SQLite 数据库不是普通文件');
    invalid.code = 'DEEPSEEK_FLASH_CONFIG_DATABASE_INVALID';
    throw invalid;
  }
  return {
    path: fs.realpathSync(databasePath),
    dev: stat.dev,
    ino: stat.ino
  };
}

function assertDatabaseTargetUnchanged(identity) {
  if (!identity) return;
  const stat = fs.lstatSync(identity.path);
  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || stat.dev !== identity.dev
    || stat.ino !== identity.ino
  ) {
    const error = new Error('SQLite 数据库在校验后发生替换');
    error.code = 'DEEPSEEK_FLASH_CONFIG_DATABASE_CHANGED';
    throw error;
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const sqliteIdentity = configureDatabaseTarget(options);
  assertDatabaseTargetUnchanged(sqliteIdentity);
  const sequelize = require('../config/database');
  const { AIPlatformConfig, Setting } = require('../models');
  const {
    DeepSeekFlashConfigMigrationService
  } = require('../services/DeepSeekFlashConfigMigrationService');
  try {
    await sequelize.authenticate();
    assertDatabaseTargetUnchanged(sqliteIdentity);
    const service = new DeepSeekFlashConfigMigrationService({
      model: AIPlatformConfig,
      settingModel: Setting,
      sequelize
    });
    const result = options.apply
      ? await service.apply()
      : await service.audit();
    if (options.requireReady && !result.ready) {
      const error = new Error('DeepSeek Flash 配置尚未迁移');
      error.code = 'DEEPSEEK_FLASH_CONFIG_NOT_READY';
      throw error;
    }
    process.stdout.write(JSON.stringify({
      phase: options.apply ? 'migration_complete' : 'migration_audit',
      ...result
    }));
  } finally {
    await sequelize.close().catch(() => {});
  }
}

main().catch((error) => {
  process.stderr.write(JSON.stringify({
    phase: 'migration_failed',
    error_code: error?.code || 'DEEPSEEK_FLASH_CONFIG_MIGRATION_FAILED',
    message: error?.message || 'DeepSeek Flash 配置迁移失败'
  }));
  process.exitCode = 1;
});
