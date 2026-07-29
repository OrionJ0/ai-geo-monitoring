const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pageSource = fs.readFileSync(path.resolve(__dirname, '../app/geo/alerts/page.tsx'), 'utf8');

test('alert rule toggle only sends enabled state', () => {
  const start = pageSource.indexOf('const toggleRule = async');
  assert.notEqual(start, -1, 'toggleRule should exist');
  const end = pageSource.indexOf('const deleteRule = async', start);
  assert.notEqual(end, -1, 'deleteRule should follow toggleRule');
  const block = pageSource.slice(start, end);

  assert.match(block, /enabled:\s*!rule\.enabled/);
  assert.doesNotMatch(block, /threshold:/);
  assert.doesNotMatch(block, /type:/);
});

test('source drop alert copy reflects domain and url level monitoring', () => {
  assert.match(pageSource, /流失引用域名或 URL 数达到阈值/);
  assert.match(pageSource, /来源流失表示流失引用域名或 URL 数。/);
});

test('competitor ahead alert copy describes actual mention-count gap threshold', () => {
  assert.match(pageSource, /竞品提及次数领先目标品牌达到阈值/);
  assert.match(pageSource, /竞品领先按实际提及次数差值触发/);
  assert.doesNotMatch(pageSource, /可见度得分|综合得分/);
});

test('alert rule save normalizes thresholds before sending them to the backend', () => {
  assert.match(pageSource, /normalizeThresholdInput/);
  const start = pageSource.indexOf('const saveRule = async');
  assert.notEqual(start, -1, 'saveRule should exist');
  const end = pageSource.indexOf('const toggleRule = async', start);
  assert.notEqual(end, -1, 'toggleRule should follow saveRule');
  const block = pageSource.slice(start, end);

  assert.match(block, /threshold:\s*normalizeThresholdInput\(values\.type,\s*values\.threshold\)/);
  assert.doesNotMatch(block, /threshold:\s*Number\(values\.threshold/);
});
