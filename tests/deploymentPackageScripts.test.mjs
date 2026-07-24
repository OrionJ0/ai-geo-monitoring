import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');

test('root package exposes the single-host production commands', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
  );

  assert.equal(packageJson.scripts.deploy, 'node scripts/deploy.mjs');
  assert.equal(
    packageJson.scripts['deploy:check'],
    'node scripts/deploy.mjs --check'
  );
  assert.equal(
    packageJson.scripts['prod:start'],
    'node scripts/production.mjs start'
  );
  assert.equal(
    packageJson.scripts['prod:stop'],
    'node scripts/production.mjs stop'
  );
  assert.equal(
    packageJson.scripts['prod:status'],
    'node scripts/production.mjs status'
  );
});
