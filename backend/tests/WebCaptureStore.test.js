const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { WebCaptureStore } = require('../services/WebCaptureStore');

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x00
]);

test('stages and atomically promotes bounded PNG evidence without exposing paths', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'web-capture-store-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const store = new WebCaptureStore({ rootDir: root });
  const capture = await store.beginCapture({ record_id: 12, user_id: 7, project_id: 3 });

  const artifact = await store.writeArtifact(
    capture,
    'search_state',
    PNG,
    { width: 1200, height: 800 }
  );
  await store.writeArtifact(
    capture,
    'final_answer',
    PNG,
    { width: 1200, height: 800 }
  );
  const promoted = await store.promoteCapture(capture);

  assert.match(artifact.id, /^[0-9a-f-]{36}$/);
  assert.equal(artifact.mime_type, 'image/png');
  assert.equal(Object.hasOwn(artifact, 'path'), false);
  assert.deepEqual(promoted.artifacts.search_state, artifact);
  const storedPath = path.join(root, 'records', '12', `${artifact.id}.png`);
  const stat = await fs.promises.stat(storedPath);
  assert.equal(stat.mode & 0o777, 0o600);
  assert.deepEqual(await fs.promises.readFile(storedPath), PNG);
});

test('rejects invalid ownership, artifact kinds and non-PNG evidence', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'web-capture-store-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const store = new WebCaptureStore({ rootDir: root });

  await assert.rejects(
    store.beginCapture({ record_id: 0, user_id: 7 }),
    { code: 'web_capture_owner_missing' }
  );
  const capture = await store.beginCapture({ record_id: 12, user_id: 7 });
  await assert.rejects(
    store.writeArtifact(capture, '../escape', PNG, { width: 1, height: 1 }),
    { code: 'web_artifact_invalid' }
  );
  await assert.rejects(
    store.writeArtifact(capture, 'final_answer', Buffer.from('not png'), {
      width: 1,
      height: 1
    }),
    { code: 'web_artifact_invalid' }
  );
});

test('opens only UUID artifacts inside the exact owner record directory', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'web-capture-store-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const store = new WebCaptureStore({ rootDir: root });
  const capture = await store.beginCapture({ record_id: 12, user_id: 7 });
  const search = await store.writeArtifact(
    capture,
    'search_state',
    PNG,
    { width: 1200, height: 800 }
  );
  await store.writeArtifact(
    capture,
    'final_answer',
    PNG,
    { width: 1200, height: 800 }
  );
  await store.promoteCapture(capture);

  const opened = await store.openArtifact(12, search.id);
  const chunks = [];
  for await (const chunk of opened.stream) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), PNG);
  assert.equal(opened.mimeType, 'image/png');
  await assert.rejects(
    store.openArtifact(12, '../escape'),
    { code: 'invalid_web_capture_reference' }
  );
  await assert.rejects(
    store.openArtifact(13, search.id),
    { code: 'web_capture_missing' }
  );
});

test('rejects symbolic-link artifacts even when the link resolves inside the record directory', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'web-capture-store-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const store = new WebCaptureStore({ rootDir: root });
  const recordDir = path.join(root, 'records', '12');
  const sourceId = '00000000-0000-4000-8000-000000000011';
  const linkId = '00000000-0000-4000-8000-000000000012';
  await fs.promises.mkdir(recordDir, { recursive: true });
  await fs.promises.writeFile(path.join(recordDir, `${sourceId}.png`), PNG);
  await fs.promises.symlink(
    path.join(recordDir, `${sourceId}.png`),
    path.join(recordDir, `${linkId}.png`)
  );

  await assert.rejects(
    store.openArtifact(12, linkId),
    { code: 'invalid_web_capture_reference' }
  );
});

test('quarantine, restore, commit and startup reconciliation are idempotent', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'web-capture-store-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const store = new WebCaptureStore({ rootDir: root });
  const operationId = '00000000-0000-4000-8000-000000000021';
  const secondOperationId = '00000000-0000-4000-8000-000000000022';
  const recordDir = path.join(root, 'records', '12');
  await fs.promises.mkdir(recordDir, { recursive: true });
  await fs.promises.writeFile(path.join(recordDir, 'evidence.png'), PNG);

  const quarantined = await store.quarantineRecords([12, 13, 12], operationId);
  assert.deepEqual(quarantined.record_ids, [12]);
  await assert.rejects(fs.promises.access(recordDir));
  await fs.promises.access(path.join(root, '.trash', operationId, '12', 'evidence.png'));

  await store.restoreQuarantine(operationId);
  await store.restoreQuarantine(operationId);
  await fs.promises.access(path.join(recordDir, 'evidence.png'));

  await store.quarantineRecords([12], secondOperationId);
  await store.commitQuarantine(secondOperationId);
  await store.commitQuarantine(secondOperationId);
  await assert.rejects(fs.promises.access(recordDir));

  const leftover = path.join(
    root,
    '.trash',
    '00000000-0000-4000-8000-000000000023',
    '99'
  );
  await fs.promises.mkdir(leftover, { recursive: true });
  assert.equal(await store.reconcileTrash({
    recordExists: async () => false
  }), 1);
  assert.equal(await store.reconcileTrash({
    recordExists: async () => false
  }), 0);
});

test('startup reconciliation restores quarantined evidence when its database record survived', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'web-capture-store-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const store = new WebCaptureStore({ rootDir: root });
  const operationId = '00000000-0000-4000-8000-000000000031';
  const recordDir = path.join(root, 'records', '12');
  await fs.promises.mkdir(recordDir, { recursive: true });
  await fs.promises.writeFile(path.join(recordDir, 'evidence.png'), PNG);
  await store.quarantineRecords([12], operationId);

  const reconciled = await store.reconcileTrash({
    recordExists: async (recordId) => recordId === 12
  });

  assert.equal(reconciled, 1);
  assert.deepEqual(
    await fs.promises.readFile(path.join(recordDir, 'evidence.png')),
    PNG
  );
  await assert.rejects(fs.promises.access(path.join(root, '.trash', operationId)));
});

test('startup reconciliation keeps quarantine intact when database state cannot be read', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'web-capture-store-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const store = new WebCaptureStore({ rootDir: root });
  const operationId = '00000000-0000-4000-8000-000000000032';
  const recordDir = path.join(root, 'records', '12');
  await fs.promises.mkdir(recordDir, { recursive: true });
  await fs.promises.writeFile(path.join(recordDir, 'evidence.png'), PNG);
  await store.quarantineRecords([12], operationId);

  await assert.rejects(
    store.reconcileTrash({
      recordExists: async () => {
        throw new Error('database unavailable');
      }
    }),
    /database unavailable/
  );
  await fs.promises.access(
    path.join(root, '.trash', operationId, '12', 'evidence.png')
  );
  await assert.rejects(fs.promises.access(recordDir));
});
