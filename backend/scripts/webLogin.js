#!/usr/bin/env node

require('dotenv').config({ quiet: true });
const WebPlatformRegistry = require('../services/WebPlatformRegistry');

function unsupportedError() {
  return Object.assign(
    new Error('用法：npm run web:login -- <platformCode>'),
    { code: 'web_platform_unsupported' }
  );
}

async function runWebLogin({
  platformCode,
  registry = WebPlatformRegistry,
  writeLine = console.log
}) {
  const code = String(platformCode || '').trim().toLowerCase();
  if (!registry.hasDefinition(code)) throw unsupportedError();

  const definition = registry.getDefinition(code);
  const service = registry.getService(code);
  let lastStatus;
  const statusMessages = {
    login_required: `请在已打开的 Chrome 中人工登录${definition.displayName}。`,
    verification_required: `请在已打开的 Chrome 中人工完成验证。`,
    selector_mismatch: `正在等待${definition.displayName}对话输入区加载。`
  };

  try {
    const result = await service.waitForInteractiveLogin({
      onStatus(status) {
        if (status === lastStatus) return;
        lastStatus = status;
        writeLine(statusMessages[status] || statusMessages.selector_mismatch);
      }
    });
    if (result.ok) {
      writeLine(`${definition.displayName}登录状态已确认；专用浏览器会话将正常关闭并保留。`);
    }
    return result;
  } finally {
    await registry.shutdown().catch(() => {});
  }
}

async function main() {
  return runWebLogin({ platformCode: process.argv[2] });
}

if (require.main === module) {
  let closing = false;
  const closeAndExit = async (exitCode) => {
    if (closing) return;
    closing = true;
    await WebPlatformRegistry.shutdown().catch(() => {});
    process.exitCode = exitCode;
  };
  process.once('SIGINT', () => {
    closeAndExit(130);
  });
  process.once('SIGTERM', () => {
    closeAndExit(143);
  });
  main()
    .then(() => closeAndExit(0))
    .catch(async (error) => {
      console.error(`${error.code || 'web_login_failed'}: ${error.message}`);
      await closeAndExit(1);
    });
}

module.exports = {
  runWebLogin,
  unsupportedError
};
