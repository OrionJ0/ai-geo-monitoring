const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { connectCdp } = require('./CdpConnection');
const SeoSiteClient = require('./SeoSiteClient');

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function launchChrome(executablePath, timeoutMs) {
  const profileDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'goodie-seo-render-'));
  const child = spawn(executablePath, [
    '--headless=new',
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-gpu',
    '--disable-sync',
    '--metrics-recording-only',
    '--no-default-browser-check',
    '--no-first-run',
    '--hide-scrollbars',
    `--user-data-dir=${profileDirectory}`,
    'about:blank'
  ], {
    stdio: ['ignore', 'ignore', 'pipe']
  });

  try {
    const webSocketUrl = await new Promise((resolve, reject) => {
      let stderr = '';
      const timer = setTimeout(() => {
        reject(codedError('renderer_launch_timeout', '启动无头 Chrome 超时'));
      }, timeoutMs);
      const finish = (callback, value) => {
        clearTimeout(timer);
        child.stderr.off('data', onData);
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
        codedError('renderer_launch_failed', '无头 Chrome 启动失败')
      );
      const onError = () => finish(
        reject,
        codedError('renderer_launch_failed', '无法启动无头 Chrome')
      );
      child.stderr.on('data', onData);
      child.once('exit', onExit);
      child.once('error', onError);
    });
    return { child, profileDirectory, webSocketUrl };
  } catch (error) {
    child.kill('SIGKILL');
    await fs.promises.rm(profileDirectory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function browserHttpOrigin(webSocketUrl) {
  const endpoint = new URL(webSocketUrl);
  return `http://${endpoint.hostname}:${endpoint.port}`;
}

async function createTarget(httpOrigin) {
  const response = await fetch(`${httpOrigin}/json/new?about:blank`, { method: 'PUT' });
  if (!response.ok) throw codedError('renderer_target_failed', '无法创建浏览器渲染页面');
  const target = await response.json();
  if (!target?.id || !target?.webSocketDebuggerUrl) {
    throw codedError('renderer_target_failed', '浏览器渲染页面信息不完整');
  }
  return target;
}

async function closeTarget(httpOrigin, targetId) {
  await fetch(`${httpOrigin}/json/close/${encodeURIComponent(targetId)}`).catch(() => {});
}

function isBrowserLocalScheme(url) {
  return /^(?:about|blob|data):/i.test(String(url || ''));
}

async function createCdpBrowser({
  executablePath,
  timeoutMs = 10000,
  urlGuard = (url) => SeoSiteClient.assertPublicUrl(url)
} = {}) {
  if (!executablePath) {
    throw codedError('renderer_not_configured', '未配置 Chrome 可执行文件');
  }
  const launched = await launchChrome(executablePath, timeoutMs);
  const httpOrigin = browserHttpOrigin(launched.webSocketUrl);

  return {
    async render(url) {
      await urlGuard(url);
      const target = await createTarget(httpOrigin);
      let connection;
      try {
        connection = await connectCdp(target.webSocketDebuggerUrl, timeoutMs);
        await Promise.all([
          connection.send('Page.enable'),
          connection.send('Runtime.enable'),
          connection.send('Fetch.enable', {
            patterns: [{ urlPattern: '*', requestStage: 'Request' }]
          })
        ]);
        connection.on('Fetch.requestPaused', (event) => {
          const settle = async () => {
            const requestId = event.requestId;
            const requestUrl = event.request?.url || '';
            if (['Image', 'Media', 'Font'].includes(event.resourceType)) {
              await connection.send('Fetch.failRequest', {
                requestId,
                errorReason: 'BlockedByClient'
              });
              return;
            }
            if (!isBrowserLocalScheme(requestUrl)) await urlGuard(requestUrl);
            await connection.send('Fetch.continueRequest', { requestId });
          };
          settle().catch(() => {
            connection.send('Fetch.failRequest', {
              requestId: event.requestId,
              errorReason: 'BlockedByClient'
            }).catch(() => {});
          });
        });

        const loaded = connection.waitFor('Page.loadEventFired', timeoutMs);
        const navigation = await connection.send('Page.navigate', { url });
        if (navigation.errorText) {
          throw codedError('renderer_navigation_failed', '浏览器无法打开抽样页面');
        }
        await loaded;
        await new Promise((resolve) => setTimeout(resolve, 500));
        const evaluation = await connection.send('Runtime.evaluate', {
          expression: `(async () => {
            const description = document.querySelector('meta[name="description"]');
            const bodyText = document.body ? document.body.innerText.replace(/\\s+/g, ' ').trim() : '';
            const normalizedText = (value) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, 160);
            const regionFor = (element) => {
              if (element.closest('footer')) return 'footer';
              if (element.closest('header')) return 'header';
              if (element.closest('nav, [role="navigation"], [role="menu"]')) return 'navigation';
              if (element.closest('main, article')) return 'content';
              return 'other';
            };
            const snapshotLinks = () => Array.from(document.querySelectorAll('a[href]')).map((link) => ({
              url: link.href,
              text: normalizedText(link.textContent),
              region: regionFor(link)
            })).slice(0, 200);
            const initialLinks = snapshotLinks();
            const candidateSelector = [
              'header span',
              'header div',
              'nav span',
              'nav div',
              '[role="navigation"] span',
              '[role="navigation"] div',
              '[role="menu"] span',
              '[role="menu"] div',
              'header button',
              'nav button',
              '[role="navigation"] button',
              '[role="menu"] button',
              'a[aria-haspopup]',
              '[role="link"]'
            ].join(',');
            const isNonSemanticCandidate = (element) => {
              const tag = element.tagName.toLowerCase();
              if (tag === 'a' || tag === 'button') return false;
              const role = (element.getAttribute('role') || '').toLowerCase();
              const style = getComputedStyle(element);
              return role === 'link'
                || element.hasAttribute('onclick')
                || style.cursor === 'pointer';
            };
            const isInteractionCandidate = (element) => {
              const tag = element.tagName.toLowerCase();
              return tag === 'button'
                || (tag === 'a' && element.hasAttribute('aria-haspopup'))
                || isNonSemanticCandidate(element);
            };
            const candidates = Array.from(document.querySelectorAll(candidateSelector))
              .filter(isInteractionCandidate)
              .filter((element) => {
                if (!isNonSemanticCandidate(element)) return true;
                if (element.closest('button, a')) return false;
                return !Array.from(element.querySelectorAll('span, div, [role="link"]'))
                  .some(isNonSemanticCandidate);
              })
              .filter((element) => normalizedText(element.textContent))
              .slice(0, 30);
            const nonSemanticControls = candidates
              .filter(isNonSemanticCandidate)
              .map((element) => ({
                tag: element.tagName.toLowerCase(),
                text: normalizedText(element.textContent),
                region: regionFor(element),
                reason: 'clickable_non_link'
              }));
            const interactionDependentLinks = [];
            for (const element of candidates) {
              const before = new Set(snapshotLinks().map((link) => link.url));
              element.dispatchEvent(new MouseEvent('mouseover', {
                bubbles: true,
                cancelable: true,
                view: window
              }));
              element.dispatchEvent(new MouseEvent('mouseenter', {
                bubbles: false,
                cancelable: true,
                view: window
              }));
              if (typeof element.focus === 'function') element.focus({ preventScroll: true });
              await new Promise((resolve) => setTimeout(resolve, 80));
              const links = snapshotLinks()
                .filter((link) => !before.has(link.url))
                .map(({ url, text }) => ({ url, text }));
              if (links.length) {
                interactionDependentLinks.push({
                  triggerText: normalizedText(element.textContent),
                  links: links.slice(0, 50)
                });
              }
              element.dispatchEvent(new MouseEvent('mouseout', {
                bubbles: true,
                cancelable: true,
                view: window
              }));
              element.dispatchEvent(new MouseEvent('mouseleave', {
                bubbles: false,
                cancelable: true,
                view: window
              }));
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
            return {
              title: (document.title || '').trim(),
              description: (description?.getAttribute('content') || '').trim(),
              contentCharacters: bodyText.replace(/\\s/g, '').length,
              linkCount: document.querySelectorAll('a[href]').length,
              navigation: {
                initialLinks,
                nonSemanticControls,
                interactionDependentLinks
              }
            };
          })()`,
          returnByValue: true,
          awaitPromise: true
        });
        if (evaluation.exceptionDetails || !evaluation.result?.value) {
          throw codedError('renderer_evaluation_failed', '无法读取浏览器渲染结果');
        }
        return evaluation.result.value;
      } finally {
        connection?.close();
        await closeTarget(httpOrigin, target.id);
      }
    },

    async close() {
      if (launched.child.exitCode === null) {
        launched.child.kill('SIGTERM');
        await new Promise((resolve) => {
          const timer = setTimeout(() => {
            if (launched.child.exitCode === null) launched.child.kill('SIGKILL');
            resolve();
          }, 2000);
          launched.child.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
      await fs.promises.rm(launched.profileDirectory, { recursive: true, force: true }).catch(() => {});
    }
  };
}

module.exports = { createCdpBrowser };
