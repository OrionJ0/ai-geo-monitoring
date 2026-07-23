const fs = require('node:fs');
const { createCdpBrowser } = require('./SeoCdpBrowser');

function discoverBrowserExecutable() {
  const candidates = [
    process.env.SEO_RENDER_BROWSER_EXECUTABLE,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function createSeoRenderService({
  enabled = process.env.SEO_RENDER_NETWORK_ISOLATED === 'true',
  executablePath = discoverBrowserExecutable(),
  browserFactory = createCdpBrowser
} = {}) {
  return {
    async sample(entries) {
      const requested = Array.isArray(entries) ? entries.filter((entry) => entry?.url) : [];
      if (!requested.length) {
        return { status: 'completed', samples: [] };
      }
      if (!enabled) {
        return {
          status: 'unavailable',
          reason: 'renderer_requires_network_isolation',
          samples: []
        };
      }
      if (!executablePath) {
        return {
          status: 'unavailable',
          reason: 'renderer_not_configured',
          samples: []
        };
      }

      let browser;
      try {
        browser = await browserFactory({ executablePath });
      } catch (error) {
        return {
          status: 'unavailable',
          reason: error?.code || 'renderer_launch_failed',
          samples: []
        };
      }

      const samples = [];
      try {
        for (const entry of requested) {
          try {
            const rendered = await browser.render(entry.url);
            samples.push({
              url: entry.url,
              source: entry.source || {},
              rendered
            });
          } catch (error) {
            samples.push({
              url: entry.url,
              source: entry.source || {},
              errorCode: error?.code || 'render_failed'
            });
          }
        }
      } finally {
        await browser.close().catch(() => {});
      }

      const completed = samples.filter((sample) => sample.rendered);
      return completed.length
        ? {
            status: completed.length === samples.length ? 'completed' : 'partial',
            reason: completed.length === samples.length ? '' : 'some_samples_failed',
            samples
          }
        : {
            status: 'unavailable',
            reason: samples[0]?.errorCode || 'render_failed',
            samples
          };
    }
  };
}

module.exports = {
  createSeoRenderService,
  discoverBrowserExecutable
};
