const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const frontendRoot = path.resolve(__dirname, '../..');
const fixturePath = path.resolve(
  frontendRoot,
  '../tests/fixtures/marketing-production-correctness/tongji-source-partial-83-82.json'
);

function loadTypes() {
  const filename = path.resolve(
    frontendRoot,
    'src/lib/marketing/websiteTrafficTypes.ts'
  );
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    },
    fileName: filename
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(output, filename);
  return loaded.exports;
}

test('网站流量 decoder 接受 83/82 PARTIAL 且拒绝伪造差额来源', () => {
  const value = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  value.response.sourceComparison.partition = value.expectedPartition;
  value.response.sourceComparison.state = 'COMPLETE';
  const { assertWebsiteTrafficOverview } = loadTypes();

  assert.doesNotThrow(() => assertWebsiteTrafficOverview(
    value.response,
    value.query
  ));
  assert.equal(
    value.response.sourceComparison.rows.some((row) => (
      ['UNCLASSIFIED', 'OTHER'].includes(row.sourceKey)
    )),
    false
  );
  assert.equal(
    value.response.sourceComparison.rows.reduce(
      (sum, row) => sum + BigInt(row.summary.current || '0'),
      0n
    ).toString(),
    '82'
  );
  value.response.sourceComparison.partition.classifiedVisits = '83';
  assert.throws(
    () => assertWebsiteTrafficOverview(value.response, value.query),
    { code: 'WEBSITE_TRAFFIC_RESPONSE_INVALID' }
  );
});

test('网站流量与市场总览直接展示服务端分区且不把差额命名为来源', () => {
  const componentPath = path.resolve(
    frontendRoot,
    'src/components/marketing/WebsiteSourcePartitionNotice.tsx'
  );
  assert.equal(fs.existsSync(componentPath), true);
  const component = fs.readFileSync(componentPath, 'utf8');
  const websitePage = fs.readFileSync(path.resolve(
    frontendRoot,
    'src/app/geo/website-traffic/page.tsx'
  ), 'utf8');
  const overviewPage = fs.readFileSync(path.resolve(
    frontendRoot,
    'src/app/geo/market-overview/page.tsx'
  ), 'utf8');

  assert.match(websitePage, /includeSourceComparison:\s*source === 'ALL' && metric === 'visits'/);
  assert.match(websitePage, /<WebsiteSourcePartitionNotice/);
  assert.match(overviewPage, /<WebsiteSourcePartitionNotice/);
  assert.match(component, /全站访问/);
  assert.match(component, /当前来源已分类/);
  assert.match(component, /差额仅表示当前分类未覆盖/);
  assert.doesNotMatch(component, /未分类来源|未知来源|其他来源/);
});
