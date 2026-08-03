const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ConsultationProjectAccessService
} = require('../../modules/consultationRecords/services/ConsultationProjectAccessService');

function serviceFor(project) {
  return new ConsultationProjectAccessService({
    sequelize: {
      async query(sql, options) {
        if (!project) return [];
        if (
          sql.includes('user_id = :userId')
          && String(project.user_id) !== String(options.replacements.userId)
        ) return [];
        return [project];
      }
    }
  });
}

test('allows project owners and administrators', async () => {
  const service = serviceFor({ id: 11, user_id: 7, status: 'active' });
  await assert.doesNotReject(service.assertAccess({
    projectId: '11',
    user: { id: 7, role: 'user' }
  }));
  await assert.doesNotReject(service.assertAccess({
    projectId: '11',
    user: { id: 99, role: 'admin' }
  }));
});

test('denies cross-project access without exposing record state', async () => {
  const service = serviceFor({ id: 11, user_id: 7, status: 'active' });
  await assert.rejects(
    service.assertAccess({
      projectId: '11',
      user: { id: 8, role: 'user' }
    }),
    (error) => error.code === 'PROJECT_NOT_FOUND' && error.status === 404
  );
  await assert.rejects(
    serviceFor(null).assertAccess({
      projectId: '12',
      user: { id: 7, role: 'user' }
    }),
    (error) => error.code === 'PROJECT_NOT_FOUND' && error.status === 404
  );
});

test('does not reveal another tenant archived state', async () => {
  const service = serviceFor({ id: 11, user_id: 7, status: 'archived' });
  await assert.rejects(
    service.assertAccess({
      projectId: '11',
      user: { id: 8, role: 'user' }
    }),
    (error) => error.code === 'PROJECT_NOT_FOUND' && error.status === 404
  );
});
