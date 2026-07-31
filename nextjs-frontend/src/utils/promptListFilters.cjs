function normalizeList(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function filterPromptRows(prompts, options = {}) {
  const rows = Array.isArray(prompts) ? prompts : [];
  const keyword = String(options.search || '').trim().toLowerCase();
  const status = options.status || 'all';
  const category = options.category || 'all';

  return rows.filter((item) => {
    const enabled = item?.enabled !== false;
    if (status === 'enabled' && !enabled) return false;
    if (status === 'disabled' && enabled) return false;

    const categoryText = String(item?.category || item?.prompt_category || '').trim();
    if (category !== 'all' && categoryText !== category) return false;

    if (!keyword) return true;
    const tagsText = normalizeList(item?.tags).join(' ');
    const statusText = enabled ? '启用中 enabled' : '已停用 disabled';
    return `${item?.question || ''} ${categoryText} ${tagsText} ${statusText}`.toLowerCase().includes(keyword);
  });
}

module.exports = {
  filterPromptRows,
};
