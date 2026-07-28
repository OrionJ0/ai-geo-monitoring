const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { WebSocketServer } = require('ws');

const { connectCdp } = require('../services/CdpConnection');

test('connects without relying on the Node.js global WebSocket', async () => {
  const originalWebSocket = globalThis.WebSocket;
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address();

  globalThis.WebSocket = class ForbiddenGlobalWebSocket {
    constructor() {
      throw new Error('不应使用 Node.js 全局 WebSocket');
    }
  };

  try {
    const connection = await connectCdp(`ws://127.0.0.1:${address.port}`, 1000);
    connection.close();
    assert.notEqual(connection.webSocket.readyState, 1);
  } finally {
    globalThis.WebSocket = originalWebSocket;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('allows a bounded per-command timeout for slow read-only CDP commands', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address();
  server.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const request = JSON.parse(String(raw));
      setTimeout(() => {
        socket.send(JSON.stringify({ id: request.id, result: { ok: true } }));
      }, 60);
    });
  });

  const connection = await connectCdp(`ws://127.0.0.1:${address.port}`, 1000);
  connection.timeoutMs = 20;
  try {
    const result = await connection.send(
      'Page.captureScreenshot',
      {},
      { timeoutMs: 200 }
    );
    assert.deepEqual(result, { ok: true });
  } finally {
    connection.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
