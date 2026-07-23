const test = require('node:test');
const assert = require('node:assert/strict');

const PlatformSelectionService = require('../services/PlatformSelectionService');

const selectablePlatforms = ['doubao', 'deepseek', 'example-ai'];

test('accepts dynamic platform codes supplied by the database catalog', () => {
  const result = PlatformSelectionService.validate(['deepseek', 'example-ai'], {
    availablePlatforms: selectablePlatforms
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.platforms, ['deepseek', 'example-ai']);
});

test('rejects platform codes outside the current selectable catalog', () => {
  const result = PlatformSelectionService.validate(['deepseek', 'missing-ai'], {
    availablePlatforms: selectablePlatforms
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.invalid_platforms, ['missing-ai']);
  assert.match(result.message, /当前不可选择/);
});

test('rejects explicit platform selection when the selectable catalog is empty', () => {
  const result = PlatformSelectionService.validate(['custom-ai'], {
    availablePlatforms: [],
    defaultPlatforms: []
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.invalid_platforms, ['custom-ai']);
});

test('project updates retain existing unavailable platforms but reject newly unavailable codes', () => {
  assert.deepEqual(
    PlatformSelectionService.validateProjectUpdate(
      ['temporarily-disabled', 'deepseek'],
      ['temporarily-disabled'],
      ['deepseek']
    ),
    {
      ok: true,
      platforms: ['temporarily-disabled', 'deepseek'],
      invalid_platforms: []
    }
  );

  const result = PlatformSelectionService.validateProjectUpdate(
    ['temporarily-disabled', 'unknown-platform'],
    ['temporarily-disabled'],
    ['deepseek']
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.invalid_platforms, ['unknown-platform']);
});

test('defaults empty monitoring platforms to the caller supplied defaults', () => {
  const result = PlatformSelectionService.validate([], {
    availablePlatforms: selectablePlatforms,
    defaultPlatforms: ['deepseek', 'example-ai']
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.platforms, ['deepseek', 'example-ai']);
});

test('defaults prompt platforms to selectable project platforms', () => {
  const result = PlatformSelectionService.validateWithinProject(undefined, ['deepseek', 'example-ai'], selectablePlatforms);

  assert.equal(result.ok, true);
  assert.deepEqual(result.platforms, ['deepseek', 'example-ai']);
});

test('rejects prompt platforms outside the project or selectable catalog', () => {
  const outsideProject = PlatformSelectionService.validateWithinProject(['doubao'], ['deepseek'], selectablePlatforms);
  assert.equal(outsideProject.ok, false);
  assert.deepEqual(outsideProject.invalid_platforms, ['doubao']);
  assert.match(outsideProject.message, /项目监测平台/);

  const unavailable = PlatformSelectionService.validateWithinProject(['example-ai'], ['example-ai'], ['deepseek']);
  assert.equal(unavailable.ok, false);
  assert.deepEqual(unavailable.invalid_platforms, ['example-ai']);
});

test('reconciles custom prompt platforms after project platform changes', () => {
  assert.deepEqual(
    PlatformSelectionService.reconcilePromptPlatforms(['deepseek', 'example-ai'], ['example-ai']),
    ['example-ai']
  );

  assert.deepEqual(
    PlatformSelectionService.reconcilePromptPlatforms(['doubao'], ['example-ai']),
    ['example-ai']
  );
});
