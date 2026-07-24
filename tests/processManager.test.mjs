import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createProcessManager } from '../scripts/processManager.mjs';

test('starts, reports, and stops a detached managed process', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-geo-process-'));
  const marker = `ai-geo-managed-${process.pid}-${Date.now()}`;
  const manager = createProcessManager({
    runtimeDirectory: path.join(directory, 'run'),
    logDirectory: path.join(directory, 'logs'),
  });
  const service = {
    name: 'fixture',
    command: process.execPath,
    args: ['-e', `process.title='${marker}';setInterval(()=>{},1000)`],
    cwd: directory,
    marker,
  };

  t.after(async () => {
    await manager.stop(service, { timeoutMs: 1000 }).catch(() => {});
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const started = await manager.start(service);
  assert.equal(started.running, true);
  assert.equal(started.pid > 0, true);

  const status = await manager.status(service);
  assert.equal(status.running, true);
  assert.equal(status.pid, started.pid);

  const stopped = await manager.stop(service, { timeoutMs: 1000 });
  assert.equal(stopped.running, false);
  assert.equal((await manager.status(service)).running, false);
});

test('cleans up a child that fails the managed command verification', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-geo-process-fail-'));
  const pidPath = path.join(directory, 'fixture.pid');
  const manager = createProcessManager({
    runtimeDirectory: path.join(directory, 'run'),
    logDirectory: path.join(directory, 'logs'),
  });
  const service = {
    name: 'fixture',
    command: process.execPath,
    args: [
      '-e',
      `require('node:fs').writeFileSync(${JSON.stringify(pidPath)},String(process.pid));setInterval(()=>{},1000)`,
    ],
    cwd: directory,
    marker: 'marker-that-is-not-in-the-command',
  };

  t.after(() => {
    if (fs.existsSync(pidPath)) {
      const pid = Number(fs.readFileSync(pidPath, 'utf8'));
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {}
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  await assert.rejects(manager.start(service), /启动后未通过进程校验/);
  const pid = Number(fs.readFileSync(pidPath, 'utf8'));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.throws(() => process.kill(pid, 0));
  assert.equal((await manager.status(service)).running, false);
});
