import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..');

test('status reports both production services without starting them', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-geo-status-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const { stdout } = await execFileAsync(
    process.execPath,
    ['scripts/production.mjs', 'status', '--json'],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        AI_GEO_PROCESS_MANAGER: 'manual',
        AI_GEO_RUNTIME_DIR: path.join(directory, 'run'),
        AI_GEO_LOG_DIR: path.join(directory, 'logs'),
      },
    }
  );
  const status = JSON.parse(stdout);

  assert.equal(status.backend.running, false);
  assert.equal(status.frontend.running, false);
});

test('status uses systemd units when systemd is the configured production manager', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-geo-systemd-status-'));
  const fakeSystemctl = path.join(directory, 'systemctl');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  fs.writeFileSync(
    fakeSystemctl,
    [
      '#!/bin/sh',
      'case "$2" in',
      '  ai-geo-backend.service) pid=7101 ;;',
      '  ai-geo-frontend.service) pid=7102 ;;',
      '  *) exit 2 ;;',
      'esac',
      "printf 'LoadState=loaded\\nActiveState=active\\nSubState=running\\nMainPID=%s\\nUser=ubuntu\\n' \"$pid\"",
      '',
    ].join('\n')
  );
  fs.chmodSync(fakeSystemctl, 0o755);

  const { stdout } = await execFileAsync(
    process.execPath,
    ['scripts/production.mjs', 'status', '--json'],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        AI_GEO_PROCESS_MANAGER: 'systemd',
        AI_GEO_TEST_SYSTEMCTL_BIN: fakeSystemctl,
      },
    }
  );
  const status = JSON.parse(stdout);

  assert.equal(status.backend.running, true);
  assert.equal(status.backend.pid, 7101);
  assert.equal(status.backend.unit, 'ai-geo-backend.service');
  assert.equal(status.frontend.running, true);
  assert.equal(status.frontend.pid, 7102);
  assert.equal(status.frontend.unit, 'ai-geo-frontend.service');
});
