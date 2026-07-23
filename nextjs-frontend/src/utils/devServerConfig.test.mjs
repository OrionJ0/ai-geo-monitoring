import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const projectRoot = resolve(frontendRoot, '..');

function readPackageJson(directory) {
  return JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
}

test('development entry points use Turbopack on port 3001', () => {
  const rootPackage = readPackageJson(projectRoot);
  const frontendPackage = readPackageJson(frontendRoot);
  const developmentCommands = [
    rootPackage.scripts.dev,
    rootPackage.scripts['dev:frontend'],
    frontendPackage.scripts.dev,
  ];

  assert.equal(frontendPackage.scripts.dev, 'next dev -p 3001');
  assert.equal(
    rootPackage.scripts['dev:frontend'],
    'npm --prefix nextjs-frontend run dev',
  );
  assert.ok(
    rootPackage.scripts.dev.includes('npm --prefix nextjs-frontend run dev'),
  );
  assert.ok(
    developmentCommands.every((command) => !command.includes('--webpack')),
    'development commands must not opt out of the default Turbopack bundler',
  );
});
