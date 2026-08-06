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
  resolveCurrentReleaseState,
  runManagedCommand,
  assertActivationBudget,
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

test('verified bundle keeps the current worktree unchanged until candidate activation', async (t) => {
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

  await activatePreparedRelease({
    projectRoot: server,
    prepared,
    preflight: async () => {},
    stopProduction: async () => {},
    loadDeploy: async () => async () => {}
  });
  assert.equal((await git(server, ['rev-parse', 'HEAD'])).stdout.trim(), secondRevision);
});

test('activation preflights online, stops once, then fast-forwards and delegates to candidate', async (t) => {
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

  const events = [];
  await activatePreparedRelease({
    projectRoot: server,
    prepared,
    preflight: async () => {
      events.push('preflight');
      return { requireGeo010Acceptance: true };
    },
    stopProduction: async () => { events.push('stop'); },
    fastForward: async (options) => {
      events.push('fast-forward');
      await fastForwardPreparedRelease(options);
    },
    loadDeploy: async () => {
      events.push('load');
      return async (revision, options) => {
        events.push(
          `deploy:${revision}:${options.lockAlreadyAcquired}:${options.requireGeo010Acceptance}`
        );
      };
    }
  });
  assert.equal((await git(server, ['rev-parse', 'HEAD'])).stdout.trim(), secondRevision);
  assert.deepEqual(events, [
    'preflight',
    'stop',
    'fast-forward',
    'load',
    `deploy:${secondRevision}:true:true`
  ]);
});

test('offline failed release recovery forces full acceptance instead of trusting the current HEAD', async () => {
  const prepared = { previousRevision: 'a'.repeat(40), revision: 'b'.repeat(40) };
  const state = await resolveCurrentReleaseState({
    prepared,
    deadline: Date.now() + 5_000,
    readJson: async () => { throw new Error('connection refused'); },
    readServiceStates: async () => ['inactive', 'failed']
  });
  assert.deepEqual(state, { recovery: true });

  let deployOptions;
  await activatePreparedRelease({
    projectRoot: process.cwd(),
    prepared,
    preflight: async () => ({ requireGeo010Acceptance: true }),
    stopProduction: async () => {},
    fastForward: async () => {},
    loadDeploy: async () => async (_revision, options) => { deployOptions = options; }
  });
  assert.equal(deployOptions.requireGeo010Acceptance, true);
});

test('public preflight failure is not treated as recovery while either service is active', async () => {
  await assert.rejects(
    resolveCurrentReleaseState({
      prepared: { previousRevision: 'a'.repeat(40), revision: 'b'.repeat(40) },
      deadline: Date.now() + 5_000,
      readJson: async () => { throw new Error('revision mismatch'); },
      readServiceStates: async () => ['active', 'inactive']
    }),
    /revision mismatch/u
  );
});

test('bundle activation keeps the current release running when production preflight fails', async () => {
  const events = [];
  await assert.rejects(
    activatePreparedRelease({
      projectRoot: '/srv/ai-geo',
      prepared: { previousRevision: 'a'.repeat(40), revision: 'b'.repeat(40) },
      preflight: async () => {
        events.push('preflight');
        throw new Error('preflight failed');
      },
      fastForward: async () => { events.push('fast-forward'); },
      loadDeploy: async () => async () => { events.push('deploy'); }
    }),
    /preflight failed/u
  );
  assert.deepEqual(events, ['preflight']);
});

test('bundle activation keeps services stopped when fast-forward fails', async () => {
  const events = [];
  await assert.rejects(
    activatePreparedRelease({
      projectRoot: process.cwd(),
      prepared: {
        previousRevision: (await git(process.cwd(), ['rev-parse', 'HEAD'])).stdout.trim(),
        revision: 'b'.repeat(40)
      },
      preflight: async () => { events.push('preflight'); },
      stopProduction: async () => { events.push('stop'); },
      fastForward: async () => {
        events.push('fast-forward');
        throw new Error('fast-forward failed');
      },
      loadDeploy: async () => async () => {}
    }),
    /fast-forward failed/u
  );
  assert.deepEqual(events, ['preflight', 'stop', 'fast-forward', 'stop']);
});

test('expired Bundle deadline rejects before spawning a child process', async () => {
  await assert.rejects(
    runManagedCommand(process.execPath, ['-e', 'process.exit(91)'], {
      deadline: Date.now() - 1
    }),
    /345 分钟总 deadline/u
  );
});

test('activation refuses to stop production without the 70 minute reserve', async () => {
  assert.throws(
    () => assertActivationBudget(4_100_000, 0),
    /至少 70 分钟/u
  );
  assert.equal(assertActivationBudget(4_200_000, 0), 4_200_000);
});

test('activation keeps production running when dynamic acceptance budget was consumed', async () => {
  let stopped = false;
  await assert.rejects(
    activatePreparedRelease({
      projectRoot: process.cwd(),
      prepared: { previousRevision: 'a'.repeat(40), revision: 'b'.repeat(40) },
      preflight: async () => ({ requiredAcceptanceMs: 20 * 60 * 1000 }),
      stopProduction: async () => { stopped = true; },
      deadline: Date.now() + 80 * 60 * 1000
    }),
    /四入口验收预算/u
  );
  assert.equal(stopped, false);
});

test('activation reports both the release failure and cleanup stop failure', async () => {
  let stopCalls = 0;
  await assert.rejects(
    activatePreparedRelease({
      projectRoot: process.cwd(),
      prepared: { previousRevision: 'a'.repeat(40), revision: 'b'.repeat(40) },
      preflight: async () => ({}),
      stopProduction: async () => {
        stopCalls += 1;
        if (stopCalls === 2) throw new Error('cleanup stop failed');
      },
      fastForward: async () => { throw new Error('fast-forward failed'); },
      loadDeploy: async () => async () => {}
    }),
    (error) => {
      assert.equal(error instanceof AggregateError, true);
      assert.match(error.message, /fast-forward failed/u);
      assert.match(error.message, /cleanup stop failed/u);
      assert.deepEqual(error.errors.map((item) => item.message), [
        'fast-forward failed',
        'cleanup stop failed'
      ]);
      return true;
    }
  );
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
  const preflightIndex = mainBody.indexOf('checkPreconditions({');
  const prepareIndex = mainBody.indexOf('prepareBundleRelease({');
  assert.ok(preflightIndex >= 0);
  assert.ok(prepareIndex > preflightIndex);
});

test('candidate preflight always warms backend and frontend dependencies before activation', () => {
  const source = fs.readFileSync(
    path.join(path.resolve(import.meta.dirname, '..'), 'scripts', 'deploy-from-bundle.mjs'),
    'utf8'
  );
  const preflight = source.slice(
    source.indexOf('async function runProductionPreflight'),
    source.indexOf('export async function activatePreparedRelease')
  );
  const backendDependencyIndex = preflight.indexOf("runManagedCommand('npm', ['ci', '--include=dev']");
  const frontendDependencyIndex = preflight.indexOf(
    "runManagedCommand('npm', ['ci', '--include=dev']",
    backendDependencyIndex + 1
  );
  const acceptanceIndex = preflight.indexOf('releaseState.recovery ? \'--recovery-preflight\'');
  const stopIndex = preflight.indexOf('stopProductionServices');

  assert.ok(backendDependencyIndex >= 0);
  assert.ok(frontendDependencyIndex > backendDependencyIndex);
  const unchangedReturnIndex = preflight.indexOf(
    'return { requireGeo010Acceptance: false, dependenciesPreflighted: true }'
  );
  assert.ok(unchangedReturnIndex > frontendDependencyIndex);
  assert.ok(acceptanceIndex > frontendDependencyIndex);
  assert.equal(stopIndex, -1);
});
