const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const frontendRoot = path.resolve(__dirname, '../..');
const fixtureDirectory = path.resolve(
  frontendRoot,
  '../tests/fixtures/marketing-production-correctness'
);

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDirectory, name), 'utf8'));
}

function loadTypeScriptModule(relativePath, replacements = []) {
  const filename = path.resolve(frontendRoot, 'src', relativePath);
  let output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    },
    fileName: filename
  }).outputText;
  for (const [pattern, replacement] of replacements) {
    output = output.replace(pattern, replacement);
  }
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(output, filename);
  return loaded.exports;
}

function loadAdapter() {
  return loadTypeScriptModule(
    'lib/marketing/keywordAnalysisAdapter.ts',
    [[
      'require("@/utils/keywordAnalysis.cjs")',
      `require(${JSON.stringify(path.resolve(frontendRoot, 'src/utils/keywordAnalysis.cjs'))})`
    ]]
  );
}

test('关键词 decoder 将两期 coverage 钉扎到同一 Dashboard 根', () => {
  const adapter = loadAdapter();
  const ready = fixture('ad-periods-ready.json');
  const expectedCoverage = ready.dashboard.coverage;

  adapter.assertMarketingKeywordResourceResponse(
    ready.previous.keywords,
    ready.dashboard.projectId,
    ready.dashboard.revision,
    ready.previous.range,
    expectedCoverage
  );
  assert.throws(() => adapter.assertMarketingKeywordResourceResponse(
    {
      ...ready.previous.keywords,
      coverage: { ...ready.previous.keywords.coverage, currency: 'USD' }
    },
    ready.dashboard.projectId,
    ready.dashboard.revision,
    ready.previous.range,
    expectedCoverage
  ), { code: 'MARKETING_KEYWORD_RESOURCE_RESPONSE_INVALID' });
  assert.throws(() => adapter.assertMarketingKeywordResourceResponse(
    ready.previous.keywords,
    ready.dashboard.projectId,
    ready.dashboard.revision,
    ready.previous.range,
    expectedCoverage,
    { query: '虚构筛选词' }
  ), { code: 'MARKETING_KEYWORD_RESOURCE_RESPONSE_INVALID' });
});

test('关键词模型只用本期 items 构建列表并保留两期完整 summary', () => {
  const adapter = loadAdapter();
  const ready = fixture('ad-periods-ready.json');
  const model = adapter.adaptMarketingKeywordResource(
    ready.current.keywords,
    ready.dashboard,
    {
      state: 'READY',
      resource: ready.previous.keywords,
      reason: ''
    },
    '虚构项目'
  );

  assert.equal(model.rows.length, ready.current.keywords.items.length);
  assert.deepEqual(model.summary, ready.current.keywords.summary);
  assert.equal(model.previousState, 'READY');
  assert.deepEqual(model.previousSummary, ready.previous.keywords.summary);
  assert.equal(
    model.previousTotalItems,
    ready.previous.keywords.pagination.totalItems
  );
  assert.equal(model.previousUnavailableReason, '');
});

test('关键词上期越界、可重试失败与真实零保持三种独立语义', () => {
  const adapter = loadAdapter();
  const ready = fixture('ad-periods-ready.json');
  const unavailable = adapter.classifyKeywordPreviousError({
    response: {
      data: {
        error: {
          code: 'DASHBOARD_DATE_OUT_OF_RANGE',
          message: '上一周期超出覆盖范围'
        }
      }
    }
  });
  const retryable = adapter.classifyKeywordPreviousError({
    response: {
      data: {
        error: {
          code: 'MARKETING_SNAPSHOT_UNAVAILABLE',
          message: '上一周期读取失败'
        }
      }
    }
  });
  assert.deepEqual([unavailable.state, retryable.state], [
    'UNAVAILABLE',
    'ERROR'
  ]);

  const zeroResource = {
    ...ready.previous.keywords,
    summary: {
      impressions: '0',
      clicks: '0',
      costAmountScaled: '0'
    },
    items: [],
    pagination: {
      page: 1,
      pageSize: 1,
      totalItems: 0,
      totalPages: 0
    }
  };
  const zeroModel = adapter.adaptMarketingKeywordResource(
    ready.current.keywords,
    ready.dashboard,
    { state: 'READY', resource: zeroResource, reason: '' },
    '虚构项目'
  );
  assert.equal(zeroModel.previousState, 'READY');
  assert.deepEqual(zeroModel.previousSummary, zeroResource.summary);
  assert.equal(zeroModel.previousTotalItems, 0);

  for (const previous of [unavailable, retryable]) {
    const model = adapter.adaptMarketingKeywordResource(
      ready.current.keywords,
      ready.dashboard,
      previous,
      '虚构项目'
    );
    assert.equal(model.previousState, previous.state);
    assert.equal(model.previousSummary, null);
    assert.equal(model.previousTotalItems, null);
    assert.equal(model.previousUnavailableReason, previous.reason);
    assert.deepEqual(model.summary, ready.current.keywords.summary);
  }
});

test('关键词上期汇总缓存忽略分页排序并在事实身份变化时失效', async () => {
  const {
    createKeywordPreviousSummaryCache,
    keywordPreviousSummaryKey
  } = loadTypeScriptModule(
    'lib/marketing/keywordPreviousSummaryCache.ts'
  );
  const cache = createKeywordPreviousSummaryCache();
  const base = {
    projectId: 'project-1',
    revision: 'revision-1',
    previousFrom: '2026-06-01',
    previousTo: '2026-06-30',
    query: '防火门',
    campaignId: 'campaign-1',
    adGroupId: 'group-1',
    page: 1,
    pageSize: 20,
    sortBy: 'clicks',
    sortOrder: 'descend'
  };
  let loads = 0;
  const loadSummary = async () => ({ sequence: ++loads });

  const first = cache.read(keywordPreviousSummaryKey(base), loadSummary);
  const pageOnly = cache.read(keywordPreviousSummaryKey({
    ...base,
    page: 3,
    pageSize: 50,
    sortBy: 'impressions',
    sortOrder: 'ascend'
  }), loadSummary);

  assert.equal(first, pageOnly);
  assert.deepEqual(await pageOnly, { sequence: 1 });
  assert.equal(loads, 1);

  for (const changed of [
    { projectId: 'project-2' },
    { revision: 'revision-2' },
    { previousFrom: '2026-05-01' },
    { previousTo: '2026-05-31' },
    { query: '配电箱' },
    { campaignId: 'campaign-2' },
    { adGroupId: 'group-2' }
  ]) {
    await cache.read(
      keywordPreviousSummaryKey({ ...base, ...changed }),
      loadSummary
    );
  }
  assert.equal(loads, 8);
});

test('关键词上期汇总失败只缓存到显式刷新', async () => {
  const {
    createKeywordPreviousSummaryCache,
    keywordPreviousSummaryKey
  } = loadTypeScriptModule(
    'lib/marketing/keywordPreviousSummaryCache.ts'
  );
  const cache = createKeywordPreviousSummaryCache();
  const key = keywordPreviousSummaryKey({
    projectId: 'project-1',
    revision: 'revision-1',
    previousFrom: '2026-06-01',
    previousTo: '2026-06-30'
  });
  let loads = 0;
  const failed = cache.read(key, async () => {
    loads += 1;
    throw new Error('temporary failure');
  });

  await assert.rejects(failed, /temporary failure/);
  await assert.rejects(
    cache.read(key, async () => {
      loads += 1;
      return 'unexpected';
    }),
    /temporary failure/
  );
  assert.equal(loads, 1);

  assert.equal(await cache.read(key, async () => {
    loads += 1;
    return 'recovered';
  }, true), 'recovered');
  assert.equal(loads, 2);
});
