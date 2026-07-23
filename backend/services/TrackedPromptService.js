const { TrackedPrompt } = require('../models');

class TrackedPromptService {
  canonicalQuestion(question) {
    return String(question || '')
      .trim()
      .replace(/^\s*(?:[-*]\s*)?(?:(?:\d+[.、)）])|(?:[（(]\d+[）)]))\s*/u, '')
      .replace(/^\s*(?:[一二三四五六七八九十]+[.、)）]|第\s*\d+\s*题\s*[:：.、]?|问题\s*\d+\s*[:：.、]?)\s*/u, '')
      .replace(/^\s*(?:问题|提问|问|q|question)\s*[:：]\s*/iu, '')
      .replace(/^([^，,。！!；;？?]{1,20})\s*[，,]\s*([^，,。！!；;？?]{1,28}(?:哪个好|哪家好|更适合|更推荐|更值得|对比|区别|差异|优劣|替代|怎么选)[^，,。！!；;？?]*)/u, '$1和$2')
      .replace(/^([^，,。！!；;？?]{1,20})\s*[，,]\s*((?:怎么|如何|怎样|要不要|能不能|适不适合|贵不贵|好不好)[^，,。！!；;？?]{1,24})/u, '$1$2')
      .replace(/\s+/g, '')
      .replace(/[？?。.!！]+$/g, '')
      .toLowerCase();
  }

  findDuplicateInRows(question, rows, excludeId = null) {
    const target = this.canonicalQuestion(question);
    if (!target) return null;
    const excluded = excludeId == null ? null : Number(excludeId);
    return (Array.isArray(rows) ? rows : []).find((row) => {
      if (!row) return false;
      if (excluded != null && Number(row.id) === excluded) return false;
      return this.canonicalQuestion(row.question) === target;
    }) || null;
  }

  async findDuplicatePrompt(projectId, question, excludeId = null) {
    const rows = await TrackedPrompt.findAll({
      where: { project_id: projectId },
      attributes: ['id', 'question'],
      raw: true
    });
    return this.findDuplicateInRows(question, rows, excludeId);
  }

  prepareBatchQuestions(questions, existingRows = []) {
    const known = new Map();
    for (const row of Array.isArray(existingRows) ? existingRows : []) {
      const canonical = this.canonicalQuestion(row?.question);
      if (canonical && !known.has(canonical)) known.set(canonical, row);
    }

    const createdQuestions = [];
    const skipped = [];
    for (const value of Array.isArray(questions) ? questions : []) {
      const question = String(value || '').trim();
      const canonical = this.canonicalQuestion(question);
      const duplicate = known.get(canonical);
      if (duplicate) {
        skipped.push({
          question,
          reason: 'duplicate',
          duplicate_id: duplicate.id || null
        });
        continue;
      }
      const pending = { id: null, question };
      known.set(canonical, pending);
      createdQuestions.push(question);
    }
    return { createdQuestions, skipped };
  }
}

module.exports = new TrackedPromptService();
