import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import * as bundleDeployment from '../scripts/deploy-from-bundle.mjs';

const {
  prepareBundleRelease,
  fastForwardPreparedRelease,
  activatePreparedRelease,
} = bundleDeployment;

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

test('verified bundle can defer the worktree fast-forward until production is stopped', async (t) => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-geo-deferred-source-'));
  const server = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-geo-deferred-server-'));
  const bundlePath = path.join(os.tmpdir(), `ai-geo-deferred-${process.pid}-${Date.now()}.bundle`);
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
  const prepared = await prepareBundleRelease({
    projectRoot: server,
    bundlePath,
    expectedRevision: secondRevision,
    expectedSha256: createHash('sha256').update(fs.readFileSync(bundlePath)).digest('hex'),
    deferFastForward: true
  });

  assert.equal((await git(server, ['rev-parse', 'HEAD'])).stdout.trim(), firstRevision);

  await assert.rejects(
    activatePreparedRelease({
      projectRoot: server,
      prepared,
      stopProduction: async () => ({}),
      loadDeploy: async () => async () => {}
    }),
    /停服状态无效/u
  );
  assert.equal((await git(server, ['rev-parse', 'HEAD'])).stdout.trim(), firstRevision);
  await fastForwardPreparedRelease({ projectRoot: server, ...prepared });
  assert.equal((await git(server, ['rev-parse', 'HEAD'])).stdout.trim(), secondRevision);
});

test('activation keeps HEAD unchanged on stop failure and deploys only after a verified stop', async (t) => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-geo-activate-source-'));
  const server = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-geo-activate-server-'));
  const bundlePath = path.join(os.tmpdir(), `ai-geo-activate-${process.pid}-${Date.now()}.bundle`);
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
  const prepared = await prepareBundleRelease({
    projectRoot: server,
    bundlePath,
    expectedRevision: secondRevision,
    expectedSha256: createHash('sha256').update(fs.readFileSync(bundlePath)).digest('hex'),
    deferFastForward: true
  });

  await assert.rejects(
    activatePreparedRelease({
      projectRoot: server,
      prepared,
      stopProduction: async () => ({
        backend: { running: true, pid: 6201 },
        frontend: { running: false, pid: null }
      }),
      loadDeploy: async () => async () => {}
    }),
    /生产进程未完全停止/u
  );
  assert.equal((await git(server, ['rev-parse', 'HEAD'])).stdout.trim(), firstRevision);

  const events = [];
  await activatePreparedRelease({
    projectRoot: server,
    prepared,
    stopProduction: async () => {
      events.push('stop');
      return {
        backend: { running: false, pid: null },
        frontend: { running: false, pid: null }
      };
    },
    loadDeploy: async () => {
      events.push('load');
      return async (revision, options) => {
        events.push(`deploy:${revision}:${options.lockAlreadyAcquired}`);
      };
    }
  });
  assert.equal((await git(server, ['rev-parse', 'HEAD'])).stdout.trim(), secondRevision);
  assert.deepEqual(events, [
    'stop',
    'load',
    `deploy:${secondRevision}:true`
  ]);
});

test('bundle deployment loads the candidate deploy module after fast-forward', async (t) => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-geo-candidate-source-'));
  const server = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-geo-candidate-server-'));
  const bundlePath = path.join(os.tmpdir(), `ai-geo-candidate-${process.pid}-${Date.now()}.bundle`);
  t.after(() => {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(server, { recursive: true, force: true });
    fs.rmSync(bundlePath, { force: true });
  });

  await git(source, ['init', '-b', 'main']);
  fs.mkdirSync(path.join(source, 'scripts'));
  fs.copyFileSync(
    path.join(path.resolve(import.meta.dirname, '..'), 'scripts', 'deploy-from-bundle.mjs'),
    path.join(source, 'scripts', 'deploy-from-bundle.mjs')
  );
  fs.writeFileSync(
    path.join(source, 'scripts', 'deploy.mjs'),
    [
      "export async function acquireDeploymentLock() {}",
      "export async function releaseDeploymentLock() {}",
      "export async function deploy() { return 'old'; }",
      ''
    ].join('\n')
  );
  await git(source, ['add', '.']);
  await git(source, [
    '-c', 'user.name=Bundle Test',
    '-c', 'user.email=bundle-test@example.com',
    'commit', '-m', 'old deployer'
  ]);
  const firstRevision = (await git(source, ['rev-parse', 'HEAD'])).stdout.trim();

  fs.writeFileSync(
    path.join(source, 'scripts', 'deploy.mjs'),
    "export async function deploy() { return 'candidate'; }\n"
  );
  await git(source, ['add', '.']);
  await git(source, [
    '-c', 'user.name=Bundle Test',
    '-c', 'user.email=bundle-test@example.com',
    'commit', '-m', 'candidate deployer'
  ]);
  const secondRevision = (await git(source, ['rev-parse', 'HEAD'])).stdout.trim();
  await git(source, ['bundle', 'create', bundlePath, 'main']);

  await git(server, ['init', '-b', 'main']);
  await git(server, ['fetch', source, firstRevision]);
  await git(server, ['reset', '--hard', firstRevision]);
  const bootstrapLauncher = await import(
    `${new URL(`file://${path.join(server, 'scripts', 'deploy-from-bundle.mjs')}`).href}?release=bridge`
  );
  assert.equal(typeof bootstrapLauncher.prepareBundleRelease, 'function');
  const oldModule = await import(`${new URL(`file://${path.join(server, 'scripts', 'deploy.mjs')}`).href}?release=old`);
  assert.equal(await oldModule.deploy(), 'old');

  await bootstrapLauncher.prepareBundleRelease({
    projectRoot: server,
    bundlePath,
    expectedRevision: secondRevision,
    expectedSha256: createHash('sha256').update(fs.readFileSync(bundlePath)).digest('hex')
  });
  assert.equal(typeof bootstrapLauncher.loadPreparedDeploy, 'function');
  const candidateDeploy = await bootstrapLauncher.loadPreparedDeploy({
    projectRoot: server,
    revision: secondRevision
  });
  assert.equal(await candidateDeploy(), 'candidate');
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
  const deploymentConfigIndex = workflow.indexOf('验证生产部署配置');
  const backendTestIndex = workflow.indexOf('npm test');
  const frontendBuildIndex = workflow.indexOf('npm run build');
  const bundleIndex = workflow.indexOf('git bundle create');
  const artifactUploadIndex = workflow.indexOf('actions/upload-artifact@');
  const deployJobIndex = workflow.indexOf('\n  deploy:');
  const artifactDownloadIndex = workflow.indexOf('actions/download-artifact@');
  const publicGateIndex = workflow.indexOf('验证唯一正式公网入口');
  assert.ok(deploymentConfigIndex >= 0);
  assert.ok(backendTestIndex >= 0);
  assert.ok(frontendBuildIndex > backendTestIndex);
  assert.ok(bundleIndex > frontendBuildIndex);
  assert.ok(artifactUploadIndex > bundleIndex);
  assert.ok(deployJobIndex > artifactUploadIndex);
  assert.ok(artifactDownloadIndex > deployJobIndex);
  assert.ok(deploymentConfigIndex > artifactDownloadIndex);
  assert.ok(publicGateIndex > workflow.indexOf('deploy-from-bundle.mjs'));
  assert.match(workflow, /\n  verify:\n[\s\S]*?runs-on: ubuntu-latest/);
  assert.match(workflow, /\n  deploy:\n\s+needs: verify\n[\s\S]*?environment: production/);
  assert.match(workflow, /actions\/upload-artifact@[a-f0-9]{40}/);
  assert.match(workflow, /actions\/download-artifact@[a-f0-9]{40}/);
  assert.match(workflow, /git bundle create .*refs\/heads\/main/);
  assert.match(workflow, /sha256sum/);
  assert.match(workflow, /scp -O[\s\S]*?"\$BUNDLE"/);
  assert.match(workflow, /npm run test:deployment/);
  assert.match(workflow, /npm run test:marketing:browser/);
  assert.match(workflow, /AI_GEO_BUILD_REVISION/);
  for (const secret of [
    'AI_GEO_DEPLOY_HOST',
    'AI_GEO_DEPLOY_USER',
    'AI_GEO_DEPLOY_SSH_KEY',
    'AI_GEO_DEPLOY_KNOWN_HOSTS'
  ]) {
    assert.match(workflow, new RegExp(`\\$\\{\\{ secrets\\.${secret} \\}\\}`));
    assert.match(workflow, new RegExp(`test -n \\"\\$${secret}\\"`));
  }
  assert.ok(workflow.indexOf('secrets.') > deployJobIndex);
  assert.match(workflow, /-F \/dev\/null/);
  assert.match(workflow, /BatchMode=yes/);
  assert.match(workflow, /IdentitiesOnly=yes/);
  assert.match(workflow, /StrictHostKeyChecking=yes/);
  assert.match(workflow, /UserKnownHostsFile=/);
  assert.match(workflow, /deploy-from-bundle\.mjs/);
  assert.match(workflow, /:\/tmp\/ai-geo-release-\$\{GITHUB_SHA\}\.bundle/);
  assert.doesNotMatch(workflow, /scp -O[^\n]*scripts\//);
  assert.match(workflow, /--revision=/);
  assert.match(workflow, /--sha256=/);
  assert.match(workflow, /const baseUrl = 'https:\/\/insight\.guangtuo\.com'/);
  assert.match(workflow, /readJson\('\/api\/health'\)/);
  assert.match(workflow, /readJson\('\/api\/ready'\)/);
  assert.match(workflow, /readJson\('\/api\/frontend-health'\)/);
  assert.match(workflow, /health\.revision !== expectedRevision/);
  assert.match(workflow, /ready\.status !== 'ready'/);
  assert.match(workflow, /frontend\.revision !== expectedRevision/);
  assert.match(workflow, /signal: AbortSignal\.timeout\(/);
  assert.match(workflow, /redirect: 'error'/);
  assert.match(workflow, /cache: 'no-store'/);
  assert.match(workflow, /new URL\(response\.url\)\.origin !== baseUrl/);
  assert.doesNotMatch(workflow, /git pull/);
});

test('bundle deployment checks the current server before fast-forwarding main', () => {
  const source = fs.readFileSync(
    path.join(path.resolve(import.meta.dirname, '..'), 'scripts', 'deploy-from-bundle.mjs'),
    'utf8'
  );
  const mainBody = source.slice(source.indexOf('async function main()'));
  const preflightIndex = mainBody.indexOf('checkPreconditions()');
  const prepareIndex = mainBody.indexOf('prepareBundleRelease({');
  assert.ok(preflightIndex >= 0);
  assert.ok(prepareIndex > preflightIndex);
});
