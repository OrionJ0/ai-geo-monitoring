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
