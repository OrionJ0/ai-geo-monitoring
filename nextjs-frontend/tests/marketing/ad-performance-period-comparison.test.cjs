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

function loadAdapter() {
  const filename = path.join(
    frontendRoot,
    'src/lib/marketing/adPerformanceAdapter.ts'
  );
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    },
    fileName: filename
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(output, filename);
  return loaded.exports;
}

test('广告层级 decoder 接受同 revision 与 coverage 的真实上期 summary', () => {
  const adapter = loadAdapter();
  const ready = fixture('ad-periods-ready.json');

  assert.doesNotThrow(() => adapter.assertMarketingAdHierarchyResponse(
    ready.previous.adHierarchy,
    ready.dashboard,
    ready.previous.range,
    { requireDashboardSummary: false }
  ));

  for (const mutation of [
    { revision: 'synthetic-other-revision' },
    { filter: { from: '2026-06-18', to: '2026-06-24' } },
    { coverage: { ...ready.previous.adHierarchy.coverage, currency: 'USD' } },
    { coverage: { ...ready.previous.adHierarchy.coverage, costScale: 3 } }
  ]) {
    assert.throws(() => adapter.assertMarketingAdHierarchyResponse(
      { ...ready.previous.adHierarchy, ...mutation },
      ready.dashboard,
      ready.previous.range,
      { requireDashboardSummary: false }
    ), { code: 'MARKETING_DASHBOARD_RESPONSE_INVALID' });
  }
});

test('广告模型保留真实上期 summary 和逐层趋势而不修改本期树', () => {
  const adapter = loadAdapter();
  const ready = fixture('ad-periods-ready.json');
  const model = adapter.adaptMarketingAdHierarchy(
    ready.dashboard,
    ready.current.adHierarchy,
    {
      state: 'READY',
      hierarchy: ready.previous.adHierarchy,
      reason: ''
    },
    '虚构项目'
  );

  assert.equal(model.previousState, 'READY');
  assert.deepEqual(model.previousSummary, ready.previous.adHierarchy.summary);
  assert.equal(model.previousUnavailableReason, '');
  assert.equal(model.previousTrend.length > 0, true);
  assert.deepEqual(model.structure[0].metrics, ready.current.adHierarchy.summary);
  assert.equal(model.structure[0].previousTrend.length > 0, true);
  assert.equal(model.structure[0].children[0].previousTrend.length > 0, true);
});

test('对象级上期身份缺失保持 UNAVAILABLE 而不冒充真实零', () => {
  const adapter = loadAdapter();
  const ready = fixture('ad-periods-ready.json');
  const previousHierarchy = {
    ...ready.previous.adHierarchy,
    campaigns: ready.previous.adHierarchy.campaigns.map((row) => ({
      ...row,
      campaignId: `${row.campaignId}-previous`
    })),
    adGroups: ready.previous.adHierarchy.adGroups.map((row) => ({
      ...row,
      campaignId: `${row.campaignId}-previous`
    })),
    keywords: ready.previous.adHierarchy.keywords.map((row) => ({
      ...row,
      campaignId: `${row.campaignId}-previous`
    }))
  };
  adapter.assertMarketingAdHierarchyResponse(
    previousHierarchy,
    ready.dashboard,
    ready.previous.range,
    { requireDashboardSummary: false }
  );
  const model = adapter.adaptMarketingAdHierarchy(
    ready.dashboard,
    ready.current.adHierarchy,
    {
      state: 'READY',
      hierarchy: previousHierarchy,
      reason: ''
    },
    '虚构项目'
  );

  assert.equal(model.previousState, 'READY');
  assert.equal(model.structure[0].children[0].previousState, 'UNAVAILABLE');
  assert.deepEqual(model.structure[0].children[0].previousTrend, []);
});

test('上期不可用与可重试错误保持独立状态且不清空本期', () => {
  const adapter = loadAdapter();
  const ready = fixture('ad-periods-ready.json');
  const classified = [
    adapter.classifyAdPreviousHierarchyError({
      response: {
        data: {
          error: {
            code: 'DASHBOARD_DATE_OUT_OF_RANGE',
            message: '上一周期超出快照覆盖范围。'
          }
        }
      }
    }),
    adapter.classifyAdPreviousHierarchyError({
      response: {
        data: {
          error: {
            code: 'MARKETING_SNAPSHOT_UNAVAILABLE',
            message: '上一周期读取失败，请重试。'
          }
        }
      }
    })
  ];
  assert.deepEqual(classified.map((value) => value.state), [
    'UNAVAILABLE',
    'ERROR'
  ]);
  for (const previous of classified) {
    const model = adapter.adaptMarketingAdHierarchy(
      ready.dashboard,
      ready.current.adHierarchy,
      previous,
      '虚构项目'
    );
    assert.equal(model.previousState, previous.state);
    assert.equal(model.previousSummary, null);
    assert.equal(model.previousUnavailableReason, previous.reason);
    assert.deepEqual(model.summary, ready.current.adHierarchy.summary);
    assert.equal(model.structure.length > 0, true);
  }
});

test('真实上期零值保持 READY 且不会被折叠成不可用', () => {
  const adapter = loadAdapter();
  const ready = fixture('ad-periods-ready.json');
  const zeroMetrics = {
    impressions: '0',
    clicks: '0',
    costAmountScaled: '0'
  };
  const zeroHierarchy = {
    ...ready.previous.adHierarchy,
    summary: zeroMetrics,
    campaigns: ready.previous.adHierarchy.campaigns.map((campaign) => ({
      ...campaign,
      ...zeroMetrics,
      trend: campaign.trend.map((row) => ({
        date: row.date,
        ...zeroMetrics
      }))
    }))
  };
  adapter.assertMarketingAdHierarchyResponse(
    zeroHierarchy,
    ready.dashboard,
    ready.previous.range,
    { requireDashboardSummary: false }
  );
  const model = adapter.adaptMarketingAdHierarchy(
    ready.dashboard,
    ready.current.adHierarchy,
    { state: 'READY', hierarchy: zeroHierarchy, reason: '' },
    '虚构项目'
  );
  assert.equal(model.previousState, 'READY');
  assert.deepEqual(model.previousSummary, zeroMetrics);
  assert.equal(model.previousUnavailableReason, '');
});

test('双周期闭区间按 UTC 日历生成等长紧邻范围', () => {
  const adapter = loadAdapter();
  assert.deepEqual(adapter.buildAdPeriod('2026-03-01', '2026-03-07'), {
    currentFrom: '2026-03-01',
    currentTo: '2026-03-07',
    previousFrom: '2026-02-22',
    previousTo: '2026-02-28',
    days: 7
  });
});

test('稀疏双周期趋势按真实日期映射到周期槽位', () => {
  const adapter = loadAdapter();
  assert.equal(adapter.periodDaySlot('2026-03-02', '2026-03-01', 7), 1);
  assert.equal(adapter.periodDaySlot('2026-02-27', '2026-02-22', 7), 5);
  assert.equal(adapter.periodDaySlot('2026-02-21', '2026-02-22', 7), null);
  assert.equal(adapter.periodDaySlot('2026-03-01', '2026-02-22', 7), null);
});
