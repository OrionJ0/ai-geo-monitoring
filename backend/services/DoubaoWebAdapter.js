const selectors = require('../config/doubaoWebSelectors');
const {
  DeepSeekWebAdapter,
  DeepSeekWebPage,
  adapterError
} = require('./DeepSeekWebAdapter');

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

class DoubaoWebAdapter extends DeepSeekWebAdapter {
  constructor(options) {
    super({ ...options, identity: DOUBAO_WEB_IDENTITY });
  }
}

class DoubaoWebPage extends DeepSeekWebPage {
  constructor(session, options = {}) {
    super(session, { ...options, identity: DOUBAO_WEB_IDENTITY });
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
          .filter((element) => element.querySelector('.md-box-root'))
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
      throw adapterError('web_login_required', '豆包深入研究需要人工登录');
    }
    const search = await this.ensureSearchEnabled();
    if (search?.observed === true) return search;
    throw adapterError('web_selector_mismatch', '豆包深入研究控件无法确认可用');
  }

  async ensureSearchEnabled() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const state = await this.callDocument(`function(allowClick, loginMarkers) {
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
        const loginRequired = explicitLoginButton || loginMarkers.some((selector) => (
          Array.from(this.querySelectorAll(selector)).some(visible)
        ));
        if (loginRequired) {
          return {
            observed: false,
            selectedCount: 0,
            actionCount: 0,
            loginRequired: true
          };
        }
        const selected = Array.from(this.querySelectorAll(
          '[data-input-engine-action-source="actionbar"][data-value="25"]'
        )).filter(visible);
        const actions = Array.from(this.querySelectorAll(
          'button[data-skill-id="skill_bar_button_25"]'
        )).filter(visible);
        if (selected.length === 1) {
          return { observed: true, selectedCount: 1, actionCount: actions.length };
        }
        if (selected.length === 0 && actions.length === 1 && allowClick) {
          actions[0].click();
        }
        return {
          observed: false,
          selectedCount: selected.length,
          actionCount: actions.length,
          loginRequired: false
        };
      }`, [attempt === 0, selectors.loginMarkers]);
      if (state?.loginRequired) {
        throw adapterError('web_login_required', '豆包深入研究需要人工登录');
      }
      if (state?.observed === true && Number(state.selectedCount) === 1) {
        return {
          requested: true,
          observed: true,
          evidence_type: 'dom_selected_deep_research'
        };
      }
      await this.sleep(250);
    }
    return { requested: true, observed: false };
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
      const messages = Array.from(document.querySelectorAll('[data-message-id]'))
        .filter(visible)
        .filter((element) => !element.classList.contains('justify-end'))
        .map((message) => ({
          message,
          root: message.querySelector('.md-box-root')
        }))
        .filter(({ root }) => root && visible(root));
      const generationActive = messages.some(
        ({ root }) => root.getAttribute('data-streaming') === 'true'
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
          text: String(root.innerText || root.textContent || '').trim()
        })).filter((turn) => turn.id),
        generationActive,
        busy: Boolean(document.querySelector('[aria-busy="true"]'))
      };
    })()`);
  }

  async extractCitations(turnId) {
    return this.callDocument(`function(messageId) {
      const message = Array.from(this.querySelectorAll('[data-message-id]'))
        .find((element) => element.getAttribute('data-message-id') === messageId);
      if (!message || message.classList.contains('justify-end')) return [];
      const root = message.querySelector('.md-box-root');
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
        rows.push({
          url: url.href,
          title: String(anchor.textContent || url.hostname)
            .replace(/\\s+/g, ' ').trim().slice(0, 300)
        });
        if (rows.length >= 200) break;
      }
      return rows;
    }`, [String(turnId)]);
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
  DoubaoWebPage
};
