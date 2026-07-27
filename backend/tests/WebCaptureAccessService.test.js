const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WebCaptureAccessService,
  WebCaptureAccessError
} = require('../services/WebCaptureAccessService');

function captureSummary(ownerRecordId, artifactId) {
  return {
    web_capture: {
      artifact_owner_record_id: ownerRecordId,
      artifacts: {
        search_state: { id: artifactId, mime_type: 'image/png' }
      }
    }
  };
}

test('allows the record owner and administrator to open only referenced artifacts', async () => {
  const artifactId = '00000000-0000-4000-8000-000000000001';
  const records = new Map([
    [12, { id: 12, user_id: 7, result_summary: captureSummary(12, artifactId) }]
  ]);
  const opens = [];
  const service = new WebCaptureAccessService({
    questionRecordModel: { findByPk: async (id) => records.get(Number(id)) || null },
    captureStore: {
      openArtifact: async (...args) => {
        opens.push(args);
        return { stream: {}, mimeType: 'image/png', bytes: 12 };
      }
    }
  });

  assert.equal((await service.openForUser({
    recordId: 12,
    artifactId,
    user: { id: 7, role: 'user' }
  })).bytes, 12);
  assert.equal((await service.openForUser({
    recordId: 12,
    artifactId,
    user: { id: 1, role: 'admin' }
  })).bytes, 12);
  assert.deepEqual(opens, [[12, artifactId], [12, artifactId]]);

  await assert.rejects(
    service.openForUser({
      recordId: 12,
      artifactId: '00000000-0000-4000-8000-000000000002',
      user: { id: 7, role: 'user' }
    }),
    (error) => error instanceof WebCaptureAccessError
      && error.code === 'web_capture_not_found'
      && error.status === 404
  );
});

test('rejects cross-user access and validates the original owner record for reused evidence', async () => {
  const artifactId = '00000000-0000-4000-8000-000000000001';
  const records = new Map([
    [12, { id: 12, user_id: 7, result_summary: captureSummary(10, artifactId) }],
    [10, { id: 10, user_id: 7, result_summary: captureSummary(10, artifactId) }]
  ]);
  const service = new WebCaptureAccessService({
    questionRecordModel: { findByPk: async (id) => records.get(Number(id)) || null },
    captureStore: {
      openArtifact: async () => ({ stream: {}, mimeType: 'image/png', bytes: 12 })
    }
  });

  await assert.rejects(
    service.openForUser({
      recordId: 12,
      artifactId,
      user: { id: 8, role: 'user' }
    }),
    { code: 'web_capture_forbidden', status: 403 }
  );
  const opened = await service.openForUser({
    recordId: 12,
    artifactId,
    user: { id: 7, role: 'user' }
  });
  assert.equal(opened.bytes, 12);

  records.set(10, { ...records.get(10), user_id: 99 });
  await assert.rejects(
    service.openForUser({
      recordId: 12,
      artifactId,
      user: { id: 7, role: 'user' }
    }),
    { code: 'web_capture_forbidden', status: 403 }
  );
});

test('reused evidence must also be declared by the original artifact owner record', async () => {
  const requestedArtifactId = '00000000-0000-4000-8000-000000000001';
  const ownerArtifactId = '00000000-0000-4000-8000-000000000002';
  const records = new Map([
    [12, {
      id: 12,
      user_id: 7,
      result_summary: captureSummary(10, requestedArtifactId)
    }],
    [10, {
      id: 10,
      user_id: 7,
      result_summary: captureSummary(10, ownerArtifactId)
    }]
  ]);
  let opened = false;
  const service = new WebCaptureAccessService({
    questionRecordModel: { findByPk: async (id) => records.get(Number(id)) || null },
    captureStore: {
      openArtifact: async () => {
        opened = true;
        return { stream: {}, mimeType: 'image/png', bytes: 12 };
      }
    }
  });

  await assert.rejects(
    service.openForUser({
      recordId: 12,
      artifactId: requestedArtifactId,
      user: { id: 7, role: 'user' }
    }),
    { code: 'web_capture_not_found', status: 404 }
  );
  assert.equal(opened, false);
});
