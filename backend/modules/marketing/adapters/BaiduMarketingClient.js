const crypto = require('node:crypto');
const {
  BaiduContractBlockedError,
  BaiduMarketingError,
  isReauthorizationCode
} = require('./baidu/BaiduErrors');
const {
  BaiduHttpKernel,
  RAW_RESPONSE_BYTES
} = require('./baidu/BaiduHttpKernel');
const { BaiduOAuthClient } = require('./baidu/BaiduOAuthClient');

const ONE_MEBIBYTE = 1024 * 1024;
const REPORT_RESPONSE_BUDGET = 8 * ONE_MEBIBYTE;
const TONGJI_RESPONSE_BUDGET = 2 * ONE_MEBIBYTE;
const TONGJI_PAGE_REPORT_TIME_BUDGET_MS = 30_000;
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
const TONGJI_SOURCE_FILTERS = Object.freeze({
  ALL: null,
  BAIDU_PAID: 'searchBaiduPro',
  DIRECT: 'through',
  SEARCH: 'search,0',
  EXTERNAL: 'link',
  BAIDU_NATURAL: 'searchBaiduNature',
  OTHER_SEARCH: 'searchOther'
});
const TONGJI_DEVICES = new Set(['all', 'pc', 'mobile']);
const TONGJI_QUALITY_METRICS = Object.freeze([
  'bounce_ratio',
  'avg_visit_time',
  'avg_visit_pages'
]);
const TONGJI_SOURCE_REPORTS = Object.freeze({
  ALL: {
    method: 'source/all/a',
    dimensionField: 'source_type_title'
  },
  ENGINE: {
    method: 'source/engine/a',
    dimensionField: 'source_engine_title'
  }
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

function validPageIdentity(value) {
  return /^[^\u0000-\u001f\u007f]{1,200}$/u.test(value);
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
  if (
    typeof value !== 'string'
    || !value
    || value.length > maxLength
  ) {
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

function normalizeTongjiEnvelope(response) {
  const status = Number(response?.header?.status);
  if (status !== 0) {
    const failureCode = String(
      response?.header?.failures?.[0]?.code ?? ''
    );
    throw new BaiduMarketingError(
      '百度统计接口返回失败',
      isReauthorizationCode(failureCode)
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

function normalizeTongjiMetric(value, metric = null) {
  if (value === '--') return null;
  if (Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  if (
    typeof value !== 'string'
    || !/^\d{1,3}(?:,\d{3})*$|^\d+$/u.test(value)
  ) {
    const error = new BaiduMarketingError(
      '百度统计指标无效',
      'BAIDU_TONGJI_RESPONSE_INVALID',
      502
    );
    if (metric) error.metric = metric;
    throw error;
  }
  return BigInt(value.replaceAll(',', '')).toString();
}

function normalizeTongjiDecimalMetric(value) {
  if (value === '--') return null;
  const normalized = typeof value === 'number' ? String(value) : value;
  if (
    typeof normalized !== 'string'
    || !/^\d+(?:\.\d+)?$/u.test(normalized)
    || normalized.length > 64
    || !Number.isFinite(Number(normalized))
  ) {
    throw new BaiduMarketingError(
      '百度统计质量指标无效',
      'BAIDU_TONGJI_RESPONSE_INVALID',
      502
    );
  }
  const [whole, fraction = ''] = normalized.split('.');
  const canonicalWhole = BigInt(whole).toString();
  const canonicalFraction = fraction.replace(/0+$/u, '');
  return canonicalFraction
    ? `${canonicalWhole}.${canonicalFraction}`
    : canonicalWhole;
}

function tongjiSourceFilter(sourceKey = 'ALL') {
  const engineMatch = /^ENGINE:(\d+)$/u.exec(sourceKey);
  if (engineMatch) return `search,${engineMatch[1]}`;
  if (!Object.hasOwn(TONGJI_SOURCE_FILTERS, sourceKey)) {
    throw new BaiduMarketingError(
      '百度统计来源筛选无效',
      'BAIDU_TONGJI_SOURCE_INVALID',
      400
    );
  }
  return TONGJI_SOURCE_FILTERS[sourceKey];
}

function tongjiDeviceFilter(device = null) {
  if (device == null || device === 'all') return null;
  if (!TONGJI_DEVICES.has(device)) {
    throw new BaiduMarketingError(
      '百度统计设备筛选无效',
      'BAIDU_TONGJI_DEVICE_INVALID',
      400
    );
  }
  return device;
}

function normalizeTongjiQualityTrendResult(result, range) {
  if (
    !result
    || typeof result !== 'object'
    || !Array.isArray(result.fields)
    || result.fields.length !== TONGJI_QUALITY_METRICS.length + 1
    || result.fields[0] !== 'simple_date_title'
    || !TONGJI_QUALITY_METRICS.every((field, index) => (
      result.fields[index + 1] === field
    ))
    || !Array.isArray(result.items)
    || result.items.length !== 4
    || !Array.isArray(result.items[0])
    || !Array.isArray(result.items[1])
    || result.items[0].length !== result.items[1].length
    || !Array.isArray(result.sum)
    || result.sum.length !== 2
    || !Array.isArray(result.sum[0])
    || result.sum[0].length !== TONGJI_QUALITY_METRICS.length
    || !Array.isArray(result.sum[1])
    || result.sum[1].length !== 0
    || !Number.isSafeInteger(result.total)
    || result.total < 0
    || result.total !== result.items[0].length
    || result.offset !== 0
  ) {
    throw new BaiduMarketingError(
      '百度统计质量趋势响应无效',
      'BAIDU_TONGJI_RESPONSE_INVALID',
      502
    );
  }
  const seenDates = new Set();
  const rows = result.items[0].map((dimension, index) => {
    const metricRow = result.items[1][index];
    const rawDate = dimension?.[0];
    if (
      !Array.isArray(dimension)
      || dimension.length !== 1
      || typeof rawDate !== 'string'
      || !/^\d{4}\/\d{2}\/\d{2}$/u.test(rawDate)
      || !Array.isArray(metricRow)
      || metricRow.length !== TONGJI_QUALITY_METRICS.length
    ) {
      throw new BaiduMarketingError(
        '百度统计质量趋势行无效',
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
        '百度统计质量趋势日期无效',
        'BAIDU_TONGJI_RESPONSE_INVALID',
        502
      );
    }
    seenDates.add(date);
    return {
      date,
      bounceRate: normalizeTongjiDecimalMetric(metricRow[0]),
      averageVisitTimeSeconds: normalizeTongjiDecimalMetric(metricRow[1]),
      averageVisitPages: normalizeTongjiDecimalMetric(metricRow[2])
    };
  }).sort((left, right) => left.date.localeCompare(right.date));
  return {
    summary: {
      bounceRate: normalizeTongjiDecimalMetric(result.sum[0][0]),
      averageVisitTimeSeconds: normalizeTongjiDecimalMetric(result.sum[0][1]),
      averageVisitPages: normalizeTongjiDecimalMetric(result.sum[0][2])
    },
    rows
  };
}

function normalizeTongjiPageReportResult(
  result,
  view,
  report,
  expectedOffset
) {
  const metrics = report?.metrics;
  if (
    !result
    || typeof result !== 'object'
    || !Array.isArray(metrics)
    || !report.dimensionField
    || !Array.isArray(result.fields)
    || result.fields.length !== metrics.length + 1
    || result.fields[0] !== report.dimensionField
    || !metrics.every((field, index) => result.fields[index + 1] === field)
    || !Array.isArray(result.items)
    || result.items.length !== 4
    || !Array.isArray(result.items[0])
    || !Array.isArray(result.items[1])
    || result.items[0].length !== result.items[1].length
    || !Number.isSafeInteger(result.total)
    || result.total < 0
    || result.total > 10000
    || result.items[0].length > result.total
    || !Number.isSafeInteger(result.offset)
    || result.offset !== expectedOffset
  ) {
    throw new BaiduMarketingError(
      '百度统计页面报告响应无效',
      'BAIDU_TONGJI_RESPONSE_INVALID',
      502
    );
  }
  const seen = new Set();
  const rows = result.items[0].map((dimension, index) => {
    const item = dimension?.[0];
    const metricRow = result.items[1][index];
    const pageId = text(item?.pageId);
    const rawUrl = text(item?.name);
    let pageUrl;
    try {
      const parsed = new URL(rawUrl);
      if (
        !['http:', 'https:'].includes(parsed.protocol)
        || parsed.username
        || parsed.password
      ) throw new Error('invalid');
      parsed.search = '';
      parsed.hash = '';
      pageUrl = parsed.toString();
    } catch {
      throw new BaiduMarketingError(
        '百度统计页面标识无效',
        'BAIDU_TONGJI_RESPONSE_INVALID',
        502
      );
    }
    if (
      !Array.isArray(dimension)
      || dimension.length !== 1
      || !item
      || typeof item !== 'object'
      || !validPageIdentity(pageId)
      || rawUrl.length > 4096
      || seen.has(pageId)
      || !Array.isArray(metricRow)
      || metricRow.length !== metrics.length
    ) {
      throw new BaiduMarketingError(
        '百度统计页面报告行无效',
        'BAIDU_TONGJI_RESPONSE_INVALID',
        502
      );
    }
    seen.add(pageId);
    if (view === 'landing') {
      return {
        pageId,
        pageUrl,
        visits: normalizeTongjiMetric(metricRow[0], 'visits'),
        contributionPageviews: normalizeTongjiMetric(metricRow[1]),
        bounceRate: normalizeTongjiDecimalMetric(metricRow[2]),
        averageVisitTimeSeconds: normalizeTongjiDecimalMetric(metricRow[3]),
        averageVisitPages: normalizeTongjiDecimalMetric(metricRow[4])
      };
    }
    return {
      pageId,
      pageUrl,
      pageviews: normalizeTongjiMetric(metricRow[0]),
      visitors: normalizeTongjiMetric(metricRow[1]),
      averageStayTimeSeconds: normalizeTongjiDecimalMetric(metricRow[2]),
      downstreamPageviews: normalizeTongjiMetric(metricRow[3]),
      exitRate: normalizeTongjiDecimalMetric(metricRow[4])
    };
  });
  return { total: result.total, offset: result.offset, rows };
}

function normalizeTongjiSourceResult(result, metrics, report) {
  if (
    !result
    || typeof result !== 'object'
    || !Array.isArray(result.fields)
    || result.fields.length !== metrics.length + 1
    || result.fields[0] !== report.dimensionField
    || !metrics.every((field, index) => result.fields[index + 1] === field)
    || !Array.isArray(result.items)
    || result.items.length !== 4
    || !Array.isArray(result.items[0])
    || !Array.isArray(result.items[1])
    || result.items[0].length !== result.items[1].length
    || !Number.isSafeInteger(result.total)
    || result.total < 0
    || result.total > 100
    || result.total !== result.items[0].length
    || (result.offset ?? 0) !== 0
  ) {
    throw new BaiduMarketingError(
      '百度统计来源响应无效',
      'BAIDU_TONGJI_RESPONSE_INVALID',
      502
    );
  }
  const seen = new Set();
  return result.items[0].map((dimension, index) => {
    const item = dimension?.[0];
    const metricRow = result.items[1][index];
    const name = text(item?.name);
    const source = text(item?.source);
    const engineId = item?.engineId == null ? null : text(item.engineId);
    const url = item?.url == null ? null : text(item.url);
    if (
      !Array.isArray(dimension)
      || dimension.length !== 1
      || !item
      || typeof item !== 'object'
      || !name
      || name.length > 200
      || !source
      || source.length > 100
      || (engineId !== null && !/^\d+$/u.test(engineId))
      || (url !== null && url.length > 512)
      || !Array.isArray(metricRow)
      || metricRow.length !== metrics.length
      || seen.has(source)
    ) {
      throw new BaiduMarketingError(
        '百度统计来源行无效',
        'BAIDU_TONGJI_RESPONSE_INVALID',
        502
      );
    }
    seen.add(source);
    return {
      name,
      source,
      engineId,
      url,
      pageviews: normalizeTongjiMetric(metricRow[0]),
      visits: normalizeTongjiMetric(metricRow[1], 'visits'),
      visitors: normalizeTongjiMetric(metricRow[2])
    };
  });
}

class BaiduMarketingClient {
  constructor({
    manifest,
    appId,
    secretKey,
    scope,
    redirectUri,
    timeoutMs = 10000,
    transport,
    monotonicClock = monotonicMilliseconds,
    wait = waitForMilliseconds,
    searchReportBudgetLimits = SEARCH_REPORT_BUDGET_LIMITS
  }) {
    this.manifest = manifest;
    this.httpKernel = new BaiduHttpKernel({
      manifest,
      timeoutMs,
      transport
    });
    this.oauthClient = new BaiduOAuthClient({
      manifest,
      appId,
      secretKey,
      scope,
      redirectUri,
      httpKernel: this.httpKernel
    });
    this.timeoutMs = this.httpKernel.timeoutMs;
    this.monotonicClock = monotonicClock;
    this.wait = wait;
    this.searchReportBudgetLimits = normalizeSearchReportBudgetLimits(
      searchReportBudgetLimits
    );
    this.reportNextRequestAt = new Map();
    this.reportRateLimitChains = new Map();
    if (
      typeof this.monotonicClock !== 'function'
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

  assertAllowed(method, url) {
    return this.httpKernel.assertAllowed(method, url);
  }

  buildAuthorizationUrl(request) {
    return this.oauthClient.buildAuthorizationUrl(request);
  }

  verifyCallbackSignature(parameters) {
    return this.oauthClient.verifyCallbackSignature(parameters);
  }

  async requestJson(request) {
    return this.httpKernel.requestJson(request);
  }

  async exchangeAuthorizationCode(request) {
    return this.oauthClient.exchangeAuthorizationCode(request);
  }

  async refreshAccessToken(request) {
    return this.oauthClient.refreshAccessToken(request);
  }

  async listAccounts(request) {
    return this.oauthClient.listAccounts(request);
  }

  async fetchConfiguredSearchReport({
    report,
    binding,
    accessToken,
    coverage,
    normalizeRow,
    budget
  }) {
    const range = assertDateRange(
      coverage,
      report?.maxDateRangeDays
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
      const response = await this.requestJson({
        method: report.method,
        url: report.url,
        maxResponseBytes: remainingResponseBytes == null
          ? REPORT_RESPONSE_BUDGET
          : Math.min(REPORT_RESPONSE_BUDGET, remainingResponseBytes),
        timeoutMs: remainingMilliseconds == null
          ? this.timeoutMs
          : Math.max(1, Math.min(this.timeoutMs, remainingMilliseconds)),
        json: {
          header: {
            userName: accountName,
            accessToken: token
          },
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
        normalizeRow(
          row,
          { accountId, accountName },
          costScale,
          range
        )
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
    sourceKey = 'ALL',
    device = null
  }) {
    const range = assertDateRange(coverage, 731);
    const normalizedSiteId = reportIdentifier(siteId, 'site_id');
    const metrics = this.manifest.tongji.report.metrics;
    const source = tongjiSourceFilter(sourceKey);
    const clientDevice = tongjiDeviceFilter(device);
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
          ...(source ? { source } : {}),
          ...(clientDevice ? { clientDevice } : {})
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
    const rows = result.items[0].map((dimension, index) => {
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
        visits: normalizeTongjiMetric(metricRow[1], 'visits'),
        visitors: normalizeTongjiMetric(metricRow[2])
      };
    }).sort((left, right) => left.date.localeCompare(right.date));
    const expectedDates = Array.from({ length: range.days }, (_, index) => {
      const date = new Date(`${range.from}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + index);
      return date.toISOString().slice(0, 10);
    });
    if (
      rows.length !== expectedDates.length
      || rows.some((row, index) => row.date !== expectedDates[index])
    ) {
      throw new BaiduMarketingError(
        '百度统计趋势日期不完整',
        'BAIDU_TONGJI_RESPONSE_INVALID',
        502
      );
    }
    return rows;
  }

  async fetchTongjiQualityTrend({
    accountName,
    accessToken,
    siteId,
    coverage,
    sourceKey = 'ALL',
    device = 'all'
  }) {
    if (this.manifest.tongji?.qualityMetrics?.runtimeEnabled !== true) {
      throw new BaiduMarketingError(
        '百度统计质量指标尚未通过真实账号合同验证',
        'BAIDU_TONGJI_CAPABILITY_NOT_VERIFIED',
        503
      );
    }
    const range = assertDateRange(coverage, 731);
    const normalizedSiteId = reportIdentifier(siteId, 'site_id');
    const source = tongjiSourceFilter(sourceKey);
    const clientDevice = tongjiDeviceFilter(device);
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
          metrics: TONGJI_QUALITY_METRICS.join(','),
          max_results: range.days,
          gran: 'day',
          ...(source ? { source } : {}),
          ...(clientDevice ? { clientDevice } : {})
        }
      }
    });
    return normalizeTongjiQualityTrendResult(
      normalizeTongjiEnvelope(response)?.result,
      range
    );
  }

  async fetchTongjiPageReport({
    accountName,
    accessToken,
    siteId,
    coverage,
    device = 'all',
    view
  }) {
    const pageReports = this.manifest.tongji?.pageReports;
    if (pageReports?.runtimeEnabled !== true) {
      throw new BaiduMarketingError(
        '百度统计页面报告尚未通过真实账号合同验证',
        'BAIDU_TONGJI_CAPABILITY_NOT_VERIFIED',
        503
      );
    }
    const report = pageReports[view];
    if (!report || !['landing', 'visited'].includes(view)) {
      throw new BaiduMarketingError(
        '百度统计页面报告视图无效',
        'BAIDU_TONGJI_PAGE_VIEW_INVALID',
        400
      );
    }
    const range = assertDateRange(coverage, 366);
    const normalizedSiteId = reportIdentifier(siteId, 'site_id');
    const clientDevice = tongjiDeviceFilter(device);
    const pageSize = 100;
    const rows = [];
    const seenPageIds = new Set();
    let total = null;
    let startIndex = 0;
    const deadline = Date.now() + TONGJI_PAGE_REPORT_TIME_BUDGET_MS;
    do {
      const remainingMs = deadline - Date.now();
      if (remainingMs < 100) {
        throw new BaiduMarketingError(
          '百度统计页面报告超过总耗时预算',
          'BAIDU_TONGJI_PAGE_REPORT_BUDGET_EXCEEDED',
          504,
          true
        );
      }
      const response = await this.requestJson({
        method: this.manifest.tongji.report.method,
        url: this.manifest.tongji.report.url,
        maxResponseBytes: TONGJI_RESPONSE_BUDGET,
        timeoutMs: Math.min(this.timeoutMs, remainingMs),
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
            method: report.reportMethod,
            start_date: range.from.replaceAll('-', ''),
            end_date: range.to.replaceAll('-', ''),
            metrics: report.metrics.join(','),
            start_index: startIndex,
            max_results: pageSize,
            ...(clientDevice ? { clientDevice } : {})
          }
        }
      });
      const pageResult = normalizeTongjiPageReportResult(
        normalizeTongjiEnvelope(response)?.result,
        view,
        report,
        startIndex
      );
      if (total === null) total = pageResult.total;
      if (
        pageResult.total !== total
        || (startIndex < total && pageResult.rows.length === 0)
        || pageResult.rows.some((row) => seenPageIds.has(row.pageId))
      ) {
        throw new BaiduMarketingError(
          '百度统计页面报告分页响应无效',
          'BAIDU_TONGJI_RESPONSE_INVALID',
          502
        );
      }
      for (const row of pageResult.rows) seenPageIds.add(row.pageId);
      rows.push(...pageResult.rows);
      startIndex += pageResult.rows.length;
    } while (startIndex < total);
    return { view, total, rows };
  }

  async fetchTongjiSourceSummary({
    accountName,
    accessToken,
    siteId,
    coverage,
    reportKey,
    device = null
  }) {
    if (this.manifest.tongji?.sourceReports?.runtimeEnabled !== true) {
      throw new BaiduMarketingError(
        '百度统计来源报告尚未通过真实账号合同验证',
        'BAIDU_TONGJI_CAPABILITY_NOT_VERIFIED',
        503
      );
    }
    const range = assertDateRange(coverage, 731);
    const normalizedSiteId = reportIdentifier(siteId, 'site_id');
    const metrics = this.manifest.tongji.report.metrics;
    const report = TONGJI_SOURCE_REPORTS[reportKey];
    const clientDevice = tongjiDeviceFilter(device);
    if (!report) {
      throw new BaiduMarketingError(
        '百度统计来源报告无效',
        'BAIDU_TONGJI_SOURCE_REPORT_INVALID',
        400
      );
    }
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
          method: report.method,
          start_date: range.from.replaceAll('-', ''),
          end_date: range.to.replaceAll('-', ''),
          metrics: metrics.join(','),
          max_results: 100,
          ...(clientDevice ? { clientDevice } : {})
        }
      }
    });
    return normalizeTongjiSourceResult(
      normalizeTongjiEnvelope(response)?.result,
      metrics,
      report
    );
  }
}

module.exports = {
  BaiduContractBlockedError,
  BaiduMarketingClient,
  BaiduMarketingError,
  decimalNumberToScaledText
};
