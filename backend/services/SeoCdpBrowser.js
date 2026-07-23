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
          expression: `(() => {
            const description = document.querySelector('meta[name="description"]');
            const bodyText = document.body ? document.body.innerText.replace(/\\s+/g, ' ').trim() : '';
            return {
              title: (document.title || '').trim(),
              description: (description?.getAttribute('content') || '').trim(),
              contentCharacters: bodyText.replace(/\\s/g, '').length,
              linkCount: document.querySelectorAll('a[href]').length
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
