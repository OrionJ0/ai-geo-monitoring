const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routeSource = fs.readFileSync(
  path.resolve(__dirname, '../routes/geoProjects.js'),
  'utf8'
);

function routeBlock(method, routePath) {
  const start = routeSource.indexOf(`router.${method}('${routePath}'`);
  assert.notEqual(start, -1);
  const next = routeSource.indexOf('\nrouter.', start + 1);
  return next === -1 ? routeSource.slice(start) : routeSource.slice(start, next);
}

test('brand profile updates preserve monitoring evidence and invalidate only generated reports', () => {
  const block = routeBlock('put', '/:id');

  assert.match(block, /projectAnalysisFieldsChanged/);
  assert.match(block, /await invalidateGeneratedReports\(req\.brandProject\.id\)/);
  assert.doesNotMatch(block, /deleteProjectAnalysisData/);
});

test('project lifecycle routes return the stable default-project protection code', () => {
  const updateBlock = routeBlock('put', '/:id');
  const deleteBlock = routeBlock('delete', '/:id');

  assert.match(updateBlock, /result\.code/);
  assert.match(deleteBlock, /result\.code/);
});
