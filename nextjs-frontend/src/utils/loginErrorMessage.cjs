function getLoginErrorMessage(error) {
  const status = error?.response?.status;
  const backendMessage = error?.response?.data?.message;

  if (typeof backendMessage === 'string' && /禁用|禁止/.test(backendMessage)) {
    return '被禁止登录：请联系管理员';
  }
  if (status === 401) {
    return backendMessage || '用户名或密码错误';
  }
  if (!error?.response) {
    return '无法连接服务器，请检查 API 代理或网络配置';
  }
  if (status >= 500) {
    return '服务器暂时不可用，请稍后重试';
  }
  return backendMessage || '登录失败，请稍后重试';
}

module.exports = { getLoginErrorMessage };
