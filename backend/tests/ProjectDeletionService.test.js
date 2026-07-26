const test = require('node:test');
const assert = require('node:assert/strict');
const { Op } = require('sequelize');

const ProjectDeletionService = require('../services/ProjectDeletionService');

test('permanently deletes archived project data before deleting the project row', async () => {
  const calls = [];
  const whereByModel = {};
  const project = { id: 7, status: 'archived' };
  const repositories = {
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
    'project:destroy'
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
