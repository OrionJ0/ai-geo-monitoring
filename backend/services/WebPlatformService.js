const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { connectCdp } = require('./CdpConnection');
const selectors = require('../config/deepseekWebSelectors');
const { DeepSeekWebAdapter, DeepSeekWebPage } = require('./DeepSeekWebAdapter');
const { WebCaptureStore } = require('./WebCaptureStore');

const DEFAULT_TIMEOUT_SECONDS = 180;
const MIN_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 600;
const DEFAULT_CDP_TIMEOUT_MS = 30_000;
const PREFLIGHT_CACHE_MS = 30_000;
const OFFICIAL_URL = 'https://chat.deepseek.com/';

function codedError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function normalizeWebRuntimeError(error) {
  const rawCode = String(error?.code || '');
  if (rawCode.startsWith('web_')) return error;
  const rendererErrors = {
    renderer_timeout: [
      'web_browser_unresponsive',
      'DeepSeek Web 浏览器响应超时'
    ],
    renderer_command_failed: [
      'web_browser_command_failed',
      'DeepSeek Web 浏览器命令执行失败'
    ],
    renderer_connection_failed: [
      'web_browser_connection_failed',
      '无法连接 DeepSeek Web 浏览器'
    ],
    renderer_connection_closed: [
      'web_browser_closed',
      'DeepSeek Web 浏览器连接已关闭'
    ]
  };
  const [code, message] = rendererErrors[rawCode] || [
    'web_capture_failed',
    'DeepSeek Web 采集失败'
  ];
  const normalized = codedError(code, message, error);
  if (error?.stage) normalized.stage = error.stage;
  return normalized;
}

function shouldRecycleSession(errorCode) {
  return [
    'web_browser_unresponsive',
    'web_browser_command_failed',
    'web_browser_connection_failed',
    'web_browser_closed',
    'web_capture_failed',
    'web_generation_timeout'
  ].includes(errorCode);
}

function isPersistentBlockingError(errorCode) {
  return [
    'web_browser_not_configured',
    'web_browser_launch_failed',
    'web_profile_in_use',
    'web_runtime_config_invalid'
  ].includes(errorCode);
}

function opensCircuit(errorCode) {
  return [
    'web_login_required',
    'web_verification_required',
    'web_selector_mismatch'
  ].includes(errorCode);
}

function parseTimeoutSeconds(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return DEFAULT_TIMEOUT_SECONDS;
  }
  const parsed = Number(value);
  if (
    !Number.isInteger(parsed)
    || parsed < MIN_TIMEOUT_SECONDS
    || parsed > MAX_TIMEOUT_SECONDS
  ) {
    throw codedError(
      'web_runtime_config_invalid',
      `DEEPSEEK_WEB_TIMEOUT_SECONDS 必须是 ${MIN_TIMEOUT_SECONDS}-${MAX_TIMEOUT_SECONDS} 的整数`
    );
  }
  return parsed;
}

function chromeCandidates(platform = process.platform) {
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    ];
  }
  if (platform === 'win32') {
    return [
      process.env.PROGRAMFILES && path.join(
        process.env.PROGRAMFILES,
        'Google/Chrome/Application/chrome.exe'
      ),
      process.env['PROGRAMFILES(X86)'] && path.join(
        process.env['PROGRAMFILES(X86)'],
        'Google/Chrome/Application/chrome.exe'
      ),
      process.env.LOCALAPPDATA && path.join(
        process.env.LOCALAPPDATA,
        'Google/Chrome/Application/chrome.exe'
      )
    ].filter(Boolean);
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ];
}

function resolveDirectory(value, fallback, cwd) {
  return path.resolve(cwd, String(value || fallback));
}

function assertDedicatedProfile(profileDir, evidenceDir, cwd) {
  const normalizedProfile = path.resolve(profileDir);
  const normalizedEvidence = path.resolve(evidenceDir);
  const normalizedCwd = path.resolve(cwd);
  const runtimeRoot = path.resolve(cwd, '.runtime');
  const broadRoots = new Set([
    path.parse(normalizedCwd).root,
    os.homedir(),
    os.tmpdir(),
    normalizedCwd
  ].map((candidate) => path.resolve(candidate)));
  const dailyChromeRoots = [
    path.join(os.homedir(), 'Library/Application Support/Google/Chrome'),
    path.join(os.homedir(), '.config/google-chrome'),
    path.join(os.homedir(), '.config/chromium')
  ].map((candidate) => path.resolve(candidate));
  const isInside = (child, parent) => child === parent || child.startsWith(`${parent}${path.sep}`);
  const invalidDedicatedDirectory = (directory) => (
    broadRoots.has(directory)
    || dailyChromeRoots.some((root) => isInside(directory, root))
    || (isInside(directory, normalizedCwd) && !isInside(directory, runtimeRoot))
  );

  if (
    normalizedProfile === normalizedEvidence
    || isInside(normalizedProfile, normalizedEvidence)
    || isInside(normalizedEvidence, normalizedProfile)
    || /goodie-seo-render-/i.test(normalizedProfile)
    || invalidDedicatedDirectory(normalizedProfile)
    || invalidDedicatedDirectory(normalizedEvidence)
  ) {
    throw codedError(
      'web_runtime_config_invalid',
      'DeepSeek Web 必须使用独立的本地运行时目录'
    );
  }
}

function resolveWebRuntimeConfig({
  cwd = path.resolve(__dirname, '..'),
  env = process.env,
  platform = process.platform
} = {}) {
  const profileDir = resolveDirectory(
    env.DEEPSEEK_WEB_PROFILE_DIR,
    '.runtime/deepseek-web/profile',
    cwd
  );
  const evidenceDir = resolveDirectory(
    env.DEEPSEEK_WEB_EVIDENCE_DIR,
    '.runtime/deepseek-web/evidence',
    cwd
  );
  assertDedicatedProfile(profileDir, evidenceDir, cwd);
  const configuredExecutable = String(env.DEEPSEEK_WEB_CHROME_EXECUTABLE || '').trim();
  const chromeExecutable = configuredExecutable || chromeCandidates(platform).find(
    (candidate) => fs.existsSync(candidate)
  ) || null;

  return {
    chromeExecutable: chromeExecutable ? path.resolve(chromeExecutable) : null,
    profileDir,
    evidenceDir,
    timeoutMs: parseTimeoutSeconds(env.DEEPSEEK_WEB_TIMEOUT_SECONDS) * 1000,
    cdpTimeoutMs: DEFAULT_CDP_TIMEOUT_MS
  };
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

class ProfileLock {
  constructor(profileDir) {
    this.lockPath = `${profileDir}.lock`;
    this.handle = null;
  }

  async acquire(allowStaleRetry = true) {
    try {
      this.handle = await fs.promises.open(this.lockPath, 'wx', 0o600);
      await this.handle.writeFile(JSON.stringify({ pid: process.pid }));
      await this.handle.sync();
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw codedError('web_profile_in_use', '无法取得 DeepSeek Web 专用会话锁', error);
      }
      if (allowStaleRetry) {
        let owner;
        try {
          owner = JSON.parse(await fs.promises.readFile(this.lockPath, 'utf8'));
        } catch {
          owner = null;
        }
        if (owner && !isProcessAlive(Number(owner.pid))) {
          await fs.promises.unlink(this.lockPath).catch(() => {});
          return this.acquire(false);
        }
      }
      throw codedError(
        'web_profile_in_use',
        'DeepSeek Web 专用浏览器会话正被另一进程使用'
      );
    }
  }

  async release() {
    if (!this.handle) return;
    await this.handle.close().catch(() => {});
    this.handle = null;
    await fs.promises.unlink(this.lockPath).catch(() => {});
  }
}

async function prepareRuntime(runtimeConfig) {
  if (!runtimeConfig.chromeExecutable) {
    throw codedError('web_browser_not_configured', '未找到可用的本机 Chrome');
  }
  try {
    await fs.promises.access(runtimeConfig.chromeExecutable, fs.constants.X_OK);
  } catch (error) {
    throw codedError('web_browser_not_configured', '配置的 Chrome 不可执行', error);
  }
  try {
    await fs.promises.mkdir(runtimeConfig.profileDir, { recursive: true, mode: 0o700 });
    await fs.promises.chmod(runtimeConfig.profileDir, 0o700);
    await fs.promises.mkdir(runtimeConfig.evidenceDir, { recursive: true, mode: 0o700 });
    await fs.promises.chmod(runtimeConfig.evidenceDir, 0o700);
  } catch (error) {
    throw codedError('web_runtime_config_invalid', '无法准备 DeepSeek Web 运行时目录', error);
  }
}

function waitForDevTools(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => {
      finish(
        reject,
        codedError('web_browser_launch_failed', '等待 Chrome 调试端口超时')
      );
    }, Math.min(timeoutMs, 30_000));
    const finish = (callback, value) => {
      clearTimeout(timer);
      child.stderr?.off('data', onData);
      child.off('exit', onExit);
      child.off('error', onError);
      callback(value);
    };
    const onData = (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-4000);
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) finish(resolve, match[1]);
    };
    const onExit = () => finish(
      reject,
      codedError('web_browser_launch_failed', 'Chrome 在建立调试会话前退出')
    );
    const onError = (error) => finish(
      reject,
      codedError('web_browser_launch_failed', '无法启动 Chrome', error)
    );
    child.stderr?.on('data', onData);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

function browserHttpOrigin(webSocketUrl) {
  const endpoint = new URL(webSocketUrl);
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(endpoint.hostname)) {
    throw codedError('web_browser_launch_failed', 'Chrome 调试端口未绑定到本机');
  }
  return `http://${endpoint.hostname}:${endpoint.port}`;
}

function isAllowedOrigin(value) {
  try {
    return selectors.allowedOrigins.includes(new URL(value).origin);
  } catch {
    return false;
  }
}

function classifyProbeSnapshot({
  origin,
  pathname,
  verificationCount,
  loginCount,
  composerCount
}) {
  if (!selectors.allowedOrigins.includes(String(origin || ''))) {
    return { status: 'origin_mismatch', origin, composerCount: 0 };
  }
  if (Number(verificationCount) > 0) {
    return { status: 'verification_required', origin, composerCount: 0 };
  }
  if (Number(composerCount) === 1) {
    return { status: 'ready', origin, composerCount: 1 };
  }
  if (
    /\/(?:login|sign[_-]?in)(?:\/|$)/i.test(String(pathname || ''))
    || Number(loginCount) > 0
  ) {
    return { status: 'login_required', origin, composerCount: 0 };
  }
  return {
    status: 'selector_mismatch',
    origin,
    composerCount: Number(composerCount) || 0
  };
}

async function waitForControlledTarget(httpOrigin, timeoutMs) {
  const deadline = Date.now() + Math.min(timeoutMs, 30_000);
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${httpOrigin}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const controlled = targets.find((target) => (
          target.type === 'page'
          && target.webSocketDebuggerUrl
          && isAllowedOrigin(target.url)
        ));
        if (controlled) return controlled;
      }
    } catch {
      // Chrome 的 HTTP 调试端点可能尚未就绪。
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw codedError('web_browser_launch_failed', 'Chrome 未能打开 DeepSeek 官方页面');
}

function buildProbeExpression() {
  const payload = JSON.stringify({
    allowedOrigins: selectors.allowedOrigins,
    loginMarkers: selectors.loginMarkers,
    verificationMarkers: selectors.verificationMarkers,
    composer: selectors.composer
  });
  return `(() => {
    const config = ${payload};
    const visible = (element) => {
      if (!element || element.hidden) return false;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const matches = (candidates) => {
      const found = new Set();
      for (const selector of candidates) {
        for (const element of document.querySelectorAll(selector)) {
          if (visible(element)) found.add(element);
        }
      }
      return Array.from(found);
    };
    const origin = location.origin;
    if (!config.allowedOrigins.includes(origin)) {
      return { status: 'origin_mismatch', origin, composerCount: 0 };
    }
    const verification = matches(config.verificationMarkers);
    if (verification.length > 0) {
      return { status: 'verification_required', origin, composerCount: 0 };
    }
    const composers = matches(config.composer).filter((element) => {
      const role = (element.getAttribute('role') || '').toLowerCase();
      return element.tagName === 'TEXTAREA' || role === 'textbox' || element.isContentEditable;
    });
    if (composers.length === 1) {
      return { status: 'ready', origin, composerCount: 1 };
    }
    const login = matches(config.loginMarkers);
    if (/\\/(?:login|sign[_-]?in)(?:\\/|$)/i.test(location.pathname) || login.length > 0) {
      return { status: 'login_required', origin, composerCount: 0 };
    }
    return { status: 'selector_mismatch', origin, composerCount: composers.length };
  })()`;
}

class ChromePageSession {
  constructor({ child, connection }) {
    this.child = child;
    this.connection = connection;
    this.closed = false;
  }

  async probe() {
    if (this.closed || this.child.exitCode !== null) {
      throw codedError('web_browser_closed', 'Chrome 会话已经关闭');
    }
    const evaluation = await this.connection.send('Runtime.evaluate', {
      expression: buildProbeExpression(),
      returnByValue: true
    });
    if (evaluation.exceptionDetails || !evaluation.result?.value) {
      throw codedError('web_selector_mismatch', '无法检查 DeepSeek 页面结构');
    }
    return evaluation.result.value;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.connection?.close();
    if (this.child.exitCode !== null) return;
    this.child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.child.exitCode === null) this.child.kill('SIGKILL');
        resolve();
      }, 2000);
      this.child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

function buildChromeArguments(runtimeConfig, targetUrl) {
  return [
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    '--no-default-browser-check',
    '--no-first-run',
    '--new-window',
    '--start-maximized',
    `--user-data-dir=${runtimeConfig.profileDir}`,
    targetUrl
  ];
}

const defaultLauncher = {
  async launch({ runtimeConfig, targetUrl }) {
    const child = spawn(runtimeConfig.chromeExecutable, buildChromeArguments(
      runtimeConfig,
      targetUrl
    ), {
      stdio: ['ignore', 'ignore', 'pipe']
    });
    try {
      const webSocketUrl = await waitForDevTools(child, runtimeConfig.timeoutMs);
      const httpOrigin = browserHttpOrigin(webSocketUrl);
      const target = await waitForControlledTarget(httpOrigin, runtimeConfig.timeoutMs);
      const connection = await connectCdp(
        target.webSocketDebuggerUrl,
        runtimeConfig.cdpTimeoutMs || DEFAULT_CDP_TIMEOUT_MS
      );
      await Promise.all([
        connection.send('Page.enable'),
        connection.send('Runtime.enable')
      ]);
      return new ChromePageSession({ child, connection });
    } catch (error) {
      if (child.exitCode === null) child.kill('SIGKILL');
      if (error.code) throw error;
      throw codedError('web_browser_launch_failed', '无法建立 Chrome 页面会话', error);
    }
  }
};

function errorForProbe(result) {
  if (result?.status === 'login_required') {
    return codedError('web_login_required', 'DeepSeek Web 需要重新人工登录');
  }
  if (result?.status === 'verification_required') {
    return codedError('web_verification_required', 'DeepSeek Web 需要人工完成验证');
  }
  return codedError('web_selector_mismatch', 'DeepSeek Web 页面结构与当前选择器不匹配');
}

class WebPlatformService {
  constructor(options = {}) {
    this.runtimeConfig = options.runtimeConfig || resolveWebRuntimeConfig();
    this.launcher = options.launcher || defaultLauncher;
    this.now = options.now || (() => Date.now());
    this.preflightCacheMs = options.preflightCacheMs ?? PREFLIGHT_CACHE_MS;
    this.preflightPollMs = options.preflightPollMs ?? 250;
    this.preflightStabilizationMs = options.preflightStabilizationMs
      ?? Math.min(this.runtimeConfig.timeoutMs, 10_000);
    this.captureStore = options.captureStore || new WebCaptureStore({
      rootDir: this.runtimeConfig.evidenceDir
    });
    this.pageFactory = options.pageFactory || ((session) => new DeepSeekWebPage(session));
    this.adapterFactory = options.adapterFactory || ((adapterOptions) => (
      new DeepSeekWebAdapter(adapterOptions)
    ));
    this.state = 'stopped';
    this.session = null;
    this.profileLock = new ProfileLock(this.runtimeConfig.profileDir);
    this.tail = Promise.resolve();
    this.currentTask = null;
    this.preflightCache = null;
    this.circuitErrorCode = null;
    this.blockingErrorCode = null;
    this.activeCaptureCount = 0;
    this.closing = false;
  }

  runExclusive(task) {
    if (this.closing) {
      return Promise.reject(codedError('web_shutdown', 'DeepSeek Web 服务正在关闭'));
    }
    const execution = this.tail
      .catch(() => undefined)
      .then(async () => {
        if (this.closing) throw codedError('web_shutdown', 'DeepSeek Web 服务正在关闭');
        this.currentTask = Promise.resolve().then(task);
        try {
          return await this.currentTask;
        } finally {
          this.currentTask = null;
        }
      });
    this.tail = execution.catch(() => undefined);
    return execution;
  }

  async ensureSession() {
    if (this.session) return this.session;
    this.state = 'starting';
    await prepareRuntime(this.runtimeConfig);
    await this.profileLock.acquire();
    try {
      this.session = await this.launcher.launch({
        runtimeConfig: this.runtimeConfig,
        targetUrl: OFFICIAL_URL
      });
      return this.session;
    } catch (error) {
      await this.profileLock.release();
      this.state = 'stopped';
      if (error.code) throw error;
      throw codedError('web_browser_launch_failed', '无法启动 DeepSeek Web 浏览器', error);
    }
  }

  async recycleSession() {
    const session = this.session;
    this.session = null;
    this.preflightCache = null;
    this.circuitErrorCode = null;
    this.blockingErrorCode = null;
    await session?.close().catch(() => {});
    await this.profileLock.release();
    this.state = 'stopped';
  }

  validateProbe(result) {
    const validOrigin = selectors.allowedOrigins.includes(String(result?.origin || ''));
    if (
      result?.status === 'ready'
      && validOrigin
      && Number(result.composerCount) === 1
    ) {
      this.state = 'ready';
      return {
        ok: true,
        state: 'ready',
        selector_version: selectors.selectorVersion
      };
    }
    const error = errorForProbe(result);
    if (error.code === 'web_login_required') this.state = 'login_required';
    if (error.code === 'web_verification_required') this.state = 'verification_required';
    if (error.code === 'web_selector_mismatch') this.state = 'selector_mismatch';
    throw error;
  }

  async preflight({ force = false } = {}) {
    if (this.circuitErrorCode && !force) {
      throw codedError(this.circuitErrorCode, 'DeepSeek Web 运行通道已熔断');
    }
    if (force) {
      this.circuitErrorCode = null;
      this.blockingErrorCode = null;
    }
    if (
      !force
      && this.preflightCache
      && this.now() - this.preflightCache.checkedAt <= this.preflightCacheMs
    ) {
      return this.preflightCache.result;
    }
    return this.runExclusive(async () => {
      try {
        if (
          !force
          && this.preflightCache
          && this.now() - this.preflightCache.checkedAt <= this.preflightCacheMs
        ) {
          return this.preflightCache.result;
        }
        const session = await this.ensureSession();
        const deadline = Date.now() + this.preflightStabilizationMs;
        let probe;
        do {
          probe = await session.probe();
          if (
            probe?.status === 'ready'
            || probe?.status === 'login_required'
            || probe?.status === 'verification_required'
          ) {
            break;
          }
          if (Date.now() >= deadline) break;
          await new Promise((resolve) => setTimeout(resolve, this.preflightPollMs));
        } while (Date.now() <= deadline);
        const result = this.validateProbe(probe);
        this.circuitErrorCode = null;
        this.blockingErrorCode = null;
        this.preflightCache = { checkedAt: this.now(), result };
        return result;
      } catch (error) {
        const normalized = normalizeWebRuntimeError(error);
        this.blockingErrorCode = isPersistentBlockingError(normalized.code)
          ? normalized.code
          : null;
        if (opensCircuit(normalized.code)) {
          this.circuitErrorCode = normalized.code;
          this.preflightCache = null;
        }
        if (shouldRecycleSession(normalized.code)) await this.recycleSession();
        throw normalized;
      }
    });
  }

  async waitForInteractiveLogin({ onStatus, pollMs = 1000 } = {}) {
    return this.runExclusive(async () => {
      const session = await this.ensureSession();
      const deadline = this.now() + this.runtimeConfig.timeoutMs;
      let lastStatus = null;
      while (this.now() <= deadline) {
        const probe = await session.probe();
        lastStatus = probe?.status || 'selector_mismatch';
        if (
          probe?.status === 'ready'
          && selectors.allowedOrigins.includes(String(probe.origin || ''))
          && Number(probe.composerCount) === 1
        ) {
          this.state = 'ready';
          return {
            ok: true,
            state: 'ready',
            selector_version: selectors.selectorVersion
          };
        }
        onStatus?.(lastStatus);
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
      throw errorForProbe({ status: lastStatus });
    });
  }

  async queryPlatform(question, options = {}) {
    const startedAt = this.now();
    return this.runExclusive(async () => {
      try {
        if (this.circuitErrorCode) {
          throw codedError(this.circuitErrorCode, 'DeepSeek Web 运行通道已熔断');
        }
        const session = await this.ensureSession();
        this.blockingErrorCode = null;
        const page = this.pageFactory(session);
        const adapter = this.adapterFactory({
          page,
          captureStore: this.captureStore,
          timeoutMs: this.runtimeConfig.timeoutMs
        });
        this.activeCaptureCount = 1;
        let result;
        try {
          result = await adapter.capture(question, options.capture_owner);
        } finally {
          this.activeCaptureCount = 0;
        }
        this.blockingErrorCode = null;
        this.state = 'ready';
        return {
          ...result,
          responseTime: Math.max(0, this.now() - startedAt)
        };
      } catch (error) {
        const normalized = normalizeWebRuntimeError(error);
        const errorCode = normalized.code;
        this.blockingErrorCode = isPersistentBlockingError(errorCode)
          ? errorCode
          : null;
        if (shouldRecycleSession(errorCode)) await this.recycleSession();
        if (errorCode === 'web_login_required') this.state = 'login_required';
        if (errorCode === 'web_verification_required') this.state = 'verification_required';
        if (errorCode === 'web_selector_mismatch') this.state = 'selector_mismatch';
        if (opensCircuit(errorCode)) {
          this.circuitErrorCode = errorCode;
          this.preflightCache = null;
        }
        return {
          success: false,
          platform: 'deepseek-web',
          error_code: errorCode,
          error: normalized.message,
          web_capture: {
            schema_version: 'deepseek-web-capture-v1',
            status: 'failed',
            failure: {
              stage: String(normalized.stage || 'request').slice(0, 80),
              error_code: errorCode
            }
          },
          responseTime: Math.max(0, this.now() - startedAt)
        };
      }
    });
  }

  getRuntimeSnapshot() {
    return {
      running_count: this.activeCaptureCount > 0 ? 1 : 0,
      lifecycle_state: this.state,
      blocking_error_code: this.circuitErrorCode || this.blockingErrorCode || null,
      shutting_down: this.closing
    };
  }

  getCaptureStore() {
    return this.captureStore;
  }

  async discardRecordCapture(recordId, webCapture) {
    if (
      Number(webCapture?.artifact_owner_record_id) !== Number(recordId)
      || webCapture?.status !== 'completed'
    ) {
      return false;
    }
    await this.captureStore.discardRecord(recordId);
    return true;
  }

  async shutdown() {
    if (this.closing) return;
    this.closing = true;
    this.state = 'closing';
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, 10_000);
      timer.unref?.();
      this.tail.then(finish, finish);
    });
    await this.session?.close().catch(() => {});
    this.session = null;
    await this.profileLock.release();
    this.state = 'stopped';
  }
}

const service = new WebPlatformService();

module.exports = service;
module.exports.WebPlatformService = WebPlatformService;
module.exports.ProfileLock = ProfileLock;
module.exports.resolveWebRuntimeConfig = resolveWebRuntimeConfig;
module.exports.classifyProbeSnapshot = classifyProbeSnapshot;
module.exports.buildChromeArguments = buildChromeArguments;
module.exports.codedError = codedError;
module.exports.normalizeWebRuntimeError = normalizeWebRuntimeError;
