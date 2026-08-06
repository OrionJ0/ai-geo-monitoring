const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AIAnalysisExecutionCoordinator,
  AIAnalysisExecutionQueueError
} = require('../services/AIAnalysisExecutionCoordinator');

test('shares one bounded concurrency budget across overlapping analysis runs', async () => {
  const coordinator = new AIAnalysisExecutionCoordinator({ concurrency: 2, queueLimit: 4 });
  let active = 0;
  let peak = 0;
  const releases = [];
  const task = () => coordinator.run(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => releases.push(resolve));
    active -= 1;
  });

  const running = [task(), task(), task(), task(), task(), task()];
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(peak, 2);
  assert.deepEqual(coordinator.snapshot(), { active: 2, queued: 4, concurrency: 2, queue_limit: 4 });
  while (releases.length || coordinator.snapshot().queued) {
    releases.splice(0).forEach((release) => release());
    await new Promise((resolve) => setImmediate(resolve));
  }
  await Promise.all(running);
  assert.equal(peak, 2);
  assert.deepEqual(coordinator.snapshot(), { active: 0, queued: 0, concurrency: 2, queue_limit: 4 });
});

test('fails fast with a retryable error when the shared queue is full', async () => {
  const coordinator = new AIAnalysisExecutionCoordinator({ concurrency: 1, queueLimit: 1 });
  let release;
  const first = coordinator.run(() => new Promise((resolve) => { release = resolve; }));
  const second = coordinator.run(async () => true);
  await assert.rejects(
    coordinator.run(async () => true),
    (error) => error instanceof AIAnalysisExecutionQueueError
      && error.code === 'analysis_queue_full'
  );
  release();
  await Promise.all([first, second]);
});
