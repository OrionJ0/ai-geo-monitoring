const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const analysisPath = path.resolve(__dirname, '../services/AIResponseAnalysisService.js');
const metricsPath = path.resolve(__dirname, '../services/ProjectMetricsService.js');
const runPath = path.resolve(__dirname, '../services/ProjectRunService.js');

test('正式分析器只有 v4 完整输入路径且没有旧版、名单或截断回退', () => {
  const source = fs.readFileSync(analysisPath, 'utf8');

  assert.match(source, /CURRENT_ANALYSIS_CONTRACT/);
  assert.match(source, /CURRENT_STRUCTURE_VERSION/);
  assert.doesNotMatch(source, /ai_structured_v[23]|geo_metric_input_v[23]|slice\(0,\s*12000\)|competitor_matches|competitorHints|competitor_hints/);
  assert.doesNotMatch(source, /fallback|回退到旧|legacy_rules_v1/iu);
});

test('项目指标服务删除无生产调用的旧 SOV 聚合器', () => {
  const source = fs.readFileSync(metricsPath, 'utf8');

  assert.doesNotMatch(source, /\n\s*summarize\(metrics\)/);
  assert.doesNotMatch(source, /\n\s*buildDashboardSummary\(/);
  assert.doesNotMatch(source, /\n\s*buildPromptCoverage\(/);
  assert.doesNotMatch(source, /\n\s*buildPromptPerformance\(/);
  assert.doesNotMatch(source, /\n\s*buildTrend\(/);
  assert.doesNotMatch(source, /avg_share_of_voice|visibility_score/);
});

test('正式记录生成固定写入新版版本且旧标量保持空值', () => {
  const source = fs.readFileSync(runPath, 'utf8');

  assert.match(source, /analysis_contract_version:\s*CURRENT_ANALYSIS_CONTRACT/);
  assert.match(source, /metric_semantics_version:\s*CURRENT_METRIC_SEMANTICS/);
  assert.match(source, /share_of_voice:\s*null/);
  assert.match(source, /competitor_mentions:\s*\[\]/);
  assert.doesNotMatch(source, /ai_structured_v2|geo_metric_input_v2|legacy_rules_v1/);
});
