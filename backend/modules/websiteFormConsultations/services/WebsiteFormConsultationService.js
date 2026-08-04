const {
  SOURCE_KEY_SET: CANONICAL_SOURCE_KEYS
} = require('../../../domain/marketingSourceClassifier');

const UPSTREAM_SOURCE_KEY_MAP = Object.freeze({
  baidu_paid: 'BAIDU_PAID',
  direct: 'DIRECT',
  organic_search: 'UNKNOWN',
  referral: 'UNKNOWN',
  campaign: 'UTM_CAMPAIGN',
  social: 'UNKNOWN',
  unknown: 'UNKNOWN'
});
const SNAPSHOT_SCHEMA_VERSION = 'website_form_consultations_v2';
const SNAPSHOT_KINDS = Object.freeze({ aggregate: 'AGGREGATE', daily: 'DAILY' });

class WebsiteFormConsultationError extends Error {
  constructor(message, code, status = 500) {
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

function normalizeCoverage(from, to) {
  if (!strictDate(from) || !strictDate(to) || from > to) {
    throw new WebsiteFormConsultationError(
      '官网表单咨询日期范围无效',
      'WEBSITE_FORM_DATE_RANGE_INVALID',
      422
    );
  }
  const days = (
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`))
    / 86400000
  ) + 1;
  if (days > 180) {
    throw new WebsiteFormConsultationError(
      '官网表单咨询日期范围超过 180 天',
      'WEBSITE_FORM_DATE_RANGE_TOO_LARGE',
      422
    );
  }
  return { from, to, timeZone: 'Asia/Shanghai' };
}

function exactCount(value) {
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) {
    throw new WebsiteFormConsultationError(
      '官网表单咨询快照无效',
      'WEBSITE_FORM_SNAPSHOT_INVALID'
    );
  }
  return BigInt(value);
}

function normalizePayload(payload) {
  const total = exactCount(payload?.attributedFormSubmissionSessions);
  if (!Array.isArray(payload?.sourceBreakdown)) {
    throw new WebsiteFormConsultationError(
      '官网表单咨询快照无效',
      'WEBSITE_FORM_SNAPSHOT_INVALID'
    );
  }
  const grouped = new Map();
  let sourceTotal = 0n;
  for (const row of payload.sourceBreakdown) {
    const upstreamSource = String(row?.upstreamSource || '').trim();
    const count = exactCount(row?.attributedFormSubmissionSessions);
    const sourceKey = UPSTREAM_SOURCE_KEY_MAP[upstreamSource] || 'UNKNOWN';
    const current = grouped.get(sourceKey) || {
      sourceKey,
      upstreamSources: [],
      attributedFormSubmissionSessions: 0n
    };
    if (!current.upstreamSources.includes(upstreamSource)) {
      current.upstreamSources.push(upstreamSource);
    }
    current.attributedFormSubmissionSessions += count;
    grouped.set(sourceKey, current);
    sourceTotal += count;
  }
  if (sourceTotal > total) {
    throw new WebsiteFormConsultationError(
      '官网表单来源数量超过汇总数量',
      'WEBSITE_FORM_SNAPSHOT_INVALID'
    );
  }
  if (sourceTotal < total) {
    const current = grouped.get('UNKNOWN') || {
      sourceKey: 'UNKNOWN',
      upstreamSources: [],
      attributedFormSubmissionSessions: 0n
    };
    current.upstreamSources.push('unassigned');
    current.attributedFormSubmissionSessions += total - sourceTotal;
    grouped.set('UNKNOWN', current);
  }
  return {
    attributedFormSubmissionSessions: total.toString(),
    sourceBreakdown: [...grouped.values()].map((row) => ({
      ...row,
      attributedFormSubmissionSessions:
        row.attributedFormSubmissionSessions.toString()
    }))
  };
}

function normalizeStoredPayload(payload) {
  const total = exactCount(payload?.attributedFormSubmissionSessions);
  if (!Array.isArray(payload?.sourceBreakdown)) {
    throw new WebsiteFormConsultationError(
      '官网表单咨询快照无效',
      'WEBSITE_FORM_SNAPSHOT_INVALID'
    );
  }
  const seen = new Set();
  const sourceBreakdown = payload.sourceBreakdown.map((row) => {
    const sourceKey = String(row?.sourceKey || '');
    const upstreamSources = Array.isArray(row?.upstreamSources)
      ? row.upstreamSources.map((value) => String(value).trim())
      : null;
    if (
      !CANONICAL_SOURCE_KEYS.has(sourceKey)
      || seen.has(sourceKey)
      || !upstreamSources
      || upstreamSources.some((value) => !value || value.length > 64)
    ) {
      throw new WebsiteFormConsultationError(
        '官网表单咨询快照无效',
        'WEBSITE_FORM_SNAPSHOT_INVALID'
      );
    }
    seen.add(sourceKey);
    return {
      sourceKey,
      upstreamSources,
      attributedFormSubmissionSessions:
        exactCount(row?.attributedFormSubmissionSessions).toString()
    };
  });
  const sourceTotal = sourceBreakdown.reduce(
    (sum, row) => sum + BigInt(row.attributedFormSubmissionSessions),
    0n
  );
  if (sourceTotal !== total) {
    throw new WebsiteFormConsultationError(
      '官网表单咨询快照无效',
      'WEBSITE_FORM_SNAPSHOT_INVALID'
    );
  }
  return {
    attributedFormSubmissionSessions: total.toString(),
    sourceBreakdown
  };
}

function expectedDates(coverage) {
  const dates = [];
  for (
    let cursor = Date.parse(`${coverage.from}T00:00:00.000Z`);
    cursor <= Date.parse(`${coverage.to}T00:00:00.000Z`);
    cursor += 86400000
  ) dates.push(new Date(cursor).toISOString().slice(0, 10));
  return dates;
}

function normalizeDailyPayload(payload, stored = false) {
  const coveragePayload = stored
    ? normalizeStoredPayload(payload)
    : normalizePayload(payload);
  if (!Array.isArray(payload?.days)) {
    throw new WebsiteFormConsultationError(
      '官网表单逐日快照无效',
      'WEBSITE_FORM_DAILY_SNAPSHOT_INVALID'
    );
  }
  const seen = new Set();
  const days = payload.days.map((row) => {
    const date = String(row?.date || '');
    if (!strictDate(date) || seen.has(date)) {
      throw new WebsiteFormConsultationError(
        '官网表单逐日快照无效',
        'WEBSITE_FORM_DAILY_SNAPSHOT_INVALID'
      );
    }
    seen.add(date);
    return {
      date,
      ...(stored ? normalizeStoredPayload(row) : normalizePayload(row))
    };
  }).sort((left, right) => left.date.localeCompare(right.date));
  const dailyTotal = days.reduce(
    (sum, row) => sum + BigInt(row.attributedFormSubmissionSessions),
    0n
  );
  if (
    dailyTotal !== BigInt(coveragePayload.attributedFormSubmissionSessions)
  ) {
    throw new WebsiteFormConsultationError(
      '官网表单逐日数量与范围汇总不一致',
      'WEBSITE_FORM_DAILY_SNAPSHOT_INVALID'
    );
  }
  return { ...coveragePayload, days };
}

function coverageCapabilities(payload) {
  return {
    capabilities: {
      dailyBreakdown: true,
      formRecordTotal: false,
      unattributedFormRecords: false,
      attributionRate: false
    },
    attributionCoverage: {
      state: 'FORM_RECORD_TOTAL_UNAVAILABLE',
      attributedFormSubmissionSessions:
        payload.attributedFormSubmissionSessions,
      formRecordTotal: null,
      unattributedFormRecords: null,
      attributionRatePercent: null
    }
  };
}

function publicResponse({ projectId, coverage, payload, cache }) {
  return {
    projectId: String(projectId),
    sourceSystem: 'GATO_WEBSITE',
    consultationType: 'WEBSITE_FORM',
    dataCoverage: 'ATTRIBUTED_SESSION_SUBMISSIONS_ONLY',
    formRecordTotalAvailable: false,
    coverage,
    dataState: payload.attributedFormSubmissionSessions === '0'
      ? 'ZERO'
      : 'DATA',
    summary: {
      attributedFormSubmissionSessions:
        payload.attributedFormSubmissionSessions
    },
    ...coverageCapabilities(payload),
    sourceBreakdown: payload.sourceBreakdown,
    cache
  };
}

function dailyPublicResponse({ projectId, coverage, payload, cache }) {
  return {
    ...publicResponse({ projectId, coverage, payload, cache }),
    days: payload.days
  };
}

class WebsiteFormConsultationService {
  constructor({
    sourceClient,
    snapshotRepository,
    configuredProjectId,
    cacheTtlMs,
    maxStaleMs = 86400000,
    clock = () => Date.now()
  }) {
    if (
      !sourceClient
      || typeof sourceClient.readFormConsultations !== 'function'
      || !snapshotRepository
      || typeof snapshotRepository.read !== 'function'
      || typeof snapshotRepository.save !== 'function'
      || !/^\d+$/u.test(String(configuredProjectId || ''))
      || !Number.isSafeInteger(cacheTtlMs)
      || cacheTtlMs < 60000
      || cacheTtlMs > 3600000
      || !Number.isSafeInteger(maxStaleMs)
      || maxStaleMs < cacheTtlMs
      || maxStaleMs > 604800000
    ) {
      throw new WebsiteFormConsultationError(
        '官网表单咨询服务配置无效',
        'WEBSITE_FORM_SERVICE_CONFIG_INVALID'
      );
    }
    this.sourceClient = sourceClient;
    this.snapshotRepository = snapshotRepository;
    this.configuredProjectId = String(configuredProjectId);
    this.cacheTtlMs = cacheTtlMs;
    this.maxStaleMs = maxStaleMs;
    this.clock = clock;
  }

  async read({ projectId, from, to }) {
    if (String(projectId) !== this.configuredProjectId) {
      throw new WebsiteFormConsultationError(
        '项目没有配置官网表单数据源',
        'WEBSITE_FORM_PROJECT_NOT_CONFIGURED',
        404
      );
    }
    const coverage = normalizeCoverage(from, to);
    const now = this.clock();
    const cached = await this.snapshotRepository.read({
      projectId: this.configuredProjectId,
      payloadKind: SNAPSHOT_KINDS.aggregate,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      coverage
    });
    if (
      cached
      && cached.coverage?.from === coverage.from
      && cached.coverage?.to === coverage.to
      && Date.parse(cached.expiresAt) > now
    ) {
      return publicResponse({
        projectId,
        coverage,
        payload: normalizeStoredPayload(cached.payload),
        cache: {
          state: 'HIT',
          refreshedAt: new Date(cached.refreshedAt).toISOString(),
          expiresAt: new Date(cached.expiresAt).toISOString()
        }
      });
    }
    let sourcePayload;
    try {
      sourcePayload = await this.sourceClient.readFormConsultations({
        from,
        to
      });
    } catch (error) {
      if (
        cached
        && cached.coverage?.from === coverage.from
        && cached.coverage?.to === coverage.to
        && now - Date.parse(cached.refreshedAt) <= this.maxStaleMs
      ) {
        return publicResponse({
          projectId,
          coverage,
          payload: normalizeStoredPayload(cached.payload),
          cache: {
            state: 'FALLBACK',
            refreshedAt: new Date(cached.refreshedAt).toISOString(),
            expiresAt: new Date(cached.expiresAt).toISOString()
          }
        });
      }
      throw error;
    }
    const payload = normalizePayload(sourcePayload);
    const refreshedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + this.cacheTtlMs).toISOString();
    await this.snapshotRepository.save({
      projectId: this.configuredProjectId,
      payloadKind: SNAPSHOT_KINDS.aggregate,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      coverage,
      payload,
      refreshedAt,
      expiresAt,
      staleCutoff: new Date(now - this.maxStaleMs).toISOString()
    });
    return publicResponse({
      projectId,
      coverage,
      payload,
      cache: { state: 'REFRESHED', refreshedAt, expiresAt }
    });
  }

  async readDaily({ projectId, from, to }) {
    if (String(projectId) !== this.configuredProjectId) {
      throw new WebsiteFormConsultationError(
        '项目没有配置官网表单数据源',
        'WEBSITE_FORM_PROJECT_NOT_CONFIGURED',
        404
      );
    }
    const coverage = normalizeCoverage(from, to);
    if (expectedDates(coverage).length > 31) {
      throw new WebsiteFormConsultationError(
        '官网表单逐日范围超过 31 天',
        'WEBSITE_FORM_DAILY_RANGE_TOO_LARGE',
        422
      );
    }
    const now = this.clock();
    const cached = await this.snapshotRepository.read({
      projectId: this.configuredProjectId,
      payloadKind: SNAPSHOT_KINDS.daily,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      coverage
    });
    const matchingDailyCache = cached
      && cached.coverage?.from === coverage.from
      && cached.coverage?.to === coverage.to
      && Array.isArray(cached.payload?.days);
    if (matchingDailyCache && Date.parse(cached.expiresAt) > now) {
      return dailyPublicResponse({
        projectId,
        coverage,
        payload: normalizeDailyPayload(cached.payload, true),
        cache: {
          state: 'HIT',
          refreshedAt: new Date(cached.refreshedAt).toISOString(),
          expiresAt: new Date(cached.expiresAt).toISOString()
        }
      });
    }
    if (typeof this.sourceClient.readFormConsultationDays !== 'function') {
      throw new WebsiteFormConsultationError(
        '官网表单逐日数据源未配置',
        'WEBSITE_FORM_DAILY_SOURCE_UNAVAILABLE',
        503
      );
    }
    let sourcePayload;
    try {
      sourcePayload = await this.sourceClient.readFormConsultationDays({
        from,
        to
      });
    } catch (error) {
      if (matchingDailyCache) {
        if (now - Date.parse(cached.refreshedAt) > this.maxStaleMs) {
          throw error;
        }
        return dailyPublicResponse({
          projectId,
          coverage,
          payload: normalizeDailyPayload(cached.payload, true),
          cache: {
            state: 'FALLBACK',
            refreshedAt: new Date(cached.refreshedAt).toISOString(),
            expiresAt: new Date(cached.expiresAt).toISOString()
          }
        });
      }
      throw error;
    }
    const payload = normalizeDailyPayload(sourcePayload);
    const dates = expectedDates(coverage);
    if (
      payload.days.length !== dates.length
      || payload.days.some((row, index) => row.date !== dates[index])
    ) {
      throw new WebsiteFormConsultationError(
        '官网表单逐日覆盖范围不完整',
        'WEBSITE_FORM_DAILY_SNAPSHOT_INVALID'
      );
    }
    const refreshedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + this.cacheTtlMs).toISOString();
    await this.snapshotRepository.save({
      projectId: this.configuredProjectId,
      payloadKind: SNAPSHOT_KINDS.daily,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      coverage,
      payload,
      refreshedAt,
      expiresAt,
      staleCutoff: new Date(now - this.maxStaleMs).toISOString()
    });
    return dailyPublicResponse({
      projectId,
      coverage,
      payload,
      cache: { state: 'REFRESHED', refreshedAt, expiresAt }
    });
  }
}

module.exports = {
  WebsiteFormConsultationError,
  WebsiteFormConsultationService,
  normalizeCoverage,
  normalizeDailyPayload,
  normalizePayload,
  normalizeStoredPayload
};
