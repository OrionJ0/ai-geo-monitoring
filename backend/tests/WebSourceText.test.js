const test = require('node:test');
const assert = require('node:assert/strict');

const { repairMojibakeText } = require('../services/WebSourceText');

test('只修复可逆且明显改善的 UTF-8 单字节误解码标题', () => {
  assert.equal(
    repairMojibakeText('ç”µç£æ„ŸçŸ¥ - ä¸Šæµ·å¹¿æ‹“'),
    '电磁感知 - 上海广拓'
  );
});

test('正常中文、英文和无法证明的混合文本保持不变', () => {
  for (const title of [
    '上海广拓周界报警产品',
    'Shanghai Gato perimeter security',
    '上海广拓 Ã uncertain'
  ]) {
    assert.equal(repairMojibakeText(title), title);
  }
});
