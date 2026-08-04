const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontendRoot = path.resolve(__dirname, '../..');

test('prompt management has no per-question platform selector or legacy project scope', () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, 'src/app/geo/prompts/page.tsx'),
    'utf8'
  );

  assert.doesNotMatch(source, /name="platforms"/);
  assert.doesNotMatch(source, /promptPlatformFilter/);
  assert.doesNotMatch(source, /selectedProject\?\.platforms/);
  assert.doesNotMatch(source, /getProjectPromptRunBlockReason/);
  assert.match(source, /selectableCodes/);
  assert.doesNotMatch(source, /运行平台由管理员在“AI 平台”中统一启用/);
});

test('question mutations no longer send platform scope', () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, 'src/app/geo/prompts/page.tsx'),
    'utf8'
  );

  assert.doesNotMatch(source, /platforms:\s*normalizeList\(values\.platforms\)/);
  assert.doesNotMatch(source, /platforms:\s*selectableProjectPlatforms/);
});
