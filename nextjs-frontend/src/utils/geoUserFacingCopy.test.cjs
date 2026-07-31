const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const geoRoot = path.resolve(__dirname, '../app/geo');

function collectFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectFiles(fullPath);
    return /\.(tsx|jsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

test('geo pages avoid implementation-specific prompt generation copy', () => {
  const forbidden = [
    'DeepSeek 生成',
    '使用 DeepSeek',
    'AI 生成 Prompt 建议',
    'AI 返回内容无法解析',
    '解析错误'
  ];
  const offenders = collectFiles(geoRoot)
    .flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8');
      return forbidden
        .filter((text) => source.includes(text))
        .map((text) => `${path.relative(geoRoot, file)}: ${text}`);
    });

  assert.deepEqual(offenders, []);
});
