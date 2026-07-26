const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-run-ownership-migration-'));
process.env.DB_STORAGE = path.join(databaseDir, 'test.sqlite');
delete process.env.DATABASE_URL;

const {
  sequelize,
  User,
  BrandProject,
  QuestionRecord,
  QuestionSetRun
} = require('../models');
const QuestionSetRunOwnershipMigrationService = require('../services/QuestionSetRunOwnershipMigrationService');
const QuestionSetRunService = require('../services/QuestionSetRunService');

let user;
let project;

async function setLegacyRecordIds(runId, recordIds) {
  await sequelize.query(
    'UPDATE question_set_runs SET record_ids = :recordIds WHERE id = :runId',
    {
      replacements: {
        runId,
        recordIds: JSON.stringify(recordIds)
      }
    }
  );
}

async function ensureLegacyColumn() {
  const description = await sequelize.getQueryInterface().describeTable('question_set_runs');
  if (!description.record_ids) {
    await sequelize.getQueryInterface().addColumn('question_set_runs', 'record_ids', {
      type: require('sequelize').DataTypes.JSON,
      allowNull: false,
      defaultValue: []
    });
  }
}

async function createRun(values, recordIds) {
  const run = await QuestionSetRun.create({
    project_id: project.id,
    user_id: user.id,
    question_set_name: values.question_set_name,
    source: values.source || 'native',
    imported_rows: values.imported_rows || [],
    completed_at: values.completed_at || null
  });
  await setLegacyRecordIds(run.id, recordIds);
  return run;
}

test.before(async () => {
  await sequelize.sync({ force: true });
  await ensureLegacyColumn();
  user = await User.create({
    username: 'ownership-migration-user',
    email: 'ownership-migration@example.com',
    password: 'not-used',
    role: 'user',
    status: 'active'
  });
  project = await BrandProject.create({
    user_id: user.id,
    name: '迁移测试项目',
    platforms: ['deepseek'],
    status: 'active'
  });
});

test.after(async () => {
  await sequelize.close();
  fs.rmSync(databaseDir, { recursive: true, force: true });
});

test.beforeEach(async () => {
  await QuestionRecord.destroy({ where: {} });
  await QuestionSetRun.destroy({ where: {} });
  await ensureLegacyColumn();
});

test('audits legacy ownership read-only and migrates complete and damaged runs without fabricating records', async () => {
  const completeRecords = await QuestionRecord.bulkCreate([
    {
      user_id: user.id,
      project_id: project.id,
      platform: 'deepseek',
      question: '完整记录一',
      brand: project.name,
      brand_keywords: project.name,
      status: 'completed'
    },
    {
      user_id: user.id,
      project_id: project.id,
      platform: 'qwen',
      question: '完整记录二',
      brand: project.name,
      brand_keywords: project.name,
      status: 'failed'
    }
  ]);
  const snapshotRecord = await QuestionRecord.create({
    user_id: user.id,
    project_id: project.id,
    platform: 'deepseek',
    question: '快照仍有一条底层记录',
    brand: project.name,
    brand_keywords: project.name,
    status: 'completed'
  });
  const completeRun = await createRun(
    { question_set_name: '完整运行' },
    completeRecords.map((record) => record.id)
  );
  const snapshotRun = await createRun({
    question_set_name: '只读快照运行',
    imported_rows: [
      { record_id: snapshotRecord.id, question: '快照记录一', platform: 'deepseek', status: 'completed' },
      { record_id: 999001, question: '快照记录二', platform: 'qwen', status: 'failed' }
    ],
    completed_at: new Date('2026-07-20T01:00:00.000Z')
  }, [snapshotRecord.id, 999001]);
  const activeBrokenRun = await createRun(
    { question_set_name: '活跃缺失运行' },
    [999002]
  );
  const importedRun = await createRun({
    question_set_name: '导入报告',
    source: 'imported',
    imported_rows: [{ record_id: null, question: '导入数据', platform: 'deepseek', status: 'completed' }],
    completed_at: new Date('2026-07-20T02:00:00.000Z')
  }, [completeRecords[0].id]);

  const beforeUpdatedAt = completeRun.updated_at.toISOString();
  const audit = await QuestionSetRunOwnershipMigrationService.audit({ sequelize });

  assert.deepEqual({
    legacy_column_present: audit.legacy_column_present,
    native_run_count: audit.native_run_count,
    complete_run_count: audit.complete_run_count,
    snapshot_only_run_count: audit.snapshot_only_run_count,
    integrity_failed_run_count: audit.integrity_failed_run_count,
    missing_record_reference_count: audit.missing_record_reference_count,
    ownership_conflict_count: audit.ownership_conflict_count
  }, {
    legacy_column_present: true,
    native_run_count: 3,
    complete_run_count: 1,
    snapshot_only_run_count: 1,
    integrity_failed_run_count: 1,
    missing_record_reference_count: 2,
    ownership_conflict_count: 0
  });
  await completeRun.reload();
  assert.equal(completeRun.updated_at.toISOString(), beforeUpdatedAt);
  assert.equal(await QuestionRecord.count({ where: { question_set_run_id: completeRun.id } }), 0);

  await assert.rejects(
    QuestionSetRunOwnershipMigrationService.apply({ sequelize }),
    (error) => error.code === 'BACKUP_CONFIRMATION_REQUIRED'
  );

  const applied = await QuestionSetRunOwnershipMigrationService.apply({
    sequelize,
    backupReference: 'verified-backup-before-run-ownership'
  });
  assert.equal(applied.updated_run_count, 3);
  assert.equal(applied.updated_record_count, 3);
  assert.equal(applied.legacy_column_dropped, true);
  const migratedRunSchema = await sequelize
    .getQueryInterface()
    .describeTable('question_set_runs');
  assert.equal(migratedRunSchema.record_ids, undefined);
  const postflight = await QuestionSetRunOwnershipMigrationService.audit({ sequelize });
  assert.equal(postflight.legacy_column_present, false);
  assert.equal(postflight.ownership_columns_present, true);
  assert.equal(postflight.migration_required, false);

  const migratedComplete = await QuestionRecord.findAll({
    where: { question_set_run_id: completeRun.id },
    order: [['run_slot_index', 'ASC']]
  });
  assert.deepEqual(migratedComplete.map((record) => record.id), completeRecords.map((record) => record.id));
  assert.deepEqual(migratedComplete.map((record) => record.run_slot_index), [0, 1]);

  await snapshotRecord.reload();
  await snapshotRun.reload();
  assert.equal(snapshotRecord.question_set_run_id, snapshotRun.id);
  assert.equal(snapshotRecord.run_slot_index, 0);
  assert.equal(snapshotRun.integrity_status, 'snapshot_only');
  assert.equal(snapshotRun.integrity_missing_record_count, 1);
  assert.equal(snapshotRun.integrity_error_code, 'question_set_run_snapshot_only');
  const snapshotReport = await QuestionSetRunService.getReport({
    projectId: project.id,
    runId: snapshotRun.id
  });
  assert.equal(snapshotReport.rows.length, 2);
  assert.deepEqual(snapshotReport.integrity, {
    status: 'snapshot_only',
    missing_record_count: 1,
    error_code: 'question_set_run_snapshot_only'
  });

  await activeBrokenRun.reload();
  assert.equal(activeBrokenRun.integrity_status, 'missing_records');
  assert.equal(activeBrokenRun.integrity_missing_record_count, 1);
  assert.equal(activeBrokenRun.integrity_error_code, 'question_set_run_integrity_missing_records');
  assert.ok(activeBrokenRun.completed_at);
  const brokenReport = await QuestionSetRunService.getReport({
    projectId: project.id,
    runId: activeBrokenRun.id
  });
  assert.equal(brokenReport.status, 'failed');
  assert.equal(brokenReport.rows.length, 0);
  assert.deepEqual(brokenReport.integrity, {
    status: 'missing_records',
    missing_record_count: 1,
    error_code: 'question_set_run_integrity_missing_records'
  });
  assert.equal(await QuestionRecord.count(), 3);

  await importedRun.reload();
  assert.equal(importedRun.integrity_status, 'complete');
  assert.equal(await QuestionRecord.count({ where: { question_set_run_id: importedRun.id } }), 0);
});

test('aborts the whole migration when one legacy record is referenced by multiple runs', async () => {
  const sharedRecord = await QuestionRecord.create({
    user_id: user.id,
    project_id: project.id,
    platform: 'deepseek',
    question: '冲突记录',
    brand: project.name,
    brand_keywords: project.name,
    status: 'completed'
  });
  const firstRun = await createRun({ question_set_name: '冲突运行一' }, [sharedRecord.id]);
  await createRun({ question_set_name: '冲突运行二' }, [sharedRecord.id]);

  const audit = await QuestionSetRunOwnershipMigrationService.audit({ sequelize });
  assert.equal(audit.ownership_conflict_count, 1);
  await assert.rejects(
    QuestionSetRunOwnershipMigrationService.apply({
      sequelize,
      backupReference: 'verified-conflict-backup'
    }),
    (error) => error.code === 'OWNERSHIP_MIGRATION_CONFLICT'
  );

  await sharedRecord.reload();
  await firstRun.reload();
  assert.equal(sharedRecord.question_set_run_id, null);
  assert.equal(firstRun.planned_record_count, 0);
});

test('does not accept a non-unique legacy index as the stable run-slot constraint', async () => {
  const additions = [];
  const database = {
    getQueryInterface: () => ({
      showIndex: async () => [{
        name: 'legacy_run_slot_lookup',
        unique: false,
        fields: [
          { attribute: 'question_set_run_id' },
          { attribute: 'run_slot_index' }
        ]
      }],
      addIndex: async (tableName, fields, options) => {
        additions.push({ tableName, fields, options });
      }
    })
  };

  const added = await QuestionSetRunOwnershipMigrationService.ensureIndex(
    database,
    'question_records',
    'question_records_run_slot_unique',
    ['question_set_run_id', 'run_slot_index'],
    { unique: true }
  );

  assert.equal(added, true);
  assert.deepEqual(additions, [{
    tableName: 'question_records',
    fields: ['question_set_run_id', 'run_slot_index'],
    options: {
      name: 'question_records_run_slot_unique',
      unique: true
    }
  }]);
});
