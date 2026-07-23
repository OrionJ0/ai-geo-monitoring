const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routeSource = fs.readFileSync(path.resolve(__dirname, '../routes/detection.js'), 'utf8');

test('detection routes resolve dynamic database platform availability', () => {
  assert.match(routeSource, /await AIPlatformService\.getPlatformCodes\(\)/);
  assert.match(routeSource, /await AIPlatformService\.getPlatformAvailability\(/);
  assert.match(routeSource, /await AIRuntimeSettingsService\.getSettings\(\)/);
  assert.match(routeSource, /runtimeSettings/);
  assert.match(routeSource, /skipped_platforms/);
  assert.doesNotMatch(routeSource, /MAINLAND_MONITORING_PLATFORMS|品牌检测仅支持豆包和 DeepSeek|platform = 'deepseek'/);
});

test('detection routes contain no legacy provider configuration or stream fallback', () => {
  assert.doesNotMatch(routeSource, /AIPlatformService\.platforms|getModelName|getMaxTokens/);
  assert.doesNotMatch(routeSource, /DOUBAO_LEGACY_STREAM|DOUBAO_|DEEPSEEK_/);
  assert.doesNotMatch(routeSource, /require\(['"]axios['"]\)|require\(['"]https['"]\)/);
});

test('detection responses avoid raw internal provider failures', () => {
  assert.doesNotMatch(routeSource, /error:\s*error\.message/);
  assert.doesNotMatch(routeSource, /message:\s*aiResult\.error/);
});

test('async detection guards empty AI responses before creating result details', () => {
  const extractIndex = routeSource.indexOf('const originalText = ResultParserService.extractResponseText(aiResult.data)');
  const detailIndex = routeSource.indexOf('await ResultDetail.create', extractIndex);
  const guardIndex = routeSource.indexOf('监测平台返回内容为空', extractIndex);

  assert.ok(extractIndex > 0);
  assert.ok(detailIndex > extractIndex);
  assert.ok(guardIndex > extractIndex);
  assert.ok(guardIndex < detailIndex);
});
