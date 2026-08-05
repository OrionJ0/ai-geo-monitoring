const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const fixture = JSON.parse(fs.readFileSync(
  path.resolve(root, '../tests/fixtures/marketing-production-correctness/tongji-page-path-collision.json'),
  'utf8'
));

function loadTypeScriptModule(relativePath) {
  const filename = path.resolve(root, 'src', relativePath);
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

test('页面报告 decoder requires exact additive collision metadata', () => {
  const traffic = loadTypeScriptModule('lib/marketing/websiteTrafficTypes.ts');
  const response = structuredClone(fixture.response);
  response.rows = response.rows.map((row, index) => ({
    ...row,
    pathCollision: { ordinal: index + 1, count: 2 }
  }));
  traffic.assertWebsitePageReport(response, fixture.query);

  const invalid = structuredClone(response);
  invalid.rows[0].pathCollision = { ordinal: 3, count: 2 };
  assert.throws(
    () => traffic.assertWebsitePageReport(invalid, fixture.query),
    { code: 'WEBSITE_TRAFFIC_RESPONSE_INVALID' }
  );

  const duplicateOrdinal = structuredClone(response);
  duplicateOrdinal.rows[1].pathCollision.ordinal = 1;
  assert.throws(
    () => traffic.assertWebsitePageReport(duplicateOrdinal, fixture.query),
    { code: 'WEBSITE_TRAFFIC_RESPONSE_INVALID' }
  );

  const hiddenCollision = structuredClone(response);
  hiddenCollision.rows[1].pathCollision = null;
  assert.throws(
    () => traffic.assertWebsitePageReport(hiddenCollision, fixture.query),
    { code: 'WEBSITE_TRAFFIC_RESPONSE_INVALID' }
  );
});

test('网站流量页面显示同路径序号且不聚合页面事实', () => {
  const source = fs.readFileSync(
    path.resolve(root, 'src/app/geo/website-traffic/page.tsx'),
    'utf8'
  );
  assert.match(source, /同路径记录/);
  assert.doesNotMatch(source, /mergePath|aggregateCollision|dedupePath/);
});
