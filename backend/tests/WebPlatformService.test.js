const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  WebPlatformService,
  resolveWebRuntimeConfig,
  resolvePlatformWebRuntimeConfig,
  classifyProbeSnapshot,
  buildChromeArguments
} = require('../services/WebPlatformService');

async function makeRuntimeDirectory() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'deepseek-web-test-'));
  const chromeExecutable = path.join(root, 'chrome');
  await fs.promises.writeFile(chromeExecutable, '#!/bin/sh\n', { mode: 0o700 });
  return {
    root,
    chromeExecutable,
    profileDir: path.join(root, 'profile'),
    evidenceDir: path.join(root, 'evidence'),
    timeoutMs: 30_000
  };
}

function fakeLauncher(probe, events = []) {
  return {
    async launch(options) {
      events.push(['launch', options.targetUrl]);
      return {
        async probe() {
          events.push(['probe']);
          return probe();
        },
        async close() {
          events.push(['close']);
        }
      };
    }
  };
}

test('resolves a dedicated ignored runtime profile and validates timeout bounds', async () => {
  const cwd = path.resolve(__dirname, '..');
  const config = resolveWebRuntimeConfig({
    cwd,
    env: {
      DEEPSEEK_WEB_TIMEOUT_SECONDS: '45'
    },
    platform: 'darwin'
  });

  assert.equal(config.profileDir, path.join(cwd, '.runtime/deepseek-web/profile'));
  assert.equal(config.evidenceDir, path.join(cwd, '.runtime/deepseek-web/evidence'));
  assert.equal(config.timeoutMs, 45_000);
  assert.equal(config.cdpTimeoutMs, 30_000);
  assert.throws(
    () => resolveWebRuntimeConfig({
      cwd,
      env: { DEEPSEEK_WEB_TIMEOUT_SECONDS: '12' },
      platform: 'darwin'
    }),
    { code: 'web_runtime_config_invalid' }
  );
});

test('resolves a platform-specific runtime without reading another Web platform fallback', () => {
  const cwd = path.resolve(__dirname, '..');
  const config = resolvePlatformWebRuntimeConfig({
    code: 'doubao-web',
    displayName: '豆包网页版',
    envPrefix: 'DOUBAO_WEB'
  }, {
    cwd,
    env: {
      DOUBAO_WEB_TIMEOUT_SECONDS: '60',
      DEEPSEEK_WEB_PROFILE_DIR: '.runtime/shared/profile',
      DEEPSEEK_WEB_EVIDENCE_DIR: '.runtime/shared/evidence'
    },
    platform: 'darwin'
  });

  assert.equal(config.profileDir, path.join(cwd, '.runtime/doubao-web/profile'));
  assert.equal(config.evidenceDir, path.join(cwd, '.runtime/doubao-web/evidence'));
  assert.equal(config.timeoutMs, 60_000);
});

test('rejects broad or shared profile and evidence directories before touching the filesystem', () => {
  const cwd = path.resolve(__dirname, '..');
  const broadDirectories = [
    path.parse(cwd).root,
    os.homedir(),
    os.tmpdir(),
    cwd
  ];

  for (const directory of broadDirectories) {
    assert.throws(
      () => resolveWebRuntimeConfig({
        cwd,
        env: { DEEPSEEK_WEB_PROFILE_DIR: directory },
        platform: 'darwin'
      }),
      { code: 'web_runtime_config_invalid' }
    );
    assert.throws(
      () => resolveWebRuntimeConfig({
        cwd,
        env: { DEEPSEEK_WEB_EVIDENCE_DIR: directory },
        platform: 'darwin'
      }),
      { code: 'web_runtime_config_invalid' }
    );
  }
});

test('Chrome launch is headed, isolated and forced into a visible new window', () => {
  const args = buildChromeArguments({
    profileDir: '/private/tmp/deepseek-web-profile'
  }, 'https://chat.deepseek.com/');

  assert.ok(args.includes('--new-window'));
  assert.ok(args.includes('--start-maximized'));
  assert.ok(args.includes('--remote-debugging-address=127.0.0.1'));
  assert.ok(args.includes('--remote-debugging-port=0'));
  assert.ok(args.includes('--user-data-dir=/private/tmp/deepseek-web-profile'));
  assert.ok(args.includes('https://chat.deepseek.com/'));
  assert.equal(args.some((arg) => /headless/i.test(arg)), false);
});

test('preflight starts one headed session, caches success and preserves the profile', async (t) => {
  const runtimeConfig = await makeRuntimeDirectory();
  t.after(() => fs.promises.rm(runtimeConfig.root, { recursive: true, force: true }));
  const marker = path.join(runtimeConfig.profileDir, 'session-marker');
  const events = [];
  const service = new WebPlatformService({
    runtimeConfig,
    launcher: fakeLauncher(async () => {
      await fs.promises.writeFile(marker, 'persisted');
      return { status: 'ready', origin: 'https://chat.deepseek.com', composerCount: 1 };
    }, events)
  });

  assert.deepEqual(await service.preflight(), {
    ok: true,
    state: 'ready',
    selector_version: 'deepseek-web-v1'
  });
  assert.equal((await service.preflight()).ok, true);
  assert.equal(events.filter(([event]) => event === 'launch').length, 1);
  assert.equal(events.filter(([event]) => event === 'probe').length, 1);

  const mode = (await fs.promises.stat(runtimeConfig.profileDir)).mode & 0o777;
  assert.equal(mode, 0o700);
  await service.shutdown();
  assert.equal(await fs.promises.readFile(marker, 'utf8'), 'persisted');
});

test('a platform definition controls origin, launch target, selector identity and failure shape', async (t) => {
  const runtimeConfig = await makeRuntimeDirectory();
  t.after(() => fs.promises.rm(runtimeConfig.root, { recursive: true, force: true }));
  const events = [];
  const service = new WebPlatformService({
    definition: {
      code: 'doubao-web',
      displayName: '豆包网页版',
      officialUrl: 'https://www.doubao.com/chat/',
      allowedOrigins: ['https://www.doubao.com'],
      selectorVersion: 'doubao-web-v1',
      captureSchemaVersion: 'doubao-web-capture-v1'
    },
    runtimeConfig,
    launcher: fakeLauncher(
      () => ({
        status: 'ready',
        origin: 'https://www.doubao.com',
        composerCount: 1
      }),
      events
    ),
    pageFactory: () => ({}),
    adapterFactory: () => ({
      async capture() {
        throw Object.assign(new Error('需要登录'), {
          code: 'web_login_required',
          stage: 'session_ready_checked'
        });
      }
    })
  });

  assert.deepEqual(await service.preflight(), {
    ok: true,
    state: 'ready',
    selector_version: 'doubao-web-v1'
  });
  const failed = await service.queryPlatform('测试', {
    capture_owner: { record_id: 1, user_id: 1 }
  });
  assert.equal(events[0][1], 'https://www.doubao.com/chat/');
  assert.equal(failed.platform, 'doubao-web');
  assert.equal(failed.web_capture.schema_version, 'doubao-web-capture-v1');
  assert.equal(failed.web_capture.failure.stage, 'session_ready_checked');
  await service.shutdown();
});

test('preflight tolerates the initial blank target until the official composer is ready', async (t) => {
  const runtimeConfig = await makeRuntimeDirectory();
  t.after(() => fs.promises.rm(runtimeConfig.root, { recursive: true, force: true }));
  const probes = [
    { status: 'origin_mismatch', origin: 'null', composerCount: 0 },
    { status: 'selector_mismatch', origin: 'https://chat.deepseek.com', composerCount: 0 },
    { status: 'ready', origin: 'https://chat.deepseek.com', composerCount: 1 }
  ];
  const service = new WebPlatformService({
    runtimeConfig,
    preflightPollMs: 1,
    launcher: fakeLauncher(async () => probes.shift())
  });

  assert.equal((await service.preflight()).ok, true);
  assert.equal(probes.length, 0);
  await service.shutdown();
});

test('a live service holds an exclusive profile lock until shutdown', async (t) => {
  const runtimeConfig = await makeRuntimeDirectory();
  t.after(() => fs.promises.rm(runtimeConfig.root, { recursive: true, force: true }));
  const probe = async () => ({
    status: 'ready',
    origin: 'https://chat.deepseek.com',
    composerCount: 1
  });
  const first = new WebPlatformService({
    runtimeConfig,
    launcher: fakeLauncher(probe)
  });
  const second = new WebPlatformService({
    runtimeConfig,
    launcher: fakeLauncher(probe)
  });

  await first.preflight();
  await assert.rejects(second.preflight(), { code: 'web_profile_in_use' });
  await first.shutdown();
  assert.equal((await second.preflight()).ok, true);
  await second.shutdown();
});

test('preflight distinguishes missing Chrome from a launcher failure', async (t) => {
  const missingRuntime = await makeRuntimeDirectory();
  t.after(() => fs.promises.rm(missingRuntime.root, { recursive: true, force: true }));
  missingRuntime.chromeExecutable = null;
  const missing = new WebPlatformService({
    runtimeConfig: missingRuntime,
    launcher: fakeLauncher(async () => ({
      status: 'ready',
      origin: 'https://chat.deepseek.com',
      composerCount: 1
    }))
  });
  await assert.rejects(missing.preflight(), { code: 'web_browser_not_configured' });
  assert.equal(
    missing.getRuntimeSnapshot().blocking_error_code,
    'web_browser_not_configured'
  );
  await missing.shutdown();

  const failingRuntime = await makeRuntimeDirectory();
  t.after(() => fs.promises.rm(failingRuntime.root, { recursive: true, force: true }));
  const failing = new WebPlatformService({
    runtimeConfig: failingRuntime,
    launcher: {
      async launch() {
        throw Object.assign(new Error('launch failed'), {
          code: 'web_browser_launch_failed'
        });
      }
    }
  });
  await assert.rejects(failing.preflight(), { code: 'web_browser_launch_failed' });
  await failing.shutdown();
});

test('preflight maps login, verification, origin and selector states to stable errors', async (t) => {
  const cases = [
    [{ status: 'login_required' }, 'web_login_required'],
    [{ status: 'verification_required' }, 'web_verification_required'],
    [{ status: 'ready', origin: 'https://example.com', composerCount: 1 }, 'web_selector_mismatch'],
    [{ status: 'ready', origin: 'https://chat.deepseek.com', composerCount: 2 }, 'web_selector_mismatch'],
    [{ status: 'unknown' }, 'web_selector_mismatch']
  ];

  for (const [probeResult, code] of cases) {
    const runtimeConfig = await makeRuntimeDirectory();
    t.after(() => fs.promises.rm(runtimeConfig.root, { recursive: true, force: true }));
    const service = new WebPlatformService({
      runtimeConfig,
      preflightStabilizationMs: 0,
      launcher: fakeLauncher(async () => probeResult)
    });
    await assert.rejects(service.preflight(), { code });
    await service.shutdown();
  }
});

test('login, verification and selector preflight failures stay circuit-open until restart', async (t) => {
  for (const [status, errorCode] of [
    ['login_required', 'web_login_required'],
    ['verification_required', 'web_verification_required'],
    ['selector_mismatch', 'web_selector_mismatch']
  ]) {
    const runtimeConfig = await makeRuntimeDirectory();
    t.after(() => fs.promises.rm(runtimeConfig.root, { recursive: true, force: true }));
    let probes = 0;
    const service = new WebPlatformService({
      runtimeConfig,
      preflightStabilizationMs: 0,
      launcher: fakeLauncher(async () => {
        probes += 1;
        return {
          status,
          origin: 'https://chat.deepseek.com',
          composerCount: 0
        };
      })
    });

    await assert.rejects(service.preflight(), { code: errorCode });
    await assert.rejects(service.preflight(), { code: errorCode });
    assert.equal(probes, 1);
    assert.equal(service.getRuntimeSnapshot().blocking_error_code, errorCode);
    await service.shutdown();
  }
});

test('a unique composer wins over stale login markers on an authenticated page', () => {
  assert.deepEqual(classifyProbeSnapshot({
    origin: 'https://chat.deepseek.com',
    pathname: '/',
    verificationCount: 0,
    loginCount: 1,
    composerCount: 1
  }), {
    status: 'ready',
    origin: 'https://chat.deepseek.com',
    composerCount: 1
  });
});

test('FIFO runs at most one Web task and a rejected task does not poison the queue', async (t) => {
  const runtimeConfig = await makeRuntimeDirectory();
  t.after(() => fs.promises.rm(runtimeConfig.root, { recursive: true, force: true }));
  const service = new WebPlatformService({
    runtimeConfig,
    launcher: fakeLauncher(async () => ({
      status: 'ready',
      origin: 'https://chat.deepseek.com',
      composerCount: 1
    }))
  });
  let active = 0;
  let maxActive = 0;
  const run = (id, fail = false) => service.runExclusive(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    if (fail) throw Object.assign(new Error('expected'), { code: 'expected_failure' });
    return id;
  });

  const results = await Promise.allSettled([run(1), run(2, true), run(3)]);

  assert.equal(maxActive, 1);
  assert.deepEqual(results.map((result) => result.status), ['fulfilled', 'rejected', 'fulfilled']);
  assert.equal(results[2].value, 3);
  await service.shutdown();
});

test('runtime snapshot is side-effect free and reports only an active page capture', async (t) => {
  const runtimeConfig = await makeRuntimeDirectory();
  t.after(() => fs.promises.rm(runtimeConfig.root, { recursive: true, force: true }));
  let launches = 0;
  let releaseCapture;
  let markCaptureStarted;
  const captureStarted = new Promise((resolve) => {
    markCaptureStarted = resolve;
  });
  const service = new WebPlatformService({
    runtimeConfig,
    launcher: {
      async launch() {
        launches += 1;
        return {
          async close() {}
        };
      }
    },
    captureStore: {},
    pageFactory: () => ({}),
    adapterFactory: () => ({
      async capture() {
        markCaptureStarted();
        await new Promise((resolve) => {
          releaseCapture = resolve;
        });
        return {
          success: true,
          platform: 'deepseek-web',
          text: '完成',
          data: {},
          provider_citations: [],
          web_capture: { status: 'completed' }
        };
      }
    })
  });

  assert.deepEqual(service.getRuntimeSnapshot(), {
    running_count: 0,
    lifecycle_state: 'stopped',
    blocking_error_code: null,
    shutting_down: false
  });
  assert.equal(launches, 0);

  const query = service.queryPlatform('测试问题', {
    capture_owner: { record_id: 1, user_id: 7 }
  });
  await captureStarted;
  assert.deepEqual(service.getRuntimeSnapshot(), {
    running_count: 1,
    lifecycle_state: 'starting',
    blocking_error_code: null,
    shutting_down: false
  });

  releaseCapture();
  await query;
  assert.deepEqual(service.getRuntimeSnapshot(), {
    running_count: 0,
    lifecycle_state: 'ready',
    blocking_error_code: null,
    shutting_down: false
  });
  await service.shutdown();
});

test('shutdown rejects new Web work with a stable error', async (t) => {
  const runtimeConfig = await makeRuntimeDirectory();
  t.after(() => fs.promises.rm(runtimeConfig.root, { recursive: true, force: true }));
  const service = new WebPlatformService({
    runtimeConfig,
    launcher: fakeLauncher(async () => ({
      status: 'ready',
      origin: 'https://chat.deepseek.com',
      composerCount: 1
    }))
  });

  await service.shutdown();
  assert.equal(service.getRuntimeSnapshot().shutting_down, true);
  await assert.rejects(service.runExclusive(async () => true), { code: 'web_shutdown' });
});

test('interactive login keeps polling through login and verification until one composer is ready', async (t) => {
  const runtimeConfig = await makeRuntimeDirectory();
  t.after(() => fs.promises.rm(runtimeConfig.root, { recursive: true, force: true }));
  const statuses = [
    { status: 'login_required', origin: 'https://chat.deepseek.com', composerCount: 0 },
    { status: 'verification_required', origin: 'https://chat.deepseek.com', composerCount: 0 },
    { status: 'ready', origin: 'https://chat.deepseek.com', composerCount: 1 }
  ];
  const reported = [];
  const service = new WebPlatformService({
    runtimeConfig,
    launcher: fakeLauncher(async () => statuses.shift())
  });

  const result = await service.waitForInteractiveLogin({
    pollMs: 1,
    onStatus: (status) => reported.push(status)
  });

  assert.equal(result.ok, true);
  assert.deepEqual(reported, ['login_required', 'verification_required']);
  await service.shutdown();
});

test('interactive login waits until the platform-required capability is available', async (t) => {
  const runtimeConfig = await makeRuntimeDirectory();
  t.after(() => fs.promises.rm(runtimeConfig.root, { recursive: true, force: true }));
  const reported = [];
  let capabilityChecks = 0;
  const service = new WebPlatformService({
    definition: {
      verifyInteractiveSession: async () => {
        capabilityChecks += 1;
        if (capabilityChecks === 1) {
          throw Object.assign(new Error('login required for deep research'), {
            code: 'web_login_required'
          });
        }
      }
    },
    runtimeConfig,
    launcher: fakeLauncher(async () => ({
      status: 'ready',
      origin: 'https://chat.deepseek.com',
      composerCount: 1
    })),
    pageFactory: () => ({})
  });

  const result = await service.waitForInteractiveLogin({
    pollMs: 1,
    onStatus: (status) => reported.push(status)
  });

  assert.equal(result.ok, true);
  assert.equal(capabilityChecks, 2);
  assert.deepEqual(reported, ['login_required']);
  await service.shutdown();
});

test('administrator session status distinguishes browser setup, profile initialization and login verification', async (t) => {
  const runtimeConfig = await makeRuntimeDirectory();
  t.after(() => fs.promises.rm(runtimeConfig.root, { recursive: true, force: true }));
  const service = new WebPlatformService({
    runtimeConfig,
    launcher: fakeLauncher(async () => ({
      status: 'ready',
      origin: 'https://chat.deepseek.com',
      composerCount: 1
    }))
  });

  assert.deepEqual(service.getAdminSessionSnapshot(), {
    schema_version: 'managed-web-session-v1',
    platform: 'deepseek-web',
    browser_configured: true,
    profile_initialized: false,
    login_state: 'unchecked',
    reason_code: null,
    last_verified_at: null
  });

  const verified = await service.verifyInteractiveLogin();
  assert.equal(verified.login_state, 'ready');
  assert.equal(verified.profile_initialized, true);
  assert.match(verified.last_verified_at, /^\d{4}-\d{2}-\d{2}T/);
  await service.shutdown();
});

test('interactive verification checks the platform-required capability before reporting login ready', async (t) => {
  const runtimeConfig = await makeRuntimeDirectory();
  t.after(() => fs.promises.rm(runtimeConfig.root, { recursive: true, force: true }));
  let capabilityChecks = 0;
  const service = new WebPlatformService({
    definition: {
      verifyInteractiveSession: async () => {
        capabilityChecks += 1;
        throw Object.assign(new Error('login required for deep research'), {
          code: 'web_login_required'
        });
      }
    },
    runtimeConfig,
    launcher: fakeLauncher(async () => ({
      status: 'ready',
      origin: 'https://chat.deepseek.com',
      composerCount: 1
    })),
    pageFactory: () => ({})
  });

  const verified = await service.verifyInteractiveLogin();
  assert.equal(capabilityChecks, 1);
  assert.equal(verified.login_state, 'login_required');
  assert.equal(verified.reason_code, 'web_login_required');
  assert.equal(verified.last_verified_at, null);
  assert.equal(service.getRuntimeSnapshot().lifecycle_state, 'login_required');
  await service.shutdown();
});

test('opening login or account switching recycles the dedicated Chrome and blocks capture until verification', async (t) => {
  const runtimeConfig = await makeRuntimeDirectory();
  t.after(() => fs.promises.rm(runtimeConfig.root, { recursive: true, force: true }));
  const events = [];
  let probeResult = {
    status: 'ready',
    origin: 'https://chat.deepseek.com',
    composerCount: 1
  };
  let captures = 0;
  const service = new WebPlatformService({
    runtimeConfig,
    launcher: fakeLauncher(async () => probeResult, events),
    captureStore: {},
    pageFactory: () => ({}),
    adapterFactory: () => ({
      async capture() {
        captures += 1;
        return {
          success: true,
          platform: 'deepseek-web',
          text: '完成',
          data: {},
          provider_citations: [],
          web_capture: { status: 'completed' }
        };
      }
    })
  });

  await service.preflight();
  const opened = await service.beginInteractiveLogin();
  assert.equal(opened.login_state, 'login_required');
  assert.equal(events.filter(([event]) => event === 'launch').length, 2);
  assert.equal(events.filter(([event]) => event === 'close').length, 1);

  const blocked = await service.queryPlatform('不应发送', {
    capture_owner: { record_id: 1, user_id: 7 }
  });
  assert.equal(blocked.error_code, 'web_login_required');
  assert.equal(captures, 0);

  const verified = await service.verifyInteractiveLogin();
  assert.equal(verified.login_state, 'ready');
  const completed = await service.queryPlatform('验证后发送', {
    capture_owner: { record_id: 2, user_id: 7 }
  });
  assert.equal(completed.success, true);
  assert.equal(captures, 1);
  await service.shutdown();
});

test('interactive login preserves browser launch failures in the administrator status snapshot', async (t) => {
  const runtimeConfig = await makeRuntimeDirectory();
  t.after(() => fs.promises.rm(runtimeConfig.root, { recursive: true, force: true }));
  const service = new WebPlatformService({
    runtimeConfig,
    launcher: {
      async launch() {
        throw Object.assign(new Error('launch failed'), {
          code: 'web_browser_launch_failed'
        });
      }
    }
  });

  await assert.rejects(service.beginInteractiveLogin(), {
    code: 'web_browser_launch_failed'
  });
  assert.deepEqual(service.getAdminSessionSnapshot(), {
    schema_version: 'managed-web-session-v1',
    platform: 'deepseek-web',
    browser_configured: true,
    profile_initialized: true,
    login_state: 'unavailable',
    reason_code: 'web_browser_launch_failed',
    last_verified_at: null
  });
  await service.shutdown();
});

test('interactive verification reports login and human-verification blockers without exposing runtime details', async (t) => {
  for (const [status, loginState, reasonCode] of [
    ['login_required', 'login_required', 'web_login_required'],
    ['verification_required', 'verification_required', 'web_verification_required'],
    ['selector_mismatch', 'selector_mismatch', 'web_selector_mismatch']
  ]) {
    const runtimeConfig = await makeRuntimeDirectory();
    t.after(() => fs.promises.rm(runtimeConfig.root, { recursive: true, force: true }));
    const service = new WebPlatformService({
      runtimeConfig,
      preflightStabilizationMs: 0,
      launcher: fakeLauncher(async () => ({
        status,
        origin: 'https://chat.deepseek.com',
        composerCount: 0
      }))
    });

    const result = await service.verifyInteractiveLogin();
    assert.equal(result.login_state, loginState);
    assert.equal(result.reason_code, reasonCode);
    assert.equal('profile_dir' in result, false);
    assert.equal('chrome_executable' in result, false);
    await service.shutdown();
  }
});

test('login failure opens a circuit so already queued work fails without another page action', async (t) => {
  const runtimeConfig = await makeRuntimeDirectory();
  t.after(() => fs.promises.rm(runtimeConfig.root, { recursive: true, force: true }));
  let captures = 0;
  const service = new WebPlatformService({
    runtimeConfig,
    launcher: fakeLauncher(async () => ({
      status: 'ready',
      origin: 'https://chat.deepseek.com',
      composerCount: 1
    })),
    captureStore: {},
    pageFactory: () => ({}),
    adapterFactory: () => ({
      async capture() {
        captures += 1;
        throw Object.assign(new Error('login required'), {
          code: 'web_login_required',
          stage: 'preflight'
        });
      }
    })
  });

  const [first, second] = await Promise.all([
    service.queryPlatform('问题一', { capture_owner: { record_id: 1, user_id: 7 } }),
    service.queryPlatform('问题二', { capture_owner: { record_id: 2, user_id: 7 } })
  ]);

  assert.equal(first.error_code, 'web_login_required');
  assert.equal(second.error_code, 'web_login_required');
  assert.equal(captures, 1);
  await service.shutdown();
});

test('runtime snapshot exposes a safe persistent login blocker without capture details', async (t) => {
  const runtimeConfig = await makeRuntimeDirectory();
  t.after(() => fs.promises.rm(runtimeConfig.root, { recursive: true, force: true }));
  const service = new WebPlatformService({
    runtimeConfig,
    launcher: fakeLauncher(async () => ({
      status: 'ready',
      origin: 'https://chat.deepseek.com',
      composerCount: 1
    })),
    captureStore: {},
    pageFactory: () => ({}),
    adapterFactory: () => ({
      async capture() {
        throw Object.assign(new Error('sensitive internal details'), {
          code: 'web_login_required',
          stage: 'composer_ready'
        });
      }
    })
  });

  await service.queryPlatform('不应出现在快照中的问题', {
    capture_owner: { record_id: 91, user_id: 7 }
  });

  assert.deepEqual(service.getRuntimeSnapshot(), {
    running_count: 0,
    lifecycle_state: 'login_required',
    blocking_error_code: 'web_login_required',
    shutting_down: false
  });
  assert.doesNotMatch(
    JSON.stringify(service.getRuntimeSnapshot()),
    /不应出现在快照中的问题|composer_ready|91|sensitive/
  );
  await service.shutdown();
});

test('login, verification and selector failures each open the Web circuit', async (t) => {
  for (const errorCode of [
    'web_login_required',
    'web_verification_required',
    'web_selector_mismatch'
  ]) {
    const runtimeConfig = await makeRuntimeDirectory();
    t.after(() => fs.promises.rm(runtimeConfig.root, { recursive: true, force: true }));
    let captures = 0;
    const service = new WebPlatformService({
      runtimeConfig,
      launcher: fakeLauncher(async () => ({
        status: 'ready',
        origin: 'https://chat.deepseek.com',
        composerCount: 1
      })),
      captureStore: {},
      pageFactory: () => ({}),
      adapterFactory: () => ({
        async capture() {
          captures += 1;
          throw Object.assign(new Error('circuit failure'), { code: errorCode });
        }
      })
    });

    const first = await service.queryPlatform('问题一', {
      capture_owner: { record_id: 1, user_id: 7 }
    });
    const second = await service.queryPlatform('问题二', {
      capture_owner: { record_id: 2, user_id: 7 }
    });

    assert.equal(first.error_code, errorCode);
    assert.equal(second.error_code, errorCode);
    assert.equal(captures, 1);
    await service.shutdown();
  }
});

test('a non-circuit task failure does not poison the next queued capture', async (t) => {
  const runtimeConfig = await makeRuntimeDirectory();
  t.after(() => fs.promises.rm(runtimeConfig.root, { recursive: true, force: true }));
  let captures = 0;
  const service = new WebPlatformService({
    runtimeConfig,
    launcher: fakeLauncher(async () => ({
      status: 'ready',
      origin: 'https://chat.deepseek.com',
      composerCount: 1
    })),
    captureStore: {},
    pageFactory: () => ({}),
    adapterFactory: () => ({
      async capture() {
        captures += 1;
        if (captures === 1) {
          throw Object.assign(new Error('timeout'), {
            code: 'web_generation_timeout',
            stage: 'generation_finished'
          });
        }
        return {
          success: true,
          platform: 'deepseek-web',
          text: '第二个问题成功',
          data: {},
          provider_citations: [],
          web_capture: { status: 'completed' }
        };
      }
    })
  });

  const [first, second] = await Promise.all([
    service.queryPlatform('问题一', { capture_owner: { record_id: 1, user_id: 7 } }),
    service.queryPlatform('问题二', { capture_owner: { record_id: 2, user_id: 7 } })
  ]);

  assert.equal(first.error_code, 'web_generation_timeout');
  assert.equal(second.success, true);
  assert.equal(captures, 2);
  await service.shutdown();
});

test('renderer disconnect is exposed as browser closed instead of a generic launch error', async (t) => {
  const runtimeConfig = await makeRuntimeDirectory();
  t.after(() => fs.promises.rm(runtimeConfig.root, { recursive: true, force: true }));
  const service = new WebPlatformService({
    runtimeConfig,
    launcher: fakeLauncher(async () => ({
      status: 'ready',
      origin: 'https://chat.deepseek.com',
      composerCount: 1
    })),
    captureStore: {},
    pageFactory: () => ({}),
    adapterFactory: () => ({
      async capture() {
        throw Object.assign(new Error('closed'), {
          code: 'renderer_connection_closed'
        });
      }
    })
  });

  const result = await service.queryPlatform('问题', {
    capture_owner: { record_id: 1, user_id: 7 }
  });

  assert.equal(result.error_code, 'web_browser_closed');
  await service.shutdown();
});

test('renderer timeout is reported as an unresponsive browser and recycles the session before the next task', async (t) => {
  const runtimeConfig = await makeRuntimeDirectory();
  t.after(() => fs.promises.rm(runtimeConfig.root, { recursive: true, force: true }));
  let launches = 0;
  let closes = 0;
  let captures = 0;
  const service = new WebPlatformService({
    runtimeConfig,
    launcher: {
      async launch() {
        launches += 1;
        return {
          async probe() {
            return {
              status: 'ready',
              origin: 'https://chat.deepseek.com',
              composerCount: 1
            };
          },
          async close() {
            closes += 1;
          }
        };
      }
    },
    captureStore: {},
    pageFactory: () => ({}),
    adapterFactory: () => ({
      async capture() {
        captures += 1;
        if (captures === 1) {
          throw Object.assign(new Error('Runtime.evaluate timeout'), {
            code: 'renderer_timeout',
            stage: 'new_conversation_verified'
          });
        }
        return {
          success: true,
          platform: 'deepseek-web',
          text: '重建后成功',
          data: {},
          provider_citations: [],
          web_capture: { status: 'completed' }
        };
      }
    })
  });

  const first = await service.queryPlatform('第一个问题', {
    capture_owner: { record_id: 1, user_id: 7 }
  });
  const second = await service.queryPlatform('第二个问题', {
    capture_owner: { record_id: 2, user_id: 7 }
  });

  assert.equal(first.error_code, 'web_browser_unresponsive');
  assert.equal(first.web_capture.failure.stage, 'new_conversation_verified');
  assert.equal(second.success, true);
  assert.equal(launches, 2);
  assert.equal(closes, 1);
  assert.equal(service.getRuntimeSnapshot().blocking_error_code, null);
  await service.shutdown();
});

test('single-question, question-set and scheduled entries share one FIFO in arrival order', async (t) => {
  const runtimeConfig = await makeRuntimeDirectory();
  t.after(() => fs.promises.rm(runtimeConfig.root, { recursive: true, force: true }));
  const activity = [];
  let active = 0;
  let maximumActive = 0;
  const service = new WebPlatformService({
    runtimeConfig,
    launcher: fakeLauncher(async () => ({
      status: 'ready',
      origin: 'https://chat.deepseek.com',
      composerCount: 1
    })),
    captureStore: {},
    pageFactory: () => ({}),
    adapterFactory: () => ({
      async capture(question) {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        activity.push(question);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return {
          success: true,
          platform: 'deepseek-web',
          text: question,
          data: {},
          provider_citations: [],
          web_capture: { status: 'completed' }
        };
      }
    })
  });

  const results = await Promise.all([
    service.queryPlatform('single-question-entry', {
      capture_owner: { record_id: 1, user_id: 7 }
    }),
    service.queryPlatform('question-set-entry', {
      capture_owner: { record_id: 2, user_id: 7 }
    }),
    service.queryPlatform('scheduled-entry', {
      capture_owner: { record_id: 3, user_id: 7 }
    })
  ]);

  assert.ok(results.every((result) => result.success));
  assert.equal(maximumActive, 1);
  assert.deepEqual(activity, [
    'single-question-entry',
    'question-set-entry',
    'scheduled-entry'
  ]);
  await service.shutdown();
});
