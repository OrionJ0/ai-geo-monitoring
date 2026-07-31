const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const {
  DoubaoWebAdapter,
  DoubaoWebPage,
  resolveDoubaoCitationUrl
} = require('../services/DoubaoWebAdapter');
const doubaoSelectors = require('../config/doubaoWebSelectors');

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
]);

test('Doubao composer contract includes the current textarea and contenteditable textbox', () => {
  assert.equal(doubaoSelectors.selectorVersion, 'doubao-web-v3');
  assert.ok(
    doubaoSelectors.composer.includes(
      'textarea[placeholder="发消息或按住空格说话..."]:not([disabled])'
    )
  );
  assert.ok(
    doubaoSelectors.composer.includes('[contenteditable="true"][role="textbox"]')
  );
});

test('Doubao message contract includes the current block-v1 assistant content', () => {
  assert.ok(
    doubaoSelectors.message.renderedBlock.includes(
      '[data-container-type="block-v1"][data-render-engine="block"]'
    )
  );
});

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

function page(events, snapshots, { retrievalCandidates = [] } = {}) {
  let index = 0;
  return {
    assertReady: async () => events.push(['ready']),
    startNewConversation: async () => events.push(['new']),
    verifyCaptureMode: async () => {
      events.push(['standard-mode']);
      return {
        mode: 'standard',
        observed: true,
        search_requested: false,
        search_observed: null,
        evidence_type: 'dom_standard_mode'
      };
    },
    ensureSearchEnabled: async () => {
      throw new Error('Doubao must not enable deep research');
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
    collectRetrievalCandidates: async () => retrievalCandidates,
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

test('captures one Doubao answer in standard mode without enabling deep research', async () => {
  const events = [];
  let now = 0;
  const answer = '豆包网页最终回答';
  const adapter = new DoubaoWebAdapter({
    page: page(
      events,
      [
        { assistantTurns: [], generationActive: false, busy: false },
        { assistantTurns: [], generationActive: true, busy: true },
        { assistantTurns: [{ id: 'message-1', text: answer }], generationActive: false, busy: false },
        { assistantTurns: [{ id: 'message-1', text: answer }], generationActive: false, busy: false }
      ],
      {
        retrievalCandidates: [{
          url: 'https://search.example.com/result',
          title: '普通模式检索候选'
        }]
      }
    ),
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
  assert.equal(result.web_capture.selector_version, 'doubao-web-v3');
  assert.equal(result.web_capture.page_origin, 'https://www.doubao.com');
  assert.equal(result.web_capture.capture_mode.name, 'standard');
  assert.equal(result.web_capture.search.requested, false);
  assert.equal(result.web_capture.search.observed, true);
  assert.equal(
    result.web_capture.search.evidence_type,
    'network_retrieval_candidates'
  );
  assert.equal(result.provider_citations[0].source_origin, 'doubao_web_dom');
  assert.equal(result.provider_citations[1].source_origin, 'doubao_web_network');
  assert.equal(events.filter(([name]) => name === 'send').length, 1);
  assert.equal(events.some(([name]) => name === 'research'), false);
  assert.ok(
    events.findIndex(([name, kind]) => name === 'screenshot' && kind === 'search_state')
      < events.findIndex(([name]) => name === 'insert')
  );
});

test('does not persist Doubao search progress as the final answer', async () => {
  const events = [];
  let now = 0;
  const answer = '这是豆包网页最终回答';
  const adapter = new DoubaoWebAdapter({
    page: page(events, [
      { assistantTurns: [], generationActive: false, busy: false },
      { assistantTurns: [], generationActive: false, busy: false },
      {
        assistantTurns: [{ id: 'message-1', text: '正在搜索' }],
        generationActive: false,
        busy: false
      },
      {
        assistantTurns: [{ id: 'message-1', text: '正在搜索' }],
        generationActive: false,
        busy: false
      },
      {
        assistantTurns: [{ id: 'message-1', text: answer }],
        generationActive: false,
        busy: false
      },
      {
        assistantTurns: [{ id: 'message-1', text: answer }],
        generationActive: false,
        busy: false
      }
    ]),
    captureStore: captureStore(events),
    now: () => now,
    sleep: async (ms) => { now += ms; },
    pollMs: 1,
    stableMs: 1,
    timeoutMs: 30_000
  });

  const result = await adapter.capture('测试搜索过渡态', {
    record_id: 24,
    user_id: 7,
    project_id: 4
  });

  assert.equal(result.text, answer);
  assert.notEqual(result.web_capture.response_sha256, createHash('sha256')
    .update('正在搜索').digest('hex'));
});

test('recognizes the Doubao source-search summary as a transient answer block', () => {
  const adapter = new DoubaoWebAdapter({});

  assert.equal(adapter.isTransientAnswer(
    '搜索 1 个关键词，参考 6 篇资料\n“上海炎荣 脉冲电子围栏 产品特点 官网”'
  ), true);
  assert.equal(adapter.isTransientAnswer('这是包含来源链接的最终回答。'), false);
});

test('never inserts or sends when Doubao standard mode cannot be verified', async () => {
  const events = [];
  const fakePage = page(events, [
    { assistantTurns: [], generationActive: false, busy: false }
  ]);
  fakePage.verifyCaptureMode = async () => ({
    mode: 'standard',
    observed: false,
    error_code: 'web_capture_mode_unverified',
    error_message: '无法确认豆包普通模式'
  });
  const adapter = new DoubaoWebAdapter({
    page: fakePage,
    captureStore: captureStore(events)
  });

  await assert.rejects(
    adapter.capture('不会发送', { record_id: 24, user_id: 7 }),
    { code: 'web_capture_mode_unverified' }
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

test('Doubao evidence screenshot completes when compositor-surface capture is unresponsive', async () => {
  const screenshotModes = [];
  const doubaoPage = new DoubaoWebPage({
    connection: {
      send: async (method, params) => {
        if (method === 'Runtime.evaluate') {
          return {
            result: {
              value: { x: 100, y: 0, width: 900, height: 700, scale: 1 }
            }
          };
        }
        screenshotModes.push(params.fromSurface);
        if (params.fromSurface) {
          throw Object.assign(new Error('surface screenshot timeout'), {
            code: 'renderer_timeout'
          });
        }
        return { data: PNG.toString('base64') };
      }
    }
  }, { sleep: async () => {} });

  const screenshot = await doubaoPage.captureScreenshot();

  assert.equal(screenshot.buffer.equals(PNG), true);
  assert.deepEqual(screenshotModes, [false]);
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

test('Doubao page keeps standard mode without clicking when deep research is inactive', async () => {
  const calls = [];
  const doubaoPage = new DoubaoWebPage({ connection: {} }, { sleep: async () => {} });
  doubaoPage.callDocument = async (_fn, args) => {
    calls.push(args[0]);
    return { observed: true, selectedCount: 0, actionCount: 1 };
  };

  assert.deepEqual(await doubaoPage.verifyCaptureMode(), {
    mode: 'standard',
    observed: true,
    search_requested: false,
    search_observed: null,
    evidence_type: 'dom_standard_mode'
  });
  assert.deepEqual(calls, [true]);
});

test('Doubao page deactivates an already-selected deep-research mode once', async () => {
  const calls = [];
  const doubaoPage = new DoubaoWebPage({ connection: {} }, { sleep: async () => {} });
  doubaoPage.callDocument = async (_fn, args) => {
    calls.push(args[0]);
    return calls.length === 1
      ? { observed: false, selectedCount: 1, actionCount: 1 }
      : { observed: true, selectedCount: 0, actionCount: 1 };
  };

  assert.deepEqual(await doubaoPage.verifyCaptureMode(), {
    mode: 'standard',
    observed: true,
    search_requested: false,
    search_observed: null,
    evidence_type: 'dom_standard_mode'
  });
  assert.deepEqual(calls, [true, false]);
});

test('Doubao page refuses to send if an active deep-research mode cannot be disabled', async () => {
  const doubaoPage = new DoubaoWebPage({ connection: {} }, { sleep: async () => {} });
  doubaoPage.callDocument = async () => {
    return {
      observed: false,
      selectedCount: 1,
      actionCount: 1
    };
  };

  assert.deepEqual(await doubaoPage.verifyCaptureMode(), {
    mode: 'standard',
    observed: false,
    search_requested: false,
    search_observed: null,
    evidence_type: 'dom_standard_mode',
    error_code: 'web_capture_mode_unverified',
    error_message: '无法确认豆包普通模式'
  });
});

test('Doubao generation snapshot exposes a visible human-verification gate', async () => {
  const doubaoPage = new DoubaoWebPage({ connection: {} }, { sleep: async () => {} });
  doubaoPage.evaluate = async (expression) => {
    assert.match(expression, /captcha/);
    return {
      assistantTurns: [],
      generationActive: false,
      busy: false,
      verificationRequired: true,
      loginRequired: false
    };
  };

  const snapshot = await doubaoPage.getConversationSnapshot();

  assert.equal(snapshot.verificationRequired, true);
  assert.equal(snapshot.loginRequired, false);
});

test('Doubao generation snapshot treats search progress as busy instead of a final answer', async () => {
  const doubaoPage = new DoubaoWebPage({ connection: {} }, { sleep: async () => {} });
  doubaoPage.evaluate = async (expression) => {
    assert.match(expression, /querySelector\('\.md-box-root'\)/);
    assert.match(expression, /search_query_result_block\.search_type:1/);
    assert.match(expression, /searchInProgress/);
    assert.doesNotMatch(
      expression,
      /querySelectorAll\('\[data-render-engine="node"\]'\)/
    );
    return {
      assistantTurns: [],
      generationActive: true,
      busy: false,
      verificationRequired: false,
      loginRequired: false
    };
  };

  const snapshot = await doubaoPage.getConversationSnapshot();

  assert.deepEqual(snapshot.assistantTurns, []);
  assert.equal(snapshot.generationActive, true);
});

test('Doubao citation extraction targets final answer content instead of search progress', async () => {
  const doubaoPage = new DoubaoWebPage({ connection: {} }, { sleep: async () => {} });
  doubaoPage.callDocument = async (functionDeclaration) => {
    assert.match(functionDeclaration, /querySelector\('\.md-box-root'\)/);
    assert.doesNotMatch(
      functionDeclaration,
      /querySelectorAll\('\[data-render-engine="node"\]'\)/
    );
    return [{
      url: 'https://link.wtturl.cn/?target=https%3A%2F%2Fopenai.com%2Findex%2Fexample',
      title: 'OpenAI'
    }];
  };

  const citations = await doubaoPage.extractCitations('message-1');

  assert.equal(citations.length, 1);
  assert.equal(citations[0].url, 'https://openai.com/index/example');
});

test('Doubao citation redirects resolve only a safe HTTP target', () => {
  assert.equal(
    resolveDoubaoCitationUrl(
      'https://link.wtturl.cn/?target=https%3A%2F%2Fdevelopers.openai.com%2Fapi%2Fdocs%2Fmodels'
    ),
    'https://developers.openai.com/api/docs/models'
  );
  assert.equal(
    resolveDoubaoCitationUrl('https://example.com/report#section'),
    'https://example.com/report#section'
  );
  assert.equal(
    resolveDoubaoCitationUrl(
      'https://link.wtturl.cn/?target=javascript%3Aalert%281%29'
    ),
    null
  );
  assert.equal(
    resolveDoubaoCitationUrl(
      'https://link.wtturl.cn/?target=https%3A%2F%2Fuser%3Apass%40example.com%2F'
    ),
    null
  );
});

test('Doubao 检索候选只接受已验证搜索结果数组并拒绝任意深层 URL', () => {
  const page = new DoubaoWebPage({ connection: {} });
  const result = page.extractCandidatesFromJson({
    data: {
      search_results: [{
        url: 'https://example.com/accepted',
        title: '可信搜索结果'
      }]
    },
    arbitrary: {
      nested: {
        url: 'https://example.com/rejected',
        title: '无关链接'
      }
    }
  });

  assert.deepEqual(result, {
    candidates: [{
      url: 'https://example.com/accepted',
      title: '可信搜索结果'
    }],
    observed_count: 1
  });
});

test('Doubao interactive login verification rejects an explicit anonymous login page before checking mode', async () => {
  let modeChecks = 0;
  const doubaoPage = new DoubaoWebPage({ connection: {} }, { sleep: async () => {} });
  doubaoPage.callDocument = async () => ({ loginRequired: true });
  doubaoPage.verifyCaptureMode = async () => {
    modeChecks += 1;
    return { mode: 'standard', observed: true };
  };

  await assert.rejects(
    doubaoPage.verifyInteractiveLogin(),
    { code: 'web_login_required' }
  );
  assert.equal(modeChecks, 0);
});
