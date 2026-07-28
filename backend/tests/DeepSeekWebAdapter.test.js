const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const {
  DeepSeekWebAdapter,
  DeepSeekWebPage
} = require('../services/DeepSeekWebAdapter');

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x00
]);

function createCaptureStore(events) {
  let artifactSequence = 0;
  return {
    async beginCapture(owner) {
      events.push(['begin_capture', owner]);
      return { owner, artifacts: {} };
    },
    async writeArtifact(capture, kind, buffer, metadata) {
      events.push(['write_artifact', kind]);
      const artifact = {
        id: `00000000-0000-4000-8000-${String(++artifactSequence).padStart(12, '0')}`,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        mime_type: 'image/png',
        bytes: buffer.length,
        width: metadata.width,
        height: metadata.height
      };
      capture.artifacts[kind] = artifact;
      return artifact;
    },
    async promoteCapture(capture) {
      events.push(['promote_capture']);
      return { artifacts: capture.artifacts };
    },
    async discardCapture() {
      events.push(['discard_capture']);
    }
  };
}

function createPage(events, snapshots) {
  let snapshotIndex = 0;
  return {
    async assertReady() {
      events.push(['assert_ready']);
      return { origin: 'https://chat.deepseek.com' };
    },
    async startNewConversation() {
      events.push(['new_conversation']);
      return { pageUrl: 'https://chat.deepseek.com/' };
    },
    async ensureSearchEnabled() {
      events.push(['search_enabled']);
      return { requested: true, observed: true, evidence_type: 'dom_selected_state' };
    },
    async captureScreenshot(kind) {
      events.push(['capture', kind]);
      return { buffer: PNG, width: 1200, height: 800 };
    },
    async insertPrompt(question) {
      events.push(['insert_prompt', question]);
    },
    async sendPrompt() {
      events.push(['send_prompt']);
    },
    async getConversationSnapshot() {
      events.push(['snapshot']);
      const value = snapshots[Math.min(snapshotIndex, snapshots.length - 1)];
      snapshotIndex += 1;
      return value;
    },
    async extractCitations(turnId) {
      events.push(['citations', turnId]);
      return [{
        url: 'https://example.com/source',
        domain: 'example.com',
        title: '示例来源',
        source_origin: 'deepseek_web_dom',
        source_role: 'explicit_citation'
      }];
    },
    async startNetworkObservation() {
      events.push(['network_start']);
    },
    async collectRetrievalCandidates() {
      events.push(['network_collect']);
      return [];
    },
    async stopNetworkObservation() {
      events.push(['network_stop']);
    },
    async getMetadata() {
      return {
        pageUrl: 'https://chat.deepseek.com/a/chat/s/test-conversation',
        browser: {
          product: 'Chrome',
          version: '150.0.0.0',
          user_agent: 'Mozilla/5.0 Chrome/150.0.0.0',
          locale: 'zh-CN',
          timezone_offset_minutes: 480,
          viewport: { width: 1200, height: 800, device_scale_factor: 1 }
        },
        client: {
          platform: 'web',
          version: '2.2.0',
          bundle_id: 'com.deepseek.chat'
        }
      };
    }
  };
}

test('captures one new searched assistant turn in strict state-machine order', async () => {
  const events = [];
  let now = 0;
  const answer = '这是最终网页回答。';
  const snapshots = [
    { assistantTurns: [], generationActive: false, busy: false },
    { assistantTurns: [], generationActive: true, busy: true },
    { assistantTurns: [{ id: 'turn-1', text: answer }], generationActive: true, busy: true },
    { assistantTurns: [{ id: 'turn-1', text: answer }], generationActive: false, busy: false },
    { assistantTurns: [{ id: 'turn-1', text: answer }], generationActive: false, busy: false },
    { assistantTurns: [{ id: 'turn-1', text: answer }], generationActive: false, busy: false },
    { assistantTurns: [{ id: 'turn-1', text: answer }], generationActive: false, busy: false }
  ];
  const adapter = new DeepSeekWebAdapter({
    page: createPage(events, snapshots),
    captureStore: createCaptureStore(events),
    now: () => now,
    sleep: async (ms) => { now += ms; },
    pollMs: 500,
    stableMs: 1500,
    timeoutMs: 30_000
  });

  const result = await adapter.capture('测试问题', {
    record_id: 123,
    user_id: 7,
    project_id: 42
  });

  assert.equal(result.success, true);
  assert.equal(result.platform, 'deepseek-web');
  assert.equal(result.text, answer);
  assert.equal(result.provider_citations.length, 1);
  assert.equal(result.web_capture.status, 'completed');
  assert.equal(result.web_capture.artifact_owner_record_id, 123);
  assert.equal(
    result.web_capture.response_sha256,
    createHash('sha256').update(answer).digest('hex')
  );
  assert.equal(result.web_capture.search.observed, true);
  assert.equal(result.web_capture.completion.stable_ms, 1500);
  assert.deepEqual(Object.keys(result.web_capture.artifacts), ['search_state', 'final_answer']);
  assert.equal(events.filter(([name]) => name === 'send_prompt').length, 1);
  assert.ok(
    events.findIndex(([name]) => name === 'new_conversation')
      < events.findIndex(([name]) => name === 'search_enabled')
  );
  assert.ok(
    events.findIndex(([name, kind]) => name === 'capture' && kind === 'search_state')
      < events.findIndex(([name]) => name === 'insert_prompt')
  );
  assert.ok(
    events.findIndex(([name]) => name === 'insert_prompt')
      < events.findIndex(([name]) => name === 'network_start')
  );
  assert.ok(
    events.findIndex(([name]) => name === 'network_start')
      < events.findIndex(([name]) => name === 'send_prompt')
  );
});

test('rejects missing capture ownership before opening or staging a page', async () => {
  const events = [];
  const adapter = new DeepSeekWebAdapter({
    page: createPage(events, []),
    captureStore: createCaptureStore(events)
  });

  await assert.rejects(
    adapter.capture('测试问题', { user_id: 7 }),
    { code: 'web_capture_owner_missing' }
  );
  assert.deepEqual(events, []);
});

test('does not insert or send when visible search state cannot be verified', async () => {
  const events = [];
  const page = createPage(events, [
    { assistantTurns: [], generationActive: false, busy: false }
  ]);
  page.ensureSearchEnabled = async () => {
    events.push(['search_unverified']);
    return { requested: true, observed: false };
  };
  const adapter = new DeepSeekWebAdapter({
    page,
    captureStore: createCaptureStore(events)
  });

  await assert.rejects(
    adapter.capture('测试问题', { record_id: 123, user_id: 7, project_id: 42 }),
    { code: 'web_search_state_unverified' }
  );
  assert.equal(events.some(([name]) => name === 'insert_prompt'), false);
  assert.equal(events.some(([name]) => name === 'send_prompt'), false);
  assert.equal(events.at(-1)[0], 'discard_capture');
});

test('adds the current capture stage to low-level renderer failures', async () => {
  const events = [];
  const page = createPage(events, []);
  page.startNewConversation = async () => {
    throw Object.assign(new Error('Runtime.evaluate timeout'), {
      code: 'renderer_timeout'
    });
  };
  const adapter = new DeepSeekWebAdapter({
    page,
    captureStore: createCaptureStore(events)
  });

  await assert.rejects(
    adapter.capture('测试问题', { record_id: 123, user_id: 7 }),
    (error) => (
      error.code === 'renderer_timeout'
      && error.stage === 'new_conversation_verified'
    )
  );
  assert.equal(events.at(-1)[0], 'discard_capture');
});

test('rejects a pre-existing assistant turn before sending a new prompt', async () => {
  const events = [];
  let now = 0;
  const oldTurn = { id: 'old-turn', text: '旧回答' };
  const page = createPage(events, [
    { assistantTurns: [oldTurn], generationActive: false, busy: false }
  ]);
  const adapter = new DeepSeekWebAdapter({
    page,
    captureStore: createCaptureStore(events),
    now: () => now,
    sleep: async (ms) => { now += ms; },
    pollMs: 500,
    stableMs: 1500,
    timeoutMs: 2000
  });

  await assert.rejects(
    adapter.capture('测试问题', { record_id: 123, user_id: 7 }),
    { code: 'web_selector_mismatch' }
  );
  assert.equal(events.filter(([name]) => name === 'send_prompt').length, 0);
  assert.equal(events.at(-1)[0], 'discard_capture');
});

test('real page readiness tolerates the initial blank target before the composer loads', async () => {
  const probes = [
    { status: 'origin_mismatch', origin: 'null', composerCount: 0 },
    { status: 'selector_mismatch', origin: 'https://chat.deepseek.com', composerCount: 0 },
    { status: 'ready', origin: 'https://chat.deepseek.com', composerCount: 1 }
  ];
  const page = new DeepSeekWebPage({
    probe: async () => probes.shift(),
    connection: {}
  }, {
    sleep: async () => {}
  });

  assert.equal((await page.assertReady()).status, 'ready');
  assert.equal(probes.length, 0);
});

test('new conversation waits for the sidebar control to settle before clicking once', async () => {
  let controlProbeCount = 0;
  let stateProbeCount = 0;
  const page = new DeepSeekWebPage({
    connection: {}
  }, {
    sleep: async () => {}
  });
  page.callDocument = async () => {
    controlProbeCount += 1;
    return controlProbeCount === 1
      ? { ok: false, count: 2 }
      : { ok: true, count: 1 };
  };
  page.evaluate = async () => {
    stateProbeCount += 1;
    return { pathname: '/', assistantCount: 0 };
  };

  const result = await page.startNewConversation();

  assert.equal(result.pageUrl, 'https://chat.deepseek.com/');
  assert.equal(controlProbeCount, 2);
  assert.equal(stateProbeCount, 1);
});

test('screenshot uses a dedicated timeout and retries one renderer timeout without resubmitting', async () => {
  const calls = [];
  const delays = [];
  const page = new DeepSeekWebPage({
    connection: {
      send: async (method, _params, options) => {
        calls.push({ method, options });
        if (method === 'Runtime.evaluate') {
          return {
            result: {
              value: { x: 100, y: 0, width: 900, height: 700, scale: 1 }
            }
          };
        }
        if (method === 'Page.captureScreenshot' && calls.filter(
          (call) => call.method === 'Page.captureScreenshot'
        ).length === 1) {
          throw Object.assign(new Error('screenshot timeout'), {
            code: 'renderer_timeout'
          });
        }
        return { data: PNG.toString('base64') };
      }
    }
  }, {
    sleep: async (ms) => delays.push(ms)
  });

  const screenshot = await page.captureScreenshot();
  const screenshotCalls = calls.filter(
    (call) => call.method === 'Page.captureScreenshot'
  );

  assert.equal(screenshotCalls.length, 2);
  assert.deepEqual(
    screenshotCalls.map((call) => call.options),
    [{ timeoutMs: 45_000 }, { timeoutMs: 45_000 }]
  );
  assert.deepEqual(delays, [500]);
  assert.equal(screenshot.buffer.equals(PNG), true);
  assert.equal(screenshot.width, 900);
  assert.equal(screenshot.height, 700);
});

test('screenshot failure ends the capture before prompt insertion and keeps no staged evidence', async () => {
  const events = [];
  const page = createPage(events, [
    { assistantTurns: [], generationActive: false, busy: false }
  ]);
  page.captureScreenshot = async () => {
    events.push(['capture_failed']);
    throw Object.assign(new Error('screenshot failed'), {
      code: 'web_screenshot_failed',
      stage: 'search_evidence_saved'
    });
  };
  const adapter = new DeepSeekWebAdapter({
    page,
    captureStore: createCaptureStore(events)
  });

  await assert.rejects(
    adapter.capture('测试问题', { record_id: 123, user_id: 7 }),
    { code: 'web_screenshot_failed' }
  );
  assert.equal(events.some(([name]) => name === 'insert_prompt'), false);
  assert.equal(events.some(([name]) => name === 'send_prompt'), false);
  assert.equal(events.at(-1)[0], 'discard_capture');
});

test('rejects an oversized final answer without a second send or promoted evidence', async () => {
  const events = [];
  let now = 0;
  const oversized = '大'.repeat(1024 * 1024);
  const page = createPage(events, [
    { assistantTurns: [], generationActive: false, busy: false },
    { assistantTurns: [], generationActive: false, busy: false },
    { assistantTurns: [{ id: 'turn-large', text: oversized }], generationActive: false, busy: false },
    { assistantTurns: [{ id: 'turn-large', text: oversized }], generationActive: false, busy: false }
  ]);
  const adapter = new DeepSeekWebAdapter({
    page,
    captureStore: createCaptureStore(events),
    now: () => now,
    sleep: async (ms) => { now += ms; },
    pollMs: 1,
    stableMs: 1,
    timeoutMs: 30_000
  });

  await assert.rejects(
    adapter.capture('测试超长回答', { record_id: 123, user_id: 7 }),
    { code: 'web_response_too_large' }
  );
  assert.equal(events.filter(([name]) => name === 'send_prompt').length, 1);
  assert.equal(events.some(([name]) => name === 'promote_capture'), false);
  assert.equal(events.at(-1)[0], 'discard_capture');
});

test('normalizes DOM citations and keeps bounded Network-only sources as retrieval candidates', async () => {
  const events = [];
  let now = 0;
  const answer = '最终回答包含一个明确来源。';
  const page = createPage(events, [
    { assistantTurns: [], generationActive: false, busy: false },
    { assistantTurns: [], generationActive: false, busy: false },
    { assistantTurns: [{ id: 'turn-1', text: answer }], generationActive: false, busy: false },
    { assistantTurns: [{ id: 'turn-1', text: answer }], generationActive: false, busy: false }
  ]);
  page.extractCitations = async () => [
    {
      url: 'https://Example.com/source#fragment',
      title: '明确来源',
      source_role: 'explicit_citation'
    },
    {
      url: 'https://example.com/source',
      title: '重复来源',
      source_role: 'explicit_citation'
    },
    {
      url: 'javascript:alert(1)',
      title: '非法协议',
      source_role: 'explicit_citation'
    },
    {
      url: `https://example.com/${'x'.repeat(2050)}`,
      title: '超长来源',
      source_role: 'explicit_citation'
    }
  ];
  page.collectRetrievalCandidates = async () => [
    { url: 'https://example.com/source', title: '与明确来源重复' },
    { url: 'https://retrieval.example.net/report', title: '仅检索候选' },
    { url: 'file:///etc/passwd', title: '非法候选' }
  ];
  const adapter = new DeepSeekWebAdapter({
    page,
    captureStore: createCaptureStore(events),
    now: () => now,
    sleep: async (ms) => { now += ms; },
    pollMs: 1,
    stableMs: 1,
    timeoutMs: 30_000
  });

  const result = await adapter.capture('测试引用规范化', {
    record_id: 124,
    user_id: 7
  });

  assert.deepEqual(result.provider_citations, [
    {
      url: 'https://example.com/source',
      domain: 'example.com',
      title: '明确来源',
      source_origin: 'deepseek_web_dom',
      source_role: 'explicit_citation'
    },
    {
      url: 'https://retrieval.example.net/report',
      domain: 'retrieval.example.net',
      title: '仅检索候选',
      source_origin: 'deepseek_web_network',
      source_role: 'retrieval_candidate'
    }
  ]);
});

test('a completed Web answer remains successful when no explicit citation is present', async () => {
  const events = [];
  let now = 0;
  const page = createPage(events, [
    { assistantTurns: [], generationActive: false, busy: false },
    { assistantTurns: [], generationActive: false, busy: false },
    {
      assistantTurns: [{ id: 'turn-no-citation', text: '这是没有引用的最终回答。' }],
      generationActive: false,
      busy: false
    },
    {
      assistantTurns: [{ id: 'turn-no-citation', text: '这是没有引用的最终回答。' }],
      generationActive: false,
      busy: false
    }
  ]);
  page.extractCitations = async () => [];
  const adapter = new DeepSeekWebAdapter({
    page,
    captureStore: createCaptureStore(events),
    now: () => now,
    sleep: async (ms) => { now += ms; },
    pollMs: 1,
    stableMs: 1,
    timeoutMs: 30_000
  });

  const result = await adapter.capture('测试无引用回答', {
    record_id: 125,
    user_id: 7
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.provider_citations, []);
});

test('passive Network observation reads bodies only for bounded same-origin JSON fetches', async () => {
  const handlers = new Map();
  const commands = [];
  const connection = {
    on(method, handler) {
      handlers.set(method, handler);
      return () => handlers.delete(method);
    },
    async send(method, params = {}) {
      commands.push([method, params]);
      if (method === 'Network.getResponseBody') {
        return {
          body: JSON.stringify({
            data: {
              sources: [{
                url: 'https://source.example/report',
                title: '白名单来源',
                cookie: '不得保存'
              }]
            }
          }),
          base64Encoded: false
        };
      }
      return {};
    }
  };
  const page = new DeepSeekWebPage({ connection, probe: async () => ({}) });

  await page.startNetworkObservation();
  handlers.get('Network.responseReceived')({
    requestId: 'eligible',
    type: 'Fetch',
    response: {
      url: 'https://chat.deepseek.com/api/v0/chat/completion',
      mimeType: 'application/json',
      encodedDataLength: 1024
    }
  });
  handlers.get('Network.responseReceived')({
    requestId: 'wrong-origin',
    type: 'Fetch',
    response: {
      url: 'https://api.deepseek.com/chat',
      mimeType: 'application/json',
      encodedDataLength: 1024
    }
  });
  handlers.get('Network.responseReceived')({
    requestId: 'wrong-type',
    type: 'Image',
    response: {
      url: 'https://chat.deepseek.com/image',
      mimeType: 'application/json',
      encodedDataLength: 1024
    }
  });
  handlers.get('Network.responseReceived')({
    requestId: 'too-large',
    type: 'XHR',
    response: {
      url: 'https://chat.deepseek.com/api/large',
      mimeType: 'application/json',
      encodedDataLength: 2 * 1024 * 1024 + 1
    }
  });

  const candidates = await page.collectRetrievalCandidates();

  assert.deepEqual(candidates, [{
    url: 'https://source.example/report',
    title: '白名单来源'
  }]);
  assert.deepEqual(
    commands.filter(([method]) => method === 'Network.getResponseBody'),
    [['Network.getResponseBody', { requestId: 'eligible' }]]
  );
  assert.equal(handlers.has('Network.responseReceived'), false);
});
