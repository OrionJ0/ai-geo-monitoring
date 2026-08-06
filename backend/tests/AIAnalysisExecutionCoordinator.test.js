const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AIAnalysisExecutionCoordinator,
  AIAnalysisExecutionQueueError,
  DEFAULT_QUEUE_TIMEOUT_MS
} = require('../services/AIAnalysisExecutionCoordinator');

test('production default queue timeout covers slow multi-wave v5 analysis', () => {
  const coordinator = new AIAnalysisExecutionCoordinator();
  assert.equal(coordinator.snapshot().queue_timeout_ms, DEFAULT_QUEUE_TIMEOUT_MS);
  assert.equal(DEFAULT_QUEUE_TIMEOUT_MS, 40 * 60 * 1000);
});

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
  assert.equal(coordinator.snapshot().active, 2);
  assert.equal(coordinator.snapshot().queued, 4);
  assert.equal(coordinator.snapshot().peak_active, 2);
  assert.equal(coordinator.snapshot().peak_queued, 4);
  while (releases.length || coordinator.snapshot().queued) {
    releases.splice(0).forEach((release) => release());
    await new Promise((resolve) => setImmediate(resolve));
  }
  await Promise.all(running);
  assert.equal(peak, 2);
  assert.equal(coordinator.snapshot().active, 0);
  assert.equal(coordinator.snapshot().queued, 0);
  assert.equal(coordinator.snapshot().completed, 6);
  assert.equal(coordinator.snapshot().failed, 0);
});

test('fails fast with a retryable error when the shared queue is full', async () => {
  const events = [];
  const coordinator = new AIAnalysisExecutionCoordinator({
    concurrency: 1,
    queueLimit: 1,
    eventLogger: (event) => events.push(event)
  });
  let release;
  const first = coordinator.run(() => new Promise((resolve) => { release = resolve; }));
  const second = coordinator.run(async () => true);
  await assert.rejects(
    coordinator.run(async () => true),
    (error) => error instanceof AIAnalysisExecutionQueueError
      && error.code === 'analysis_queue_full'
      && error.status === 503
      && error.retryable === true
  );
  release();
  await Promise.all([first, second]);
  assert.equal(coordinator.snapshot().rejected, 1);
  assert.deepEqual(events, [{
    event: 'analysis_queue_rejected',
    error_code: 'analysis_queue_full',
    active: 1,
    queued: 1,
    rejected_total: 1
  }]);
});

test('expires queued work with a retryable 503 and never executes it', async () => {
  const coordinator = new AIAnalysisExecutionCoordinator({
    concurrency: 1,
    queueLimit: 1,
    queueTimeoutMs: 1000,
    eventLogger: () => {}
  });
  let release;
  let executed = false;
  const first = coordinator.run(() => new Promise((resolve) => { release = resolve; }));
  const queued = coordinator.run(async () => { executed = true; });
  await assert.rejects(
    queued,
    (error) => error instanceof AIAnalysisExecutionQueueError
      && error.code === 'analysis_queue_timeout'
      && error.status === 503
      && error.retryable === true
  );
  assert.equal(executed, false);
  assert.equal(coordinator.snapshot().timed_out, 1);
  release();
  await first;
});

test('independent v5 service instances share the process-wide coordinator by default', () => {
  const { AIResponseAnalysisV5Service } = require('../services/AIResponseAnalysisV5Service');
  const first = new AIResponseAnalysisV5Service();
  const second = new AIResponseAnalysisV5Service();
  assert.strictEqual(first.executionCoordinator, second.executionCoordinator);
});

test('shutdown rejects queued work, stops accepting and drains active work', async () => {
  const coordinator = new AIAnalysisExecutionCoordinator({
    concurrency: 1,
    queueLimit: 2,
    eventLogger: () => {}
  });
  let release;
  const active = coordinator.run(() => new Promise((resolve) => { release = resolve; }));
  const queued = coordinator.run(async () => true);
  coordinator.beginShutdown();

  await assert.rejects(
    queued,
    (error) => error.code === 'analysis_queue_shutdown' && error.retryable === true
  );
  await assert.rejects(
    coordinator.run(async () => true),
    (error) => error.code === 'analysis_queue_shutdown' && error.status === 503
  );
  assert.equal(coordinator.snapshot().accepting, false);
  const drained = coordinator.drain();
  let drainFinished = false;
  drained.then(() => { drainFinished = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drainFinished, false);
  release();
  await Promise.all([active, drained]);
  assert.equal(coordinator.snapshot().active, 0);
  assert.equal(coordinator.snapshot().queued, 0);
});
