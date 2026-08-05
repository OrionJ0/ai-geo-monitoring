const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parseProbeArguments,
  runUnifiedOAuthPreflight
} = require('../../scripts/verifyBaiduUnifiedOAuth');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createProbeHarness({
  connectionOverrides = {},
  providerOverrides = {},
  mutateConnectionAfterProbe = false
} = {}) {
  const connection = {
    id: 'connection-harness',
    status: 'CONNECTED',
    authorized_principal_id: '1001',
    authorized_open_id: 'open-id-test',
    access_token_ciphertext: 'ciphertext',
    access_token_expires_at: '2099-08-05T00:00:00.000Z',
    auth_generation: 1,
    token_version: 2,
    refresh_claim_token: null,
    refresh_claim_until: null,
    tongji_account_name: 'tongji-user',
    ...connectionOverrides
  };
  const binding = {
    id: 'binding-harness',
    project_id: 11,
    connection_id: connection.id,
    external_account_id: '9001',
    external_account_name: 'account',
    tongji_site_id: '301',
    tongji_site_domain: 'example.test',
    status: 'ACTIVE'
  };
  let connectionReads = 0;
  const sequelize = {
    async query(sql) {
      if (sql.includes('baidu_marketing_connections')) {
        connectionReads += 1;
        const row = clone(connection);
        if (mutateConnectionAfterProbe && connectionReads > 1) {
          row.token_version += 1;
        }
        return [row];
      }
      return [clone(binding)];
    }
  };
  const provider = {
    createSearchReportBudget: () => ({}),
    listAccounts: async () => [{ accountId: binding.external_account_id }],
    fetchSearchReports: async () => ({
      campaigns: [], adGroups: [], keywords: [], searchTerms: []
    }),
    listTongjiSites: async () => [{
      siteId: binding.tongji_site_id,
      domain: binding.tongji_site_domain,
      status: 'ACTIVE'
    }],
    fetchTongjiTrend: async () => [],
    ...providerOverrides
  };
  return {
    sequelize,
    provider,
    encryptionKey: 'key',
    decryptAccessToken: () => 'same-token',
    connectionId: connection.id,
    projectId: '11',
    coverage: { from: '2026-08-04', to: '2026-08-04' },
    now: () => Date.parse('2026-08-05T00:00:00.000Z')
  };
}

test('统一 OAuth 探针只读并以同一当前 Token 验证双产品', async () => {
  const token = 'synthetic-oauth-access-token';
  const connection = {
    id: 'connection-sensitive-id',
    status: 'CONNECTED',
    authorized_principal_id: '1001',
    authorized_open_id: 'open-id-test',
    access_token_ciphertext: 'synthetic-ciphertext',
    access_token_expires_at: '2099-08-05T00:00:00.000Z',
    auth_generation: 3,
    token_version: 7,
    refresh_claim_token: null,
    refresh_claim_until: null,
    tongji_account_name: 'tongji-user-sensitive'
  };
  const binding = {
    id: 'binding-sensitive-id',
    project_id: 11,
    connection_id: connection.id,
    external_account_id: '9001',
    external_account_name: 'account-sensitive-name',
    tongji_site_id: '301',
    tongji_site_domain: 'sensitive.example.test',
    status: 'ACTIVE',
    binding_version: 4,
    paused_reason: null
  };
  const statements = [];
  const sequelize = {
    async query(sql) {
      statements.push(sql.trim());
      assert.match(sql, /^\s*SELECT\b/iu);
      if (sql.includes('baidu_marketing_connections')) {
        return [clone(connection)];
      }
      if (sql.includes('baidu_project_bindings')) {
        return [clone(binding)];
      }
      assert.fail(`未预期的查询: ${sql}`);
    }
  };
  const sharedBudget = { kind: 'shared-search-report-budget' };
  const calls = [];
  const provider = {
    createSearchReportBudget() {
      return sharedBudget;
    },
    async listAccounts(request) {
      calls.push({ kind: 'accounts', request });
      assert.equal(request.accessToken, token);
      return [{ accountId: '9001', accountName: '账户' }];
    },
    async fetchSearchReports(request) {
      calls.push({ kind: 'reports', request });
      assert.equal(request.accessToken, token);
      assert.equal(request.budget, sharedBudget);
      return {
        campaigns: [{ id: 'campaign-sensitive-id' }],
        adGroups: [{ id: 'ad-group-sensitive-id' }],
        keywords: [{ keywordName: 'keyword-sensitive' }],
        searchTerms: [{ searchTerm: 'search-term-sensitive' }]
      };
    },
    async listTongjiSites(request) {
      calls.push({ kind: 'sites', request });
      assert.equal(request.accessToken, token);
      assert.equal(request.accountName, connection.tongji_account_name);
      return [{
        siteId: binding.tongji_site_id,
        domain: binding.tongji_site_domain,
        status: 'ACTIVE'
      }];
    },
    async fetchTongjiTrend(request) {
      calls.push({ kind: 'trend', request });
      assert.equal(request.accessToken, token);
      return [{ date: '2026-08-04', visits: 1 }];
    },
    async refreshAccessToken() {
      assert.fail('只读探针不得刷新 Token');
    }
  };

  const result = await runUnifiedOAuthPreflight({
    sequelize,
    provider,
    encryptionKey: 'synthetic-encryption-key',
    decryptAccessToken: (ciphertext, encryptionKey) => {
      assert.equal(ciphertext, connection.access_token_ciphertext);
      assert.equal(encryptionKey, 'synthetic-encryption-key');
      return token;
    },
    connectionId: connection.id,
    projectId: '11',
    coverage: { from: '2026-08-04', to: '2026-08-04' },
    now: () => Date.parse('2026-08-05T00:00:00.000Z')
  });

  assert.deepEqual(calls.map(({ kind }) => kind), [
    'accounts',
    'reports',
    'sites',
    'trend'
  ]);
  assert.equal(statements.length, 4);
  assert.equal(result.marketing.state, 'VERIFIED');
  assert.deepEqual(result.marketing.reportRowCounts, {
    campaigns: 1,
    adGroups: 1,
    keywords: 1,
    searchTerms: 1
  });
  assert.equal(result.tongji.state, 'VERIFIED');
  assert.equal(result.tongji.rowCount, 1);
  assert.equal(result.sideEffects.state, 'UNCHANGED');

  const serialized = JSON.stringify(result);
  for (const sensitiveValue of [
    token,
    connection.id,
    binding.id,
    binding.external_account_id,
    binding.external_account_name,
    connection.tongji_account_name,
    binding.tongji_site_id,
    binding.tongji_site_domain,
    'campaign-sensitive-id',
    'keyword-sensitive',
    'search-term-sensitive'
  ]) {
    assert.doesNotMatch(serialized, new RegExp(sensitiveValue, 'u'));
  }
});

test('统计权限失败不会抹掉已经通过的搜索推广证据', async () => {
  const connection = {
    id: 'connection-1',
    status: 'CONNECTED',
    authorized_principal_id: '1001',
    authorized_open_id: 'open-id-test',
    access_token_ciphertext: 'ciphertext',
    access_token_expires_at: '2099-08-05T00:00:00.000Z',
    auth_generation: 1,
    token_version: 2,
    refresh_claim_token: null,
    tongji_account_name: 'tongji-user'
  };
  const binding = {
    id: 'binding-1',
    project_id: 11,
    connection_id: connection.id,
    external_account_id: '9001',
    external_account_name: 'account',
    tongji_site_id: '301',
    tongji_site_domain: 'example.test',
    status: 'ACTIVE'
  };
  const sequelize = {
    async query(sql) {
      return sql.includes('baidu_marketing_connections')
        ? [clone(connection)]
        : [clone(binding)];
    }
  };
  const provider = {
    createSearchReportBudget: () => ({}),
    listAccounts: async () => [{ accountId: '9001' }],
    fetchSearchReports: async () => ({
      campaigns: [], adGroups: [], keywords: [], searchTerms: []
    }),
    listTongjiSites: async () => {
      const error = new Error('上游原始正文不得输出');
      error.code = 'BAIDU_TONGJI_PERMISSION_DENIED';
      throw error;
    }
  };

  const result = await runUnifiedOAuthPreflight({
    sequelize,
    provider,
    encryptionKey: 'key',
    decryptAccessToken: () => 'same-token',
    connectionId: connection.id,
    projectId: '11',
    coverage: { from: '2026-08-04', to: '2026-08-04' },
    now: () => Date.parse('2026-08-05T00:00:00.000Z')
  });

  assert.deepEqual(result.marketing, {
    state: 'VERIFIED',
    dataState: 'NO_DATA',
    reportRowCounts: {
      campaigns: 0,
      adGroups: 0,
      keywords: 0,
      searchTerms: 0
    }
  });
  assert.deepEqual(result.tongji, {
    state: 'PERMISSION_DENIED',
    errorCode: 'BAIDU_TONGJI_PERMISSION_DENIED'
  });
  assert.doesNotMatch(JSON.stringify(result), /上游原始正文/u);
});

test('缺少统计用户名时仍独立验证搜索推广', async () => {
  const connection = {
    id: 'connection-2',
    status: 'CONNECTED',
    authorized_principal_id: '1001',
    authorized_open_id: 'open-id-test',
    access_token_ciphertext: 'ciphertext',
    access_token_expires_at: '2099-08-05T00:00:00.000Z',
    auth_generation: 1,
    token_version: 2,
    refresh_claim_token: null,
    tongji_account_name: null
  };
  const binding = {
    id: 'binding-2',
    project_id: 11,
    connection_id: connection.id,
    external_account_id: '9001',
    external_account_name: 'account',
    tongji_site_id: '301',
    tongji_site_domain: 'example.test',
    status: 'ACTIVE'
  };
  const sequelize = {
    async query(sql) {
      return sql.includes('baidu_marketing_connections')
        ? [clone(connection)]
        : [clone(binding)];
    }
  };
  let marketingCalls = 0;
  const result = await runUnifiedOAuthPreflight({
    sequelize,
    provider: {
      createSearchReportBudget: () => ({}),
      listAccounts: async () => {
        marketingCalls += 1;
        return [{ accountId: '9001' }];
      },
      fetchSearchReports: async () => {
        marketingCalls += 1;
        return { campaigns: [], adGroups: [], keywords: [], searchTerms: [] };
      },
      listTongjiSites: async () => assert.fail('缺少用户名时不应请求统计')
    },
    encryptionKey: 'key',
    decryptAccessToken: () => 'same-token',
    connectionId: connection.id,
    projectId: '11',
    coverage: { from: '2026-08-04', to: '2026-08-04' },
    now: () => Date.parse('2026-08-05T00:00:00.000Z')
  });

  assert.equal(marketingCalls, 2);
  assert.equal(result.marketing.state, 'VERIFIED');
  assert.deepEqual(result.tongji, {
    state: 'ACCOUNT_MISMATCH',
    errorCode: 'PREFLIGHT_TONGJI_ACCOUNT_MISSING'
  });
});

test('探针 CLI 拒绝 Token、任意 URL、任意方法和多日范围', () => {
  const now = () => Date.parse('2026-08-05T00:00:00.000Z');
  assert.deepEqual(parseProbeArguments([
    '--connection-id=connection-1',
    '--project-id=11',
    '--from=2026-08-04',
    '--to=2026-08-04'
  ], now), {
    connectionId: 'connection-1',
    projectId: '11',
    coverage: { from: '2026-08-04', to: '2026-08-04' }
  });

  for (const argumentsList of [
    ['--connection-id=connection-1', '--project-id=11', '--access-token=x'],
    ['--connection-id=connection-1', '--project-id=11', '--url=https://example.test'],
    ['--connection-id=connection-1', '--project-id=11', '--method=getData'],
    ['--connection-id=connection-1', '--project-id=11', '--from=2026-08-03', '--to=2026-08-04'],
    ['connection-1', '--project-id=11']
  ]) {
    assert.throws(
      () => parseProbeArguments(argumentsList, now),
      (error) => /^PREFLIGHT_(ARGUMENT|COVERAGE)_INVALID$/u.test(error.code)
    );
  }
});

test('探针明确区分无数据、Token 过期、账户、站点、限流和上游失败', async () => {
  const noData = await runUnifiedOAuthPreflight(createProbeHarness());
  assert.equal(noData.marketing.dataState, 'NO_DATA');
  assert.equal(noData.tongji.dataState, 'NO_DATA');

  const expired = await runUnifiedOAuthPreflight(createProbeHarness({
    connectionOverrides: {
      access_token_expires_at: '2026-08-04T00:00:00.000Z'
    },
    providerOverrides: {
      listAccounts: async () => assert.fail('过期 Token 不得调用上游')
    }
  }));
  assert.equal(expired.marketing.state, 'TOKEN_EXPIRED');

  const invalidExpiry = await runUnifiedOAuthPreflight(createProbeHarness({
    connectionOverrides: { access_token_expires_at: 'not-a-date' },
    providerOverrides: {
      listAccounts: async () => assert.fail('无效 Token 到期时间不得调用上游')
    }
  }));
  assert.equal(invalidExpiry.marketing.state, 'TOKEN_EXPIRED');

  const accountMismatch = await runUnifiedOAuthPreflight(createProbeHarness({
    providerOverrides: { listAccounts: async () => [] }
  }));
  assert.equal(accountMismatch.marketing.state, 'ACCOUNT_MISMATCH');

  const siteMissing = await runUnifiedOAuthPreflight(createProbeHarness({
    providerOverrides: { listTongjiSites: async () => [] }
  }));
  assert.equal(siteMissing.marketing.state, 'VERIFIED');
  assert.equal(siteMissing.tongji.state, 'SITE_MISSING');

  const rateLimited = await runUnifiedOAuthPreflight(createProbeHarness({
    providerOverrides: {
      listAccounts: async () => {
        const error = new Error('rate limited');
        error.code = 'BAIDU_REPORT_FAILED';
        error.retryable = true;
        throw error;
      }
    }
  }));
  assert.equal(rateLimited.marketing.state, 'RATE_LIMITED');

  const upstreamFailure = await runUnifiedOAuthPreflight(createProbeHarness({
    providerOverrides: {
      listAccounts: async () => {
        const error = new Error('network failed');
        error.code = 'BAIDU_UPSTREAM_UNAVAILABLE';
        throw error;
      }
    }
  }));
  assert.equal(upstreamFailure.marketing.state, 'UPSTREAM_ERROR');
});

test('探针检测到并发 Token 或绑定变化时拒绝给出通过结论', async () => {
  await assert.rejects(
    runUnifiedOAuthPreflight(createProbeHarness({
      mutateConnectionAfterProbe: true
    })),
    { code: 'PREFLIGHT_SIDE_EFFECT_DETECTED', state: 'SIDE_EFFECT_DETECTED' }
  );
});
