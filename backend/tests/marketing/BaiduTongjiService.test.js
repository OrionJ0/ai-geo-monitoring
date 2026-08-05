const assert = require('node:assert/strict');
const test = require('node:test');
const { QueryTypes } = require('sequelize');

const {
  BaiduTongjiService,
  buildSnapshotPayload,
  comparisonValue,
  trafficShare
} = require('../../modules/marketing/services/BaiduTongjiService');
const {
  createMarketingTestDatabase,
  seedConnectionAndBinding
} = require('./helpers/createMarketingTestDatabase');

function rows(pageviews, visits, visitors) {
  return [
    {
      date: '2026-07-29',
      pageviews: String(pageviews),
      visits: String(visits),
      visitors: String(visitors)
    },
    {
      date: '2026-07-30',
      pageviews: null,
      visits: null,
      visitors: null
    }
  ];
}

function trafficSnapshot() {
  return {
    site: {
      siteId: '301',
      domain: 'active.example.test',
      status: 'ACTIVE'
    },
    allTrend: rows(100, 15, 10),
    sourceSummaries: [
      { name: '直接访问', source: 'through', pageviews: '20', visits: '3', visitors: '3' },
      { name: '百度自然搜索', source: 'searchBaiduNature', pageviews: '30', visits: '4', visitors: '4' },
      { name: '外部链接', source: 'link', pageviews: '25', visits: '4', visitors: '4' },
      { name: '其他搜索引擎', source: 'searchOther', pageviews: '20', visits: '3', visitors: '3' },
      { name: '百度搜索推广', source: 'searchBaiduProFc', pageviews: '5', visits: '1', visitors: '1' }
    ],
    engineSummaries: [
      { name: '百度自然搜索', source: 'searchBaiduNature', engineId: '1', pageviews: '30', visits: '4', visitors: '4' },
      { name: 'Google', source: 'search,2', engineId: '2', pageviews: '5', visits: '1', visitors: '1' },
      { name: '必应', source: 'search,14', engineId: '14', pageviews: '15', visits: '2', visitors: '2' },
      { name: '百度付费推广', source: 'searchBaiduPro', engineId: '1', pageviews: '5', visits: '1', visitors: '1' }
    ],
    sourceTrends: [
      { sourceKey: 'BAIDU_NATURAL', rows: rows(30, 4, 4) },
      { sourceKey: 'DIRECT', rows: rows(20, 3, 3) },
      { sourceKey: 'OTHER_SEARCH', rows: rows(20, 3, 3) },
      { sourceKey: 'EXTERNAL', rows: rows(25, 4, 4) }
    ],
    engineTrends: [
      { engineId: '14', rows: rows(15, 2, 2) }
    ]
  };
}

test('Tongji source aggregation preserves missing values and real zeroes', () => {
  const missing = trafficSnapshot();
  missing.sourceSummaries = missing.sourceSummaries.map((row) => ({
    ...row,
    pageviews: null,
    visits: null,
    visitors: null
  }));
  missing.engineSummaries = missing.engineSummaries.map((row) => ({
    ...row,
    pageviews: null,
    visits: null,
    visitors: null
  }));
  const missingPayload = buildSnapshotPayload(
    missing,
    { from: '2026-07-29', to: '2026-07-30' },
    'all'
  );
  assert.ok(missingPayload.sources.every((source) => (
    source.summary.visits === null
  )));

  const zero = trafficSnapshot();
  zero.allTrend = rows(0, 0, 0);
  zero.sourceSummaries = zero.sourceSummaries.map((row) => ({
    ...row,
    pageviews: '0',
    visits: '0',
    visitors: '0'
  }));
  zero.engineSummaries = zero.engineSummaries.map((row) => ({
    ...row,
    pageviews: '0',
    visits: '0',
    visitors: '0'
  }));
  const zeroPayload = buildSnapshotPayload(
    zero,
    { from: '2026-07-29', to: '2026-07-30' },
    'all'
  );
  assert.ok(zeroPayload.sources.every((source) => (
    source.summary.visits === '0'
  )));
});

test('Tongji ratios use exact half-up rounding and reject impossible shares', () => {
  assert.equal(trafficShare('1', '6'), '16.7');
  assert.equal(comparisonValue('5', '6'), '-16.7');
  assert.throws(
    () => trafficShare('7', '6'),
    { code: 'TONGJI_SOURCE_RESPONSE_INVALID', status: 502 }
  );
});

test('Tongji snapshot rejects a source partition whose classified visits exceed the total', () => {
  const invalid = trafficSnapshot();
  invalid.allTrend = rows(100, 14, 10);
  invalid.allTrend[1].visits = '0';
  assert.throws(
    () => buildSnapshotPayload(
      invalid,
      { from: '2026-07-29', to: '2026-07-30' },
      'all'
    ),
    { code: 'TONGJI_SOURCE_PARTITION_INVALID', status: 502 }
  );
});

test('Tongji snapshot keeps the existing exact pageview partition contract', () => {
  const invalid = trafficSnapshot();
  invalid.allTrend = rows(101, 15, 10);
  assert.throws(
    () => buildSnapshotPayload(
      invalid,
      { from: '2026-07-29', to: '2026-07-30' },
      'all'
    ),
    { code: 'TONGJI_SOURCE_RESPONSE_INVALID', status: 502 }
  );
});

test('Tongji snapshot rejects a negative derived visits remainder with the partition code', () => {
  const invalid = trafficSnapshot();
  invalid.sourceSummaries = invalid.sourceSummaries.map((row) => (
    row.source === 'searchOther' ? { ...row, visits: '2' } : row
  ));
  assert.throws(
    () => buildSnapshotPayload(
      invalid,
      { from: '2026-07-29', to: '2026-07-30' },
      'all'
    ),
    { code: 'TONGJI_SOURCE_PARTITION_INVALID', status: 502 }
  );
});

async function createService(t, options = {}) {
  const database = await createMarketingTestDatabase('tongji-service-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize, {
    accountId: '1234',
    projectId: 11
  });
  return {
    database,
    service: new BaiduTongjiService({
      sequelize: database.sequelize,
      allowedProjectIds: '11',
      clock: options.clock || (() => Date.parse('2026-07-30T04:00:00.000Z')),
      cacheTtlMs: options.cacheTtlMs || 600_000,
      cacheMaxStaleMs: options.cacheMaxStaleMs,
      capabilities: options.capabilities,
      logger: options.logger,
      provider: options.provider || {
        async readTrafficSnapshot() {
          return trafficSnapshot();
        }
      }
    })
  };
}

async function readFixedSnapshot(service, projectId, device = 'pc') {
  return service.readSnapshot(projectId, device);
}

async function readFixedSources(
  service,
  projectId,
  device = 'pc',
  sourceKey = null
) {
  const snapshot = await service.readSnapshot(projectId, device, {
    requireSources: service.capabilities.sourceTraffic
  });
  const selectedTrend = sourceKey
    ? await service.readSourceTrend(projectId, snapshot, sourceKey)
    : null;
  return { ...snapshot, selectedTrend };
}

test('Tongji service persists one ten-minute snapshot shared by trend and source reads', async (t) => {
  let now = Date.parse('2026-07-30T04:00:00.000Z');
  let calls = 0;
  const { database, service } = await createService(t, {
    clock: () => now,
    provider: {
      async readTrafficSnapshot({ coverage, device }) {
        calls += 1;
        assert.deepEqual(coverage, {
          from: '2026-07-01',
          to: '2026-07-30',
          days: 30
        });
        assert.equal(device, 'pc');
        return trafficSnapshot();
      }
    }
  });

  const trend = await readFixedSnapshot(service, '11', 'pc');
  const sources = await readFixedSources(service, '11', 'pc');

  assert.equal(calls, 1);
  assert.equal(trend.cache.state, 'REFRESHED');
  assert.equal(sources.cache.state, 'HIT');
  assert.equal(sources.device, 'pc');
  assert.deepEqual(
    sources.sources.map((source) => ({
      key: source.sourceKey,
      label: source.sourceLabel,
      host: source.sourceHost,
      visits: source.summary.visits
    })),
    [
      { key: 'BAIDU_PAID', label: '百度推广', host: 'e.baidu.com', visits: '1' },
      { key: 'DIRECT', label: '直接访问', host: 'active.example.test', visits: '3' },
      { key: 'BAIDU_SEARCH', label: '百度搜索', host: 'baidu.com', visits: '4' },
      { key: 'BING_SEARCH', label: '必应搜索', host: 'bing.com', visits: '2' },
      { key: 'GOOGLE_SEARCH', label: 'Google 搜索', host: 'google.com', visits: '1' },
      { key: 'OTHER_SEARCH', label: '其他搜索', host: '多个搜索引擎', visits: '0' },
      { key: 'EXTERNAL_REFERRAL', label: '外部引荐', host: '多个网站', visits: '4' }
    ]
  );
  assert.deepEqual(sources.sources.at(-3).sourceDetails, ['Google']);
  assert.deepEqual(sources.sources.at(-1).sourceDetails, ['外部链接']);
  assert.equal(sources.sources.at(-2).summary.visitors, null);

  const cacheRows = await database.sequelize.query(
    'SELECT project_id, device, site_id, payload_json FROM baidu_tongji_snapshots',
    { type: QueryTypes.SELECT }
  );
  assert.equal(cacheRows[0].project_id, 11);
  assert.equal(cacheRows[0].device, 'pc');
  assert.equal(cacheRows[0].site_id, '301');
  const storedPayload = JSON.parse(cacheRows[0].payload_json);
  assert.equal(storedPayload.schemaVersion, 2);
  assert.deepEqual(
    storedPayload.sources.map((source) => source.sourceKey),
    ['BAIDU_SEARCH', 'DIRECT', 'BING_SEARCH', 'OTHER']
  );
  assert.equal(storedPayload.sourcesV2.length, 7);

  now += 5 * 60 * 1000;
  await readFixedSnapshot(service, '11', 'pc');
  assert.equal(calls, 1);
});

test('Tongji cache write prunes rows older than the max-stale fallback window', async (t) => {
  const now = Date.parse('2026-07-30T04:00:00.000Z');
  const { database, service } = await createService(t, {
    clock: () => now,
    provider: {
      async readTrafficSnapshot() { return trafficSnapshot(); },
      async readSourceTrend({ sourceKey }) {
        return { site: trafficSnapshot().site, sourceKey, rows: rows(20, 3, 3) };
      }
    }
  });
  const old = new Date(now - 48 * 60 * 60 * 1000).toISOString();
  const seedSnapshot = {
    id: 'expired-snapshot',
    projectId: 11,
    device: 'mobile',
    siteId: '301',
    siteDomain: 'active.example.test',
    coverageStart: '2026-06-29',
    coverageEnd: '2026-06-30',
    payloadJson: '{}',
    refreshedAt: old,
    expiresAt: old,
    createdAt: old,
    updatedAt: old
  };
  const seedTrend = {
    ...seedSnapshot,
    id: 'expired-trend',
    sourceKey: 'DIRECT'
  };
  const withinFallback = new Date(now - 12 * 60 * 60 * 1000).toISOString();
  const retainedSnapshot = {
    ...seedSnapshot,
    id: 'fallback-snapshot',
    device: 'all',
    coverageStart: '2026-06-27',
    coverageEnd: '2026-06-28',
    refreshedAt: withinFallback,
    expiresAt: new Date(
      Date.parse(withinFallback) + 10 * 60 * 1000
    ).toISOString(),
    createdAt: withinFallback,
    updatedAt: withinFallback
  };
  const retainedTrend = {
    ...retainedSnapshot,
    id: 'fallback-trend',
    sourceKey: 'DIRECT'
  };
  const seedRange = { ...seedSnapshot, id: 'expired-range' };
  const retainedRange = { ...retainedSnapshot, id: 'fallback-range' };
  for (const snapshot of [seedSnapshot, retainedSnapshot]) {
    await database.sequelize.query(
      `INSERT INTO baidu_tongji_snapshots (
         id, project_id, device, site_id, site_domain,
         coverage_start, coverage_end, payload_json,
         refreshed_at, expires_at, created_at, updated_at
       ) VALUES (
         :id, :projectId, :device, :siteId, :siteDomain,
         :coverageStart, :coverageEnd, :payloadJson,
         :refreshedAt, :expiresAt, :createdAt, :updatedAt
       )`,
      { replacements: snapshot }
    );
  }
  for (const trend of [seedTrend, retainedTrend]) {
    await database.sequelize.query(
      `INSERT INTO baidu_tongji_source_trend_snapshots (
         id, project_id, device, source_key, site_id, site_domain,
         coverage_start, coverage_end, payload_json,
         refreshed_at, expires_at, created_at, updated_at
       ) VALUES (
         :id, :projectId, :device, :sourceKey, :siteId, :siteDomain,
         :coverageStart, :coverageEnd, :payloadJson,
         :refreshedAt, :expiresAt, :createdAt, :updatedAt
       )`,
      { replacements: trend }
    );
  }
  for (const range of [seedRange, retainedRange]) {
    await database.sequelize.query(
      `INSERT INTO baidu_tongji_range_snapshots (
         id, project_id, device, site_id, site_domain,
         coverage_start, coverage_end, payload_json,
         refreshed_at, expires_at, created_at, updated_at
       ) VALUES (
         :id, :projectId, :device, :siteId, :siteDomain,
         :coverageStart, :coverageEnd, :payloadJson,
         :refreshedAt, :expiresAt, :createdAt, :updatedAt
       )`,
      { replacements: range }
    );
  }

  await readFixedSnapshot(service, '11', 'pc');
  await readFixedSources(service, '11', 'pc', 'DIRECT');
  await service.saveSnapshotCache(
    '11',
    buildSnapshotPayload(
      trafficSnapshot(),
      { from: '2026-07-01', to: '2026-07-30' },
      'pc'
    ),
    'RANGE'
  );

  const snapshot = await database.sequelize.query(
    'SELECT COUNT(*) AS count FROM baidu_tongji_snapshots WHERE id = :id',
    { replacements: { id: 'expired-snapshot' }, type: QueryTypes.SELECT }
  );
  const trend = await database.sequelize.query(
    'SELECT COUNT(*) AS count FROM baidu_tongji_source_trend_snapshots WHERE id = :id',
    { replacements: { id: 'expired-trend' }, type: QueryTypes.SELECT }
  );
  const range = await database.sequelize.query(
    'SELECT COUNT(*) AS count FROM baidu_tongji_range_snapshots WHERE id = :id',
    { replacements: { id: 'expired-range' }, type: QueryTypes.SELECT }
  );
  const retained = await database.sequelize.query(
    `SELECT id FROM baidu_tongji_snapshots
     WHERE id = 'fallback-snapshot'
     UNION ALL
     SELECT id FROM baidu_tongji_source_trend_snapshots
     WHERE id = 'fallback-trend'
     UNION ALL
     SELECT id FROM baidu_tongji_range_snapshots
     WHERE id = 'fallback-range'
     ORDER BY id`,
    { type: QueryTypes.SELECT }
  );
  assert.equal(Number(snapshot[0].count), 0, '过期基础快照应被写时清理');
  assert.equal(Number(trend[0].count), 0, '过期来源趋势快照应被写时清理');
  assert.equal(Number(range[0].count), 0, '过期范围快照应被写时清理');
  assert.deepEqual(
    retained.map((row) => row.id),
    ['fallback-range', 'fallback-snapshot', 'fallback-trend'],
    '已过 TTL 但仍在 max-stale 窗口内的回退快照必须保留'
  );
});

test('Tongji source summaries do not prefetch trends and cache only the selected source', async (t) => {
  let trendCalls = 0;
  const { service } = await createService(t, {
    provider: {
      async readTrafficSnapshot() {
        return trafficSnapshot();
      },
      async readSourceTrend({ sourceKey }) {
        trendCalls += 1;
        assert.equal(sourceKey, 'DIRECT');
        return {
          site: trafficSnapshot().site,
          sourceKey,
          rows: rows(20, 3, 3)
        };
      }
    }
  });

  const summaries = await readFixedSources(service, '11', 'pc');
  assert.equal(trendCalls, 0);
  assert.ok(summaries.sources.every((source) => (
    !Object.hasOwn(source, 'trend')
  )));
  assert.equal(summaries.selectedTrend, null);

  const direct = await readFixedSources(service, '11', 'pc', 'DIRECT');
  assert.equal(trendCalls, 1);
  assert.equal(direct.selectedTrend.sourceKey, 'DIRECT');
  assert.equal(direct.selectedTrend.summary.visits, '3');

  const cached = await readFixedSources(service, '11', 'pc', 'DIRECT');
  assert.equal(trendCalls, 1);
  assert.deepEqual(cached.selectedTrend.trend, direct.selectedTrend.trend);
});

test('Tongji source trend rejects a refreshed visit total that disagrees with its source summary', async (t) => {
  const { database, service } = await createService(t, {
    provider: {
      async readTrafficSnapshot() {
        return trafficSnapshot();
      },
      async readSourceTrend({ sourceKey }) {
        assert.equal(sourceKey, 'DIRECT');
        return {
          site: trafficSnapshot().site,
          sourceKey,
          rows: rows(20, 4, 3)
        };
      }
    }
  });

  await assert.rejects(
    readFixedSources(service, '11', 'pc', 'DIRECT'),
    { code: 'TONGJI_SOURCE_TREND_MISMATCH', status: 502 }
  );

  const cachedRows = await database.sequelize.query(
    'SELECT COUNT(*) AS count FROM baidu_tongji_source_trend_snapshots',
    { type: QueryTypes.SELECT }
  );
  assert.equal(Number(cachedRows[0].count), 0);
});

test('Tongji source trend preserves a verified zero visit total', async (t) => {
  const zeroSnapshot = trafficSnapshot();
  zeroSnapshot.allTrend = rows(0, 0, 0);
  zeroSnapshot.sourceSummaries = zeroSnapshot.sourceSummaries.map((row) => ({
    ...row,
    pageviews: '0',
    visits: '0',
    visitors: '0'
  }));
  zeroSnapshot.engineSummaries = zeroSnapshot.engineSummaries.map((row) => ({
    ...row,
    pageviews: '0',
    visits: '0',
    visitors: '0'
  }));
  const { service } = await createService(t, {
    provider: {
      async readTrafficSnapshot() {
        return zeroSnapshot;
      },
      async readSourceTrend({ sourceKey }) {
        return {
          site: zeroSnapshot.site,
          sourceKey,
          rows: rows(0, 0, 0)
        };
      }
    }
  });

  const result = await readFixedSources(
    service,
    '11',
    'pc',
    'BAIDU_PAID'
  );
  assert.equal(result.selectedTrend.dataState, 'DATA');
  assert.equal(result.selectedTrend.summary.visits, '0');
});

test('Tongji source trend rejects a fresh cached visit total that disagrees with its source summary', async (t) => {
  let trendCalls = 0;
  const { database, service } = await createService(t, {
    provider: {
      async readTrafficSnapshot() {
        return trafficSnapshot();
      },
      async readSourceTrend({ sourceKey }) {
        trendCalls += 1;
        return {
          site: trafficSnapshot().site,
          sourceKey,
          rows: rows(20, 3, 3)
        };
      }
    }
  });

  const refreshed = await readFixedSources(
    service,
    '11',
    'pc',
    'DIRECT'
  );
  assert.equal(refreshed.selectedTrend.cache.state, 'REFRESHED');

  const cacheRows = await database.sequelize.query(
    'SELECT id, payload_json FROM baidu_tongji_source_trend_snapshots',
    { type: QueryTypes.SELECT }
  );
  const invalidPayload = JSON.parse(cacheRows[0].payload_json);
  invalidPayload.trend[0].visits = '4';
  await database.sequelize.query(
    `UPDATE baidu_tongji_source_trend_snapshots
     SET payload_json = :payloadJson
     WHERE id = :id`,
    {
      replacements: {
        id: cacheRows[0].id,
        payloadJson: JSON.stringify(invalidPayload)
      }
    }
  );

  await assert.rejects(
    readFixedSources(service, '11', 'pc', 'DIRECT'),
    { code: 'TONGJI_SOURCE_TREND_MISMATCH', status: 502 }
  );
  assert.equal(trendCalls, 1, 'fresh 缓存不能静默触发第二套来源 selector');
});

test('Tongji source trend rejects a stale fallback that disagrees with its source summary', async (t) => {
  let now = Date.parse('2026-07-30T04:00:00.000Z');
  let upstreamAvailable = true;
  const { database, service } = await createService(t, {
    clock: () => now,
    provider: {
      async readTrafficSnapshot() {
        return trafficSnapshot();
      },
      async readSourceTrend({ sourceKey }) {
        if (!upstreamAvailable) throw new Error('upstream unavailable');
        return {
          site: trafficSnapshot().site,
          sourceKey,
          rows: rows(20, 3, 3)
        };
      }
    }
  });

  await readFixedSources(service, '11', 'pc', 'DIRECT');
  const cacheRows = await database.sequelize.query(
    'SELECT id, payload_json FROM baidu_tongji_source_trend_snapshots',
    { type: QueryTypes.SELECT }
  );
  const invalidPayload = JSON.parse(cacheRows[0].payload_json);
  invalidPayload.trend[0].visits = '4';
  await database.sequelize.query(
    `UPDATE baidu_tongji_source_trend_snapshots
     SET payload_json = :payloadJson
     WHERE id = :id`,
    {
      replacements: {
        id: cacheRows[0].id,
        payloadJson: JSON.stringify(invalidPayload)
      }
    }
  );
  now += 11 * 60 * 1000;
  upstreamAvailable = false;

  await assert.rejects(
    readFixedSources(service, '11', 'pc', 'DIRECT'),
    { code: 'TONGJI_SOURCE_TREND_MISMATCH', status: 502 }
  );
});

test('Tongji cache refreshes after ten minutes and isolates PC from mobile', async (t) => {
  let now = Date.parse('2026-07-30T04:00:00.000Z');
  const devices = [];
  const { database, service } = await createService(t, {
    clock: () => now,
    provider: {
      async readTrafficSnapshot({ device }) {
        devices.push(device);
        return trafficSnapshot();
      }
    }
  });

  await readFixedSnapshot(service, '11', 'pc');
  now += 11 * 60 * 1000;
  await readFixedSnapshot(service, '11', 'pc');
  await readFixedSnapshot(service, '11', 'mobile');

  assert.deepEqual(devices, ['pc', 'pc', 'mobile']);
  const count = await database.sequelize.query(
    'SELECT COUNT(*) AS count FROM baidu_tongji_snapshots',
    { type: QueryTypes.SELECT }
  );
  assert.equal(Number(count[0].count), 2);
});

test('Tongji cache coalesces concurrent refreshes and falls back to the last database snapshot', async (t) => {
  let now = Date.parse('2026-07-30T04:00:00.000Z');
  let calls = 0;
  let fail = false;
  const { service } = await createService(t, {
    clock: () => now,
    provider: {
      async readTrafficSnapshot() {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (fail) {
          const error = new Error('upstream unavailable');
          error.code = 'BAIDU_TONGJI_FAILED';
          throw error;
        }
        return trafficSnapshot();
      }
    }
  });

  await Promise.all([
    readFixedSnapshot(service, '11', 'pc'),
    readFixedSources(service, '11', 'pc')
  ]);
  assert.equal(calls, 1);

  now += 11 * 60 * 1000;
  fail = true;
  const fallback = await readFixedSnapshot(service, '11', 'pc');
  assert.equal(calls, 2);
  assert.equal(fallback.cache.state, 'FALLBACK');
  assert.equal(fallback.summary.visits, '15');
});

test('Tongji deployment reads a stale four-source cache when the upstream is unavailable', async (t) => {
  let now = Date.parse('2026-07-30T04:00:00.000Z');
  let fail = false;
  const { database, service } = await createService(t, {
    clock: () => now,
    capabilities: { sourceTraffic: true },
    provider: {
      async readTrafficSnapshot() {
        if (fail) throw new Error('synthetic upstream failure');
        return { ...trafficSnapshot(), sourceReportsIncluded: true };
      }
    }
  });

  await readFixedSources(service, '11', 'pc');
  const rowsFromDatabase = await database.sequelize.query(
    `SELECT payload_json FROM baidu_tongji_snapshots
     WHERE project_id = 11 AND device = 'pc'`,
    { type: QueryTypes.SELECT }
  );
  const legacyPayload = JSON.parse(rowsFromDatabase[0].payload_json);
  delete legacyPayload.schemaVersion;
  delete legacyPayload.sourcesV2;
  await database.sequelize.query(
    `UPDATE baidu_tongji_snapshots
     SET payload_json = :payloadJson,
         expires_at = :expiresAt
     WHERE project_id = 11 AND device = 'pc'`,
    {
      replacements: {
        payloadJson: JSON.stringify(legacyPayload),
        expiresAt: new Date(now - 1).toISOString()
      }
    }
  );

  now += 11 * 60 * 1000;
  fail = true;
  const fallback = await readFixedSources(service, '11', 'pc');
  assert.equal(fallback.cache.state, 'FALLBACK');
  assert.equal(fallback.sources.length, 7);
  assert.equal(
    fallback.sources.find((source) => source.sourceKey === 'DIRECT').summary.visits,
    '3'
  );
  assert.equal(
    fallback.sources.find((source) => source.sourceKey === 'BAIDU_PAID').summary.visits,
    null
  );
});

test('Tongji rich requests never fall back to a stale basic-capability snapshot', async (t) => {
  let now = Date.parse('2026-07-30T04:00:00.000Z');
  let fail = false;
  const { service } = await createService(t, {
    clock: () => now,
    provider: {
      async readTrafficSnapshot() {
        if (fail) throw new Error('synthetic upstream failure');
        return {
          ...trafficSnapshot(),
          quality: null,
          sourceReportsIncluded: false
        };
      }
    }
  });
  const coverage = { from: '2026-07-29', to: '2026-07-30' };
  await service.readSnapshotForCoverage('11', 'pc', coverage);
  now += 11 * 60 * 1000;
  fail = true;
  await assert.rejects(
    service.readSnapshotForCoverage('11', 'pc', coverage, {
      requireQuality: true,
      requireSources: true
    }),
    /synthetic upstream failure/u
  );
});

test('Tongji refresh coalescing never lets a basic request satisfy a richer capability request', async (t) => {
  const calls = [];
  const { service } = await createService(t, {
    provider: {
      async readTrafficSnapshot({ includeQuality, includeSources }) {
        calls.push({ includeQuality, includeSources });
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          ...trafficSnapshot(),
          sourceReportsIncluded: includeSources,
          quality: includeQuality ? {
            summary: {
              bounceRate: '10',
              averageVisitTimeSeconds: '60',
              averageVisitPages: '2'
            },
            rows: [
              {
                date: '2026-07-29',
                bounceRate: '10',
                averageVisitTimeSeconds: '60',
                averageVisitPages: '2'
              },
              {
                date: '2026-07-30',
                bounceRate: null,
                averageVisitTimeSeconds: null,
                averageVisitPages: null
              }
            ]
          } : null
        };
      }
    }
  });
  const coverage = { from: '2026-07-29', to: '2026-07-30' };

  const [basic, rich] = await Promise.all([
    service.readSnapshotForCoverage('11', 'pc', coverage),
    service.readSnapshotForCoverage('11', 'pc', coverage, {
      requireQuality: true,
      requireSources: true
    })
  ]);

  assert.equal(basic.quality, null);
  assert.equal(rich.sourceReportsIncluded, true);
  assert.notEqual(rich.quality, null);
  assert.deepEqual(calls, [
    { includeQuality: false, includeSources: false },
    { includeQuality: true, includeSources: true }
  ]);
});

test('Tongji service rejects an invalid device and a binding without an explicit site', async (t) => {
  const { service } = await createService(t);
  await assert.rejects(
    readFixedSnapshot(service, '11', 'tablet'),
    { code: 'TONGJI_DEVICE_INVALID', status: 400 }
  );

  const database = await createMarketingTestDatabase('tongji-site-missing-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize, {
    accountId: '1234',
    projectId: 11,
    tongjiSiteId: null,
    tongjiSiteDomain: null
  });
  const missingSite = new BaiduTongjiService({
    sequelize: database.sequelize,
    allowedProjectIds: '11',
    provider: {
      async readTrafficSnapshot() {
        assert.fail('缺少站点绑定时不得调用百度统计');
      }
    }
  });
  await assert.rejects(
    readFixedSnapshot(missingSite, '11', 'pc'),
    { code: 'TONGJI_SITE_BINDING_MISSING', status: 409 }
  );
});

test('Tongji service deduplicates same-site account bindings and rejects different sites', async (t) => {
  const database = await createMarketingTestDatabase('tongji-multi-account-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize, {
    bindingId: 'binding-1',
    connectionId: 'connection-1',
    accountId: 'account-1',
    projectId: 11
  });
  await seedConnectionAndBinding(database.sequelize, {
    bindingId: 'binding-2',
    connectionId: 'connection-2',
    accountId: 'account-2',
    projectId: 11
  });
  let calls = 0;
  const service = new BaiduTongjiService({
    sequelize: database.sequelize,
    allowedProjectIds: '11',
    clock: () => Date.parse('2026-07-30T04:00:00.000Z'),
    provider: {
      async readTrafficSnapshot() {
        calls += 1;
        return trafficSnapshot();
      }
    }
  });
  await readFixedSnapshot(service, '11', 'pc');
  assert.equal(calls, 1);

  await database.sequelize.query(
    "UPDATE baidu_project_bindings SET tongji_site_id = '302' WHERE id = 'binding-2'"
  );
  await assert.rejects(
    readFixedSnapshot(service, '11', 'pc'),
    { code: 'TONGJI_BINDING_AMBIGUOUS', status: 409 }
  );
});

function rangeRows(coverage, values) {
  const rows = [];
  for (
    let cursor = Date.parse(`${coverage.from}T00:00:00.000Z`), index = 0;
    cursor <= Date.parse(`${coverage.to}T00:00:00.000Z`);
    cursor += 86_400_000, index += 1
  ) {
    rows.push({
      date: new Date(cursor).toISOString().slice(0, 10),
      pageviews: String(values.pageviews[index] || 0),
      visits: String(values.visits[index] || 0),
      visitors: values.visitors == null
        ? null
        : String(values.visitors[index] || 0)
    });
  }
  return rows;
}

function rangeSnapshot(coverage) {
  const current = coverage.from === '2026-07-29';
  const scale = current ? 10 : 8;
  return {
    site: trafficSnapshot().site,
    allTrend: rangeRows(coverage, {
      pageviews: [scale * 7, scale * 8],
      visits: [scale * 5, scale * 5],
      visitors: [scale * 4, scale * 4]
    }),
    sourceSummaries: [
      { name: '百度自然搜索', source: 'searchBaiduNature', pageviews: String(scale * 6), visits: String(scale * 4), visitors: String(scale * 3) },
      { name: '直接访问', source: 'through', pageviews: String(scale * 5), visits: String(scale * 3), visitors: String(scale * 2) },
      { name: '其他搜索', source: 'searchOther', pageviews: String(scale * 4), visits: String(scale * 2), visitors: String(scale * 2) },
      { name: '外部链接', source: 'link', pageviews: String(scale * 2), visits: String(scale), visitors: String(scale) }
    ],
    engineSummaries: [
      { name: '必应', source: 'search,14', engineId: '14', pageviews: String(scale * 3), visits: String(scale * 2), visitors: String(scale) }
    ],
    quality: {
      summary: {
        bounceRate: current ? '42.6' : '45.1',
        averageVisitTimeSeconds: current ? '98' : '80',
        averageVisitPages: current ? '2.5' : '2.25'
      },
      rows: [
        {
          date: coverage.from,
          bounceRate: current ? '40' : '44',
          averageVisitTimeSeconds: current ? '100' : '82',
          averageVisitPages: current ? '2.6' : '2.3'
        },
        {
          date: coverage.to,
          bounceRate: current ? '45.2' : '46.2',
          averageVisitTimeSeconds: current ? '96' : '78',
          averageVisitPages: current ? '2.4' : '2.2'
        }
      ]
    }
  };
}

test('website source comparison only accepts all-source visits requests', async (t) => {
  const { service } = await createService(t);

  await assert.rejects(
    service.readProjectWebsiteTraffic('11', {
      device: 'all',
      from: '2026-07-29',
      to: '2026-07-30',
      source: 'DIRECT',
      metric: 'visits',
      includeSourceComparison: true
    }),
    {
      code: 'TONGJI_SOURCE_COMPARISON_QUERY_INVALID',
      status: 400
    }
  );
  await assert.rejects(
    service.readProjectWebsiteTraffic('11', {
      device: 'all',
      from: '2026-07-29',
      to: '2026-07-30',
      source: 'ALL',
      metric: 'pageviews',
      includeSourceComparison: 'true'
    }),
    {
      code: 'TONGJI_SOURCE_COMPARISON_QUERY_INVALID',
      status: 400
    }
  );
});

test('website source comparison maps only invalid visits fields to the partition code', async (t) => {
  for (const invalidField of ['trendVisits', 'sourceVisits']) {
    const { service } = await createService(t, {
      capabilities: { sourceTraffic: true },
      provider: {
        async readTrafficSnapshot({ coverage }) {
          const snapshot = rangeSnapshot(coverage);
          if (invalidField === 'trendVisits') {
            snapshot.allTrend[0].visits = '-1';
          } else {
            snapshot.sourceSummaries[0].visits = '1.5';
          }
          return { ...snapshot, sourceReportsIncluded: true };
        }
      }
    });
    await assert.rejects(
      service.readProjectWebsiteTraffic('11', {
        device: 'all',
        from: '2026-07-29',
        to: '2026-07-30',
        source: 'ALL',
        metric: 'visits',
        includeSourceComparison: true
      }),
      { code: 'TONGJI_SOURCE_PARTITION_INVALID', status: 502 }
    );
  }

  const { service } = await createService(t, {
    capabilities: { sourceTraffic: true },
    provider: {
      async readTrafficSnapshot({ coverage }) {
        const snapshot = rangeSnapshot(coverage);
        snapshot.allTrend[0].pageviews = '-1';
        return { ...snapshot, sourceReportsIncluded: true };
      }
    }
  });
  await assert.rejects(
    service.readProjectWebsiteTraffic('11', {
      device: 'all',
      from: '2026-07-29',
      to: '2026-07-30',
      source: 'ALL',
      metric: 'visits',
      includeSourceComparison: true
    }),
    { code: 'TONGJI_RESPONSE_INVALID', status: 502 }
  );
});

test('website source comparison returns every canonical source in one response', async (t) => {
  const sourceValues = {
    BAIDU_PAID: { pageviews: [0, 0], visits: [0, 0], visitors: [0, 0] },
    DIRECT: { pageviews: [20, 30], visits: [10, 20], visitors: [10, 10] },
    BAIDU_SEARCH: { pageviews: [30, 30], visits: [20, 20], visitors: [15, 15] },
    BING_SEARCH: { pageviews: [15, 15], visits: [10, 10], visitors: [5, 5] },
    GOOGLE_SEARCH: { pageviews: [0, 0], visits: [0, 0], visitors: [0, 0] },
    OTHER_SEARCH: { pageviews: [0, 0], visits: [0, 0], visitors: [0, 0] },
    EXTERNAL_REFERRAL: { pageviews: [10, 10], visits: [5, 5], visitors: [5, 5] }
  };
  const sourceCalls = [];
  const { service } = await createService(t, {
    capabilities: { sourceTraffic: true },
    provider: {
      async readTrafficSnapshot({ coverage }) {
        const snapshot = rangeSnapshot(coverage);
        const sourcePageviewTotal = coverage.from === '2026-07-29'
          ? '170'
          : '136';
        return {
          ...snapshot,
          allTrend: snapshot.allTrend.map((row, index) => ({
            ...row,
            pageviews: index === 0 ? sourcePageviewTotal : '0'
          })),
          sourceSummaries: [
            ...snapshot.sourceSummaries,
            {
              name: '百度推广',
              source: 'searchBaiduPro',
              pageviews: '0',
              visits: '0',
              visitors: '0'
            }
          ],
          engineSummaries: [
            ...snapshot.engineSummaries,
            {
              name: 'Google',
              source: 'search,2',
              engineId: '2',
              pageviews: '0',
              visits: '0',
              visitors: '0'
            }
          ],
          sourceReportsIncluded: true
        };
      },
      async readSourceTrend({ coverage, sourceKey }) {
        sourceCalls.push({ coverage, sourceKey });
        return {
          site: trafficSnapshot().site,
          sourceKey,
          rows: rangeRows(coverage, sourceValues[sourceKey])
        };
      }
    }
  });

  const result = await service.readProjectWebsiteTraffic('11', {
    device: 'all',
    from: '2026-07-29',
    to: '2026-07-30',
    source: 'ALL',
    metric: 'visits',
    includeSourceComparison: true
  });

  assert.deepEqual(
    sourceCalls.map((call) => call.sourceKey).sort(),
    [
      'BAIDU_PAID',
      'BAIDU_SEARCH',
      'BING_SEARCH',
      'DIRECT',
      'EXTERNAL_REFERRAL',
      'GOOGLE_SEARCH',
      'OTHER_SEARCH'
    ]
  );
  assert.ok(sourceCalls.every((call) => (
    call.coverage.from === '2026-07-29'
    && call.coverage.to === '2026-07-30'
  )));
  assert.equal(result.sourceComparison.metric, 'visits');
  assert.equal(result.sourceComparison.state, 'COMPLETE');
  assert.deepEqual(result.sourceComparison.partition, {
    metric: 'visits',
    state: 'COMPLETE',
    totalVisits: '100',
    classifiedVisits: '100',
    unclassifiedVisits: '0',
    reasonCode: null
  });
  assert.deepEqual(
    result.sourceComparison.rows.map((row) => row.sourceKey),
    [
      'BAIDU_PAID',
      'DIRECT',
      'BAIDU_SEARCH',
      'BING_SEARCH',
      'GOOGLE_SEARCH',
      'OTHER_SEARCH',
      'EXTERNAL_REFERRAL'
    ]
  );
  assert.deepEqual(result.sourceComparison.rows[0], {
    sourceKey: 'BAIDU_PAID',
    sourceLabel: '百度推广',
    summaryState: 'DATA',
    trendState: 'DATA',
    summary: {
      current: '0',
      previous: '0',
      changePercent: null,
      trafficShare: '0.0'
    },
    trend: [
      { date: '2026-07-29', visits: '0' },
      { date: '2026-07-30', visits: '0' }
    ]
  });
  assert.deepEqual(result.sourceComparison.rows[1], {
    sourceKey: 'DIRECT',
    sourceLabel: '直接访问',
    summaryState: 'DATA',
    trendState: 'DATA',
    summary: {
      current: '30',
      previous: '24',
      changePercent: '25.0',
      trafficShare: '30.0'
    },
    trend: [
      { date: '2026-07-29', visits: '10' },
      { date: '2026-07-30', visits: '20' }
    ]
  });
});

test('website source partition stays partial when an all-site daily visit is missing', async (t) => {
  const { service } = await createService(t, {
    capabilities: { sourceTraffic: true },
    provider: {
      async readTrafficSnapshot({ coverage }) {
        const snapshot = rangeSnapshot(coverage);
        return {
          ...snapshot,
          allTrend: snapshot.allTrend.map((row, index) => ({
            ...row,
            visits: (
              (coverage.from === '2026-07-29' && index === 1)
              || (coverage.from !== '2026-07-29' && index === 0)
            )
              ? null
              : row.visits
          })),
          sourceReportsIncluded: true
        };
      },
      async readSourceTrend({ coverage, sourceKey }) {
        return {
          site: trafficSnapshot().site,
          sourceKey,
          rows: rangeRows(coverage, {
            pageviews: [0, 0],
            visits: [0, 0],
            visitors: [0, 0]
          })
        };
      }
    }
  });

  const result = await service.readProjectWebsiteTraffic('11', {
    device: 'all',
    from: '2026-07-29',
    to: '2026-07-30',
    source: 'ALL',
    metric: 'visits',
    includeSourceComparison: true
  });

  assert.deepEqual(result.sourceComparison.partition, {
    metric: 'visits',
    state: 'PARTIAL',
    totalVisits: null,
    classifiedVisits: '100',
    unclassifiedVisits: null,
    reasonCode: 'SOURCE_TOTAL_UNAVAILABLE'
  });
  assert.ok(result.sourceComparison.rows.every(
    (row) => row.summary.trafficShare === null
  ));
  assert.deepEqual(result.summary.visits, {
    current: null,
    previous: null,
    changePercent: null
  });
  assert.ok(result.sourceQuality.rows.every(
    (row) => row.trafficShare === null
  ));
});

test('website source comparison isolates one failed source and limits concurrency', async (t) => {
  const sourceValues = {
    DIRECT: { pageviews: [20, 30], visits: [10, 20], visitors: [10, 10] },
    BAIDU_SEARCH: { pageviews: [30, 30], visits: [20, 20], visitors: [15, 15] },
    BING_SEARCH: { pageviews: [15, 15], visits: [10, 10], visitors: [5, 5] },
    EXTERNAL_REFERRAL: { pageviews: [10, 10], visits: [5, 5], visitors: [5, 5] }
  };
  const warnings = [];
  let active = 0;
  let maxActive = 0;
  const { service } = await createService(t, {
    capabilities: { sourceTraffic: true },
    logger: { warn(event) { warnings.push(event); } },
    provider: {
      async readTrafficSnapshot({ coverage }) {
        return {
          ...rangeSnapshot(coverage),
          sourceReportsIncluded: true
        };
      },
      async readSourceTrend({ coverage, sourceKey }) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        if (sourceKey === 'DIRECT') {
          const error = new Error('sensitive upstream response');
          error.code = 'BAIDU_TONGJI_FAILED';
          throw error;
        }
        return {
          site: trafficSnapshot().site,
          sourceKey,
          rows: rangeRows(coverage, sourceValues[sourceKey])
        };
      }
    }
  });

  const result = await service.readProjectWebsiteTraffic('11', {
    device: 'all',
    from: '2026-07-29',
    to: '2026-07-30',
    source: 'ALL',
    metric: 'visits',
    includeSourceComparison: 'true'
  });

  assert.equal(maxActive, 3);
  assert.equal(result.sourceComparison.state, 'PARTIAL');
  assert.deepEqual(
    result.sourceComparison.rows.find((row) => row.sourceKey === 'DIRECT'),
    {
      sourceKey: 'DIRECT',
      sourceLabel: '直接访问',
      summaryState: 'DATA',
      trendState: 'UNAVAILABLE',
      summary: {
        current: '30',
        previous: '24',
        changePercent: '25.0',
        trafficShare: '30.0'
      },
      trend: []
    }
  );
  assert.equal(
    result.sourceComparison.rows.find(
      (row) => row.sourceKey === 'BAIDU_SEARCH'
    ).trendState,
    'DATA'
  );
  assert.deepEqual(warnings, [{
    event: 'tongji_source_comparison_partial',
    projectId: '11',
    sourceKey: 'DIRECT',
    errorCode: 'BAIDU_TONGJI_FAILED'
  }]);
  assert.equal(JSON.stringify(result).includes('sensitive upstream response'), false);
});

test('website traffic contract exposes verified all-site quality summary and trend', async (t) => {
  const { database, service } = await createService(t, {
    capabilities: { qualityMetrics: true },
    provider: {
      async readTrafficSnapshot({ coverage }) {
        return rangeSnapshot(coverage);
      }
    }
  });

  const result = await service.readProjectWebsiteTraffic('11', {
    device: 'all',
    from: '2026-07-29',
    to: '2026-07-30',
    source: 'ALL',
    metric: 'bounceRate'
  });

  assert.deepEqual(result.summary.bounceRate, {
    current: '42.6',
    previous: '45.1',
    changePoints: '-2.5'
  });
  assert.deepEqual(result.summary.averageVisitTime, {
    current: '98',
    previous: '80',
    changeSeconds: '18'
  });
  assert.deepEqual(result.summary.averageVisitPages, {
    current: '2.5',
    previous: '2.25',
    changePages: '0.25'
  });
  assert.deepEqual(result.trend, [
    {
      date: '2026-07-29',
      previousDate: '2026-07-27',
      current: '40',
      previous: '44'
    },
    {
      date: '2026-07-30',
      previousDate: '2026-07-28',
      current: '45.2',
      previous: '46.2'
    }
  ]);
  assert.equal(result.selectedMetricState, 'DATA');
  assert.equal(result.sourceQuality.allSiteBounceRate, '42.6');
  assert.equal(result.capabilities.qualityMetrics, true);
  const rangeRows = await database.sequelize.query(
    'SELECT coverage_start, coverage_end FROM baidu_tongji_range_snapshots ORDER BY coverage_start',
    { type: QueryTypes.SELECT }
  );
  const fixedRows = await database.sequelize.query(
    'SELECT COUNT(*) AS count FROM baidu_tongji_snapshots',
    { type: QueryTypes.SELECT }
  );
  assert.equal(rangeRows.length, 2);
  assert.equal(Number(fixedRows[0].count), 0);
});

test('website traffic contract compares equal periods, preserves all-device and sorts source share', async (t) => {
  const calls = [];
  const { service } = await createService(t, {
    provider: {
      async readTrafficSnapshot({ coverage, device }) {
        calls.push({ coverage, device });
        return rangeSnapshot(coverage);
      },
      async readSourceTrend({ coverage, sourceKey, device }) {
        assert.equal(sourceKey, 'DIRECT');
        assert.equal(device, 'all');
        const scale = coverage.from === '2026-07-29' ? 10 : 8;
        return {
          site: trafficSnapshot().site,
          sourceKey,
          rows: rangeRows(coverage, {
            pageviews: [scale * 2, scale * 3],
            visits: [scale, scale * 2],
            visitors: [scale, scale]
          })
        };
      }
    }
  });

  const result = await service.readProjectWebsiteTraffic('11', {
    device: 'all',
    from: '2026-07-29',
    to: '2026-07-30',
    source: 'DIRECT',
    metric: 'visits'
  });

  assert.deepEqual(calls, [
    { coverage: { from: '2026-07-29', to: '2026-07-30', days: 2 }, device: 'all' },
    { coverage: { from: '2026-07-27', to: '2026-07-28', days: 2 }, device: 'all' }
  ]);
  assert.equal(result.device, 'all');
  assert.deepEqual(result.previousCoverage, {
    from: '2026-07-27',
    to: '2026-07-28'
  });
  assert.equal(result.summary.visits.current, '100');
  assert.equal(result.summary.visits.previous, '80');
  assert.equal(result.summary.visits.changePercent, '25.0');
  assert.deepEqual(
    result.sourceQuality.rows.map((row) => [
      row.sourceLabel,
      row.visits,
      row.trafficShare
    ]),
    [
      ['百度搜索', '40', '40.0'],
      ['直接访问', '30', '30.0'],
      ['必应搜索', '20', '20.0'],
      ['外部引荐', '10', '10.0'],
      ['百度推广', null, null],
      ['Google 搜索', null, null],
      ['其他搜索', null, null]
    ]
  );
  assert.equal(result.sourceQuality.rows.at(-1).averageVisitTime, null);
  assert.equal(result.capabilities.qualityMetrics, false);
  assert.equal(result.capabilities.sourcePageCorrelation, false);
  assert.deepEqual(result.trend.map((row) => row.current), ['10', '20']);
});

test('website page contract validates pagination and reports unverified data as unavailable', async (t) => {
  const { service } = await createService(t);
  const result = await service.readProjectWebsitePages('11', {
    device: 'mobile',
    from: '2026-07-01',
    to: '2026-07-30',
    view: 'visited',
    page: '3',
    pageSize: '20',
    sortBy: 'exitRate',
    sortOrder: 'ascend',
    query: '/product'
  });
  assert.equal(result.dataState, 'UNAVAILABLE');
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.pagination, {
    page: 3,
    pageSize: 20,
    totalItems: null,
    totalPages: null
  });
  assert.equal(result.scope.source, 'ALL');

  await assert.rejects(
    service.readProjectWebsitePages('11', {
      device: 'pc',
      from: '2026-07-01',
      to: '2026-07-30',
      view: 'landing',
      page: 1,
      pageSize: 101,
      sortBy: 'visits',
      sortOrder: 'descend'
    }),
    { code: 'TONGJI_PAGE_QUERY_INVALID', status: 400 }
  );
  await assert.rejects(
    service.readProjectWebsitePages('11', {
      device: 'pc',
      from: '2026-07-01',
      to: '2026-07-30',
      page: '1e2'
    }),
    { code: 'TONGJI_PAGE_QUERY_INVALID', status: 400 }
  );
});

test('website page contract filters, sorts and paginates verified Baidu page rows', async (t) => {
  const calls = [];
  const { service } = await createService(t, {
    capabilities: { qualityMetrics: false, pageReports: true },
    provider: {
      async readPageReport(input) {
        calls.push(input);
        return {
          view: 'landing',
          total: 4,
          rows: [
            {
              pageId: '202',
              pageUrl: 'https://active.example.test/product-b',
              visits: '8',
              contributionPageviews: '20',
              bounceRate: '50',
              averageVisitTimeSeconds: '20',
              averageVisitPages: '2'
            },
            {
              pageId: '200',
              pageUrl: 'https://active.example.test/',
              visits: '30',
              contributionPageviews: '60',
              bounceRate: '40',
              averageVisitTimeSeconds: '60',
              averageVisitPages: '3'
            },
            {
              pageId: '201',
              pageUrl: 'https://active.example.test/product-a',
              visits: '12',
              contributionPageviews: '24',
              bounceRate: '45',
              averageVisitTimeSeconds: '40',
              averageVisitPages: '2.5'
            },
            {
              pageId: '999',
              pageUrl: 'http://127.0.0.1:3000/internal-preview',
              visits: '100',
              contributionPageviews: '100',
              bounceRate: '1',
              averageVisitTimeSeconds: '1000',
              averageVisitPages: '10'
            }
          ]
        };
      }
    }
  });

  const result = await service.readProjectWebsitePages('11', {
    device: 'mobile',
    from: '2026-07-01',
    to: '2026-07-30',
    view: 'landing',
    page: 1,
    pageSize: 1,
    sortBy: 'visits',
    sortOrder: 'descend',
    query: '/product'
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].connection.tongji_site_id, '301');
  assert.equal(calls[0].device, 'mobile');
  assert.equal(result.dataState, 'DATA');
  assert.deepEqual(result.rows.map((row) => row.title), [null]);
  assert.deepEqual(result.rows.map((row) => row.pageId), ['201']);
  assert.deepEqual(result.rows.map((row) => row.path), ['/product-a']);
  assert.deepEqual(result.pagination, {
    page: 1,
    pageSize: 1,
    totalItems: 2,
    totalPages: 2
  });
  assert.deepEqual(result.dataQuality, {
    excludedCrossDomainRows: 1
  });
  assert.equal(result.capabilities.pageReports, true);

  const secondPage = await service.readProjectWebsitePages('11', {
    device: 'mobile',
    from: '2026-07-01',
    to: '2026-07-30',
    view: 'landing',
    page: 2,
    pageSize: 1,
    sortBy: 'visits',
    sortOrder: 'descend',
    query: '/product'
  });
  assert.equal(calls.length, 1, '同一报告的内部分页必须复用一次受控刷新');
  assert.deepEqual(secondPage.rows.map((row) => row.pageId), ['202']);
});

test('website page collisions are assigned before pagination with stable page identity ordering', async (t) => {
  const { service } = await createService(t, {
    capabilities: { qualityMetrics: false, pageReports: true },
    provider: {
      async readPageReport() {
        return {
          view: 'landing',
          total: 7,
          rows: [
            {
              pageId: '10', pageUrl: 'https://active.example.test/same',
              visits: '8', contributionPageviews: '11', bounceRate: '40',
              averageVisitTimeSeconds: '20', averageVisitPages: '2'
            },
            {
              pageId: '2', pageUrl: 'https://active.example.test/same',
              visits: '8', contributionPageviews: '12', bounceRate: '50',
              averageVisitTimeSeconds: '21', averageVisitPages: '3'
            },
            {
              pageId: 'opaque-b', pageUrl: 'https://active.example.test/same',
              visits: '8', contributionPageviews: '13', bounceRate: '60',
              averageVisitTimeSeconds: '22', averageVisitPages: '4'
            },
            {
              pageId: 'opaque-a', pageUrl: 'https://active.example.test/same',
              visits: '8', contributionPageviews: '14', bounceRate: '70',
              averageVisitTimeSeconds: '23', averageVisitPages: '5'
            },
            {
              pageId: '\uE000', pageUrl: 'https://active.example.test/same',
              visits: '8', contributionPageviews: '15', bounceRate: '71',
              averageVisitTimeSeconds: '24', averageVisitPages: '6'
            },
            {
              pageId: '😀', pageUrl: 'https://active.example.test/same',
              visits: '8', contributionPageviews: '16', bounceRate: '72',
              averageVisitTimeSeconds: '25', averageVisitPages: '7'
            },
            {
              pageId: '20', pageUrl: 'https://active.example.test/unique',
              visits: '7', contributionPageviews: '10', bounceRate: '30',
              averageVisitTimeSeconds: '19', averageVisitPages: '1'
            }
          ]
        };
      }
    }
  });
  const input = {
    device: 'all', from: '2026-07-01', to: '2026-07-30', view: 'landing',
    pageSize: 2, sortBy: 'visits', sortOrder: 'descend', query: ''
  };
  const first = await service.readProjectWebsitePages('11', { ...input, page: 1 });
  const second = await service.readProjectWebsitePages('11', { ...input, page: 2 });
  const third = await service.readProjectWebsitePages('11', { ...input, page: 3 });
  const fourth = await service.readProjectWebsitePages('11', { ...input, page: 4 });
  const rows = [...first.rows, ...second.rows, ...third.rows, ...fourth.rows];
  assert.deepEqual(rows.map((row) => row.pageId), [
    '2', '10', 'opaque-a', 'opaque-b', '\uE000', '😀', '20'
  ]);
  assert.deepEqual(rows.map((row) => row.pathCollision), [
    { ordinal: 1, count: 6 },
    { ordinal: 2, count: 6 },
    { ordinal: 3, count: 6 },
    { ordinal: 4, count: 6 },
    { ordinal: 5, count: 6 },
    { ordinal: 6, count: 6 },
    null
  ]);
  const resized = await service.readProjectWebsitePages('11', {
    ...input, page: 1, pageSize: 4
  });
  assert.deepEqual(
    resized.rows.map((row) => [row.pageId, row.pathCollision]),
    rows.slice(0, 4).map((row) => [row.pageId, row.pathCollision])
  );
});

test('website page report survives a process restart and falls back to the persisted snapshot', async (t) => {
  let now = Date.parse('2026-07-30T04:00:00.000Z');
  const first = await createService(t, {
    clock: () => now,
    capabilities: { pageReports: true },
    provider: {
      async readPageReport() {
        return {
          view: 'landing',
          total: 1,
          rows: [{
            pageId: '200',
            pageUrl: 'https://active.example.test/product-a',
            visits: '12',
            contributionPageviews: '24',
            bounceRate: '45',
            averageVisitTimeSeconds: '40',
            averageVisitPages: '2.5'
          }]
        };
      }
    }
  });
  const input = {
    device: 'pc',
    from: '2026-07-01',
    to: '2026-07-30',
    view: 'landing'
  };
  const refreshed = await first.service.readProjectWebsitePages('11', input);
  assert.equal(refreshed.cache.state, 'REFRESHED');

  now += 11 * 60 * 1000;
  const restarted = new BaiduTongjiService({
    sequelize: first.database.sequelize,
    allowedProjectIds: '11',
    clock: () => now,
    cacheTtlMs: 600_000,
    cacheMaxStaleMs: 86_400_000,
    capabilities: { pageReports: true },
    provider: {
      async readPageReport() { throw new Error('upstream unavailable'); }
    }
  });
  const fallback = await restarted.readProjectWebsitePages('11', input);
  assert.equal(fallback.cache.state, 'FALLBACK');
  assert.deepEqual(fallback.rows.map((row) => row.pageId), ['200']);
});
