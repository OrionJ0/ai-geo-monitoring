const crypto = require('node:crypto');
const { QueryTypes } = require('sequelize');
const {
  parseProjectAllowlist,
  projectAllowed
} = require('../domain/projectAllowlist');
const { fixedShanghaiWindow } = require('../domain/syncWindow');

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_STALE_MS = 24 * 60 * 60 * 1000;
const PAGE_REPORT_CACHE_MAX_ENTRIES = 8;
const SNAPSHOT_SCHEMA_VERSION = 2;
const DEVICES = new Set(['all', 'pc', 'mobile']);
const METRICS = Object.freeze(['pageviews', 'visits', 'visitors']);
const WEBSITE_METRICS = new Set([
  'visits',
  'visitors',
  'pageviews',
  'bounceRate',
  'averageVisitTime',
  'averageVisitPages'
]);
const WEBSITE_SOURCE_KEYS = new Set([
  'ALL',
  'BAIDU_PAID',
  'BAIDU_SEARCH',
  'DIRECT',
  'BING_SEARCH',
  'GOOGLE_SEARCH',
  'OTHER_SEARCH',
  'EXTERNAL_REFERRAL'
]);
const SOURCE_DEFINITIONS = Object.freeze([
  {
    sourceKey: 'BAIDU_PAID',
    sourceLabel: '百度推广',
    sourceHost: 'e.baidu.com',
    sourceType: 'PAID'
  },
  {
    sourceKey: 'DIRECT',
    sourceLabel: '直接访问',
    sourceHost: null,
    sourceType: 'DIRECT'
  },
  {
    sourceKey: 'BAIDU_SEARCH',
    sourceLabel: '百度搜索',
    sourceHost: 'baidu.com',
    sourceType: 'ORGANIC_SEARCH'
  },
  {
    sourceKey: 'BING_SEARCH',
    sourceLabel: '必应搜索',
    sourceHost: 'bing.com',
    sourceType: 'ORGANIC_SEARCH'
  },
  {
    sourceKey: 'GOOGLE_SEARCH',
    sourceLabel: 'Google 搜索',
    sourceHost: 'google.com',
    sourceType: 'ORGANIC_SEARCH'
  },
  {
    sourceKey: 'OTHER_SEARCH',
    sourceLabel: '其他搜索',
    sourceHost: '多个搜索引擎',
    sourceType: 'ORGANIC_SEARCH'
  },
  {
    sourceKey: 'EXTERNAL_REFERRAL',
    sourceLabel: '外部引荐',
    sourceHost: '多个网站',
    sourceType: 'REFERRAL'
  }
]);
const SOURCE_KEYS = new Set(SOURCE_DEFINITIONS.map((source) => source.sourceKey));
const LEGACY_SOURCE_KEYS = Object.freeze([
  'BAIDU_SEARCH',
  'DIRECT',
  'BING_SEARCH',
  'OTHER'
]);

class BaiduTongjiError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function strictDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

function normalizeCoverage(coverage, maxDays = 366) {
  if (
    !strictDate(coverage?.from)
    || !strictDate(coverage?.to)
    || coverage.from > coverage.to
  ) {
    throw new BaiduTongjiError(
      '日期范围无效',
      'TONGJI_DATE_RANGE_INVALID',
      400
    );
  }
  const from = Date.parse(`${coverage.from}T00:00:00.000Z`);
  const to = Date.parse(`${coverage.to}T00:00:00.000Z`);
  const days = Math.floor((to - from) / 86_400_000) + 1;
  if (days > maxDays) {
    throw new BaiduTongjiError(
      `日期范围不得超过 ${maxDays} 天`,
      'TONGJI_DATE_RANGE_TOO_LARGE',
      400
    );
  }
  return { from: coverage.from, to: coverage.to, days };
}

function previousCoverage(coverage) {
  const normalized = normalizeCoverage(coverage);
  const currentFrom = Date.parse(`${normalized.from}T00:00:00.000Z`);
  const previousTo = new Date(currentFrom - 86_400_000);
  const previousFrom = new Date(
    previousTo.getTime() - ((normalized.days - 1) * 86_400_000)
  );
  return {
    from: previousFrom.toISOString().slice(0, 10),
    to: previousTo.toISOString().slice(0, 10)
  };
}

function exactMetric(
  value,
  {
    allowNull = true,
    errorCode = 'TONGJI_RESPONSE_INVALID'
  } = {}
) {
  if (value == null && allowNull) return null;
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) {
    throw new BaiduTongjiError(
      '百度统计指标无效',
      errorCode,
      502
    );
  }
  return BigInt(value).toString();
}

function sumMetric(rows, field) {
  let total = 0n;
  let observed = false;
  for (const row of rows) {
    const value = row[field];
    if (value == null) continue;
    observed = true;
    total += BigInt(exactMetric(value));
  }
  return observed ? total.toString() : null;
}

function summarizeRows(rows) {
  return {
    pageviews: sumMetric(rows, 'pageviews'),
    visits: sumMetric(rows, 'visits'),
    visitors: sumMetric(rows, 'visitors')
  };
}

function dataState(summary) {
  return Object.values(summary).some((value) => value !== null)
    ? 'DATA'
    : 'NO_DATA';
}

function snapshotSupports(payload, { requireQuality, requireSources }) {
  return (!requireQuality || payload?.quality !== null)
    && (!requireSources || payload?.sourceReportsIncluded === true);
}

function normalizeSite(site) {
  if (
    !site
    || typeof site.siteId !== 'string'
    || !/^\d+$/u.test(site.siteId)
    || typeof site.domain !== 'string'
    || !site.domain
    || site.domain.length > 255
    || site.status !== 'ACTIVE'
  ) {
    throw new BaiduTongjiError(
      '百度统计响应无效',
      'TONGJI_RESPONSE_INVALID',
      502
    );
  }
  return {
    siteId: site.siteId,
    domain: site.domain
  };
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) {
    throw new BaiduTongjiError(
      '百度统计响应无效',
      'TONGJI_RESPONSE_INVALID',
      502
    );
  }
  const seen = new Set();
  return rows.map((row) => {
    if (!strictDate(row?.date) || seen.has(row.date)) {
      throw new BaiduTongjiError(
        '百度统计趋势日期无效',
        'TONGJI_RESPONSE_INVALID',
        502
      );
    }
    seen.add(row.date);
    return {
      date: row.date,
      pageviews: exactMetric(row.pageviews),
      visits: exactMetric(row.visits, {
        errorCode: 'TONGJI_SOURCE_PARTITION_INVALID'
      }),
      visitors: exactMetric(row.visitors)
    };
  }).sort((left, right) => left.date.localeCompare(right.date));
}

function normalizeDevice(device = 'pc') {
  if (!DEVICES.has(device)) {
    throw new BaiduTongjiError(
      '设备筛选无效',
      'TONGJI_DEVICE_INVALID',
      400
    );
  }
  return device;
}

function normalizeSourceKey(sourceKey, { optional = false } = {}) {
  if (optional && (sourceKey === undefined || sourceKey === null || sourceKey === '')) {
    return null;
  }
  if (typeof sourceKey !== 'string' || !SOURCE_KEYS.has(sourceKey)) {
    throw new BaiduTongjiError(
      '来源趋势筛选无效',
      'TONGJI_SOURCE_INVALID',
      400
    );
  }
  return sourceKey;
}

function normalizeWebsiteSource(source = 'ALL') {
  if (!WEBSITE_SOURCE_KEYS.has(source)) {
    throw new BaiduTongjiError(
      '来源筛选无效',
      'TONGJI_SOURCE_INVALID',
      400
    );
  }
  return source;
}

function normalizeWebsiteMetric(metric = 'visits') {
  if (!WEBSITE_METRICS.has(metric)) {
    throw new BaiduTongjiError(
      '趋势指标无效',
      'TONGJI_METRIC_INVALID',
      400
    );
  }
  return metric;
}

function normalizeSourceComparison(value, sourceKey, metric) {
  if (value === undefined || value === false || value === 'false') return false;
  if (
    (value !== true && value !== 'true')
    || sourceKey !== 'ALL'
    || metric !== 'visits'
  ) {
    throw new BaiduTongjiError(
      '渠道趋势对比参数无效',
      'TONGJI_SOURCE_COMPARISON_QUERY_INVALID',
      400
    );
  }
  return true;
}

function normalizeSummaryRows(rows) {
  if (!Array.isArray(rows)) {
    throw new BaiduTongjiError(
      '百度统计来源响应无效',
      'TONGJI_SOURCE_RESPONSE_INVALID',
      502
    );
  }
  const seen = new Set();
  return rows.map((row) => {
    const name = String(row?.name || '').trim();
    const source = String(row?.source || '').trim();
    const engineId = row?.engineId == null
      ? null
      : String(row.engineId).trim();
    if (
      !name
      || name.length > 200
      || !source
      || source.length > 100
      || (engineId !== null && !/^\d+$/u.test(engineId))
      || seen.has(source)
    ) {
      throw new BaiduTongjiError(
        '百度统计来源响应无效',
        'TONGJI_SOURCE_RESPONSE_INVALID',
        502
      );
    }
    seen.add(source);
    return {
      name,
      source,
      engineId,
      pageviews: exactMetric(row.pageviews),
      visits: exactMetric(row.visits, {
        errorCode: 'TONGJI_SOURCE_PARTITION_INVALID'
      }),
      visitors: exactMetric(row.visitors)
    };
  });
}

function addSummaries(rows) {
  return Object.fromEntries(METRICS.map((metric) => [
    metric,
    rows.length > 0 && rows.every((row) => row?.[metric] != null)
      ? rows.reduce(
          (total, row) => total + BigInt(exactMetric(row[metric])),
          0n
        ).toString()
      : null
  ]));
}

function isPaidSource(row) {
  return /pro|fc/iu.test(row.source)
    || /付费|推广|广告/u.test(row.name);
}

function isBingSource(row) {
  return /必应|bing/iu.test(row.name);
}

function isGoogleSource(row) {
  return /谷歌|google/iu.test(row.name);
}

function normalizeSummary(summary, errorCode = 'TONGJI_SOURCE_RESPONSE_INVALID') {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    throw new BaiduTongjiError('百度统计来源汇总无效', errorCode, 502);
  }
  return Object.fromEntries(METRICS.map((metric) => [
    metric,
    exactMetric(summary[metric], {
      errorCode: metric === 'visits'
        ? 'TONGJI_SOURCE_PARTITION_INVALID'
        : errorCode
    })
  ]));
}

function summaryForRow(row) {
  return Object.fromEntries(METRICS.map((metric) => [
    metric,
    row?.[metric] == null ? null : exactMetric(row[metric])
  ]));
}

function buildRemainderSummary({ total, excluded }) {
  const summary = { visitors: null };
  for (const metric of ['pageviews', 'visits']) {
    const operands = [total?.[metric], ...excluded.map((row) => row?.[metric])];
    if (operands.some((value) => value == null)) {
      summary[metric] = null;
      continue;
    }
    const value = operands.slice(1).reduce(
      (remainder, operand) => remainder - BigInt(exactMetric(operand)),
      BigInt(exactMetric(operands[0]))
    );
    if (value < 0n) {
      throw new BaiduTongjiError(
        '百度统计来源拆分结果无效',
        'TONGJI_SOURCE_RESPONSE_INVALID',
        502
      );
    }
    summary[metric] = value.toString();
  }
  return summary;
}

function sourcePartitionInvalid() {
  return new BaiduTongjiError(
    '百度统计来源 visits 分区无效',
    'TONGJI_SOURCE_PARTITION_INVALID',
    502
  );
}

function partitionMetric(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) {
    throw sourcePartitionInvalid();
  }
  return BigInt(value).toString();
}

function buildSourcePartition(totalVisits, rows) {
  if (!Array.isArray(rows)) throw sourcePartitionInvalid();
  const normalizedTotal = partitionMetric(totalVisits);
  const values = rows.map((row) => partitionMetric(row?.summary?.current));
  const hasMissingSource = values.some((value) => value === null);
  const classified = values.reduce(
    (sum, value) => sum + BigInt(value || '0'),
    0n
  );
  if (normalizedTotal === null) {
    return {
      metric: 'visits',
      state: 'PARTIAL',
      totalVisits: null,
      classifiedVisits: classified.toString(),
      unclassifiedVisits: null,
      reasonCode: 'SOURCE_TOTAL_UNAVAILABLE'
    };
  }
  const total = BigInt(normalizedTotal);
  if (classified > total) throw sourcePartitionInvalid();
  const residual = (total - classified).toString();
  const state = !hasMissingSource && residual === '0'
    ? 'COMPLETE'
    : 'PARTIAL';
  return {
    metric: 'visits',
    state,
    totalVisits: normalizedTotal,
    classifiedVisits: classified.toString(),
    unclassifiedVisits: residual,
    reasonCode: state === 'COMPLETE'
      ? null
      : hasMissingSource
        ? 'SOURCE_METRIC_MISSING'
        : 'SOURCE_COVERAGE_INCOMPLETE'
  };
}

function assertSourcePartition(trend, sources) {
  const total = summarizeRows(trend);
  for (const metric of ['pageviews', 'visits']) {
    const sourceValues = sources.map((source) => source.summary?.[metric]);
    if (total[metric] == null || sourceValues.some((value) => value == null)) {
      continue;
    }
    const sourceTotal = sourceValues.reduce(
      (sum, value) => sum + BigInt(exactMetric(value)),
      0n
    );
    const totalMetric = BigInt(exactMetric(total[metric]));
    if (metric === 'visits' && sourceTotal > totalMetric) {
      throw sourcePartitionInvalid();
    }
    if (metric !== 'visits' && sourceTotal !== totalMetric) {
      throw new BaiduTongjiError(
        '百度统计来源汇总与全站汇总不一致',
        'TONGJI_SOURCE_RESPONSE_INVALID',
        502
      );
    }
  }
}

function nullSummary() {
  return { pageviews: null, visits: null, visitors: null };
}

function legacyCompatibleSources(sources) {
  const byKey = new Map(sources.map((source) => [source.sourceKey, source]));
  const otherParts = [
    byKey.get('GOOGLE_SEARCH'),
    byKey.get('OTHER_SEARCH'),
    byKey.get('EXTERNAL_REFERRAL')
  ];
  const otherSummary = {
    ...addSummaries(otherParts.map((source) => source?.summary)),
    visitors: null
  };
  const otherDetails = [...new Set(otherParts.flatMap(
    (source) => source?.sourceDetails || []
  ))].slice(0, 8);
  return [
    { ...byKey.get('BAIDU_SEARCH') },
    { ...byKey.get('DIRECT') },
    { ...byKey.get('BING_SEARCH') },
    {
      sourceKey: 'OTHER',
      sourceLabel: '其他来源',
      sourceHost: '多个网站',
      sourceDetails: otherDetails,
      summary: otherSummary
    }
  ];
}

function snapshotPayloadForStorage(payload) {
  return {
    ...payload,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    sourcesV2: payload.sources,
    sources: legacyCompatibleSources(payload.sources)
  };
}

function hasTraffic(row) {
  return METRICS.some((metric) => (
    row?.[metric] != null && BigInt(exactMetric(row[metric])) > 0n
  ));
}

const QUALITY_FIELDS = [
  'bounceRate',
  'averageVisitTimeSeconds',
  'averageVisitPages'
];

function qualityMetric(value, errorCode = 'TONGJI_QUALITY_RESPONSE_INVALID') {
  if (value == null) return null;
  if (
    typeof value !== 'string'
    || !/^\d+(?:\.\d+)?$/u.test(value)
    || value.length > 64
  ) {
    throw new BaiduTongjiError('百度统计质量指标无效', errorCode, 502);
  }
  const [whole, fraction = ''] = value.split('.');
  const canonicalFraction = fraction.replace(/0+$/u, '');
  return canonicalFraction
    ? `${BigInt(whole)}.${canonicalFraction}`
    : BigInt(whole).toString();
}

function qualityDates(coverage) {
  const dates = [];
  for (
    let cursor = Date.parse(`${coverage.from}T00:00:00.000Z`);
    cursor <= Date.parse(`${coverage.to}T00:00:00.000Z`);
    cursor += 86_400_000
  ) dates.push(new Date(cursor).toISOString().slice(0, 10));
  return dates;
}

function normalizeQualityPayload(
  value,
  coverage,
  errorCode = 'TONGJI_QUALITY_RESPONSE_INVALID'
) {
  if (value == null) return null;
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || !value.summary
    || !Array.isArray(value.rows)
  ) {
    throw new BaiduTongjiError('百度统计质量响应无效', errorCode, 502);
  }
  const expectedDates = qualityDates(coverage);
  if (
    value.rows.length !== expectedDates.length
    || value.rows.some((row, index) => row?.date !== expectedDates[index])
  ) {
    throw new BaiduTongjiError('百度统计质量趋势日期不完整', errorCode, 502);
  }
  return {
    summary: Object.fromEntries(QUALITY_FIELDS.map((field) => [
      field,
      qualityMetric(value.summary[field], errorCode)
    ])),
    rows: value.rows.map((row) => ({
      date: row.date,
      ...Object.fromEntries(QUALITY_FIELDS.map((field) => [
        field,
        qualityMetric(row[field], errorCode)
      ]))
    }))
  };
}

function buildSnapshotPayload(result, coverage, device) {
  const site = normalizeSite(result?.site);
  const trend = normalizeRows(result?.allTrend);
  const sourceSummaries = normalizeSummaryRows(result?.sourceSummaries);
  const engineSummaries = normalizeSummaryRows(result?.engineSummaries);
  const sourceById = new Map(sourceSummaries.map((row) => [row.source, row]));
  const paidRows = sourceSummaries.filter(isPaidSource);
  const bingRows = engineSummaries.filter((row) => (
    isBingSource(row) && !isPaidSource(row)
  ));
  const googleRows = engineSummaries.filter((row) => (
    isGoogleSource(row) && !isPaidSource(row)
  ));
  const otherEngineRows = engineSummaries.filter((row) => (
    !isPaidSource(row)
    && row.source !== 'searchBaiduNature'
    && !isBingSource(row)
    && !isGoogleSource(row)
  ));
  const paidSummary = addSummaries(paidRows);
  const bingSummary = addSummaries(bingRows);
  const googleSummary = addSummaries(googleRows);
  const otherSearchSummary = buildRemainderSummary({
    total: sourceById.get('searchOther'),
    excluded: [bingSummary, googleSummary]
  });
  const otherSearchDetails = [...new Set(otherEngineRows
    .filter(hasTraffic)
    .map((row) => row.name))].slice(0, 8);
  const sources = [
    {
      sourceKey: 'BAIDU_PAID',
      summary: paidSummary,
      sourceDetails: paidRows.length
        ? [...new Set(paidRows.map((row) => row.name))]
        : []
    },
    {
      sourceKey: 'DIRECT',
      summary: summaryForRow(sourceById.get('through')),
      sourceDetails: [site.domain]
    },
    {
      sourceKey: 'BAIDU_SEARCH',
      summary: summaryForRow(sourceById.get('searchBaiduNature')),
      sourceDetails: ['百度自然搜索']
    },
    {
      sourceKey: 'BING_SEARCH',
      summary: bingSummary,
      sourceDetails: bingRows.length ? [...new Set(bingRows.map((row) => row.name))] : []
    },
    {
      sourceKey: 'GOOGLE_SEARCH',
      summary: googleSummary,
      sourceDetails: googleRows.length ? [...new Set(googleRows.map((row) => row.name))] : []
    },
    {
      sourceKey: 'OTHER_SEARCH',
      summary: otherSearchSummary,
      sourceDetails: otherSearchDetails
    },
    {
      sourceKey: 'EXTERNAL_REFERRAL',
      summary: summaryForRow(sourceById.get('link')),
      sourceDetails: hasTraffic(sourceById.get('link')) ? ['外部链接'] : []
    }
  ];
  assertSourcePartition(trend, sources);
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    site: { ...site, status: 'ACTIVE' },
    coverage,
    device,
    trend,
    quality: normalizeQualityPayload(result?.quality, coverage),
    sourceReportsIncluded: result?.sourceReportsIncluded === true,
    sources,
    selectors: {
      bingEngineIds: bingRows
        .map((row) => row.engineId)
        .filter(Boolean),
      googleEngineIds: googleRows
        .map((row) => row.engineId)
        .filter(Boolean)
    }
  };
}

function normalizeStoredPayload(payload) {
  const site = normalizeSite(payload?.site);
  const device = normalizeDevice(payload?.device);
  const coverage = payload?.coverage;
  if (
    !strictDate(coverage?.from)
    || !strictDate(coverage?.to)
    || coverage.from > coverage.to
  ) {
    throw new BaiduTongjiError(
      '百度统计缓存覆盖范围无效',
      'TONGJI_CACHE_INVALID',
      500
    );
  }
  const trend = normalizeRows(payload?.trend);
  const storedSources = payload?.schemaVersion === SNAPSHOT_SCHEMA_VERSION
    ? payload.sourcesV2 || payload.sources
    : payload?.sources;
  if (!Array.isArray(storedSources)) {
    throw new BaiduTongjiError(
      '百度统计缓存来源无效',
      'TONGJI_CACHE_INVALID',
      500
    );
  }
  const storedByKey = new Map(storedSources.map((source) => [
    source?.sourceKey,
    source
  ]));
  const isCurrent = storedByKey.size === SOURCE_DEFINITIONS.length
    && SOURCE_DEFINITIONS.every((definition) => (
      storedByKey.has(definition.sourceKey)
    ));
  const isLegacy = payload?.schemaVersion == null
    && storedByKey.size === LEGACY_SOURCE_KEYS.length
    && LEGACY_SOURCE_KEYS.every((sourceKey) => storedByKey.has(sourceKey));
  if (!isCurrent && !isLegacy) {
    throw new BaiduTongjiError(
      '百度统计缓存来源无效',
      'TONGJI_CACHE_INVALID',
      500
    );
  }
  const sources = SOURCE_DEFINITIONS.map((definition) => {
    const stored = storedByKey.get(definition.sourceKey);
    const unavailableLegacySource = isLegacy && !stored;
    if (unavailableLegacySource) {
      return {
        ...definition,
        sourceHost: definition.sourceKey === 'DIRECT'
          ? site.domain
          : definition.sourceHost,
        sourceType: definition.sourceType,
        sourceDetails: [],
        dataState: 'NO_DATA',
        summary: nullSummary()
      };
    }
    if (!stored?.summary) {
      throw new BaiduTongjiError(
        '百度统计缓存来源汇总无效',
        'TONGJI_CACHE_INVALID',
        500
      );
    }
    const summary = normalizeSummary(stored.summary, 'TONGJI_CACHE_INVALID');
    const sourceDetails = Array.isArray(stored.sourceDetails)
      ? stored.sourceDetails.map((value) => String(value).trim()).filter(Boolean)
      : [];
    if (
      sourceDetails.length > 8
      || sourceDetails.some((value) => value.length > 200)
    ) {
      throw new BaiduTongjiError(
        '百度统计缓存来源说明无效',
        'TONGJI_CACHE_INVALID',
        500
      );
    }
    return {
      ...definition,
      sourceHost: definition.sourceKey === 'DIRECT'
        ? site.domain
        : definition.sourceHost,
      sourceType: definition.sourceType,
      sourceDetails,
      dataState: dataState(summary),
      summary
    };
  });
  const bingEngineIds = Array.isArray(payload?.selectors?.bingEngineIds)
    ? payload.selectors.bingEngineIds.map(String)
    : [];
  const googleEngineIds = Array.isArray(payload?.selectors?.googleEngineIds)
    ? payload.selectors.googleEngineIds.map(String)
    : [];
  if (
    bingEngineIds.some((value) => !/^\d+$/u.test(value))
    || new Set(bingEngineIds).size !== bingEngineIds.length
    || googleEngineIds.some((value) => !/^\d+$/u.test(value))
    || new Set(googleEngineIds).size !== googleEngineIds.length
  ) {
    throw new BaiduTongjiError(
      '百度统计缓存来源选择器无效',
      'TONGJI_CACHE_INVALID',
      500
    );
  }
  const summary = summarizeRows(trend);
  return {
    site,
    coverage,
    device,
    dataState: dataState(summary),
    summary,
    trend,
    quality: normalizeQualityPayload(
      payload?.quality,
      coverage,
      'TONGJI_CACHE_INVALID'
    ),
    sourceReportsIncluded: payload?.sourceReportsIncluded === true,
    sources,
    selectors: { bingEngineIds, googleEngineIds }
  };
}

function roundedTenths(numerator, denominator) {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const quotient = magnitude / denominator;
  const remainder = magnitude % denominator;
  const rounded = quotient + (remainder * 2n >= denominator ? 1n : 0n);
  return negative ? -rounded : rounded;
}

function formatTenths(value) {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  return `${negative ? '-' : ''}${magnitude / 10n}.${magnitude % 10n}`;
}

function comparisonValue(current, previous) {
  if (current == null || previous == null) return null;
  if (BigInt(previous) === 0n) return null;
  return formatTenths(roundedTenths(
    (BigInt(current) - BigInt(previous)) * 1000n,
    BigInt(previous)
  ));
}

function trafficShare(visits, totalVisits) {
  if (visits == null || totalVisits == null || BigInt(totalVisits) === 0n) {
    return null;
  }
  if (BigInt(visits) > BigInt(totalVisits)) {
    throw new BaiduTongjiError(
      '百度统计来源访问次数超过全站访问次数',
      'TONGJI_SOURCE_RESPONSE_INVALID',
      502
    );
  }
  return formatTenths(roundedTenths(
    BigInt(visits) * 1000n,
    BigInt(totalVisits)
  ));
}

function metricValue(row, metric) {
  if (metric === 'visits' || metric === 'visitors' || metric === 'pageviews') {
    return row?.[metric] ?? null;
  }
  return null;
}

function decimalDifference(current, previous) {
  if (current == null || previous == null) return null;
  const [currentWhole, currentFraction = ''] = current.split('.');
  const [previousWhole, previousFraction = ''] = previous.split('.');
  const scale = Math.max(currentFraction.length, previousFraction.length);
  const factor = 10n ** BigInt(scale);
  const currentValue = BigInt(currentWhole) * factor
    + BigInt(currentFraction.padEnd(scale, '0') || '0');
  const previousValue = BigInt(previousWhole) * factor
    + BigInt(previousFraction.padEnd(scale, '0') || '0');
  const difference = currentValue - previousValue;
  const negative = difference < 0n;
  const magnitude = negative ? -difference : difference;
  const whole = magnitude / factor;
  const fraction = scale === 0
    ? ''
    : (magnitude % factor).toString().padStart(scale, '0').replace(/0+$/u, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function sourceForSnapshot(snapshot, sourceKey) {
  if (sourceKey === 'ALL') {
    return {
      sourceKey: 'ALL',
      sourceLabel: '全部来源',
      trend: snapshot.trend,
      summary: snapshot.summary
    };
  }
  const source = snapshot.sources.find((item) => item.sourceKey === sourceKey);
  if (!source) {
    throw new BaiduTongjiError(
      '来源统计缺失',
      'TONGJI_SOURCE_RESPONSE_INVALID',
      502
    );
  }
  return source;
}

function cacheState(...states) {
  if (states.includes('FALLBACK')) return 'FALLBACK';
  if (states.includes('REFRESHED')) return 'REFRESHED';
  return 'HIT';
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(limit, items.length) },
    () => worker()
  ));
  return results;
}

function snapshotTable(cacheScope) {
  if (cacheScope === 'FIXED') return 'baidu_tongji_snapshots';
  if (cacheScope === 'RANGE') return 'baidu_tongji_range_snapshots';
  throw new BaiduTongjiError(
    '百度统计缓存范围无效',
    'TONGJI_CACHE_SCOPE_INVALID',
    500
  );
}

function websiteCapabilities(overrides = {}) {
  const sourceTraffic = overrides.sourceTraffic === true;
  const qualityMetrics = overrides.qualityMetrics === true;
  const pageReports = overrides.pageReports === true;
  return {
    trafficCounts: true,
    sourceTraffic,
    qualityMetrics,
    pageReports,
    sourcePageCorrelation: false,
    unavailableReason: sourceTraffic && qualityMetrics && pageReports
      ? ''
      : '尚未取得真实账号响应样本以验证来源汇总、质量指标与页面报告的严格响应合同'
  };
}

function exactPageMetric(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/u.test(value) || value.length > 64) {
    throw new BaiduTongjiError(
      '百度统计页面指标无效',
      'TONGJI_PAGE_RESPONSE_INVALID',
      502
    );
  }
  const [whole, fraction = ''] = value.split('.');
  const canonicalFraction = fraction.replace(/0+$/u, '');
  return canonicalFraction
    ? `${BigInt(whole)}.${canonicalFraction}`
    : BigInt(whole).toString();
}

function comparePageMetrics(left, right) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  const [leftWhole, leftFraction = ''] = left.split('.');
  const [rightWhole, rightFraction = ''] = right.split('.');
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const leftValue = BigInt(leftWhole) * (10n ** BigInt(scale))
    + BigInt(leftFraction.padEnd(scale, '0') || '0');
  const rightValue = BigInt(rightWhole) * (10n ** BigInt(scale))
    + BigInt(rightFraction.padEnd(scale, '0') || '0');
  return leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1;
}

function normalizePageReport(result, view, siteDomain) {
  if (
    !result
    || result.view !== view
    || !Number.isSafeInteger(result.total)
    || result.total < 0
    || !Array.isArray(result.rows)
    || result.total !== result.rows.length
  ) {
    throw new BaiduTongjiError(
      '百度统计页面报告响应无效',
      'TONGJI_PAGE_RESPONSE_INVALID',
      502
    );
  }
  const seen = new Set();
  let excludedCrossDomainRows = 0;
  const rows = result.rows.map((row) => {
    const pageId = typeof row?.pageId === 'string' ? row.pageId : '';
    let parsed;
    try {
      parsed = new URL(row?.pageUrl);
    } catch {
      parsed = null;
    }
    if (
      !parsed
      || !['http:', 'https:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
      || !/^\d+$/u.test(pageId)
      || seen.has(pageId)
    ) {
      throw new BaiduTongjiError(
        '百度统计页面报告行无效',
        'TONGJI_PAGE_RESPONSE_INVALID',
        502
      );
    }
    seen.add(pageId);
    if (parsed.hostname.toLowerCase() !== siteDomain.toLowerCase()) {
      excludedCrossDomainRows += 1;
      return null;
    }
    const base = {
      key: `baidu-page:${pageId}`,
      pageId,
      title: null,
      path: `${parsed.pathname}${parsed.search}` || '/'
    };
    return view === 'landing'
      ? {
          ...base,
          visits: exactPageMetric(row.visits),
          contributionPageviews: exactPageMetric(row.contributionPageviews),
          bounceRate: exactPageMetric(row.bounceRate),
          averageVisitTime: exactPageMetric(row.averageVisitTimeSeconds),
          averageVisitPages: exactPageMetric(row.averageVisitPages)
        }
      : {
          ...base,
          pageviews: exactPageMetric(row.pageviews),
          visitors: exactPageMetric(row.visitors),
          averageStayTime: exactPageMetric(row.averageStayTimeSeconds),
          downstreamPageviews: exactPageMetric(row.downstreamPageviews),
          exitRate: exactPageMetric(row.exitRate)
        };
  }).filter(Boolean);
  return { rows, excludedCrossDomainRows };
}

function normalizeStoredPageReport(payload, view, siteDomain) {
  if (
    !payload
    || payload.view !== view
    || !Array.isArray(payload.rows)
    || !Number.isSafeInteger(payload.excludedCrossDomainRows)
    || payload.excludedCrossDomainRows < 0
  ) {
    throw new BaiduTongjiError(
      '百度统计页面报告缓存无效',
      'TONGJI_CACHE_INVALID',
      500
    );
  }
  const rawRows = payload.rows.map((row) => {
    if (
      row?.key !== `baidu-page:${row?.pageId}`
      || row.title !== null
      || typeof row.path !== 'string'
      || !/^\/(?!\/)[^\r\n]{0,2047}$/u.test(row.path)
    ) {
      throw new BaiduTongjiError(
        '百度统计页面报告缓存行无效',
        'TONGJI_CACHE_INVALID',
        500
      );
    }
    const common = {
      pageId: row.pageId,
      pageUrl: `https://${siteDomain}${row.path}`
    };
    return view === 'landing'
      ? {
          ...common,
          visits: row.visits,
          contributionPageviews: row.contributionPageviews,
          bounceRate: row.bounceRate,
          averageVisitTimeSeconds: row.averageVisitTime,
          averageVisitPages: row.averageVisitPages
        }
      : {
          ...common,
          pageviews: row.pageviews,
          visitors: row.visitors,
          averageStayTimeSeconds: row.averageStayTime,
          downstreamPageviews: row.downstreamPageviews,
          exitRate: row.exitRate
        };
  });
  const normalized = normalizePageReport({
    view,
    total: rawRows.length,
    rows: rawRows
  }, view, siteDomain);
  if (normalized.excludedCrossDomainRows !== 0) {
    throw new BaiduTongjiError(
      '百度统计页面报告缓存站点无效',
      'TONGJI_CACHE_INVALID',
      500
    );
  }
  return {
    rows: normalized.rows,
    excludedCrossDomainRows: payload.excludedCrossDomainRows
  };
}

function strictPositiveInteger(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : Number.NaN;
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/u.test(value)) {
    return Number.NaN;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

function normalizeStoredSourceTrend(payload, baseSnapshot) {
  const site = normalizeSite(payload?.site);
  const device = normalizeDevice(payload?.device);
  const sourceKey = normalizeSourceKey(payload?.sourceKey);
  const coverage = payload?.coverage;
  if (
    site.siteId !== baseSnapshot.site.siteId
    || site.domain !== baseSnapshot.site.domain
    || device !== baseSnapshot.device
    || coverage?.from !== baseSnapshot.coverage.from
    || coverage?.to !== baseSnapshot.coverage.to
  ) {
    throw new BaiduTongjiError(
      '百度统计来源趋势缓存口径无效',
      'TONGJI_CACHE_INVALID',
      500
    );
  }
  const trend = normalizeRows(payload?.trend);
  const expectedDates = baseSnapshot.trend.map((row) => row.date);
  if (
    trend.length !== expectedDates.length
    || trend.some((row, index) => row.date !== expectedDates[index])
  ) {
    throw new BaiduTongjiError(
      '百度统计来源趋势日期不完整',
      'TONGJI_SOURCE_RESPONSE_INVALID',
      502
    );
  }
  const summary = summarizeRows(trend);
  return {
    site,
    coverage,
    device,
    sourceKey,
    dataState: dataState(summary),
    summary,
    trend
  };
}

function assertSourceTrendMatchesSnapshot(sourceTrend, baseSnapshot) {
  const sourceSummary = baseSnapshot.sources.find(
    (source) => source.sourceKey === sourceTrend.sourceKey
  );
  if (!sourceSummary) {
    throw new BaiduTongjiError(
      '百度统计来源趋势缺少对应来源汇总',
      'TONGJI_SOURCE_RESPONSE_INVALID',
      502
    );
  }
  const expectedVisits = sourceSummary.summary.visits;
  if (
    expectedVisits !== null
    && sourceTrend.summary.visits !== expectedVisits
  ) {
    throw new BaiduTongjiError(
      '百度统计来源趋势与来源汇总不一致',
      'TONGJI_SOURCE_TREND_MISMATCH',
      502
    );
  }
  return sourceTrend;
}

class BaiduTongjiService {
  constructor({
    sequelize,
    provider,
    allowedProjectIds = '*',
    clock = () => Date.now(),
    cacheTtlMs = CACHE_TTL_MS,
    cacheMaxStaleMs = CACHE_MAX_STALE_MS,
    capabilities = {},
    logger = { warn() {} }
  }) {
    this.sequelize = sequelize;
    this.provider = provider;
    this.projectAllowlist = parseProjectAllowlist(allowedProjectIds);
    this.clock = clock;
    this.cacheTtlMs = cacheTtlMs;
    this.cacheMaxStaleMs = cacheMaxStaleMs;
    this.logger = logger;
    this.capabilities = Object.freeze({
      sourceTraffic: capabilities.sourceTraffic === true,
      qualityMetrics: capabilities.qualityMetrics === true,
      pageReports: capabilities.pageReports === true
    });
    this.refreshes = new Map();
    this.pageReportCache = new Map();
    if (
      !Number.isSafeInteger(cacheTtlMs)
      || cacheTtlMs < 60_000
      || cacheTtlMs > 3_600_000
      || !Number.isSafeInteger(cacheMaxStaleMs)
      || cacheMaxStaleMs < cacheTtlMs
      || cacheMaxStaleMs > 7 * 24 * 60 * 60 * 1000
    ) {
      throw new BaiduTongjiError(
        '百度统计缓存周期无效',
        'TONGJI_CACHE_TTL_INVALID',
        500
      );
    }
  }

  assertProjectAllowed(projectId) {
    if (!projectAllowed(this.projectAllowlist, projectId)) {
      throw new BaiduTongjiError(
        '项目不在营销监控试点范围',
        'MARKETING_PROJECT_NOT_ALLOWED',
        403
      );
    }
  }

  async getProjectAndConnection(projectId) {
    this.assertProjectAllowed(projectId);
    const projects = await this.sequelize.query(
      `SELECT id, status
       FROM brand_projects
       WHERE id = :projectId
       LIMIT 1`,
      {
        replacements: { projectId },
        type: QueryTypes.SELECT
      }
    );
    if (!projects[0]) {
      throw new BaiduTongjiError('项目不存在', 'PROJECT_NOT_FOUND', 404);
    }
    if (projects[0].status !== 'active') {
      throw new BaiduTongjiError(
        '归档项目不读取百度统计数据',
        'PROJECT_ARCHIVED',
        409
      );
    }
    const connections = await this.sequelize.query(
      `SELECT DISTINCT
         b.id AS binding_id,
         b.binding_version,
         b.external_account_id,
         b.tongji_site_id,
         b.tongji_site_domain,
         c.id,
         c.authorized_principal_id,
         c.authorized_open_id
       FROM baidu_project_bindings b
       JOIN baidu_marketing_connections c ON c.id = b.connection_id
       WHERE b.project_id = :projectId
         AND b.status = 'ACTIVE'
         AND c.status = 'CONNECTED'
       ORDER BY c.id ASC`,
      {
        replacements: { projectId },
        type: QueryTypes.SELECT
      }
    );
    if (connections.length === 0) {
      throw new BaiduTongjiError(
        '项目尚未绑定可用的百度账户',
        'TONGJI_CONNECTION_MISSING',
        409
      );
    }
    const siteKeys = new Set(connections.map((connection) => (
      `${connection.tongji_site_id}\u0000${connection.tongji_site_domain}`
    )));
    if (siteKeys.size > 1) {
      throw new BaiduTongjiError(
        '项目包含多个活动百度统计绑定',
        'TONGJI_BINDING_AMBIGUOUS',
        409
      );
    }
    const selectedConnection = connections[0];
    if (
      typeof selectedConnection.tongji_site_id !== 'string'
      || !/^\d+$/u.test(selectedConnection.tongji_site_id)
      || typeof selectedConnection.tongji_site_domain !== 'string'
      || !selectedConnection.tongji_site_domain
    ) {
      throw new BaiduTongjiError(
        '项目绑定缺少明确的百度统计站点',
        'TONGJI_SITE_BINDING_MISSING',
        409
      );
    }
    return {
      project: projects[0],
      connection: selectedConnection
    };
  }

  async readPageReportCache({ projectId, connection, coverage, device, view }) {
    const rows = await this.sequelize.query(
      `SELECT *
       FROM baidu_tongji_page_report_snapshots
       WHERE project_id = :projectId
         AND binding_id = :bindingId
         AND device = :device
         AND view = :view
         AND coverage_start = :coverageStart
         AND coverage_end = :coverageEnd
       LIMIT 1`,
      {
        replacements: {
          projectId,
          bindingId: connection.binding_id,
          device,
          view,
          coverageStart: coverage.from,
          coverageEnd: coverage.to
        },
        type: QueryTypes.SELECT
      }
    );
    const row = rows[0];
    if (
      !row
      || row.site_id !== connection.tongji_site_id
      || row.site_domain !== connection.tongji_site_domain
    ) return null;
    try {
      const refreshedAtMs = new Date(row.refreshed_at).getTime();
      if (!Number.isFinite(refreshedAtMs)) return null;
      return {
        report: normalizeStoredPageReport(
          JSON.parse(row.payload_json),
          view,
          connection.tongji_site_domain
        ),
        refreshedAtMs
      };
    } catch {
      return null;
    }
  }

  async savePageReportCache({
    projectId,
    connection,
    coverage,
    device,
    view,
    report
  }) {
    const refreshedAtMs = this.clock();
    const refreshedAt = new Date(refreshedAtMs).toISOString();
    const expiresAt = new Date(refreshedAtMs + this.cacheTtlMs).toISOString();
    await this.sequelize.transaction(async (transaction) => {
      await this.sequelize.query(
        `INSERT INTO baidu_tongji_page_report_snapshots (
           id, project_id, binding_id, device, view,
           site_id, site_domain, coverage_start, coverage_end,
           payload_json, refreshed_at, expires_at, created_at, updated_at
         ) VALUES (
           :id, :projectId, :bindingId, :device, :view,
           :siteId, :siteDomain, :coverageStart, :coverageEnd,
           :payloadJson, :refreshedAt, :expiresAt, :createdAt, :updatedAt
         )
         ON CONFLICT (
           project_id, binding_id, device, view, coverage_start, coverage_end
         ) DO UPDATE SET
           site_id = excluded.site_id,
           site_domain = excluded.site_domain,
           payload_json = excluded.payload_json,
           refreshed_at = excluded.refreshed_at,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at
         WHERE excluded.refreshed_at >=
           baidu_tongji_page_report_snapshots.refreshed_at`,
        {
          replacements: {
            id: crypto.randomUUID(),
            projectId,
            bindingId: connection.binding_id,
            device,
            view,
            siteId: connection.tongji_site_id,
            siteDomain: connection.tongji_site_domain,
            coverageStart: coverage.from,
            coverageEnd: coverage.to,
            payloadJson: JSON.stringify({ view, ...report }),
            refreshedAt,
            expiresAt,
            createdAt: refreshedAt,
            updatedAt: refreshedAt
          },
          transaction
        }
      );
      await this.sequelize.query(
        `DELETE FROM baidu_tongji_page_report_snapshots
         WHERE refreshed_at < :staleCutoff`,
        {
          replacements: {
            staleCutoff: new Date(
              refreshedAtMs - this.cacheMaxStaleMs
            ).toISOString()
          },
          transaction
        }
      );
    });
    return refreshedAtMs;
  }

  async readSnapshotCache(
    projectId,
    device,
    coverage,
    connection,
    cacheScope
  ) {
    const table = snapshotTable(cacheScope);
    const rows = await this.sequelize.query(
      `SELECT *
       FROM ${table}
       WHERE project_id = :projectId
         AND device = :device
         AND coverage_start = :coverageStart
         AND coverage_end = :coverageEnd
       LIMIT 1`,
      {
        replacements: {
          projectId,
          device,
          coverageStart: coverage.from,
          coverageEnd: coverage.to
        },
        type: QueryTypes.SELECT
      }
    );
    const row = rows[0];
    if (
      !row
      || row.site_id !== connection.tongji_site_id
      || row.site_domain !== connection.tongji_site_domain
    ) return null;
    try {
      return {
        row,
        payload: normalizeStoredPayload(JSON.parse(row.payload_json))
      };
    } catch {
      return null;
    }
  }

  async saveSnapshotCache(projectId, payload, cacheScope) {
    const table = snapshotTable(cacheScope);
    const conflictColumns = cacheScope === 'FIXED'
      ? 'project_id, device'
      : 'project_id, device, coverage_start, coverage_end';
    const now = new Date(this.clock()).toISOString();
    const expiresAt = new Date(this.clock() + this.cacheTtlMs).toISOString();
    const replacements = {
      projectId,
      device: payload.device,
      siteId: payload.site.siteId,
      siteDomain: payload.site.domain,
      coverageStart: payload.coverage.from,
      coverageEnd: payload.coverage.to,
      payloadJson: JSON.stringify(snapshotPayloadForStorage(payload)),
      qualityIncluded: payload.quality === null ? 0 : 1,
      sourcesIncluded: payload.sourceReportsIncluded === true ? 1 : 0,
      refreshedAt: now,
      expiresAt,
      updatedAt: now
    };
    await this.sequelize.transaction(async (transaction) => {
      await this.sequelize.query(
        `INSERT INTO ${table} (
           id, project_id, device, site_id, site_domain,
           coverage_start, coverage_end, payload_json,
           quality_included, sources_included,
           refreshed_at, expires_at, created_at, updated_at
         ) VALUES (
           :id, :projectId, :device, :siteId, :siteDomain,
           :coverageStart, :coverageEnd, :payloadJson,
           :qualityIncluded, :sourcesIncluded,
           :refreshedAt, :expiresAt, :createdAt, :updatedAt
         )
         ON CONFLICT (${conflictColumns}) DO UPDATE SET
           site_id = excluded.site_id,
           site_domain = excluded.site_domain,
           coverage_start = excluded.coverage_start,
           coverage_end = excluded.coverage_end,
           payload_json = excluded.payload_json,
           quality_included = excluded.quality_included,
           sources_included = excluded.sources_included,
           refreshed_at = excluded.refreshed_at,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at
         WHERE excluded.quality_included >= ${table}.quality_included
           AND excluded.sources_included >= ${table}.sources_included`,
        {
          replacements: {
            ...replacements,
            id: crypto.randomUUID(),
            createdAt: now
          },
          transaction
        }
      );
      await this.sequelize.query(
        `DELETE FROM ${table}
         WHERE refreshed_at < :staleCutoff`,
        {
          replacements: {
            staleCutoff: new Date(
              this.clock() - this.cacheMaxStaleMs
            ).toISOString()
          },
          transaction
        }
      );
    });
    return { refreshedAt: now, expiresAt };
  }

  async refreshSnapshot({
    projectId,
    connection,
    coverage,
    device,
    requireQuality = false,
    requireSources = false,
    cacheScope = 'RANGE'
  }) {
    const result = await this.provider.readTrafficSnapshot({
      connection,
      coverage,
      device,
      includeQuality: requireQuality,
      includeSources: requireSources
    });
    const payload = buildSnapshotPayload(result, coverage, device);
    if (
      payload.site.siteId !== connection.tongji_site_id
      || payload.site.domain !== connection.tongji_site_domain
    ) {
      throw new BaiduTongjiError(
        '百度统计站点与项目绑定不一致',
        'TONGJI_SITE_MISMATCH',
        502
      );
    }
    const cache = await this.saveSnapshotCache(projectId, payload, cacheScope);
    return { payload: normalizeStoredPayload(payload), cache };
  }

  async readSnapshotForCoverage(
    projectId,
    requestedDevice,
    requestedCoverage,
    {
      requireQuality = false,
      requireSources = false,
      cacheScope = 'RANGE'
    } = {}
  ) {
    const device = normalizeDevice(requestedDevice || 'all');
    const coverage = normalizeCoverage(requestedCoverage);
    const { connection } = await this.getProjectAndConnection(projectId);
    const cached = await this.readSnapshotCache(
      projectId,
      device,
      coverage,
      connection,
      cacheScope
    );
    const fresh = cached
      && snapshotSupports(cached.payload, { requireQuality, requireSources })
      && new Date(cached.row.expires_at).getTime() > this.clock();
    if (fresh) {
      return {
        ...cached.payload,
        cache: {
          state: 'HIT',
          ttlSeconds: Math.floor(this.cacheTtlMs / 1000),
          refreshedAt: new Date(cached.row.refreshed_at).toISOString()
        }
      };
    }
    const refreshKey = [
      'range',
      cacheScope,
      projectId,
      connection.binding_id,
      connection.tongji_site_id,
      device,
      coverage.from,
      coverage.to,
      requireQuality ? 'quality' : 'no-quality',
      requireSources ? 'sources' : 'no-sources'
    ].join(':');
    if (!this.refreshes.has(refreshKey)) {
      this.refreshes.set(
        refreshKey,
        this.refreshSnapshot({
          projectId,
          connection,
          coverage,
          device,
          requireQuality,
          requireSources,
          cacheScope
        }).finally(() => this.refreshes.delete(refreshKey))
      );
    }
    try {
      const refreshed = await this.refreshes.get(refreshKey);
      return {
        ...refreshed.payload,
        cache: {
          state: 'REFRESHED',
          ttlSeconds: Math.floor(this.cacheTtlMs / 1000),
          refreshedAt: refreshed.cache.refreshedAt
        }
      };
    } catch (error) {
      const staleAgeMs = cached
        ? this.clock() - new Date(cached.row.refreshed_at).getTime()
        : Number.POSITIVE_INFINITY;
      if (
        !cached
        || staleAgeMs > this.cacheMaxStaleMs
        || !snapshotSupports(cached.payload, { requireQuality, requireSources })
      ) throw error;
      return {
        ...cached.payload,
        cache: {
          state: 'FALLBACK',
          ttlSeconds: Math.floor(this.cacheTtlMs / 1000),
          refreshedAt: new Date(cached.row.refreshed_at).toISOString(),
          staleAgeSeconds: Math.max(0, Math.floor(staleAgeMs / 1000))
        }
      };
    }
  }

  async readSourceTrendCache(
    projectId,
    device,
    sourceKey,
    coverage,
    connection
  ) {
    const rows = await this.sequelize.query(
      `SELECT *
       FROM baidu_tongji_source_trend_snapshots
       WHERE project_id = :projectId
         AND device = :device
         AND source_key = :sourceKey
         AND coverage_start = :coverageStart
         AND coverage_end = :coverageEnd
       LIMIT 1`,
      {
        replacements: {
          projectId,
          device,
          sourceKey,
          coverageStart: coverage.from,
          coverageEnd: coverage.to
        },
        type: QueryTypes.SELECT
      }
    );
    const row = rows[0];
    if (
      !row
      || row.site_id !== connection.tongji_site_id
      || row.site_domain !== connection.tongji_site_domain
    ) return null;
    try {
      return { row, payload: JSON.parse(row.payload_json) };
    } catch {
      return null;
    }
  }

  async saveSourceTrendCache(projectId, payload) {
    const now = new Date(this.clock()).toISOString();
    const expiresAt = new Date(this.clock() + this.cacheTtlMs).toISOString();
    const replacements = {
      projectId,
      device: payload.device,
      sourceKey: payload.sourceKey,
      siteId: payload.site.siteId,
      siteDomain: payload.site.domain,
      coverageStart: payload.coverage.from,
      coverageEnd: payload.coverage.to,
      payloadJson: JSON.stringify({
        ...payload,
        site: { ...payload.site, status: 'ACTIVE' }
      }),
      refreshedAt: now,
      expiresAt,
      updatedAt: now
    };
    await this.sequelize.transaction(async (transaction) => {
      await this.sequelize.query(
        `INSERT INTO baidu_tongji_source_trend_snapshots (
           id, project_id, device, source_key, site_id, site_domain,
           coverage_start, coverage_end, payload_json,
           refreshed_at, expires_at, created_at, updated_at
         ) VALUES (
           :id, :projectId, :device, :sourceKey, :siteId, :siteDomain,
           :coverageStart, :coverageEnd, :payloadJson,
           :refreshedAt, :expiresAt, :createdAt, :updatedAt
         )
         ON CONFLICT (
           project_id, device, source_key, coverage_start, coverage_end
         ) DO UPDATE SET
           site_id = excluded.site_id,
           site_domain = excluded.site_domain,
           payload_json = excluded.payload_json,
           refreshed_at = excluded.refreshed_at,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at`,
        {
          replacements: {
            ...replacements,
            id: crypto.randomUUID(),
            createdAt: now
          },
          transaction
        }
      );
      await this.sequelize.query(
        `DELETE FROM baidu_tongji_source_trend_snapshots
         WHERE refreshed_at < :staleCutoff`,
        {
          replacements: {
            staleCutoff: new Date(
              this.clock() - this.cacheMaxStaleMs
            ).toISOString()
          },
          transaction
        }
      );
    });
    return { refreshedAt: now, expiresAt };
  }

  async refreshSourceTrend({
    projectId,
    connection,
    baseSnapshot,
    sourceKey
  }) {
    const result = await this.provider.readSourceTrend({
      connection,
      coverage: baseSnapshot.coverage,
      device: baseSnapshot.device,
      sourceKey,
      selectors: baseSnapshot.selectors
    });
    const payload = assertSourceTrendMatchesSnapshot(
      normalizeStoredSourceTrend({
        site: result?.site,
        coverage: baseSnapshot.coverage,
        device: baseSnapshot.device,
        sourceKey: result?.sourceKey,
        trend: result?.rows
      }, baseSnapshot),
      baseSnapshot
    );
    if (payload.sourceKey !== sourceKey) {
      throw new BaiduTongjiError(
        '百度统计来源趋势与请求不一致',
        'TONGJI_SOURCE_RESPONSE_INVALID',
        502
      );
    }
    const cache = await this.saveSourceTrendCache(projectId, payload);
    return { payload, cache };
  }

  async readSourceTrend(projectId, baseSnapshot, requestedSourceKey) {
    const sourceKey = normalizeSourceKey(requestedSourceKey);
    const { connection } = await this.getProjectAndConnection(projectId);
    const cached = await this.readSourceTrendCache(
      projectId,
      baseSnapshot.device,
      sourceKey,
      baseSnapshot.coverage,
      connection
    );
    const cacheMatchesCoverage = cached
      && cached.row.coverage_start === baseSnapshot.coverage.from
      && cached.row.coverage_end === baseSnapshot.coverage.to;
    const fresh = cacheMatchesCoverage
      && new Date(cached.row.expires_at).getTime() > this.clock();
    if (fresh) {
      return {
        ...assertSourceTrendMatchesSnapshot(
          normalizeStoredSourceTrend(cached.payload, baseSnapshot),
          baseSnapshot
        ),
        cache: {
          state: 'HIT',
          ttlSeconds: Math.floor(this.cacheTtlMs / 1000),
          refreshedAt: new Date(cached.row.refreshed_at).toISOString()
        }
      };
    }

    const refreshKey = [
      'source-trend',
      projectId,
      connection.binding_id,
      baseSnapshot.device,
      sourceKey,
      baseSnapshot.coverage.from,
      baseSnapshot.coverage.to
    ].join(':');
    if (!this.refreshes.has(refreshKey)) {
      const refresh = this.refreshSourceTrend({
        projectId,
        connection,
        baseSnapshot,
        sourceKey
      }).finally(() => this.refreshes.delete(refreshKey));
      this.refreshes.set(refreshKey, refresh);
    }
    try {
      const refreshed = await this.refreshes.get(refreshKey);
      return {
        ...refreshed.payload,
        cache: {
          state: 'REFRESHED',
          ttlSeconds: Math.floor(this.cacheTtlMs / 1000),
          refreshedAt: refreshed.cache.refreshedAt
        }
      };
    } catch (error) {
      const staleAgeMs = cacheMatchesCoverage
        ? this.clock() - new Date(cached.row.refreshed_at).getTime()
        : Number.POSITIVE_INFINITY;
      if (!cacheMatchesCoverage || staleAgeMs > this.cacheMaxStaleMs) throw error;
      return {
        ...assertSourceTrendMatchesSnapshot(
          normalizeStoredSourceTrend(cached.payload, baseSnapshot),
          baseSnapshot
        ),
        cache: {
          state: 'FALLBACK',
          ttlSeconds: Math.floor(this.cacheTtlMs / 1000),
          refreshedAt: new Date(cached.row.refreshed_at).toISOString(),
          staleAgeSeconds: Math.max(0, Math.floor(staleAgeMs / 1000))
        }
      };
    }
  }

  async readSnapshot(projectId, requestedDevice = 'pc', options = {}) {
    return this.readSnapshotForCoverage(
      projectId,
      normalizeDevice(requestedDevice),
      fixedShanghaiWindow(this.clock()),
      { ...options, cacheScope: 'FIXED' }
    );
  }

  async readSourceComparison(projectId, currentSnapshot, previousSnapshot) {
    const results = await mapWithConcurrency(
      SOURCE_DEFINITIONS,
      3,
      async ({ sourceKey, sourceLabel }) => {
        const currentSource = sourceForSnapshot(currentSnapshot, sourceKey);
        const previousSource = sourceForSnapshot(previousSnapshot, sourceKey);
        const summary = {
          current: currentSource.summary.visits,
          previous: previousSource.summary.visits,
          changePercent: comparisonValue(
            currentSource.summary.visits,
            previousSource.summary.visits
          ),
          trafficShare: trafficShare(
            currentSource.summary.visits,
            currentSnapshot.summary.visits
          )
        };
        if (currentSource.summary.visits === null) {
          return {
            row: {
              sourceKey,
              sourceLabel,
              summaryState: 'NO_DATA',
              trendState: 'NO_DATA',
              summary,
              trend: []
            },
            cacheState: null
          };
        }
        try {
          const sourceTrend = await this.readSourceTrend(
            projectId,
            currentSnapshot,
            sourceKey
          );
          return {
            row: {
              sourceKey,
              sourceLabel,
              summaryState: 'DATA',
              trendState: 'DATA',
              summary,
              trend: sourceTrend.trend.map((row) => ({
                date: row.date,
                visits: row.visits
              }))
            },
            cacheState: sourceTrend.cache?.state || null
          };
        } catch (error) {
          this.logger.warn?.({
            event: 'tongji_source_comparison_partial',
            projectId: String(projectId),
            sourceKey,
            errorCode: error?.code || 'UNKNOWN'
          });
          return {
            row: {
              sourceKey,
              sourceLabel,
              summaryState: 'DATA',
              trendState: 'UNAVAILABLE',
              summary,
              trend: []
            },
            cacheState: null
          };
        }
      }
    );
    const rows = results.map((result) => result.row);
    return {
      payload: {
        metric: 'visits',
        state: rows.some((row) => row.trendState === 'UNAVAILABLE')
          ? 'PARTIAL'
          : 'COMPLETE',
        partition: buildSourcePartition(
          currentSnapshot.summary.visits,
          rows
        ),
        rows
      },
      cacheStates: results
        .map((result) => result.cacheState)
        .filter(Boolean)
    };
  }

  async readProjectWebsiteTraffic(projectId, options = {}) {
    const device = normalizeDevice(options.device || 'all');
    const coverage = normalizeCoverage({
      from: options.from,
      to: options.to
    });
    const sourceKey = normalizeWebsiteSource(options.source || 'ALL');
    const metric = normalizeWebsiteMetric(options.metric || 'visits');
    const includeSourceComparison = normalizeSourceComparison(
      options.includeSourceComparison,
      sourceKey,
      metric
    );
    const previous = previousCoverage(coverage);
    const requireQuality = this.capabilities.qualityMetrics;
    const requireSources = this.capabilities.sourceTraffic
      || includeSourceComparison;
    const [currentSnapshot, previousSnapshot] = await Promise.all([
      this.readSnapshotForCoverage(
        projectId,
        device,
        coverage,
        { requireQuality, requireSources, cacheScope: 'RANGE' }
      ),
      this.readSnapshotForCoverage(
        projectId,
        device,
        previous,
        { requireQuality, requireSources, cacheScope: 'RANGE' }
      )
    ]);
    const [currentSource, previousSource, comparisonResult] = await Promise.all([
      sourceKey === 'ALL'
        ? sourceForSnapshot(currentSnapshot, sourceKey)
        : this.readSourceTrend(projectId, currentSnapshot, sourceKey),
      sourceKey === 'ALL'
        ? sourceForSnapshot(previousSnapshot, sourceKey)
        : this.readSourceTrend(projectId, previousSnapshot, sourceKey),
      includeSourceComparison
        ? this.readSourceComparison(projectId, currentSnapshot, previousSnapshot)
        : null
    ]);
    if (currentSource.trend.length !== previousSource.trend.length) {
      throw new BaiduTongjiError(
        '前后周期趋势长度不一致',
        'TONGJI_RESPONSE_INVALID',
        502
      );
    }
    const summary = Object.fromEntries([
      'visits',
      'visitors',
      'pageviews'
    ].map((field) => [field, {
      current: currentSnapshot.summary[field],
      previous: previousSnapshot.summary[field],
      changePercent: comparisonValue(
        currentSnapshot.summary[field],
        previousSnapshot.summary[field]
      )
    }]));
    Object.assign(summary, {
      bounceRate: {
        current: requireQuality
          ? currentSnapshot.quality?.summary.bounceRate ?? null
          : null,
        previous: requireQuality
          ? previousSnapshot.quality?.summary.bounceRate ?? null
          : null,
        changePoints: requireQuality ? decimalDifference(
          currentSnapshot.quality?.summary.bounceRate ?? null,
          previousSnapshot.quality?.summary.bounceRate ?? null
        ) : null
      },
      averageVisitTime: {
        current: requireQuality
          ? currentSnapshot.quality?.summary.averageVisitTimeSeconds ?? null
          : null,
        previous: requireQuality
          ? previousSnapshot.quality?.summary.averageVisitTimeSeconds ?? null
          : null,
        changeSeconds: requireQuality ? decimalDifference(
          currentSnapshot.quality?.summary.averageVisitTimeSeconds ?? null,
          previousSnapshot.quality?.summary.averageVisitTimeSeconds ?? null
        ) : null
      },
      averageVisitPages: {
        current: requireQuality
          ? currentSnapshot.quality?.summary.averageVisitPages ?? null
          : null,
        previous: requireQuality
          ? previousSnapshot.quality?.summary.averageVisitPages ?? null
          : null,
        changePages: requireQuality ? decimalDifference(
          currentSnapshot.quality?.summary.averageVisitPages ?? null,
          previousSnapshot.quality?.summary.averageVisitPages ?? null
        ) : null
      }
    });
    const stableOrder = SOURCE_DEFINITIONS.map((source) => source.sourceKey);
    const sources = currentSnapshot.sources
      .map((source) => ({
        sourceKey: source.sourceKey,
        sourceLabel: source.sourceLabel,
        visits: source.summary.visits,
        trafficShare: trafficShare(
          source.summary.visits,
          currentSnapshot.summary.visits
        ),
        bounceRate: null,
        averageVisitTime: null,
        averageVisitPages: null,
        dataState: source.dataState
      }))
      .sort((left, right) => {
        const leftVisits = left.visits == null ? -1n : BigInt(left.visits);
        const rightVisits = right.visits == null ? -1n : BigInt(right.visits);
        if (leftVisits === rightVisits) {
          return stableOrder.indexOf(left.sourceKey)
            - stableOrder.indexOf(right.sourceKey);
        }
        return leftVisits > rightVisits ? -1 : 1;
      });
    const qualityField = {
      bounceRate: 'bounceRate',
      averageVisitTime: 'averageVisitTimeSeconds',
      averageVisitPages: 'averageVisitPages'
    }[metric];
    const qualityAvailable = requireQuality
      && sourceKey === 'ALL'
      && Boolean(qualityField);
    const currentQualityRows = currentSnapshot.quality?.rows || [];
    const previousQualityRows = previousSnapshot.quality?.rows || [];
    const selectedSummaryValue = qualityField
      ? currentSnapshot.quality?.summary[qualityField] ?? null
      : currentSource.summary[metric];
    const response = {
      projectId: String(projectId),
      source: 'BAIDU_TONGJI',
      mode: 'DATABASE_RANGE_SNAPSHOT',
      site: { domain: currentSnapshot.site.domain },
      device,
      coverage: { from: coverage.from, to: coverage.to },
      previousCoverage: previous,
      selectedSource: {
        sourceKey,
        sourceLabel: sourceKey === 'ALL'
          ? '全部来源'
          : currentSnapshot.sources.find(
              (source) => source.sourceKey === sourceKey
            ).sourceLabel
      },
      selectedMetric: metric,
      selectedMetricState: ['visits', 'visitors', 'pageviews'].includes(metric)
        ? dataState({ value: currentSource.summary[metric] })
        : !qualityAvailable ? 'UNAVAILABLE'
          : selectedSummaryValue == null ? 'NO_DATA' : 'DATA',
      dataState: currentSnapshot.dataState,
      summary,
      trend: currentSource.trend.map((row, index) => ({
        date: row.date,
        previousDate: previousSource.trend[index].date,
        current: qualityAvailable
          ? currentQualityRows[index]?.[qualityField] ?? null
          : metricValue(row, metric),
        previous: qualityAvailable
          ? previousQualityRows[index]?.[qualityField] ?? null
          : metricValue(previousSource.trend[index], metric)
      })),
      sourceQuality: {
        allSiteBounceRate: requireQuality
          ? currentSnapshot.quality?.summary.bounceRate ?? null
          : null,
        rows: sources
      },
      capabilities: websiteCapabilities(this.capabilities),
      cache: {
        state: cacheState(
          currentSnapshot.cache.state,
          previousSnapshot.cache.state,
          currentSource.cache?.state,
          previousSource.cache?.state,
          ...(comparisonResult?.cacheStates || [])
        ),
        current: currentSnapshot.cache,
        previous: previousSnapshot.cache
      }
    };
    if (comparisonResult) {
      response.sourceComparison = comparisonResult.payload;
    }
    return response;
  }

  async readProjectWebsitePages(projectId, options = {}) {
    this.assertProjectAllowed(projectId);
    const device = normalizeDevice(options.device || 'all');
    const coverage = normalizeCoverage({ from: options.from, to: options.to });
    const view = options.view || 'landing';
    const page = strictPositiveInteger(options.page, 1);
    const pageSize = strictPositiveInteger(options.pageSize, 10);
    const sortOrder = options.sortOrder || 'descend';
    if (!['landing', 'visited'].includes(view)) {
      throw new BaiduTongjiError(
        '页面报告视图无效',
        'TONGJI_PAGE_VIEW_INVALID',
        400
      );
    }
    const allowedSorts = view === 'landing'
      ? new Set([
          'visits',
          'contributionPageviews',
          'bounceRate',
          'averageVisitTime',
          'averageVisitPages'
        ])
      : new Set([
          'pageviews',
          'visitors',
          'averageStayTime',
          'downstreamPageviews',
          'exitRate'
        ]);
    const sortBy = options.sortBy || (view === 'landing' ? 'visits' : 'pageviews');
    const query = options.query === undefined
      ? ''
      : typeof options.query === 'string'
        ? options.query.trim()
        : null;
    if (
      !Number.isSafeInteger(page)
      || page < 1
      || !Number.isSafeInteger(pageSize)
      || pageSize < 1
      || pageSize > 100
      || !allowedSorts.has(sortBy)
      || !['ascend', 'descend'].includes(sortOrder)
      || query === null
      || query.length > 200
    ) {
      throw new BaiduTongjiError(
        '页面报告查询参数无效',
        'TONGJI_PAGE_QUERY_INVALID',
        400
      );
    }
    const capabilities = websiteCapabilities(this.capabilities);
    if (!capabilities.pageReports) return {
      projectId: String(projectId),
      source: 'BAIDU_TONGJI',
      device,
      coverage: { from: coverage.from, to: coverage.to },
      view,
      dataState: 'UNAVAILABLE',
      rows: [],
      pagination: {
        page,
        pageSize,
        totalItems: null,
        totalPages: null
      },
      sort: { field: sortBy, order: sortOrder },
      query,
      scope: { source: 'ALL', label: '全部来源' },
      dataQuality: { excludedCrossDomainRows: null },
      capabilities
    };
    const { connection } = await this.getProjectAndConnection(projectId);
    if (typeof this.provider.readPageReport !== 'function') {
      throw new BaiduTongjiError(
        '百度统计页面报告 provider 未配置',
        'TONGJI_PAGE_PROVIDER_MISSING',
        500
      );
    }
    const reportKey = [
      projectId,
      connection.binding_id,
      connection.tongji_site_id,
      device,
      coverage.from,
      coverage.to,
      view
    ].join(':');
    let cached = this.pageReportCache.get(reportKey);
    if (!cached) {
      cached = await this.readPageReportCache({
        projectId,
        connection,
        coverage,
        device,
        view
      });
      if (cached) this.pageReportCache.set(reportKey, cached);
    }
    const cachedAgeMs = cached
      ? this.clock() - cached.refreshedAtMs
      : Number.POSITIVE_INFINITY;
    let normalizedReport;
    let cache;
    if (cached && cachedAgeMs < this.cacheTtlMs) {
      normalizedReport = cached.report;
      cache = {
        state: 'HIT',
        refreshedAt: new Date(cached.refreshedAtMs).toISOString()
      };
    } else {
      const refreshKey = `page-report:${reportKey}`;
      if (!this.refreshes.has(refreshKey)) {
        const refresh = (async () => {
          const raw = await this.provider.readPageReport({
            connection,
            coverage,
            device,
            view
          });
          const report = normalizePageReport(
            raw,
            view,
            connection.tongji_site_domain
          );
          const refreshedAtMs = await this.savePageReportCache({
            projectId,
            connection,
            coverage,
            device,
            view,
            report
          });
          for (const [key, value] of this.pageReportCache) {
            if (refreshedAtMs - value.refreshedAtMs > this.cacheMaxStaleMs) {
              this.pageReportCache.delete(key);
            }
          }
          this.pageReportCache.delete(reportKey);
          while (this.pageReportCache.size >= PAGE_REPORT_CACHE_MAX_ENTRIES) {
            this.pageReportCache.delete(this.pageReportCache.keys().next().value);
          }
          this.pageReportCache.set(reportKey, { report, refreshedAtMs });
          return { report, refreshedAtMs };
        })().finally(() => this.refreshes.delete(refreshKey));
        this.refreshes.set(refreshKey, refresh);
      }
      try {
        const refreshed = await this.refreshes.get(refreshKey);
        normalizedReport = refreshed.report;
        cache = {
          state: 'REFRESHED',
          refreshedAt: new Date(refreshed.refreshedAtMs).toISOString()
        };
      } catch (error) {
        if (!cached || cachedAgeMs > this.cacheMaxStaleMs) throw error;
        normalizedReport = cached.report;
        cache = {
          state: 'FALLBACK',
          refreshedAt: new Date(cached.refreshedAtMs).toISOString(),
          staleAgeSeconds: Math.max(0, Math.floor(cachedAgeMs / 1000))
        };
      }
    }
    const normalized = normalizedReport.rows;
    const needle = query.toLocaleLowerCase('zh-CN');
    const filtered = needle
      ? normalized.filter((row) => (
          (row.title || '').toLocaleLowerCase('zh-CN').includes(needle)
          || row.path.toLocaleLowerCase('zh-CN').includes(needle)
        ))
      : normalized;
    filtered.sort((left, right) => {
      const compared = comparePageMetrics(left[sortBy], right[sortBy]);
      if (compared !== 0) return sortOrder === 'ascend' ? compared : -compared;
      return left.path.localeCompare(right.path, 'zh-CN');
    });
    const offset = (page - 1) * pageSize;
    const totalItems = filtered.length;
    return {
      projectId: String(projectId),
      source: 'BAIDU_TONGJI',
      device,
      coverage: { from: coverage.from, to: coverage.to },
      view,
      dataState: totalItems > 0 ? 'DATA' : 'NO_DATA',
      rows: filtered.slice(offset, offset + pageSize),
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / pageSize)
      },
      sort: { field: sortBy, order: sortOrder },
      query,
      scope: { source: 'ALL', label: '全部来源' },
      dataQuality: {
        excludedCrossDomainRows: normalizedReport.excludedCrossDomainRows
      },
      cache,
      capabilities
    };
  }
}

module.exports = {
  BaiduTongjiError,
  BaiduTongjiService,
  buildSourcePartition,
  buildSnapshotPayload,
  comparisonValue,
  normalizeStoredPayload,
  previousCoverage,
  trafficShare
};
