const {
  verifyBaiduCallbackSignature
} = require('../domain/baiduOAuthSignature');

const ONE_MEBIBYTE = 1024 * 1024;
const REPORT_RESPONSE_BUDGET = 8 * ONE_MEBIBYTE;
const REAUTHORIZATION_CODES = new Set(['894062', '894063', '894064']);

class BaiduMarketingError extends Error {
  constructor(message, code, status = 502, retryable = false) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

class BaiduContractBlockedError extends BaiduMarketingError {
  constructor() {
    super(
      '百度营销契约尚未达到可运行状态',
      'BAIDU_CONTRACT_NOT_RUNNABLE',
      503
    );
  }
}

function text(value) {
  return String(value ?? '').trim();
}

function documentedAllowlist(manifest) {
  if (
    manifest?.status === 'VERIFIED'
    && Array.isArray(manifest.productionAllowlist)
    && manifest.productionAllowlist.length > 0
  ) {
    return manifest.productionAllowlist;
  }
  if (
    manifest?.status === 'DOCUMENTED_PENDING_PILOT'
    && Array.isArray(manifest.documentedOutboundAllowlist)
    && manifest.documentedOutboundAllowlist.length > 0
  ) {
    return manifest.documentedOutboundAllowlist;
  }
  throw new BaiduContractBlockedError();
}

function numericUserId(value, field = 'userId') {
  const normalized = typeof value === 'number'
    ? String(value)
    : text(value);
  if (!/^\d+$/u.test(normalized)) {
    throw new BaiduMarketingError(
      `百度 ${field} 无效`,
      'BAIDU_IDENTIFIER_INVALID',
      502
    );
  }
  const number = Number(normalized);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new BaiduMarketingError(
      `百度 ${field} 超出安全整数范围`,
      'BAIDU_IDENTIFIER_UNSAFE',
      502
    );
  }
  return number;
}

function positiveInteger(value, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new BaiduMarketingError(
      '百度令牌有效期响应无效',
      code,
      502
    );
  }
  return number;
}

function assertString(value, code) {
  if (typeof value !== 'string' || !value) {
    throw new BaiduMarketingError('百度响应字段无效', code, 502);
  }
  return value;
}

async function readBoundedBody(response, maxResponseBytes) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxResponseBytes) {
      try {
        await reader.cancel();
      } catch {
        // The bounded-response error below remains the stable public outcome.
      }
      throw new BaiduMarketingError(
        '百度接口响应超过大小预算',
        'BAIDU_RESPONSE_TOO_LARGE',
        502
      );
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, totalBytes).toString('utf8');
}

async function defaultTransport({
  method,
  url,
  headers,
  json,
  timeoutMs,
  maxResponseBytes
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(json),
      signal: controller.signal,
      redirect: 'error'
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new BaiduMarketingError(
        '百度接口请求超时',
        'OUTCOME_UNKNOWN',
        504,
        false
      );
    }
    throw new BaiduMarketingError(
      '百度接口网络请求失败',
      'BAIDU_UPSTREAM_UNAVAILABLE',
      502,
      true
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new BaiduMarketingError(
      '百度接口返回 HTTP 错误',
      'BAIDU_HTTP_ERROR',
      502,
      response.status === 429 || response.status >= 500
    );
  }
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > maxResponseBytes) {
    throw new BaiduMarketingError(
      '百度接口响应超过大小预算',
      'BAIDU_RESPONSE_TOO_LARGE',
      502
    );
  }
  let source;
  try {
    source = await readBoundedBody(response, maxResponseBytes);
  } catch (error) {
    if (error instanceof BaiduMarketingError) throw error;
    throw new BaiduMarketingError(
      '百度接口响应读取失败',
      'BAIDU_UPSTREAM_UNAVAILABLE',
      502,
      true
    );
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new BaiduMarketingError(
      '百度接口返回非 JSON 响应',
      'BAIDU_RESPONSE_INVALID',
      502
    );
  }
}

function oauthData(response) {
  if (
    !response
    || typeof response !== 'object'
    || Number(response.code) !== 0
    || !response.data
    || typeof response.data !== 'object'
  ) {
    const providerCode = String(response?.code ?? '');
    throw new BaiduMarketingError(
      '百度 OAuth 接口返回失败',
      REAUTHORIZATION_CODES.has(providerCode)
        ? 'BAIDU_REAUTHORIZATION_REQUIRED'
        : 'BAIDU_OAUTH_FAILED',
      502,
      false
    );
  }
  return response.data;
}

function normalizeTokenData(data, expectedUserId) {
  const userId = numericUserId(data.userId);
  if (String(userId) !== String(numericUserId(expectedUserId))) {
    throw new BaiduMarketingError(
      '百度令牌主体与授权回调不一致',
      'BAIDU_TOKEN_PRINCIPAL_MISMATCH',
      502
    );
  }
  const refreshExpiresInSeconds = data.refreshExpiresIn == null
    ? null
    : positiveInteger(
      data.refreshExpiresIn,
      'BAIDU_REFRESH_EXPIRY_INVALID'
    );
  return {
    principalId: String(userId),
    principalName: null,
    openId: assertString(data.openId, 'BAIDU_OPEN_ID_INVALID'),
    accessToken: assertString(
      data.accessToken,
      'BAIDU_ACCESS_TOKEN_INVALID'
    ),
    refreshToken: data.refreshToken == null
      ? null
      : assertString(
        data.refreshToken,
        'BAIDU_REFRESH_TOKEN_INVALID'
      ),
    expiresInSeconds: positiveInteger(
      data.expiresIn,
      'BAIDU_ACCESS_EXPIRY_INVALID'
    ),
    refreshExpiresInSeconds,
    scope: data.scope == null ? null : String(data.scope)
  };
}

function normalizeAccount(account, idField, nameField) {
  return {
    accountId: String(numericUserId(account?.[idField], idField)),
    accountName: assertString(
      account?.[nameField],
      'BAIDU_ACCOUNT_NAME_INVALID'
    ),
    product: 'SEARCH',
    readOnly: true
  };
}

function assertDateRange(coverage, maxDays) {
  const from = text(coverage?.from);
  const to = text(coverage?.to);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(from)
    || !/^\d{4}-\d{2}-\d{2}$/u.test(to)
  ) {
    throw new BaiduMarketingError(
      '百度报告日期范围无效',
      'BAIDU_REPORT_DATE_INVALID',
      400
    );
  }
  const fromTime = Date.parse(`${from}T00:00:00.000Z`);
  const toTime = Date.parse(`${to}T00:00:00.000Z`);
  const days = ((toTime - fromTime) / 86400000) + 1;
  if (
    Number.isNaN(days)
    || days < 1
    || days > maxDays
  ) {
    throw new BaiduMarketingError(
      '百度报告日期范围超限',
      'BAIDU_REPORT_DATE_RANGE_INVALID',
      400
    );
  }
  return { from, to };
}

class BaiduMarketingClient {
  constructor({
    manifest,
    appId,
    secretKey,
    scope,
    redirectUri,
    timeoutMs = 10000,
    transport = defaultTransport
  }) {
    this.allowlist = new Set(documentedAllowlist(manifest));
    this.manifest = manifest;
    this.appId = text(appId);
    this.secretKey = String(secretKey || '');
    this.scope = text(scope);
    this.redirectUri = text(redirectUri);
    this.timeoutMs = Number(timeoutMs);
    this.transport = transport;
    let parsedRedirectUri = null;
    try {
      parsedRedirectUri = new URL(this.redirectUri);
    } catch {
      parsedRedirectUri = null;
    }
    if (
      !this.appId
      || this.secretKey.length < 16
      || Buffer.byteLength(this.secretKey.slice(0, 16), 'utf8') !== 16
      || !this.scope
      || !this.redirectUri
      || parsedRedirectUri?.protocol !== 'https:'
      || parsedRedirectUri.username
      || parsedRedirectUri.password
      || parsedRedirectUri.search
      || parsedRedirectUri.hash
      || !Number.isInteger(this.timeoutMs)
      || this.timeoutMs < 100
      || this.timeoutMs > 60000
      || typeof this.transport !== 'function'
    ) {
      throw new BaiduMarketingError(
        '百度营销客户端配置无效',
        'BAIDU_CLIENT_CONFIG_INVALID',
        500
      );
    }
  }

  assertAllowed(method, url) {
    const parsed = new URL(url);
    const key = `${method} ${parsed.origin}${parsed.pathname}`;
    if (
      parsed.protocol !== 'https:'
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
      || !this.allowlist.has(key)
    ) {
      throw new BaiduMarketingError(
        '百度出站请求不在契约白名单内',
        'BAIDU_OUTBOUND_NOT_ALLOWED',
        500
      );
    }
  }

  buildAuthorizationUrl({ state }) {
    const normalizedState = String(state || '');
    if (
      !normalizedState
      || normalizedState.length > this.manifest.oauth.authorization.stateMaxLength
    ) {
      throw new BaiduMarketingError(
        '百度授权 state 无效',
        'BAIDU_AUTHORIZATION_STATE_INVALID',
        400
      );
    }
    const url = new URL(this.manifest.oauth.authorization.url);
    this.assertAllowed('GET', url);
    url.searchParams.set(
      'platformId',
      this.manifest.oauth.authorization.platformId
    );
    url.searchParams.set('appId', this.appId);
    url.searchParams.set('scope', this.scope);
    url.searchParams.set('state', normalizedState);
    url.searchParams.set('callback', this.redirectUri);
    return url.toString();
  }

  verifyCallbackSignature(parameters) {
    return (
      parameters?.appId === this.appId
      && verifyBaiduCallbackSignature({
        parameters,
        secretKey: this.secretKey
      })
    );
  }

  async requestJson({
    method,
    url,
    json,
    maxResponseBytes = ONE_MEBIBYTE
  }) {
    this.assertAllowed(method, url);
    return this.transport({
      method,
      url,
      headers: {
        'Content-Type': 'application/json;charset:utf-8'
      },
      json,
      timeoutMs: this.timeoutMs,
      maxResponseBytes
    });
  }

  async exchangeAuthorizationCode({ appId, authCode, userId }) {
    if (appId !== this.appId || typeof authCode !== 'string' || !authCode) {
      throw new BaiduMarketingError(
        '百度授权码请求无效',
        'BAIDU_AUTHORIZATION_CODE_INVALID',
        400
      );
    }
    let response;
    try {
      response = await this.requestJson({
        method: this.manifest.oauth.token.method,
        url: this.manifest.oauth.token.url,
        json: {
          appId: this.appId,
          authCode,
          secretKey: this.secretKey,
          grantType: this.manifest.oauth.token.grantType,
          userId: numericUserId(userId)
        }
      });
    } catch (error) {
      if (error?.code === 'BAIDU_OUTBOUND_NOT_ALLOWED') throw error;
      throw new BaiduMarketingError(
        '百度授权码交换结果未知',
        'OUTCOME_UNKNOWN',
        502
      );
    }
    return normalizeTokenData(oauthData(response), userId);
  }

  async refreshAccessToken({ refreshToken, userId }) {
    const normalizedRefreshToken = assertString(
      refreshToken,
      'BAIDU_REFRESH_TOKEN_INVALID'
    );
    let response;
    try {
      response = await this.requestJson({
        method: this.manifest.oauth.refresh.method,
        url: this.manifest.oauth.refresh.url,
        json: {
          appId: this.appId,
          refreshToken: normalizedRefreshToken,
          secretKey: this.secretKey,
          userId: numericUserId(userId)
        }
      });
    } catch (error) {
      if (error?.code === 'BAIDU_OUTBOUND_NOT_ALLOWED') throw error;
      throw new BaiduMarketingError(
        '百度 Token 刷新结果未知',
        'OUTCOME_UNKNOWN',
        502
      );
    }
    return normalizeTokenData(oauthData(response), userId);
  }

  async listAccounts({ connection, accessToken }) {
    const principalId = String(
      numericUserId(connection?.authorized_principal_id)
    );
    const openId = assertString(
      connection?.authorized_open_id,
      'BAIDU_OPEN_ID_INVALID'
    );
    const token = assertString(
      accessToken,
      'BAIDU_ACCESS_TOKEN_INVALID'
    );
    const pagination = this.manifest.accountDirectory.pagination;
    let cursor = pagination.firstLastPageMaxUcId;
    let masterAccount = null;
    const children = [];
    const seen = new Set();

    for (let page = 0; page < 100; page += 1) {
      const response = await this.requestJson({
        method: this.manifest.oauth.userInfo.method,
        url: this.manifest.oauth.userInfo.url,
        json: {
          openId,
          accessToken: token,
          userId: numericUserId(principalId),
          needSubList: true,
          pageSize: pagination.maxPageSize,
          lastPageMaxUcId: cursor
        }
      });
      const data = oauthData(response);
      const currentMaster = normalizeAccount(data, 'masterUid', 'masterName');
      if (currentMaster.accountId !== principalId) {
        throw new BaiduMarketingError(
          '百度账户目录主体不一致',
          'BAIDU_ACCOUNT_PRINCIPAL_MISMATCH',
          502
        );
      }
      if (!masterAccount) masterAccount = currentMaster;
      if (
        masterAccount.accountName !== currentMaster.accountName
        || ![1, 2, 4].includes(Number(data.userAcctType))
      ) {
        throw new BaiduMarketingError(
          '百度账户目录响应无效',
          'BAIDU_ACCOUNT_DIRECTORY_INVALID',
          502
        );
      }
      const subUsers = data.subUserList == null ? [] : data.subUserList;
      if (!Array.isArray(subUsers)) {
        throw new BaiduMarketingError(
          '百度子账户列表无效',
          'BAIDU_ACCOUNT_DIRECTORY_INVALID',
          502
        );
      }
      let nextCursor = cursor;
      for (const subUser of subUsers) {
        const account = normalizeAccount(subUser, 'ucId', 'ucName');
        if (
          account.accountId === principalId
          || seen.has(account.accountId)
        ) {
          throw new BaiduMarketingError(
            '百度账户目录包含重复账户',
            'BAIDU_ACCOUNT_DIRECTORY_INVALID',
            502
          );
        }
        seen.add(account.accountId);
        children.push(account);
        nextCursor = Math.max(
          nextCursor,
          numericUserId(account.accountId, 'ucId')
        );
      }
      if (data.hasNext !== true) return [masterAccount, ...children];
      if (subUsers.length === 0 || nextCursor <= cursor) {
        throw new BaiduMarketingError(
          '百度账户目录分页游标未推进',
          'BAIDU_ACCOUNT_PAGINATION_INVALID',
          502
        );
      }
      cursor = nextCursor;
    }
    throw new BaiduMarketingError(
      '百度账户目录超过分页预算',
      'BAIDU_ACCOUNT_PAGE_BUDGET_EXCEEDED',
      502
    );
  }

  async fetchSearchReport({ binding, accessToken, coverage }) {
    const range = assertDateRange(
      coverage,
      this.manifest.searchPlanReport.maxDateRangeDays
    );
    const response = await this.requestJson({
      method: this.manifest.searchPlanReport.method,
      url: this.manifest.searchPlanReport.url,
      maxResponseBytes: REPORT_RESPONSE_BUDGET,
      json: {
        header: {
          userName: assertString(
            binding?.accountName,
            'BAIDU_REPORT_ACCOUNT_INVALID'
          ),
          accessToken: assertString(
            accessToken,
            'BAIDU_ACCESS_TOKEN_INVALID'
          )
        },
        body: {
          reportType: this.manifest.searchPlanReport.reportType,
          startDate: range.from,
          endDate: range.to,
          timeUnit: this.manifest.searchPlanReport.timeUnit,
          columns: [...this.manifest.searchPlanReport.columns],
          sorts: [],
          filters: [],
          startRow: 0,
          rowCount: this.manifest.searchPlanReport.pageSize,
          needSum: false
        }
      }
    });
    const status = Number(response?.header?.status);
    if (status !== 0) {
      const failureCode = String(
        response?.header?.failures?.[0]?.code ?? ''
      );
      throw new BaiduMarketingError(
        '百度搜索计划报告返回失败',
        REAUTHORIZATION_CODES.has(failureCode)
          ? 'BAIDU_REAUTHORIZATION_REQUIRED'
          : 'BAIDU_REPORT_FAILED',
        502,
        status === 3
      );
    }
    throw new BaiduMarketingError(
      '百度搜索计划报告响应体尚待真实样本核验',
      'BAIDU_REPORT_RESPONSE_UNVERIFIED',
      503
    );
  }
}

module.exports = {
  BaiduContractBlockedError,
  BaiduMarketingClient,
  BaiduMarketingError
};
