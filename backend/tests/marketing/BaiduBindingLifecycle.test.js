const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BaiduAuthorizationService
} = require('../../modules/marketing/services/BaiduAuthorizationService');
const {
  createMarketingTestDatabase,
  seedConnectionAndBinding
} = require('./helpers/createMarketingTestDatabase');

test('disconnect clears credentials and pauses related bindings', async (t) => {
  const database = await createMarketingTestDatabase();
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  const service = new BaiduAuthorizationService({
    sequelize: database.sequelize,
    provider: {},
    encryptionKey: Buffer.alloc(32, 5).toString('base64')
  });
  await service.disconnect({ connectionId: 'connection-1' });

  const [bindings] = await database.sequelize.query(
    `SELECT status, paused_reason, binding_version
     FROM baidu_project_bindings`
  );
  assert.deepEqual(bindings[0], {
    status: 'PAUSED',
    paused_reason: 'DISCONNECTED',
    binding_version: 1
  });
});
