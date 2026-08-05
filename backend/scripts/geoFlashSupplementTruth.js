#!/usr/bin/env node
/**
 * 生成补充真值候选：从数据库读取六类问题中目标出现+排名的真实回答，
 * 输出结构化标注要素（广拓出现、推荐上下文、排名结构）到 work/ 文件。
 * 不修改 samples.json；标注由脚本输出后人工复核确认。
 */
const path = require('node:path');
process.env.DB_STORAGE = path.resolve(__dirname, '../database.sqlite');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const fs = require('node:fs');
const { Op } = require('sequelize');

const CANDIDATE_IDS = [45, 41, 38, 22, 27, 35, 43, 47, 46, 52, 68, 71, 73];

function gatoContext(text) {
  const lines = text.split('\n');
  return lines
    .filter((line) => /广拓/.test(line))
    .map((line) => line.trim().replace(/[\[\]\-]+/gu, ' ').replace(/\s+/gu, ' ').slice(0, 120));
}

function rankCues(text) {
  const cues = [];
  if (/第[一二三四1234]梯队/.test(text)) cues.push('梯队');
  if (/^\s*[1-9][.、．]\s*/.test(text)) cues.push('编号列表');
  if (/首选|重点推荐|排名第|第一|为首|优先推荐/.test(text)) cues.push('推荐词');
  return cues;
}

async function main() {
  const db = require('../config/database');
  const { ResultDetail, QuestionRecord } = require('../models');
  const out = [];
  for (const recordId of CANDIDATE_IDS) {
    const detail = await ResultDetail.findOne({ where: { question_record_id: recordId } });
    const record = await QuestionRecord.findByPk(recordId);
    const text = detail?.ai_response_original || '';
    if (!text) continue;
    out.push({
      record_id: recordId,
      question: record?.question || '',
      platform: record?.platform || '',
      answer_length: text.length,
      gato_occurrences: (text.match(/广拓/g) || []).length,
      gato_shanghai: (text.match(/上海广拓/g) || []).length,
      gato_lines: gatoContext(text).slice(0, 6),
      rank_cues: rankCues(text),
      has_markdown_list: /^\s*[-*]\s*\*\*/m.test(text)
    });
  }
  const target = path.resolve(__dirname, '../../work/geo-flash-supplement-candidates.json');
  fs.writeFileSync(target, JSON.stringify(out, null, 2));
  console.log(`写入 ${out.length} 条候选标注要素: ${target}`);
  await db.close();
}

main().catch((error) => {
  console.error('生成补充真值候选失败:', error);
  process.exitCode = 1;
});
