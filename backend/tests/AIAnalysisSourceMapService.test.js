const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SOURCE_MAP_VERSION,
  createSourceMap
} = require('../services/AIAnalysisSourceMapService');

test('creates a stable lossless source map from the complete answer', () => {
  const answer = '第一行：海康威视。\n\n第二行：Dahua Tech。\n';

  const first = createSourceMap(answer);
  const second = createSourceMap(answer);

  assert.equal(first.version, SOURCE_MAP_VERSION);
  assert.equal(first.version, 'answer_source_lines_v1');
  assert.match(first.answer_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(first, second);
  assert.deepEqual(first.segments, [
    {
      source_id: 'L001',
      start: 0,
      end: 9,
      text: '第一行：海康威视。'
    },
    {
      source_id: 'L002',
      start: 11,
      end: 26,
      text: '第二行：Dahua Tech。'
    }
  ]);
  first.segments.forEach((segment) => {
    assert.equal(answer.slice(segment.start, segment.end), segment.text);
  });
});
