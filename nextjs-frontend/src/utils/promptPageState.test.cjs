/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../app/geo/prompts/page.tsx'), 'utf8');

test('prompt page guards async list, batch creation and history responses from stale project writes', () => {
  assert.match(source, /const promptsRequestRef = useRef\(0\)/);
  assert.match(source, /const batchRequestRef = useRef\(0\)/);
  assert.match(source, /const historyRequestRef = useRef\(0\)/);
  assert.match(source, /const runRequestRef = useRef\(0\)/);
  assert.match(source, /const currentProjectIdRef = useRef\(null\)/);
  assert.match(source, /batchRequestRef\.current \+= 1/);
  assert.match(source, /runRequestRef\.current \+= 1/);
  assert.match(source, /const requestId = promptsRequestRef\.current \+ 1/);
  assert.match(source, /promptsRequestRef\.current = requestId/);
  assert.match(source, /if \(!projectId\) \{[\s\S]*setPrompts\(\[\]\);[\s\S]*setPromptsLoading\(false\);[\s\S]*return;/);
  assert.match(source, /setPrompts\(\[\]\)[\s\S]*setPromptsLoading\(true\)/);
  assert.match(source, /if \(promptsRequestRef\.current === requestId\) setPrompts\(Array\.isArray\(res\?\.data\?\.data\) \? res\.data\.data : \[\]\)/);
  assert.match(source, /const requestId = batchRequestRef\.current \+ 1/);
  assert.match(source, /batchRequestRef\.current = requestId/);
  assert.match(source, /batchRequestRef\.current === requestId && isCurrentPromptProject\(mutationProjectId\)/);
  assert.match(source, /if \(historyRequestRef\.current === requestId && currentProjectIdRef\.current === historyProjectId\)/);
  assert.match(source, /const runProjectId = selectedProjectId/);
  assert.match(source, /runRequestRef\.current === requestId && currentProjectIdRef\.current === runProjectId/);
  assert.match(source, /router\.push\(`\/geo\/project-dashboard\?project_id=\$\{runProjectId\}`\)/);
});

test('prompt page closes stale prompt editor when switching projects', () => {
  assert.match(source, /const handleProjectChange = \(nextProjectId\) =>/);
  assert.match(source, /setSelectedProjectId\(nextProjectId\)/);
  assert.match(source, /setModalOpen\(false\)/);
  assert.match(source, /setEditingPrompt\(null\)/);
  assert.match(source, /form\.resetFields\(\)/);
  assert.match(source, /onChange=\{handleProjectChange\}/);
});

test('prompt page resets list filters when switching projects', () => {
  assert.match(source, /shouldResetPromptListFilters/);
  assert.match(source, /setPromptSearch\(''\)/);
  assert.match(source, /setPromptStatusFilter\('all'\)/);
  assert.match(source, /setPromptPlatformFilter\('all'\)/);
  assert.match(source, /setPromptCategoryFilter\('all'\)/);
});

test('question library disables single-question runs when project and question platforms do not overlap', () => {
  assert.match(source, /getProjectPromptRunBlockReason/);
  assert.match(source, /问题的监测平台与项目监测平台不一致/);
  assert.match(source, /请检查品牌项目监测平台设置/);
  assert.match(source, /getPromptRunDisabledReason\(row\)/);
  assert.match(source, /disabled=\{!!getPromptRunDisabledReason\(row\)\}/);
});

test('prompt page shows each prompt monitoring platform scope', () => {
  assert.match(source, /title:\s*'监测平台'/);
  assert.match(source, /getPromptPlatforms\(row\)/);
  assert.match(source, /platformLabels\[item\]/);
});

test('single prompt editor can update monitoring platforms within the current project scope', () => {
  const openEditStart = source.indexOf('const openEdit');
  const openEditEnd = source.indexOf('const openBatchCreate', openEditStart);
  const savePromptStart = source.indexOf('const savePrompt');
  const savePromptEnd = source.indexOf('const saveBatchPrompts', savePromptStart);
  const editorStart = source.indexOf("title={editingPrompt ? '编辑问题' : '新建问题'}");
  const editorEnd = source.indexOf('title="批量新增问题"', editorStart);

  assert.ok(openEditStart >= 0 && openEditEnd > openEditStart, '应找到单问题编辑初始化');
  assert.ok(savePromptStart >= 0 && savePromptEnd > savePromptStart, '应找到单问题保存逻辑');
  assert.ok(editorStart >= 0 && editorEnd > editorStart, '应找到单问题编辑弹窗');
  assert.match(source.slice(openEditStart, openEditEnd), /platforms:/);
  assert.match(source.slice(savePromptStart, savePromptEnd), /platforms:\s*normalizeList\(values\.platforms\)/);
  assert.match(source.slice(editorStart, editorEnd), /name="platforms"/);
  assert.match(source.slice(editorStart, editorEnd), /label="监测平台"/);
  assert.match(source.slice(editorStart, editorEnd), /mode="multiple"/);
  assert.match(source.slice(editorStart, editorEnd), /selectableProjectPlatforms\.map/);
});

test('prompt page offers parsed text batch creation instead of generated suggestions', () => {
  assert.match(source, /parseBatchQuestions/);
  assert.match(source, /\/prompts\/batch/);
  assert.match(source, /批量新增问题/);
  assert.doesNotMatch(source, /title="生成问题建议"/);
});

test('prompt page refreshes prompt data only for the current project after mutations', () => {
  assert.match(source, /const isCurrentPromptProject = \(projectId\) => currentProjectIdRef\.current === projectId/);
  assert.match(source, /const refreshPromptDataForProject = \(projectId\) =>/);
  assert.match(source, /if \(!isCurrentPromptProject\(projectId\)\) return/);
  assert.match(source, /if \(!isCurrentPromptProject\(mutationProjectId\)\) return/);
  assert.match(source, /refreshPromptDataForProject\(mutationProjectId\)/);
  assert.doesNotMatch(source, /fetchPrompts\(selectedProjectId\);\s*fetchProjects\(\);/);
});
