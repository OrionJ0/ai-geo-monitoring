const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const fixtureDirectory = path.resolve(
  __dirname,
  '../../../tests/fixtures/marketing-production-correctness'
);

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDirectory, name), 'utf8'));
}

function loadTypeScriptModule(relativePath, replacements = []) {
  const filename = path.resolve(__dirname, '../../src', relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  let output = ts.transpileModule(source, {
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

test('广告 fixture 通过现役 decoder 并冻结真实双周期合同', () => {
  const ready = fixture('ad-periods-ready.json');
  const ad = loadTypeScriptModule('lib/marketing/adPerformanceAdapter.ts');
  const keywords = loadTypeScriptModule(
    'lib/marketing/keywordAnalysisAdapter.ts',
    [[
      'require("@/utils/keywordAnalysis.cjs")',
      `require(${JSON.stringify(path.resolve(__dirname, '../../src/utils/keywordAnalysis.cjs'))})`
    ]]
  );

  ad.assertMarketingDashboardRootResponse(ready.dashboard, 'synthetic-project');
  ad.assertMarketingAdHierarchyResponse(
    ready.current.adHierarchy,
    ready.dashboard,
    ready.current.range
  );
  keywords.assertMarketingKeywordResourceResponse(
    ready.current.keywords,
    'synthetic-project',
    ready.dashboard.revision,
    ready.current.range
  );
  keywords.assertMarketingKeywordResourceResponse(
    ready.previous.keywords,
    'synthetic-project',
    ready.dashboard.revision,
    ready.previous.range
  );
  ad.assertMarketingAdHierarchyResponse(
    ready.previous.adHierarchy,
    ready.dashboard,
    ready.previous.range,
    { requireDashboardSummary: false }
  );
});

test('现役网站流量 decoder 接受 83/82 但没有 partition，稳定重现来源缺口', () => {
  const value = fixture('tongji-source-partial-83-82.json');
  const traffic = loadTypeScriptModule('lib/marketing/websiteTrafficTypes.ts');
  traffic.assertWebsiteTrafficOverview(value.response, value.query);
  const classified = value.response.sourceComparison.rows.reduce(
    (sum, row) => sum + BigInt(row.summary.current || '0'),
    0n
  );
  assert.equal(classified.toString(), '82');
  assert.equal(value.response.summary.visits.current, '83');
  assert.equal(Object.hasOwn(value.response.sourceComparison, 'partition'), false);
});

test('现役页面 decoder 保留两个同路径 pageId 但尚无稳定消歧元数据', () => {
  const value = fixture('tongji-page-path-collision.json');
  const traffic = loadTypeScriptModule('lib/marketing/websiteTrafficTypes.ts');
  traffic.assertWebsitePageReport(value.response, value.query);
  assert.equal(new Set(value.response.rows.map((row) => row.pageId)).size, 2);
  assert.equal(new Set(value.response.rows.map((row) => row.path)).size, 1);
  assert.ok(value.response.rows.every((row) => row.pathCollision === undefined));
});
