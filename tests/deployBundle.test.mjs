import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { prepareBundleRelease } from '../scripts/deploy-from-bundle.mjs';

const execFileAsync = promisify(execFile);

async function git(cwd, args) {
  return execFileAsync('git', args, { cwd });
}

test('verified bundle fast-forwards a clean main checkout without contacting origin', async (t) => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-geo-bundle-source-'));
  const server = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-geo-bundle-server-'));
  const bundlePath = path.join(os.tmpdir(), `ai-geo-release-${process.pid}-${Date.now()}.bundle`);
  t.after(() => {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(server, { recursive: true, force: true });
    fs.rmSync(bundlePath, { force: true });
  });

  await git(source, ['init', '-b', 'main']);
  fs.writeFileSync(path.join(source, 'version.txt'), 'one\n');
  await git(source, ['add', 'version.txt']);
  await git(source, [
    '-c', 'user.name=Bundle Test',
    '-c', 'user.email=bundle-test@example.com',
    'commit', '-m', 'version one'
  ]);
  const firstRevision = (await git(source, ['rev-parse', 'HEAD'])).stdout.trim();

  fs.writeFileSync(path.join(source, 'version.txt'), 'two\n');
  await git(source, ['add', 'version.txt']);
  await git(source, [
    '-c', 'user.name=Bundle Test',
    '-c', 'user.email=bundle-test@example.com',
    'commit', '-m', 'version two'
  ]);
  const secondRevision = (await git(source, ['rev-parse', 'HEAD'])).stdout.trim();
  await git(source, ['bundle', 'create', bundlePath, 'main']);

  await git(server, ['init', '-b', 'main']);
  await git(server, ['fetch', source, firstRevision]);
  await git(server, ['reset', '--hard', firstRevision]);
  const sha256 = createHash('sha256').update(fs.readFileSync(bundlePath)).digest('hex');

  const result = await prepareBundleRelease({
    projectRoot: server,
    bundlePath,
    expectedRevision: secondRevision,
    expectedSha256: sha256
  });

  assert.equal(result.previousRevision, firstRevision);
  assert.equal(result.revision, secondRevision);
  assert.equal((await git(server, ['rev-parse', 'HEAD'])).stdout.trim(), secondRevision);
  assert.equal(fs.readFileSync(path.join(server, 'version.txt'), 'utf8'), 'two\n');
});

test('production workflow transfers a verified bundle instead of pulling GitHub on the server', () => {
  const workflowPath = path.join(
    path.resolve(import.meta.dirname, '..'),
    '.github',
    'workflows',
    'deploy-production.yml'
  );
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /if: vars\.AI_GEO_DEPLOY_ENABLED == 'true'/);
  assert.match(workflow, /uses: actions\/checkout@[a-f0-9]{40}/);
  assert.match(workflow, /git bundle create .*refs\/heads\/main/);
  assert.match(workflow, /sha256sum/);
  assert.match(workflow, /scp -O .*\.bundle/);
  assert.match(workflow, /deploy-from-bundle\.mjs/);
  assert.match(workflow, /--revision=/);
  assert.match(workflow, /--sha256=/);
  assert.doesNotMatch(workflow, /git pull/);
});
