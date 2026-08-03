const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const backendRoot = path.resolve(__dirname, '../..');

test('application mounts website and Baidu APIs under separate modules and namespaces', () => {
  const appSource = fs.readFileSync(path.join(backendRoot, 'app.js'), 'utf8');
  assert.match(
    appSource,
    /require\('\.\/modules\/websiteFormConsultations'\)/u
  );
  assert.match(
    appSource,
    /app\.use\('\/api\/website-data', authRequired, websiteFormConsultationModule\.router\)/u
  );
  assert.match(
    appSource,
    /app\.use\('\/api\/marketing', authRequired, marketingModule\.router\)/u
  );

  const marketingSource = fs.readFileSync(
    path.join(backendRoot, 'modules/marketing/index.js'),
    'utf8'
  );
  assert.doesNotMatch(marketingSource, /GatoWebsite|form-consultations/u);

  const websiteSource = fs.readFileSync(
    path.join(backendRoot, 'modules/websiteFormConsultations/index.js'),
    'utf8'
  );
  assert.doesNotMatch(websiteSource, /BaiduMarketing|BaiduTongji/u);
});
