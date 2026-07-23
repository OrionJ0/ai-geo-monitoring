const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-question-set-runs-'));
process.env.DB_STORAGE = path.join(databaseDir, 'test.sqlite');
delete process.env.DATABASE_URL;

const QuestionSetRunService = require('../services/QuestionSetRunService');
const QuestionSetRunCsvService = require('../services/QuestionSetRunCsvService');
const {
  sequelize,
  User,
  BrandProject,
  PromptGroup,
  TrackedPrompt,
  QuestionRecord,
  ResultDetail,
  VisibilityMetric,
  QuestionSetRun
} = require('../models');

let user;
let project;
let questionSet;
let prompt;

test.before(async () => {
  await sequelize.sync({ force: true });
  user = await User.create({
    username: 'question-set-report-user',
    email: 'question-set-report@example.com',
    password: 'not-used',
    role: 'user',
    status: 'active'
  });
  project = await BrandProject.create({
    user_id: user.id,
    name: '广拓',
    aliases: [],
    primary_keywords: [],
    platforms: ['deepseek'],
    status: 'active'
  });
  questionSet = await PromptGroup.create({
    project_id: project.id,
    user_id: user.id,
    name: '采购决策问题集'
  });
  prompt = await TrackedPrompt.create({
    project_id: project.id,
    prompt_group_id: questionSet.id,
    user_id: user.id,
    question: '周界报警系统怎么选？',
    tags: ['购买决策'],
    platforms: ['deepseek'],
    enabled: true
  });
});

test.after(async () => {
  await sequelize.close();
  fs.rmSync(databaseDir, { recursive: true, force: true });
});

test('一次问题集运行只聚合本次关联任务并保留逐条回答', async () => {
  const completed = await QuestionRecord.create({
    user_id: user.id,
    project_id: project.id,
    tracked_prompt_id: prompt.id,
    platform: 'deepseek',
    platform_name: 'DeepSeek',
    model_name: 'deepseek-chat',
    question: prompt.question,
    brand: project.name,
    brand_keywords: project.name,
    status: 'completed'
  });
  const failed = await QuestionRecord.create({
    user_id: user.id,
    project_id: project.id,
    tracked_prompt_id: prompt.id,
    platform: 'deepseek',
    question: '失败问题',
    brand: project.name,
    brand_keywords: project.name,
    status: 'failed',
    error_message: '监测平台调用失败，请稍后重试'
  });
  await ResultDetail.create({
    question_record_id: completed.id,
    ai_response_original: '广拓可以作为周界报警方案的候选。',
    parsing_status: 'completed'
  });
  await VisibilityMetric.create({
    project_id: project.id,
    prompt_id: prompt.id,
    question_record_id: completed.id,
    user_id: user.id,
    platform: 'deepseek',
    brand_mentioned: true,
    brand_mentions: 1,
    brand_rank: 1,
    brand_recommended: true,
    visibility_score: 80,
    share_of_voice: 55,
    citation_count: 1,
    owned_citation_count: 1,
    citation_sources: [{
      url: 'https://www.gato.com.cn/guide',
      domain: 'www.gato.com.cn',
      owned: true
    }],
    prompt_category: '购买决策',
    sentiment: 'positive'
  });

  const run = await QuestionSetRunService.createNativeRun({
    project,
    questionSet,
    user,
    runData: { record_ids: [completed.id, failed.id] }
  });
  const report = await QuestionSetRunService.getReport({ projectId: project.id, runId: run.id });

  assert.ok(await QuestionSetRun.findByPk(run.id));
  assert.equal(report.status, 'partial');
  assert.equal(report.summary.total, 2);
  assert.equal(report.summary.completed, 1);
  assert.equal(report.summary.failed, 1);
  assert.equal(report.summary.brand_mention_rate, 100);
  assert.equal(report.summary.owned_citation_rate, 100);
  assert.equal(report.summary.total_owned_citations, 1);
  assert.equal(report.rows.length, 2);
  assert.equal(report.rows[0].answer, '广拓可以作为周界报警方案的候选。');
  assert.equal(report.rows[0].owned_citation_count, 1);
  assert.deepEqual(report.rows[0].citation_sources, [{
    url: 'https://www.gato.com.cn/guide',
    domain: 'www.gato.com.cn',
    owned: true
  }]);
  assert.equal(report.rows[1].error_message, '监测平台调用失败，请稍后重试');

  await QuestionRecord.destroy({ where: { id: [completed.id, failed.id] } });
  const durableReport = await QuestionSetRunService.getReport({ projectId: project.id, runId: run.id });
  assert.equal(durableReport.rows.length, 2);
  assert.equal(durableReport.rows[0].answer, '广拓可以作为周界报警方案的候选。');
});

test('标准 CSV 导出后可以重新导入为内容等价的只读历史报告', async () => {
  const nativeRun = await QuestionSetRun.findOne({
    where: { project_id: project.id, source: 'native' },
    order: [['id', 'DESC']]
  });
  const original = await QuestionSetRunService.getReport({ projectId: project.id, runId: nativeRun.id });
  const csv = await QuestionSetRunService.exportCsv({ projectId: project.id, runId: nativeRun.id });

  assert.match(csv, /^\uFEFFschema_version,source_run_id,question_set_name,/);
  assert.match(csv, /question_set_run_v1/);
  assert.match(csv, /周界报警系统怎么选/);

  const imported = await QuestionSetRunService.importCsv({ project, user, csv });
  const restored = await QuestionSetRunService.getReport({ projectId: project.id, runId: imported.id });

  assert.equal(restored.source, 'imported');
  assert.equal(restored.question_set_name, original.question_set_name);
  assert.equal(restored.rows.length, original.rows.length);
  assert.equal(restored.rows[0].question, original.rows[0].question);
  assert.equal(restored.rows[0].answer, original.rows[0].answer);
  assert.deepEqual(restored.rows[0].citation_sources, original.rows[0].citation_sources);
  assert.equal(restored.summary.brand_mention_rate, original.summary.brand_mention_rate);
  assert.equal(restored.summary.owned_citation_rate, original.summary.owned_citation_rate);
  assert.equal(restored.summary.total_owned_citations, original.summary.total_owned_citations);
});

test('报告会纠正无竞品项目的历史排名并标记没有竞品基线', async () => {
  const imported = await QuestionSetRun.create({
    project_id: project.id,
    user_id: user.id,
    question_set_id: null,
    question_set_name: '校园周界厂家',
    source: 'imported',
    schema_version: 'question_set_run_v1',
    record_ids: [],
    imported_rows: [{
      record_id: null,
      question_id: null,
      question: '学校使用的非通电电子围栏，国内哪些厂家做得比较多？',
      question_category: '',
      platform: 'deepseek',
      platform_name: 'DeepSeek',
      model_name: 'deepseek-v4-flash',
      status: 'completed',
      error_message: '',
      answer: [
        '- **海康威视（Hikvision）**：周界产品线齐全。',
        '- **大华股份（Dahua）**：教育行业项目覆盖广。',
        '- **上海广拓（GATO）**：非通电张力式领域经验丰富。'
      ].join('\n'),
      has_metrics: true,
      brand_mentioned: true,
      brand_mentions: 1,
      brand_rank: 1,
      brand_recommended: false,
      share_of_voice: 100,
      citation_count: 0,
      owned_citation_count: 0,
      competitor_citation_count: 0,
      sentiment: 'positive',
      sentiment_reason: '',
      competitor_mentions: [],
      citation_sources: [],
      created_at: null,
      updated_at: null
    }],
    started_at: new Date('2026-07-23T00:00:00.000Z'),
    completed_at: new Date('2026-07-23T00:01:00.000Z')
  });

  const report = await QuestionSetRunService.getReport({
    projectId: project.id,
    runId: imported.id
  });

  assert.equal(report.rows[0].brand_rank, 3);
  assert.equal(report.summary.avg_brand_rank, 3);
  assert.equal(report.summary.competitor_baseline_count, 0);
});

test('报告汇总能够识别已配置的竞品基线', () => {
  const summary = QuestionSetRunService.summarize([{
    status: 'completed',
    has_metrics: true,
    brand_mentioned: true,
    brand_recommended: false,
    brand_rank: 2,
    share_of_voice: 40,
    citation_count: 0,
    competitor_mentions: [{ id: 12, name: '竞品甲', mentioned: true }]
  }]);

  assert.equal(summary.competitor_baseline_count, 1);
});

test('导入拒绝引用来源中的非网页协议', async () => {
  const nativeRun = await QuestionSetRun.findOne({
    where: { project_id: project.id, source: 'native' },
    order: [['id', 'DESC']]
  });
  const csv = await QuestionSetRunService.exportCsv({ projectId: project.id, runId: nativeRun.id });
  const unsafeCsv = csv.replace('https://www.gato.com.cn/guide', 'javascript:alert(1)');

  await assert.rejects(
    QuestionSetRunService.importCsv({ project, user, csv: unsafeCsv }),
    (error) => error?.code === 'INVALID_FIELD' && /citation_sources_json/.test(error.message)
  );
});

test('导入拒绝把同名问题集的不同运行拼成一份报告', async () => {
  const nativeRun = await QuestionSetRun.findOne({
    where: { project_id: project.id, source: 'native' },
    order: [['id', 'DESC']]
  });
  const csv = await QuestionSetRunService.exportCsv({ projectId: project.id, runId: nativeRun.id });
  const lines = csv.split('\n');
  lines[2] = lines[2].replace(
    `question_set_run_v1,${nativeRun.id},`,
    `question_set_run_v1,${nativeRun.id + 1000},`
  );

  await assert.rejects(
    QuestionSetRunService.importCsv({ project, user, csv: lines.join('\n') }),
    (error) => error?.code === 'MIXED_REPORTS'
  );
});

test('CSV 公式防护不会破坏原本以制表符开头的内容', () => {
  const report = {
    id: 99,
    question_set_name: '公式字符回导测试',
    started_at: new Date('2026-07-23T00:00:00.000Z'),
    completed_at: new Date('2026-07-23T00:01:00.000Z'),
    rows: [{
      record_id: 1,
      question_id: 2,
      question: '=SUM(1,1)',
      question_category: '',
      platform: 'deepseek',
      platform_name: 'DeepSeek',
      model_name: '',
      status: 'completed',
      error_message: '',
      answer: '\t=这不是公式',
      has_metrics: false,
      brand_mentioned: false,
      brand_mentions: 0,
      brand_rank: null,
      brand_recommended: false,
      share_of_voice: 0,
      citation_count: 0,
      sentiment: '',
      sentiment_reason: '',
      competitor_mentions: [],
      citation_sources: [],
      created_at: null,
      updated_at: null
    }]
  };

  const parsed = QuestionSetRunCsvService.parseCsv(QuestionSetRunCsvService.buildCsv(report));

  assert.equal(parsed.rows[0].question, '=SUM(1,1)');
  assert.equal(parsed.rows[0].answer, '\t=这不是公式');
});
