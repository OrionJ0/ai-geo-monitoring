const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSeoRenderService,
  discoverBrowserExecutable
} = require('../services/SeoRenderService');
const { createCdpBrowser } = require('../services/SeoCdpBrowser');

function documentUrl(html) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

test('samples browser-rendered SEO fields and preserves source evidence', async () => {
  const renderedUrls = [];
  let closed = false;
  const service = createSeoRenderService({
    enabled: true,
    executablePath: '/fake/chrome',
    browserFactory: async () => ({
      async render(url) {
        renderedUrls.push(url);
        return {
          title: '渲染标题',
          description: '渲染描述',
          contentCharacters: 500,
          linkCount: 8
        };
      },
      async close() {
        closed = true;
      }
    })
  });

  const result = await service.sample([{
    url: 'https://example.com/app',
    source: {
      title: '',
      description: '',
      contentCharacters: 20,
      linkCount: 0
    }
  }]);

  assert.equal(result.status, 'completed');
  assert.deepEqual(renderedUrls, ['https://example.com/app']);
  assert.equal(result.samples[0].source.contentCharacters, 20);
  assert.equal(result.samples[0].rendered.title, '渲染标题');
  assert.equal(closed, true);
});

test('returns an explicit unavailable state when no browser executable exists', async () => {
  const service = createSeoRenderService({
    enabled: true,
    executablePath: '',
    browserFactory: async () => {
      throw new Error('不应启动');
    }
  });

  const result = await service.sample([{
    url: 'https://example.com/',
    source: {}
  }]);

  assert.deepEqual(result, {
    status: 'unavailable',
    reason: 'renderer_not_configured',
    samples: []
  });
});

test('preserves failed samples and reports partial browser evidence', async () => {
  const service = createSeoRenderService({
    enabled: true,
    executablePath: '/fake/chrome',
    browserFactory: async () => ({
      async render(url) {
        if (url.endsWith('/failed')) {
          throw Object.assign(new Error('页面加载超时'), { code: 'renderer_timeout' });
        }
        return {
          title: '渲染标题',
          description: '',
          contentCharacters: 100,
          linkCount: 1
        };
      },
      async close() {}
    })
  });

  const result = await service.sample([
    { url: 'https://example.com/ok', source: {} },
    { url: 'https://example.com/failed', source: {} }
  ]);

  assert.equal(result.status, 'partial');
  assert.equal(result.samples.length, 2);
  assert.equal(result.samples[0].rendered.title, '渲染标题');
  assert.equal(result.samples[1].errorCode, 'renderer_timeout');
});

test('requires an explicitly isolated network environment before browser rendering', async () => {
  const service = createSeoRenderService({
    enabled: false,
    executablePath: '/fake/chrome',
    browserFactory: async () => {
      throw new Error('不应启动');
    }
  });

  const result = await service.sample([{ url: 'https://example.com/', source: {} }]);

  assert.deepEqual(result, {
    status: 'unavailable',
    reason: 'renderer_requires_network_isolation',
    samples: []
  });
});

test('executes page JavaScript through the installed headless Chrome', {
  skip: !discoverBrowserExecutable()
}, async () => {
  const url = documentUrl(`<!doctype html><html><head>
      <base href="https://example.test/">
      <title>源码标题</title>
      <meta name="description" content="源码描述">
    </head><body><main>源码正文</main><script>
      document.title = '渲染标题';
      document.querySelector('meta[name="description"]').content = '渲染描述';
      document.querySelector('main').textContent = '浏览器执行 JavaScript 后的正文内容';
      for (let index = 0; index < 205; index += 1) {
        document.body.insertAdjacentHTML('beforeend', '<a href="/next-' + index + '">下一页</a>');
      }
    </script></body></html>`);
  const service = createSeoRenderService({
    enabled: true,
    executablePath: discoverBrowserExecutable(),
    browserFactory: (options) => createCdpBrowser({
      ...options,
      urlGuard: async (value) => value
    })
  });

  const result = await service.sample([{
    url,
    source: {
      title: '源码标题',
      description: '源码描述',
      contentCharacters: 4,
      linkCount: 0
    }
  }]);

  assert.equal(result.status, 'completed');
  assert.equal(result.samples[0].rendered.title, '渲染标题');
  assert.equal(result.samples[0].rendered.description, '渲染描述');
  assert.equal(result.samples[0].rendered.linkCount, 205);
  assert.equal(result.samples[0].rendered.navigation.initialLinks.length, 200);
});

test('detects navigation links that only appear after hover interaction', {
  skip: !discoverBrowserExecutable()
}, async () => {
  const baseUrl = 'https://example.test/';
  const url = documentUrl(`<!doctype html><html><head>
      <base href="${baseUrl}">
      <title>导航抽样</title>
    </head><body>
      <header><nav id="nav">
        <span id="solutions" style="cursor:pointer">解决方案</span>
        <div id="news" onclick="window.location.href='/news'">新闻中心</div>
        <button id="products" type="button">产品中心</button>
      </nav></header>
      <script>
        document.querySelector('#products').addEventListener('mouseover', () => {
          if (!document.querySelector('#energy')) {
            document.querySelector('#nav').insertAdjacentHTML(
              'beforeend',
              '<a id="energy" href="/solutions/energy">能源</a>'
            );
          }
        });
      </script>
    </body></html>`);
  const service = createSeoRenderService({
    enabled: true,
    executablePath: discoverBrowserExecutable(),
    browserFactory: (options) => createCdpBrowser({
      ...options,
      urlGuard: async (value) => value
    })
  });

  const result = await service.sample([{
    url,
    source: {
      title: '导航抽样',
      description: '',
      contentCharacters: 6,
      linkCount: 0
    }
  }]);

  const navigation = result.samples[0].rendered.navigation;
  assert.equal(
    navigation.nonSemanticControls.some((control) => (
      control.tag === 'span' && control.text === '解决方案'
    )),
    false
  );
  assert.equal(
    navigation.nonSemanticControls.some((control) => (
      control.tag === 'div' && control.text === '新闻中心'
    )),
    true
  );
  assert.deepEqual(navigation.interactionDependentLinks, [{
    triggerText: '产品中心',
    links: [{
      url: `${baseUrl}solutions/energy`,
      text: '能源'
    }]
  }]);
});
