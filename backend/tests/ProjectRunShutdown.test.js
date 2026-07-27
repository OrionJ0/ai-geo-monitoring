const test = require('node:test');
const assert = require('node:assert/strict');

const ProjectRunServiceModule = require('../services/ProjectRunService');

test('project run shutdown rejects new background work and drains scheduled executions', async () => {
  assert.equal(typeof ProjectRunServiceModule.ProjectRunService, 'function');
  const service = new ProjectRunServiceModule.ProjectRunService();
  let releaseRun;
  let started = false;
  const runGate = new Promise((resolve) => { releaseRun = resolve; });
  service.executePreparedRun = async () => {
    started = true;
    await runGate;
  };

  service.schedulePreparedRun({ id: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started, true);

  service.beginShutdown();
  assert.throws(
    () => service.schedulePreparedRun({ id: 2 }),
    (error) => error?.status === 503 && error?.data?.error_code === 'project_run_shutdown'
  );

  let drained = false;
  const draining = service.drain().then(() => { drained = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, false);

  releaseRun();
  await draining;
  assert.equal(drained, true);
});
