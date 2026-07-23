function normalizePlatforms(value, fallback = []) {
  const rows = Array.isArray(value) ? value : [];
  const list = rows
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean);
  return list.length ? Array.from(new Set(list)) : Array.from(new Set(fallback));
}

function promptCanRunOnProject(prompt, projectPlatforms) {
  if (!prompt || prompt.enabled === false) return false;
  const promptPlatforms = normalizePlatforms(prompt.platforms, projectPlatforms);
  return promptPlatforms.some((item) => projectPlatforms.includes(item));
}

function getRunnableProjectPromptIds(prompts, projectPlatformValue) {
  const rows = Array.isArray(prompts) ? prompts : [];
  const projectPlatforms = normalizePlatforms(projectPlatformValue);
  return rows
    .filter((item) => promptCanRunOnProject(item, projectPlatforms))
    .map((item) => item.id)
    .filter(Boolean);
}

function getProjectPromptRunBlockReason(prompts, projectPlatformValue) {
  const rows = Array.isArray(prompts) ? prompts : [];
  const enabledPrompts = rows.filter((item) => item?.enabled !== false);
  if (!enabledPrompts.length) return 'no_enabled_prompt';
  const projectPlatforms = normalizePlatforms(projectPlatformValue);
  const hasRunnablePrompt = enabledPrompts.some((item) => promptCanRunOnProject(item, projectPlatforms));
  return hasRunnablePrompt ? null : 'platform_mismatch';
}

function summarizeProjectPrompts(prompts, projectPlatformValue) {
  const rows = Array.isArray(prompts) ? prompts : [];
  const enabled = rows.filter((item) => item?.enabled !== false).length;
  const projectPlatforms = normalizePlatforms(projectPlatformValue);
  return {
    enabled,
    total: rows.length,
    runnable: rows.some((item) => promptCanRunOnProject(item, projectPlatforms))
  };
}

module.exports = {
  getProjectPromptRunBlockReason,
  getRunnableProjectPromptIds,
  summarizeProjectPrompts
};
