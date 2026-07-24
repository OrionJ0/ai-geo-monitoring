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
        AI_GEO_RUNTIME_DIR: path.join(directory, 'run'),
        AI_GEO_LOG_DIR: path.join(directory, 'logs'),
      },
    }
  );
  const status = JSON.parse(stdout);

  assert.equal(status.backend.running, false);
  assert.equal(status.frontend.running, false);
});
