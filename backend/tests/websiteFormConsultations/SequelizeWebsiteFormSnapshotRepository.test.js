const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SequelizeWebsiteFormSnapshotRepository
} = require('../../modules/websiteFormConsultations/repositories/SequelizeWebsiteFormSnapshotRepository');
const {
  createMarketingTestDatabase
} = require('../marketing/helpers/createMarketingTestDatabase');
const {
  createWebsiteDataMigrationRunner
} = require('../../modules/websiteFormConsultations/migrations/WebsiteDataMigrationRunner');

test('persists aggregate and daily website-form snapshots without overwriting each other', async (t) => {
  const database = await createMarketingTestDatabase('website-form-snapshot-');
  t.after(() => database.close());
  await createWebsiteDataMigrationRunner({
    sequelize: database.sequelize
  }).apply();
  const repository = new SequelizeWebsiteFormSnapshotRepository({
    sequelize: database.sequelize
  });
  const snapshot = {
    projectId: '11',
    payloadKind: 'AGGREGATE',
    schemaVersion: 'website_form_consultations_v3',
    coverage: {
      from: '2026-08-01',
      to: '2026-08-03',
      timeZone: 'Asia/Shanghai'
    },
    payload: {
      formConsultationRecords: '2',
      sourceBreakdown: [
        {
          sourceKey: 'DIRECT',
          formConsultationRecords: '2'
        }
      ]
    },
    refreshedAt: '2026-08-03T12:00:00.000Z',
    expiresAt: '2026-08-03T12:10:00.000Z'
  };

  await repository.save(snapshot);
  await repository.save({
    ...snapshot,
    payloadKind: 'DAILY',
    payload: {
      ...snapshot.payload,
      days: [
        {
          date: '2026-08-01',
          formConsultationRecords: '2',
          sourceBreakdown: snapshot.payload.sourceBreakdown
        },
        {
          date: '2026-08-02',
          formConsultationRecords: '0',
          sourceBreakdown: []
        },
        {
          date: '2026-08-03',
          formConsultationRecords: '0',
          sourceBreakdown: []
        }
      ]
    }
  });
  const result = await repository.read({
    projectId: '11',
    payloadKind: 'AGGREGATE',
    schemaVersion: 'website_form_consultations_v3',
    coverage: snapshot.coverage
  });
  const daily = await repository.read({
    projectId: '11',
    payloadKind: 'DAILY',
    schemaVersion: 'website_form_consultations_v3',
    coverage: snapshot.coverage
  });

  assert.deepEqual(result, snapshot);
  assert.equal(daily.payloadKind, 'DAILY');
  assert.equal(daily.payload.days.length, 3);
  const [countRows] = await database.sequelize.query(
    'SELECT COUNT(*) AS count FROM website_form_consultation_snapshots_v2'
  );
  assert.equal(Number(countRows[0].count), 2);
  const [columns] = await database.sequelize.query(
    'PRAGMA table_info(website_form_consultation_snapshots_v2)'
  );
  assert.equal(columns.some((column) => column.name === 'payload_json'), true);
  assert.equal(columns.some((column) => column.name === 'contact_name'), false);
  assert.equal(columns.some((column) => column.name === 'phone'), false);
  assert.equal(columns.some((column) => column.name === 'email'), false);
});

test('prunes only snapshots older than the configured maximum stale window', async (t) => {
  const database = await createMarketingTestDatabase('website-form-pruning-');
  t.after(() => database.close());
  await createWebsiteDataMigrationRunner({
    sequelize: database.sequelize
  }).apply();
  const repository = new SequelizeWebsiteFormSnapshotRepository({
    sequelize: database.sequelize
  });
  const base = {
    projectId: '11',
    payloadKind: 'AGGREGATE',
    schemaVersion: 'website_form_consultations_v3',
    coverage: { from: '2026-07-01', to: '2026-07-01' },
    payload: {
      formConsultationRecords: '0',
      sourceBreakdown: []
    },
    refreshedAt: '2026-07-01T00:00:00.000Z',
    expiresAt: '2026-07-01T00:10:00.000Z'
  };
  await repository.save(base);
  await repository.save({
    ...base,
    coverage: { from: '2026-08-03', to: '2026-08-03' },
    refreshedAt: '2026-08-03T00:00:00.000Z',
    expiresAt: '2026-08-03T00:10:00.000Z',
    staleCutoff: '2026-08-02T00:00:00.000Z'
  });
  const [rows] = await database.sequelize.query(
    'SELECT coverage_start FROM website_form_consultation_snapshots_v2 ORDER BY coverage_start'
  );
  assert.deepEqual(rows.map((row) => String(row.coverage_start)), ['2026-08-03']);
});

test('does not let an older refresh overwrite a newer website snapshot', async (t) => {
  const database = await createMarketingTestDatabase('website-form-monotonic-');
  t.after(() => database.close());
  await createWebsiteDataMigrationRunner({ sequelize: database.sequelize }).apply();
  const repository = new SequelizeWebsiteFormSnapshotRepository({
    sequelize: database.sequelize
  });
  const base = {
    projectId: '11',
    payloadKind: 'AGGREGATE',
    schemaVersion: 'website_form_consultations_v3',
    coverage: { from: '2026-08-03', to: '2026-08-03' },
    payload: {
      formConsultationRecords: '2',
      sourceBreakdown: []
    },
    refreshedAt: '2026-08-03T12:00:00.000Z',
    expiresAt: '2026-08-03T12:10:00.000Z'
  };
  await repository.save(base);
  await repository.save({
    ...base,
    payload: {
      formConsultationRecords: '1',
      sourceBreakdown: []
    },
    refreshedAt: '2026-08-03T11:00:00.000Z',
    expiresAt: '2026-08-03T11:10:00.000Z'
  });

  const result = await repository.read({
    projectId: base.projectId,
    payloadKind: base.payloadKind,
    schemaVersion: base.schemaVersion,
    coverage: base.coverage
  });
  assert.equal(result.payload.formConsultationRecords, '2');
  assert.equal(result.refreshedAt, base.refreshedAt);
});

test('treats corrupt cached JSON as a miss so a fresh upstream read can repair it', async (t) => {
  const database = await createMarketingTestDatabase('website-form-corrupt-');
  t.after(() => database.close());
  await createWebsiteDataMigrationRunner({ sequelize: database.sequelize }).apply();
  const repository = new SequelizeWebsiteFormSnapshotRepository({
    sequelize: database.sequelize
  });
  await database.sequelize.query(
    `INSERT INTO website_form_consultation_snapshots_v2 (
       id, project_id, payload_kind, schema_version,
       coverage_start, coverage_end, payload_json,
       refreshed_at, expires_at, created_at, updated_at
     ) VALUES (
       'corrupt', '11', 'AGGREGATE', 'website_form_consultations_v3',
       '2026-08-01', '2026-08-03', '{broken',
       '2026-08-03T12:00:00.000Z', '2026-08-03T12:10:00.000Z',
       '2026-08-03T12:00:00.000Z', '2026-08-03T12:00:00.000Z'
     )`
  );
  const result = await repository.read({
    projectId: '11',
    payloadKind: 'AGGREGATE',
    schemaVersion: 'website_form_consultations_v3',
    coverage: { from: '2026-08-01', to: '2026-08-03' }
  });
  assert.equal(result, null);
});
