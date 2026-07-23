const BATCH_QUESTION_LIMIT = 100;

function stripListPrefix(value) {
  return String(value || '')
    .replace(/^\s*(?:[-*•]\s+|\d+[.、)）]\s*|[（(]\d+[）)]\s*)/u, '')
    .trim();
}

function parseBatchQuestions(value, options = {}) {
  const limit = Number(options.limit || BATCH_QUESTION_LIMIT);
  const seen = new Set();
  const questions = [];

  for (const part of String(value || '').split(/[\r\n;；]+/u)) {
    const question = stripListPrefix(part);
    if (!question || seen.has(question)) continue;
    seen.add(question);
    questions.push(question);
  }

  return {
    questions: questions.slice(0, limit),
    overflow_count: Math.max(0, questions.length - limit)
  };
}

module.exports = {
  BATCH_QUESTION_LIMIT,
  parseBatchQuestions,
  stripListPrefix
};
