const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { configureTrustedProxy } = require('../config/trustedProxyPolicy');

function request(server, forwardedFor) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      path: '/probe',
      headers: forwardedFor
        ? { 'X-Forwarded-For': forwardedFor }
        : {}
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let parsedBody = null;
        try {
          parsedBody = body ? JSON.parse(body) : null;
        } catch {
          parsedBody = body;
        }
        resolve({
          status: res.statusCode,
          body: parsedBody
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function createProbeServer({ limit = 100 } = {}) {
  const app = express();
  configureTrustedProxy(app);
  app.get('/probe', rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: false,
    legacyHeaders: false
  }), (req, res) => {
    res.json({ ip: req.ip, ips: req.ips });
  });

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('只信任回环代理地址', () => {
  const app = express();
  configureTrustedProxy(app);
  const trust = app.get('trust proxy fn');

  assert.equal(trust('127.0.0.1'), true);
  assert.equal(trust('::1'), true);
  assert.equal(trust('::ffff:127.0.0.1'), true);
  assert.equal(trust('10.0.0.8'), false);
  assert.equal(trust('198.51.100.8'), false);
});

test('从本机代理追加的转发链识别最靠近代理的公网客户端', async (t) => {
  const server = await createProbeServer();
  t.after(() => closeServer(server));

  const directProxy = await request(server, '198.51.100.10');
  assert.equal(directProxy.status, 200);
  assert.equal(directProxy.body.ip, '198.51.100.10');

  const forgedPrefix = await request(
    server,
    '203.0.113.200, 198.51.100.10'
  );
  assert.equal(forgedPrefix.status, 200);
  assert.equal(forgedPrefix.body.ip, '198.51.100.10');

  const nextProxyHop = await request(
    server,
    '203.0.113.200, 198.51.100.10, 127.0.0.1'
  );
  assert.equal(nextProxyHop.status, 200);
  assert.equal(nextProxyHop.body.ip, '198.51.100.10');
});

test('伪造转发链前缀不能绕过同一公网客户端的限流桶', async (t) => {
  const server = await createProbeServer({ limit: 2 });
  t.after(() => closeServer(server));

  const first = await request(
    server,
    '203.0.113.1, 198.51.100.20'
  );
  const second = await request(
    server,
    '203.0.113.2, 198.51.100.20'
  );
  const blocked = await request(
    server,
    '203.0.113.3, 198.51.100.20'
  );
  const otherClient = await request(
    server,
    '203.0.113.3, 198.51.100.21'
  );

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(blocked.status, 429);
  assert.equal(otherClient.status, 200);
});
