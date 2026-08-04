const test = require('node:test');
const assert = require('node:assert/strict');

const {
  filterPromptRows,
  retainVisiblePromptSelection,
  sortPromptRowsStable
} = require('./promptListFilters.cjs');

test('filters prompts by question and explicit status', () => {
  const rows = [
    { id: 1, question: '静音轮胎怎么选', tags: ['购买决策'], platforms: ['doubao'], enabled: true },
    { id: 2, question: '新能源车轮胎推荐', tags: ['产品适配'], platforms: ['deepseek'], enabled: false },
  ];

  assert.deepEqual(filterPromptRows(rows, { search: '静音' }).map((item) => item.id), [1]);
  assert.deepEqual(filterPromptRows(rows, { search: '产品适配' }).map((item) => item.id), []);
  assert.deepEqual(filterPromptRows(rows, { status: 'disabled' }).map((item) => item.id), [2]);
});

test('filters prompts by question set and includes unassigned questions', () => {
  const rows = [
    { id: 1, question: '静音轮胎怎么选', question_set_id: 10, question_set: { id: 10, name: '购买决策' } },
    { id: 2, question: '马牌和米其林哪个好', prompt_group_id: 20 },
    { id: 3, question: '轮胎寿命多久', question_set_id: null },
  ];

  assert.deepEqual(filterPromptRows(rows, { questionSet: '10' }).map((item) => item.id), [1]);
  assert.deepEqual(filterPromptRows(rows, { questionSet: 20 }).map((item) => item.id), [2]);
  assert.deepEqual(filterPromptRows(rows, { questionSet: 'unassigned' }).map((item) => item.id), [3]);
});

test('keeps question order stable when updated_at changes', () => {
  const rows = [
    { id: 1, question: '较早创建', created_at: '2026-08-01T08:00:00Z', updated_at: '2026-08-04T08:00:00Z' },
    { id: 2, question: '较晚创建', created_at: '2026-08-02T08:00:00Z', updated_at: '2026-08-02T08:00:00Z' },
  ];

  assert.deepEqual(sortPromptRowsStable(rows).map((item) => item.id), [2, 1]);
});

test('drops selected questions that are outside the current filtered result', () => {
  const selected = [1, 2, '3'];
  const visible = [{ id: 2 }, { id: 3 }, { id: 4 }];
  const alreadyVisible = [2, 3];

  assert.deepEqual(retainVisiblePromptSelection(selected, visible), [2, '3']);
  assert.strictEqual(retainVisiblePromptSelection(alreadyVisible, visible), alreadyVisible);
  assert.deepEqual(retainVisiblePromptSelection(selected, []), []);
});
