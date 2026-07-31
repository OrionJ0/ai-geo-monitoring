const { createHash } = require('node:crypto');
const selectors = require('../config/deepseekWebSelectors');
const {
  BROWSER_ANSWER_TREE_SERIALIZER,
  renderAnswerTree
} = require('./WebAnswerMarkdown');
const { repairMojibakeText } = require('./WebSourceText');

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_CAPTURE_METADATA_BYTES = 32 * 1024;
const MAX_NETWORK_BODY_BYTES = 2 * 1024 * 1024;
const MAX_NETWORK_RESPONSES = 50;
const MAX_PROVIDER_CITATIONS = 200;
const MAX_RETRIEVAL_CANDIDATES = 20;
const MAX_RETRIEVAL_TITLE_CHARS = 160;
const SCREENSHOT_COMMAND_TIMEOUT_MS = 45_000;
const SCREENSHOT_RETRY_DELAY_MS = 500;
const DEEPSEEK_WEB_IDENTITY = Object.freeze({
  platformCode: 'deepseek-web',
  modelName: 'deepseek-web-ui',
  displayName: 'DeepSeek Web',
  captureSchemaVersion: 'deepseek-web-capture-v1',
  selectorVersion: selectors.selectorVersion,
  pageOrigin: 'https://chat.deepseek.com',
  allowedOrigins: selectors.allowedOrigins,
  domCitationOrigin: 'deepseek_web_dom',
  networkCitationOrigin: 'deepseek_web_network'
});

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

function safeUrl(value, identity = DEEPSEEK_WEB_IDENTITY) {
  const text = String(value || '');
  if (text.length > 2048) throw adapterError('web_selector_mismatch', 'DeepSeek 页面地址无效');
  let url;
  try {
    url = new URL(text);
  } catch {
    throw adapterError('web_selector_mismatch', 'DeepSeek 页面地址无效');
  }
  if (!identity.allowedOrigins.includes(url.origin)) {
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
  if (
    !['http:', 'https:'].includes(parsed.protocol)
    || parsed.username
    || parsed.password
  ) return null;
  parsed.hash = '';
  const normalized = parsed.toString();
  return normalized.length <= 2048 ? normalized : null;
}

function isRetrievalCandidateUrl(url, identity) {
  if (identity.allowedOrigins.includes(url.origin)) return false;
  if (/\/(?:login|logout|sign-?in|register|feedback)(?:\/|$)/i.test(url.pathname)) {
    return false;
  }
  return !/\.(?:avif|bmp|css|gif|heic|ico|jpe?g|js|map|mjs|mp3|mp4|ogg|png|svg|ttf|wav|webm|webp|woff2?)(?:~|$)/i
    .test(url.pathname);
}

function citationDisplayIndex(value) {
  const matched = String(value || '').trim().match(/^(?:\[|【)?[-–—]?\s*(\d+)\s*(?:\]|】)?$/);
  if (!matched) return null;
  const parsed = Number(matched[1]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeProviderCitations(
  explicitCitations,
  retrievalCandidates,
  identity = DEEPSEEK_WEB_IDENTITY
) {
  const rows = [];
  const seen = new Set();
  const append = (item, sourceRole) => {
    if (rows.length >= MAX_PROVIDER_CITATIONS) return;
    const url = normalizeExternalUrl(item?.url);
    if (!url || seen.has(url)) return;
    const parsed = new URL(url);
    if (
      sourceRole === 'retrieval_candidate'
      && !isRetrievalCandidateUrl(parsed, identity)
    ) {
      return;
    }
    seen.add(url);
    const rawTitle = String(item?.title || '').replace(/\s+/g, ' ').trim();
    const displayIndex = Number.isSafeInteger(Number(item?.display_index))
      && Number(item.display_index) > 0
      ? Number(item.display_index)
      : citationDisplayIndex(rawTitle);
    const title = rawTitle && citationDisplayIndex(rawTitle) === null
      ? bounded(rawTitle, 500)
      : parsed.hostname.toLowerCase();
    rows.push({
      url,
      domain: parsed.hostname.toLowerCase(),
      title,
      ...(displayIndex ? { display_index: displayIndex } : {}),
      source_origin: sourceRole === 'explicit_citation'
        ? identity.domCitationOrigin
        : identity.networkCitationOrigin,
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
    this.identity = options.identity || DEEPSEEK_WEB_IDENTITY;
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

  isTransientAnswer() {
    return false;
  }

  async waitForFinalTurn(baselineIds, startedAt) {
    let stableText = null;
    let stableSince = null;
    let finalTurn = null;
    while (this.now() - startedAt <= this.timeoutMs) {
      const snapshot = await this.page.getConversationSnapshot();
      if (snapshot.verificationRequired === true) {
        throw adapterError(
          'web_verification_required',
          `${this.identity.displayName} 需要人工完成验证`,
          'generation_finished'
        );
      }
      if (snapshot.loginRequired === true) {
        throw adapterError(
          'web_login_required',
          `${this.identity.displayName} 需要重新人工登录`,
          'generation_finished'
        );
      }
      const newTurns = (snapshot.assistantTurns || []).filter(
        (turn) => !baselineIds.has(String(turn.id))
      );
      if (newTurns.length > 1) {
        throw adapterError(
          'web_selector_mismatch',
          `无法唯一识别当前${this.identity.displayName}回答`,
          'new_assistant_turn_seen'
        );
      }
      if (newTurns.length === 1) {
        const text = normalizeText(newTurns[0].text);
        if (text && !this.isTransientAnswer(text)) {
          finalTurn = {
            id: String(newTurns[0].id),
            text,
            answer_format: newTurns[0].answer_format === 'markdown_v1'
              ? 'markdown_v1'
              : 'plain_text'
          };
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
      `等待${this.identity.displayName}最终回答超时`,
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
      currentStage = 'capture_mode_verified';
      const captureMode = await this.page.verifyCaptureMode();
      if (captureMode?.observed !== true) {
        throw adapterError(
          captureMode?.error_code || 'web_search_state_unverified',
          captureMode?.error_message
            || `无法确认${this.identity.displayName}联网搜索已开启`,
          'capture_mode_verified'
        );
      }
      currentStage = 'capture_mode_evidence_saved';
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
      const generationStartedAt = this.now();
      currentStage = 'generation_finished';
      const finalTurn = await this.waitForFinalTurn(baselineIds, generationStartedAt);
      if (Buffer.byteLength(finalTurn.text, 'utf8') > MAX_RESPONSE_BYTES) {
        throw adapterError(
          'web_response_too_large',
          `${this.identity.displayName}回答超过保存上限`,
          'content_extracted'
        );
      }
      currentStage = 'content_extracted';
      const explicitCitations = await this.page.extractCitations(finalTurn.id);
      const retrievalObservation = await this.page.collectRetrievalCandidates?.() || [];
      const retrievalCandidates = Array.isArray(retrievalObservation)
        ? retrievalObservation
        : Array.isArray(retrievalObservation.candidates)
          ? retrievalObservation.candidates
          : [];
      const configuredSearchObserved = captureMode.search_observed === undefined
        ? captureMode.observed
        : captureMode.search_observed;
      const searchObserved = configuredSearchObserved == null
        && retrievalCandidates.length > 0
        ? true
        : configuredSearchObserved;
      const searchEvidenceType = configuredSearchObserved == null
        && retrievalCandidates.length > 0
        ? 'network_retrieval_candidates'
        : captureMode.evidence_type || 'dom_selected_state';
      const providerCitations = normalizeProviderCitations(
        explicitCitations,
        retrievalCandidates,
        this.identity
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
        schema_version: this.identity.captureSchemaVersion,
        selector_version: this.identity.selectorVersion,
        status: 'completed',
        answer_format: finalTurn.answer_format,
        artifact_owner_record_id: captureOwner.record_id,
        page_origin: this.identity.pageOrigin,
        page_url: safeUrl(metadata.pageUrl, this.identity),
        started_at: safeIso(startedAt),
        completed_at: safeIso(completedAt),
        captured_at: safeIso(completedAt),
        response_sha256: createHash('sha256').update(finalTurn.text).digest('hex'),
        capture_mode: {
          name: bounded(captureMode.mode || 'web_search', 40),
          observed: true,
          evidence_type: bounded(
            captureMode.evidence_type || 'dom_selected_state',
            80
          )
        },
        search: {
          requested: captureMode.search_requested ?? captureMode.requested ?? true,
          observed: searchObserved,
          evidence_type: bounded(
            searchEvidenceType,
            80
          ),
          ...(!Array.isArray(retrievalObservation) && retrievalObservation.observation
            ? { candidate_observation: retrievalObservation.observation }
            : {})
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
          `${this.identity.displayName}采集元数据超过保存上限`,
          'final_evidence_saved'
        );
      }
      return {
        success: true,
        platform: this.identity.platformCode,
        model_name: this.identity.modelName,
        text: finalTurn.text,
        answer_format: finalTurn.answer_format,
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
    this.identity = options.identity || DEEPSEEK_WEB_IDENTITY;
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
      if (responseUrl.origin !== this.identity.pageOrigin) return;
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
    const paths = this.identity.platformCode === 'doubao-web'
      ? [
          ['data', 'search_results'],
          ['data', 'sources'],
          ['result', 'search_results']
        ]
      : [
          ['data', 'sources'],
          ['data', 'search_results'],
          ['result', 'sources']
        ];
    const getPath = (root, path) => path.reduce(
      (current, key) => current && typeof current === 'object' ? current[key] : undefined,
      root
    );
    const candidates = [];
    let observedCount = 0;
    for (const path of paths) {
      const rows = getPath(value, path);
      if (!Array.isArray(rows)) continue;
      observedCount += rows.length;
      for (const item of rows) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const urlKey = ['url', 'link', 'href', 'source_url']
          .find((key) => typeof item[key] === 'string');
        const titleKey = ['title', 'name', 'site_name']
          .find((key) => typeof item[key] === 'string');
        if (!urlKey || !titleKey) continue;
        candidates.push({ url: item[urlKey], title: item[titleKey] });
      }
    }
    return { candidates, observed_count: observedCount };
  }

  parseNetworkBody(buffer, mimeType) {
    const text = buffer.toString('utf8');
    const parsedRows = [];
    if (mimeType === 'text/event-stream') {
      parsedRows.push(...text
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .filter((line) => line && line !== '[DONE]')
        .flatMap((line) => {
          try {
            return [this.extractCandidatesFromJson(JSON.parse(line))];
          } catch {
            return [];
          }
        }));
    } else {
      try {
        parsedRows.push(this.extractCandidatesFromJson(JSON.parse(text)));
      } catch {
        return { candidates: [], observed_count: 0 };
      }
    }
    return {
      candidates: parsedRows.flatMap((item) => item.candidates),
      observed_count: parsedRows.reduce(
        (total, item) => total + Number(item.observed_count || 0),
        0
      )
    };
  }

  async collectRetrievalCandidates() {
    const observation = this.networkObservation;
    await this.stopNetworkObservation();
    if (!observation) {
      return {
        candidates: [],
        observation: {
          observed_count: 0,
          accepted_count: 0,
          dropped_count: 0,
          truncated: false
        }
      };
    }
    const rawCandidates = [];
    let observedCount = 0;
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
      const parsed = this.parseNetworkBody(buffer, metadata.mimeType);
      observedCount += parsed.observed_count;
      rawCandidates.push(...parsed.candidates);
    }
    const candidates = [];
    const seen = new Set();
    let truncated = false;
    for (const item of rawCandidates) {
      const url = normalizeExternalUrl(item?.url);
      const rawTitle = String(item?.title || '').replace(/\s+/g, ' ').trim();
      if (!url || !rawTitle || rawTitle.length > MAX_RETRIEVAL_TITLE_CHARS) continue;
      const parsedUrl = new URL(url);
      if (!isRetrievalCandidateUrl(parsedUrl, this.identity) || seen.has(url)) continue;
      if (candidates.length >= MAX_RETRIEVAL_CANDIDATES) {
        truncated = true;
        continue;
      }
      seen.add(url);
      candidates.push({
        url,
        title: repairMojibakeText(rawTitle).slice(0, MAX_RETRIEVAL_TITLE_CHARS)
      });
    }
    return {
      candidates,
      observation: {
        observed_count: observedCount,
        accepted_count: candidates.length,
        dropped_count: Math.max(0, observedCount - candidates.length),
        truncated
      }
    };
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

  async verifyCaptureMode() {
    const search = await this.ensureSearchEnabled();
    return {
      ...search,
      mode: 'web_search',
      search_requested: true,
      search_observed: search?.observed === true
    };
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

  async captureScreenshot({ fromSurface = false } = {}) {
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
    let screenshot;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        screenshot = await this.connection.send('Page.captureScreenshot', {
          format: 'png',
          fromSurface: attempt === 0 ? fromSurface : false,
          captureBeyondViewport: false,
          clip
        }, {
          timeoutMs: SCREENSHOT_COMMAND_TIMEOUT_MS
        });
        break;
      } catch (error) {
        if (error?.code !== 'renderer_timeout' || attempt > 0) throw error;
        await this.sleep(SCREENSHOT_RETRY_DELAY_MS);
      }
    }
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
    const verificationMarkers = JSON.stringify(selectors.verificationMarkers);
    const loginMarkers = JSON.stringify(selectors.loginMarkers);
    const snapshot = await this.evaluate(`(() => {
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      };
      ${BROWSER_ANSWER_TREE_SERIALIZER}
      const hasVisibleMatch = (selectors) => selectors.some((selector) => (
        Array.from(document.querySelectorAll(selector)).some(visible)
      ));
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
          text: String(element.innerText || element.textContent || '').trim(),
          serialized_answer: serializeAnswerTree(element)
        })),
        generationActive,
        busy,
        verificationRequired: hasVisibleMatch(${verificationMarkers}),
        loginRequired: hasVisibleMatch(${loginMarkers})
      };
    })()`);
    const assistantTurns = (snapshot?.assistantTurns || []).map((turn) => {
      if (!turn?.serialized_answer) return turn;
      if (turn.serialized_answer.truncated === true) {
        throw adapterError('web_response_too_large', 'DeepSeek 回答超过结构化采集上限');
      }
      const markdown = renderAnswerTree(turn.serialized_answer.tree);
      return {
        id: String(turn.id || ''),
        text: markdown || normalizeText(turn.text),
        answer_format: markdown ? 'markdown_v1' : 'plain_text'
      };
    });
    return { ...snapshot, assistantTurns };
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
        const visibleTitle = String(anchor.textContent || '')
          .replace(/\\s+/g, ' ').trim();
        const metadataTitle = [
          anchor.getAttribute('data-title'),
          anchor.getAttribute('title'),
          anchor.getAttribute('aria-label')
        ].map((value) => String(value || '').replace(/\\s+/g, ' ').trim())
          .find((value) => value && !/^(?:\\[|【)?[-–—]?\\s*\\d+\\s*(?:\\]|】)?$/.test(value));
        const marker = visibleTitle.match(/^(?:\\[|【)?[-–—]?\\s*(\\d+)\\s*(?:\\]|】)?$/);
        rows.push({
          url: url.href,
          domain: url.hostname.toLowerCase(),
          title: String(metadataTitle || visibleTitle || url.hostname).slice(0, 300),
          ...(marker ? { display_index: Number(marker[1]) } : {}),
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
