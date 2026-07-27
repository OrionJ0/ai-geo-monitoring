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
