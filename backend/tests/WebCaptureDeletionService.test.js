const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WebCaptureDeletionService,
  WebCaptureCleanupError
} = require('../services/WebCaptureDeletionService');

test('quarantines before the database transaction and commits only after database success', async () => {
  const calls = [];
  const service = new WebCaptureDeletionService({
    captureStore: {
      quarantineRecords: async (ids, operationId) => {
        calls.push(['quarantine', ids, operationId]);
        return { operation_id: operationId, record_ids: ids };
      },
      restoreQuarantine: async () => calls.push(['restore']),
      commitQuarantine: async (operationId) => calls.push(['commit', operationId])
    },
    transactionRunner: async (work) => {
      calls.push(['transaction:start']);
      const value = await work({ id: 'transaction' });
      calls.push(['transaction:commit']);
      return value;
    },
    operationIdFactory: () => '00000000-0000-4000-8000-000000000031'
  });

  const result = await service.deleteRecords([12, 13], async (transaction) => {
    calls.push(['database', transaction.id]);
    return { deleted: 2 };
  });

  assert.deepEqual(result, { deleted: 2 });
  assert.deepEqual(calls.map((item) => item[0]), [
    'quarantine',
    'transaction:start',
    'database',
    'transaction:commit',
    'commit'
  ]);
});

test('restores quarantined evidence when the database transaction rolls back', async () => {
  const calls = [];
  const service = new WebCaptureDeletionService({
    captureStore: {
      quarantineRecords: async () => calls.push('quarantine'),
      restoreQuarantine: async () => calls.push('restore'),
      commitQuarantine: async () => calls.push('commit')
    },
    transactionRunner: async (work) => work({ id: 'transaction' }),
    operationIdFactory: () => '00000000-0000-4000-8000-000000000032'
  });

  await assert.rejects(
    service.deleteRecords([12], async () => {
      calls.push('database');
      throw new Error('rollback');
    }),
    /rollback/
  );
  assert.deepEqual(calls, ['quarantine', 'database', 'restore']);
});

test('reports a stable cleanup error after the database committed', async () => {
  const service = new WebCaptureDeletionService({
    captureStore: {
      quarantineRecords: async () => {},
      restoreQuarantine: async () => {
        throw new Error('must not restore after commit');
      },
      commitQuarantine: async () => {
        throw new Error('disk busy');
      }
    },
    transactionRunner: async (work) => work({ id: 'transaction' }),
    operationIdFactory: () => '00000000-0000-4000-8000-000000000033'
  });

  await assert.rejects(
    service.deleteRecords([12], async () => ({ deleted: 1 })),
    (error) => error instanceof WebCaptureCleanupError
      && error.code === 'web_capture_cleanup_incomplete'
      && error.databaseCommitted === true
  );
});

test('quarantines each platform Store and restores earlier platforms when a later Store fails', async () => {
  const calls = [];
  const stores = {
    'deepseek-web': {
      quarantineRecords: async (ids) => calls.push(['quarantine', 'deepseek-web', ids]),
      restoreQuarantine: async () => calls.push(['restore', 'deepseek-web']),
      commitQuarantine: async () => calls.push(['commit', 'deepseek-web'])
    },
    'doubao-web': {
      quarantineRecords: async (ids) => {
        calls.push(['quarantine', 'doubao-web', ids]);
        throw new Error('doubao disk unavailable');
      },
      restoreQuarantine: async () => calls.push(['restore', 'doubao-web']),
      commitQuarantine: async () => calls.push(['commit', 'doubao-web'])
    }
  };
  const service = new WebCaptureDeletionService({
    questionRecordModel: {
      async findAll() {
        return [
          { id: 12, platform: 'deepseek-web' },
          { id: 13, platform: 'doubao-web' }
        ];
      }
    },
    webPlatformRegistry: {
      hasDefinition: (code) => Boolean(stores[code]),
      getService: (code) => ({
        getCaptureStore: () => stores[code]
      })
    },
    transactionRunner: async () => {
      calls.push(['database']);
    },
    operationIdFactory: () => '00000000-0000-4000-8000-000000000034'
  });

  await assert.rejects(
    service.deleteRecords([12, 13], async () => {}),
    /doubao disk unavailable/
  );
  assert.deepEqual(calls, [
    ['quarantine', 'deepseek-web', [12]],
    ['quarantine', 'doubao-web', [13]],
    ['restore', 'deepseek-web']
  ]);
});

test('commits every platform Store only after the shared database transaction succeeds', async () => {
  const calls = [];
  const makeStore = (code) => ({
    quarantineRecords: async (ids) => calls.push(['quarantine', code, ids]),
    restoreQuarantine: async () => calls.push(['restore', code]),
    commitQuarantine: async () => calls.push(['commit', code])
  });
  const stores = {
    'deepseek-web': makeStore('deepseek-web'),
    'doubao-web': makeStore('doubao-web')
  };
  const service = new WebCaptureDeletionService({
    questionRecordModel: {
      async findAll() {
        return [
          { id: 12, platform: 'deepseek-web' },
          { id: 13, platform: 'doubao-web' }
        ];
      }
    },
    webPlatformRegistry: {
      hasDefinition: (code) => Boolean(stores[code]),
      getService: (code) => ({ getCaptureStore: () => stores[code] })
    },
    transactionRunner: async (work) => {
      const result = await work({ id: 'transaction' });
      calls.push(['database-committed']);
      return result;
    },
    operationIdFactory: () => '00000000-0000-4000-8000-000000000035'
  });

  await service.deleteRecords([12, 13], async () => {
    calls.push(['database']);
    return { deleted: 2 };
  });

  assert.deepEqual(calls.map((item) => item[0]), [
    'quarantine',
    'quarantine',
    'database',
    'database-committed',
    'commit',
    'commit'
  ]);
});
