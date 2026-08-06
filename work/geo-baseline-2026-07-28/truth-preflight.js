#!/usr/bin/env node
/**
 * truth preflight（2026-08-06 冻结执行，数据所有者授权 reviewer=OrionJ0）：
 * 1. validateTruthEntry 全 55 条严格校验（fail-closed：schema/哈希/span/关系/目标字段/confirmed 完整性）
 * 2. 全部 confirmed + reviewer/reviewed_at 元数据
 * 3. 与 manifest.json 哈希一致 + S18/S19/S20 重复簇标记存在
 */
const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const BASE = __dirname;
const { validateTruthEntry } = require(path.join(BASE, '..', '..', 'backend', 'services', 'GeoFlashStructuredBenchmarkService'));

const samples = JSON.parse(fs.readFileSync(path.join(BASE, 'samples.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(BASE, 'manifest.json'), 'utf8'));
const sampleById = new Map(samples.map((s) => [s.sample_id, s]));

const lines = fs.readFileSync(path.join(BASE, 'truth.jsonl'), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
const entries = lines.map((line, i) => ({ line: i + 1, entry: JSON.parse(line) }));
const errors = [];
const bySample = new Map();

for (const { line, entry } of entries) {
  const entryErrors = validateTruthEntry(entry, sampleById);
  if (entryErrors.length) errors.push(`L${line} ${entry.sample_id}: ${entryErrors.join('; ')}`);
  if (bySample.has(entry.sample_id)) errors.push(`重复 sample_id: ${entry.sample_id}`);
  bySample.set(entry.sample_id, entry);
  if (entry.review_status !== 'confirmed') errors.push(`${entry.sample_id} 未 confirmed`);
  if (String(entry.reviewer || '').trim() !== 'OrionJ0') errors.push(`${entry.sample_id} reviewer 缺失`);
  if (!String(entry.reviewed_at || '').trim()) errors.push(`${entry.sample_id} reviewed_at 缺失`);
}

// 与 manifest 哈希一致
const manifestSampleById = new Map(manifest.samples.map((s) => [s.sample_id, s]));
for (const [sid, entry] of bySample) {
  const m = manifestSampleById.get(sid);
  if (!m) { errors.push(`${sid} 不在 manifest`); continue; }
  const text = sampleById.get(sid)?.response_text;
  const hash = crypto.createHash('sha256').update(String(text || '')).digest('hex');
  if (hash !== entry.answer_sha256) errors.push(`${sid} answer_sha256 与冻结回答不一致`);
  if (m.answer_sha256 && m.answer_sha256 !== entry.answer_sha256) errors.push(`${sid} 与 manifest 哈希不一致`);
}

// 重复簇：manifest 中 dup1 三条全部在 truth 且哈希一致
const dup1 = manifest.samples.filter((s) => s.duplicate_group === 'dup1');
if (dup1.length !== 3) errors.push(`manifest dup1 应有 3 条，实际 ${dup1.length}`);
const hashes = dup1.map((s) => s.answer_sha256);
if (new Set(hashes).size !== 1) errors.push('dup1 哈希不一致');
dup1.forEach((s) => { if (!bySample.has(s.sample_id)) errors.push(`truth 缺重复簇成员 ${s.sample_id}`); });

const firstEntry = bySample.values().next().value;
const result = { status: errors.length ? 'FAILED' : 'PASS', checked: entries.length, errors, reviewed_at: firstEntry?.reviewed_at };
fs.writeFileSync(path.join(BASE, 'truth-preflight-result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
