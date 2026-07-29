const fs = require('node:fs');
const path = require('node:path');

const CONTRACT_VERSION = /^[a-z0-9][a-z0-9.-]{0,119}$/u;

function loadBaiduContract(version) {
  const normalized = String(version || '').trim();
  if (!CONTRACT_VERSION.test(normalized)) return null;
  const manifestPath = path.join(__dirname, normalized, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return manifest?.contractVersion === normalized ? manifest : null;
  } catch {
    return null;
  }
}

module.exports = {
  loadBaiduContract
};
