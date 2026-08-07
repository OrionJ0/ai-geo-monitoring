const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const {
  OFFICIAL_BASE,
  FRONTEND_HEALTH_URL,
  abortableSleep,
  collectRequestAudits,
  evaluateEvidence,
  extractRecordId,
  extractRecordIds,
  historicalV4Query,
  readRequiredRevision,
  acceptanceRequiredTimeoutMs,
  acceptanceAvailableTimeoutMs,
  assertAcceptanceBudget,
  reassertAcceptanceBudget,
  recordBatchWaitTimeoutMs,
  requiredAnalysisQueueTimeoutMs,
  toEvidence,
  verifyRequestAudits,
  verifySchedulerBacklog,
  cleanupAcceptanceProjects,
  acceptanceProjectMarker,
  acceptanceProjectWebsite,
  isMarkedAcceptanceProject,
  writePreflightBudgetResult,
  writeSecureEvidence,
  createAcceptanceSession,
  withAcceptanceModels,
  evaluateHistoricalV4Evidence
} = require('../scripts/geo010Acceptance');
const projectFieldNormalizationService = require('../services/ProjectFieldNormalizationService');

test('production preflight rejects due or actively leased scheduler backlog', async () => {
  const repository = (value) => ({ count: async () => value });
  await assert.rejects(
    verifySchedulerBacklog({
      DetectionSchedule: repository(1),
      BrandProject: repository(0),
      ScheduledExecution: repository(0)
    }),
    /生产调度存在 backlog/u
  );
  assert.deepEqual(await verifySchedulerBacklog({
    DetectionSchedule: repository(0),
    BrandProject: repository(0),
    ScheduledExecution: repository(0)
  }), {
    due_detection_schedules: 0,
    due_projects: 0,
    active_scheduled_executions: 0
  });
});

test('production acceptance signs a short-lived server token for an existing active admin', async () => {
  const secret = 'a'.repeat(64);
  const session = await createAcceptanceSession({
    User: {
      findOne: async (options) => {
        assert.deepEqual(options.where, { username: 'release-admin' });
        return {
          id: 17,
          username: 'release-admin',
          role: 'admin',
          status: 'active',
          membership_level: 'pro',
          membership_expires_at: null
        };
      }
    }
  }, {
    DEFAULT_ADMIN_USERNAME: 'release-admin',
    JWT_SECRET: secret
  });

  assert.equal(session.userId, 17);
  const payload = jwt.verify(session.token, secret);
  assert.equal(payload.userId, 17);
  assert.equal(payload.username, 'release-admin');
  assert.equal(payload.role, 'admin');
  assert.equal(payload.purpose, 'geo010-acceptance');
  assert.ok(payload.exp - payload.iat <= 6 * 60 * 60);
});

test('production acceptance refuses missing, inactive or non-admin identities', async () => {
  const environment = {
    GEO010_ACCEPTANCE_USERNAME: 'acceptance',
    JWT_SECRET: 'b'.repeat(64)
  };
  await assert.rejects(
    createAcceptanceSession({ User: { findOne: async () => null } }, environment),
    /不存在/u
  );
  await assert.rejects(
    createAcceptanceSession({
      User: {
        findOne: async () => ({
          id: 1,
          username: 'acceptance',
          role: 'user',
          status: 'active'
        })
      }
    }, environment),
    /active admin/u
  );
});

test('production acceptance always closes models when authentication setup fails', async () => {
  let closed = 0;
  const models = {
    sequelize: {
      close: async () => {
        closed += 1;
      }
    }
  };
  await assert.rejects(
    withAcceptanceModels(async (loaded) => {
      assert.equal(loaded, models);
      throw new Error('authentication rejected');
    }, () => models),
    /authentication rejected/u
  );
  assert.equal(closed, 1);
});

test('preflight janitor atomically archives only known acceptance projects', async () => {
  const calls = [];
  const markerKey = 'test-only-marker-key';
  const markedName = '010-v5-acceptance-1720000000000-42';
  const markedWebsite = acceptanceProjectWebsite(markedName, markerKey);
  const normalizedWebsite = projectFieldNormalizationService.normalizeWebsite(markedWebsite);
  assert.equal(normalizedWebsite, markedWebsite);
  assert.equal(isMarkedAcceptanceProject({
    name: markedName,
    website: normalizedWebsite,
    industry: 'GEO 验收',
    aliases: []
  }, markerKey), true);
  const result = await cleanupAcceptanceProjects({
    sequelize: {
      transaction: async (work) => work({ LOCK: { UPDATE: 'UPDATE' } })
    },
    BrandProject: {
      findAll: async (options) => {
        calls.push(['find', options]);
        return [
          {
            id: 41,
            user_id: 7,
            name: markedName,
            website: markedWebsite,
            industry: 'GEO 验收',
            aliases: []
          },
          {
            id: 42,
            user_id: 7,
            name: '010-v5-acceptance-ordinary-project',
            website: 'https://customer.example.com',
            industry: 'GEO 验收',
            aliases: []
          }
        ];
      },
      update: async (values, options) => {
        calls.push(['archive', values, options]);
        return [1];
      }
    },
    DetectionSchedule: {
      update: async (values, options) => {
        calls.push(['disable', values, options]);
        return [2];
      }
    }
  }, { acceptanceUserId: 7, markerKey });
  assert.deepEqual(result, { archived_projects: 1, disabled_schedules: 2 });
  assert.equal(calls[0][0], 'find');
  assert.equal(calls[0][1].where.user_id, 7);
  assert.equal(calls[1][0], 'disable');
  assert.deepEqual(calls[1][2].where.project_id[Object.getOwnPropertySymbols(
    calls[1][2].where.project_id
  )[0]], [41]);
  assert.equal(calls[2][0], 'archive');
});

test('historical v4 preflight explicitly projects only old-schema columns', () => {
  const QuestionSetRun = function QuestionSetRun() {};
  const query = historicalV4Query(QuestionSetRun, 17);
  assert.equal(query.where.user_id, 17);
  assert.equal(query.include[0].model, QuestionSetRun);
  assert.deepEqual(query.attributes, [
    'id',
    'project_id',
    'question_set_run_id',
    'analysis_contract_version',
    'metric_semantics_version'
  ]);
  assert.equal(query.attributes.includes('competitor_snapshot'), false);
  assert.equal(Object.hasOwn(historicalV4Query(QuestionSetRun).where, 'user_id'), false);
});

test('historical v4 evidence uses the file-level CSV contract and row-level semantics', () => {
  const valid = {
    reportData: { analysis_contract_version: 'ai_structured_v4' },
    reportRow: {
      analysis_contract_version: 'ai_structured_v4',
      metric_semantics_version: 'contextual_competitor_mentions_sov_v1'
    },
    databaseRow: {
      metric_semantics_version: 'contextual_competitor_mentions_sov_v1'
    },
    csv: { analysisContractVersion: 'ai_structured_v4' },
    csvRow: {
      metric_semantics_version: 'contextual_competitor_mentions_sov_v1'
    },
    contentType: 'text/csv; charset=utf-8',
    contentDisposition: 'attachment; filename="history.csv"'
  };
  const evidence = evaluateHistoricalV4Evidence(valid);
  assert.equal(evidence.readable, true);
  assert.equal(evidence.csv_contract_level, 'file');

  const invalid = [
    { ...valid, csv: { analysisContractVersion: 'ai_structured_v5' } },
    { ...valid, csvRow: null },
    {
      ...valid,
      csvRow: { metric_semantics_version: 'contextual_competitor_mentions_sov_v2_scoped' }
    },
    { ...valid, contentType: 'application/json' },
    { ...valid, contentDisposition: 'inline' }
  ];
  invalid.forEach((input) => {
    assert.equal(evaluateHistoricalV4Evidence(input).readable, false);
  });
});

test('derives record wait budgets from queue waves, concurrency and execution lease', () => {
  assert.equal(recordBatchWaitTimeoutMs(5, 2, 20 * 60 * 1000), 65 * 60 * 1000);
  assert.equal(recordBatchWaitTimeoutMs(5, 1, 20 * 60 * 1000), 105 * 60 * 1000);
  assert.equal(recordBatchWaitTimeoutMs(1, 5, 20 * 60 * 1000), 25 * 60 * 1000);
});

test('automatic monitoring budget covers both enabled acceptance prompts', () => {
  const singleEntryRecords = 5;
  const questionSetEntryRecords = 5;
  assert.equal(
    recordBatchWaitTimeoutMs(singleEntryRecords + questionSetEntryRecords, 2, 20 * 60 * 1000),
    105 * 60 * 1000
  );
});

test('analysis queue timeout covers the last wave of the two-prompt scheduler batch', () => {
  assert.equal(
    requiredAnalysisQueueTimeoutMs(10, 2, 4 * 120 * 1000),
    32 * 60 * 1000
  );
});

test('four-entry acceptance budget is derived before any production write', () => {
  const lease = 20 * 60 * 1000;
  assert.equal(
    acceptanceRequiredTimeoutMs(5, 2, lease),
    (65 + 65 + 105 + 25) * 60 * 1000
  );
  assert.throws(
    () => assertAcceptanceBudget({
      platformCount: 5,
      concurrency: 1,
      recordLeaseMs: lease,
      availableMs: 300 * 60 * 1000
    }),
    /停服前门禁.*440.*300/u
  );
  assert.deepEqual(
    assertAcceptanceBudget({
      platformCount: 5,
      concurrency: 2,
      recordLeaseMs: lease,
      availableMs: 300 * 60 * 1000
    }),
    {
      platform_count: 5,
      concurrency: 2,
      record_lease_ms: lease,
      required_ms: 260 * 60 * 1000,
      available_ms: 300 * 60 * 1000
    }
  );
});

test('acceptance cancellation interrupts waits so the caller can enter cleanup', async () => {
  const controller = new AbortController();
  const waiting = abortableSleep(30_000, controller.signal);
  controller.abort(new Error('取消测试'));
  await assert.rejects(waiting, /取消测试/u);
});

test('preflight budget reserves an hour for install, tests, build and migrations', () => {
  const now = Date.parse('2026-08-06T00:00:00.000Z');
  const deadline = now + 345 * 60 * 1000;
  assert.equal(acceptanceAvailableTimeoutMs(now, {
    AI_GEO_DEPLOYMENT_DEADLINE_EPOCH_MS: String(deadline),
    AI_GEO_ACCEPTANCE_STAGE: 'preflight'
  }), 275 * 60 * 1000);
  assert.equal(acceptanceAvailableTimeoutMs(now, {
    AI_GEO_DEPLOYMENT_DEADLINE_EPOCH_MS: String(deadline),
    AI_GEO_ACCEPTANCE_STAGE: 'runtime'
  }), 300 * 60 * 1000);
  const initial = assertAcceptanceBudget({
    platformCount: 1,
    concurrency: 1,
    recordLeaseMs: 60_000,
    availableMs: 30 * 60 * 1000
  });
  assert.throws(
    () => reassertAcceptanceBudget(initial, deadline - 70 * 60 * 1000, {
      AI_GEO_DEPLOYMENT_DEADLINE_EPOCH_MS: String(deadline),
      AI_GEO_ACCEPTANCE_STAGE: 'preflight'
    }),
    /停服前门禁/u
  );
});

function validEntry(overrides = {}) {
  return {
    id: 1,
    status: 'completed',
    execution_mode: 'full_monitoring',
    analysis_contract_version: 'ai_structured_v5',
    metric_semantics_version: 'contextual_competitor_mentions_sov_v2_scoped',
    analysis_method: 'ai_structured_v5',
    analysis_platform: 'deepseek',
    analysis_model: 'deepseek-v4-flash',
    structure_version: 'geo_metric_input_v5',
    contract_revision: 'three_track_partial_v2',
    diagnostic_stages: [
      { stage: 'entity_extract', platform: 'deepseek', model: 'deepseek-v4-flash', degraded: false },
      { stage: 'semantic_judge', platform: 'deepseek', model: 'deepseek-v4-flash', degraded: false }
    ],
    ...overrides
  };
}

test('production acceptance is pinned to the only supported HTTPS entry', () => {
  assert.equal(OFFICIAL_BASE, 'https://insight.guangtuo.com/api');
  assert.equal(FRONTEND_HEALTH_URL, 'https://insight.guangtuo.com/api/frontend-health');
});

test('collects systemd audits with journalctl arguments starting at the unit flag', () => {
  let invocation;
  const audits = collectRequestAudits('2026-08-06T00:00:00.000Z', (file, args, options) => {
    invocation = { file, args, options };
    return 'AI_PLATFORM_REQUEST_AUDIT {"event":"ai_platform_request","correlation_id":"record-1"}\n';
  });
  assert.equal(invocation.file, 'journalctl');
  assert.deepEqual(invocation.args.slice(0, 4), [
    '-u',
    'ai-geo-backend.service',
    '--since',
    '2026-08-06T00:00:00.000Z'
  ]);
  assert.equal(audits.length, 1);
});

test('extracts current single and question-set response record ids', () => {
  assert.equal(extractRecordId({ data: { record_ids: [11] } }), 11);
  assert.equal(extractRecordId({ data: { results: [{ record_id: 12 }] } }), 12);
  assert.equal(extractRecordId({ data: {} }), null);
  assert.deepEqual(
    extractRecordIds({ data: { record_ids: [11, 12, 11], results: [{ record_id: 13 }] } }),
    [11, 12, 13]
  );
});

test('requires one explicit immutable 40-character revision argument', () => {
  const revision = 'a'.repeat(40);
  assert.equal(readRequiredRevision([`--revision=${revision}`]), revision);
  assert.throws(() => readRequiredRevision([]), /必须且只能/u);
  assert.throws(() => readRequiredRevision(['--revision=abc']), /40 位/u);
  assert.throws(() => readRequiredRevision([`--revision=${revision}`, '--extra']), /必须且只能/u);
});

test('requires all four named entries instead of accepting a partial sample', () => {
  const entries = {
    single_question: [validEntry()],
    question_set: [validEntry()],
    automatic_monitoring: [validEntry()],
    analysis_only: [validEntry({ execution_mode: 'analysis_only' })]
  };
  assert.equal(evaluateEvidence(entries, true).pass, true);
  delete entries.automatic_monitoring;
  assert.equal(evaluateEvidence(entries, true).pass, false);
});

test('rejects Pro, v4, non-scoped semantics and missing historical-read evidence', () => {
  const base = {
    single_question: [validEntry()],
    question_set: [validEntry()],
    automatic_monitoring: [validEntry()],
    analysis_only: [validEntry({ execution_mode: 'analysis_only' })]
  };
  assert.equal(evaluateEvidence({ ...base, single_question: [validEntry({ analysis_model: 'deepseek-v4-pro' })] }, true).pass, false);
  assert.equal(evaluateEvidence({ ...base, question_set: [validEntry({ analysis_contract_version: 'ai_structured_v4' })] }, true).pass, false);
  assert.equal(evaluateEvidence({ ...base, automatic_monitoring: [validEntry({ metric_semantics_version: 'contextual_competitor_mentions_sov_v1' })] }, true).pass, false);
  assert.equal(evaluateEvidence(base, false).pass, false);
});

test('builds evidence from the record and its persisted visibility metric', () => {
  const evidence = toEvidence({
    id: 8,
    status: 'completed',
    execution_mode: 'analysis_only',
    analysis_contract_version: 'ai_structured_v5',
    metric_semantics_version: 'wrong-row-value',
    visibilityMetric: {
      metric_semantics_version: 'contextual_competitor_mentions_sov_v2_scoped',
      analysis_method: 'ai_structured_v5',
      analysis_platform: 'deepseek',
      analysis_model: 'deepseek-v4-flash',
      analysis_structure: {
        schema_version: 'geo_metric_input_v5',
        contract_revision: 'three_track_partial_v2',
        diagnostics: {
          stages: [
            { stage: 'entity_extract', platform: 'deepseek', model: 'deepseek-v4-flash' },
            { stage: 'semantic_judge', platform: 'deepseek', model: 'deepseek-v4-flash' }
          ]
        }
      }
    }
  });
  assert.deepEqual(evidence, validEntry({ id: 8, execution_mode: 'analysis_only' }));
});

test('request audit proof requires both Flash stages and forbids monitoring on analysis-only', () => {
  const policyFingerprint = 'a'.repeat(64);
  const entryIds = {
    single_question: [1],
    question_set: [2],
    automatic_monitoring: [3],
    analysis_only: [4]
  };
  const audits = [1, 2, 3, 4].flatMap((id) => [
    {
      event: 'ai_platform_request',
      platform: 'deepseek',
      model: 'deepseek-v4-flash',
      purpose: 'analysis_entity_extract',
      policy_revision: 'grounded_entity_catalog_v1+fixed_json_no_web_v1',
      policy_fingerprint: policyFingerprint,
      policy_valid: true,
      prompt_fingerprint: 'b'.repeat(64),
      prompt_template_fingerprint: '43508380a32708aab5f3815e114dbfbd19af21ec52018f58f055e2bc76ff93af',
      prompt_variant: 'base',
      attempt: 1,
      correlation_id: `record-${id}`
    },
    {
      event: 'ai_platform_request',
      platform: 'deepseek',
      model: 'deepseek-v4-flash',
      purpose: 'analysis_semantic_judge',
      policy_revision: 'closed_entity_semantics_v4_evidence_roles_rev2+fixed_json_no_web_v1',
      policy_fingerprint: policyFingerprint,
      policy_valid: true,
      prompt_fingerprint: 'c'.repeat(64),
      prompt_template_fingerprint: 'bbab0ccf31aecaa250bd24209581ef99fb9ef2c83e26c4ba90623aef741efddb',
      prompt_variant: 'base',
      attempt: 1,
      correlation_id: `record-${id}`
    },
    ...(id === 4 ? [] : [{
      event: 'ai_platform_request',
      platform: 'deepseek',
      model: 'deepseek-v4-flash',
      purpose: 'project_monitoring',
      attempt: 1,
      correlation_id: `record-${id}`
    }])
  ]);
  assert.deepEqual(verifyRequestAudits(audits, entryIds, [4]), {
    total: 11,
    correlated: 11,
    pro_requests: 0
  });
  assert.throws(
    () => verifyRequestAudits([
      ...audits,
      { model: 'deepseek-v4-pro', purpose: 'project_monitoring', correlation_id: 'record-1' }
    ], entryIds, [4]),
    /pro|非 DeepSeek Flash/iu
  );
  assert.throws(
    () => verifyRequestAudits([
      ...audits,
      {
        model: 'deepseek-v4-flash',
        purpose: 'analysis_entity_extract',
        correlation_id: null
      }
    ], entryIds, [4]),
    /缺少 record correlation/u
  );
  assert.throws(
    () => verifyRequestAudits([
      ...audits,
      { model: 'deepseek-v4-flash', purpose: 'unspecified', correlation_id: null }
    ], entryIds, [4]),
    /未标记|v4 基线/u
  );
  assert.throws(
    () => verifyRequestAudits(audits.map((row) => (
      row.purpose === 'analysis_semantic_judge' && row.correlation_id === 'record-1'
        ? { ...row, policy_valid: false }
        : row
    )), entryIds, [4]),
    /策略指纹无效/u
  );
  assert.throws(
    () => verifyRequestAudits([
      ...audits,
      { model: 'deepseek-v4-flash', purpose: 'prompt_generation', correlation_id: 'record-1' }
    ], entryIds, [4]),
    /非正式上游请求/u
  );
});

test('writes production evidence into a private directory without overwriting', () => {
  const revision = 'b'.repeat(40);
  const filename = writeSecureEvidence({ pass: true }, revision);
  const directory = path.dirname(filename);
  try {
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(fs.readFileSync(filename, 'utf8')), { pass: true });
  } finally {
    fs.unlinkSync(filename);
    fs.rmdirSync(directory);
  }
});

test('writes a one-time machine-readable preflight budget without secrets', () => {
  const directory = fs.mkdtempSync('/tmp/geo010-budget-test-');
  const filename = path.join(directory, 'budget.json');
  try {
    writePreflightBudgetResult({
      required_ms: 1234,
      platform_count: 2,
      concurrency: 1,
      record_lease_ms: 5678,
      secret: 'must-not-leak'
    }, filename);
    assert.deepEqual(JSON.parse(fs.readFileSync(filename, 'utf8')), {
      required_ms: 1234,
      platform_count: 2,
      concurrency: 1,
      record_lease_ms: 5678
    });
    assert.throws(() => writePreflightBudgetResult({ required_ms: 1 }, filename), /EEXIST/u);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
