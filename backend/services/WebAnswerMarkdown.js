const MAX_TREE_NODES = 12_000;
const MAX_TREE_TEXT_CHARS = 1024 * 1024;

const BROWSER_ANSWER_TREE_SERIALIZER = String.raw`
      const serializeAnswerTree = (root) => {
        const skippedTags = new Set([
          'script', 'style', 'noscript', 'template', 'svg', 'canvas',
          'button', 'input', 'textarea', 'select', 'option'
        ]);
        let nodeCount = 0;
        let textChars = 0;
        let truncated = false;
        const visit = (node) => {
          if (!node || truncated) return null;
          nodeCount += 1;
          if (nodeCount > ${MAX_TREE_NODES}) {
            truncated = true;
            return null;
          }
          if (node.nodeType === Node.TEXT_NODE) {
            const raw = String(node.nodeValue || '');
            const remaining = ${MAX_TREE_TEXT_CHARS} - textChars;
            if (remaining <= 0) {
              truncated = true;
              return null;
            }
            const value = raw.slice(0, remaining);
            textChars += value.length;
            if (value.length < raw.length) truncated = true;
            return value ? { type: 'text', value } : null;
          }
          if (node.nodeType !== Node.ELEMENT_NODE) return null;
          const tag = String(node.tagName || '').toLowerCase();
          if (!tag || skippedTags.has(tag) || node.getAttribute('aria-hidden') === 'true') {
            return null;
          }
          if (node !== root) {
            const style = getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden') return null;
          }
          const children = Array.from(node.childNodes).map(visit).filter(Boolean);
          const output = { type: 'element', tag, children };
          if (tag === 'a') output.href = String(node.href || node.getAttribute('href') || '');
          if (tag === 'ol') output.start = Number(node.getAttribute('start')) || 1;
          if (tag === 'code') {
            const language = Array.from(node.classList || [])
              .map((item) => String(item).match(/^language-([a-z0-9_+-]+)$/i)?.[1])
              .find(Boolean);
            if (language) output.language = language;
          }
          if (tag === 'img') output.alt = String(node.getAttribute('alt') || '');
          return output;
        };
        return {
          tree: { type: 'root', children: Array.from(root.childNodes).map(visit).filter(Boolean) },
          truncated
        };
      };
`;

function childrenOf(node) {
  return Array.isArray(node?.children) ? node.children : [];
}

function textContent(node) {
  if (!node) return '';
  if (node.type === 'text') return String(node.value || '');
  if (node.tag === 'br') return '\n';
  return childrenOf(node).map(textContent).join('');
}

function escapeInlineText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_[\]])/g, '\\$1')
    .replace(/\s+/g, ' ');
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol)
      && !url.username
      && !url.password
      ? url.toString()
      : '';
  } catch {
    return '';
  }
}

function renderInline(node) {
  if (!node) return '';
  if (node.type === 'text') return escapeInlineText(node.value);
  const tag = String(node.tag || '').toLowerCase();
  if (tag === 'br') return '\n';
  if (tag === 'img') return escapeInlineText(node.alt || '');
  const content = childrenOf(node).map(renderInline).join('');
  if (!content.trim()) return '';
  if (tag === 'a') {
    const href = safeHttpUrl(node.href);
    return href ? `[${content}](${href})` : content;
  }
  if (tag === 'strong' || tag === 'b') return `**${content}**`;
  if (tag === 'em' || tag === 'i') return `*${content}*`;
  if (tag === 'del' || tag === 's') return `~~${content}~~`;
  if (tag === 'code') {
    const raw = textContent(node).replace(/`/g, '\\`').trim();
    return raw ? `\`${raw}\`` : '';
  }
  return content;
}

function descendants(node, tag) {
  const output = [];
  const visit = (item) => {
    if (String(item?.tag || '').toLowerCase() === tag) output.push(item);
    childrenOf(item).forEach(visit);
  };
  childrenOf(node).forEach(visit);
  return output;
}

function renderTable(node) {
  const rows = descendants(node, 'tr').map((row) => childrenOf(row)
    .filter((cell) => ['th', 'td'].includes(String(cell?.tag || '').toLowerCase()))
    .map((cell) => renderInline(cell).replace(/\|/g, '\\|').trim()));
  if (!rows.length || !rows.some((row) => row.length)) return '';
  const width = Math.max(...rows.map((row) => row.length));
  const padded = rows.map((row) => [
    ...row,
    ...Array(Math.max(0, width - row.length)).fill('')
  ]);
  const line = (cells) => `| ${cells.join(' | ')} |`;
  return [
    line(padded[0]),
    line(Array(width).fill('---')),
    ...padded.slice(1).map(line)
  ].join('\n');
}

function indentContinuation(value, spaces) {
  const padding = ' '.repeat(spaces);
  return String(value || '').split('\n').map((line, index) => (
    index === 0 ? line : `${padding}${line}`
  )).join('\n');
}

function renderList(node, depth = 0) {
  const ordered = String(node.tag || '').toLowerCase() === 'ol';
  let position = Number(node.start) || 1;
  return childrenOf(node)
    .filter((item) => String(item?.tag || '').toLowerCase() === 'li')
    .map((item) => {
      const nestedLists = childrenOf(item).filter((child) => (
        ['ul', 'ol'].includes(String(child?.tag || '').toLowerCase())
      ));
      const body = childrenOf(item)
        .filter((child) => !nestedLists.includes(child))
        .map((child) => renderNode(child, { inline: true, listDepth: depth }))
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
      const marker = ordered ? `${position++}.` : '-';
      const prefix = `${'  '.repeat(depth)}${marker} `;
      const nested = nestedLists.map((child) => renderList(child, depth + 1)).filter(Boolean);
      return [
        `${prefix}${indentContinuation(body, prefix.length)}`.trimEnd(),
        ...nested
      ].filter(Boolean).join('\n');
    })
    .join('\n');
}

function renderNode(node, context = {}) {
  if (!node) return '';
  if (node.type === 'text') return escapeInlineText(node.value);
  if (node.type === 'root') return childrenOf(node).map((child) => renderNode(child)).join('\n\n');
  const tag = String(node.tag || '').toLowerCase();
  if (/^h[1-6]$/.test(tag)) {
    return `${'#'.repeat(Number(tag.slice(1)))} ${renderInline(node).trim()}`;
  }
  if (tag === 'table') return renderTable(node);
  if (tag === 'ul' || tag === 'ol') return renderList(node, context.listDepth || 0);
  if (tag === 'pre') {
    const code = textContent(node).replace(/^\n+|\n+$/g, '');
    const codeNode = descendants(node, 'code')[0];
    const language = String(codeNode?.language || '').replace(/[^a-z0-9_+-]/gi, '');
    return `\`\`\`${language}\n${code}\n\`\`\``;
  }
  if (tag === 'blockquote') {
    return renderInline(node).trim().split('\n').map((line) => `> ${line}`).join('\n');
  }
  if (['p', 'div', 'section', 'article', 'header', 'footer', 'main'].includes(tag)) {
    return childrenOf(node).map((child) => renderNode(child, { inline: true })).join('').trim();
  }
  return renderInline(node);
}

function renderAnswerTree(tree) {
  return renderNode(tree)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = {
  BROWSER_ANSWER_TREE_SERIALIZER,
  renderAnswerTree,
  safeHttpUrl
};
