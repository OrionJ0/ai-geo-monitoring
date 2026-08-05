const { createHash } = require('node:crypto');

const SOURCE_MAP_VERSION = 'answer_source_lines_v1';

function answerHash(answer) {
  return createHash('sha256').update(answer, 'utf8').digest('hex');
}

function createSourceMap(value) {
  const answer = String(value ?? '');
  const segments = [];
  let lineStart = 0;

  for (let index = 0; index <= answer.length; index += 1) {
    if (index !== answer.length && answer[index] !== '\n') continue;
    const rawEnd = index > lineStart && answer[index - 1] === '\r'
      ? index - 1
      : index;
    if (rawEnd > lineStart) {
      segments.push({
        source_id: `L${String(segments.length + 1).padStart(3, '0')}`,
        start: lineStart,
        end: rawEnd,
        text: answer.slice(lineStart, rawEnd)
      });
    }
    lineStart = index + 1;
  }

  return {
    version: SOURCE_MAP_VERSION,
    answer_sha256: answerHash(answer),
    segments
  };
}

module.exports = {
  SOURCE_MAP_VERSION,
  createSourceMap
};
