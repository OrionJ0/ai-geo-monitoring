// 生产后端只监听回环地址；Express 会从右向左跳过本机代理，
// 并在第一个非回环地址停止，忽略客户端伪造的更左侧前缀。
const TRUSTED_PROXY_POLICY = 'loopback';

function configureTrustedProxy(app) {
  app.set('trust proxy', TRUSTED_PROXY_POLICY);
  return app;
}

module.exports = {
  TRUSTED_PROXY_POLICY,
  configureTrustedProxy
};
