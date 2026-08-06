const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const analysisPath = path.resolve(__dirname, '../evaluation/AIResponseAnalysisV4BaselineService.js');
const runPath = path.resolve(__dirname, '../services/ProjectRunService.js');
const schedulerPath = path.resolve(__dirname, '../services/SchedulerService.js');
const v5Path = path.resolve(__dirname, '../services/AIResponseAnalysisV5Service.js');
const entityPath = path.resolve(__dirname, '../services/AIResponseEntityExtractionService.js');
const settingsPath = path.resolve(__dirname, '../routes/settings.js');

test('010 硬切：默认分析 provider 为 v5，分派点只有 v5 分析器（无 v4/Pro fallback）', () => {
  const runSource = fs.readFileSync(runPath, 'utf8');

  assert.match(runSource, /await AIResponseAnalysisV5Service\.analyze/);
  assert.doesNotMatch(runSource, /AIResponseAnalysisService|analysisProvider/);
  // 注：裸 fallback 会误匹配合法的 fallbackSnapshot（快照回退）参数名，
  // 这里只检查 v4/Pro 运行时回退与隐藏规则路径。
  assert.doesNotMatch(runSource, /回退到旧|legacy_rules_v1|deepseek-v4-pro/iu);
});

test('010 硬切：SchedulerService 只有 v5 契约且没有可选 provider 分支', () => {
  const source = fs.readFileSync(schedulerPath, 'utf8');

  assert.match(source, /analysis_contract_version:\s*V5_ANALYSIS_CONTRACT/);
  assert.doesNotMatch(source, /analysisProvider|\|\| 'v4'/);
});

test('010 硬切：v4 基线已移出生产 services，冻结在 evaluation 目录只供评测', () => {
  const source = fs.readFileSync(analysisPath, 'utf8');

  assert.match(source, /已退役/);
  assert.match(source, /ANALYSIS_METHOD = 'ai_structured_v4'/);
  assert.match(source, /STRUCTURE_VERSION = 'geo_metric_input_v4'/);
  assert.match(source, /contextual_competitor_mentions_sov_v1/);
  assert.doesNotMatch(source, /CURRENT_ANALYSIS_CONTRACT|CURRENT_STRUCTURE_VERSION|CURRENT_METRIC_SEMANTICS/);
  assert.doesNotMatch(source, /module\.exports\s*=\s*service/u);
});

test('010 硬切：生产模块不得依赖 evaluation 目录', () => {
  const productionRoots = ['app.js', 'routes', 'services', 'middleware'];
  const files = productionRoots.flatMap((entry) => {
    const absolute = path.resolve(__dirname, '..', entry);
    if (!fs.existsSync(absolute)) return [];
    if (fs.statSync(absolute).isFile()) return [absolute];
    return fs.readdirSync(absolute, { recursive: true })
      .filter((name) => /\.js$/u.test(name))
      .map((name) => path.join(absolute, name));
  });
  const offenders = files.filter((filename) => (
    /(?:require\(|from\s+)['"][^'"]*evaluation\//u.test(fs.readFileSync(filename, 'utf8'))
  ));
  assert.deepEqual(offenders, []);
});

test('010 硬切：生产 services 目录不存在可执行 v4 单体', () => {
  assert.equal(fs.existsSync(path.resolve(__dirname, '../services/AIResponseAnalysisService.js')), false);
});

test('010 硬切：设置页测试端点不再引用 v4 运行时', () => {
  const source = fs.readFileSync(settingsPath, 'utf8');

  assert.doesNotMatch(source, /AIResponseAnalysisService/);
  assert.match(source, /AIResponseAnalysisV5Service\.analyze/);
});

test('010 硬切：v5 分析器强制 deepseek-v4-flash（assertFlashPlatform），无 Pro/隐藏备用', () => {
  const v5Source = fs.readFileSync(v5Path, 'utf8');
  const entitySource = fs.readFileSync(entityPath, 'utf8');

  assert.match(entitySource, /deepseek-v4-flash/);
  assert.match(entitySource, /analysis_model_policy_mismatch/);
  assert.doesNotMatch(v5Source, /deepseek-v4-pro|gpt|claude|gemini/iu);
  assert.doesNotMatch(v5Source, /fallback|回退到旧/iu);
});

test('010 硬切：正式记录固定写入 v5 契约且旧标量保持空值', () => {
  const source = fs.readFileSync(runPath, 'utf8');

  assert.match(source, /analysis_contract_version:\s*CURRENT_ANALYSIS_CONTRACT/);
  assert.match(source, /metric_semantics_version:\s*CURRENT_METRIC_SEMANTICS/);
  assert.doesNotMatch(source, /ai_structured_v2|geo_metric_input_v2|legacy_rules_v1/);
});
