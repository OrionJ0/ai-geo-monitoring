const crypto = require('node:crypto');
const {
  BaiduContractBlockedError,
  BaiduMarketingError,
  isReauthorizationCode
} = require('./BaiduErrors');
const {
  BaiduHttpKernel,
  RAW_RESPONSE_BYTES
} = require('./BaiduHttpKernel');

const ONE_MEBIBYTE = 1024 * 1024;
const REPORT_RESPONSE_BUDGET = 8 * ONE_MEBIBYTE;
const SEARCH_REPORT_REQUEST_BUDGET = 512;
const SEARCH_REPORT_ROW_BUDGET = 250_000;
const SEARCH_REPORT_RESPONSE_BUDGET = 64 * ONE_MEBIBYTE;
const SEARCH_REPORT_TIME_BUDGET_MS = 120_000;
const SEARCH_REPORT_BUDGET_LIMITS = Object.freeze({
  maxRequests: SEARCH_REPORT_REQUEST_BUDGET,
  maxRows: SEARCH_REPORT_ROW_BUDGET,
  maxResponseBytes: SEARCH_REPORT_RESPONSE_BUDGET,
  maxDurationMs: SEARCH_REPORT_TIME_BUDGET_MS
});
const SEARCH_REPORT_LEVELS = Object.freeze([
  'campaigns',
  'adGroups',
  'keywords',
  'searchTerms'
]);

function reportRowsSummary(rows) {
  const rowHashes = rows.map((row) => crypto
    .createHash('sha256')
    .update(JSON.stringify(row))
    .digest('hex'))
    .sort();
  const digest = crypto.createHash('sha256');
  digest.update(`${rowHashes.length}\n`);
  for (const rowHash of rowHashes) digest.update(rowHash);
  return {
    rowCount: rowHashes.length,
    digest: digest.digest('hex')
  };
}

function assertStableSearchReport(firstSummary, secondRows) {
  const secondSummary = reportRowsSummary(secondRows);
  if (
    firstSummary.rowCount !== secondSummary.rowCount
    || firstSummary.digest !== secondSummary.digest
  ) {
    throw new BaiduMarketingError(
      '百度搜索报告两次读取结果不一致',
      'BAIDU_REPORT_SNAPSHOT_UNSTABLE',
      502
    );
  }
}

function monotonicMilliseconds() {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

function waitForMilliseconds(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeSearchReportBudgetLimits(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const limits = { ...SEARCH_REPORT_BUDGET_LIMITS, ...value };
  return Object.entries(SEARCH_REPORT_BUDGET_LIMITS).every(
    ([key, maximum]) => (
      Number.isSafeInteger(limits[key])
      && limits[key] > 0
      && limits[key] <= maximum
    )
  ) ? limits : null;
}

function createSearchReportBudget(clock, limits) {
  const startedAt = clock();
  let requestCount = 0;
  let rowCount = 0;
  let responseBytes = 0;

  const remainingMilliseconds = () => {
    const remaining = limits.maxDurationMs - (clock() - startedAt);
    if (remaining <= 0) {
      throw new BaiduMarketingError(
        '百度搜索报告超过整轮时间预算',
        'BAIDU_REPORT_DEADLINE_EXCEEDED',
        504
      );
    }
    return remaining;
  };

  return {
    beginRequest() {
      const remaining = remainingMilliseconds();
      requestCount += 1;
      if (requestCount > limits.maxRequests) {
        throw new BaiduMarketingError(
          '百度搜索报告超过整轮请求预算',
          'BAIDU_REPORT_RESOURCE_BUDGET_EXCEEDED',
          502
        );
      }
      return remaining;
    },
    remainingResponseBytes() {
      remainingMilliseconds();
      const remaining = limits.maxResponseBytes - responseBytes;
      if (remaining <= 0) {
        throw new BaiduMarketingError(
          '百度搜索报告超过整轮资源预算',
          'BAIDU_REPORT_RESOURCE_BUDGET_EXCEEDED',
          502
        );
      }
      return remaining;
    },
    recordResponse(response, pageRows) {
      remainingMilliseconds();
      rowCount += pageRows;
      responseBytes += response?.[RAW_RESPONSE_BYTES]
        ?? Buffer.byteLength(JSON.stringify(response), 'utf8');
      if (
        rowCount > limits.maxRows
        || responseBytes > limits.maxResponseBytes
      ) {
        throw new BaiduMarketingError(
          '百度搜索报告超过整轮资源预算',
          'BAIDU_REPORT_RESOURCE_BUDGET_EXCEEDED',
          502
        );
      }
    }
  };
}

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

function assertString(value, code) {
  if (typeof value !== 'string' || !value) {
    throw new BaiduMarketingError('百度响应字段无效', code, 502);
  }
  return value;
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
  if (!strictIsoDate(from) || !strictIsoDate(to)) {
    throw new BaiduMarketingError(
      '百度报告日期范围无效',
      'BAIDU_REPORT_DATE_INVALID',
      400
    );
  }
  const fromTime = Date.parse(`${from}T00:00:00.000Z`);
  const toTime = Date.parse(`${to}T00:00:00.000Z`);
  const days = ((toTime - fromTime) / 86400000) + 1;
  if (Number.isNaN(days) || days < 1 || days > maxDays) {
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
      isReauthorizationCode(failureCode)
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

function reportName(value, field, maxLength = 512) {
  if (typeof value !== 'string' || !value || value.length > maxLength) {
    throw new BaiduMarketingError(
      `百度 ${field} 无效`,
      'BAIDU_REPORT_RESPONSE_INVALID',
      502
    );
  }
  return value;
}

function reportEnum(value, field, values) {
  const key = String(value ?? '').trim();
  const normalized = values[key];
  if (!normalized) {
    throw new BaiduMarketingError(
      `百度 ${field} 无效`,
      'BAIDU_REPORT_RESPONSE_INVALID',
      502
    );
  }
  return normalized;
}

function normalizeReportIdentity(row, binding, range) {
  const accountId = reportIdentifier(row?.userId, 'userId');
  if (
    accountId !== String(binding.accountId)
    || row?.userName !== binding.accountName
    || !strictIsoDate(row?.date)
    || row.date < range.from
    || row.date > range.to
  ) {
    throw new BaiduMarketingError(
      '百度搜索报告账户或日期无效',
      'BAIDU_REPORT_RESPONSE_INVALID',
      502
    );
  }
  return { accountId, metricDate: row.date };
}

function normalizeReportMetrics(row, costScale) {
  return {
    impressions: reportIntegerText(row.impression, 'impression'),
    clicks: reportIntegerText(row.click, 'click'),
    costAmountScaled: decimalNumberToScaledText(row.cost, costScale)
  };
}

function normalizeSearchReportRow(row, binding, costScale, range) {
  const identity = normalizeReportIdentity(row, binding, range);
  const campaignId = reportIdentifier(row?.campaignId, 'campaignId');
  return {
    ...identity,
    campaignId,
    campaignName: reportName(row?.campaignNameStatus, 'campaignNameStatus'),
    ...normalizeReportMetrics(row, costScale)
  };
}

function normalizeAdGroupReportRow(row, binding, costScale, range) {
  return {
    ...normalizeReportIdentity(row, binding, range),
    campaignId: reportIdentifier(row?.campaignId, 'campaignId'),
    campaignName: reportName(row?.campaignNameStatus, 'campaignNameStatus'),
    adGroupId: reportIdentifier(row?.adGroupId, 'adGroupId'),
    adGroupName: reportName(row?.adGroupNameStatus, 'adGroupNameStatus'),
    ...normalizeReportMetrics(row, costScale)
  };
}

const TARGETING_TYPES = Object.freeze({
  0: 'KEYWORD',
  1: 'WORD_PACKAGE',
  3: 'AUTO_EXPANSION',
  '关键词': 'KEYWORD',
  '词包': 'WORD_PACKAGE',
  '自动扩量': 'AUTO_EXPANSION'
});

function normalizeKeywordReportRow(row, binding, costScale, range) {
  return {
    ...normalizeAdGroupReportRow(row, binding, costScale, range),
    keywordId: reportIdentifier(row?.wInfoId, 'wInfoId'),
    keywordName: reportName(row?.wInfoNameStatus, 'wInfoNameStatus'),
    targetingType: reportEnum(
      row?.winfoIdTypeEnum,
      'winfoIdTypeEnum',
      TARGETING_TYPES
    )
  };
}

const QUERY_STATUSES = Object.freeze({
  0: 'ADDED',
  1: 'NOT_ADDED',
  2: 'NOT_ADDABLE',
  '已添加': 'ADDED',
  '未添加': 'NOT_ADDED',
  '不可添加': 'NOT_ADDABLE'
});
const MATCH_TYPES = Object.freeze({
  15: 'INTELLIGENT',
  16: 'INTELLIGENT_AUDIENCE',
  31: 'PHRASE',
  63: 'EXACT',
  101: 'EXPANSION_MATCH_SELECTION',
  103: 'URL_TARGETING',
  109: 'PRODUCT_TARGETING',
  110: 'AUTO_EXPANSION',
  111: 'WORD_PACKAGE',
  '智能匹配': 'INTELLIGENT',
  '智能匹配-人群智选': 'INTELLIGENT_AUDIENCE',
  '短语': 'PHRASE',
  '精确': 'EXACT',
  '扩量-匹配智选': 'EXPANSION_MATCH_SELECTION',
  '网址定向': 'URL_TARGETING',
  '商品定向': 'PRODUCT_TARGETING',
  '扩量-自动扩量': 'AUTO_EXPANSION',
  '词包': 'WORD_PACKAGE'
});

function normalizeSearchTermReportRow(row, binding, costScale, range) {
  const searchTerm = reportName(row?.queryWord, 'queryWord', 1024);
  return {
    ...normalizeAdGroupReportRow(row, binding, costScale, range),
    keywordName: reportName(row?.wInfoNameStatus, 'wInfoNameStatus'),
    searchTerm,
    queryStatus: reportEnum(
      row?.queryStatusName,
      'queryStatusName',
      QUERY_STATUSES
    ),
    matchType: reportEnum(row?.wMatchId, 'wMatchId', MATCH_TYPES)
  };
}

class BaiduSearchAdsClient {
  constructor({
    manifest,
    httpKernel,
    monotonicClock = monotonicMilliseconds,
    wait = waitForMilliseconds,
    searchReportBudgetLimits = SEARCH_REPORT_BUDGET_LIMITS
  }) {
    this.manifest = manifest;
    this.httpKernel = httpKernel;
    this.timeoutMs = httpKernel?.timeoutMs;
    this.monotonicClock = monotonicClock;
    this.wait = wait;
    this.searchReportBudgetLimits = normalizeSearchReportBudgetLimits(
      searchReportBudgetLimits
    );
    this.reportNextRequestAt = new Map();
    this.reportRateLimitChains = new Map();
    if (
      !(this.httpKernel instanceof BaiduHttpKernel)
      || typeof this.monotonicClock !== 'function'
      || typeof this.wait !== 'function'
      || !this.searchReportBudgetLimits
    ) {
      throw new BaiduMarketingError(
        '百度营销客户端配置无效',
        'BAIDU_CLIENT_CONFIG_INVALID',
        500
      );
    }
  }

  createSearchReportBudget() {
    return createSearchReportBudget(
      this.monotonicClock,
      this.searchReportBudgetLimits
    );
  }

  async acquireSearchReportSlot(report) {
    const key = String(report.reportType);
    const intervalMilliseconds = Math.ceil(1000 / report.qps);
    const previous = this.reportRateLimitChains.get(key) || Promise.resolve();
    let release;
    const slot = new Promise((resolve) => { release = resolve; });
    const chain = previous.then(() => slot);
    this.reportRateLimitChains.set(key, chain);
    await previous;
    try {
      const nextAllowedAt = this.reportNextRequestAt.get(key)
        ?? this.monotonicClock();
      let now = this.monotonicClock();
      while (now < nextAllowedAt) {
        await this.wait(Math.ceil(nextAllowedAt - now));
        now = this.monotonicClock();
      }
      this.reportNextRequestAt.set(
        key,
        Math.max(now, nextAllowedAt) + intervalMilliseconds
      );
    } finally {
      release();
      if (this.reportRateLimitChains.get(key) === chain) {
        this.reportRateLimitChains.delete(key);
      }
    }
  }

  async fetchConfiguredSearchReport({
    report,
    binding,
    accessToken,
    coverage,
    normalizeRow,
    budget
  }) {
    const range = assertDateRange(coverage, report?.maxDateRangeDays);
    const accountName = assertString(
      binding?.accountName,
      'BAIDU_REPORT_ACCOUNT_INVALID'
    );
    const accountId = assertString(
      binding?.accountId,
      'BAIDU_REPORT_ACCOUNT_INVALID'
    );
    const token = assertString(accessToken, 'BAIDU_ACCESS_TOKEN_INVALID');
    const pageSize = report?.pageSize;
    const maxRows = report?.maxRows;
    const costScale = this.manifest.money?.costScale;
    if (
      report?.method !== 'POST'
      || report?.url
        !== 'https://api.baidu.com/json/sms/service/OpenApiReportService/getReportData'
      || !Number.isSafeInteger(report?.reportType)
      || report?.timeUnit !== 'DAY'
      || !Number.isSafeInteger(report?.qps)
      || report.qps <= 0
      || report.qps > 1000
      || !Array.isArray(report?.columns)
      || !report.columns.length
      || !Number.isSafeInteger(pageSize)
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
      await this.acquireSearchReportSlot(report);
      const remainingMilliseconds = budget?.beginRequest();
      const remainingResponseBytes = budget?.remainingResponseBytes();
      const response = await this.httpKernel.requestJson({
        method: report.method,
        url: report.url,
        maxResponseBytes: remainingResponseBytes == null
          ? REPORT_RESPONSE_BUDGET
          : Math.min(REPORT_RESPONSE_BUDGET, remainingResponseBytes),
        timeoutMs: remainingMilliseconds == null
          ? this.timeoutMs
          : Math.max(1, Math.min(this.timeoutMs, remainingMilliseconds)),
        json: {
          header: { userName: accountName, accessToken: token },
          body: {
            reportType: report.reportType,
            startDate: range.from,
            endDate: range.to,
            timeUnit: report.timeUnit,
            columns: [...report.columns],
            sorts: [],
            filters: [],
            startRow,
            rowCount: pageSize,
            needSum: false
          }
        }
      });
      const page = normalizeReportPage(response);
      budget?.recordResponse(response, page.rowCount);
      if (expectedTotal == null) expectedTotal = page.totalRowCount;
      if (
        page.totalRowCount !== expectedTotal
        || expectedTotal > maxRows
        || page.rowCount > pageSize
        || startRow + page.rowCount > expectedTotal
      ) {
        throw new BaiduMarketingError(
          '百度搜索报告分页无效',
          'BAIDU_REPORT_PAGINATION_INVALID',
          502
        );
      }
      normalizedRows.push(...page.rows.map((row) => (
        normalizeRow(row, { accountId, accountName }, costScale, range)
      )));
      if (normalizedRows.length === expectedTotal) return normalizedRows;
      if (page.rowCount !== pageSize) {
        throw new BaiduMarketingError(
          '百度搜索报告分页未推进',
          'BAIDU_REPORT_PAGINATION_INVALID',
          502
        );
      }
    }
    throw new BaiduMarketingError(
      '百度搜索报告超过行数预算',
      'BAIDU_REPORT_PAGE_BUDGET_EXCEEDED',
      502
    );
  }

  async fetchSearchReport(request) {
    return this.fetchConfiguredSearchReport({
      ...request,
      report: this.manifest.searchPlanReport,
      normalizeRow: normalizeSearchReportRow
    });
  }

  async fetchSearchAdGroupReport(request) {
    return this.fetchConfiguredSearchReport({
      ...request,
      report: this.manifest.searchAdGroupReport,
      normalizeRow: normalizeAdGroupReportRow
    });
  }

  async fetchSearchKeywordReport(request) {
    return this.fetchConfiguredSearchReport({
      ...request,
      report: this.manifest.searchKeywordReport,
      normalizeRow: normalizeKeywordReportRow
    });
  }

  async fetchSearchTermReport(request) {
    return this.fetchConfiguredSearchReport({
      ...request,
      report: this.manifest.searchTermReport,
      normalizeRow: normalizeSearchTermReportRow
    });
  }

  async fetchSearchReports({ budget: sharedBudget = null, ...request }) {
    const budget = sharedBudget || this.createSearchReportBudget();
    const readers = {
      campaigns: () => this.fetchSearchReport({ ...request, budget }),
      adGroups: () => this.fetchSearchAdGroupReport({ ...request, budget }),
      keywords: () => this.fetchSearchKeywordReport({ ...request, budget }),
      searchTerms: () => this.fetchSearchTermReport({ ...request, budget })
    };
    const firstSummaries = {};
    for (const level of SEARCH_REPORT_LEVELS) {
      firstSummaries[level] = reportRowsSummary(await readers[level]());
    }
    const second = {};
    for (const level of SEARCH_REPORT_LEVELS) {
      const rows = await readers[level]();
      assertStableSearchReport(firstSummaries[level], rows);
      second[level] = rows;
    }
    return second;
  }
}

module.exports = {
  BaiduSearchAdsClient,
  decimalNumberToScaledText
};
