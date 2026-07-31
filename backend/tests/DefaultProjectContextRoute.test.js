const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routeSource = fs.readFileSync(path.resolve(__dirname, '../routes/geoProjects.js'), 'utf8');

function routeBlock(method, pathPattern) {
  const start = routeSource.indexOf(`router.${method}('${pathPattern}'`);
  assert.notEqual(start, -1, `route ${method} ${pathPattern} should exist`);
  const next = routeSource.indexOf('\nrouter.', start + 1);
  return next === -1 ? routeSource.slice(start) : routeSource.slice(start, next);
}

test('default-context routes are declared before the dynamic project detail route', () => {
  const getDefaultIndex = routeSource.indexOf("router.get('/default-context'");
  const putDefaultIndex = routeSource.indexOf("router.put('/default-context'");
  const detailIndex = routeSource.indexOf("router.get('/:id'");

  assert.ok(getDefaultIndex >= 0);
  assert.ok(putDefaultIndex >= 0);
  assert.ok(getDefaultIndex < detailIndex);
  assert.ok(putDefaultIndex < detailIndex);
});

test('default-context read exposes only the minimal service context', () => {
  const block = routeBlock('get', '/default-context');

  assert.match(block, /DefaultProjectContextService\.getForUser\(req\.user\)/);
  assert.match(block, /success:\s*true,\s*data:\s*context/);
});

test('default-context update accepts only an exact projectId payload', () => {
  const block = routeBlock('put', '/default-context');

  assert.match(block, /Object\.keys\(req\.body/);
  assert.match(block, /projectId/);
  assert.match(block, /DefaultProjectContextService\.setForUser\(req\.user,\s*req\.body\.projectId\)/);
});

test('default-context routes return stable service errors without raw database details', () => {
  const getBlock = routeBlock('get', '/default-context');
  const putBlock = routeBlock('put', '/default-context');

  for (const block of [getBlock, putBlock]) {
    assert.match(block, /defaultProjectContextErrorResponse\(res,\s*error\)/);
    assert.doesNotMatch(block, /error\.message/);
    assert.doesNotMatch(block, /error:\s*error/);
  }
});
