const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DB_STORAGE = ':memory:';

const { sequelize } = require('../models');

test.before(async () => {
  await sequelize.sync({ force: true });
});

test.after(async () => {
  await sequelize.close();
});

test('run records accept dynamic platform codes and retain platform and model names', async () => {
  const queryInterface = sequelize.getQueryInterface();
  const questionRecord = await queryInterface.describeTable('question_records');
  const visibilityMetric = await queryInterface.describeTable('visibility_metrics');

  assert.match(questionRecord.platform.type, /VARCHAR\(50\)/i);
  assert.match(visibilityMetric.platform.type, /VARCHAR\(50\)/i);
  assert.ok(questionRecord.platform_name);
  assert.ok(questionRecord.model_name);
});

test('AI platform records persist request parameters and independent web-search test state', async () => {
  const queryInterface = sequelize.getQueryInterface();
  const platform = await queryInterface.describeTable('ai_platform_configs');

  assert.ok(platform.request_options);
  assert.ok(platform.web_search_test_status);
  assert.ok(platform.last_web_search_tested_at);
  assert.ok(platform.last_web_search_test_error_code);
  assert.ok(platform.last_web_search_test_message);
});

test('question-set retry records persist execution leases, citation snapshots and run revisions', async () => {
  const queryInterface = sequelize.getQueryInterface();
  const questionRecord = await queryInterface.describeTable('question_records');
  const resultDetail = await queryInterface.describeTable('result_details');
  const questionSetRun = await queryInterface.describeTable('question_set_runs');
  const retryBatch = await queryInterface.describeTable('question_set_retry_batches');

  assert.ok(questionRecord.execution_token);
  assert.ok(questionRecord.execution_started_at);
  assert.ok(resultDetail.provider_citations);
  assert.ok(questionSetRun.revision);
  assert.ok(questionSetRun.paused_at);
  assert.ok(retryBatch.idempotency_key);
  assert.ok(retryBatch.status);
});

test('postgres startup migration detects Sequelize user-defined enum descriptions', () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

  assert.match(appSource, /platformColumn\.special/);
  assert.match(appSource, /ALTER TABLE.*platform.*VARCHAR\(50\)/s);
});
