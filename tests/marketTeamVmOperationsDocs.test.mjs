import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

test('VM operations docs define the complete single-instance shared-admin boundary', () => {
  const readme = read('README.md');
  const deployment = read('docs/SINGLE_HOST_DEPLOYMENT.md');
  const environment = read('docs/ENVIRONMENT.md');
  const api = read('docs/API.md');
  const envExample = read('backend/.env.example');

  const stopIndex = deployment.indexOf('npm run prod:stop');
  const loginIndex = deployment.indexOf('npm run web:login -- deepseek-web', stopIndex);
  const startIndex = deployment.indexOf('npm run prod:start', loginIndex);
  assert.ok(stopIndex >= 0 && loginIndex > stopIndex && startIndex > loginIndex);

  assert.match(deployment, /持久.*图形桌面会话/);
  assert.match(deployment, /不得休眠/);
  assert.match(deployment, /远程桌面断开.*不能.*销毁.*会话/);
  assert.match(deployment, /数据库.*profile.*证据.*持久磁盘/s);
  assert.match(deployment, /重启.*清除.*进程内熔断/s);
  assert.match(deployment, /\/api\/ready.*不代表.*DeepSeek Web/s);
  assert.match(deployment, /共享 `admin`.*完整管理员权限/s);
  assert.match(deployment, /无法.*人员级审计/s);
  assert.match(deployment, /系统 `admin`.*DeepSeek 服务账号.*两套/s);

  assert.match(readme, /市场部.*共享 `admin`/s);
  assert.match(environment, /prod:stop[\s\S]*web:login[\s\S]*prod:start/);
  assert.match(environment, /持久磁盘/);
  assert.match(envExample, /persistent disk/i);

  assert.match(api, /GET \/api\/ai-platforms\/deepseek-web\/runtime-status/);
  assert.match(api, /private, no-store/);
  assert.match(api, /1000 次\/15 分钟/);
});
