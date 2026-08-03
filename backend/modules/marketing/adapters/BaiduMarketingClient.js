const {
  verifyBaiduCallbackSignature
} = require('../domain/baiduOAuthSignature');

const ONE_MEBIBYTE = 1024 * 1024;
const REPORT_RESPONSE_BUDGET = 8 * ONE_MEBIBYTE;
const TONGJI_RESPONSE_BUDGET = 2 * ONE_MEBIBYTE;
const REAUTHORIZATION_CODES = new Set(['894062', '894063', '894064']);
const TONGJI_SOURCE_FILTERS = Object.freeze({
  ALL: null,
  DIRECT: 'through',
  SEARCH: 'search,0',
  EXTERNAL: 'link'
});

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
    manifest?.status === 'PILOT_VERIFIED'
    && Array.isArray(manifest.pilotOutboundAllowlist)
    && manifest.pilotOutboundAllowlist.length > 0
  ) {
    return manifest.pilotOutboundAllowlist;
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

function strictIsoDate(value) {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/u.test(value)
  ) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

function assertDateRange(coverage, maxDays) {
  const from = text(coverage?.from);
  const to = text(coverage?.to);
  if (
    !strictIsoDate(from)
    || !strictIsoDate(to)
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
  return { from, to, days };
}

function reportIdentifier(value, field) {
  const normalized = numericUserId(value, field);
  return String(normalized);
}

function reportIntegerText(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BaiduMarketingError(
      `百度 ${field} 无效`,
      'BAIDU_REPORT_RESPONSE_INVALID',
      502
    );
  }
  return String(value);
}

function decimalNumberToScaledText(value, scale) {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < 0
    || !Number.isInteger(scale)
    || scale < 0
    || scale > 18
  ) {
    throw new BaiduMarketingError(
      '百度消费字段无效',
      'BAIDU_REPORT_RESPONSE_INVALID',
      502
    );
  }
  const source = String(value);
  const match = source.match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu);
  if (!match) {
    throw new BaiduMarketingError(
      '百度消费字段无效',
      'BAIDU_REPORT_RESPONSE_INVALID',
      502
    );
  }
  const integer = match[1];
  const fraction = match[2] || '';
  const exponent = Number(match[3] || 0);
  const digits = `${integer}${fraction}`.replace(/^0+(?=\d)/u, '');
  const sourceScale = fraction.length - exponent;
  const scaleDelta = scale - sourceScale;
  if (scaleDelta >= 0) {
    return (
      BigInt(digits || '0')
      * (10n ** BigInt(scaleDelta))
    ).toString();
  }
  const divisor = 10n ** BigInt(-scaleDelta);
  const raw = BigInt(digits || '0');
  if (raw % divisor !== 0n) {
    throw new BaiduMarketingError(
      '百度消费精度超过已验证口径',
      'BAIDU_REPORT_COST_SCALE_INVALID',
      502
    );
  }
  return (raw / divisor).toString();
}

function normalizeReportPage(response) {
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
  const data = response?.body?.data;
  if (
    !Array.isArray(data)
    || data.length !== 1
    || !data[0]
    || typeof data[0] !== 'object'
    || !Array.isArray(data[0].rows)
    || !Number.isSafeInteger(data[0].rowCount)
    || data[0].rowCount < 0
    || !Number.isSafeInteger(data[0].totalRowCount)
    || data[0].totalRowCount < 0
    || data[0].rowCount !== data[0].rows.length
    || data[0].rowCount > data[0].totalRowCount
  ) {
    throw new BaiduMarketingError(
      '百度搜索计划报告响应无效',
      'BAIDU_REPORT_RESPONSE_INVALID',
      502
    );
  }
  return data[0];
}

function normalizeSearchReportRow(row, binding, costScale, range) {
  const accountId = reportIdentifier(row?.userId, 'userId');
  const campaignId = reportIdentifier(row?.campaignId, 'campaignId');
  if (
    accountId !== String(binding.accountId)
    || row?.userName !== binding.accountName
    || !strictIsoDate(row?.date)
    || row.date < range.from
    || row.date > range.to
    || typeof row?.campaignNameStatus !== 'string'
    || !row.campaignNameStatus
  ) {
    throw new BaiduMarketingError(
      '百度搜索计划报告行无效',
      'BAIDU_REPORT_RESPONSE_INVALID',
      502
    );
  }
  return {
    accountId,
    campaignId,
    campaignName: row.campaignNameStatus,
    metricDate: row.date,
    impressions: reportIntegerText(row.impression, 'impression'),
    clicks: reportIntegerText(row.click, 'click'),
    costAmountScaled: decimalNumberToScaledText(row.cost, costScale)
  };
}

function normalizeTongjiEnvelope(response) {
  const status = Number(response?.header?.status);
  if (status !== 0) {
    const failureCode = String(
      response?.header?.failures?.[0]?.code ?? ''
    );
    throw new BaiduMarketingError(
      '百度统计接口返回失败',
      REAUTHORIZATION_CODES.has(failureCode)
        ? 'BAIDU_REAUTHORIZATION_REQUIRED'
        : 'BAIDU_TONGJI_FAILED',
      502,
      status === 3
    );
  }
  const data = response?.body?.data;
  if (!Array.isArray(data) || data.length !== 1) {
    throw new BaiduMarketingError(
      '百度统计响应无效',
      'BAIDU_TONGJI_RESPONSE_INVALID',
      502
    );
  }
  return data[0];
}

function normalizeTongjiMetric(value) {
  if (value === '--') return null;
  if (Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  if (
    typeof value !== 'string'
    || !/^\d{1,3}(?:,\d{3})*$|^\d+$/u.test(value)
  ) {
    throw new BaiduMarketingError(
      '百度统计指标无效',
      'BAIDU_TONGJI_RESPONSE_INVALID',
      502
    );
  }
  return BigInt(value.replaceAll(',', '')).toString();
}

function tongjiSourceFilter(sourceKey = 'ALL') {
  if (!Object.hasOwn(TONGJI_SOURCE_FILTERS, sourceKey)) {
    throw new BaiduMarketingError(
      '百度统计来源筛选无效',
      'BAIDU_TONGJI_SOURCE_INVALID',
      400
    );
  }
  return TONGJI_SOURCE_FILTERS[sourceKey];
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
    const accountName = assertString(
      binding?.accountName,
      'BAIDU_REPORT_ACCOUNT_INVALID'
    );
    const accountId = assertString(
      binding?.accountId,
      'BAIDU_REPORT_ACCOUNT_INVALID'
    );
    const token = assertString(
      accessToken,
      'BAIDU_ACCESS_TOKEN_INVALID'
    );
    const pageSize = this.manifest.searchPlanReport.pageSize;
    const maxRows = this.manifest.searchPlanReport.maxRows;
    const costScale = this.manifest.money?.costScale;
    if (
      !Number.isSafeInteger(pageSize)
      || pageSize <= 0
      || !Number.isSafeInteger(maxRows)
      || maxRows <= 0
      || !Number.isInteger(costScale)
      || costScale < 0
      || costScale > 18
    ) {
      throw new BaiduContractBlockedError();
    }

    const normalizedRows = [];
    let expectedTotal = null;
    for (let startRow = 0; startRow <= maxRows; startRow += pageSize) {
      const response = await this.requestJson({
        method: this.manifest.searchPlanReport.method,
        url: this.manifest.searchPlanReport.url,
        maxResponseBytes: REPORT_RESPONSE_BUDGET,
        json: {
          header: {
            userName: accountName,
            accessToken: token
          },
          body: {
            reportType: this.manifest.searchPlanReport.reportType,
            startDate: range.from,
            endDate: range.to,
            timeUnit: this.manifest.searchPlanReport.timeUnit,
            columns: [...this.manifest.searchPlanReport.columns],
            sorts: [],
            filters: [],
            startRow,
            rowCount: pageSize,
            needSum: false
          }
        }
      });
      const page = normalizeReportPage(response);
      if (expectedTotal == null) expectedTotal = page.totalRowCount;
      if (
        page.totalRowCount !== expectedTotal
        || expectedTotal > maxRows
        || page.rowCount > pageSize
        || startRow + page.rowCount > expectedTotal
      ) {
        throw new BaiduMarketingError(
          '百度搜索计划报告分页无效',
          'BAIDU_REPORT_PAGINATION_INVALID',
          502
        );
      }
      normalizedRows.push(...page.rows.map((row) => (
        normalizeSearchReportRow(
          row,
          { accountId, accountName },
          costScale,
          range
        )
      )));
      if (normalizedRows.length === expectedTotal) return normalizedRows;
      if (page.rowCount !== pageSize) {
        throw new BaiduMarketingError(
          '百度搜索计划报告分页未推进',
          'BAIDU_REPORT_PAGINATION_INVALID',
          502
        );
      }
    }
    throw new BaiduMarketingError(
      '百度搜索计划报告超过行数预算',
      'BAIDU_REPORT_PAGE_BUDGET_EXCEEDED',
      502
    );
  }

  async listTongjiSites({ accountName, accessToken }) {
    const response = await this.requestJson({
      method: this.manifest.tongji.siteDirectory.method,
      url: this.manifest.tongji.siteDirectory.url,
      maxResponseBytes: TONGJI_RESPONSE_BUDGET,
      json: {
        header: {
          userName: assertString(
            accountName,
            'BAIDU_TONGJI_ACCOUNT_INVALID'
          ),
          accessToken: assertString(
            accessToken,
            'BAIDU_ACCESS_TOKEN_INVALID'
          )
        },
        body: {}
      }
    });
    const list = normalizeTongjiEnvelope(response)?.list;
    if (!Array.isArray(list)) {
      throw new BaiduMarketingError(
        '百度统计站点目录无效',
        'BAIDU_TONGJI_RESPONSE_INVALID',
        502
      );
    }
    const seen = new Set();
    return list.map((site) => {
      const siteId = reportIdentifier(site?.site_id, 'site_id');
      const domain = text(site?.domain);
      const status = Number(site?.status);
      if (
        !domain
        || domain.length > 255
        || ![0, 1].includes(status)
        || seen.has(siteId)
      ) {
        throw new BaiduMarketingError(
          '百度统计站点目录无效',
          'BAIDU_TONGJI_RESPONSE_INVALID',
          502
        );
      }
      seen.add(siteId);
      return {
        siteId,
        domain,
        status: status === 0 ? 'ACTIVE' : 'PAUSED'
      };
    });
  }

  async fetchTongjiTrend({
    accountName,
    accessToken,
    siteId,
    coverage,
    sourceKey = 'ALL'
  }) {
    const range = assertDateRange(coverage, 731);
    const normalizedSiteId = reportIdentifier(siteId, 'site_id');
    const metrics = this.manifest.tongji.report.metrics;
    const source = tongjiSourceFilter(sourceKey);
    const response = await this.requestJson({
      method: this.manifest.tongji.report.method,
      url: this.manifest.tongji.report.url,
      maxResponseBytes: TONGJI_RESPONSE_BUDGET,
      json: {
        header: {
          userName: assertString(
            accountName,
            'BAIDU_TONGJI_ACCOUNT_INVALID'
          ),
          accessToken: assertString(
            accessToken,
            'BAIDU_ACCESS_TOKEN_INVALID'
          )
        },
        body: {
          site_id: Number(normalizedSiteId),
          method: this.manifest.tongji.report.reportMethod,
          start_date: range.from.replaceAll('-', ''),
          end_date: range.to.replaceAll('-', ''),
          metrics: metrics.join(','),
          max_results: range.days,
          gran: 'day',
          ...(source ? { source } : {})
        }
      }
    });
    const result = normalizeTongjiEnvelope(response)?.result;
    if (
      !result
      || typeof result !== 'object'
      || !Array.isArray(result.fields)
      || result.fields.length !== metrics.length + 1
      || result.fields[0] !== 'simple_date_title'
      || !metrics.every((field, index) => (
        result.fields[index + 1] === field
      ))
      || !Array.isArray(result.items)
      || result.items.length !== 4
      || !Array.isArray(result.items[0])
      || !Array.isArray(result.items[1])
      || result.items[0].length !== result.items[1].length
      || !Number.isSafeInteger(result.total)
      || result.total < 0
      || result.total !== result.items[0].length
      || result.offset !== 0
    ) {
      throw new BaiduMarketingError(
        '百度统计趋势响应无效',
        'BAIDU_TONGJI_RESPONSE_INVALID',
        502
      );
    }
    const seenDates = new Set();
    return result.items[0].map((dimension, index) => {
      const metricRow = result.items[1][index];
      const rawDate = dimension?.[0];
      if (
        !Array.isArray(dimension)
        || dimension.length !== 1
        || typeof rawDate !== 'string'
        || !/^\d{4}\/\d{2}\/\d{2}$/u.test(rawDate)
        || !Array.isArray(metricRow)
        || metricRow.length !== metrics.length
      ) {
        throw new BaiduMarketingError(
          '百度统计趋势行无效',
          'BAIDU_TONGJI_RESPONSE_INVALID',
          502
        );
      }
      const date = rawDate.replaceAll('/', '-');
      if (
        !strictIsoDate(date)
        || date < range.from
        || date > range.to
        || seenDates.has(date)
      ) {
        throw new BaiduMarketingError(
          '百度统计趋势日期无效',
          'BAIDU_TONGJI_RESPONSE_INVALID',
          502
        );
      }
      seenDates.add(date);
      return {
        date,
        pageviews: normalizeTongjiMetric(metricRow[0]),
        visits: normalizeTongjiMetric(metricRow[1]),
        visitors: normalizeTongjiMetric(metricRow[2])
      };
    }).sort((left, right) => left.date.localeCompare(right.date));
  }
}

module.exports = {
  BaiduContractBlockedError,
  BaiduMarketingClient,
  BaiduMarketingError,
  decimalNumberToScaledText
};
