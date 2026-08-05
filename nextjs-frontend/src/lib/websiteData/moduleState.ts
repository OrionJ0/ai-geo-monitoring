/**
 * 官网表单模块的会话级 DISABLED 状态。
 *
 * 生产环境未配置 `GATO_WEBSITE_FORM_*` 时，官网模块 fail-closed 返回必然 503
 * （`WEBSITE_FORM_MODULE_DISABLED`）。首次收到该错误后在本 SPA 会话内记住，
 * 后续页面挂载 / 10 分钟 interval / visibilitychange 都不再重复发送无效请求，
 * 直接用缓存的原因文案展示"官网表单咨询未接入"。刷新浏览器会重置。
 */
let websiteFormDisabledMessage: string | null = null;

export function rememberWebsiteFormDisabled(message: string): void {
  if (websiteFormDisabledMessage === null) {
    websiteFormDisabledMessage = message;
  }
}

export function readWebsiteFormDisabledMessage(): string | null {
  return websiteFormDisabledMessage;
}
