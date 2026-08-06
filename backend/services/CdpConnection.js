const { WebSocket } = require('ws');

function timeoutError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

class CdpConnection {
  constructor(webSocket, timeoutMs = 10000) {
    this.webSocket = webSocket;
    this.timeoutMs = timeoutMs;
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Map();
    webSocket.addEventListener('message', (event) => this.handleMessage(event.data));
    webSocket.addEventListener('close', () => this.rejectPending(
      timeoutError('renderer_connection_closed', 'Chrome 调试连接已关闭')
    ));
  }

  handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        const error = new Error(message.error.message || 'Chrome 调试命令失败');
        error.code = 'renderer_command_failed';
        pending.reject(error);
      } else {
        pending.resolve(message.result || {});
      }
      return;
    }
    const handlers = this.listeners.get(message.method) || [];
    handlers.forEach((handler) => handler(message.params || {}));
  }

  rejectPending(error) {
    this.pending.forEach((pending) => {
      clearTimeout(pending.timer);
      pending.reject(error);
    });
    this.pending.clear();
  }

  on(method, handler) {
    const handlers = this.listeners.get(method) || [];
    handlers.push(handler);
    this.listeners.set(method, handlers);
    return () => {
      this.listeners.set(method, (this.listeners.get(method) || []).filter((item) => item !== handler));
    };
  }

  waitFor(method, timeoutMs = this.timeoutMs) {
    return new Promise((resolve, reject) => {
      let timer;
      const off = this.on(method, (params) => {
        clearTimeout(timer);
        off();
        resolve(params);
      });
      timer = setTimeout(() => {
        off();
        reject(timeoutError('renderer_timeout', `等待 ${method} 超时`));
      }, timeoutMs);
    });
  }

  send(method, params = {}, options = {}) {
    const id = ++this.sequence;
    const requestedTimeoutMs = Number(options?.timeoutMs);
    const commandTimeoutMs = Number.isFinite(requestedTimeoutMs)
      ? Math.min(120_000, Math.max(1, Math.round(requestedTimeoutMs)))
      : this.timeoutMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(timeoutError('renderer_timeout', `执行 ${method} 超时`));
      }, commandTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.webSocket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.webSocket.readyState < WebSocket.CLOSING) this.webSocket.close();
  }
}

async function connectCdp(webSocketUrl, timeoutMs = 10000, signal = null) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => {
      socket.terminate();
      finish(
        reject,
        timeoutError('renderer_shutdown', 'Chrome 调试连接因服务关闭而取消')
      );
    };
    const timer = setTimeout(() => {
      socket.terminate();
      finish(reject, timeoutError('renderer_timeout', '连接 Chrome 调试端口超时'));
    }, timeoutMs);
    socket.addEventListener('open', () => finish(resolve), { once: true });
    socket.addEventListener('error', () => finish(
      reject,
      timeoutError('renderer_connection_failed', '无法连接 Chrome 调试端口')
    ), { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
  return new CdpConnection(socket, timeoutMs);
}

module.exports = { CdpConnection, connectCdp };
