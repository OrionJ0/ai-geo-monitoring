const { createHash } = require('node:crypto');
const selectors = require('../config/deepseekWebSelectors');

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_CAPTURE_METADATA_BYTES = 32 * 1024;
const MAX_NETWORK_BODY_BYTES = 2 * 1024 * 1024;
const MAX_NETWORK_RESPONSES = 50;
const MAX_PROVIDER_CITATIONS = 200;

function adapterError(code, message, stage = null) {
  const error = new Error(message);
  error.code = code;
  if (stage) error.stage = stage;
  return error;
}

function normalizeText(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function safeIso(value) {
  return new Date(value).toISOString();
}

function safeUrl(value) {
  const text = String(value || '');
  if (text.length > 2048) throw adapterError('web_selector_mismatch', 'DeepSeek 页面地址无效');
  let url;
  try {
    url = new URL(text);
  } catch {
    throw adapterError('web_selector_mismatch', 'DeepSeek 页面地址无效');
  }
  if (!selectors.allowedOrigins.includes(url.origin)) {
    throw adapterError('web_selector_mismatch', 'DeepSeek 页面来源不匹配');
  }
  return url.toString();
}

function bounded(value, max) {
  return String(value || '').slice(0, max);
}

function normalizeExternalUrl(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 2048) return null;
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  parsed.hash = '';
  const normalized = parsed.toString();
  return normalized.length <= 2048 ? normalized : null;
}

function normalizeProviderCitations(explicitCitations, retrievalCandidates) {
  const rows = [];
  const seen = new Set();
  const append = (item, sourceRole) => {
    if (rows.length >= MAX_PROVIDER_CITATIONS) return;
    const url = normalizeExternalUrl(item?.url);
    if (!url || seen.has(url)) return;
    const parsed = new URL(url);
    seen.add(url);
    rows.push({
      url,
      domain: parsed.hostname.toLowerCase(),
      ...(String(item?.title || '').trim()
        ? { title: bounded(String(item.title).replace(/\s+/g, ' ').trim(), 500) }
        : {}),
      source_origin: sourceRole === 'explicit_citation'
        ? 'deepseek_web_dom'
        : 'deepseek_web_network',
      source_role: sourceRole
    });
  };
  (Array.isArray(explicitCitations) ? explicitCitations : [])
    .forEach((item) => append(item, 'explicit_citation'));
  (Array.isArray(retrievalCandidates) ? retrievalCandidates : [])
    .forEach((item) => append(item, 'retrieval_candidate'));
  return rows;
}

class DeepSeekWebAdapter {
  constructor(options) {
    this.page = options.page;
    this.captureStore = options.captureStore;
    this.now = options.now || (() => Date.now());
    this.sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.pollMs = options.pollMs ?? 500;
    this.stableMs = options.stableMs ?? 3000;
    this.timeoutMs = options.timeoutMs ?? 180_000;
  }

  validateOwner(owner) {
    const recordId = Number(owner?.record_id);
    const userId = Number(owner?.user_id);
    const projectId = owner?.project_id == null ? null : Number(owner.project_id);
    if (
      !Number.isSafeInteger(recordId)
      || recordId <= 0
      || !Number.isSafeInteger(userId)
      || userId <= 0
      || (projectId !== null && (!Number.isSafeInteger(projectId) || projectId <= 0))
    ) {
      throw adapterError('web_capture_owner_missing', 'Web 查询缺少有效记录归属', 'preflight');
    }
    return { record_id: recordId, user_id: userId, project_id: projectId };
  }

  async waitForFinalTurn(baselineIds, startedAt) {
    let stableText = null;
    let stableSince = null;
    let finalTurn = null;
    while (this.now() - startedAt <= this.timeoutMs) {
      const snapshot = await this.page.getConversationSnapshot();
      const newTurns = (snapshot.assistantTurns || []).filter(
        (turn) => !baselineIds.has(String(turn.id))
      );
      if (newTurns.length > 1) {
        throw adapterError(
          'web_selector_mismatch',
          '无法唯一识别当前 DeepSeek 回答',
          'new_assistant_turn_seen'
        );
      }
      if (newTurns.length === 1) {
        const text = normalizeText(newTurns[0].text);
        if (text) {
          finalTurn = { id: String(newTurns[0].id), text };
          if (text !== stableText) {
            stableText = text;
            stableSince = this.now();
          }
          if (
            snapshot.generationActive === false
            && snapshot.busy === false
            && this.now() - stableSince >= this.stableMs
          ) {
            return finalTurn;
          }
        }
      }
      await this.sleep(this.pollMs);
    }
    throw adapterError(
      'web_generation_timeout',
      '等待 DeepSeek Web 最终回答超时',
      'generation_finished'
    );
  }

  async capture(question, owner) {
    const captureOwner = this.validateOwner(owner);
    const prompt = String(question || '');
    if (!prompt.trim()) throw adapterError('web_prompt_invalid', 'Web 查询问题不能为空');
    const startedAt = this.now();
    let capture;
    let currentStage = 'capture_started';
    try {
      capture = await this.captureStore.beginCapture(captureOwner);
      currentStage = 'session_ready_checked';
      await this.page.assertReady();
      currentStage = 'new_conversation_verified';
      await this.page.startNewConversation();
      const initial = await this.page.getConversationSnapshot();
      if ((initial.assistantTurns || []).length !== 0) {
        throw adapterError(
          'web_selector_mismatch',
          '新对话仍包含旧回答区域',
          'new_conversation_verified'
        );
      }
      currentStage = 'search_enabled_verified';
      const search = await this.page.ensureSearchEnabled();
      if (search?.observed !== true) {
        throw adapterError(
          'web_search_state_unverified',
          '无法确认 DeepSeek 智能搜索已开启',
          'search_enabled_verified'
        );
      }
      currentStage = 'search_evidence_saved';
      const searchScreenshot = await this.page.captureScreenshot('search_state');
      await this.captureStore.writeArtifact(
        capture,
        'search_state',
        searchScreenshot.buffer,
        searchScreenshot
      );
      currentStage = 'prompt_inserted';
      await this.page.insertPrompt(prompt);
      const beforeSend = await this.page.getConversationSnapshot();
      const baselineIds = new Set(
        (beforeSend.assistantTurns || []).map((turn) => String(turn.id))
      );
      currentStage = 'prompt_sent';
      await this.page.startNetworkObservation?.();
      await this.page.sendPrompt();
      currentStage = 'generation_finished';
      const finalTurn = await this.waitForFinalTurn(baselineIds, startedAt);
      if (Buffer.byteLength(finalTurn.text, 'utf8') > MAX_RESPONSE_BYTES) {
        throw adapterError(
          'web_response_too_large',
          'DeepSeek Web 回答超过保存上限',
          'content_extracted'
        );
      }
      currentStage = 'content_extracted';
      const explicitCitations = await this.page.extractCitations(finalTurn.id);
      const retrievalCandidates = await this.page.collectRetrievalCandidates?.() || [];
      const providerCitations = normalizeProviderCitations(
        explicitCitations,
        retrievalCandidates
      );
      currentStage = 'final_evidence_saved';
      const finalScreenshot = await this.page.captureScreenshot('final_answer');
      await this.captureStore.writeArtifact(
        capture,
        'final_answer',
        finalScreenshot.buffer,
        finalScreenshot
      );
      const promoted = await this.captureStore.promoteCapture(capture);
      const metadata = await this.page.getMetadata();
      const completedAt = this.now();
      const webCapture = {
        schema_version: 'deepseek-web-capture-v1',
        selector_version: selectors.selectorVersion,
        status: 'completed',
        artifact_owner_record_id: captureOwner.record_id,
        page_origin: 'https://chat.deepseek.com',
        page_url: safeUrl(metadata.pageUrl),
        started_at: safeIso(startedAt),
        completed_at: safeIso(completedAt),
        captured_at: safeIso(completedAt),
        response_sha256: createHash('sha256').update(finalTurn.text).digest('hex'),
        search: {
          requested: true,
          observed: true,
          evidence_type: bounded(search.evidence_type || 'dom_selected_state', 80)
        },
        completion: {
          state: 'stable',
          stable_ms: this.stableMs,
          new_assistant_turn: true,
          generation_control_absent: true
        },
        browser: {
          product: bounded(metadata.browser?.product || 'Chrome', 80),
          version: bounded(metadata.browser?.version, 80),
          user_agent: bounded(metadata.browser?.user_agent, 512),
          locale: bounded(metadata.browser?.locale, 80),
          timezone_offset_minutes: Number(metadata.browser?.timezone_offset_minutes) || 0,
          viewport: metadata.browser?.viewport || {}
        },
        client: {
          platform: bounded(metadata.client?.platform || 'web', 80),
          version: bounded(metadata.client?.version, 80),
          bundle_id: bounded(metadata.client?.bundle_id, 80)
        },
        artifacts: promoted.artifacts
      };
      if (Buffer.byteLength(JSON.stringify(webCapture), 'utf8') > MAX_CAPTURE_METADATA_BYTES) {
        throw adapterError(
          'web_capture_metadata_too_large',
          'DeepSeek Web 采集元数据超过保存上限',
          'final_evidence_saved'
        );
      }
      return {
        success: true,
        platform: 'deepseek-web',
        model_name: 'deepseek-web-ui',
        text: finalTurn.text,
        data: {},
        provider_citations: providerCitations,
        web_capture: webCapture
      };
    } catch (error) {
      await this.page.stopNetworkObservation?.();
      if (capture) await this.captureStore.discardCapture(capture);
      if (!error.stage) error.stage = currentStage;
      throw error;
    }
  }
}

class DeepSeekWebPage {
  constructor(session, options = {}) {
    this.session = session;
    this.connection = session.connection;
    this.sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.networkObservation = null;
  }

  async evaluate(expression) {
    const evaluation = await this.connection.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (evaluation.exceptionDetails) {
      throw adapterError('web_selector_mismatch', 'DeepSeek 页面探针执行失败');
    }
    return evaluation.result?.value;
  }

  async callDocument(functionDeclaration, args = []) {
    const documentHandle = await this.connection.send('Runtime.evaluate', {
      expression: 'document',
      returnByValue: false
    });
    const result = await this.connection.send('Runtime.callFunctionOn', {
      objectId: documentHandle.result.objectId,
      functionDeclaration,
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
      awaitPromise: true
    });
    if (result.exceptionDetails) {
      throw adapterError('web_selector_mismatch', 'DeepSeek 页面交互失败');
    }
    return result.result?.value;
  }

  async startNetworkObservation() {
    await this.stopNetworkObservation();
    const responses = new Map();
    const off = this.connection.on('Network.responseReceived', (event) => {
      if (responses.size >= MAX_NETWORK_RESPONSES) return;
      if (!['Fetch', 'XHR'].includes(String(event?.type || ''))) return;
      const response = event?.response || {};
      let responseUrl;
      try {
        responseUrl = new URL(String(response.url || ''));
      } catch {
        return;
      }
      if (responseUrl.origin !== 'https://chat.deepseek.com') return;
      const mimeType = String(response.mimeType || '').toLowerCase();
      if (
        mimeType !== 'application/json'
        && !mimeType.endsWith('+json')
        && mimeType !== 'text/event-stream'
      ) {
        return;
      }
      const encodedBytes = Number(response.encodedDataLength) || 0;
      if (encodedBytes > MAX_NETWORK_BODY_BYTES) return;
      const requestId = String(event?.requestId || '');
      if (!requestId) return;
      responses.set(requestId, { mimeType });
    });
    try {
      await this.connection.send('Network.enable', {
        maxTotalBufferSize: MAX_NETWORK_BODY_BYTES,
        maxResourceBufferSize: MAX_NETWORK_BODY_BYTES,
        maxPostDataSize: 0
      });
    } catch (error) {
      off();
      throw error;
    }
    this.networkObservation = { responses, off };
  }

  async stopNetworkObservation() {
    if (!this.networkObservation) return;
    this.networkObservation.off();
    this.networkObservation = null;
  }

  extractCandidatesFromJson(value) {
    const rows = [];
    let visited = 0;
    const visit = (node, depth = 0) => {
      if (depth > 12 || visited >= 10_000 || rows.length >= MAX_PROVIDER_CITATIONS) return;
      visited += 1;
      if (Array.isArray(node)) {
        node.forEach((item) => visit(item, depth + 1));
        return;
      }
      if (!node || typeof node !== 'object') return;
      const urlKey = ['url', 'link', 'href', 'source_url']
        .find((key) => typeof node[key] === 'string');
      if (urlKey) {
        const titleKey = ['title', 'name', 'site_name']
          .find((key) => typeof node[key] === 'string');
        rows.push({
          url: node[urlKey],
          ...(titleKey ? { title: node[titleKey] } : {})
        });
      }
      Object.values(node).forEach((item) => visit(item, depth + 1));
    };
    visit(value);
    return rows;
  }

  parseNetworkBody(buffer, mimeType) {
    const text = buffer.toString('utf8');
    if (mimeType === 'text/event-stream') {
      return text
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .filter((line) => line && line !== '[DONE]')
        .flatMap((line) => {
          try {
            return this.extractCandidatesFromJson(JSON.parse(line));
          } catch {
            return [];
          }
        });
    }
    try {
      return this.extractCandidatesFromJson(JSON.parse(text));
    } catch {
      return [];
    }
  }

  async collectRetrievalCandidates() {
    const observation = this.networkObservation;
    await this.stopNetworkObservation();
    if (!observation) return [];
    const candidates = [];
    for (const [requestId, metadata] of observation.responses) {
      let responseBody;
      try {
        responseBody = await this.connection.send('Network.getResponseBody', { requestId });
      } catch {
        continue;
      }
      const buffer = responseBody?.base64Encoded
        ? Buffer.from(String(responseBody.body || ''), 'base64')
        : Buffer.from(String(responseBody?.body || ''), 'utf8');
      if (!buffer.length || buffer.length > MAX_NETWORK_BODY_BYTES) continue;
      candidates.push(...this.parseNetworkBody(buffer, metadata.mimeType));
      if (candidates.length >= MAX_PROVIDER_CITATIONS) break;
    }
    return candidates.slice(0, MAX_PROVIDER_CITATIONS);
  }

  async assertReady() {
    let probe;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      probe = await this.session.probe();
      if (
        probe?.status === 'ready'
        && probe?.origin === 'https://chat.deepseek.com'
        && Number(probe.composerCount) === 1
      ) {
        return probe;
      }
      if (probe?.status === 'login_required') {
        throw adapterError('web_login_required', 'DeepSeek Web 需要重新人工登录');
      }
      if (probe?.status === 'verification_required') {
        throw adapterError('web_verification_required', 'DeepSeek Web 需要人工完成验证');
      }
      await this.sleep(250);
    }
    throw adapterError('web_selector_mismatch', 'DeepSeek 页面结构不匹配');
  }

  async startNewConversation() {
    let clicked = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      clicked = await this.callDocument(`function() {
        const visible = (element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none'
            && style.visibility !== 'hidden'
            && rect.width > 0
            && rect.height > 0;
        };
        const exact = (element) => String(element.textContent || '')
          .replace(/\\s+/g, ' ').trim() === '开启新对话';
        const labels = Array.from(this.querySelectorAll('div, span')).filter(
          (element) => visible(element) && exact(element)
        );
        const controls = [];
        for (const label of labels) {
          let exactRoot = label;
          while (exactRoot.parentElement && exact(exactRoot.parentElement)) {
            exactRoot = exactRoot.parentElement;
          }
          let control = exactRoot.closest('button, [role="button"]');
          if (!control) {
            const style = getComputedStyle(exactRoot);
            if (
              style.cursor === 'pointer'
              || exactRoot.hasAttribute('onclick')
              || exactRoot.hasAttribute('tabindex')
            ) {
              control = exactRoot;
            }
          }
          if (control && !controls.includes(control)) controls.push(control);
        }
        if (controls.length !== 1) return { ok: false, count: controls.length };
        controls[0].click();
        return { ok: true, count: 1 };
      }`);
      if (clicked?.ok) break;
      await this.sleep(250);
    }
    if (!clicked?.ok) {
      throw adapterError('web_selector_mismatch', '无法唯一识别 DeepSeek 新对话控件');
    }
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await this.sleep(250);
      const state = await this.evaluate(`(() => ({
        pathname: location.pathname,
        assistantCount: document.querySelectorAll(
          '.ds-markdown.ds-assistant-message-main-content'
        ).length
      }))()`);
      if (state?.pathname === '/' && Number(state.assistantCount) === 0) {
        return { pageUrl: 'https://chat.deepseek.com/' };
      }
    }
    throw adapterError('web_selector_mismatch', 'DeepSeek 新对话未进入空白状态');
  }

  async ensureSearchEnabled() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const state = await this.callDocument(`function(allowClick) {
        const visible = (element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none'
            && style.visibility !== 'hidden'
            && rect.width > 0
            && rect.height > 0;
        };
        const labels = Array.from(this.querySelectorAll('div, span'))
          .filter((element) => visible(element))
          .filter((element) => String(element.textContent || '')
            .replace(/\\s+/g, ' ').trim() === '智能搜索');
        const controls = [];
        for (const label of labels) {
          const control = label.closest('[aria-pressed], button, [role="button"]')
            || label.parentElement;
          if (control && !controls.includes(control)) controls.push(control);
        }
        if (controls.length !== 1) return { observed: false, count: controls.length };
        const control = controls[0];
        const selected = control.getAttribute('aria-pressed') === 'true'
          || /(?:^|\\s)ds-toggle-button--selected(?:\\s|$)/.test(control.className);
        if (!selected && allowClick) control.click();
        return { observed: selected, count: 1 };
      }`, [attempt === 0]);
      if (state?.observed) {
        return { requested: true, observed: true, evidence_type: 'dom_selected_state' };
      }
      await this.sleep(250);
    }
    return { requested: true, observed: false };
  }

  async captureScreenshot() {
    const clip = await this.evaluate(`(() => {
      const composer = document.querySelector(
        'textarea:not([disabled]), [contenteditable="true"][role="textbox"]'
      );
      const candidates = [];
      for (let node = composer; node; node = node.parentElement) {
        const rect = node.getBoundingClientRect();
        if (
          rect.width >= innerWidth * 0.45
          && rect.width <= innerWidth * 0.9
          && rect.x >= innerWidth * 0.08
        ) {
          candidates.push(rect);
        }
      }
      const rect = candidates.at(-1);
      const x = rect ? Math.max(0, rect.x) : Math.round(innerWidth * 0.22);
      const width = rect
        ? Math.min(innerWidth - x, rect.width)
        : Math.round(innerWidth * 0.78);
      return {
        x,
        y: 0,
        width: Math.max(1, width),
        height: Math.max(1, innerHeight),
        scale: 1
      };
    })()`);
    const screenshot = await this.connection.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
      clip
    });
    const buffer = Buffer.from(String(screenshot.data || ''), 'base64');
    if (!buffer.length) throw adapterError('web_screenshot_failed', 'DeepSeek 页面截图失败');
    return {
      buffer,
      width: Math.round(clip.width),
      height: Math.round(clip.height)
    };
  }

  async insertPrompt(question) {
    const inserted = await this.callDocument(`function(value) {
      const composers = Array.from(this.querySelectorAll(
        'textarea:not([disabled]), [contenteditable="true"][role="textbox"]'
      )).filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      });
      if (composers.length !== 1) return false;
      const composer = composers[0];
      if (composer.tagName === 'TEXTAREA') {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value'
        ).set;
        setter.call(composer, value);
        composer.dispatchEvent(new Event('input', { bubbles: true }));
        composer.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        composer.textContent = value;
        composer.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: value
        }));
      }
      composer.focus();
      return true;
    }`, [String(question)]);
    if (!inserted) throw adapterError('web_selector_mismatch', '无法唯一识别 DeepSeek 输入区');
  }

  async sendPrompt() {
    for (const type of ['keyDown', 'keyUp']) {
      await this.connection.send('Input.dispatchKeyEvent', {
        type,
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13
      });
    }
  }

  async getConversationSnapshot() {
    return this.evaluate(`(() => {
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      };
      const turns = Array.from(document.querySelectorAll(
        '.ds-markdown.ds-assistant-message-main-content'
      )).filter(visible);
      const generationActive = Array.from(document.querySelectorAll(
        'button, [role="button"]'
      )).filter(visible).some((element) => /停止|中止|stop/i.test(
        [
          element.textContent,
          element.getAttribute('aria-label'),
          element.getAttribute('title')
        ].filter(Boolean).join(' ')
      ));
      const busy = Boolean(document.querySelector('[aria-busy="true"]'));
      return {
        assistantTurns: turns.map((element, index) => ({
          id: 'assistant-' + index,
          text: String(element.innerText || element.textContent || '').trim()
        })),
        generationActive,
        busy
      };
    })()`);
  }

  async extractCitations(turnId) {
    const index = Number(String(turnId).replace(/^assistant-/, ''));
    if (!Number.isSafeInteger(index) || index < 0) {
      throw adapterError('web_selector_mismatch', 'DeepSeek 回答标识无效');
    }
    return this.callDocument(`function(turnIndex) {
      const turns = Array.from(this.querySelectorAll(
        '.ds-markdown.ds-assistant-message-main-content'
      ));
      const turn = turns[turnIndex];
      if (!turn) return [];
      const seen = new Set();
      const rows = [];
      for (const anchor of turn.querySelectorAll('a[href]')) {
        let url;
        try {
          url = new URL(anchor.href);
        } catch {
          continue;
        }
        if (!['http:', 'https:'].includes(url.protocol) || seen.has(url.href)) continue;
        seen.add(url.href);
        rows.push({
          url: url.href,
          domain: url.hostname.toLowerCase(),
          title: String(anchor.textContent || url.hostname).replace(/\\s+/g, ' ').trim().slice(0, 300),
          source_origin: 'deepseek_web_dom',
          source_role: 'explicit_citation'
        });
        if (rows.length >= 200) break;
      }
      return rows;
    }`, [index]);
  }

  async getMetadata() {
    const [browserVersion, page] = await Promise.all([
      this.connection.send('Browser.getVersion'),
      this.evaluate(`(() => ({
        pageUrl: location.href,
        userAgent: navigator.userAgent,
        locale: navigator.language,
        timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
        viewport: {
          width: innerWidth,
          height: innerHeight,
          device_scale_factor: devicePixelRatio
        }
      }))()`)
    ]);
    const product = String(browserVersion.product || 'Chrome/');
    const [productName, version] = product.split('/');
    return {
      pageUrl: page.pageUrl,
      browser: {
        product: productName || 'Chrome',
        version: version || '',
        user_agent: page.userAgent,
        locale: page.locale,
        timezone_offset_minutes: page.timezoneOffsetMinutes,
        viewport: page.viewport
      },
      client: {
        platform: 'web',
        version: '',
        bundle_id: 'com.deepseek.chat'
      }
    };
  }
}

module.exports = {
  DeepSeekWebAdapter,
  DeepSeekWebPage,
  adapterError
};
