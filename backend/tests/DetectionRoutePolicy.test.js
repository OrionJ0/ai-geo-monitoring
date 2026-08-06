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

test('direct and streaming detection request only direct-stream capable platforms', () => {
  assert.match(
    routeSource,
    /getPlatformAvailability\([\s\S]*capability:\s*'direct_stream'/
  );
  assert.match(
    routeSource,
    /queryPlatform\([\s\S]*purpose:\s*'direct_stream'/
  );
});

test('direct detection records freeze the v5 contract and competitor snapshot before execution', () => {
  assert.match(routeSource, /analysis_contract_version:\s*V5_ANALYSIS_CONTRACT/);
  assert.match(routeSource, /metric_semantics_version:\s*SCOPED_METRIC_SEMANTICS/);
  assert.match(routeSource, /competitor_snapshot:\s*competitorSnapshot/);
  assert.match(routeSource, /correlationId:\s*`record-\$\{recordId\}`/);
});

test('quota, frozen snapshot and every pending record commit atomically before dispatch', () => {
  const transactionIndex = routeSource.indexOf('sequelize.transaction(\n        quotaBatchTransactionOptions(sequelize),');
  const quotaIndex = routeSource.indexOf('bulkConsumeQuota(', transactionIndex);
  const recordIndex = routeSource.indexOf('QuestionRecord.create({', quotaIndex);
  const dispatchIndex = routeSource.indexOf('scheduleBackgroundTask(', recordIndex);
  assert.ok(transactionIndex > 0);
  assert.ok(quotaIndex > transactionIndex);
  assert.ok(recordIndex > quotaIndex);
  assert.ok(dispatchIndex > recordIndex);
});

test('SSE is record-first and correlates the upstream request to the frozen record', () => {
  const streamIndex = routeSource.indexOf("router.get('/stream'");
  const recordIndex = routeSource.indexOf('sseRecord = await sequelize.transaction', streamIndex);
  const queryIndex = routeSource.indexOf('AIPlatformService.queryPlatform', recordIndex);
  assert.ok(recordIndex > streamIndex);
  assert.ok(queryIndex > recordIndex);
  assert.match(
    routeSource.slice(recordIndex, queryIndex + 500),
    /correlationId:\s*`record-\$\{sseRecord\.id\}`/
  );
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

test('async detection guards empty AI responses before atomically finalizing result details', () => {
  const extractIndex = routeSource.indexOf('const originalText = ResultParserService.extractResponseText(aiResult.data)');
  const detailIndex = routeSource.indexOf('persistResponseDetail: true', extractIndex);
  const guardIndex = routeSource.indexOf('监测平台返回内容为空', extractIndex);

  assert.ok(extractIndex > 0);
  assert.ok(detailIndex > extractIndex);
  assert.ok(guardIndex > extractIndex);
  assert.ok(guardIndex < detailIndex);
});

test('async detection claims and renews a lease and fences every terminal write', () => {
  assert.match(routeSource, /ProjectRunService\.claimRecordExecution\(/);
  assert.match(routeSource, /ProjectRunService\.startRecordLeaseHeartbeat\(/);
  assert.match(routeSource, /ProjectRunService\.failRecord\([\s\S]*\{ executionToken \}/);
  assert.match(routeSource, /ProjectRecordFinalizationService\.finalize\([\s\S]*executionToken/);
  assert.doesNotMatch(
    routeSource,
    /async function processAIQuery[\s\S]*QuestionRecord\.update\([\s\S]*status:\s*'failed'/
  );
});
