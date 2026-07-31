const test = require('node:test');
const assert = require('node:assert/strict');

const { renderAnswerTree } = require('../services/WebAnswerMarkdown');

test('DOM 语义树转换为安全 GFM 并保留表格列表代码与网页链接', () => {
  const markdown = renderAnswerTree({
    type: 'root',
    children: [
      {
        type: 'element',
        tag: 'h2',
        children: [{ type: 'text', value: '厂家对比' }]
      },
      {
        type: 'element',
        tag: 'table',
        children: [
          {
            type: 'element',
            tag: 'tr',
            children: [
              { type: 'element', tag: 'th', children: [{ type: 'text', value: '厂家' }] },
              { type: 'element', tag: 'th', children: [{ type: 'text', value: '特点' }] }
            ]
          },
          {
            type: 'element',
            tag: 'tr',
            children: [
              { type: 'element', tag: 'td', children: [{ type: 'text', value: '上海广拓' }] },
              { type: 'element', tag: 'td', children: [{ type: 'text', value: '定位精确' }] }
            ]
          }
        ]
      },
      {
        type: 'element',
        tag: 'ul',
        children: [{
          type: 'element',
          tag: 'li',
          children: [{ type: 'text', value: '适用于周界安防' }]
        }]
      },
      {
        type: 'element',
        tag: 'p',
        children: [
          { type: 'text', value: '查看' },
          {
            type: 'element',
            tag: 'a',
            href: 'https://example.com/source',
            children: [{ type: 'text', value: '来源' }]
          },
          {
            type: 'element',
            tag: 'a',
            href: 'javascript:alert(1)',
            children: [{ type: 'text', value: '危险链接' }]
          },
          {
            type: 'element',
            tag: 'a',
            href: 'https://user:secret@example.com/private',
            children: [{ type: 'text', value: '带凭据链接' }]
          }
        ]
      },
      {
        type: 'element',
        tag: 'pre',
        children: [{ type: 'element', tag: 'code', children: [{ type: 'text', value: '<script>alert(1)</script>' }] }]
      }
    ]
  });

  assert.match(markdown, /^## 厂家对比/m);
  assert.match(markdown, /\| 厂家 \| 特点 \|/);
  assert.match(markdown, /\| --- \| --- \|/);
  assert.match(markdown, /- 适用于周界安防/);
  assert.match(markdown, /\[来源\]\(https:\/\/example\.com\/source\)/);
  assert.match(markdown, /危险链接/);
  assert.match(markdown, /带凭据链接/);
  assert.doesNotMatch(markdown, /javascript:/);
  assert.doesNotMatch(markdown, /user:secret/);
  assert.match(markdown, /```[\s\S]*<script>alert\(1\)<\/script>[\s\S]*```/);
});

test('DOM 文本中的 Markdown 与 HTML 控制符只按正文显示', () => {
  const markdown = renderAnswerTree({
    type: 'root',
    children: [{
      type: 'element',
      tag: 'p',
      children: [{ type: 'text', value: '<img src=x onerror=alert(1)> **不是强调**' }]
    }]
  });

  assert.match(markdown, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(markdown, /\\\*\\\*不是强调\\\*\\\*/);
});
