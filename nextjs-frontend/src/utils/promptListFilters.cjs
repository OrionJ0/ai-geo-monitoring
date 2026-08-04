function filterPromptRows(prompts, options = {}) {
  const rows = Array.isArray(prompts) ? prompts : [];
  const keyword = String(options.search || '').trim().toLowerCase();
  const status = options.status || 'all';
  const questionSet = options.questionSet || 'all';

  return rows.filter((item) => {
    const enabled = item?.enabled !== false;
    if (status === 'enabled' && !enabled) return false;
    if (status === 'disabled' && enabled) return false;

    const questionSetId = item?.question_set_id
      ?? item?.prompt_group_id
      ?? item?.question_set?.id
      ?? null;
    if (questionSet === 'unassigned' && questionSetId != null) return false;
    if (
      questionSet !== 'all'
      && questionSet !== 'unassigned'
      && String(questionSetId) !== String(questionSet)
    ) return false;

    if (!keyword) return true;
    return String(item?.question || '').toLowerCase().includes(keyword);
  });
}

function sortPromptRowsStable(prompts) {
  const rows = Array.isArray(prompts) ? prompts : [];
  return rows
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftTime = Date.parse(left.item?.created_at || '');
      const rightTime = Date.parse(right.item?.created_at || '');
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
        return rightTime - leftTime;
      }
      const leftId = Number(left.item?.id);
      const rightId = Number(right.item?.id);
      if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) {
        return rightId - leftId;
      }
      return left.index - right.index;
    })
    .map(({ item }) => item);
}

function retainVisiblePromptSelection(selectedIds, visibleRows) {
  const selected = Array.isArray(selectedIds) ? selectedIds : [];
  const visibleIds = new Set(
    (Array.isArray(visibleRows) ? visibleRows : [])
      .map((item) => item?.id)
      .filter((id) => id !== null && id !== undefined && id !== '')
      .map(String)
  );

  const next = selected.filter((id) => visibleIds.has(String(id)));
  return next.length === selected.length ? selected : next;
}

module.exports = {
  filterPromptRows,
  retainVisiblePromptSelection,
  sortPromptRowsStable,
};
