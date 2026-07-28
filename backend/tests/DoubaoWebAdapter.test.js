const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const {
  DoubaoWebAdapter,
  DoubaoWebPage
} = require('../services/DoubaoWebAdapter');

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
]);

function captureStore(events) {
  let sequence = 0;
  return {
    async beginCapture(owner) {
      events.push(['begin', owner]);
      return { owner, artifacts: {} };
    },
    async writeArtifact(capture, kind, buffer, metadata) {
      events.push(['artifact', kind]);
      capture.artifacts[kind] = {
        id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        mime_type: 'image/png',
        bytes: buffer.length,
        width: metadata.width,
        height: metadata.height
      };
    },
    async promoteCapture(capture) {
      events.push(['promote']);
      return { artifacts: capture.artifacts };
    },
    async discardCapture() {
      events.push(['discard']);
    }
  };
}

function page(events, snapshots) {
  let index = 0;
  return {
    assertReady: async () => events.push(['ready']),
    startNewConversation: async () => events.push(['new']),
    ensureSearchEnabled: async () => {
      events.push(['research']);
      return {
        requested: true,
        observed: true,
        evidence_type: 'dom_selected_deep_research'
      };
    },
    captureScreenshot: async (kind) => {
      events.push(['screenshot', kind]);
      return { buffer: PNG, width: 1200, height: 800 };
    },
    insertPrompt: async (question) => events.push(['insert', question]),
    startNetworkObservation: async () => events.push(['network']),
    sendPrompt: async () => events.push(['send']),
    getConversationSnapshot: async () => {
      const snapshot = snapshots[Math.min(index, snapshots.length - 1)];
      index += 1;
      return snapshot;
    },
    extractCitations: async () => [{
      url: 'https://example.com/report#citation',
      title: '引用来源'
    }],
    collectRetrievalCandidates: async () => [],
    stopNetworkObservation: async () => {},
    getMetadata: async () => ({
      pageUrl: 'https://www.doubao.com/chat/123',
      browser: {
        product: 'Chrome',
        version: '150',
        user_agent: 'Chrome/150',
        locale: 'zh-CN',
        timezone_offset_minutes: 480,
        viewport: { width: 1200, height: 800, device_scale_factor: 1 }
      },
      client: { platform: 'web', version: '', bundle_id: 'com.doubao.web' }
    })
  };
}

test('captures one Doubao answer only after deep-research evidence is saved', async () => {
  const events = [];
  let now = 0;
  const answer = '豆包网页最终回答';
  const adapter = new DoubaoWebAdapter({
    page: page(events, [
      { assistantTurns: [], generationActive: false, busy: false },
      { assistantTurns: [], generationActive: true, busy: true },
      { assistantTurns: [{ id: 'message-1', text: answer }], generationActive: false, busy: false },
      { assistantTurns: [{ id: 'message-1', text: answer }], generationActive: false, busy: false }
    ]),
    captureStore: captureStore(events),
    now: () => now,
    sleep: async (ms) => { now += ms; },
    pollMs: 1,
    stableMs: 1,
    timeoutMs: 30_000
  });

  const result = await adapter.capture('测试豆包问题', {
    record_id: 23,
    user_id: 7,
    project_id: 4
  });

  assert.equal(result.platform, 'doubao-web');
  assert.equal(result.model_name, 'doubao-web-ui');
  assert.equal(result.text, answer);
  assert.equal(result.web_capture.schema_version, 'doubao-web-capture-v1');
  assert.equal(result.web_capture.selector_version, 'doubao-web-v1');
  assert.equal(result.web_capture.page_origin, 'https://www.doubao.com');
  assert.equal(result.provider_citations[0].source_origin, 'doubao_web_dom');
  assert.equal(events.filter(([name]) => name === 'send').length, 1);
  assert.ok(
    events.findIndex(([name, kind]) => name === 'screenshot' && kind === 'search_state')
      < events.findIndex(([name]) => name === 'insert')
  );
});

test('never inserts or sends when Doubao deep-research state is not uniquely verified', async () => {
  const events = [];
  const fakePage = page(events, [
    { assistantTurns: [], generationActive: false, busy: false }
  ]);
  fakePage.ensureSearchEnabled = async () => ({
    requested: true,
    observed: false,
    count: 2
  });
  const adapter = new DoubaoWebAdapter({
    page: fakePage,
    captureStore: captureStore(events)
  });

  await assert.rejects(
    adapter.capture('不会发送', { record_id: 24, user_id: 7 }),
    { code: 'web_search_state_unverified' }
  );
  assert.equal(events.some(([name]) => name === 'insert'), false);
  assert.equal(events.some(([name]) => name === 'send'), false);
  assert.equal(events.at(-1)[0], 'discard');
});

test('Doubao page accepts only its official ready origin', async () => {
  const probes = [
    { status: 'origin_mismatch', origin: 'null', composerCount: 0 },
    { status: 'ready', origin: 'https://www.doubao.com', composerCount: 1 }
  ];
  const doubaoPage = new DoubaoWebPage({
    probe: async () => probes.shift(),
    connection: {}
  }, { sleep: async () => {} });

  assert.equal((await doubaoPage.assertReady()).status, 'ready');
});

test('Doubao new conversation accepts the current blank chat path without a trailing slash', async () => {
  const doubaoPage = new DoubaoWebPage(
    { connection: {} },
    { sleep: async () => {} }
  );
  doubaoPage.callDocument = async () => ({ ok: true, count: 1 });
  doubaoPage.evaluate = async () => ({
    pathname: '/chat',
    assistantCount: 0
  });

  assert.deepEqual(await doubaoPage.startNewConversation(), {
    pageUrl: 'https://www.doubao.com/chat/'
  });
});

test('Doubao page requires one selected deep-research chip after at most one click', async () => {
  const calls = [];
  const doubaoPage = new DoubaoWebPage({ connection: {} }, { sleep: async () => {} });
  doubaoPage.callDocument = async (_fn, args) => {
    calls.push(args[0]);
    return calls.length === 1
      ? { observed: false, selectedCount: 0, actionCount: 1 }
      : { observed: true, selectedCount: 1, actionCount: 1 };
  };

  assert.deepEqual(await doubaoPage.ensureSearchEnabled(), {
    requested: true,
    observed: true,
    evidence_type: 'dom_selected_deep_research'
  });
  assert.deepEqual(calls, [true, false]);
});

test('Doubao page reports login required when anonymous deep research opens the login gate', async () => {
  const calls = [];
  const doubaoPage = new DoubaoWebPage({ connection: {} }, { sleep: async () => {} });
  doubaoPage.callDocument = async (_fn, args) => {
    calls.push(args[0]);
    return calls.length === 1
      ? { observed: false, selectedCount: 0, actionCount: 1, loginRequired: false }
      : { observed: false, selectedCount: 0, actionCount: 1, loginRequired: true };
  };

  await assert.rejects(
    doubaoPage.ensureSearchEnabled(),
    { code: 'web_login_required' }
  );
  assert.deepEqual(calls, [true, false]);
});

test('Doubao search wait keeps detecting a delayed explicit anonymous login control', async () => {
  const doubaoPage = new DoubaoWebPage({ connection: {} }, { sleep: async () => {} });
  doubaoPage.callDocument = async (functionDeclaration) => {
    assert.match(
      functionDeclaration,
      /querySelectorAll\('button,\[role="button"\],a'\)/
    );
    return {
      observed: false,
      selectedCount: 0,
      actionCount: 0,
      loginRequired: true
    };
  };

  await assert.rejects(
    doubaoPage.ensureSearchEnabled(),
    { code: 'web_login_required' }
  );
});

test('Doubao interactive login verification rejects an explicit anonymous login page before checking research', async () => {
  let researchChecks = 0;
  const doubaoPage = new DoubaoWebPage({ connection: {} }, { sleep: async () => {} });
  doubaoPage.callDocument = async () => ({ loginRequired: true });
  doubaoPage.ensureSearchEnabled = async () => {
    researchChecks += 1;
    return { requested: true, observed: true };
  };

  await assert.rejects(
    doubaoPage.verifyInteractiveLogin(),
    { code: 'web_login_required' }
  );
  assert.equal(researchChecks, 0);
});
