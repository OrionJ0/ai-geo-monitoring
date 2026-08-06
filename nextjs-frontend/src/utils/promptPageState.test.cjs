/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../app/geo/prompts/page.tsx'), 'utf8');

test('问题库正式指标使用版本化回答级 SOV、样本数和 AI 语义标签', () => {
  assert.match(source, /title: 'SOV'/);
  assert.match(source, /sov_summary/);
  assert.match(source, /calculable_answers/);
  assert.match(source, /valid_answers/);
  assert.match(source, /ranked_answers/);
  assert.match(source, /AI 语义分析/);
  assert.match(source, /metricSemanticsLabel/);
  assert.match(source, /getSovPresentationTitle/);
  assert.match(source, /display\.sovLabel/);
  assert.doesNotMatch(source, /performance\?\.avg_share_of_voice/);
});

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
  assert.match(source, /setPrompts\(sortPromptRowsStable\(Array\.isArray\(res\?\.data\?\.data\) \? res\.data\.data : \[\]\)\)/);
  assert.match(source, /const requestId = batchRequestRef\.current \+ 1/);
  assert.match(source, /batchRequestRef\.current = requestId/);
  assert.match(source, /batchRequestRef\.current === requestId && isCurrentPromptProject\(mutationProjectId\)/);
  assert.match(source, /if \(historyRequestRef\.current === requestId && currentProjectIdRef\.current === historyProjectId\)/);
  assert.match(source, /const runProjectId = selectedProjectId/);
  assert.match(source, /runRequestRef\.current === requestId && currentProjectIdRef\.current === runProjectId/);
  assert.match(source, /if \(data\.report_url\) router\.push\(data\.report_url\)/);
  assert.doesNotMatch(source, /router\.push\(`\/geo\/project-dashboard\?project_id=\$\{runProjectId\}`\)/);
});

test('prompt page uses only the explicit default project context', () => {
  assert.match(source, /useDefaultProjectContext/);
  assert.match(source, /const selectedProjectId = defaultContext\.project\?\.id/);
  assert.match(source, /const selectedProject = defaultContext\.project/);
  assert.doesNotMatch(source, /axios\.get\('\/api\/geo-projects'\)/);
  assert.doesNotMatch(source, /getSelectablePromptProjects/);
  assert.doesNotMatch(source, /resolveSelectedPromptProjectId/);
  assert.doesNotMatch(source, /placeholder="选择品牌项目"/);
  assert.doesNotMatch(source, /project_id=/);
});

test('prompt page clears stale editors and filters when default context changes', () => {
  assert.match(source, /shouldResetPromptListFilters/);
  assert.match(source, /setPromptSearch\(''\)/);
  assert.match(source, /setPromptStatusFilter\('all'\)/);
  assert.match(source, /setPromptQuestionSetFilter\('all'\)/);
  assert.match(source, /setModalOpen\(false\)/);
  assert.match(source, /setEditingPrompt\(null\)/);
  assert.match(source, /form\.resetFields\(\)/);
});

test('opening or cancelling a question-set editor starts from an idle save state', () => {
  const createStart = source.indexOf('const openCreateQuestionSet');
  const editStart = source.indexOf('const openEditQuestionSet', createStart);
  const saveStart = source.indexOf('const saveQuestionSet', editStart);
  const modalStart = source.indexOf("title={editingQuestionSet ? '编辑问题集' : '新建问题集'}");
  const modalEnd = source.indexOf('</Modal>', modalStart);

  assert.ok(createStart >= 0 && editStart > createStart, '应找到新建问题集初始化');
  assert.ok(saveStart > editStart, '应找到编辑问题集初始化');
  assert.ok(modalStart >= 0 && modalEnd > modalStart, '应找到问题集编辑弹窗');
  assert.match(source.slice(createStart, editStart), /setSavingQuestionSet\(false\)/);
  assert.match(source.slice(editStart, saveStart), /setSavingQuestionSet\(false\)/);
  assert.match(source.slice(modalStart, modalEnd), /onCancel=\{\(\) => \{[\s\S]*setSavingQuestionSet\(false\)/);
});

test('question library disables single-question runs only when the question or global platform scope is unavailable', () => {
  assert.match(source, /getPromptRunDisabledReason\(row\)/);
  assert.match(source, /问题已停用，启用后才能运行/);
  assert.match(source, /当前没有已启用且配置完整的监测平台/);
  assert.match(source, /disabled=\{!!getPromptRunDisabledReason\(row\)\}/);
});

test('single prompt editor does not expose or submit a per-question platform scope', () => {
  const openEditStart = source.indexOf('const openEdit');
  const openEditEnd = source.indexOf('const openBatchCreate', openEditStart);
  const savePromptStart = source.indexOf('const savePrompt');
  const savePromptEnd = source.indexOf('const saveBatchPrompts', savePromptStart);
  const editorStart = source.indexOf("title={editingPrompt ? '编辑问题' : '新建问题'}");
  const editorEnd = source.indexOf('title="批量新增问题"', editorStart);

  assert.ok(openEditStart >= 0 && openEditEnd > openEditStart, '应找到单问题编辑初始化');
  assert.ok(savePromptStart >= 0 && savePromptEnd > savePromptStart, '应找到单问题保存逻辑');
  assert.ok(editorStart >= 0 && editorEnd > editorStart, '应找到单问题编辑弹窗');
  assert.doesNotMatch(source.slice(openEditStart, openEditEnd), /platforms:/);
  assert.doesNotMatch(source.slice(savePromptStart, savePromptEnd), /platforms:/);
  assert.doesNotMatch(source.slice(editorStart, editorEnd), /name="platforms"/);
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
  assert.doesNotMatch(source, /fetchProjects/);
});

test('问题列表加载期间不显示有业务含义的 0 / 0 假空态', () => {
  assert.match(source, /promptsLoading\s*\?\s*'正在加载问题…'/);
  assert.match(source, /:\s*`显示 \$\{filteredPrompts\.length\} \/ \$\{prompts\.length\} 条`/);
});

test('问题列表只在选中后显示批量操作，并将操作放在全选按钮左侧', () => {
  const listStart = source.indexOf('<Card title="问题列表">');
  const listEnd = source.indexOf('<Modal', listStart);
  const list = source.slice(listStart, listEnd);

  assert.match(list, /selectedPromptIds\.length \? \(/);
  assert.match(list, />\s*组成问题集\s*</);
  assert.match(list, />加入问题集</);
  assert.doesNotMatch(list, /将所选/);
  ['组成问题集', '加入问题集', '批量删除', '清空选择'].forEach((label) => {
    assert.ok(list.indexOf(label) < list.indexOf('全选筛选结果'));
  });
});

test('问题筛选变化后只保留当前筛选结果内的选中项', () => {
  assert.match(source, /retainVisiblePromptSelection/);
  assert.match(
    source,
    /setSelectedPromptIds\(\(current\) => retainVisiblePromptSelection\(current, filteredPrompts\)\)/
  );
  assert.doesNotMatch(source, /preserveSelectedRowKeys:\s*true/);
});

test('问题库移除标签并改为问题集筛选，包含未分组', () => {
  assert.doesNotMatch(source, /name="tags"|title:\s*'标签'|搜索问题或标签/);
  assert.match(source, /placeholder="搜索问题"/);
  assert.match(source, /全部问题集/);
  assert.match(source, /未分组/);
  assert.match(source, /questionSet:\s*promptQuestionSetFilter/);
});

test('选中问题可以原子加入已有问题集', () => {
  assert.match(source, /const addSelectedToQuestionSet = async/);
  assert.match(source, /question_ids:\s*mergedIds/);
  assert.match(source, /question-sets\/\$\{targetQuestionSet\.id\}/);
  assert.match(source, /已属于其他问题集的问题会移入新问题集/);
});

test('问题列表按创建时间稳定排序，不因启用状态更新时间而跳到首行', () => {
  const fetchStart = source.indexOf('const fetchPrompts');
  const fetchEnd = source.indexOf('const fetchQuestionSets', fetchStart);
  const fetchBlock = source.slice(fetchStart, fetchEnd);

  assert.match(fetchBlock, /sortPromptRowsStable/);
  assert.doesNotMatch(fetchBlock, /updated_at/);
});

test('问题列表只在底部显示分页，行内编辑不占用主按钮样式', () => {
  assert.match(source, /placement:\s*\['bottomRight'\]/);
  assert.doesNotMatch(source, /placement:\s*\['topRight', 'bottomRight'\]/);
  assert.doesNotMatch(source, /type="primary" onClick=\{\(\) => openEdit\(row\)\}/);
  assert.doesNotMatch(source, /type="primary" onClick=\{\(\) => openEditQuestionSet/);
});
