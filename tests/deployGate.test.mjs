import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..');
const gate = path.join(projectRoot, 'deploy', 'ai-geo-deploy-gate.sh');

test('SSH deploy gate rejects commands outside the exact Bundle contract', async () => {
  await assert.rejects(
    execFileAsync(gate, [], {
      env: { ...process.env, SSH_ORIGINAL_COMMAND: 'mktemp -d /tmp/release.XXXXXXXX' }
    }),
    (error) => error.code === 126
  );
});

test('SSH deploy gate safely reserves a new Bundle path and rejects a symlink', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-gate-bin-'));
  const revision = 'a'.repeat(40);
  const bundlePath = `/tmp/ai-geo-release-${revision}.bundle`;
  const fakeScp = path.join(directory, 'scp');
  fs.writeFileSync(fakeScp, '#!/bin/sh\nprintf "%s\\n" "$*"\n');
  fs.chmodSync(fakeScp, 0o755);
  fs.rmSync(bundlePath, { force: true });
  t.after(() => {
    fs.rmSync(bundlePath, { force: true });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const environment = {
    ...process.env,
    PATH: `${directory}:${process.env.PATH}`,
    SSH_ORIGINAL_COMMAND: `scp -t ${bundlePath}`
  };
  const accepted = await execFileAsync(gate, [], { env: environment });
  assert.equal(accepted.stdout.trim(), `-t ${bundlePath}`);
  assert.equal(fs.statSync(bundlePath).mode & 0o777, 0o600);

  fs.rmSync(bundlePath, { force: true });
  fs.writeFileSync(fakeScp, '#!/bin/sh\nexit 7\n');
  await assert.rejects(
    execFileAsync(gate, [], { env: environment }),
    (error) => error.code === 7
  );
  assert.equal(fs.existsSync(bundlePath), false, '中断上传必须允许同一 commit 重试');

  fs.symlinkSync('/tmp/ai-geo-gate-do-not-touch', bundlePath);
  await assert.rejects(
    execFileAsync(gate, [], { env: environment }),
    (error) => error.code === 126
  );
  assert.equal(fs.readlinkSync(bundlePath), '/tmp/ai-geo-gate-do-not-touch');
});
