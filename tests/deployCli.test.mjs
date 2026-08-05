import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..');
const deployScript = path.join(projectRoot, 'scripts', 'deploy.mjs');

async function git(cwd, args) {
  return execFileAsync('git', args, { cwd });
}

test('deployment check accepts a clean main checkout and rejects local changes', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-geo-deploy-'));
  const remoteDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ai-geo-deploy-remote-')
  );
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(remoteDirectory, { recursive: true, force: true });
  });

  fs.mkdirSync(path.join(directory, 'backend'), { recursive: true });
  fs.mkdirSync(path.join(directory, 'nextjs-frontend'), { recursive: true });
  fs.writeFileSync(
    path.join(directory, '.gitignore'),
    'backend/.env\n*.sqlite\n'
  );
  fs.writeFileSync(path.join(directory, 'README.md'), 'fixture\n');
  fs.writeFileSync(path.join(directory, 'backend', 'database.sqlite'), '');
  fs.writeFileSync(
    path.join(directory, 'backend', '.env'),
    [
      'PORT=3002',
      'NODE_ENV=production',
      `JWT_SECRET=${'j'.repeat(32)}`,
      `CONFIG_ENCRYPTION_KEY=${Buffer.alloc(32, 7).toString('base64')}`,
      'DB_STORAGE=database.sqlite',
      '',
    ].join('\n')
  );
  fs.chmodSync(path.join(directory, 'backend', 'database.sqlite'), 0o600);
  fs.chmodSync(path.join(directory, 'backend', '.env'), 0o600);

  await git(directory, ['init', '-b', 'main']);
  await git(directory, ['add', '.gitignore', 'README.md']);
  await git(directory, [
    '-c',
    'user.name=Deployment Test',
    '-c',
    'user.email=deployment-test@example.com',
    'commit',
    '-m',
    'fixture',
  ]);
  await git(remoteDirectory, ['init', '--bare']);
  await git(directory, ['remote', 'add', 'origin', remoteDirectory]);
  await git(directory, ['push', '-u', 'origin', 'main']);

  const environment = {
    ...process.env,
    AI_GEO_PROJECT_ROOT: directory,
  };
  const { stdout } = await execFileAsync(
    process.execPath,
    [deployScript, '--check', '--json'],
    { cwd: projectRoot, env: environment }
  );
  assert.equal(JSON.parse(stdout).ok, true);
  const { stdout: revisionOutput } = await git(directory, ['rev-parse', 'HEAD']);
  const revision = revisionOutput.trim();
  const prepared = await execFileAsync(
    process.execPath,
    [deployScript, '--check', '--json', `--prepared-revision=${revision}`],
    { cwd: projectRoot, env: environment }
  );
  assert.equal(JSON.parse(prepared.stdout).revision, revision);

  fs.writeFileSync(
    path.join(directory, 'backend', '.env'),
    fs.readFileSync(path.join(directory, 'backend', '.env'), 'utf8')
      .replace('NODE_ENV=production\n', '')
  );
  await assert.rejects(
    execFileAsync(
      process.execPath,
      [deployScript, '--check', '--json'],
      { cwd: projectRoot, env: environment }
    ),
    /NODE_ENV 必须显式设置为 production/
  );
  fs.appendFileSync(
    path.join(directory, 'backend', '.env'),
    'NODE_ENV=production\n'
  );
  await assert.rejects(
    execFileAsync(
      process.execPath,
      [deployScript, '--check', '--json', `--prepared-revision=${'0'.repeat(40)}`],
      { cwd: projectRoot, env: environment }
    ),
    /预置版本与当前 HEAD 不一致/
  );

  fs.appendFileSync(path.join(directory, 'README.md'), 'dirty\n');
  await assert.rejects(
    execFileAsync(
      process.execPath,
      [deployScript, '--check', '--json'],
      { cwd: projectRoot, env: environment }
    ),
    /工作区存在未提交改动/
  );

  fs.writeFileSync(path.join(directory, 'README.md'), 'fixture\n');
  fs.writeFileSync(path.join(directory, 'local-only.txt'), 'not pushed\n');
  await git(directory, ['add', 'local-only.txt']);
  await git(directory, [
    '-c',
    'user.name=Deployment Test',
    '-c',
    'user.email=deployment-test@example.com',
    'commit',
    '-m',
    'local only',
  ]);

  await assert.rejects(
    execFileAsync(
      process.execPath,
      [deployScript],
      { cwd: projectRoot, env: environment }
    ),
    /HEAD 与 origin\/main 不一致/
  );
});

test('deployment builds the current frontend before browser acceptance and migrates before startup', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-geo-deploy-flow-'));
  const remoteDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ai-geo-deploy-flow-remote-')
  );
  const binDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-geo-deploy-bin-'));
  const tracePath = path.join(directory, 'deploy-trace.log');
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(remoteDirectory, { recursive: true, force: true });
    fs.rmSync(binDirectory, { recursive: true, force: true });
  });

  fs.mkdirSync(path.join(directory, 'backend', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(directory, 'deploy'), { recursive: true });
  fs.mkdirSync(path.join(directory, 'nextjs-frontend'), { recursive: true });
  fs.mkdirSync(path.join(directory, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(directory, '.gitignore'),
    'backend/.env\nbackend/database.sqlite\nbackend/database.latest.sqlite\n.runtime/\nlogs/\ndeploy-trace.log\n'
  );
  fs.writeFileSync(path.join(directory, 'README.md'), 'fixture\n');
  fs.writeFileSync(
    path.join(directory, 'deploy', 'ai-geo-deploy-gate.sh'),
    '#!/bin/sh\nexit 126\n'
  );
  fs.writeFileSync(path.join(directory, 'backend', 'package.json'), '{}\n');
  fs.writeFileSync(path.join(directory, 'nextjs-frontend', 'package.json'), '{}\n');
  fs.writeFileSync(path.join(directory, 'backend', 'database.sqlite'), 'database\n');
  fs.writeFileSync(
    path.join(directory, 'backend', '.env'),
    [
      'PORT=3002',
      'NODE_ENV=production',
      `JWT_SECRET=${'j'.repeat(32)}`,
      `CONFIG_ENCRYPTION_KEY=${Buffer.alloc(32, 7).toString('base64')}`,
      'DB_STORAGE=database.sqlite',
      '',
    ].join('\n')
  );
  fs.chmodSync(path.join(directory, 'backend', 'database.sqlite'), 0o600);
  fs.chmodSync(path.join(directory, 'backend', '.env'), 0o600);
  fs.writeFileSync(
    path.join(directory, 'scripts', 'production.mjs'),
    "import fs from 'node:fs'; fs.appendFileSync(process.env.AI_GEO_DEPLOY_TRACE, `production:${process.argv[2]}\\n`);\n"
  );
  fs.writeFileSync(
    path.join(directory, 'backend', 'scripts', 'backupSqlite.js'),
    "const fs = require('node:fs'); fs.mkdirSync(require('node:path').dirname(process.argv[3]), { recursive: true }); if (!process.argv.includes('--if-absent') || !fs.existsSync(process.argv[3])) fs.copyFileSync(process.argv[2], process.argv[3]); fs.appendFileSync(process.env.AI_GEO_DEPLOY_TRACE, `backup:${process.argv[3]}:${process.argv.slice(4).join(' ')}\\n`);\n"
  );
  fs.writeFileSync(
    path.join(directory, 'backend', 'scripts', 'migrateGeoMetricSemantics.js'),
    "const fs = require('node:fs'); fs.appendFileSync(process.env.AI_GEO_DEPLOY_TRACE, `migration:${process.argv.slice(2).join(' ')}\\n`);\n"
  );
  fs.writeFileSync(
    path.join(directory, 'backend', 'scripts', 'migrateMarketing.js'),
    "const fs = require('node:fs'); fs.appendFileSync(process.env.AI_GEO_DEPLOY_TRACE, `marketing-migration:${process.argv.slice(2).join(' ')}\\n`);\n"
  );
  fs.writeFileSync(
    path.join(directory, 'backend', 'scripts', 'migrateWebsiteData.js'),
    "const fs = require('node:fs'); fs.appendFileSync(process.env.AI_GEO_DEPLOY_TRACE, `website-data-migration:${process.argv.slice(2).join(' ')}\\n`);\n"
  );
  fs.writeFileSync(
    path.join(directory, 'backend', 'scripts', 'migrateConsultationRecords.js'),
    "const fs = require('node:fs'); fs.appendFileSync(process.env.AI_GEO_DEPLOY_TRACE, `consultation-migration:${process.argv.slice(2).join(' ')}\\n`);\n"
  );
  const fakeNpm = path.join(binDirectory, 'npm');
  fs.writeFileSync(
    fakeNpm,
    "#!/bin/sh\nprintf 'npm:%s\\n' \"$*\" >> \"$AI_GEO_DEPLOY_TRACE\"\n"
  );
  fs.chmodSync(fakeNpm, 0o755);

  await git(directory, ['init', '-b', 'main']);
  await git(directory, ['add', '.']);
  await git(directory, [
    '-c',
    'user.name=Deployment Test',
    '-c',
    'user.email=deployment-test@example.com',
    'commit',
    '-m',
    'fixture',
  ]);
  await git(remoteDirectory, ['init', '--bare']);
  await git(directory, ['remote', 'add', 'origin', remoteDirectory]);
  await git(directory, ['push', '-u', 'origin', 'main']);

  await execFileAsync(
    process.execPath,
    [deployScript],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        PATH: `${binDirectory}:${process.env.PATH}`,
        AI_GEO_PROJECT_ROOT: directory,
        AI_GEO_DEPLOY_TRACE: tracePath,
        AI_GEO_DEPLOY_GATE_PATH: path.join(directory, 'installed-deploy-gate'),
      }
    }
  );

  const trace = fs.readFileSync(tracePath, 'utf8').trim().split('\n');
  assert.equal(
    trace.filter((line) => line === 'npm:ci --include=dev').length,
    2
  );
  const releaseBackupIndex = trace.findIndex((line) => (
    line.includes('/releases/database.pre-') && line.endsWith(':--if-absent')
  ));
  const latestBackupIndex = trace.findIndex((line) => (
    line.endsWith('/backend/database.latest.sqlite:')
  ));
  const frontendBuildIndex = trace.indexOf('npm:run build');
  const browserAcceptanceIndex = trace.indexOf('npm:run test:marketing:browser');
  const applyIndex = trace.findIndex((line) => line.startsWith('migration:--apply '));
  const auditIndex = trace.indexOf('migration:');
  const marketingApplyIndex = trace.indexOf(
    'marketing-migration:--apply --expected-latest=016-revisioned-ad-snapshot-facts'
  );
  const marketingAuditIndex = trace.indexOf('marketing-migration:');
  const websiteDataTestIndex = trace.indexOf('npm:run test:website-data');
  const websiteDataApplyIndex = trace.indexOf('website-data-migration:--apply');
  const websiteDataAuditIndex = trace.indexOf('website-data-migration:');
  const consultationTestIndex = trace.indexOf('npm:run test:consultation-records');
  const consultationApplyIndex = trace.indexOf('consultation-migration:--apply');
  const consultationAuditIndex = trace.indexOf('consultation-migration:');
  const startIndex = trace.indexOf('production:start');
  assert.ok(releaseBackupIndex >= 0);
  assert.ok(latestBackupIndex > releaseBackupIndex);
  assert.ok(frontendBuildIndex > latestBackupIndex);
  assert.ok(browserAcceptanceIndex > frontendBuildIndex);
  assert.ok(applyIndex > latestBackupIndex);
  assert.ok(applyIndex > browserAcceptanceIndex);
  assert.ok(auditIndex > applyIndex);
  assert.ok(marketingApplyIndex > auditIndex);
  assert.ok(marketingAuditIndex > marketingApplyIndex);
  assert.ok(websiteDataTestIndex > latestBackupIndex);
  assert.ok(websiteDataApplyIndex > marketingAuditIndex);
  assert.ok(websiteDataAuditIndex > websiteDataApplyIndex);
  assert.ok(consultationTestIndex > latestBackupIndex);
  assert.ok(consultationApplyIndex > websiteDataAuditIndex);
  assert.ok(consultationAuditIndex > consultationApplyIndex);
  assert.ok(startIndex > consultationAuditIndex);
  assert.equal(
    fs.readFileSync(path.join(directory, 'installed-deploy-gate'), 'utf8'),
    '#!/bin/sh\nexit 126\n'
  );
  assert.equal(
    fs.statSync(path.join(directory, 'installed-deploy-gate')).mode & 0o777,
    0o755
  );
});

test('deployment binds the frontend production build to the release revision', () => {
  const source = fs.readFileSync(deployScript, 'utf8');
  assert.match(
    source,
    /AI_GEO_BUILD_REVISION:\s*revision/u
  );
});
