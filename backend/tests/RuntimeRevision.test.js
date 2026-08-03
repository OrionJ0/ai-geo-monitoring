const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  readRuntimeRevision
} = require('../config/runtimeRevision');

test('runtime revision is captured once and cannot change underneath a running process', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-revision-'));
  const filename = path.join(directory, 'release-revision');
  const first = '1'.repeat(40);
  const second = '2'.repeat(40);
  try {
    fs.writeFileSync(filename, `${first}\n`);
    const captured = readRuntimeRevision({ env: {}, filename });
    fs.writeFileSync(filename, `${second}\n`);
    assert.equal(captured, first);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('runtime revision accepts only a complete lower-case Git revision', () => {
  assert.equal(readRuntimeRevision({
    env: { AI_GEO_RELEASE_REVISION: 'A'.repeat(40) },
    filename: '/does/not/exist'
  }), null);
});
