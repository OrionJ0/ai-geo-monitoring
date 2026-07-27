const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Op } = require('sequelize');

const PromptAnalysisCleanupService = require('../services/PromptAnalysisCleanupService');
const { WebCaptureStore } = require('../services/WebCaptureStore');
const {
  WebCaptureDeletionService
} = require('../services/WebCaptureDeletionService');

test('deletes visibility metrics by prompt id even when prompt records are missing', async () => {
  let metricWhere = null;
  let scheduleWhere = null;
  let detailDeleteCalled = false;
  let recordDeleteCalled = false;
  const models = {
    DetectionSchedule: {
      destroy: async ({ where }) => {
        scheduleWhere = where;
        return 1;
      }
    },
    QuestionRecord: {
      findAll: async () => [],
      destroy: async () => {
        recordDeleteCalled = true;
        return 0;
      }
    },
    VisibilityMetric: {
      destroy: async ({ where }) => {
        metricWhere = where;
        return 2;
      }
    },
    ResultDetail: {
      destroy: async () => {
        detailDeleteCalled = true;
        return 0;
      }
    }
  };

  const result = await PromptAnalysisCleanupService.deleteForPrompts(7, [3], models);

  assert.equal(result.metrics, 2);
  assert.equal(result.schedules, 1);
  assert.equal(result.details, 0);
  assert.equal(result.records, 0);
  assert.equal(scheduleWhere.project_id, 7);
  assert.deepEqual(scheduleWhere.tracked_prompt_id[Op.in], [3]);
  assert.equal(metricWhere.project_id, 7);
  assert.deepEqual(metricWhere[Op.or][0].prompt_id[Op.in], [3]);
  assert.equal(metricWhere[Op.or].length, 1);
  assert.equal(detailDeleteCalled, false);
  assert.equal(recordDeleteCalled, false);
});

test('deletes prompt metrics by prompt id and record id before removing records', async () => {
  const calls = [];
  let metricWhere = null;
  let detailWhere = null;
  let recordWhere = null;
  const models = {
    WebCaptureDeletionService: {
      deleteRecords: async (recordIds, work) => {
        calls.push('evidence:quarantine');
        assert.deepEqual(recordIds, [11, 12]);
        const result = await work({ id: 'cleanup-transaction' });
        calls.push('evidence:commit');
        return result;
      }
    },
    DetectionSchedule: {
      destroy: async () => {
        calls.push('schedules');
        return 1;
      }
    },
    QuestionRecord: {
      findAll: async () => [{ id: 11 }, { id: 12 }],
      destroy: async ({ where }) => {
        calls.push('records');
        recordWhere = where;
        return 2;
      }
    },
    VisibilityMetric: {
      destroy: async ({ where }) => {
        calls.push('metrics');
        metricWhere = where;
        return 3;
      }
    },
    ResultDetail: {
      destroy: async ({ where }) => {
        calls.push('details');
        detailWhere = where;
        return 2;
      }
    }
  };

  const result = await PromptAnalysisCleanupService.deleteForPrompts(7, [3, 4], models);

  assert.deepEqual(calls, [
    'evidence:quarantine',
    'schedules',
    'metrics',
    'details',
    'records',
    'evidence:commit'
  ]);
  assert.deepEqual(result, { records: 2, metrics: 3, details: 2, schedules: 1, reports: 0 });
  assert.equal(metricWhere.project_id, 7);
  assert.deepEqual(metricWhere[Op.or][0].prompt_id[Op.in], [3, 4]);
  assert.deepEqual(metricWhere[Op.or][1].question_record_id[Op.in], [11, 12]);
  assert.deepEqual(detailWhere.question_record_id[Op.in], [11, 12]);
  assert.equal(recordWhere.project_id, 7);
  assert.deepEqual(recordWhere.id[Op.in], [11, 12]);
});

test('preserves run-owned records and their evidence when prompt analysis is cleared', async () => {
  let metricWhere = null;
  let detailWhere = null;
  let recordWhere = null;
  const models = {
    DetectionSchedule: { destroy: async () => 0 },
    QuestionRecord: {
      findAll: async ({ attributes }) => {
        assert.deepEqual(attributes, ['id', 'question_set_run_id']);
        return [
          { id: 11, question_set_run_id: 90 },
          { id: 12, question_set_run_id: null }
        ];
      },
      destroy: async ({ where }) => {
        recordWhere = where;
        return 1;
      }
    },
    VisibilityMetric: {
      destroy: async ({ where }) => {
        metricWhere = where;
        return 1;
      }
    },
    ResultDetail: {
      destroy: async ({ where }) => {
        detailWhere = where;
        return 1;
      }
    }
  };

  const result = await PromptAnalysisCleanupService.deleteForPrompts(7, [3], models);

  assert.equal(result.records, 1);
  assert.deepEqual(detailWhere.question_record_id[Op.in], [12]);
  assert.deepEqual(recordWhere.id[Op.in], [12]);
  assert.deepEqual(
    metricWhere[Op.and][0][Op.or][1].question_record_id[Op.notIn],
    [11]
  );
});

test('removes generated report snapshots after prompt analysis data changes', async () => {
  let reportWhere = null;
  const models = {
    DetectionSchedule: { destroy: async () => 0 },
    QuestionRecord: {
      findAll: async () => [],
    },
    VisibilityMetric: { destroy: async () => 0 },
    ResultDetail: { destroy: async () => 0 },
    ReportSnapshot: {
      destroy: async ({ where }) => {
        reportWhere = where;
        return 3;
      }
    }
  };

  const result = await PromptAnalysisCleanupService.deleteForPrompts(7, [3], models);

  assert.equal(result.reports, 3);
  assert.deepEqual(reportWhere, { project_id: 7, status: 'generated' });
});

test('deletes project analysis records, metrics, details and generated reports without deleting prompts', async () => {
  const calls = [];
  let metricWhere = null;
  let detailWhere = null;
  let recordWhere = null;
  let reportWhere = null;
  const models = {
    QuestionRecord: {
      findAll: async ({ where }) => {
        assert.deepEqual(where, { project_id: 7 });
        return [{ id: 21 }, { id: 22 }];
      },
      destroy: async ({ where }) => {
        calls.push('records');
        recordWhere = where;
        return 2;
      }
    },
    VisibilityMetric: {
      destroy: async ({ where }) => {
        calls.push('metrics');
        metricWhere = where;
        return 4;
      }
    },
    ResultDetail: {
      destroy: async ({ where }) => {
        calls.push('details');
        detailWhere = where;
        return 2;
      }
    },
    ReportSnapshot: {
      destroy: async ({ where }) => {
        calls.push('reports');
        reportWhere = where;
        return 1;
      }
    }
  };

  const result = await PromptAnalysisCleanupService.deleteForProject(7, models);

  assert.deepEqual(calls, ['metrics', 'details', 'records', 'reports']);
  assert.deepEqual(result, { records: 2, metrics: 4, details: 2, reports: 1 });
  assert.deepEqual(metricWhere, { project_id: 7 });
  assert.deepEqual(detailWhere.question_record_id[Op.in], [21, 22]);
  assert.equal(recordWhere.project_id, 7);
  assert.deepEqual(recordWhere.id[Op.in], [21, 22]);
  assert.deepEqual(reportWhere, { project_id: 7, status: 'generated' });
});

test('project analysis cleanup also preserves run-owned historical evidence', async () => {
  let metricWhere = null;
  let detailWhere = null;
  let recordWhere = null;
  const models = {
    QuestionRecord: {
      findAll: async () => [
        { id: 21, question_set_run_id: 90 },
        { id: 22, question_set_run_id: null }
      ],
      destroy: async ({ where }) => {
        recordWhere = where;
        return 1;
      }
    },
    VisibilityMetric: {
      destroy: async ({ where }) => {
        metricWhere = where;
        return 1;
      }
    },
    ResultDetail: {
      destroy: async ({ where }) => {
        detailWhere = where;
        return 1;
      }
    }
  };

  const result = await PromptAnalysisCleanupService.deleteForProject(7, models);

  assert.equal(result.records, 1);
  assert.deepEqual(detailWhere.question_record_id[Op.in], [22]);
  assert.deepEqual(recordWhere.id[Op.in], [22]);
  assert.deepEqual(
    metricWhere[Op.and][0][Op.or][1].question_record_id[Op.notIn],
    [21]
  );
});

test('prompt analysis cleanup physically removes evidence for mutable records', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'prompt-cleanup-evidence-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const evidenceDir = path.join(root, 'records', '31');
  await fs.promises.mkdir(evidenceDir, { recursive: true });
  await fs.promises.writeFile(path.join(evidenceDir, 'capture.png'), 'capture');
  const captureStore = new WebCaptureStore({ rootDir: root });
  const deletionService = new WebCaptureDeletionService({
    captureStore,
    transactionRunner: async (work) => work({ id: 'cleanup-transaction' })
  });
  const models = {
    WebCaptureDeletionService: deletionService,
    DetectionSchedule: { destroy: async () => 0 },
    QuestionRecord: {
      findAll: async () => [{ id: 31, question_set_run_id: null }],
      destroy: async () => 1
    },
    VisibilityMetric: { destroy: async () => 0 },
    ResultDetail: { destroy: async () => 1 },
    ReportSnapshot: { destroy: async () => 0 }
  };

  const result = await PromptAnalysisCleanupService.deleteForPrompts(7, [3], models);

  assert.equal(result.records, 1);
  await assert.rejects(fs.promises.access(evidenceDir));
});
