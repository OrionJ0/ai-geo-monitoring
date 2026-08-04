const {
  SOURCE_KEYS,
  SOURCE_KEY_SET,
  classifyWebsiteAttribution
} = require('../../../domain/marketingSourceClassifier');

const SNAPSHOT_SCHEMA_VERSION = 'website_form_consultations_v3';
const SNAPSHOT_KINDS = Object.freeze({ aggregate: 'AGGREGATE', daily: 'DAILY' });
const MAX_CONTACT_RECORDS = 10000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

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
    Date.parse(`${to}T00:00:00.000Z`)
    - Date.parse(`${from}T00:00:00.000Z`)
  ) / 86400000 + 1;
  if (days > 180) {
    throw new WebsiteFormConsultationError(
      '官网表单咨询日期范围超过 180 天',
      'WEBSITE_FORM_DATE_RANGE_TOO_LARGE',
      422
    );
  }
  return { from, to, timeZone: 'Asia/Shanghai' };
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

function exactCount(value) {
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) {
    throw new WebsiteFormConsultationError(
      '官网表单咨询快照无效',
      'WEBSITE_FORM_SNAPSHOT_INVALID'
    );
  }
  return BigInt(value);
}

function invalidContactRecords() {
  return new WebsiteFormConsultationError(
    '官网联系人记录无法用于表单咨询统计',
    'WEBSITE_FORM_CONTACT_RECORDS_INVALID',
    502
  );
}

function shanghaiDate(value) {
  if (typeof value !== 'string') throw invalidContactRecords();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw invalidContactRecords();
  }
  return new Date(parsed.getTime() + SHANGHAI_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

function sourceRows(counts) {
  return SOURCE_KEYS.flatMap((sourceKey) => {
    const count = counts.get(sourceKey) || 0n;
    return count === 0n ? [] : [{
      sourceKey,
      formConsultationRecords: count.toString()
    }];
  });
}

function aggregateContactRecords(records, coverage, includeDays = false) {
  if (!Array.isArray(records) || records.length > MAX_CONTACT_RECORDS) {
    throw invalidContactRecords();
  }
  const seen = new Set();
  const totalCounts = new Map();
  const dailyCounts = new Map(
    expectedDates(coverage).map((date) => [date, new Map()])
  );
  for (const record of records) {
    const id = String(record?.id || '');
    if (!id || seen.has(id)) throw invalidContactRecords();
    seen.add(id);
    const date = shanghaiDate(record.createdAt);
    if (date < coverage.from || date > coverage.to || !dailyCounts.has(date)) {
      throw invalidContactRecords();
    }
    const sourceKey = classifyWebsiteAttribution(record).sourceKey;
    if (!SOURCE_KEY_SET.has(sourceKey)) throw invalidContactRecords();
    totalCounts.set(sourceKey, (totalCounts.get(sourceKey) || 0n) + 1n);
    const day = dailyCounts.get(date);
    day.set(sourceKey, (day.get(sourceKey) || 0n) + 1n);
  }
  const payload = {
    formConsultationRecords: String(records.length),
    sourceBreakdown: sourceRows(totalCounts)
  };
  if (!includeDays) return payload;
  return {
    ...payload,
    days: [...dailyCounts].map(([date, counts]) => {
      const sourceBreakdown = sourceRows(counts);
      const total = sourceBreakdown.reduce(
        (sum, row) => sum + BigInt(row.formConsultationRecords),
        0n
      );
      return {
        date,
        formConsultationRecords: total.toString(),
        sourceBreakdown
      };
    })
  };
}

function normalizeStoredPayload(payload) {
  const total = exactCount(payload?.formConsultationRecords);
  if (!Array.isArray(payload?.sourceBreakdown)) {
    throw new WebsiteFormConsultationError(
      '官网表单咨询快照无效',
      'WEBSITE_FORM_SNAPSHOT_INVALID'
    );
  }
  const seen = new Set();
  const sourceBreakdown = payload.sourceBreakdown.map((row) => {
    const sourceKey = String(row?.sourceKey || '');
    const count = exactCount(row?.formConsultationRecords);
    if (
      !SOURCE_KEY_SET.has(sourceKey)
      || seen.has(sourceKey)
      || count === 0n
    ) {
      throw new WebsiteFormConsultationError(
        '官网表单咨询快照无效',
        'WEBSITE_FORM_SNAPSHOT_INVALID'
      );
    }
    seen.add(sourceKey);
    return {
      sourceKey,
      formConsultationRecords: count.toString()
    };
  });
  const sourceTotal = sourceBreakdown.reduce(
    (sum, row) => sum + BigInt(row.formConsultationRecords),
    0n
  );
  if (sourceTotal !== total) {
    throw new WebsiteFormConsultationError(
      '官网表单咨询快照无效',
      'WEBSITE_FORM_SNAPSHOT_INVALID'
    );
  }
  return {
    formConsultationRecords: total.toString(),
    sourceBreakdown
  };
}

function normalizeStoredDailyPayload(payload, coverage) {
  const normalized = normalizeStoredPayload(payload);
  const dates = expectedDates(coverage);
  if (!Array.isArray(payload?.days) || payload.days.length !== dates.length) {
    throw new WebsiteFormConsultationError(
      '官网表单逐日快照无效',
      'WEBSITE_FORM_DAILY_SNAPSHOT_INVALID'
    );
  }
  const days = payload.days.map((row, index) => {
    if (row?.date !== dates[index]) {
      throw new WebsiteFormConsultationError(
        '官网表单逐日快照无效',
        'WEBSITE_FORM_DAILY_SNAPSHOT_INVALID'
      );
    }
    return { date: row.date, ...normalizeStoredPayload(row) };
  });
  const dailyTotal = days.reduce(
    (sum, day) => sum + BigInt(day.formConsultationRecords),
    0n
  );
  if (dailyTotal !== BigInt(normalized.formConsultationRecords)) {
    throw new WebsiteFormConsultationError(
      '官网表单逐日快照无效',
      'WEBSITE_FORM_DAILY_SNAPSHOT_INVALID'
    );
  }
  return { ...normalized, days };
}

function publicResponse({ projectId, coverage, payload, cache }) {
  return {
    projectId: String(projectId),
    sourceSystem: 'GATO_WEBSITE',
    consultationType: 'WEBSITE_FORM',
    dataCoverage: 'ALL_FORM_RECORDS',
    coverage,
    dataState: payload.formConsultationRecords === '0' ? 'ZERO' : 'DATA',
    summary: {
      formConsultationRecords: payload.formConsultationRecords
    },
    sourceBreakdown: payload.sourceBreakdown,
    cache
  };
}

function cacheState(state, snapshot) {
  return {
    state,
    refreshedAt: new Date(snapshot.refreshedAt).toISOString(),
    expiresAt: new Date(snapshot.expiresAt).toISOString()
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
      || typeof sourceClient.readContactRecords !== 'function'
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

  assertProject(projectId) {
    if (String(projectId) !== this.configuredProjectId) {
      throw new WebsiteFormConsultationError(
        '项目没有配置官网表单数据源',
        'WEBSITE_FORM_PROJECT_NOT_CONFIGURED',
        404
      );
    }
  }

  async read({ projectId, from, to }) {
    this.assertProject(projectId);
    const coverage = normalizeCoverage(from, to);
    const now = this.clock();
    const cached = await this.snapshotRepository.read({
      projectId: this.configuredProjectId,
      payloadKind: SNAPSHOT_KINDS.aggregate,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      coverage
    });
    if (cached && Date.parse(cached.expiresAt) > now) {
      return publicResponse({
        projectId,
        coverage,
        payload: normalizeStoredPayload(cached.payload),
        cache: cacheState('HIT', cached)
      });
    }
    let payload;
    try {
      const records = await this.sourceClient.readContactRecords({
        from,
        to,
        maxRecords: MAX_CONTACT_RECORDS
      });
      payload = aggregateContactRecords(records, coverage);
    } catch (error) {
      if (
        cached
        && now - Date.parse(cached.refreshedAt) <= this.maxStaleMs
      ) {
        return publicResponse({
          projectId,
          coverage,
          payload: normalizeStoredPayload(cached.payload),
          cache: cacheState('FALLBACK', cached)
        });
      }
      throw error;
    }
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
    this.assertProject(projectId);
    const coverage = normalizeCoverage(from, to);
    if (expectedDates(coverage).length > 31) {
      throw new WebsiteFormConsultationError(
        '官网表单逐日查询最多支持连续 31 日',
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
    if (cached && Date.parse(cached.expiresAt) > now) {
      const payload = normalizeStoredDailyPayload(cached.payload, coverage);
      return {
        ...publicResponse({
          projectId,
          coverage,
          payload,
          cache: cacheState('HIT', cached)
        }),
        days: payload.days
      };
    }
    let payload;
    try {
      const records = await this.sourceClient.readContactRecords({
        from,
        to,
        maxRecords: MAX_CONTACT_RECORDS
      });
      payload = aggregateContactRecords(records, coverage, true);
    } catch (error) {
      if (
        cached
        && now - Date.parse(cached.refreshedAt) <= this.maxStaleMs
      ) {
        const fallback = normalizeStoredDailyPayload(cached.payload, coverage);
        return {
          ...publicResponse({
            projectId,
            coverage,
            payload: fallback,
            cache: cacheState('FALLBACK', cached)
          }),
          days: fallback.days
        };
      }
      throw error;
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
    return {
      ...publicResponse({
        projectId,
        coverage,
        payload,
        cache: { state: 'REFRESHED', refreshedAt, expiresAt }
      }),
      days: payload.days
    };
  }
}

module.exports = {
  WebsiteFormConsultationError,
  WebsiteFormConsultationService
};
