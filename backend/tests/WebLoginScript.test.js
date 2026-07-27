const test = require('node:test');
const assert = require('node:assert/strict');

const { runWebLogin } = require('../scripts/webLogin');

test('interactive login selects one managed Web platform and closes every registry service', async () => {
  const events = [];
  const registry = {
    hasDefinition(code) {
      return code === 'doubao-web';
    },
    getDefinition(code) {
      return { code, displayName: '豆包网页版' };
    },
    getService(code) {
      assert.equal(code, 'doubao-web');
      return {
        async waitForInteractiveLogin({ onStatus }) {
          onStatus('login_required');
          onStatus('verification_required');
          return { ok: true };
        }
      };
    },
    async shutdown() {
      events.push('shutdown');
    }
  };

  const result = await runWebLogin({
    platformCode: 'doubao-web',
    registry,
    writeLine: (line) => events.push(line)
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(events, [
    '请在已打开的 Chrome 中人工登录豆包网页版。',
    '请在已打开的 Chrome 中人工完成验证。',
    '豆包网页版登录状态已确认；专用浏览器会话将正常关闭并保留。',
    'shutdown'
  ]);
});

test('interactive login rejects unknown or API platforms without creating a service', async () => {
  let serviceCalls = 0;
  await assert.rejects(
    () => runWebLogin({
      platformCode: 'doubao',
      registry: {
        hasDefinition: () => false,
        getService() {
          serviceCalls += 1;
        },
        shutdown: async () => {}
      },
      writeLine: () => {}
    }),
    (error) => error.code === 'web_platform_unsupported'
  );
  assert.equal(serviceCalls, 0);
});
