const crypto = require('node:crypto');
const path = require('node:path');

const {
  BaiduMarketingClient
} = require('../modules/marketing/adapters/BaiduMarketingClient');
const {
  auditMarketingConfig
} = require('../modules/marketing/config');
const {
  loadBaiduContract
} = require('../modules/marketing/contracts/baidu/loadBaiduContract');
const {
  decryptSecret
} = require('../services/SecretEncryptionService');

const REPORT_LEVELS = Object.freeze([
  'campaigns',
  'adGroups',
  'keywords',
  'searchTerms'
]);
const ARGUMENTS = Object.freeze(new Set([
  'connection-id',
  'project-id',
  'from',
  'to'
]));

class UnifiedOAuthPreflightError extends Error {
  constructor(message, code, state = 'CONTRACT_INVALID') {
    super(message);
    this.code = code;
    this.state = state;
  }
}

function hashIdentifier(value) {
  return `sha256:${crypto.createHash('sha256')
    .update(String(value))
    .digest('hex')}`;
}

function strictDate(value) {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) return null;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== normalized
    ? null
    : normalized;
}

function latestCompleteShanghaiDate(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(now));
  const date = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const todayUtc = Date.UTC(
    Number(date.year),
    Number(date.month) - 1,
    Number(date.day)
  );
  return new Date(todayUtc - 86_400_000).toISOString().slice(0, 10);
}

function normalizeProbeInput({ connectionId, projectId, coverage, now }) {
  const normalizedConnectionId = String(connectionId || '').trim();
  const normalizedProjectId = String(projectId || '').trim();
  const latestDate = latestCompleteShanghaiDate(now());
  const from = strictDate(coverage?.from || latestDate);
  const to = strictDate(coverage?.to || from);
  if (!/^[A-Za-z0-9-]{1,64}$/u.test(normalizedConnectionId)) {
    throw new UnifiedOAuthPreflightError(
      'connection 参数无效',
      'PREFLIGHT_CONNECTION_INVALID'
    );
  }
  if (!/^[1-9]\d{0,15}$/u.test(normalizedProjectId)) {
    throw new UnifiedOAuthPreflightError(
      'project 参数无效',
      'PREFLIGHT_PROJECT_INVALID'
    );
  }
  if (!from || !to || from !== to || to > latestDate) {
    throw new UnifiedOAuthPreflightError(
      '探针日期必须是一个已结束的上海自然日',
      'PREFLIGHT_COVERAGE_INVALID'
    );
  }
  return {
    connectionId: normalizedConnectionId,
    projectId: normalizedProjectId,
    coverage: { from, to }
  };
}

function parseProbeArguments(argv, now = () => Date.now()) {
  const values = {};
  for (const argument of argv) {
    const match = /^--([a-z-]+)=(.*)$/u.exec(argument);
    if (!match || !ARGUMENTS.has(match[1]) || values[match[1]] !== undefined) {
      throw new UnifiedOAuthPreflightError(
        '探针只接受 connection、project 和受限日期参数',
        'PREFLIGHT_ARGUMENT_INVALID'
      );
    }
    values[match[1]] = match[2];
  }
  return normalizeProbeInput({
    connectionId: values['connection-id'],
    projectId: values['project-id'],
    coverage: { from: values.from, to: values.to },
    now
  });
}

async function readProbeState(sequelize, { connectionId, projectId }) {
  const connections = await sequelize.query(
    `SELECT *
     FROM baidu_marketing_connections
     WHERE id = :connectionId
     LIMIT 1`,
    {
      replacements: { connectionId },
      type: 'SELECT'
    }
  );
  const bindings = await sequelize.query(
    `SELECT *
     FROM baidu_project_bindings
     WHERE connection_id = :connectionId
       AND project_id = :projectId
     ORDER BY id ASC`,
    {
      replacements: { connectionId, projectId },
      type: 'SELECT'
    }
  );
  return { connection: connections[0] || null, bindings };
}

function stableValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => (
    [key, stableValue(value[key])]
  )));
}

function stateDigest(state) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(stableValue(state)))
    .digest();
}

function sameState(before, after) {
  const left = stateDigest(before);
  const right = stateDigest(after);
  return crypto.timingSafeEqual(left, right);
}

function classifyFailure(error) {
  const code = String(error?.code || 'PREFLIGHT_UPSTREAM_FAILED');
  if (error instanceof UnifiedOAuthPreflightError) {
    return { state: error.state, errorCode: code };
  }
  if (code === 'BAIDU_REAUTHORIZATION_REQUIRED') {
    return { state: 'REAUTH_REQUIRED', errorCode: code };
  }
  if (/PERMISSION/u.test(code)) {
    return { state: 'PERMISSION_DENIED', errorCode: code };
  }
  if (/ACCOUNT.*MISMATCH|ACCOUNT_NOT_AVAILABLE/u.test(code)) {
    return { state: 'ACCOUNT_MISMATCH', errorCode: code };
  }
  if (/SITE.*(MISSING|NOT_AVAILABLE)/u.test(code)) {
    return { state: 'SITE_MISSING', errorCode: code };
  }
  if (error?.retryable === true || /RATE_LIMIT/u.test(code)) {
    return { state: 'RATE_LIMITED', errorCode: code };
  }
  if (/RESPONSE_INVALID|SNAPSHOT_UNSTABLE|CONTRACT/u.test(code)) {
    return { state: 'CONTRACT_INVALID', errorCode: code };
  }
  return { state: 'UPSTREAM_ERROR', errorCode: code };
}

function requireRunnableState(state, now) {
  const { connection, bindings } = state;
  if (!connection) {
    throw new UnifiedOAuthPreflightError(
      '连接不存在',
      'PREFLIGHT_CONNECTION_NOT_FOUND'
    );
  }
  if (connection.status !== 'CONNECTED') {
    throw new UnifiedOAuthPreflightError(
      '连接不是 CONNECTED',
      'PREFLIGHT_CONNECTION_NOT_CONNECTED',
      'REAUTH_REQUIRED'
    );
  }
  const accessTokenExpiresAt = new Date(
    connection.access_token_expires_at
  ).getTime();
  if (
    !connection.access_token_ciphertext
    || !Number.isFinite(accessTokenExpiresAt)
    || accessTokenExpiresAt <= now()
  ) {
    throw new UnifiedOAuthPreflightError(
      '当前 Access Token 已过期或不可用',
      'PREFLIGHT_TOKEN_EXPIRED',
      'TOKEN_EXPIRED'
    );
  }
  const refreshClaimUntil = new Date(connection.refresh_claim_until).getTime();
  if (connection.refresh_claim_token && (
    !Number.isFinite(refreshClaimUntil)
    || refreshClaimUntil > now()
  )) {
    throw new UnifiedOAuthPreflightError(
      '当前连接存在 Token 刷新 claim',
      'PREFLIGHT_REFRESH_IN_PROGRESS',
      'TOKEN_STATE_UNSTABLE'
    );
  }
  const activeBindings = bindings.filter((binding) => binding.status === 'ACTIVE');
  if (activeBindings.length === 0) {
    throw new UnifiedOAuthPreflightError(
      '项目没有当前连接的活动绑定',
      'PREFLIGHT_BINDING_NOT_FOUND'
    );
  }
  return activeBindings;
}

async function verifyMarketing({
  provider,
  connection,
  bindings,
  accessToken,
  coverage
}) {
  const accounts = await provider.listAccounts({ connection, accessToken });
  const accountIds = new Set(accounts.map((account) => String(account.accountId)));
  if (bindings.some((binding) => !accountIds.has(String(binding.external_account_id)))) {
    throw new UnifiedOAuthPreflightError(
      '目标搜索推广账户不属于当前 OAuth 连接',
      'PREFLIGHT_MARKETING_ACCOUNT_MISMATCH',
      'ACCOUNT_MISMATCH'
    );
  }

  const reportRowCounts = Object.fromEntries(REPORT_LEVELS.map((level) => [level, 0]));
  const budget = provider.createSearchReportBudget();
  for (const binding of bindings) {
    const reports = await provider.fetchSearchReports({
      budget,
      binding: {
        id: binding.id,
        accountId: binding.external_account_id,
        accountName: binding.external_account_name
      },
      accessToken,
      coverage
    });
    for (const level of REPORT_LEVELS) {
      if (!Array.isArray(reports?.[level])) {
        throw new UnifiedOAuthPreflightError(
          '搜索推广四报表合同不完整',
          'PREFLIGHT_MARKETING_REPORT_INVALID'
        );
      }
      reportRowCounts[level] += reports[level].length;
    }
  }

  return {
    state: 'VERIFIED',
    dataState: Object.values(reportRowCounts).some((count) => count > 0)
      ? 'HAS_DATA'
      : 'NO_DATA',
    reportRowCounts
  };
}

async function verifyTongji({
  provider,
  connection,
  bindings,
  accessToken,
  coverage
}) {
  const accountName = String(connection.tongji_user_name || '').trim();
  if (!accountName) {
    throw new UnifiedOAuthPreflightError(
      '连接缺少已确认的百度统计用户名',
      'PREFLIGHT_TONGJI_ACCOUNT_MISSING',
      'ACCOUNT_MISMATCH'
    );
  }
  const sites = await provider.listTongjiSites({ accountName, accessToken });
  const sitesById = new Map(sites.map((site) => [String(site.siteId), site]));
  let tongjiRowCount = 0;
  const siteIdHashes = [];
  for (const binding of bindings) {
    const site = sitesById.get(String(binding.tongji_site_id));
    if (!site || site.status !== 'ACTIVE') {
      throw new UnifiedOAuthPreflightError(
        '目标百度统计站点不可用',
        'PREFLIGHT_TONGJI_SITE_MISSING',
        'SITE_MISSING'
      );
    }
    if (site.domain !== binding.tongji_site_domain) {
      throw new UnifiedOAuthPreflightError(
        '目标百度统计站点域名不匹配',
        'PREFLIGHT_TONGJI_SITE_DOMAIN_MISMATCH',
        'SITE_MISSING'
      );
    }
    const rows = await provider.fetchTongjiTrend({
      accountName,
      accessToken,
      siteId: site.siteId,
      coverage
    });
    if (!Array.isArray(rows)) {
      throw new UnifiedOAuthPreflightError(
        '百度统计最小数据合同无效',
        'PREFLIGHT_TONGJI_DATA_INVALID'
      );
    }
    tongjiRowCount += rows.length;
    siteIdHashes.push(hashIdentifier(site.siteId));
  }

  return {
    state: 'VERIFIED',
    dataState: tongjiRowCount > 0 ? 'HAS_DATA' : 'NO_DATA',
    siteCount: siteIdHashes.length,
    siteIdHashes: siteIdHashes.sort(),
    rowCount: tongjiRowCount
  };
}

async function runUnifiedOAuthPreflight({
  sequelize,
  provider,
  encryptionKey,
  decryptAccessToken = decryptSecret,
  connectionId,
  projectId,
  coverage = {},
  now = () => Date.now()
}) {
  const input = normalizeProbeInput({
    connectionId,
    projectId,
    coverage,
    now
  });
  const before = await readProbeState(sequelize, input);
  let products;
  try {
    const bindings = requireRunnableState(before, now);
    const accessToken = decryptAccessToken(
      before.connection.access_token_ciphertext,
      encryptionKey
    );
    let marketing;
    try {
      marketing = await verifyMarketing({
        provider,
        connection: before.connection,
        bindings,
        accessToken,
        coverage: input.coverage
      });
    } catch (error) {
      const failure = classifyFailure(error);
      products = {
        marketing: failure,
        tongji: { state: 'NOT_RUN', errorCode: null }
      };
    }
    if (!products) {
      try {
        products = {
          marketing,
          tongji: await verifyTongji({
            provider,
            connection: before.connection,
            bindings,
            accessToken,
            coverage: input.coverage
          })
        };
      } catch (error) {
        const failure = classifyFailure(error);
        products = { marketing, tongji: failure };
      }
    }
  } catch (error) {
    const failure = classifyFailure(error);
    products = {
      marketing: { state: failure.state, errorCode: failure.errorCode },
      tongji: { state: 'NOT_RUN', errorCode: null }
    };
  }

  const after = await readProbeState(sequelize, input);
  if (!sameState(before, after)) {
    throw new UnifiedOAuthPreflightError(
      '探针期间连接或绑定状态发生变化',
      'PREFLIGHT_SIDE_EFFECT_DETECTED',
      'SIDE_EFFECT_DETECTED'
    );
  }
  return {
    connectionIdHash: hashIdentifier(input.connectionId),
    projectId: input.projectId,
    tokenVersion: Number(before.connection?.token_version ?? -1),
    coverage: input.coverage,
    ...products,
    sideEffects: { state: 'UNCHANGED' }
  };
}

function createProductionProvider(env) {
  const config = auditMarketingConfig(env);
  if (!['PILOT_DATA_READY', 'READY'].includes(config.moduleState)) {
    throw new UnifiedOAuthPreflightError(
      '营销模块配置不允许执行生产探针',
      config.errorCode || 'PREFLIGHT_CONFIG_NOT_READY'
    );
  }
  const manifest = loadBaiduContract(env.BAIDU_MARKETING_CONTRACT_VERSION);
  return new BaiduMarketingClient({
    manifest,
    appId: env.BAIDU_MARKETING_APP_ID,
    secretKey: env.BAIDU_MARKETING_SECRET_KEY,
    scope: env.BAIDU_MARKETING_SCOPE,
    redirectUri: env.BAIDU_MARKETING_REDIRECT_URI,
    timeoutMs: Number(env.BAIDU_MARKETING_HTTP_TIMEOUT_MS)
  });
}

async function main() {
  require('dotenv').config({
    path: path.resolve(__dirname, '../.env'),
    quiet: true
  });
  const input = parseProbeArguments(process.argv.slice(2));
  const sequelize = require('../config/database');
  try {
    const result = await runUnifiedOAuthPreflight({
      sequelize,
      provider: createProductionProvider(process.env),
      encryptionKey: process.env.CONFIG_ENCRYPTION_KEY,
      ...input
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (
      result.marketing.state !== 'VERIFIED'
      || result.tongji.state !== 'VERIFIED'
    ) {
      process.exitCode = 2;
    }
  } finally {
    await sequelize.close().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      phase: 'unified_oauth_preflight_failed',
      errorCode: error?.code || 'PREFLIGHT_FAILED',
      state: error?.state || 'UPSTREAM_ERROR'
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseProbeArguments,
  runUnifiedOAuthPreflight
};
