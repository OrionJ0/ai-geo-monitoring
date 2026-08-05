#!/usr/bin/env node
/**
 * 把补充真值样本合并进冻结语料 samples.json + LABELING.md。
 * 补充样本来自数据库六类问题的真实回答，标注基于回答内容确认。
 * 只追加，不改写已有样本；用于 009 真值扩充（排名/推荐/情绪实例）。
 *
 * 用法：node scripts/geoFlashAppendSupplement.js --apply
 */
const path = require('node:path');
process.env.DB_STORAGE = path.resolve(__dirname, '../database.sqlite');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const fs = require('node:fs');
const { Op } = require('sequelize');

const SAMPLES_PATH = path.resolve(__dirname, '../../work/geo-baseline-2026-07-28/samples.json');
const LABELING_PATH = path.resolve(__dirname, '../../work/geo-baseline-2026-07-28/LABELING.md');

// 补充样本标注：record_id -> { sample_id, mentioned, mentions, recommended, rank, sentiment }
// 标注基于完整真实回答内容确认（目标出现/推荐/排名/情绪）。
const SUPPLEMENT_LABELS = {
  45: { sample_id: 'S41', mentioned: true, mentions: 2, recommended: true, rank: 1, sentiment: 'positive', multi_entity: true },
  41: { sample_id: 'S42', mentioned: true, mentions: 5, recommended: true, rank: 1, sentiment: 'positive', multi_entity: true },
  38: { sample_id: 'S43', mentioned: true, mentions: 2, recommended: true, rank: 2, sentiment: 'positive', multi_entity: true },
  47: { sample_id: 'S44', mentioned: true, mentions: 2, recommended: true, rank: 1, sentiment: 'positive', multi_entity: true },
  35: { sample_id: 'S45', mentioned: true, mentions: 1, recommended: true, rank: 4, sentiment: 'positive', multi_entity: true },
  68: { sample_id: 'S46', mentioned: true, mentions: 2, recommended: true, rank: 2, sentiment: 'positive', multi_entity: true },
  33: { sample_id: 'S47', mentioned: false, mentions: 0, recommended: false, rank: null, sentiment: null, multi_entity: true },
  21: { sample_id: 'S48', mentioned: false, mentions: 0, recommended: false, rank: null, sentiment: null, multi_entity: true },
  43: { sample_id: 'S49', mentioned: true, mentions: 2, recommended: true, rank: 1, sentiment: 'positive', multi_entity: true },
  71: { sample_id: 'S50', mentioned: true, mentions: 4, recommended: true, rank: 1, sentiment: 'positive', multi_entity: true },
  22: { sample_id: 'S51', mentioned: true, mentions: 1, recommended: true, rank: 1, sentiment: 'positive', multi_entity: true },
  27: { sample_id: 'S52', mentioned: true, mentions: 5, recommended: true, rank: null, sentiment: 'positive', multi_entity: true },
  46: { sample_id: 'S53', mentioned: true, mentions: 2, recommended: true, rank: 2, sentiment: 'positive', multi_entity: true },
  52: { sample_id: 'S54', mentioned: true, mentions: 2, recommended: true, rank: 2, sentiment: 'positive', multi_entity: true },
  73: { sample_id: 'S55', mentioned: true, mentions: 2, recommended: true, rank: 1, sentiment: 'positive', multi_entity: true }
};

function gatoAliases() {
  return ['广拓', '上海广拓', 'Gato'];
}

async function main() {
  const apply = process.argv.includes('--apply');
  const db = require('../config/database');
  const { ResultDetail, QuestionRecord } = require('../models');
  const samples = JSON.parse(fs.readFileSync(SAMPLES_PATH, 'utf8'));
  const existingIds = new Set(samples.map((sample) => sample.sample_id));
  const added = [];

  for (const [recordId, label] of Object.entries(SUPPLEMENT_LABELS)) {
    if (existingIds.has(label.sample_id)) continue;
    const detail = await ResultDetail.findOne({ where: { question_record_id: Number(recordId) } });
    const record = await QuestionRecord.findByPk(Number(recordId));
    if (!detail?.ai_response_original) continue;
    added.push({
      sample_id: label.sample_id,
      question_record_id: Number(recordId),
      project_id: record?.project_id || 1,
      platform: record?.platform || 'deepseek-web',
      question: record?.question || '',
      brand: { name: '广拓', aliases: gatoAliases() },
      competitors: [],
      multi_entity_review: Boolean(label.multi_entity),
      response_text: detail.ai_response_original,
      supplement: true
    });
  }

  if (!apply) {
    console.log(`预检：将追加 ${added.length} 条补充样本（已有 ${samples.length} 条）`);
    await db.close();
    return;
  }

  // 追加样本
  const updated = [...samples, ...added];
  fs.writeFileSync(SAMPLES_PATH, JSON.stringify(updated, null, 2));

  // 追加标注块
  const labeling = fs.readFileSync(LABELING_PATH, 'utf8');
  const blocks = added.map((sample) => {
    const label = SUPPLEMENT_LABELS[sample.question_record_id];
    const lines = [
      `<!-- SAMPLE ${sample.sample_id} -->`,
      '',
      `**问题**：${sample.question}`,
      '',
      '---LABELS---',
      `mentioned: ${label.mentioned ? 'yes' : 'no'}`,
      `mentions: ${label.mentions}`,
      `recommended: ${label.recommended ? 'yes' : 'no'}`,
      `rank: ${label.rank ?? 'none'}`,
      `sentiment: ${label.sentiment ?? 'none'}`,
      '---END---',
      ''
    ].join('\n');
    return lines;
  });
  const hasSupplementBlock = labeling.includes('S41');
  const finalLabeling = hasSupplementBlock
    ? labeling
    : labeling.replace(
        /human_review_confirmed:\s*yes/,
        (match) => `${match}\n# 补充样本标注（009 真值扩充，待复核）\n\n${blocks.join('')}`
      );
  fs.writeFileSync(LABELING_PATH, finalLabeling);

  console.log(`已追加 ${added.length} 条补充样本与标注`);
  await db.close();
}

main().catch((error) => {
  console.error('追加补充样本失败:', error);
  process.exitCode = 1;
});
