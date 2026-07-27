function splitListValue(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(/[,，;；\n]/);
  return [];
}

function normalizeText(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text || null;
}

function canonicalValue(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeList(value, options = {}) {
  const exclude = new Set((Array.isArray(options.exclude) ? options.exclude : [])
    .map((item) => canonicalValue(item))
    .filter(Boolean));
  const seen = new Set();
  const result = [];

  splitListValue(value).forEach((item) => {
    const text = normalizeText(item);
    if (!text) return;
    const key = canonicalValue(text);
    if (!key || exclude.has(key) || seen.has(key)) return;
    seen.add(key);
    result.push(text);
  });

  return result;
}

function normalizeNullableText(value) {
  return normalizeText(value);
}

function isValidDomain(domain) {
  const value = String(domain || '').trim().toLowerCase().replace(/^www\./, '');
  if (!value || value.includes('..') || /[\s/:：]/.test(value)) return false;
  const labels = value.split('.');
  if (labels.length < 2) return false;
  return labels.every((label) => /^[a-z0-9-]+$/i.test(label) && !label.startsWith('-') && !label.endsWith('-'))
    && (/^[a-z]{2,}$/i.test(labels[labels.length - 1]) || /^xn--[a-z0-9-]+$/i.test(labels[labels.length - 1]));
}

function isValidWebsiteInput(value) {
  const text = normalizeText(value);
  if (!text) return true;
  try {
    const raw = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    const parsed = new URL(raw);
    return isValidDomain(parsed.hostname);
  } catch {
    return false;
  }
}

module.exports = {
  normalizeList,
  normalizeNullableText,
  isValidWebsiteInput
};
