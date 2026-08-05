#!/usr/bin/env node
const path = require('node:path');

process.env.DB_STORAGE = path.resolve(__dirname, '../database.sqlite');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const sequelize = require('../config/database');
const migrationService = require('../services/V5SnapshotMigrationService');

async function main() {
  const apply = process.argv.includes('--apply');
  await sequelize.authenticate();
  const preflight = await migrationService.audit({ sequelize });
  if (!apply) {
    process.stdout.write(JSON.stringify({ phase: 'preflight_audit', ...preflight }));
    return;
  }
  const result = await migrationService.apply({ sequelize });
  process.stdout.write(JSON.stringify({ phase: 'migration_complete', ...result }));
}

main()
  .catch(async (error) => {
    console.error('v5 快照字段迁移失败：', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await sequelize.close();
    } catch (_) { /* ignore */ }
  });
