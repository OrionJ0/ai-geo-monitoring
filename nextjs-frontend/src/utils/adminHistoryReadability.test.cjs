/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../app/admin/history/page.tsx'), 'utf8');

test('管理历史使用安全 Markdown 展示回答', () => {
  assert.match(source, /import ReactMarkdown from 'react-markdown'/);
  assert.match(source, /import remarkGfm from 'remark-gfm'/);
  assert.match(source, /<ReactMarkdown[\s\S]*remarkPlugins=\{\[remarkGfm\]\}/);
  assert.doesNotMatch(source, /rehypeRaw/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
});

test('管理历史筛选与操作控件有稳定的可访问名称', () => {
  assert.match(source, /aria-label="平台筛选"/);
  assert.match(source, /aria-label="状态筛选"/);
  assert.match(source, /aria-label="搜索历史"/);
  assert.match(source, /aria-label="重置筛选"/);
});
