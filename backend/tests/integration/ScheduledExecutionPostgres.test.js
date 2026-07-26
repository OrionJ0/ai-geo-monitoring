const test = require('node:test');
const assert = require('node:assert/strict');
const { DataTypes, Sequelize } = require('sequelize');

const postgresTestUrl = process.env.POSTGRES_TEST_URL;
if (!postgresTestUrl) {
  throw new Error('POSTGRES_TEST_URL is required for the scheduler PostgreSQL integration test');
}

const database = new Sequelize(postgresTestUrl, {
  dialect: 'postgres',
  logging: false
});
const DetectionSchedule = database.define('ScheduledExecutionTestSchedule', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  next_run_at: { type: DataTypes.DATE, allowNull: false }
}, {
  tableName: 'scheduled_execution_test_schedules',
  timestamps: false
});
const ScheduledExecution = database.define('ScheduledExecutionTestLedger', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  schedule_kind: { type: DataTypes.STRING(40), allowNull: false },
  schedule_id: { type: DataTypes.INTEGER, allowNull: false },
  project_id: { type: DataTypes.INTEGER, allowNull: true },
  due_at: { type: DataTypes.DATE, allowNull: false },
  status: { type: DataTypes.STRING(20), allowNull: false },
  execution_token: { type: DataTypes.STRING(64), allowNull: false },
  lease_owner: { type: DataTypes.STRING(120), allowNull: false },
  lease_expires_at: { type: DataTypes.DATE, allowNull: false },
  attempt: { type: DataTypes.INTEGER, allowNull: false }
}, {
  tableName: 'scheduled_execution_test_ledgers',
  timestamps: false,
  indexes: [{
    name: 'scheduled_execution_test_slot_unique',
    unique: true,
    fields: ['schedule_kind', 'schedule_id', 'due_at']
  }]
});
const schedulerModule = require('../../services/SchedulerService');

test.before(async () => {
  await database.authenticate();
  await database.sync({ force: true });
});

test.after(async () => {
  await database.drop();
  await database.close();
});

test('two scheduler instances claim one real PostgreSQL schedule slot only once', async () => {
  const dueAt = new Date('2026-07-26T01:00:00.000Z');
  const nextRunAt = new Date('2026-07-27T01:00:00.000Z');
  const schedule = await DetectionSchedule.create({ next_run_at: dueAt });
  const firstService = new schedulerModule.SchedulerService({ ownerId: 'postgres-worker-a' });
  const secondService = new schedulerModule.SchedulerService({ ownerId: 'postgres-worker-b' });
  const dependencies = {
    sequelize: database,
    ScheduledExecution,
    DetectionSchedule
  };
  const input = {
    scheduleKind: 'detection_schedule',
    scheduleId: schedule.id,
    projectId: 9,
    dueAt,
    nextRunAt
  };

  const results = await Promise.all([
    firstService.claimScheduledOccurrence(input, dependencies),
    secondService.claimScheduledOccurrence(input, dependencies)
  ]);

  assert.equal(results.filter((result) => result.claimed).length, 1);
  assert.equal(results.filter((result) => result.reason === 'already_claimed').length, 1);
  assert.equal(await ScheduledExecution.count(), 1);
  await schedule.reload();
  assert.equal(schedule.next_run_at.toISOString(), nextRunAt.toISOString());
});
