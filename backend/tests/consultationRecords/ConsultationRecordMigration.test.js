const assert = require('node:assert/strict');
const test = require('node:test');
const { Sequelize } = require('sequelize');

const {
  createConsultationRecordMigrationRunner
} = require('../../modules/consultationRecords/migrations/ConsultationRecordMigrationRunner');
const {
  SequelizeConsultationAccessLogRepository
} = require('../../modules/consultationRecords/repositories/SequelizeConsultationAccessLogRepository');

test('creates a minimal audit ledger and stores only a record fingerprint', async (t) => {
  const sequelize = new Sequelize('sqlite::memory:', { logging: false });
  t.after(() => sequelize.close());
  const runner = createConsultationRecordMigrationRunner({ sequelize });

  assert.equal((await runner.audit()).ready, false);
  const applied = await runner.apply();
  assert.equal(applied.ready, true);
  assert.deepEqual(applied.appliedVersions, [
    '001-consultation-detail-access-logs'
  ]);

  const repository = new SequelizeConsultationAccessLogRepository({
    sequelize,
    clock: () => new Date('2026-08-03T04:00:00.000Z')
  });
  await repository.recordView({
    userId: '7',
    projectId: '11',
    sourceSystem: 'GATO_WEBSITE',
    consultationType: 'WEBSITE_FORM',
    recordId: 'website:record_redacted_001'
  });
  const [rows] = await sequelize.query(
    'SELECT * FROM consultation_detail_access_logs'
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, 'CONSULTATION_DETAIL_VIEW');
  assert.match(rows[0].record_fingerprint, /^[a-f0-9]{64}$/u);
  assert.notEqual(
    rows[0].record_fingerprint,
    'website:record_redacted_001'
  );
  assert.equal('record_id' in rows[0], false);
  assert.equal('content' in rows[0], false);
  assert.equal('contact' in rows[0], false);
  assert.equal('ip' in rows[0], false);
});
