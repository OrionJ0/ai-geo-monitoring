const {
  BaiduMarketingError,
  isReauthorizationCode
} = require('./BaiduErrors');
const { BaiduHttpKernel } = require('./BaiduHttpKernel');

const ONE_MEBIBYTE = 1024 * 1024;
const TONGJI_RESPONSE_BUDGET = 2 * ONE_MEBIBYTE;
const TONGJI_PAGE_REPORT_TIME_BUDGET_MS = 30_000;
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

class BaiduTongjiClient {
  constructor({ manifest, httpKernel }) {
    this.manifest = manifest;
    this.httpKernel = httpKernel;
    if (!(this.httpKernel instanceof BaiduHttpKernel)) {
      throw new BaiduMarketingError(
        '百度营销客户端配置无效',
        'BAIDU_CLIENT_CONFIG_INVALID',
        500
      );
    }
    this.timeoutMs = this.httpKernel.timeoutMs;
  }

  async listTongjiSites({ accountName, accessToken }) {
    const response = await this.httpKernel.requestJson({
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
    const response = await this.httpKernel.requestJson({
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
    const response = await this.httpKernel.requestJson({
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
      const response = await this.httpKernel.requestJson({
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
    const response = await this.httpKernel.requestJson({
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
  BaiduTongjiClient
};
