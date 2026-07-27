const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Op } = require('sequelize');

const ProjectDeletionService = require('../services/ProjectDeletionService');
const { WebCaptureStore } = require('../services/WebCaptureStore');
const {
  WebCaptureDeletionService
} = require('../services/WebCaptureDeletionService');

test('permanently deletes archived project data before deleting the project row', async () => {
  const calls = [];
  const whereByModel = {};
  const project = { id: 7, status: 'archived' };
  const repositories = {
    WebCaptureDeletionService: {
      deleteRecords: async (recordIds, work) => {
        calls.push('evidence:quarantine');
        assert.deepEqual(recordIds, [21, 22]);
        const result = await work({ id: 'delete-transaction' });
        calls.push('evidence:commit');
        return result;
      }
    },
    QuestionRecord: {
      findAll: async ({ where }) => {
        calls.push('records:find');
        whereByModel.recordFind = where;
        return [{ id: 21 }, { id: 22 }];
      },
      destroy: async ({ where }) => {
        calls.push('records:destroy');
        whereByModel.recordDestroy = where;
        return 2;
      }
    },
    ResultDetail: {
      destroy: async ({ where }) => {
        calls.push('details:destroy');
        whereByModel.detailDestroy = where;
        return 2;
      }
    },
    VisibilityMetric: {
      destroy: async ({ where }) => {
        calls.push('metrics:destroy');
        whereByModel.metricDestroy = where;
        return 3;
      }
    },
    DetectionSchedule: {
      destroy: async ({ where }) => {
        calls.push('schedules:destroy');
        whereByModel.scheduleDestroy = where;
        return 1;
      }
    },
    ReportSnapshot: {
      destroy: async ({ where }) => {
        calls.push('reports:destroy');
        whereByModel.reportDestroy = where;
        return 4;
      }
    },
    QuestionSetRetryBatch: {
      destroy: async ({ where }) => {
        calls.push('question-set-retry-batches:destroy');
        whereByModel.questionSetRetryBatchDestroy = where;
        return 1;
      }
    },
    QuestionSetRun: {
      destroy: async ({ where }) => {
        calls.push('question-set-runs:destroy');
        whereByModel.questionSetRunDestroy = where;
        return 2;
      }
    },
    ScheduledExecution: {
      destroy: async ({ where }) => {
        calls.push('scheduled-executions:destroy');
        whereByModel.scheduledExecutionDestroy = where;
        return 2;
      }
    },
    AlertRule: {
      destroy: async ({ where }) => {
        calls.push('alerts:destroy');
        whereByModel.alertDestroy = where;
        return 1;
      }
    },
    TrackedPrompt: {
      destroy: async ({ where }) => {
        calls.push('prompts:destroy');
        whereByModel.promptDestroy = where;
        return 5;
      }
    },
    PromptGroup: {
      destroy: async ({ where }) => {
        calls.push('groups:destroy');
        whereByModel.groupDestroy = where;
        return 2;
      }
    },
    BrandCompetitor: {
      destroy: async ({ where }) => {
        calls.push('competitors:destroy');
        whereByModel.competitorDestroy = where;
        return 3;
      }
    },
    BrandProject: {
      destroy: async ({ where }) => {
        calls.push('project:destroy');
        whereByModel.projectDestroy = where;
        return 1;
      }
    }
  };

  const result = await ProjectDeletionService.deleteArchivedProject(project, repositories);

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    'records:find',
    'evidence:quarantine',
    'metrics:destroy',
    'details:destroy',
    'records:destroy',
    'schedules:destroy',
    'reports:destroy',
    'question-set-retry-batches:destroy',
    'question-set-runs:destroy',
    'scheduled-executions:destroy',
    'alerts:destroy',
    'prompts:destroy',
    'groups:destroy',
    'competitors:destroy',
    'project:destroy',
    'evidence:commit'
  ]);
  assert.deepEqual(whereByModel.recordFind, { project_id: 7 });
  assert.deepEqual(whereByModel.metricDestroy, { project_id: 7 });
  assert.deepEqual(whereByModel.detailDestroy.question_record_id[Op.in], [21, 22]);
  assert.deepEqual(whereByModel.recordDestroy.id[Op.in], [21, 22]);
  assert.deepEqual(whereByModel.scheduleDestroy, { project_id: 7 });
  assert.deepEqual(whereByModel.reportDestroy, { project_id: 7 });
  assert.deepEqual(whereByModel.questionSetRetryBatchDestroy, { project_id: 7 });
  assert.deepEqual(whereByModel.questionSetRunDestroy, { project_id: 7 });
  assert.deepEqual(whereByModel.scheduledExecutionDestroy, { project_id: 7 });
  assert.deepEqual(whereByModel.alertDestroy, { project_id: 7 });
  assert.deepEqual(whereByModel.promptDestroy, { project_id: 7 });
  assert.deepEqual(whereByModel.groupDestroy, { project_id: 7 });
  assert.deepEqual(whereByModel.competitorDestroy, { project_id: 7 });
  assert.deepEqual(whereByModel.projectDestroy, { id: 7 });
});

test('refuses to permanently delete active projects', async () => {
  const result = await ProjectDeletionService.deleteArchivedProject({ id: 7, status: 'active' }, {});

  assert.deepEqual(result, {
    ok: false,
    status: 409,
    message: '请先归档项目后再删除'
  });
});

test('permanent project deletion physically removes every project record evidence directory', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'project-delete-evidence-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  for (const recordId of [41, 42]) {
    const recordDir = path.join(root, 'records', String(recordId));
    await fs.promises.mkdir(recordDir, { recursive: true });
    await fs.promises.writeFile(path.join(recordDir, 'capture.png'), 'capture');
  }
  const deletionService = new WebCaptureDeletionService({
    captureStore: new WebCaptureStore({ rootDir: root }),
    transactionRunner: async (work) => work({ id: 'project-delete-transaction' })
  });
  const repository = { destroy: async () => 1 };
  const repositories = {
    WebCaptureDeletionService: deletionService,
    QuestionRecord: {
      findAll: async () => [{ id: 41 }, { id: 42 }],
      destroy: async () => 2
    },
    ResultDetail: repository,
    VisibilityMetric: repository,
    DetectionSchedule: repository,
    ReportSnapshot: repository,
    QuestionSetRetryBatch: repository,
    QuestionSetRun: repository,
    ScheduledExecution: repository,
    AlertRule: repository,
    TrackedPrompt: repository,
    PromptGroup: repository,
    BrandCompetitor: repository,
    BrandProject: repository
  };

  const result = await ProjectDeletionService.deleteArchivedProject({
    id: 7,
    status: 'archived'
  }, repositories);

  assert.equal(result.ok, true);
  await assert.rejects(fs.promises.access(path.join(root, 'records', '41')));
  await assert.rejects(fs.promises.access(path.join(root, 'records', '42')));
});
