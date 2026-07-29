const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function argumentValue(name) {
  const prefix = `${name}=`;
  const entry = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length).trim() : '';
}

function findTests(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return findTests(entryPath);
      return entry.isFile() && /\.test\.js$/u.test(entry.name)
        ? [entryPath]
        : [];
    })
    .sort();
}

const root = path.resolve(
  argumentValue('--root') || path.join(__dirname, '../tests/marketing')
);
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  process.stderr.write(`营销测试目录不存在: ${root}\n`);
  process.exitCode = 1;
} else {
  const tests = findTests(root);
  if (tests.length === 0) {
    process.stderr.write(`营销测试目录没有可执行测试: ${root}\n`);
    process.exitCode = 1;
  } else {
    const execution = spawnSync(process.execPath, ['--test', ...tests], {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024
    });
    if (execution.stdout) process.stdout.write(execution.stdout);
    if (execution.stderr) process.stderr.write(execution.stderr);
    if (execution.error) {
      process.stderr.write(`营销测试启动失败: ${execution.error.message}\n`);
      process.exitCode = 1;
    } else {
      process.exitCode = execution.signal ? 1 : (execution.status ?? 1);
    }
  }
}
