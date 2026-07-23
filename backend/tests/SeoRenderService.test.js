const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  createSeoRenderService,
  discoverBrowserExecutable
} = require('../services/SeoRenderService');
const { createCdpBrowser } = require('../services/SeoCdpBrowser');

test('samples browser-rendered SEO fields and preserves source evidence', async () => {
  const renderedUrls = [];
  let closed = false;
  const service = createSeoRenderService({
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

test('executes page JavaScript through the installed headless Chrome', {
  skip: !discoverBrowserExecutable()
}, async () => {
  const server = http.createServer((_request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><html><head>
      <title>源码标题</title>
      <meta name="description" content="源码描述">
    </head><body><main>源码正文</main><script>
      document.title = '渲染标题';
      document.querySelector('meta[name="description"]').content = '渲染描述';
      document.querySelector('main').textContent = '浏览器执行 JavaScript 后的正文内容';
      document.body.insertAdjacentHTML('beforeend', '<a href="/next">下一页</a>');
    </script></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/`;
  const service = createSeoRenderService({
    executablePath: discoverBrowserExecutable(),
    browserFactory: (options) => createCdpBrowser({
      ...options,
      urlGuard: async (value) => value
    })
  });

  try {
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
    assert.equal(result.samples[0].rendered.linkCount, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
