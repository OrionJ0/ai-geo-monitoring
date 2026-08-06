const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-v5-scheduler-'));
process.env.DB_STORAGE = path.join(databaseDir, 'test.sqlite');
delete process.env.DATABASE_URL;

const ProjectRunService = require('../services/ProjectRunService');
const SchedulerService = require('../services/SchedulerService');
const {
  sequelize,
  User,
  BrandProject,
  BrandCompetitor,
  TrackedPrompt,
  DetectionSchedule,
  QuestionRecord
} = require('../models');
const { V5_ANALYSIS_CONTRACT, SCOPED_METRIC_SEMANTICS } = require('../services/GeoMetricSemanticsService');

let user;
let project;
let prompt;

test.before(async () => {
  await sequelize.sync({ force: true });
  user = await User.create({
    username: 'v5scheduler',
    email: 'v5-scheduler@test.local',
    password: 'x',
    role: 'admin'
  });
  project = await BrandProject.create({
    user_id: user.id,
    name: '广拓',
    is_default: true,
    default_set: true
  });
  prompt = await TrackedPrompt.create({
    user_id: user.id,
    project_id: project.id,
    question: '大型园区安防有哪些厂家？',
    enabled: true
  });
  await BrandCompetitor.create({
    project_id: project.id,
    user_id: user.id,
    name: '海康威视',
    aliases: ['Hikvision'],
    website: 'hikvision.com'
  });
});

test.after(async () => {
  await sequelize.close();
});

test('自动监测 v5 记录冻结竞品快照与 v5 契约', async () => {
  const schedule = {
    project_id: project.id,
    user_id: user.id,
    tracked_prompt_id: prompt.id,
    question: prompt.question,
    platforms: ['deepseek'],
    highlight_keywords: [],
    brand: project.name
  };
  const result = await SchedulerService.submitDetectionForSchedule(schedule, {
    aiPlatformService: {
      getPlatformAvailability: async () => [
        { code: 'deepseek', available: true, platform_name: 'DeepSeek', model_name: 'deepseek-v4-flash', config: {} }
      ]
    },
    settingsService: { getSettings: async () => ({}) },
    consumeQuota: async () => ({ ok: true })
  });

  const records = await QuestionRecord.findAll({
    where: { project_id: project.id, tracked_prompt_id: prompt.id, platform: 'deepseek' }
  });
  assert.ok(records.length >= 1);
  const rec = records[0];
  assert.equal(rec.analysis_contract_version, V5_ANALYSIS_CONTRACT);
  assert.equal(rec.metric_semantics_version, SCOPED_METRIC_SEMANTICS);
  assert.ok(Array.isArray(rec.competitor_snapshot) && rec.competitor_snapshot.length === 1);
  assert.equal(rec.competitor_snapshot[0].name, '海康威视');
  await QuestionRecord.destroy({ where: { id: rec.id }, force: true });
});

test('010 硬切：租约预算覆盖 v5 两阶段最多 4 次 Flash 调用（默认路径即 v5）', () => {
  const lease = ProjectRunService.getRecordExecutionLeaseMs({
    target: {},
    runtimeSettings: {},
    retryMode: 'full_monitoring'
  });
  // 最坏 4 次 × 120 秒 + 60 秒缓冲
  assert.ok(lease >= (4 * 120 + 60) * 1000, `v5 预算至少覆盖 4×120s+60s，实际 ${lease}`);
});

test('analysis-only 的 v5 租约预算不增加监测时间但仍覆盖分析', () => {
  const v5AnalysisOnly = ProjectRunService.getRecordExecutionLeaseMs({
    target: {},
    runtimeSettings: {},
    retryMode: 'analysis_only'
  });
  // analysis-only 不采集，仅分析；预算覆盖 4 次分析调用
  assert.ok(v5AnalysisOnly >= (4 * 120 + 60) * 1000);
});
