const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WebPlatformRuntimeStatusService
} = require('../services/WebPlatformRuntimeStatusService');

function registryFor(snapshot, observedCodes = []) {
  return {
    getDefinition(code) {
      observedCodes.push(code);
      return {
        code,
        runtimeSchemaVersion: `${code}-runtime-v1`
      };
    },
    getService(code) {
      observedCodes.push(code);
      return {
        getRuntimeSnapshot() {
          return snapshot;
        }
      };
    }
  };
}

test('returns an idle public snapshot when the enabled Web channel has no work', async () => {
  const observedAt = new Date('2026-07-27T02:00:00.000Z');
  const service = new WebPlatformRuntimeStatusService({
    questionRecordModel: {
      async count() {
        return 0;
      }
    },
    questionSetRunModel: {},
    aiPlatformConfigService: {
      async getPlatformByCode(code) {
        assert.equal(code, 'deepseek-web');
        return { enabled: true };
      }
    },
    webPlatformRegistry: registryFor({ running_count: 0 }),
    now: () => observedAt
  });

  assert.deepEqual(await service.getStatus(), {
    schema_version: 'deepseek-web-runtime-v1',
    platform: 'deepseek-web',
    enabled: true,
    state: 'idle',
    running_count: 0,
    queued_count: 0,
    pending_count: 0,
    needs_action: false,
    action_code: null,
    reason_code: null,
    observed_at: '2026-07-27T02:00:00.000Z'
  });
});

test('maps persistent blockers and shutdown with a fixed public priority', async () => {
  const snapshots = [
    {
      snapshot: {
        running_count: 0,
        lifecycle_state: 'login_required',
        blocking_error_code: 'web_login_required',
        shutting_down: false
      },
      expected: {
        state: 'login_required',
        needs_action: true,
        action_code: 'contact_vm_operator',
        reason_code: 'web_login_required'
      }
    },
    {
      snapshot: {
        running_count: 0,
        lifecycle_state: 'verification_required',
        blocking_error_code: 'web_verification_required',
        shutting_down: false
      },
      expected: {
        state: 'verification_required',
        needs_action: true,
        action_code: 'contact_vm_operator',
        reason_code: 'web_verification_required'
      }
    },
    {
      snapshot: {
        running_count: 0,
        lifecycle_state: 'selector_mismatch',
        blocking_error_code: 'web_selector_mismatch',
        shutting_down: false
      },
      expected: {
        state: 'unavailable',
        needs_action: true,
        action_code: 'contact_vm_operator',
        reason_code: 'web_selector_mismatch'
      }
    },
    {
      snapshot: {
        running_count: 1,
        lifecycle_state: 'closing',
        blocking_error_code: 'web_login_required',
        shutting_down: true
      },
      expected: {
        state: 'shutting_down',
        needs_action: false,
        action_code: null,
        reason_code: null
      }
    }
  ];

  for (const { snapshot, expected } of snapshots) {
    const service = new WebPlatformRuntimeStatusService({
      questionRecordModel: { count: async () => 5 },
      questionSetRunModel: {},
      aiPlatformConfigService: {
        async getPlatformByCode() {
          return { enabled: true };
        }
      },
      webPlatformRegistry: registryFor(snapshot),
      now: () => new Date('2026-07-27T02:00:00.000Z')
    });

    const status = await service.getStatus();
    assert.deepEqual({
      state: status.state,
      needs_action: status.needs_action,
      action_code: status.action_code,
      reason_code: status.reason_code
    }, expected);
  }
});

test('returns a stable unavailable contract when the managed platform row is missing', async () => {
  let countCalls = 0;
  const service = new WebPlatformRuntimeStatusService({
    questionRecordModel: {
      async count() {
        countCalls += 1;
        return 9;
      }
    },
    questionSetRunModel: {},
    aiPlatformConfigService: {
      async getPlatformByCode() {
        throw Object.assign(new Error('row details must stay private'), {
          code: 'platform_not_found'
        });
      }
    },
    webPlatformRegistry: registryFor({
      running_count: 0,
      lifecycle_state: 'stopped',
      blocking_error_code: null,
      shutting_down: false
    }),
    now: () => new Date('2026-07-27T02:00:00.000Z')
  });

  const status = await service.getStatus();

  assert.equal(status.enabled, false);
  assert.equal(status.state, 'unavailable');
  assert.equal(status.reason_code, 'config_unavailable');
  assert.equal(status.needs_action, true);
  assert.equal(status.action_code, 'contact_vm_operator');
  assert.equal(countCalls, 0);
  assert.doesNotMatch(JSON.stringify(status), /row details/);
});

test('isolates pending and runtime state by requested managed Web platform', async () => {
  const countedPlatforms = [];
  const registryCalls = [];
  const service = new WebPlatformRuntimeStatusService({
    questionRecordModel: {
      async count(options) {
        countedPlatforms.push(options.where.platform);
        return 3;
      }
    },
    questionSetRunModel: {},
    aiPlatformConfigService: {
      async getPlatformByCode(code) {
        assert.equal(code, 'doubao-web');
        return { enabled: true };
      }
    },
    webPlatformRegistry: registryFor({
      running_count: 1,
      lifecycle_state: 'busy'
    }, registryCalls),
    now: () => new Date('2026-07-27T02:00:00.000Z')
  });

  const status = await service.getStatus('doubao-web');

  assert.equal(status.schema_version, 'doubao-web-runtime-v1');
  assert.equal(status.platform, 'doubao-web');
  assert.equal(status.running_count, 1);
  assert.equal(status.pending_count, 3);
  assert.equal(status.queued_count, 2);
  assert.deepEqual(countedPlatforms, ['doubao-web']);
  assert.deepEqual(registryCalls, ['doubao-web', 'doubao-web']);
});
