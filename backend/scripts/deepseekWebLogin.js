#!/usr/bin/env node

require('dotenv').config({ quiet: true });
const WebPlatformService = require('../services/WebPlatformService');

const STATUS_MESSAGES = {
  login_required: '请在已打开的 Chrome 中人工登录 DeepSeek。',
  verification_required: '请在已打开的 Chrome 中人工完成验证。',
  selector_mismatch: '正在等待 DeepSeek 对话输入区加载。'
};

async function main() {
  const platform = String(process.argv[2] || '').trim().toLowerCase();
  if (platform !== 'deepseek-web') {
    throw Object.assign(
      new Error('用法：npm run web:login -- deepseek-web'),
      { code: 'web_platform_unsupported' }
    );
  }

  let lastStatus;
  const result = await WebPlatformService.waitForInteractiveLogin({
    onStatus(status) {
      if (status === lastStatus) return;
      lastStatus = status;
      console.log(STATUS_MESSAGES[status] || STATUS_MESSAGES.selector_mismatch);
    }
  });
  if (result.ok) {
    console.log('DeepSeek Web 登录状态已确认；专用浏览器会话将正常关闭并保留。');
  }
}

let closing = false;
async function closeAndExit(exitCode) {
  if (closing) return;
  closing = true;
  await WebPlatformService.shutdown().catch(() => {});
  process.exitCode = exitCode;
}

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
