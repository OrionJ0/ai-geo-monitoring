const express = require('express');
const path = require('node:path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { createCorsOptionsDelegate } = require('./config/corsPolicy');
const { shouldSkipGeneralLimiter } = require('./config/apiRateLimitPolicy');
const { resolveServerHost } = require('./config/serverBinding');
const { configureTrustedProxy } = require('./config/trustedProxyPolicy');
const { readRuntimeRevision } = require('./config/runtimeRevision');

const app = express();
configureTrustedProxy(app);

// 中间件
// 同机 Next.js/Nginx 代理通过 TCP loopback 受信；外部跨域请求仍需显式白名单。
app.use(cors(createCorsOptionsDelegate()));

// 安全头
app.use(helmet({
  contentSecurityPolicy: false // 前端使用内联样式
}));

// 通用速率限制（排除公开接口）
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 500, // 限制500次请求
  message: '请求过于频繁，请稍后再试',
  skip: (req) => {
    // req.path 在挂载到 /api/ 后不包含 /api 前缀。
    const path = req.path || req.url || '';
    return shouldSkipGeneralLimiter(path);
  }
});

// schedules端点专用速率限制（更高限制）
const scheduleLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 1000, // 限制1000次请求
  message: '定时任务接口请求过于频繁，请稍后再试'
});

const marketingAuthorizationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'MARKETING_AUTHORIZATION_RATE_LIMITED',
      message: '营销授权请求过于频繁，请稍后再试'
    }
  }
});

app.use('/api/', limiter);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// 数据库连接与模型
const { sequelize, User, MembershipPlan, Setting, QuestionRecord } = require('./models');
const { DataTypes } = require('sequelize');

// 路由
const detectionRoutes = require('./routes/detection');
const userRoutes = require('./routes/user');
const statisticsRoutes = require('./routes/statistics');
const membershipRoutes = require('./routes/membership');
const settingsRoutes = require('./routes/settings');
const captchaRoutes = require('./routes/captcha');
const scheduleRoutes = require('./routes/schedules');
const geoProjectRoutes = require('./routes/geoProjects');
const seoAuditRoutes = require('./routes/seoAudits');
const adminAIPlatformRoutes = require('./routes/adminAIPlatforms');
const aiPlatformRoutes = require('./routes/aiPlatforms');
const SchedulerService = require('./services/SchedulerService');
const ProjectRunService = require('./services/ProjectRunService');
const WebPlatformRegistry = require('./services/WebPlatformRegistry');
const { createApplicationShutdown } = require('./services/ApplicationShutdownService');
const AIAnalysisExecutionCoordinator = require('./services/AIAnalysisExecutionCoordinator');
const { createSeoAuditJobService } = require('./services/SeoAuditJobService');
const AIPlatformConfigService = require('./services/AIPlatformConfigService');
const AIRuntimeSettingsService = require('./services/AIRuntimeSettingsService');
const GeoMetricSemanticsMigrationService = require('./services/GeoMetricSemanticsMigrationService');
const { authHeaderRequired, authRequired } = require('./middleware/auth');
const { createMarketingModule } = require('./modules/marketing');
const {
  createWebsiteFormConsultationModule
} = require('./modules/websiteFormConsultations');
const {
  createConsultationRecordModule
} = require('./modules/consultationRecords');

const marketingModule = createMarketingModule({
  env: process.env,
  sequelize
});
const websiteFormConsultationModule = createWebsiteFormConsultationModule({
  env: process.env,
  sequelize
});
const consultationRecordModule = createConsultationRecordModule({
  sequelize,
  websiteProjectId: websiteFormConsultationModule.configuredProjectId,
  websiteSourceClient: websiteFormConsultationModule.sourceClient
});

// 发布 revision 在进程启动时捕获。运行期间改写 marker 不能让旧进程
// 冒充新版本，systemd 启动验收因此能证明实际进程已经重启。
const RUNTIME_REVISION = readRuntimeRevision({
  filename: path.resolve(__dirname, '../.runtime/release-revision')
});

// 用户登录与公开用户接口保持在 /api/users 下（登录无需鉴权）
app.use('/api/users', userRoutes);
// 公开验证码接口（注册用）
app.use('/api/captcha', captchaRoutes);
// 需要登录的接口：检测、统计与业务配置
// detection 路由逐项鉴权；SSE 与普通请求一样仅接受 Authorization Header。
app.use('/api/detection', detectionRoutes);
app.use('/api/statistics', authRequired, statisticsRoutes);
app.use('/api/membership', authRequired, membershipRoutes);
// 定时任务接口（需要登录）
app.use('/api/schedules', scheduleLimiter, authRequired, scheduleRoutes);
app.use('/api/geo-projects', authRequired, geoProjectRoutes);
app.use('/api/seo-audits', authRequired, seoAuditRoutes);
app.use('/api/admin/ai-platforms', adminAIPlatformRoutes);
app.use('/api/ai-platforms', aiPlatformRoutes);
app.use('/api/website-data', authRequired, websiteFormConsultationModule.router);
app.use(
  '/api/consultations',
  authHeaderRequired,
  consultationRecordModule.router
);
app.use('/api/marketing', authRequired, marketingModule.router);
app.use(
  '/api/admin/marketing/baidu',
  marketingAuthorizationLimiter,
  marketingModule.authorizationRouter
);
// 设置路由：内部已对管理接口使用 adminRequired；公开接口（如 /seo、/notice）无需统一鉴权
app.use('/api/settings', settingsRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    revision: RUNTIME_REVISION
  });
});

app.get('/api/ready', (req, res) => {
  const database = typeof sequelize.getReadiness === 'function'
    ? sequelize.getReadiness()
    : { status: 'error', dialect: sequelize.getDialect(), last_error_code: 'database_readiness_unavailable' };
  const scheduler = {
    ...SchedulerService.getReadiness(),
    scheduled_executions: SchedulerService.getScheduledExecutionStats()
  };
  const ready = database.status === 'ready' && scheduler.started === true;
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    checks: {
      database,
      scheduler,
      last_error: database.last_error_code || scheduler.last_error_code || null
    },
    timestamp: new Date().toISOString()
  });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error(err.stack);
  const isDev = process.env.NODE_ENV === 'development';
  const isSafeCorsError = err.code === 'CORS_ORIGIN_DENIED';

  res.status(err.status || 500).json({
    success: false,
    message: isDev || isSafeCorsError ? err.message : '请求处理失败',
    ...(isDev && { stack: err.stack })
  });
});

// 404处理
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: '接口不存在'
  });
});

const PORT = process.env.PORT || 3000;
const HOST = resolveServerHost();
let server = null;
const shutdownApplication = createApplicationShutdown({
  getServer: () => server,
  schedulerService: SchedulerService,
  projectRunService: ProjectRunService,
  analysisExecutionCoordinator: AIAnalysisExecutionCoordinator,
  webPlatformRegistry: WebPlatformRegistry,
  marketingModule,
  sequelize
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    shutdownApplication(signal)
      .then(() => {
        process.exitCode = 0;
      })
      .catch((error) => {
        console.error('关闭服务失败:', error.message);
        process.exitCode = 1;
      });
  });
}

// 数据库同步并启动服务器
function isMissingTableError(error) {
  return /no such table|does not exist|no description found for .* table/i.test(
    String(error?.message || error)
  );
}

async function hasExistingDatabaseTables() {
  const tables = await sequelize.getQueryInterface().showAllTables();
  return Array.isArray(tables) && tables.length > 0;
}

async function ensureExistingTableProjectColumns() {
  const qi = sequelize.getQueryInterface();
  try {
    const desc = await qi.describeTable('question_records');
    if (!desc.project_id) {
      await qi.addColumn('question_records', 'project_id', { type: DataTypes.INTEGER, allowNull: true });
      console.log('已添加 question_records.project_id 列');
    }
    if (!desc.tracked_prompt_id) {
      await qi.addColumn('question_records', 'tracked_prompt_id', { type: DataTypes.INTEGER, allowNull: true });
      console.log('已添加 question_records.tracked_prompt_id 列');
    }
  } catch (e) {
    if (!isMissingTableError(e)) {
      console.warn('预检查 question_records 项目列失败:', e.message);
    }
  }

  try {
    const desc = await qi.describeTable('detection_schedules');
    if (!desc.project_id) {
      await qi.addColumn('detection_schedules', 'project_id', { type: DataTypes.INTEGER, allowNull: true });
      console.log('已添加 detection_schedules.project_id 列');
    }
    if (!desc.tracked_prompt_id) {
      await qi.addColumn('detection_schedules', 'tracked_prompt_id', { type: DataTypes.INTEGER, allowNull: true });
      console.log('已添加 detection_schedules.tracked_prompt_id 列');
    }
  } catch (e) {
    if (!isMissingTableError(e)) {
      console.warn('预检查 detection_schedules 项目列失败:', e.message);
    }
  }
}

async function ensureColumn(tableName, columnName, definition) {
  const qi = sequelize.getQueryInterface();
  try {
    const desc = await qi.describeTable(tableName);
    if (!desc[columnName]) {
      await qi.addColumn(tableName, columnName, definition);
      console.log(`已添加 ${tableName}.${columnName} 列`);
    }
  } catch (e) {
    if (!isMissingTableError(e)) {
      console.warn(`检查/添加 ${tableName}.${columnName} 列失败:`, e.message);
    }
  }
}

async function ensureStringColumnCapacity(tableName, columnName, minimumLength, definition = {}) {
  const qi = sequelize.getQueryInterface();
  try {
    const desc = await qi.describeTable(tableName);
    const currentLength = Number(String(desc[columnName]?.type || '').match(/\((\d+)\)/u)?.[1]);
    if (Number.isFinite(currentLength) && currentLength < minimumLength) {
      await qi.changeColumn(tableName, columnName, {
        type: DataTypes.STRING(minimumLength),
        ...definition
      });
      console.log(`已扩展 ${tableName}.${columnName} 至 ${minimumLength} 字符`);
    }
  } catch (e) {
    if (!isMissingTableError(e)) {
      console.warn(`检查/扩展 ${tableName}.${columnName} 失败:`, e.message);
    }
  }
}

async function ensureIndex(tableName, indexName, fields, options = {}) {
  const qi = sequelize.getQueryInterface();
  try {
    const indexes = await qi.showIndex(tableName);
    const expectedFields = fields.join(',');
    const exists = indexes.some((index) => {
      const sameIndex = index.name === indexName
        || index.fields
          .map((field) => field.attribute || field.name)
          .join(',') === expectedFields;
      const matchingUniqueness = options.unique !== true || index.unique === true;
      return sameIndex && matchingUniqueness;
    });
    if (!exists) {
      await qi.addIndex(tableName, fields, { name: indexName, ...options });
      console.log(`已添加 ${tableName}.${indexName} 索引`);
    }
  } catch (e) {
    if (!isMissingTableError(e)) {
      console.warn(`检查/添加 ${tableName}.${indexName} 索引失败:`, e.message);
    }
  }
}

async function ensureGeoMonitoringColumns() {
  await ensureColumn('brand_projects', 'monitoring_enabled', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await ensureColumn('brand_projects', 'monitoring_time', { type: DataTypes.STRING(5), allowNull: false, defaultValue: '09:00' });
  await ensureColumn('brand_projects', 'monitoring_last_run_at', { type: DataTypes.DATE, allowNull: true });
  await ensureColumn('brand_projects', 'monitoring_next_run_at', { type: DataTypes.DATE, allowNull: true });

  await ensureColumn('visibility_metrics', 'brand_rank', { type: DataTypes.INTEGER, allowNull: true });
  await ensureColumn('visibility_metrics', 'brand_recommended', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await ensureColumn('visibility_metrics', 'visibility_score', { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 });
  await ensureColumn('visibility_metrics', 'citation_count', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
  await ensureColumn('visibility_metrics', 'owned_citation_count', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
  await ensureColumn('visibility_metrics', 'competitor_citation_count', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
  await ensureColumn('visibility_metrics', 'citation_sources', { type: DataTypes.JSON, allowNull: false, defaultValue: [] });
  await ensureColumn('visibility_metrics', 'prompt_category', { type: DataTypes.STRING(80), allowNull: true });
  await ensureColumn('visibility_metrics', 'sentiment_reason', { type: DataTypes.STRING(120), allowNull: true });
  await ensureStringColumnCapacity(
    'visibility_metrics',
    'sentiment_reason',
    120,
    { allowNull: true }
  );
  await ensureColumn('visibility_metrics', 'sentiment_risk_terms', { type: DataTypes.JSON, allowNull: false, defaultValue: [] });
  await ensureColumn('visibility_metrics', 'analysis_method', {
    type: DataTypes.STRING(40),
    allowNull: false,
    defaultValue: 'legacy_rules_v1'
  });
  await ensureColumn('visibility_metrics', 'analysis_platform', { type: DataTypes.STRING(50), allowNull: true });
  await ensureColumn('visibility_metrics', 'analysis_model', { type: DataTypes.STRING(255), allowNull: true });
  await ensureColumn('visibility_metrics', 'analysis_evidence', { type: DataTypes.JSON, allowNull: false, defaultValue: {} });
  await ensureColumn('visibility_metrics', 'analysis_structure', { type: DataTypes.JSON, allowNull: false, defaultValue: {} });

  await ensureColumn('alert_rules', 'last_trigger_value', { type: DataTypes.FLOAT, allowNull: true });
  await ensureColumn('alert_rules', 'last_trigger_message', { type: DataTypes.TEXT, allowNull: true });
  await ensureColumn('question_set_runs', 'paused_at', { type: DataTypes.DATE, allowNull: true });
  await ensureColumn('question_set_runs', 'revision', {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  });
  await ensureColumn('result_details', 'provider_citations', {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: []
  });
  await ensureColumn('result_details', 'citation_analysis', {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {}
  });
  await ensureColumn('question_records', 'execution_token', {
    type: DataTypes.STRING(64),
    allowNull: true
  });
  await ensureColumn('question_records', 'execution_started_at', {
    type: DataTypes.DATE,
    allowNull: true
  });
  await ensureColumn('question_records', 'scheduled_execution_id', {
    type: DataTypes.INTEGER,
    allowNull: true
  });
  await ensureIndex(
    'question_records',
    'question_records_scheduled_execution_id',
    ['scheduled_execution_id']
  );
  await ensureColumn('question_records', 'question_set_run_id', {
    type: DataTypes.INTEGER,
    allowNull: true
  });
  await ensureColumn('question_records', 'run_slot_index', {
    type: DataTypes.INTEGER,
    allowNull: true
  });
  await ensureColumn('question_records', 'execution_mode', {
    type: DataTypes.STRING(24),
    allowNull: false,
    defaultValue: 'full_monitoring'
  });
  await ensureColumn('question_records', 'retry_batch_id', {
    type: DataTypes.INTEGER,
    allowNull: true
  });
  await ensureColumn('question_records', 'lease_owner', {
    type: DataTypes.STRING(120),
    allowNull: true
  });
  await ensureColumn('question_records', 'lease_expires_at', {
    type: DataTypes.DATE,
    allowNull: true
  });
  await ensureColumn('question_set_runs', 'planned_record_count', {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  });
  await ensureColumn('question_set_runs', 'integrity_status', {
    type: DataTypes.STRING(32),
    allowNull: false,
    defaultValue: 'complete'
  });
  await ensureColumn('question_set_runs', 'integrity_missing_record_count', {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  });
  await ensureColumn('question_set_runs', 'integrity_error_code', {
    type: DataTypes.STRING(80),
    allowNull: true
  });
  await ensureColumn('question_set_runs', 'idempotency_key_hash', {
    type: DataTypes.STRING(64),
    allowNull: true
  });
  await ensureColumn('question_set_runs', 'request_fingerprint', {
    type: DataTypes.STRING(64),
    allowNull: true
  });
  await ensureColumn('question_set_runs', 'planned_platforms', {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: []
  });
  await ensureColumn('question_set_runs', 'skipped_platforms', {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: []
  });
  await ensureColumn('question_set_runs', 'competitor_snapshot', {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: []
  });
  await ensureColumn('question_set_runs', 'analysis_contract_version', {
    type: DataTypes.STRING(40),
    allowNull: true
  });
  await ensureIndex(
    'question_set_runs',
    'question_set_runs_idempotency_unique',
    ['user_id', 'project_id', 'idempotency_key_hash'],
    { unique: true }
  );
  await ensureIndex(
    'question_records',
    'question_records_run_slot_unique',
    ['question_set_run_id', 'run_slot_index'],
    { unique: true }
  );
  await ensureIndex(
    'question_records',
    'question_records_run_status',
    ['question_set_run_id', 'status']
  );
  await ensureIndex(
    'question_records',
    'question_records_lease_status',
    ['lease_expires_at', 'status']
  );
  await ensureIndex(
    'question_records',
    'question_records_retry_batch_id',
    ['retry_batch_id']
  );
}

async function ensureDynamicPlatformColumns() {
  const qi = sequelize.getQueryInterface();
  const questionRecordDescription = await qi.describeTable('question_records');
  if (!questionRecordDescription.platform_name) {
    await qi.addColumn('question_records', 'platform_name', { type: DataTypes.STRING(100), allowNull: true });
    console.log('已添加 question_records.platform_name 列');
  }
  if (!questionRecordDescription.model_name) {
    await qi.addColumn('question_records', 'model_name', { type: DataTypes.STRING(255), allowNull: true });
    console.log('已添加 question_records.model_name 列');
  }

  await ensureColumn('ai_platform_configs', 'request_options', {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {}
  });
  await ensureColumn('ai_platform_configs', 'web_search_test_status', {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'untested'
  });
  await ensureColumn('ai_platform_configs', 'last_web_search_tested_at', {
    type: DataTypes.DATE,
    allowNull: true
  });
  await ensureColumn('ai_platform_configs', 'last_web_search_test_error_code', {
    type: DataTypes.STRING(50),
    allowNull: true
  });
  await ensureColumn('ai_platform_configs', 'last_web_search_test_message', {
    type: DataTypes.STRING(255),
    allowNull: true
  });

  if (sequelize.getDialect() === 'postgres') {
    for (const tableName of ['question_records', 'visibility_metrics']) {
      const description = await qi.describeTable(tableName);
      const platformColumn = description?.platform || {};
      const isEnumColumn = /enum/i.test(String(platformColumn.type || ''))
        || (Array.isArray(platformColumn.special) && platformColumn.special.length > 0);
      if (isEnumColumn) {
        await sequelize.query(`ALTER TABLE "${tableName}" ALTER COLUMN "platform" TYPE VARCHAR(50) USING "platform"::text`);
        console.log(`已将 ${tableName}.platform 转换为动态平台字符串列`);
      }
    }
  }
}

// 确保存在演示用户（不占用 id=1），并修复明文密码
async function ensureDefaultUser() {
  if (
    process.env.NODE_ENV === 'production'
    || process.env.DEMO_USER_ENABLED !== 'true'
  ) return;
  try {
    const passwordRaw = String(process.env.DEMO_USER_PASSWORD || '');
    if (passwordRaw.length < 16) {
      throw new Error('DEMO_USER_PASSWORD 必须至少 16 个字符');
    }
    const existing = await User.findOne({ where: { username: 'demo' } });
    if (!existing) {
      const hashed = await bcrypt.hash(passwordRaw, 10);
      const user = await User.create({
        username: 'demo',
        email: 'demo@example.com',
        password: hashed,
        role: 'user',
        status: 'active'
      });
      console.log(`已创建演示用户: id=${user.id}, username=demo`);
    } else {
      // 若历史上使用了明文密码，进行修复（bcrypt 哈希以 $2 开头）
      const isHashed = typeof existing.password === 'string' && existing.password.startsWith('$2');
      if (!isHashed) {
        const hashed = await bcrypt.hash(passwordRaw, 10);
        await existing.update({ password: hashed });
        console.log('已修复演示用户密码为安全哈希');
      }
    }
  } catch (e) {
    console.warn('创建/修复演示用户失败:', e.message);
  }
}

// 确保存在管理员账户且 id=1 为管理员；必要时创建或提升
async function ensureDefaultAdmin() {
  if (process.env.DEFAULT_ADMIN_BOOTSTRAP_ENABLED !== 'true') return;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('生产环境禁止启动期管理员 bootstrap');
  }
  try {
    const username = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
    const email = process.env.DEFAULT_ADMIN_EMAIL || 'admin@example.com';
    const passwordRaw = String(process.env.DEFAULT_ADMIN_PASSWORD || '');
    if (
      passwordRaw.length < 16
      || ['admin123456', 'password', 'changeme'].includes(
        passwordRaw.toLocaleLowerCase('en-US')
      )
    ) {
      throw new Error('DEFAULT_ADMIN_PASSWORD 必须是非示例强密码');
    }
    const hashed = await bcrypt.hash(passwordRaw, 10);

    const user1 = await User.findByPk(1);
    if (!user1) {
      // 不存在 id=1，则创建管理员占用 id=1
      const admin = await User.create({
        id: 1,
        username,
        email,
        password: hashed,
        role: 'admin',
        membership_level: 'enterprise',
        status: 'active'
      });
      console.log('已创建默认管理员: id=1');
      return;
    }

    // 启动期 bootstrap 只允许首次创建，绝不重新提权、激活或改写既有身份。
    console.log('id=1 用户已存在，跳过管理员 bootstrap');
  } catch (e) {
    throw new Error(`管理员 bootstrap 失败: ${e.message}`);
  }
}


// 确保存在默认会员配额方案
async function ensureDefaultPlans() {
  try {
    const defaults = [
      { level: 'free', detection_daily_limit: 10 },
      { level: 'pro', detection_daily_limit: 100 },
      { level: 'enterprise', detection_daily_limit: 1000 }
    ];
    for (const plan of defaults) {
      const existing = await MembershipPlan.findOne({ where: { level: plan.level } });
      if (!existing) {
        await MembershipPlan.create(plan);
        console.log(`已创建默认会员方案: ${plan.level}`);
      }
    }
  } catch (e) {
    console.warn('创建默认会员方案失败:', e.message);
  }
}

// 确保存在默认设置项
async function ensureDefaultSettings() {
  try {
    const defaults = [
      { key: 'default_membership_level', value: process.env.DEFAULT_MEMBERSHIP_LEVEL || 'free' },
      { key: 'quota_low_threshold', value: '0.2' },
      { key: 'system_notice', value: '' },
      { key: 'seo_title', value: '' },
      { key: 'seo_description', value: '' },
      { key: 'seo_keywords', value: '' },
      { key: 'seo_robots', value: 'index,follow' }
    ];
    for (const s of defaults) {
      const existing = await Setting.findOne({ where: { key: s.key } });
      if (!existing) {
        await Setting.create(s);
        console.log(`已创建默认设置: ${s.key}=${s.value}`);
      }
    }
  } catch (e) {
    console.warn('创建默认设置失败:', e.message);
  }
}

(async () => {
  try {
    if (await hasExistingDatabaseTables()) {
      // 指标版本迁移必须由备份保护的显式迁移入口完成，应用启动不得隐式改写历史口径。
      await GeoMetricSemanticsMigrationService.assertRuntimeReady({ sequelize });
      await ensureExistingTableProjectColumns();
      // 旧库上的模型索引可能引用本版本新增列；必须先补列，再让 Sequelize 同步索引。
      await ensureGeoMonitoringColumns();
    }
    await sequelize.sync();
    // 新库在 sync 前还没有表；再次校验可同时覆盖全新安装与旧库升级。
    await ensureGeoMonitoringColumns();
    await ensureDynamicPlatformColumns();
    // 确保 users 表存在会员到期列
    try {
      const qi = sequelize.getQueryInterface();
      const brandProjectDesc = await qi.describeTable('brand_projects');
      if (!brandProjectDesc.platforms) {
        await qi.addColumn('brand_projects', 'platforms', { type: DataTypes.JSON, allowNull: true });
        console.log('已添加 brand_projects.platforms 列');
      }
    } catch (e) {
      console.warn('检查/添加 brand_projects.platforms 列失败:', e.message);
    }
    try {
      const qi = sequelize.getQueryInterface();
      const desc = await qi.describeTable('users');
      if (!desc.membership_expires_at) {
        await qi.addColumn('users', 'membership_expires_at', { type: DataTypes.DATE, allowNull: true });
        console.log('已添加 users.membership_expires_at 列');
      }
    } catch (e) {
      console.warn('检查/添加 users.membership_expires_at 列失败:', e.message);
    }
    try {
      const qi = sequelize.getQueryInterface();
      const desc = await qi.describeTable('question_records');
      if (!desc.project_id) {
        await qi.addColumn('question_records', 'project_id', { type: DataTypes.INTEGER, allowNull: true });
        console.log('已添加 question_records.project_id 列');
      }
      if (!desc.tracked_prompt_id) {
        await qi.addColumn('question_records', 'tracked_prompt_id', { type: DataTypes.INTEGER, allowNull: true });
        console.log('已添加 question_records.tracked_prompt_id 列');
      }
    } catch (e) {
      console.warn('检查/添加 question_records 项目列失败:', e.message);
    }
    try {
      const qi = sequelize.getQueryInterface();
      const desc = await qi.describeTable('detection_schedules');
      if (!desc.project_id) {
        await qi.addColumn('detection_schedules', 'project_id', { type: DataTypes.INTEGER, allowNull: true });
        console.log('已添加 detection_schedules.project_id 列');
      }
      if (!desc.tracked_prompt_id) {
        await qi.addColumn('detection_schedules', 'tracked_prompt_id', { type: DataTypes.INTEGER, allowNull: true });
        console.log('已添加 detection_schedules.tracked_prompt_id 列');
      }
    } catch (e) {
      console.warn('检查/添加 detection_schedules 项目列失败:', e.message);
    }
    console.log('数据库连接成功');
    // 先确保管理员 id=1
    await ensureDefaultAdmin();
    // 再创建演示用户（避免占用 id=1）
    await ensureDefaultUser();
    await ensureDefaultPlans();
    await ensureDefaultSettings();
    await AIRuntimeSettingsService.ensureDefaults();
    await AIPlatformConfigService.ensurePresets();
    try {
      const reconciledWebCaptures = await WebPlatformRegistry
        .reconcileCaptureStores({
          recordExists: async (recordId) => Boolean(await QuestionRecord.findByPk(
            recordId,
            { attributes: ['id'], raw: true }
          ))
        });
      if (reconciledWebCaptures.total > 0) {
        console.log(`已恢复或清理 ${reconciledWebCaptures.total} 个隔离 Web 证据目录`);
      }
    } catch (e) {
      console.warn('恢复或清理隔离 Web 证据失败:', e.message);
    }
    try {
      const recoveredSeoAudits = await createSeoAuditJobService().recoverInterruptedJobs();
      if (recoveredSeoAudits > 0) console.log(`已恢复 ${recoveredSeoAudits} 个全站 SEO 检测任务`);
    } catch (e) {
      console.warn('恢复全站 SEO 检测任务失败:', e.message);
    }
    // 启动定时调度器
    try {
      await SchedulerService.start();
      console.log('定时调度器已启动');
    } catch (e) {
      console.warn('启动调度器失败:', e.message);
    }
    const marketingStatus = await marketingModule.start();
    if (marketingStatus.moduleState !== 'DISABLED') {
      console.log(`营销模块状态: ${marketingStatus.moduleState}`);
    }
    server = app.listen(PORT, HOST, () => {
      console.log(`服务器运行在 http://${HOST}:${PORT}`);
      console.log(`健康检查: http://${HOST}:${PORT}/api/health`);
    });
  } catch (err) {
    console.error('数据库连接失败:', err);
    process.exit(1);
  }
})();

module.exports = app;
