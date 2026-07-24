import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function terminateKnownChild(pid, timeoutMs = 1_000) {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return;
    }
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && isAlive(pid)) {
    await delay(50);
  }
  if (isAlive(pid)) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      process.kill(pid, 'SIGKILL');
    }
  }
}

async function readProcessCommand(pid) {
  try {
    const { stdout } = await execFileAsync('ps', [
      '-p',
      String(pid),
      '-o',
      'command=',
    ]);
    return stdout.trim();
  } catch {
    return '';
  }
}

async function writeJsonAtomically(filename, value) {
  const temporaryPath = `${filename}.tmp`;
  await fs.promises.writeFile(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
    { mode: 0o600 }
  );
  await fs.promises.rename(temporaryPath, filename);
}

function createProcessManager({ runtimeDirectory, logDirectory }) {
  const recordPath = (service) =>
    path.join(runtimeDirectory, `${service.name}.json`);

  async function readRecord(service) {
    try {
      return JSON.parse(await fs.promises.readFile(recordPath(service), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function inspect(service) {
    const record = await readRecord(service);
    if (!record) return { running: false, pid: null, verified: false };
    if (!Number.isInteger(record.pid) || !isAlive(record.pid)) {
      return { running: false, pid: record.pid || null, verified: false };
    }

    const commandLine = await readProcessCommand(record.pid);
    const verified = Boolean(
      commandLine && (!service.marker || commandLine.includes(service.marker))
    );
    return {
      running: verified,
      pid: record.pid,
      verified,
      commandLine,
    };
  }

  async function status(service) {
    const result = await inspect(service);
    if (!result.running && result.pid && !isAlive(result.pid)) {
      await fs.promises.rm(recordPath(service), { force: true });
    }
    return result;
  }

  async function start(service) {
    await fs.promises.mkdir(runtimeDirectory, { recursive: true });
    await fs.promises.mkdir(logDirectory, { recursive: true });

    const current = await inspect(service);
    if (current.running) return current;
    if (current.pid && isAlive(current.pid)) {
      throw new Error(
        `${service.name} 的 PID ${current.pid} 存活但命令不匹配，拒绝覆盖进程记录`
      );
    }

    await fs.promises.rm(recordPath(service), { force: true });
    const logPath = path.join(logDirectory, `${service.name}.log`);
    const logDescriptor = fs.openSync(logPath, 'a', 0o600);
    let child;
    try {
      child = spawn(service.command, service.args, {
        cwd: service.cwd,
        detached: true,
        env: service.env || process.env,
        stdio: ['ignore', logDescriptor, logDescriptor],
      });
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
    } finally {
      fs.closeSync(logDescriptor);
    }

    child.unref();
    await writeJsonAtomically(recordPath(service), {
      pid: child.pid,
      marker: service.marker,
      startedAt: new Date().toISOString(),
    });

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await inspect(service);
      if (result.running) return result;
      if (!isAlive(child.pid)) break;
      await delay(50);
    }

    await terminateKnownChild(child.pid);
    await fs.promises.rm(recordPath(service), { force: true });
    throw new Error(`${service.name} 启动后未通过进程校验`);
  }

  async function stop(service, { timeoutMs = 10_000 } = {}) {
    const current = await inspect(service);
    if (!current.pid || !isAlive(current.pid)) {
      await fs.promises.rm(recordPath(service), { force: true });
      return { running: false, pid: current.pid || null };
    }
    if (!current.verified) {
      throw new Error(
        `${service.name} 的 PID ${current.pid} 命令不匹配，拒绝终止未知进程`
      );
    }

    try {
      process.kill(-current.pid, 'SIGTERM');
    } catch {
      process.kill(current.pid, 'SIGTERM');
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && isAlive(current.pid)) {
      await delay(100);
    }

    if (isAlive(current.pid)) {
      try {
        process.kill(-current.pid, 'SIGKILL');
      } catch {
        process.kill(current.pid, 'SIGKILL');
      }
    }

    await fs.promises.rm(recordPath(service), { force: true });
    return { running: false, pid: current.pid };
  }

  return {
    start,
    status,
    stop,
  };
}

export {
  createProcessManager,
};
