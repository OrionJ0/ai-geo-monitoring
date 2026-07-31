const test = require('node:test');
const assert = require('node:assert/strict');

const ProjectArchiveService = require('../services/ProjectArchiveService');

test('archives a project by disabling monitoring, prompt schedules and generated reports', async () => {
  const projectUpdates = [];
  const scheduleUpdates = [];
  const reportDeletes = [];
  const project = {
    id: 7,
    status: 'active',
    monitoring_enabled: true,
    monitoring_next_run_at: new Date(),
    update: async (payload) => projectUpdates.push(payload)
  };

  const result = await ProjectArchiveService.archiveProject(project, {
    Setting: {
      findOne: async () => null
    },
    DetectionSchedule: {
      update: async (payload, query) => scheduleUpdates.push({ payload, query })
    },
    ReportSnapshot: {
      destroy: async (query) => reportDeletes.push(query)
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(projectUpdates, [{
    status: 'archived',
    monitoring_enabled: false,
    monitoring_next_run_at: null
  }]);
  assert.deepEqual(scheduleUpdates, [{
    payload: { enabled: false },
    query: { where: { project_id: 7, enabled: true } }
  }]);
  assert.deepEqual(reportDeletes, [{
    where: { project_id: 7, status: 'generated' }
  }]);
});

test('refuses to archive the configured default project without mutating it', async () => {
  let projectUpdated = false;
  let scheduleUpdated = false;
  const project = {
    id: 7,
    status: 'active',
    update: async () => {
      projectUpdated = true;
    }
  };

  const result = await ProjectArchiveService.archiveProject(project, {
    Setting: {
      findOne: async () => ({ value: '7' })
    },
    DetectionSchedule: {
      update: async () => {
        scheduleUpdated = true;
      }
    },
    ReportSnapshot: {
      destroy: async () => {
        throw new Error('default project reports must remain untouched');
      }
    }
  });

  assert.deepEqual(result, {
    ok: false,
    status: 409,
    code: 'default_project_lifecycle_protected',
    message: '默认品牌不能归档或删除'
  });
  assert.equal(projectUpdated, false);
  assert.equal(scheduleUpdated, false);
});
