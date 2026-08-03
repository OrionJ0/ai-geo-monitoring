const assert = require('node:assert/strict');
const test = require('node:test');

const {
  WebsiteFormProjectAccessService
} = require('../../modules/websiteFormConsultations/services/WebsiteFormProjectAccessService');

function createService(project) {
  const queries = [];
  return {
    queries,
    service: new WebsiteFormProjectAccessService({
      configuredProjectId: '11',
      sequelize: {
        async query(sql, options) {
          queries.push({ sql, options });
          return project ? [project] : [];
        }
      }
    })
  };
}

test('website-form access is limited to the configured active project owner or admin', async () => {
  const { service, queries } = createService({
    id: 11,
    user_id: 7,
    status: 'active'
  });

  await service.assertAccess({
    projectId: '11',
    user: { id: 7, role: 'user' }
  });
  await service.assertAccess({
    projectId: '11',
    user: { id: 99, role: 'admin' }
  });

  assert.equal(queries.length, 2);
  assert.deepEqual(queries[0].options.replacements, { projectId: '11' });

  await assert.rejects(
    service.assertAccess({
      projectId: '12',
      user: { id: 7, role: 'user' }
    }),
    { code: 'WEBSITE_FORM_PROJECT_NOT_CONFIGURED', status: 404 }
  );

  await assert.rejects(
    service.assertAccess({
      projectId: '11',
      user: { id: 8, role: 'user' }
    }),
    { code: 'PROJECT_FORBIDDEN', status: 403 }
  );
});

test('website-form access rejects missing and archived projects', async () => {
  await assert.rejects(
    createService(null).service.assertAccess({
      projectId: '11',
      user: { id: 7, role: 'admin' }
    }),
    { code: 'PROJECT_NOT_FOUND', status: 404 }
  );

  await assert.rejects(
    createService({ id: 11, user_id: 7, status: 'archived' })
      .service.assertAccess({
        projectId: '11',
        user: { id: 7, role: 'admin' }
      }),
    { code: 'PROJECT_ARCHIVED', status: 409 }
  );
});
