const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routeSource = fs.readFileSync(path.resolve(__dirname, '../routes/geoProjects.js'), 'utf8');

function routeBlock(method, pathPattern) {
  const start = routeSource.indexOf(`router.${method}('${pathPattern}'`);
  assert.notEqual(start, -1, `route ${method} ${pathPattern} should exist`);
  const next = routeSource.indexOf('\nrouter.', start + 1);
  return next === -1 ? routeSource.slice(start) : routeSource.slice(start, next);
}

test('geo project route imports report snapshots used by cleanup helpers', () => {
  const modelsImportBlock = routeSource.slice(
    routeSource.indexOf("const {"),
    routeSource.indexOf("} = require('../models');") + "} = require('../models');".length
  );

  assert.match(modelsImportBlock, /\bReportSnapshot\b/);
  assert.match(routeSource, /PromptAnalysisCleanupService\.deleteForPrompts[\s\S]*ReportSnapshot/);
  assert.match(routeSource, /PromptAnalysisCleanupService\.deleteForProject[\s\S]*ReportSnapshot/);
  assert.match(routeSource, /ReportSnapshot\.destroy\(/);
});

test('project creation validates supported platforms without requiring an existing project', () => {
  const block = routeBlock('post', '/');

  assert.match(block, /PlatformSelectionService\.validate\(req\.body\.platforms,\s*\{[\s\S]*availablePlatforms:\s*selectablePlatforms/);
  assert.match(block, /await getSelectablePlatformCodes\(\)/);
  assert.doesNotMatch(block, /validateWithinProject\(req\.body\.platforms/);
});

test('prompt create and update validate platforms within the selected project', () => {
  const createBlock = routeBlock('post', '/:projectId/prompts');
  const updateBlock = routeBlock('put', '/:projectId/prompts/:promptId');

  assert.match(createBlock, /validateWithinProject\([\s\S]*req\.body\.platforms,[\s\S]*req\.brandProject\.platforms,[\s\S]*selectablePlatforms/);
  assert.match(updateBlock, /validateWithinProject\([\s\S]*req\.body\.platforms,[\s\S]*req\.brandProject\.platforms,[\s\S]*selectablePlatforms/);
});

test('restoring an archived project checks duplicate active project identity first', () => {
  const block = routeBlock('put', '/:id');

  assert.match(block, /restoreRequested/);
  assert.match(block, /findDuplicateProject\(/);
  assert.match(block, /findDuplicateProjectWebsite\(/);
});

test('project semantic updates clear old project analysis data', () => {
  const block = routeBlock('put', '/:id');

  assert.match(block, /projectAnalysisFieldsChanged/);
  assert.match(block, /payload\.name/);
  assert.match(block, /payload\.aliases/);
  assert.match(block, /payload\.website/);
  assert.match(block, /payload\.industry/);
  assert.match(block, /payload\.primary_keywords/);
  assert.match(block, /payload\.platforms/);
  assert.match(block, /await deleteProjectAnalysisData\(req\.brandProject\.id\)/);
});

test('project delete route supports explicit permanent deletion for archived projects', () => {
  const block = routeBlock('delete', '/:id');

  assert.match(block, /permanent/);
  assert.match(block, /ProjectDeletionService\.deleteArchivedProject\(req\.brandProject\)/);
  assert.match(block, /品牌项目已删除/);
  assert.match(block, /ProjectArchiveService\.archiveProject\(req\.brandProject\)/);
});

test('project platform updates reconcile existing prompt platform selections', () => {
  const block = routeBlock('put', '/:id');

  assert.match(block, /if \(platformResult\)/);
  assert.match(block, /TrackedPrompt\.findAll\(\{[\s\S]*where:\s*\{\s*project_id:\s*req\.brandProject\.id\s*\}[\s\S]*attributes:\s*\[\s*'id',\s*'platforms'\s*\]/);
  assert.match(block, /PlatformSelectionService\.reconcilePromptPlatforms\(prompt\.platforms,\s*platformResult\.platforms\)/);
  assert.match(block, /prompt\.update\(\{[\s\S]*platforms:/);
});

test('project and competitor routes reject non-empty invalid website input', () => {
  const createProject = routeBlock('post', '/');
  const updateProject = routeBlock('put', '/:id');
  const createCompetitor = routeBlock('post', '/:projectId/competitors');
  const updateCompetitor = routeBlock('put', '/:projectId/competitors/:competitorId');

  [createProject, updateProject, createCompetitor, updateCompetitor].forEach((block) => {
    assert.match(block, /rejectInvalidWebsiteInput\(req,\s*res\)/);
  });
  assert.match(routeSource, /官网格式不正确/);
});

test('read routes return safe json errors instead of falling through express defaults', () => {
  const detailBlock = routeBlock('get', '/:id');
  const alertsBlock = routeBlock('get', '/:projectId/alerts');

  assert.match(detailBlock, /try\s*\{/);
  assert.match(detailBlock, /message: '获取品牌项目失败'/);
  assert.match(alertsBlock, /try\s*\{/);
  assert.match(alertsBlock, /message: '获取告警规则失败'/);
});

test('competitor mutations clear stale project analysis data', () => {
  const createBlock = routeBlock('post', '/:projectId/competitors');
  const updateBlock = routeBlock('put', '/:projectId/competitors/:competitorId');
  const deleteBlock = routeBlock('delete', '/:projectId/competitors/:competitorId');

  assert.match(createBlock, /await deleteProjectAnalysisData\(req\.brandProject\.id\)/);
  assert.match(updateBlock, /await deleteProjectAnalysisData\(req\.brandProject\.id\)/);
  assert.match(deleteBlock, /if \(deleted\) await deleteProjectAnalysisData\(req\.brandProject\.id\)/);
});

test('prompt semantic updates clear old prompt analysis data', () => {
  const updateBlock = routeBlock('put', '/:projectId/prompts/:promptId');

  assert.match(updateBlock, /analysisFieldsChanged/);
  assert.match(updateBlock, /payload\.question/);
  assert.match(updateBlock, /payload\.tags/);
  assert.match(updateBlock, /payload\.platforms/);
  assert.match(updateBlock, /await deletePromptAnalysisData\(req\.brandProject\.id,\s*\[prompt\.id\]\)/);
});

test('prompt inventory changes invalidate generated report snapshots', () => {
  const createBlock = routeBlock('post', '/:projectId/prompts');
  const updateBlock = routeBlock('put', '/:projectId/prompts/:promptId');

  assert.match(createBlock, /await invalidateGeneratedReports\(req\.brandProject\.id\)/);
  assert.match(updateBlock, /promptVisibilityChanged/);
  assert.match(updateBlock, /else if \(promptVisibilityChanged\) await invalidateGeneratedReports\(req\.brandProject\.id\)/);
});

test('manual runs are exposed only for questions and question sets', () => {
  assert.doesNotMatch(routeSource, /router\.post\('\/:projectId\/run'/);
  const promptRunBlock = routeBlock('post', '/:projectId/prompts/:promptId/run');

  assert.match(promptRunBlock, /ProjectRunService\.startQuestionSetRun/);
  assert.match(promptRunBlock, /readRequiredIdempotencyKey\(req\)/);
  assert.match(promptRunBlock, /idempotencyKey:\s*idempotency\.value/);
  assert.doesNotMatch(promptRunBlock, /ProjectRunService\.runProject/);
});

test('prompt suggestion generation requests only prompt-generation capable platforms', () => {
  const block = routeBlock('post', '/:projectId/prompts/generate');

  assert.match(block, /getPlatformAvailability\([\s\S]*capability:\s*'prompt_generation'/);
  assert.match(block, /queryPlatform\([\s\S]*purpose:\s*'prompt_generation'/);
});

test('question-set runs use only the atomic idempotent start entry', () => {
  const block = routeBlock('post', '/:projectId/question-sets/:questionSetId/run');

  assert.match(block, /ProjectRunService\.startQuestionSetRun/);
  assert.match(block, /readRequiredIdempotencyKey\(req\)/);
  assert.match(block, /idempotencyKey:\s*idempotency\.value/);
  assert.doesNotMatch(block, /QuestionSetRunService\.createNativeRun/);
  assert.doesNotMatch(block, /ProjectRunService\.enqueueProjectRun/);
  assert.doesNotMatch(block, /questionSetRun\.destroy/);
});

test('source analytics route loads prompt text and tags for category normalization', () => {
  const block = routeBlock('get', '/:projectId/sources');

  assert.match(block, /attributes:\s*\[[\s\S]*'id'[\s\S]*'question'[\s\S]*'tags'[\s\S]*'platforms'[\s\S]*'enabled'[\s\S]*\]/);
});

test('prompt list returns derived prompt categories for filtering', () => {
  const block = routeBlock('get', '/:projectId/prompts');

  assert.match(block, /category:\s*ProjectRunService\.derivePromptCategory\((row|prompt)\)/);
});

test('prompt list and prompt history preserve actual historical platforms after project configuration changes', () => {
  const promptListBlock = routeBlock('get', '/:projectId/prompts');
  const promptHistoryBlock = routeBlock('get', '/:projectId/prompts/:promptId/history');

  assert.doesNotMatch(promptListBlock, /const projectPlatforms = cleanPlatforms\(req\.brandProject\.platforms\)/);
  assert.doesNotMatch(promptListBlock, /platform:\s*\{\s*\[Op\.in\]/);
  assert.doesNotMatch(promptHistoryBlock, /const projectPlatforms = cleanPlatforms\(req\.brandProject\.platforms\)/);
  assert.doesNotMatch(promptHistoryBlock, /platform:\s*\{\s*\[Op\.in\]/);
});

test('dashboard and source analytics read current semantics across actual historical platforms', () => {
  const dashboardBlock = routeBlock('get', '/:projectId/dashboard');
  const sourcesBlock = routeBlock('get', '/:projectId/sources');

  assert.doesNotMatch(dashboardBlock, /const projectPlatforms = cleanPlatforms\(req\.brandProject\.platforms\)/);
  assert.doesNotMatch(dashboardBlock, /platform:\s*\{\s*\[Op\.in\]/);
  assert.match(dashboardBlock, /metric_semantics_version:\s*CURRENT_METRIC_SEMANTICS/);
  assert.match(dashboardBlock, /selected_platform/);
  assert.match(dashboardBlock, /available_platforms/);
  assert.match(dashboardBlock, /INVALID_PLATFORM_FILTER/);
  assert.doesNotMatch(sourcesBlock, /const projectPlatforms = cleanPlatforms\(req\.brandProject\.platforms\)/);
  assert.doesNotMatch(sourcesBlock, /platform:\s*\{\s*\[Op\.in\]/);
});

test('dashboard recent metrics include prompt question context for review', () => {
  const dashboardBlock = routeBlock('get', '/:projectId/dashboard');

  assert.match(dashboardBlock, /QuestionRecord,\s*as:\s*'questionRecord'/);
  assert.match(dashboardBlock, /TrackedPrompt,\s*as:\s*'prompt'/);
  assert.match(dashboardBlock, /attributes:\s*\[\s*'id',\s*'question'\s*\]/);
  assert.match(dashboardBlock, /CitationMetricSemanticsService\.normalizeForRead/);
});

test('prompt history sanitizes legacy mixed citation evidence before returning it', () => {
  const promptHistoryBlock = routeBlock('get', '/:projectId/prompts/:promptId/history');

  assert.match(promptHistoryBlock, /CitationMetricSemanticsService\.normalizeForRead\(row\.visibilityMetric\)/);
});
