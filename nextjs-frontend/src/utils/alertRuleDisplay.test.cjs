/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  defaultThresholdForType,
  isCountThreshold,
  normalizeThresholdInput,
  thresholdMin,
  thresholdUnit
} = require('./alertRuleDisplay.cjs');

test('uses domain-specific units for alert rule thresholds', () => {
  assert.equal(thresholdUnit('visibility_drop'), '%');
  assert.equal(thresholdUnit('negative_sentiment'), '%');
  assert.equal(thresholdUnit('platform_gap'), '%');
  assert.equal(thresholdUnit('competitor_ahead'), '次');
  assert.equal(thresholdUnit('task_failure'), '条');
  assert.equal(thresholdUnit('source_drop'), '个');
});

test('describes competitor ahead threshold as an actual mention-count gap', () => {
  assert.equal(thresholdUnit('competitor_ahead'), '次');
});

test('normalizes alert threshold input by rule type', () => {
  assert.equal(isCountThreshold('task_failure'), true);
  assert.equal(isCountThreshold('source_drop'), true);
  assert.equal(isCountThreshold('competitor_ahead'), true);
  assert.equal(thresholdMin('competitor_ahead'), 1);
  assert.equal(thresholdMin('negative_sentiment'), 1);
  assert.equal(normalizeThresholdInput('visibility_drop', 120), 100);
  assert.equal(normalizeThresholdInput('negative_sentiment', 0), 1);
  assert.equal(normalizeThresholdInput('task_failure', 0), 1);
  assert.equal(normalizeThresholdInput('task_failure', 2.1), 3);
  assert.equal(normalizeThresholdInput('source_drop', 2.1), 3);
  assert.equal(normalizeThresholdInput('competitor_ahead', 2.5), 3);
  assert.equal(normalizeThresholdInput('competitor_ahead', 1200), 1000);
});

test('uses stable defaults when alert rule type changes', () => {
  assert.equal(defaultThresholdForType('visibility_drop'), 10);
  assert.equal(defaultThresholdForType('competitor_ahead'), 10);
  assert.equal(defaultThresholdForType('task_failure'), 10);
  assert.equal(defaultThresholdForType('negative_sentiment'), 10);
});
