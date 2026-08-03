function buildPostgresTlsOptions(env = process.env) {
  const rejectUnauthorized = env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';
  if (env.NODE_ENV === 'production' && !rejectUnauthorized) {
    const error = new Error('生产环境必须校验 Postgres TLS 服务器证书');
    error.code = 'POSTGRES_TLS_VERIFICATION_REQUIRED';
    throw error;
  }
  return {
    require: true,
    rejectUnauthorized,
    ...(env.DB_SSL_CA
      ? { ca: String(env.DB_SSL_CA).replace(/\\n/gu, '\n') }
      : {})
  };
}

module.exports = { buildPostgresTlsOptions };
