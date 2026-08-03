const fs = require('node:fs');

function validRevision(value) {
  const normalized = String(value || '').trim();
  return /^[a-f0-9]{40}$/u.test(normalized) ? normalized : null;
}

function readRuntimeRevision({ env = process.env, filename }) {
  const configured = validRevision(env.AI_GEO_RELEASE_REVISION);
  if (configured) return configured;
  try {
    return validRevision(fs.readFileSync(filename, 'utf8'));
  } catch {
    return null;
  }
}

module.exports = { readRuntimeRevision };
