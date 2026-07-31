const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ProjectAdministrationPolicyService = require('../services/ProjectAdministrationPolicyService');

test('only administrators may mutate brand configuration', () => {
  assert.deepEqual(
    ProjectAdministrationPolicyService.authorize({ role: 'admin' }),
    { ok: true }
  );
  assert.deepEqual(
    ProjectAdministrationPolicyService.authorize({ role: 'user' }),
    {
      ok: false,
      status: 403,
      code: 'admin_required',
      message: '仅管理员可以修改品牌配置'
    }
  );
});

test('brand and competitor mutation routes enforce the administration policy', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../routes/geoProjects.js'),
    'utf8'
  );

  assert.match(source, /function rejectNonAdminProjectMutation/);
  assert.match(source, /router\.post\('\/',[\s\S]*rejectNonAdminProjectMutation/);
  assert.match(source, /router\.put\('\/:id',[\s\S]*rejectNonAdminProjectMutation/);
  assert.match(source, /router\.delete\('\/:id',[\s\S]*rejectNonAdminProjectMutation/);
  assert.match(source, /router\.post\('\/:projectId\/competitors',[\s\S]*rejectNonAdminProjectMutation/);
  assert.match(source, /router\.put\('\/:projectId\/competitors\/:competitorId',[\s\S]*rejectNonAdminProjectMutation/);
  assert.match(source, /router\.delete\('\/:projectId\/competitors\/:competitorId',[\s\S]*rejectNonAdminProjectMutation/);
});
