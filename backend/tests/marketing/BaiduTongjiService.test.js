const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BaiduTongjiService
} = require('../../modules/marketing/services/BaiduTongjiService');
const {
  createMarketingTestDatabase,
  seedConnectionAndBinding
} = require('./helpers/createMarketingTestDatabase');

test('Tongji service selects the project connection and returns exact live pilot totals', async (t) => {
  const database = await createMarketingTestDatabase('tongji-service-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize, {
    accountId: '1234',
    projectId: 11
  });
  const service = new BaiduTongjiService({
    sequelize: database.sequelize,
    allowedProjectIds: '11',
    clock: () => Date.parse('2026-07-30T04:00:00.000Z'),
    provider: {
      async readTrend({ coverage }) {
        assert.deepEqual(coverage, {
          from: '2026-07-01',
          to: '2026-07-30'
        });
        return {
          site: {
            siteId: '301',
            domain: 'active.example.test',
            status: 'ACTIVE'
          },
          rows: [
            {
              date: '2026-07-28',
              pageviews: '123',
              visits: '45',
              visitors: '30'
            },
            {
              date: '2026-07-29',
              pageviews: null,
              visits: null,
              visitors: null
            },
            {
              date: '2026-07-30',
              pageviews: '1234',
              visits: '56',
              visitors: '40'
            }
          ]
        };
      }
    }
  });

  const result = await service.readProjectTrend('11');

  assert.equal(result.mode, 'LIVE_PILOT');
  assert.equal(result.dataState, 'DATA');
  assert.deepEqual(result.summary, {
    pageviews: '1357',
    visits: '101',
    visitors: '70'
  });
  assert.equal(result.trend[1].pageviews, null);
});

test('Tongji service preserves an all-missing provider window as NO_DATA', async (t) => {
  const database = await createMarketingTestDatabase('tongji-empty-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize, {
    accountId: '1234',
    projectId: 11
  });
  const service = new BaiduTongjiService({
    sequelize: database.sequelize,
    allowedProjectIds: '11',
    provider: {
      async readTrend() {
        return {
          site: {
            siteId: '301',
            domain: 'active.example.test',
            status: 'ACTIVE'
          },
          rows: [{
            date: '2026-07-30',
            pageviews: null,
            visits: null,
            visitors: null
          }]
        };
      }
    }
  });

  const result = await service.readProjectTrend('11');

  assert.equal(result.dataState, 'NO_DATA');
  assert.deepEqual(result.summary, {
    pageviews: null,
    visits: null,
    visitors: null
  });
});

test('Tongji service rejects an active account binding without an explicit site', async (t) => {
  const database = await createMarketingTestDatabase('tongji-site-missing-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize, {
    accountId: '1234',
    projectId: 11,
    tongjiSiteId: null,
    tongjiSiteDomain: null
  });
  const service = new BaiduTongjiService({
    sequelize: database.sequelize,
    allowedProjectIds: '11',
    provider: {
      async readTrend() {
        assert.fail('缺少站点绑定时不得调用百度统计');
      }
    }
  });

  await assert.rejects(
    service.readProjectTrend('11'),
    { code: 'TONGJI_SITE_BINDING_MISSING', status: 409 }
  );
});

test('Tongji service returns separate exact source trends without cross-system attribution', async (t) => {
  const database = await createMarketingTestDatabase('tongji-sources-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize, {
    accountId: '1234',
    projectId: 11
  });
  const service = new BaiduTongjiService({
    sequelize: database.sequelize,
    allowedProjectIds: '11',
    clock: () => Date.parse('2026-07-30T04:00:00.000Z'),
    provider: {
      async readSourceTrends({ coverage, sourceKeys }) {
        assert.deepEqual(coverage, {
          from: '2026-07-01',
          to: '2026-07-30'
        });
        assert.deepEqual(sourceKeys, ['DIRECT', 'SEARCH', 'EXTERNAL']);
        return {
          site: {
            siteId: '301',
            domain: 'active.example.test',
            status: 'ACTIVE'
          },
          sources: sourceKeys.map((sourceKey, index) => ({
            sourceKey,
            rows: [{
              date: '2026-07-30',
              pageviews: String((index + 1) * 10),
              visits: String(index + 1),
              visitors: String(index + 1)
            }]
          }))
        };
      }
    }
  });

  const result = await service.readProjectSourceTrends('11');

  assert.equal(result.source, 'BAIDU_TONGJI');
  assert.equal(result.attribution.level, 'WEBSITE_TRAFFIC_SOURCE');
  assert.equal(result.attribution.isCrossSystemVerified, false);
  assert.deepEqual(
    result.sources.map((source) => ({
      sourceKey: source.sourceKey,
      sourceLabel: source.sourceLabel,
      visits: source.summary.visits
    })),
    [
      { sourceKey: 'DIRECT', sourceLabel: '直接访问', visits: '1' },
      { sourceKey: 'SEARCH', sourceLabel: '搜索引擎', visits: '2' },
      { sourceKey: 'EXTERNAL', sourceLabel: '外部链接', visits: '3' }
    ]
  );
});
