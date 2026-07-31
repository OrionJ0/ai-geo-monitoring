const selectors = require('../config/doubaoWebSelectors');
const {
  DeepSeekWebAdapter,
  DeepSeekWebPage,
  adapterError
} = require('./DeepSeekWebAdapter');
const {
  BROWSER_ANSWER_TREE_SERIALIZER,
  renderAnswerTree
} = require('./WebAnswerMarkdown');

const DOUBAO_WEB_IDENTITY = Object.freeze({
  platformCode: 'doubao-web',
  modelName: 'doubao-web-ui',
  displayName: '豆包 Web',
  captureSchemaVersion: 'doubao-web-capture-v1',
  selectorVersion: selectors.selectorVersion,
  pageOrigin: 'https://www.doubao.com',
  allowedOrigins: selectors.allowedOrigins,
  domCitationOrigin: 'doubao_web_dom',
  networkCitationOrigin: 'doubao_web_network'
});
const DOUBAO_RENDERED_BLOCK_SELECTOR = selectors.message.renderedBlock.join(', ');
const DOUBAO_SEARCH_BLOCK_SELECTOR = selectors.search.resultBlock;

function resolveDoubaoCitationUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    return null;
  }
  if (parsed.hostname.toLowerCase() === 'link.wtturl.cn') {
    const target = parsed.searchParams.get('target');
    if (!target) return null;
    try {
      parsed = new URL(target);
    } catch {
      return null;
    }
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol)
    || parsed.username
    || parsed.password
  ) {
    return null;
  }
  return parsed.toString();
}

class DoubaoWebAdapter extends DeepSeekWebAdapter {
  constructor(options) {
    super({ ...options, identity: DOUBAO_WEB_IDENTITY });
  }

  isTransientAnswer(text) {
    const normalized = String(text || '').replace(/\s+/g, '').trim();
    return /^(?:(?:正在)?(?:联网)?搜索(?:中)?|(?:正在)?(?:思考|生成|分析)(?:中)?)[.…·]*$/.test(normalized)
      || /^搜索\d+个关键词[，,]参考\d+篇资料/.test(normalized);
  }
}

class DoubaoWebPage extends DeepSeekWebPage {
  constructor(session, options = {}) {
    super(session, { ...options, identity: DOUBAO_WEB_IDENTITY });
  }

  async captureScreenshot() {
    return super.captureScreenshot({ fromSurface: false });
  }

  async assertReady() {
    let probe;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      probe = await this.session.probe();
      if (
        probe?.status === 'ready'
        && probe?.origin === DOUBAO_WEB_IDENTITY.pageOrigin
        && Number(probe.composerCount) === 1
      ) {
        return probe;
      }
      if (probe?.status === 'login_required') {
        throw adapterError('web_login_required', '豆包 Web 需要重新人工登录');
      }
      if (probe?.status === 'verification_required') {
        throw adapterError('web_verification_required', '豆包 Web 需要人工完成验证');
      }
      await this.sleep(250);
    }
    throw adapterError('web_selector_mismatch', '豆包页面结构不匹配');
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
          .replace(/\\s+/g, ' ').trim() === '新对话';
        const labels = Array.from(this.querySelectorAll('div, span'))
          .filter((element) => visible(element) && exact(element));
        const controls = [];
        for (const label of labels) {
          let exactRoot = label;
          while (exactRoot.parentElement && exact(exactRoot.parentElement)) {
            exactRoot = exactRoot.parentElement;
          }
          const control = exactRoot.closest(
            'a[href="/chat/"], button, [role="button"], [tabindex], .cursor-pointer'
          );
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
      throw adapterError('web_selector_mismatch', '无法唯一识别豆包新对话控件');
    }
    const blankPath = String(selectors.newConversationControl.blankUrlPath || '/chat')
      .replace(/\/+$/, '') || '/';
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await this.sleep(250);
      const state = await this.evaluate(`(() => ({
        pathname: location.pathname,
        assistantCount: Array.from(document.querySelectorAll('[data-message-id]'))
          .filter((element) => !element.classList.contains('justify-end'))
          .filter((element) => element.querySelector(
            ${JSON.stringify(DOUBAO_RENDERED_BLOCK_SELECTOR)}
          ))
          .length
      }))()`);
      const pathname = String(state?.pathname || '').replace(/\/+$/, '') || '/';
      if (pathname === blankPath && Number(state.assistantCount) === 0) {
        return { pageUrl: 'https://www.doubao.com/chat/' };
      }
    }
    throw adapterError('web_selector_mismatch', '豆包新对话未进入空白状态');
  }

  async verifyInteractiveLogin() {
    const login = await this.callDocument(`function(loginMarkers) {
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      };
      const explicitLoginButton = Array.from(
        this.querySelectorAll('button,[role="button"],a')
      )
        .filter(visible)
        .some((element) => String(element.textContent || '')
          .replace(/\\s+/g, ' ').trim() === '登录');
      const loginForm = loginMarkers.some((selector) => (
        Array.from(this.querySelectorAll(selector)).some(visible)
      ));
      return { loginRequired: explicitLoginButton || loginForm };
    }`, [selectors.loginMarkers]);
    if (login?.loginRequired) {
      throw adapterError('web_login_required', '豆包 Web 需要重新人工登录');
    }
    const captureMode = await this.verifyCaptureMode();
    if (captureMode?.observed === true) return captureMode;
    throw adapterError('web_capture_mode_unverified', '无法确认豆包普通模式');
  }

  async verifyCaptureMode() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const state = await this.callDocument(
        `function(allowClick, selectedSelectors, actionSelector) {
        const visible = (element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none'
            && style.visibility !== 'hidden'
            && rect.width > 0
            && rect.height > 0;
        };
        const selected = Array.from(this.querySelectorAll(
          selectedSelectors.join(', ')
        )).filter(visible);
        const actions = Array.from(
          this.querySelectorAll(actionSelector)
        ).filter(visible);
        if (selected.length === 0) {
          return { observed: true, selectedCount: 0, actionCount: actions.length };
        }
        if (selected.length === 1 && actions.length === 1 && allowClick) {
          actions[0].click();
        }
        return {
          observed: false,
          selectedCount: selected.length,
          actionCount: actions.length
        };
      }`,
        [attempt === 0, selectors.search.selectedChip, selectors.search.actionButton]
      );
      if (state?.observed === true && Number(state.selectedCount) === 0) {
        return {
          mode: 'standard',
          observed: true,
          search_requested: false,
          search_observed: null,
          evidence_type: 'dom_standard_mode'
        };
      }
      await this.sleep(250);
    }
    return {
      mode: 'standard',
      observed: false,
      search_requested: false,
      search_observed: null,
      evidence_type: 'dom_standard_mode',
      error_code: 'web_capture_mode_unverified',
      error_message: '无法确认豆包普通模式'
    };
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
      const explicitLoginButton = Array.from(
        document.querySelectorAll('button,[role="button"],a')
      )
        .filter(visible)
        .some((element) => String(element.textContent || '')
          .replace(/\\s+/g, ' ').trim() === '登录');
      const resolveFinalRoot = (message) => {
        const markdown = message.querySelector('.md-box-root');
        if (markdown && visible(markdown)) return markdown;
        const block = message.querySelector(
          '[data-container-type="block-v1"][data-render-engine="block"]'
        );
        if (block && visible(block)) return block;
        return Array.from(message.querySelectorAll('[data-render-engine="node"]'))
          .filter(visible)
          .find((node) => (
            !String(node.getAttribute('data-plugin-identifier') || '')
              .includes('search_query_result_block.search_type:1')
            && String(node.innerText || node.textContent || '').trim()
          )) || null;
      };
      const assistantMessages = Array.from(
        document.querySelectorAll('[data-message-id]')
      )
        .filter(visible)
        .filter((element) => !element.classList.contains('justify-end'));
      const messages = assistantMessages
        .map((message) => ({
          message,
          root: resolveFinalRoot(message)
        }))
        .filter(({ root }) => root && visible(root));
      const searchInProgress = assistantMessages.some((message) => (
        !resolveFinalRoot(message)
        && Array.from(message.querySelectorAll(
          ${JSON.stringify(DOUBAO_SEARCH_BLOCK_SELECTOR)}
        )).some(visible)
      ));
      const generationActive = searchInProgress || messages.some(
        ({ root }) => root.getAttribute('data-streaming') === 'true'
          || root.matches('[data-show-indicator="true"]')
          || Boolean(root.querySelector('[data-show-indicator="true"]'))
      ) || Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter(visible)
        .some((element) => /停止|中止|stop/i.test(
          [
            element.textContent,
            element.getAttribute('aria-label'),
            element.getAttribute('title')
          ].filter(Boolean).join(' ')
        ));
      return {
        assistantTurns: messages.map(({ message, root }) => ({
          id: String(message.getAttribute('data-message-id') || ''),
          text: String(root.innerText || root.textContent || '').trim(),
          serialized_answer: serializeAnswerTree(root)
        })).filter((turn) => turn.id),
        generationActive,
        busy: Boolean(document.querySelector('[aria-busy="true"]')),
        verificationRequired: hasVisibleMatch(${verificationMarkers}),
        loginRequired: explicitLoginButton || hasVisibleMatch(${loginMarkers})
      };
    })()`);
    const assistantTurns = (snapshot?.assistantTurns || []).map((turn) => {
      if (!turn?.serialized_answer) return turn;
      if (turn.serialized_answer.truncated === true) {
        throw adapterError('web_response_too_large', '豆包回答超过结构化采集上限');
      }
      const markdown = renderAnswerTree(turn.serialized_answer.tree);
      return {
        id: String(turn.id || ''),
        text: markdown || String(turn.text || '').trim(),
        answer_format: markdown ? 'markdown_v1' : 'plain_text'
      };
    });
    return { ...snapshot, assistantTurns };
  }

  async extractCitations(turnId) {
    const rawCitations = await this.callDocument(`function(messageId) {
      const message = Array.from(this.querySelectorAll('[data-message-id]'))
        .find((element) => element.getAttribute('data-message-id') === messageId);
      if (!message || message.classList.contains('justify-end')) return [];
      const root = message.querySelector('.md-box-root')
        || message.querySelector(
          '[data-container-type="block-v1"][data-render-engine="block"]'
        )
        || Array.from(message.querySelectorAll('[data-render-engine="node"]'))
          .find((node) => (
            !String(node.getAttribute('data-plugin-identifier') || '')
              .includes('search_query_result_block.search_type:1')
            && String(node.innerText || node.textContent || '').trim()
          ));
      if (!root) return [];
      const rows = [];
      const seen = new Set();
      for (const anchor of root.querySelectorAll('a[href]')) {
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
          title: String(metadataTitle || visibleTitle || url.hostname).slice(0, 300),
          ...(marker ? { display_index: Number(marker[1]) } : {})
        });
        if (rows.length >= 200) break;
      }
      return rows;
    }`, [String(turnId)]);
    const seen = new Set();
    return (Array.isArray(rawCitations) ? rawCitations : [])
      .map((citation) => ({
        ...citation,
        url: resolveDoubaoCitationUrl(citation?.url)
      }))
      .filter((citation) => {
        if (!citation.url || seen.has(citation.url)) return false;
        seen.add(citation.url);
        return true;
      });
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
        bundle_id: 'com.doubao.web'
      }
    };
  }
}

module.exports = {
  DOUBAO_WEB_IDENTITY,
  DoubaoWebAdapter,
  DoubaoWebPage,
  resolveDoubaoCitationUrl
};
