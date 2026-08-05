const {
  verifyBaiduCallbackSignature
} = require('../../domain/baiduOAuthSignature');
const {
  BaiduMarketingError,
  isReauthorizationCode
} = require('./BaiduErrors');
const { BaiduHttpKernel } = require('./BaiduHttpKernel');

function text(value) {
  return String(value ?? '').trim();
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

function oauthData(response) {
  if (
    !response
    || typeof response !== 'object'
    || Number(response.code) !== 0
    || !response.data
    || typeof response.data !== 'object'
  ) {
    throw new BaiduMarketingError(
      '百度 OAuth 接口返回失败',
      isReauthorizationCode(response?.code)
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

class BaiduOAuthClient {
  constructor({ manifest, appId, secretKey, scope, redirectUri, httpKernel }) {
    this.manifest = manifest;
    this.appId = text(appId);
    this.secretKey = String(secretKey || '');
    this.scope = text(scope);
    this.redirectUri = text(redirectUri);
    this.httpKernel = httpKernel;
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
      || !(this.httpKernel instanceof BaiduHttpKernel)
    ) {
      throw new BaiduMarketingError(
        '百度营销客户端配置无效',
        'BAIDU_CLIENT_CONFIG_INVALID',
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
    this.httpKernel.assertAllowed('GET', url);
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
      response = await this.httpKernel.requestJson({
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
      response = await this.httpKernel.requestJson({
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
      const response = await this.httpKernel.requestJson({
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
}

module.exports = { BaiduOAuthClient };
