function parseProjectAllowlist(value) {
  const text = String(value || '').trim();
  if (text === '*') return { all: true, ids: new Set() };
  return {
    all: false,
    ids: new Set(
      text.split(',').map((item) => item.trim()).filter(Boolean)
    )
  };
}

function projectAllowed(allowlist, projectId) {
  return allowlist.all || allowlist.ids.has(String(projectId));
}

module.exports = {
  parseProjectAllowlist,
  projectAllowed
};
