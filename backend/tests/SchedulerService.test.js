const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Op } = require('sequelize');

const { BrandProject, DetectionSchedule, QuestionRecord, TrackedPrompt, User } = require('../models');
const ProjectRunService = require('../services/ProjectRunService');
const SchedulerService = require('../services/SchedulerService');

test('normalizes project monitoring settings for dynamic platform codes', () => {
  const payload = SchedulerService.normalizeProjectMonitoring({
    monitoring_enabled: true,
    monitoring_time: '8:5',
    platforms: ['deepseek', 'kimi', 'doubao']
  });

  assert.equal(payload.monitoring_enabled, true);
  assert.equal(payload.monitoring_time, '08:05');
  assert.deepEqual(payload.platforms, ['deepseek', 'kimi', 'doubao']);
});

test('normalizes schedule platforms within the dynamic project platform scope', () => {
  assert.deepEqual(
    SchedulerService.normalizeSchedulePlatforms(['doubao', 'deepseek', 'kimi'], {
      id: 2,
      platforms: ['deepseek']
    }),
    ['deepseek']
  );
  assert.deepEqual(
    SchedulerService.normalizeSchedulePlatforms(['kimi'], {
      id: 2,
      platforms: ['doubao']
    }),
    []
  );
  assert.deepEqual(
    SchedulerService.normalizeSchedulePlatforms(['doubao', 'kimi']),
    ['doubao', 'kimi']
  );
});

test('marks scheduled project records as failed when metric generation fails', async () => {
  const updates = [];
  const result = await SchedulerService.finalizeScheduledProjectRecord({
    record: {
      id: 11,
      project_id: 2,
      user_id: 9,
      update: async (payload) => updates.push(payload)
    },
    responseText: '米其林静音轮胎不错',
    aiResponse: {},
    keywords: ['米其林'],
    repositories: {
      BrandProject: {
        findByPk: async () => ({ id: 2, name: '米其林' })
      },
      BrandCompetitor: {
        findAll: async () => []
      },
      TrackedPrompt: {
        findOne: async () => null
      }
    },
    projectRunService: {
      failRecord: async (record, message) => {
        await record.update({ status: 'failed', error_message: message });
        return true;
      },
      finalizeSuccessfulRecord: async () => {
        throw new Error('metric write failed');
      }
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'failed');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, 'failed');
  assert.equal(updates[0].error_message, '指标生成失败，请稍后重试');
  assert.equal(result.error.message, '指标生成失败，请稍后重试');
});

test('scheduled finalization forwards the claimed lease and persists the original response', async () => {
  const calls = [];
  const result = await SchedulerService.finalizeScheduledProjectRecord({
    record: {
      id: 12,
      project_id: 2,
      user_id: 9,
      tracked_prompt_id: null
    },
    executionToken: 'schedule-lease-token',
    persistResponseDetail: true,
    responseText: 'GATO 适合园区周界安防。',
    aiResponse: { content: 'GATO 适合园区周界安防。' },
    providerCitations: [{ url: 'https://example.test/source' }],
    keywords: ['GATO'],
    repositories: {
      BrandProject: {
        findByPk: async () => ({ id: 2, name: 'GATO' })
      },
      BrandCompetitor: {
        findAll: async () => []
      },
      TrackedPrompt: {
        findOne: async () => null
      }
    },
    projectRunService: {
      failRecord: async () => true,
      finalizeSuccessfulRecord: async (payload) => {
        calls.push(payload);
        return { ok: true };
      }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executionToken, 'schedule-lease-token');
  assert.equal(calls[0].persistResponseDetail, true);
  assert.deepEqual(calls[0].providerCitations, [{ url: 'https://example.test/source' }]);
});

test('scheduled detections guard empty AI responses before atomically finalizing result details', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/SchedulerService.js'), 'utf8');
  const extractIndex = source.indexOf('const originalText = ResultParserService.extractResponseText');
  const detailIndex = source.indexOf('persistResponseDetail: true', extractIndex);
  const guardIndex = source.indexOf('监测平台返回内容为空', extractIndex);

  assert.ok(extractIndex > 0);
  assert.ok(detailIndex > extractIndex);
  assert.ok(guardIndex > extractIndex);
  assert.ok(guardIndex < detailIndex);
});

test('scheduled platform failures store safe error messages', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/SchedulerService.js'), 'utf8');

  assert.match(source, /safePlatformFailureMessage\(result\)/);
  assert.doesNotMatch(source, /error_message:\s*result\.error/);
});

test('legacy standalone schedules request only legacy-schedule capable platforms', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/SchedulerService.js'), 'utf8');

  assert.match(source, /getPlatformAvailability\([\s\S]*capability:\s*'legacy_schedule'/);
  assert.match(source, /queryPlatform\([\s\S]*purpose:\s*'legacy_schedule'/);
});

test('scheduler stop waits for an active tick to finish', async () => {
  const service = new SchedulerService.SchedulerService();
  let releaseTick;
  const tickGate = new Promise((resolve) => { releaseTick = resolve; });
  service._started = true;
  service._tickPromise = tickGate;

  let stopped = false;
  const stopping = service.stop().then(() => { stopped = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, false);
  assert.equal(service._started, false);

  releaseTick();
  await stopping;
  assert.equal(stopped, true);
});

test('scheduled runs do not consume quota or create records when all platforms are unavailable', async () => {
  let quotaCalls = 0;
  let settingsCalls = 0;
  const result = await SchedulerService.submitDetectionForSchedule({
    user_id: 9,
    question: '静音轮胎怎么选',
    platforms: ['custom-ai'],
    highlight_keywords: []
  }, {
    projectValidated: true,
    aiPlatformService: {
      getPlatformAvailability: async () => [{
        code: 'custom-ai',
        platform_name: '自定义平台',
        available: false,
        reason: 'missing_api_key'
      }]
    },
    settingsService: {
      getSettings: async () => {
        settingsCalls += 1;
        return {};
      }
    },
    consumeQuota: async () => {
      quotaCalls += 1;
      return { ok: true };
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'all_platforms_unavailable');
  assert.equal(result.attempted, 0);
  assert.equal(result.advance_schedule, true);
  assert.equal(quotaCalls, 0);
  assert.equal(settingsCalls, 0);
  assert.deepEqual(result.skipped_platforms, [{
    platform: 'custom-ai',
    name: '自定义平台',
    reason: 'missing_api_key',
    message: '自定义平台未配置 API Key'
  }]);
});

test('scheduled detection records retain their execution ledger id', async () => {
  const originalCreateRecord = QuestionRecord.create;
  const originalUpdateRecord = QuestionRecord.update;
  const createdPayloads = [];
  QuestionRecord.create = async (payload) => {
    createdPayloads.push(payload);
    return { id: 91 };
  };
  QuestionRecord.update = async () => [1];

  try {
    await SchedulerService.submitDetectionForSchedule({
      user_id: 9,
      project_id: 2,
      question: '调度记录属于哪个执行时槽？',
      brand: 'Goodie AI',
      platforms: ['deepseek'],
      highlight_keywords: []
    }, {
      projectValidated: true,
      scheduledExecutionId: 77,
      aiPlatformService: {
        getPlatformAvailability: async () => [{
          code: 'deepseek',
          platform_name: 'DeepSeek',
          model_name: 'deepseek-v4',
          available: true,
          config: {}
        }],
        queryPlatform: async () => ({
          success: false,
          error_code: 'upstream_unavailable'
        })
      },
      settingsService: {
        getSettings: async () => ({})
      },
      consumeQuota: async () => ({ ok: true })
    });

    assert.equal(createdPayloads.length, 1);
    assert.equal(createdPayloads[0].scheduled_execution_id, 77);
    assert.equal(createdPayloads[0].analysis_contract_version, 'ai_structured_v4');
    assert.equal(
      createdPayloads[0].metric_semantics_version,
      'contextual_competitor_mentions_sov_v1'
    );
  } finally {
    QuestionRecord.create = originalCreateRecord;
    QuestionRecord.update = originalUpdateRecord;
  }
});

test('scheduled query exceptions mark created records as failed', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/SchedulerService.js'), 'utf8');

  assert.match(source, /let rec = null/);
  assert.match(source, /catch \(e\)[\s\S]*ProjectRunService\.failRecord\([\s\S]*SAFE_PLATFORM_FAILURE_MESSAGE/);
  assert.match(source, /ProjectRunService\.failRecord\([\s\S]*\{ executionToken \}/);
});

test('recovers stale pending project records as failed', async () => {
  const batchCalls = [];
  const recordUpdates = [];
  const retryMetadata = {
    retry: {
      previous_record_id: 17,
      attempt: 2,
      kind: 'analysis_only'
    }
  };
  const recovered = await SchedulerService.recoverStalePendingRecords({
    now: new Date('2026-05-19T13:30:00.000Z'),
    maxAgeMs: 20 * 60 * 1000,
    includeUnclaimed: true,
    QuestionRecord: {
      findAll: async (options) => {
        assert.equal(options.where.status, 'pending');
        assert.equal(options.where[Op.or].length, 3);
        assert.equal(options.where[Op.or][0].execution_token[Op.not], null);
        assert.ok(options.where[Op.or][0].lease_expires_at[Op.lt]);
        assert.equal(options.where[Op.or][1].lease_expires_at, null);
        assert.ok(options.where[Op.or][1].execution_started_at[Op.lt]);
        assert.equal(options.where[Op.or][2].execution_token, null);
        assert.equal(options.where[Op.or][2].question_set_run_id, null);
        assert.ok(options.where[Op.or][2].created_at[Op.lt]);
        return [
          {
            result_summary: retryMetadata,
            update: async (payload) => recordUpdates.push(payload)
          },
          {
            result_summary: null,
            update: async (payload) => recordUpdates.push(payload)
          }
        ];
      }
    },
    QuestionSetRetryBatch: {
      update: async (...args) => {
        batchCalls.push(args);
        return [1];
      }
    }
  });

  assert.equal(recovered, 2);
  assert.equal(recordUpdates.length, 2);
  assert.deepEqual(recordUpdates[0], {
    status: 'failed',
    error_message: '分析任务中断，请重新运行',
    execution_token: null,
    execution_started_at: null,
    lease_owner: null,
    lease_expires_at: null,
    result_summary: {
      ...retryMetadata,
      failure: {
        stage: 'execution_interrupted',
        error_code: 'stale_pending_recovered'
      }
    }
  });
  assert.deepEqual(recordUpdates[1], {
    status: 'failed',
    error_message: '分析任务中断，请重新运行',
    execution_token: null,
    execution_started_at: null,
    lease_owner: null,
    lease_expires_at: null,
    result_summary: {
      failure: {
        stage: 'execution_interrupted',
        error_code: 'stale_pending_recovered'
      }
    }
  });
  assert.equal(batchCalls.length, 1);
  assert.equal(batchCalls[0][0].status, 'failed');
  assert.ok(batchCalls[0][1].where.updated_at);
});

test('periodic recovery only expires claimed executions, not old records still waiting in a long queue', async () => {
  let observedWhere = null;
  const recovered = await SchedulerService.recoverStalePendingRecords({
    now: new Date('2026-05-19T13:30:00.000Z'),
    maxAgeMs: 20 * 60 * 1000,
    QuestionRecord: {
      findAll: async (options) => {
        observedWhere = options.where;
        return [];
      }
    },
    QuestionSetRetryBatch: {
      update: async () => [0]
    }
  });

  assert.equal(recovered, 0);
  assert.equal(observedWhere[Op.or].length, 2);
  assert.equal(observedWhere[Op.or][0].execution_token[Op.not], null);
  assert.ok(observedWhere[Op.or][0].lease_expires_at[Op.lt]);
  assert.equal(observedWhere[Op.or][1].lease_expires_at, null);
  assert.ok(observedWhere[Op.or][1].execution_started_at[Op.lt]);
  assert.equal(observedWhere.created_at, undefined);
  assert.equal(
    SchedulerService.getReadiness().last_recovery_at,
    '2026-05-19T13:30:00.000Z'
  );
});

test('scheduler tick is single-flight within one process', async () => {
  const originalDispatchPendingRuns = SchedulerService.dispatchPendingQuestionSetRuns;
  const originalRecover = SchedulerService.recoverStalePendingRecords;
  const originalRecoverScheduled = SchedulerService.recoverStaleScheduledExecutions;
  const originalFindSchedules = DetectionSchedule.findAll;
  const originalFindProjects = BrandProject.findAll;
  let releaseRecovery;
  let recoveryCalls = 0;
  let dispatchCalls = 0;
  const recoveryGate = new Promise((resolve) => {
    releaseRecovery = resolve;
  });

  SchedulerService.dispatchPendingQuestionSetRuns = async () => {
    dispatchCalls += 1;
    return 0;
  };
  SchedulerService.recoverStalePendingRecords = async () => {
    recoveryCalls += 1;
    await recoveryGate;
    return 0;
  };
  SchedulerService.recoverStaleScheduledExecutions = async () => 0;
  DetectionSchedule.findAll = async () => [];
  BrandProject.findAll = async () => [];

  try {
    const firstTick = SchedulerService.tick();
    const overlappingTick = SchedulerService.tick();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(recoveryCalls, 1);
    assert.equal(dispatchCalls, 1);
    releaseRecovery();
    await Promise.all([firstTick, overlappingTick]);
    assert.equal(recoveryCalls, 1);
  } finally {
    releaseRecovery();
    await SchedulerService._tickPromise?.catch(() => {});
    SchedulerService.dispatchPendingQuestionSetRuns = originalDispatchPendingRuns;
    SchedulerService.recoverStalePendingRecords = originalRecover;
    SchedulerService.recoverStaleScheduledExecutions = originalRecoverScheduled;
    DetectionSchedule.findAll = originalFindSchedules;
    BrandProject.findAll = originalFindProjects;
  }
});

test('scheduler startup refresh preserves persisted due slots and only initializes missing ones', async () => {
  const originalFindSchedules = DetectionSchedule.findAll;
  const originalFindProjects = BrandProject.findAll;
  const persistedDueAt = new Date('2026-07-25T01:00:00.000Z');
  const persistedProjectDueAt = new Date('2026-07-25T02:00:00.000Z');
  const scheduleUpdates = [];
  const projectUpdates = [];

  DetectionSchedule.findAll = async ({ where }) => {
    assert.deepEqual(where, {});
    return [
      {
        daily_time: '09:00',
        timezone: 'Asia/Shanghai',
        next_run_at: persistedDueAt,
        update: async (payload) => scheduleUpdates.push({ id: 1, payload })
      },
      {
        daily_time: '10:00',
        timezone: 'Asia/Shanghai',
        next_run_at: null,
        update: async (payload) => scheduleUpdates.push({ id: 2, payload })
      }
    ];
  };
  BrandProject.findAll = async () => [
    {
      monitoring_next_run_at: persistedProjectDueAt,
      toJSON: () => ({
        monitoring_enabled: true,
        monitoring_time: '9:0',
        monitoring_next_run_at: persistedProjectDueAt,
        platforms: ['deepseek']
      }),
      update: async (payload) => projectUpdates.push({ id: 3, payload })
    },
    {
      monitoring_next_run_at: null,
      toJSON: () => ({
        monitoring_enabled: true,
        monitoring_time: '10:00',
        monitoring_next_run_at: null,
        platforms: ['deepseek']
      }),
      update: async (payload) => projectUpdates.push({ id: 4, payload })
    }
  ];

  try {
    await SchedulerService.refresh();

    assert.deepEqual(scheduleUpdates.map((entry) => entry.id), [2]);
    assert.ok(scheduleUpdates[0].payload.next_run_at instanceof Date);
    assert.equal(Object.hasOwn(projectUpdates[0].payload, 'monitoring_next_run_at'), false);
    assert.equal(projectUpdates[0].payload.monitoring_time, '09:00');
    assert.ok(projectUpdates[1].payload.monitoring_next_run_at instanceof Date);
  } finally {
    DetectionSchedule.findAll = originalFindSchedules;
    BrandProject.findAll = originalFindProjects;
  }
});

test('scheduler startup can be retried after initialization fails', async () => {
  await SchedulerService.stop();
  const previousRecoveryAt = SchedulerService.getReadiness().last_recovery_at;
  const originalRefresh = SchedulerService.refresh;
  const originalDispatchPendingRuns = SchedulerService.dispatchPendingQuestionSetRuns;
  const originalRecovery = SchedulerService.recoverStalePendingRecords;
  const originalScheduledRecovery = SchedulerService.recoverStaleScheduledExecutions;
  let refreshCalls = 0;
  let dispatchCalls = 0;
  let recoveryCalls = 0;
  let scheduledRecoveryCalls = 0;

  SchedulerService.refresh = async () => {
    refreshCalls += 1;
    if (refreshCalls === 1) throw new Error('refresh failed');
  };
  SchedulerService.dispatchPendingQuestionSetRuns = async () => {
    dispatchCalls += 1;
    return 0;
  };
  SchedulerService.recoverStalePendingRecords = async () => {
    recoveryCalls += 1;
    return 0;
  };
  SchedulerService.recoverStaleScheduledExecutions = async () => {
    scheduledRecoveryCalls += 1;
    return 0;
  };

  try {
    await assert.rejects(() => SchedulerService.start(), /refresh failed/);
    assert.deepEqual(SchedulerService.getReadiness(), {
      started: false,
      last_recovery_at: previousRecoveryAt,
      last_error_code: 'scheduler_initialization_failed'
    });
    await SchedulerService.start();
    assert.equal(refreshCalls, 2);
    assert.equal(dispatchCalls, 1);
    assert.equal(recoveryCalls, 1);
    assert.equal(scheduledRecoveryCalls, 1);
    const readiness = SchedulerService.getReadiness();
    assert.equal(readiness.started, true);
    assert.ok(readiness.last_recovery_at);
    assert.equal(readiness.last_error_code, null);
  } finally {
    await SchedulerService.stop();
    SchedulerService.refresh = originalRefresh;
    SchedulerService.dispatchPendingQuestionSetRuns = originalDispatchPendingRuns;
    SchedulerService.recoverStalePendingRecords = originalRecovery;
    SchedulerService.recoverStaleScheduledExecutions = originalScheduledRecovery;
  }
});

test('manual scheduled runs only succeed when at least one platform completes', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/SchedulerService.js'), 'utf8');

  assert.match(source, /let completed = 0/);
  assert.match(source, /return \{ ok: completed > 0, completed, failed, attempted, skipped_platforms: skippedPlatforms \}/);
  assert.match(source, /const result = await this\.runNowWithResult\(scheduleId\)/);
  assert.match(source, /const result = await submitDetectionForSchedule\(s, \{ projectValidated: true, project: guard\.project \}\)/);
  assert.match(source, /if \(!result\?\.ok\) \{/);
});

test('automatic scheduled runs claim a durable slot before attempted platform failures', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/SchedulerService.js'), 'utf8');

  const claimIndex = source.indexOf("scheduleKind: 'detection_schedule'");
  const submitIndex = source.indexOf('await this.submitDetectionForSchedule(s', claimIndex);
  const finalizeIndex = source.indexOf('await this.finalizeScheduledExecution(execution', submitIndex);

  assert.ok(claimIndex > 0);
  assert.ok(submitIndex > claimIndex);
  assert.ok(finalizeIndex > submitIndex);
  assert.match(source, /await s\.update\(\{ last_run_at: now \}\)/);
});

test('scheduled runs only count finalized records as completed', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/SchedulerService.js'), 'utf8');

  assert.match(source, /const finalization = await finalizeScheduledProjectRecord/);
  assert.match(source, /if \(finalization\?\.ok\) \{\s*completed \+= 1;\s*\} else \{\s*failed \+= 1;\s*\}/);
  assert.doesNotMatch(source, /await finalizeScheduledProjectRecord\([\s\S]*?\);\s*completed \+= 1;/);
});

test('disables prompt schedules for archived projects before execution', async () => {
  const updates = [];
  const result = await SchedulerService.validateScheduleProject({
    project_id: 2,
    update: async (payload) => updates.push(payload)
  }, {
    BrandProject: {
      findByPk: async () => ({ id: 2, status: 'archived' })
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, '项目已归档');
  assert.deepEqual(updates, [{ enabled: false }]);
});

test('does not manually advance an archived project schedule', async () => {
  const originalFindSchedule = DetectionSchedule.findByPk;
  const originalFindProject = BrandProject.findByPk;
  const updates = [];

  DetectionSchedule.findByPk = async () => ({
    id: 5,
    project_id: 2,
    daily_time: '09:00',
    timezone: 'UTC',
    update: async (payload) => updates.push(payload)
  });
  BrandProject.findByPk = async () => ({ id: 2, status: 'archived' });

  try {
    const result = await SchedulerService.runNow(5);

    assert.equal(result, false);
    assert.deepEqual(updates, [{ enabled: false }]);
  } finally {
    DetectionSchedule.findByPk = originalFindSchedule;
    BrandProject.findByPk = originalFindProject;
  }
});

test('disables an archived project schedule after claiming its durable slot', async () => {
  const originalFindSchedules = DetectionSchedule.findAll;
  const originalFindProjects = BrandProject.findAll;
  const originalFindProject = BrandProject.findByPk;
  const originalRecover = SchedulerService.recoverStalePendingRecords;
  const originalDispatchPendingRuns = SchedulerService.dispatchPendingQuestionSetRuns;
  const originalRecoverScheduled = SchedulerService.recoverStaleScheduledExecutions;
  const originalClaim = SchedulerService.claimScheduledOccurrence;
  const originalStartExecution = SchedulerService.startScheduledExecution;
  const originalFinalizeExecution = SchedulerService.finalizeScheduledExecution;
  const updates = [];

  DetectionSchedule.findAll = async () => [{
    id: 5,
    project_id: 2,
    daily_time: '09:00',
    timezone: 'UTC',
    update: async (payload) => updates.push(payload)
  }];
  BrandProject.findAll = async () => [];
  BrandProject.findByPk = async () => ({ id: 2, status: 'archived' });
  SchedulerService.recoverStalePendingRecords = async () => 0;
  SchedulerService.dispatchPendingQuestionSetRuns = async () => 0;
  SchedulerService.recoverStaleScheduledExecutions = async () => 0;
  SchedulerService.claimScheduledOccurrence = async () => ({
    claimed: true,
    execution: { id: 11, execution_token: 'archived-test-token' }
  });
  SchedulerService.startScheduledExecution = async () => true;
  SchedulerService.finalizeScheduledExecution = async () => true;

  try {
    await SchedulerService.tick();

    assert.deepEqual(updates, [{ enabled: false }]);
  } finally {
    DetectionSchedule.findAll = originalFindSchedules;
    BrandProject.findAll = originalFindProjects;
    BrandProject.findByPk = originalFindProject;
    SchedulerService.recoverStalePendingRecords = originalRecover;
    SchedulerService.dispatchPendingQuestionSetRuns = originalDispatchPendingRuns;
    SchedulerService.recoverStaleScheduledExecutions = originalRecoverScheduled;
    SchedulerService.claimScheduledOccurrence = originalClaim;
    SchedulerService.startScheduledExecution = originalStartExecution;
    SchedulerService.finalizeScheduledExecution = originalFinalizeExecution;
  }
});

test('disables prompt schedules when the tracked prompt is disabled', async () => {
  const updates = [];
  const result = await SchedulerService.validateScheduleProject({
    project_id: 2,
    tracked_prompt_id: 7,
    update: async (payload) => updates.push(payload)
  }, {
    BrandProject: {
      findByPk: async () => ({ id: 2, status: 'active' })
    },
    TrackedPrompt: {
      findOne: async () => ({ id: 7, project_id: 2, enabled: false })
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, '问题已停用或不存在');
  assert.deepEqual(updates, [{ enabled: false }]);
});

test('advances project monitoring schedule after a failed project run attempt', async () => {
  const originalFindProject = BrandProject.findByPk;
  const originalFindPrompts = TrackedPrompt.findAll;
  const originalFindUser = User.findByPk;
  const originalRunProject = ProjectRunService.runProject;
  const updates = [];

  BrandProject.findByPk = async () => ({
    id: 2,
    user_id: 9,
    monitoring_enabled: true,
    toJSON: () => ({
      id: 2,
      user_id: 9,
      monitoring_enabled: true,
      monitoring_time: '09:00',
      platforms: ['deepseek']
    }),
    update: async (payload) => updates.push(payload)
  });
  TrackedPrompt.findAll = async () => [{ toJSON: () => ({ id: 3, question: '静音轮胎怎么选', enabled: true }) }];
  User.findByPk = async () => ({ id: 9, role: 'user' });
  const failure = {
    ok: false,
    status: 409,
    message: 'DeepSeek 网页版需要重新登录，本次运行未创建任务',
    data: {
      error_code: 'web_platform_preflight_failed',
      settings_url: '/admin/settings',
      blocked_platforms: [{
        code: 'deepseek-web',
        name: 'DeepSeek 网页版',
        reason_code: 'web_login_required'
      }]
    }
  };
  ProjectRunService.runProject = async () => failure;

  try {
    const result = await SchedulerService.runProjectNow(2);

    assert.deepEqual(result, failure);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].monitoring_time, '09:00');
    assert.ok(updates[0].monitoring_next_run_at instanceof Date);
    assert.equal(Object.hasOwn(updates[0], 'monitoring_last_run_at'), false);
  } finally {
    BrandProject.findByPk = originalFindProject;
    TrackedPrompt.findAll = originalFindPrompts;
    User.findByPk = originalFindUser;
    ProjectRunService.runProject = originalRunProject;
  }
});
