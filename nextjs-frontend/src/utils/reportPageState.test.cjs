/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../app/geo/reports/page.tsx'), 'utf8');

test('report page guards async report requests from stale project or period responses', () => {
  assert.match(source, /useRef/);
  assert.match(source, /const reportRequestRef = useRef\(0\)/);
  assert.match(source, /const invalidateReportRequest = \(\) =>/);
  assert.match(source, /reportRequestRef\.current \+= 1/);
  assert.match(source, /const handleProjectChange = \(value\) =>/);
  assert.match(source, /const handleDaysChange = \(value\) =>/);
  assert.match(source, /const \[platform, setPlatform\] = useState\('all'\)/);
  assert.match(source, /const handlePlatformChange = \(value\) =>/);
  assert.match(source, /onChange=\{handleProjectChange\}/);
  assert.match(source, /onChange=\{handleDaysChange\}/);
  assert.match(source, /onChange=\{handlePlatformChange\}/);
  assert.match(source, /const requestId = reportRequestRef\.current \+ 1/);
  assert.match(source, /reportRequestRef\.current = requestId/);
  assert.match(source, /if \(!targetProjectId\) \{[\s\S]*setReport\(null\);[\s\S]*setReportLoading\(false\);[\s\S]*return;/);
  assert.match(source, /setReport\(null\)[\s\S]*setReportLoading\(true\)/);
  assert.match(source, /if \(reportRequestRef\.current === requestId\) \{[\s\S]*setPlatform\('all'\);[\s\S]*setReport\(res\?\.data\?\.data \|\| null\);[\s\S]*\}/);
  assert.match(source, /if \(reportRequestRef\.current === requestId\) setReportLoading\(false\)/);
});

test('新版项目报告从不可变快照切换全部和单平台核心视图', () => {
  assert.match(source, /metric_semantics_version/);
  assert.match(source, /metric_views/);
  assert.match(source, /available_platforms/);
  assert.match(source, /全部平台（合并）/);
  assert.match(source, /回答内竞品提及占比（SOV）/);
  assert.match(source, /sov_summary/);
  assert.match(source, /analysis_coverage_rate/);
  assert.match(source, /N\/A/);
  assert.doesNotMatch(source, /params:\s*\{\s*days:\s*targetDays,\s*platform/);
  assert.doesNotMatch(source, /summary\.avg_share_of_voice/);
});

test('报告明确新旧口径和趋势问题集合使用规范', () => {
  assert.match(source, /历史竞品配置口径/);
  assert.match(source, /非品牌词问题/);
  assert.match(source, /问题集合/);
  assert.match(source, /新的比较基线/);
});

test('report competitor table shows visibility score context', () => {
  assert.match(source, /title:\s*'可见度得分'/);
  assert.match(source, /dataIndex:\s*'visibility_score'/);
});
