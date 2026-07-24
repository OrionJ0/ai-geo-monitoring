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
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

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
      `JWT_SECRET=${'j'.repeat(32)}`,
      `CONFIG_ENCRYPTION_KEY=${Buffer.alloc(32, 7).toString('base64')}`,
      'DB_STORAGE=database.sqlite',
      '',
    ].join('\n')
  );

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

  fs.appendFileSync(path.join(directory, 'README.md'), 'dirty\n');
  await assert.rejects(
    execFileAsync(
      process.execPath,
      [deployScript, '--check', '--json'],
      { cwd: projectRoot, env: environment }
    ),
    /工作区存在未提交改动/
  );
});
