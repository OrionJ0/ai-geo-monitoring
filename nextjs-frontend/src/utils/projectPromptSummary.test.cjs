/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getProjectPromptRunBlockReason,
  getRunnableProjectPromptIds,
  summarizeProjectPrompts
} = require('./projectPromptSummary.cjs');

test('summarizes enabled and total project prompts', () => {
  assert.deepEqual(summarizeProjectPrompts([
    { id: 1, enabled: true },
    { id: 2, enabled: false },
    { id: 3 }
  ]), {
    enabled: 2,
    total: 3,
    runnable: false
  });
});

test('supports custom platform codes', () => {
  assert.deepEqual(getRunnableProjectPromptIds([
    { id: 7, enabled: true, platforms: ['custom-ai'] }
  ], ['custom-ai']), [7]);
});

test('treats projects without enabled prompts as not runnable', () => {
  assert.deepEqual(summarizeProjectPrompts([{ id: 1, enabled: false }]), {
    enabled: 0,
    total: 1,
    runnable: false
  });

  assert.deepEqual(summarizeProjectPrompts(null), {
    enabled: 0,
    total: 0,
    runnable: false
  });
});

test('treats enabled prompts without project platform overlap as not runnable', () => {
  assert.deepEqual(summarizeProjectPrompts([
    { id: 1, enabled: true, platforms: ['doubao'] }
  ], ['deepseek']), {
    enabled: 1,
    total: 1,
    runnable: false
  });

  assert.deepEqual(summarizeProjectPrompts([
    { id: 1, enabled: true, platforms: ['doubao'] },
    { id: 2, enabled: true, platforms: ['deepseek'] }
  ], ['deepseek']), {
    enabled: 2,
    total: 2,
    runnable: true
  });
});

test('treats prompts without their own platforms as inheriting project platforms', () => {
  assert.deepEqual(summarizeProjectPrompts([
    { id: 1, enabled: true, platforms: [] }
  ], ['deepseek']), {
    enabled: 1,
    total: 1,
    runnable: true
  });
});

test('returns only prompt ids that can run on the selected project platforms', () => {
  assert.deepEqual(getRunnableProjectPromptIds([
    { id: 1, enabled: true, platforms: ['doubao'] },
    { id: 2, enabled: true, platforms: ['deepseek'] },
    { id: 3, enabled: false, platforms: ['deepseek'] },
    { id: 4, enabled: true, platforms: [] },
  ], ['deepseek']), [2, 4]);
});

test('explains why project prompts cannot run from the project list', () => {
  assert.equal(getProjectPromptRunBlockReason([], ['deepseek']), 'no_enabled_prompt');
  assert.equal(getProjectPromptRunBlockReason([{ id: 1, enabled: false }], ['deepseek']), 'no_enabled_prompt');
  assert.equal(
    getProjectPromptRunBlockReason([{ id: 1, enabled: true, platforms: ['doubao'] }], ['deepseek']),
    'platform_mismatch'
  );
  assert.equal(getProjectPromptRunBlockReason([{ id: 1, enabled: true, platforms: ['deepseek'] }], ['deepseek']), null);
});
