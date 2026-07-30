const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const FIXTURE_DIRECTORY = path.join(__dirname, '..', 'fixtures', 'seo-responses');

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURE_DIRECTORY, name), 'utf8');
}

const responseBodies = Object.freeze({
  normal: fixture('normal.html'),
  spa: fixture('spa.html'),
  edgeone: fixture('edgeone-challenge.html'),
  business403: fixture('business-403.html'),
  htmlError: fixture('html-error.html'),
  robots: fixture('robots.txt'),
  sitemap: fixture('sitemap.xml')
});

function send(res, statusCode, contentType, body, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    Connection: 'close',
    ...headers
  });
  res.end(body);
}

async function startSeoAuditMockServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    requests.push({
      method: req.method,
      path: requestUrl.pathname,
      userAgent: String(req.headers['user-agent'] || ''),
      receivedAt: Date.now()
    });

    if (requestUrl.pathname === '/normal.html' || requestUrl.pathname === '/redirect/final') {
      return send(res, 200, 'text/html; charset=utf-8', responseBodies.normal);
    }
    if (requestUrl.pathname === '/spa.html') {
      return send(res, 200, 'text/html; charset=utf-8', responseBodies.spa);
    }
    if (requestUrl.pathname === '/challenge-200') {
      return send(res, 200, 'text/html; charset=utf-8', responseBodies.edgeone);
    }
    if (requestUrl.pathname === '/business-403') {
      return send(res, 403, 'text/html; charset=utf-8', responseBodies.business403);
    }
    if (requestUrl.pathname === '/waf-403') {
      return send(res, 403, 'text/html; charset=utf-8', responseBodies.edgeone);
    }
    if (requestUrl.pathname === '/rate-limited') {
      return send(res, 429, 'text/plain; charset=utf-8', 'Too many requests', {
        'Retry-After': '120'
      });
    }
    if (requestUrl.pathname === '/robots-html' || requestUrl.pathname === '/sitemap-html') {
      return send(res, 200, 'text/html; charset=utf-8', responseBodies.htmlError);
    }
    if (requestUrl.pathname === '/robots.txt') {
      return send(res, 200, 'text/plain; charset=utf-8', responseBodies.robots);
    }
    if (requestUrl.pathname === '/sitemap.xml') {
      return send(res, 200, 'application/xml; charset=utf-8', responseBodies.sitemap);
    }

    const redirectMatch = requestUrl.pathname.match(/^\/redirect\/([0-4])$/);
    if (redirectMatch) {
      const current = Number(redirectMatch[1]);
      const location = current === 4 ? '/redirect/final' : `/redirect/${current + 1}`;
      res.writeHead(302, { Location: location, Connection: 'close' });
      return res.end();
    }

    return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

module.exports = {
  startSeoAuditMockServer
};
