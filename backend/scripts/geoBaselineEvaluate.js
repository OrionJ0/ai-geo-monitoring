#!/usr/bin/env node
/**
 * GEO 基线测量 - 评测脚本
 *
 * 读取 LABELING.md 中的人工标注，对每条样本运行（或复用缓存的）AI 分析结果，
 * 逐字段对比并输出 BASELINE-REPORT.md。
 *
 * 用法：
 *   node backend/scripts/geoBaselineEvaluate.js                  # 全量评测（要求标注完整）
 *   node backend/scripts/geoBaselineEvaluate.js --allow-partial  # 只评测已标注样本
 *   node backend/scripts/geoBaselineEvaluate.js --warm-cache --limit 2   # 冒烟：只跑分析不写报告
 *   node backend/scripts/geoBaselineEvaluate.js --refresh        # 忽略缓存重新分析
 *   node backend/scripts/geoBaselineEvaluate.js --platform deepseek  # 只读旁路：用指定平台配置分析，
 *                                                                    # 不要求平台处于启用状态、不改库
 *   node backend/scripts/geoBaselineEvaluate.js --platform deepseek \
 *     --experiment-name prompt-revision-check --refresh          # 隔离输出的评测实验
 */
const path = require('path');

process.env.DB_STORAGE = path.resolve(__dirname, '../database.sqlite');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const fs = require('fs');
const AIResponseAnalysisService = require('../services/AIResponseAnalysisService');
const { AIResponseAnalysisService: AnalyzerClass } = require('../services/AIResponseAnalysisService');
const AIPlatformConfigService = require('../services/AIPlatformConfigService');
const { Setting, VisibilityMetric } = require('../models');
const {
  CURRENT_ANALYSIS_CONTRACT,
  CURRENT_STRUCTURE_VERSION,
  CURRENT_METRIC_SEMANTICS
} = require('../services/GeoMetricSemanticsService');

const DEFAULT_DIR = path.resolve(__dirname, '../../work/geo-baseline-2026-07-28');
const CONCURRENCY = 3;
const ANALYSIS_METHOD = CURRENT_ANALYSIS_CONTRACT;
const CURRENT_PROMPT_DEFINITION = AIResponseAnalysisService.getPromptDefinition();
const CURRENT_PROMPT_REVISION = CURRENT_PROMPT_DEFINITION.prompt_revision;

// main() 起始时按 --dir 覆盖；其余函数统一引用 PATHS
const PATHS = {};
function initPaths(baseDir, experimentName = null) {
  const normalizedExperimentName = String(experimentName || '').trim();
  if (
    normalizedExperimentName
    && !/^[a-z0-9][a-z0-9._-]{0,79}$/iu.test(normalizedExperimentName)
  ) {
    throw new Error('experiment-name 只能包含字母、数字、点、下划线和连字符');
  }
  const outputDir = normalizedExperimentName
    ? path.join(baseDir, 'experiments', normalizedExperimentName)
    : baseDir;
  PATHS.base = baseDir;
  PATHS.samples = path.join(baseDir, 'samples.json');
  PATHS.labeling = path.join(baseDir, 'LABELING.md');
  PATHS.report = path.join(outputDir, 'BASELINE-REPORT.md');
  PATHS.partialReport = path.join(outputDir, 'BASELINE-PARTIAL.md');
  PATHS.raw = path.join(outputDir, 'raw');
  return { ...PATHS };
}

const VALID_SENTIMENTS = new Set(['positive', 'neutral', 'negative', 'none']);
const VALID_ENTITY_RELATIONS = new Set(['target', 'competitor', 'non_competitor']);

function parseArgs(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  const readValue = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : null;
  };
  return {
    allowPartial: args.has('--allow-partial'),
    warmCache: args.has('--warm-cache'),
    refresh: args.has('--refresh'),
    limit: readValue('--limit') ? Number(readValue('--limit')) : null,
    platform: readValue('--platform'),
    model: readValue('--model'),
    experimentName: readValue('--experiment-name'),
    dir: readValue('--dir') ? path.resolve(readValue('--dir')) : DEFAULT_DIR
  };
}

/**
 * 构建分析器。默认走生产配置（AIAnalysisConfigService.getAnalysisPlatform，含启用校验）；
 * 指定 --platform 时以“只读旁路”构造该平台配置：读取同一份平台配置与分析模型设置，
 * 但不做启用状态校验、不修改任何库数据——用于测量“生产数据实际由哪个分析配置产生”。
 */
async function buildAnalyzer(options) {
  const analysisLabel = [
    `prompt=${CURRENT_PROMPT_REVISION}`,
    `thinking=${CURRENT_PROMPT_DEFINITION.request_profile.deepseek_thinking}`
  ].join(',');
  if (!options.platform) {
    return {
      analyzer: AIResponseAnalysisService,
      via: `production_config:${analysisLabel}`
    };
  }
  const platform = await AIPlatformConfigService.getPlatformByCode(options.platform);
  const plain = platform.get ? platform.get({ plain: true }) : { ...platform };
  let modelName = options.model;
  if (!modelName) {
    const row = await Setting.findOne({ where: { key: 'ai_analysis_model_name' } });
    modelName = String(row?.value || plain.default_model || '').trim();
  }
  const analyzer = new AnalyzerClass({
    configService: {
      // enabled 覆写仅存在于内存对象中：queryConfig 对已停用平台直接拒绝，
      // 基线测量需要复现“历史数据实际使用的分析配置”，不回写数据库。
      getAnalysisPlatform: async () => ({ ...plain, default_model: modelName, enabled: true })
    }
  });
  return {
    analyzer,
    via: `readonly_override:${options.platform}/${modelName},${analysisLabel}`
  };
}

// ---------- LABELING.md 解析 ----------

function parseLabelValue(key, rawValue, sampleId) {
  const value = String(rawValue || '').trim().toLowerCase();
  switch (key) {
    case 'mentioned':
    case 'recommended':
      if (value === 'yes' || value === 'no') return value === 'yes';
      throw new Error(`${sampleId}: ${key} 只能填 yes/no（当前："${rawValue}"）`);
    case 'mentions': {
      if (!/^\d+$/.test(value)) throw new Error(`${sampleId}: mentions 必须是非负整数（当前："${rawValue}"）`);
      return Number(value);
    }
    case 'rank': {
      if (value === 'none') return null;
      if (/^[1-9]\d*$/.test(value)) return Number(value);
      throw new Error(`${sampleId}: rank 只能填 none 或正整数（当前："${rawValue}"）`);
    }
    case 'sentiment':
      if (VALID_SENTIMENTS.has(value)) return value === 'none' ? null : value;
      throw new Error(`${sampleId}: sentiment 只能填 positive/neutral/negative/none（当前："${rawValue}"）`);
    default:
      throw new Error(`${sampleId}: 未知字段 ${key}`);
  }
}

function compact(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/gu, '');
}

function parseEntityLabels(rawValue, sampleId) {
  let rows;
  try {
    rows = JSON.parse(String(rawValue || '').trim());
  } catch (_) {
    throw new Error(`${sampleId}: entity_labels_json 必须是合法 JSON 数组`);
  }
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error(`${sampleId}: entity_labels_json 必须列出全部企业实体`);
  }
  const seen = new Set();
  return rows.map((row, index) => {
    const name = String(row?.name || '').trim();
    const key = compact(name);
    const aliases = Array.isArray(row?.aliases)
      ? row.aliases.map((alias) => String(alias || '').trim()).filter(Boolean)
      : null;
    const mentions = Number(row?.mentions);
    const relation = String(row?.relation || '').trim();
    if (!name || !key || seen.has(key)) {
      throw new Error(`${sampleId}: entity_labels_json[${index}].name 不能为空或重复`);
    }
    if (!aliases || aliases.some((alias) => compact(alias) === key)) {
      throw new Error(`${sampleId}: entity_labels_json[${index}].aliases 必须是其他原文名称数组`);
    }
    if (!Number.isInteger(mentions) || mentions < 1) {
      throw new Error(`${sampleId}: entity_labels_json[${index}].mentions 必须是正整数`);
    }
    if (!VALID_ENTITY_RELATIONS.has(relation)) {
      throw new Error(
        `${sampleId}: entity_labels_json[${index}].relation 只能是 target/competitor/non_competitor`
      );
    }
    seen.add(key);
    return { name, aliases, mentions, relation };
  });
}

function parseLabels() {
  const doc = fs.readFileSync(PATHS.labeling, 'utf8');
  const labels = new Map();
  const confirmation = doc.match(/^human_review_confirmed:\s*(yes|no)\s*$/imu);
  const human_review_confirmed = confirmation?.[1]?.toLowerCase() === 'yes';
  const blockPattern = /<!-- SAMPLE (\S+) -->([\s\S]*?)(?=<!-- SAMPLE |$)/g;
  for (const match of doc.matchAll(blockPattern)) {
    const sampleId = match[1];
    const chunk = match[2];
    const labelMatch = chunk.match(/---LABELS---\n([\s\S]*?)\n?---END---/);
    if (!labelMatch) continue;
    const fields = {};
    let filled = 0;
    for (const line of labelMatch[1].split('\n')) {
      const lineMatch = line.match(
        /^\s*(mentioned|mentions|recommended|rank|sentiment|entity_labels_json)\s*:\s*(.*)$/
      );
      if (!lineMatch) continue;
      const [, key, rawValue] = lineMatch;
      if (!String(rawValue).trim()) {
        fields[key] = undefined;
        continue;
      }
      fields[key] = key === 'entity_labels_json'
        ? parseEntityLabels(rawValue, sampleId)
        : parseLabelValue(key, rawValue, sampleId);
      filled += 1;
    }
    if (filled >= 5) labels.set(sampleId, fields);
    else if (filled > 0) labels.set(sampleId, { ...fields, __partial: true });
  }
  return { labels, human_review_confirmed };
}

function validateLabels(samples, labels, allowPartial, humanReviewConfirmed) {
  const problems = [];
  const usable = new Map();
  if (!allowPartial && !humanReviewConfirmed) {
    problems.push('未完成人工确认：请将 human_review_confirmed 改为 yes');
  }
  for (const sample of samples) {
    const sampleId = sample.sample_id;
    const label = labels.get(sampleId);
    if (!label) {
      if (!allowPartial) problems.push(`${sampleId}: 未标注`);
      continue;
    }
    if (label.__partial) {
      if (!allowPartial) problems.push(`${sampleId}: 标注不完整（5 个字段都要填）`);
      continue;
    }
    if (label.mentioned === false) {
      const violations = [];
      if (label.mentions !== 0) violations.push('mentions 应为 0');
      if (label.recommended !== false) violations.push('recommended 应为 no');
      if (label.rank !== null) violations.push('rank 应为 none');
      if (label.sentiment !== null) violations.push('sentiment 应为 none');
      if (violations.length) {
        problems.push(`${sampleId}: mentioned=no 时 ${violations.join('，')}`);
        continue;
      }
    }
    if (label.mentioned === true) {
      if (label.mentions < 1) {
        problems.push(`${sampleId}: mentioned=yes 时 mentions 应 ≥ 1`);
        continue;
      }
      if (label.sentiment === null) {
        problems.push(`${sampleId}: mentioned=yes 时 sentiment 不能为 none`);
        continue;
      }
    }
    if (sample.multi_entity_review) {
      if (!Array.isArray(label.entity_labels_json)) {
        if (!allowPartial) problems.push(`${sampleId}: 多实体复核缺少 entity_labels_json`);
        continue;
      }
      const targets = label.entity_labels_json.filter((entity) => entity.relation === 'target');
      if (label.mentioned && (
        targets.length !== 1
        || targets[0].mentions !== label.mentions
      )) {
        problems.push(`${sampleId}: 目标实体必须恰好一条且 mentions 与目标品牌标注一致`);
        continue;
      }
      if (!label.mentioned && targets.length) {
        problems.push(`${sampleId}: mentioned=no 时不能标记 target 实体`);
        continue;
      }
    }
    usable.set(sampleId, label);
  }
  return { problems, usable };
}

// ---------- 分析执行（含缓存） ----------

function cachePath(sampleId) {
  return path.join(PATHS.raw, `${sampleId}.json`);
}

function readCache(sampleId) {
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath(sampleId), 'utf8'));
    const schema_version = cached?.result?.analysis_structure?.schema_version
      || cached.structure_version;
    if (
      cached.ok === true
      && cached.analysis_method === CURRENT_ANALYSIS_CONTRACT
      && cached.analysis_prompt_revision === CURRENT_PROMPT_REVISION
      && schema_version === CURRENT_STRUCTURE_VERSION
      && cached.metric_semantics_version === CURRENT_METRIC_SEMANTICS
    ) return cached;
  } catch (_) { /* 无缓存或缓存损坏 */ }
  return null;
}

function recalculateCachedResult(cached, analyzer, responseText = '') {
  const structure = cached?.result?.analysis_structure;
  if (!structure) return cached;
  const calculated = typeof analyzer?.recalculateFromStructure === 'function'
    ? analyzer.recalculateFromStructure(structure, responseText)
    : analyzer?.calculate?.(structure);
  if (!calculated) return cached;
  return {
    ...cached,
    result: {
      ...cached.result,
      ...calculated
    }
  };
}

async function analyzeSample(sample, refresh, analyzer, via) {
  if (!refresh) {
    const cached = readCache(sample.sample_id);
    if (cached) {
      try {
        const refreshed = recalculateCachedResult(
          cached,
          analyzer,
          sample.response_text
        );
        fs.writeFileSync(cachePath(sample.sample_id), JSON.stringify(refreshed, null, 2));
        return { ...refreshed, from_cache: true };
      } catch (_) {
        // 缓存结构无法由当前确定性计算器复算时，重新请求分析，不复用旧派生指标。
      }
    }
  }
  const startedAt = new Date().toISOString();
  try {
    const result = await analyzer.analyze({
      question: sample.question,
      responseText: sample.response_text,
      brand: sample.brand
    });
    const entry = {
      sample_id: sample.sample_id,
      analysis_method: result.analysis_method,
      analysis_prompt_revision: result.analysis_prompt_revision,
      structure_version: result.analysis_structure?.schema_version,
      metric_semantics_version: result.metric_semantics_version,
      analysis_platform: result.analysis_platform,
      analysis_model: result.analysis_model,
      analysis_attempts: result.analysis_attempts,
      analyzer_via: via,
      cached_at: startedAt,
      ok: true,
      result
    };
    fs.writeFileSync(cachePath(sample.sample_id), JSON.stringify(entry, null, 2));
    return entry;
  } catch (error) {
    const entry = {
      sample_id: sample.sample_id,
      analysis_method: CURRENT_ANALYSIS_CONTRACT,
      analysis_prompt_revision: CURRENT_PROMPT_REVISION,
      structure_version: CURRENT_STRUCTURE_VERSION,
      metric_semantics_version: CURRENT_METRIC_SEMANTICS,
      analyzer_via: via,
      cached_at: startedAt,
      ok: false,
      error: { code: error.code || 'unknown', message: error.message }
    };
    fs.writeFileSync(cachePath(sample.sample_id), JSON.stringify(entry, null, 2));
    return entry;
  }
}

async function runWithConcurrency(samples, worker, concurrency) {
  const results = new Array(samples.length);
  let cursor = 0;
  let done = 0;
  async function runNext() {
    while (cursor < samples.length) {
      const index = cursor++;
      const sample = samples[index];
      results[index] = await worker(sample);
      done += 1;
      const r = results[index];
      const status = r.from_cache
        ? '缓存'
        : r.ok
          ? `分析完成（提及=${r.result.brand_mentioned} 次数=${r.result.brand_mentions} 推荐=${r.result.brand_recommended} 排名=${r.result.brand_rank} 情绪=${r.result.sentiment}）`
          : `分析失败：${r.error.code}`;
      console.log(`[${done}/${samples.length}] ${sample.sample_id} ${sample.platform} ${status}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, samples.length) }, runNext));
  return results;
}

// ---------- 指标对比 ----------

function newConfusion() {
  return { tp: 0, fp: 0, fn: 0, tn: 0 };
}

function addConfusion(confusion, actual, expected) {
  if (actual && expected) confusion.tp += 1;
  else if (actual && !expected) confusion.fp += 1;
  else if (!actual && expected) confusion.fn += 1;
  else confusion.tn += 1;
}

function confusionSuccess(confusion) {
  return confusion.tp + confusion.tn;
}

function confusionTotal(confusion) {
  return confusion.tp + confusion.fp + confusion.fn + confusion.tn;
}

// Wilson 95% 置信区间：小样本下比正态近似更稳
function wilsonInterval(successes, total) {
  if (!total) return null;
  const z = 1.96;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total)) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function newFieldStats() {
  return {
    total: 0,
    mentioned: newConfusion(),
    recommended: newConfusion(),
    mentions: { exact: 0, within1: 0, absError: 0, signedError: 0 },
    rank: { evaluated: 0, exact: 0, falseRank: 0, missedRank: 0, wrongRank: 0 },
    sentiment: { evaluated: 0, correct: 0, confusion: {} }
  };
}

/**
 * 单条对比：label 为人工真值，actual 为任一分析来源
 * （当前重跑结果 / 生产已存指标），字段形状一致：
 * { brand_mentioned, brand_mentions, brand_recommended, brand_rank, sentiment }
 * 返回不一致字段列表。
 */
function addComparison(stats, label, actual) {
  const disagreements = [];
  stats.total += 1;

  const actualMentioned = Boolean(actual.brand_mentioned);
  const actualRecommended = Boolean(actual.brand_recommended);
  const actualRank = Number(actual.brand_rank) > 0 ? Number(actual.brand_rank) : null;
  const actualSentiment = String(actual.sentiment || 'neutral');

  addConfusion(stats.mentioned, actualMentioned, label.mentioned);
  if (actualMentioned !== label.mentioned) disagreements.push('mentioned');

  const actualMentions = actualMentioned ? Number(actual.brand_mentions || 0) : 0;
  stats.mentions.absError += Math.abs(actualMentions - label.mentions);
  stats.mentions.signedError += actualMentions - label.mentions;
  if (actualMentions === label.mentions) stats.mentions.exact += 1;
  if (Math.abs(actualMentions - label.mentions) <= 1) stats.mentions.within1 += 1;

  // issue 015：recommendation=null（语义 unavailable，如 S53）保留 unavailable，
  // 不进入 recommended 混淆（禁止当 false 计 FP/FN）——unavailable 与明确不推荐不同。
  if (label.recommended !== null) {
    addConfusion(stats.recommended, actualRecommended, label.recommended);
    if (actualRecommended !== label.recommended) disagreements.push('recommended');
  }

  if (label.rank !== null || actualRank !== null) {
    stats.rank.evaluated += 1;
    if (actualRank === label.rank) stats.rank.exact += 1;
    else {
      disagreements.push('rank');
      if (actualRank !== null && label.rank === null) stats.rank.falseRank += 1;
      else if (actualRank === null) stats.rank.missedRank += 1;
      else stats.rank.wrongRank += 1;
    }
  }

  if (label.sentiment !== null && actualMentioned) {
    stats.sentiment.evaluated += 1;
    const key = `${label.sentiment}→${actualSentiment}`;
    stats.sentiment.confusion[key] = (stats.sentiment.confusion[key] || 0) + 1;
    if (actualSentiment === label.sentiment) stats.sentiment.correct += 1;
    else disagreements.push('sentiment');
  }

  return disagreements;
}

function computeFieldStats(pairs) {
  const stats = newFieldStats();
  const rows = [];
  for (const pair of pairs) {
    const disagreements = addComparison(stats, pair.label, pair.actual);
    rows.push({ ...pair, disagreements });
  }
  return { stats, rows };
}

function groupByPlatform(pairs) {
  const groups = new Map();
  for (const pair of pairs) {
    const platform = pair.sample.platform;
    if (!groups.has(platform)) groups.set(platform, []);
    groups.get(platform).push(pair);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([platform, group]) => {
      const stats = computeFieldStats(group).stats;
      return { platform, n: group.length, stats };
    });
}

function entityKeys(entity) {
  return new Set([
    entity?.name,
    ...(Array.isArray(entity?.aliases) ? entity.aliases : []),
    ...(Array.isArray(entity?.surface_forms) ? entity.surface_forms : [])
  ].map(compact).filter(Boolean));
}

function setsOverlap(left, right) {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
}

function reviewMultiEntitySample(sample, label, analysis) {
  const truth = Array.isArray(label?.entity_labels_json) ? label.entity_labels_json : [];
  const structure = analysis?.analysis_structure || {};
  const targetName = String(structure.target_entity_name || '').trim();
  const relationMap = new Map((Array.isArray(analysis?.competition_entities)
    ? analysis.competition_entities
    : []).map((entity) => [compact(entity.name), entity]));
  const mentionMap = new Map((Array.isArray(structure.mentions) ? structure.mentions : [])
    .map((mention) => [
      compact(mention.entity_name),
      Array.isArray(mention.surface_forms) ? mention.surface_forms : []
    ]));
  const predicted = (Array.isArray(structure.entities) ? structure.entities : []).map((entity) => {
    const key = compact(entity.name);
    const relation = key === compact(targetName)
      ? 'target'
      : (relationMap.get(key)?.relation || 'non_competitor');
    return {
      name: entity.name,
      aliases: mentionMap.get(key) || [],
      surface_forms: mentionMap.get(key) || [],
      relation,
      mentions: key === compact(targetName)
        ? Number(analysis.brand_mentions || 0)
        : Number(relationMap.get(key)?.mentions || 0)
    };
  });
  const matches = new Map();
  for (const predictedEntity of predicted) {
    const predictedKeys = entityKeys(predictedEntity);
    const matched = truth.filter((truthEntity) => setsOverlap(predictedKeys, entityKeys(truthEntity)));
    matches.set(predictedEntity, matched);
  }
  const matchedTruth = new Set(
    [...matches.values()].flat().map((entity) => compact(entity.name))
  );
  const false_inclusions = predicted
    .filter((entity) => entity.relation === 'competitor')
    .filter((entity) => {
      const matched = matches.get(entity) || [];
      return !matched.some((truthEntity) => truthEntity.relation === 'competitor');
    })
    .map((entity) => entity.name);
  const false_exclusions = truth
    .filter((entity) => entity.relation === 'competitor')
    .filter((truthEntity) => !predicted.some((entity) => (
      entity.relation === 'competitor'
      && setsOverlap(entityKeys(entity), entityKeys(truthEntity))
    )))
    .map((entity) => entity.name);
  const alias_splits = truth
    .map((truthEntity) => ({
      name: truthEntity.name,
      predicted: predicted
        .filter((entity) => setsOverlap(entityKeys(entity), entityKeys(truthEntity)))
        .map((entity) => entity.name)
    }))
    .filter((item) => item.predicted.length > 1);
  const missing_entities = truth
    .filter((entity) => !matchedTruth.has(compact(entity.name)))
    .map((entity) => entity.name);
  const extra_entities = predicted
    .filter((entity) => !(matches.get(entity) || []).length)
    .map((entity) => entity.name);
  const truthCompetitorMentions = truth
    .filter((entity) => entity.relation === 'competitor')
    .reduce((sum, entity) => sum + entity.mentions, 0);
  const truthDenominator = label.mentions + truthCompetitorMentions;
  const truthSov = truthDenominator > 0
    ? Number(((label.mentions / truthDenominator) * 100).toFixed(2))
    : null;
  const predictedSov = analysis?.answer_competitor_share == null
    ? null
    : Number(analysis.answer_competitor_share);
  const sov_impact = truthSov === null || predictedSov === null
    ? null
    : Number((predictedSov - truthSov).toFixed(2));
  return {
    sample,
    truth,
    predicted,
    false_inclusions,
    false_exclusions,
    alias_splits,
    missing_entities,
    extra_entities,
    truth_sov: truthSov,
    predicted_sov: predictedSov,
    sov_impact
  };
}

function summarizeMultiEntityReviews(rows) {
  const valid = Array.isArray(rows) ? rows : [];
  const evaluated = valid.filter((row) => !row.analysis_failed);
  const isCalculable = (value) => value !== null
    && value !== undefined
    && Number.isFinite(Number(value));
  const comparable = evaluated.filter((row) => (
    isCalculable(row.truth_sov)
    && isCalculable(row.predicted_sov)
    && isCalculable(row.sov_impact)
  ));
  const truthCalculable = evaluated.filter((row) => isCalculable(row.truth_sov));
  const predictedCalculable = evaluated.filter((row) => isCalculable(row.predicted_sov));
  const calculabilityMismatches = evaluated.filter((row) => (
    isCalculable(row.truth_sov) !== isCalculable(row.predicted_sov)
  ));
  const mean = (items, selector) => items.length
    ? Number((items.reduce((sum, row) => sum + Number(selector(row)), 0) / items.length).toFixed(2))
    : null;
  const truthAggregateSov = mean(truthCalculable, (row) => row.truth_sov);
  const predictedAggregateSov = mean(predictedCalculable, (row) => row.predicted_sov);
  return {
    reviewed: valid.length,
    evaluated: evaluated.length,
    failed: valid.length - evaluated.length,
    sov_comparable: comparable.length,
    calculability_mismatches: calculabilityMismatches.length,
    truth_calculable: truthCalculable.length,
    predicted_calculable: predictedCalculable.length,
    false_inclusions: evaluated.reduce((sum, row) => sum + row.false_inclusions.length, 0),
    false_exclusions: evaluated.reduce((sum, row) => sum + row.false_exclusions.length, 0),
    alias_splits: evaluated.reduce((sum, row) => sum + row.alias_splits.length, 0),
    missing_entities: evaluated.reduce((sum, row) => sum + row.missing_entities.length, 0),
    extra_entities: evaluated.reduce((sum, row) => sum + row.extra_entities.length, 0),
    mean_absolute_sov_impact: mean(comparable, (row) => Math.abs(row.sov_impact)),
    truth_aggregate_sov: truthAggregateSov,
    predicted_aggregate_sov: predictedAggregateSov,
    aggregate_sov_bias: truthAggregateSov !== null && predictedAggregateSov !== null
      ? Number((predictedAggregateSov - truthAggregateSov).toFixed(2))
      : null
  };
}

function buildFailedMultiEntityReview(sample, label, analysis) {
  const competitorMentions = label.entity_labels_json
    .filter((entity) => entity.relation === 'competitor')
    .reduce((sum, entity) => sum + entity.mentions, 0);
  const denominator = label.mentions + competitorMentions;
  return {
    sample,
    analysis_failed: true,
    error_code: analysis?.error?.code || 'analysis_failed',
    false_inclusions: [],
    false_exclusions: [],
    alias_splits: [],
    missing_entities: [],
    extra_entities: [],
    truth_sov: denominator > 0
      ? Number(((label.mentions / denominator) * 100).toFixed(2))
      : null,
    predicted_sov: null,
    sov_impact: null
  };
}

/** 复现性对比：生产已存指标 vs 当前重跑（同 analysis_method + 同模型） */
function computeReproducibility(pairs) {
  const fields = {
    mentioned: { agree: 0 },
    mentions: { agree: 0 },
    recommended: { agree: 0 },
    rank: { agree: 0 },
    sentiment: { agree: 0 }
  };
  const disagreements = [];
  for (const { sample, stored, rerun } of pairs) {
    const storedRank = Number(stored.brand_rank) > 0 ? Number(stored.brand_rank) : null;
    const rerunRank = Number(rerun.brand_rank) > 0 ? Number(rerun.brand_rank) : null;
    const checks = {
      mentioned: Boolean(stored.brand_mentioned) === Boolean(rerun.brand_mentioned),
      mentions: Number(stored.brand_mentions || 0) === Number(rerun.brand_mentions || 0),
      recommended: Boolean(stored.brand_recommended) === Boolean(rerun.brand_recommended),
      rank: storedRank === rerunRank,
      sentiment: String(stored.sentiment) === String(rerun.sentiment)
    };
    const diff = Object.entries(checks).filter(([, agree]) => !agree).map(([field]) => field);
    Object.entries(checks).forEach(([field, agree]) => {
      if (agree) fields[field].agree += 1;
    });
    if (diff.length) {
      disagreements.push({
        sample,
        fields: diff,
        stored: `提及=${stored.brand_mentioned} 次数=${stored.brand_mentions} 推荐=${stored.brand_recommended} 排名=${storedRank} 情绪=${stored.sentiment}`,
        rerun: `提及=${rerun.brand_mentioned} 次数=${rerun.brand_mentions} 推荐=${rerun.brand_recommended} 排名=${rerunRank} 情绪=${rerun.sentiment}`
      });
    }
  }
  return { total: pairs.length, fields, disagreements };
}

// ---------- 报告 ----------

function pct(part, total) {
  return total ? `${((part / total) * 100).toFixed(1)}%` : '—';
}

/** "85.0%（95% CI 70.2–94.3%，n=40）" */
function fmtRateCI(successes, total) {
  if (!total) return '—';
  const interval = wilsonInterval(successes, total);
  const ci = interval
    ? `（95% CI ${(interval[0] * 100).toFixed(1)}–${(interval[1] * 100).toFixed(1)}%，n=${total}）`
    : '';
  return `${pct(successes, total)}${ci}`;
}

function confusionTable(confusion) {
  return `| | 预测 yes | 预测 no |
| --- | --- | --- |
| **真值 yes** | ${confusion.tp} | ${confusion.fn} |
| **真值 no** | ${confusion.fp} | ${confusion.tn} |`;
}

function fieldStatsSummary(stats, n) {
  return `提及准确率 ${fmtRateCI(confusionSuccess(stats.mentioned), n)}；`
    + `推荐准确率 ${fmtRateCI(confusionSuccess(stats.recommended), n)}；`
    + `次数完全一致率 ${pct(stats.mentions.exact, stats.total)}；`
    + `排名一致率 ${pct(stats.rank.exact, stats.rank.evaluated)}（${stats.rank.evaluated} 条有榜）；`
    + `情绪一致率 ${pct(stats.sentiment.correct, stats.sentiment.evaluated)}（${stats.sentiment.evaluated} 条已提及）`;
}

function buildReport({
  samples,
  analyses,
  rerunRows,
  rerunStats,
  storedStats,
  storedCount,
  reproducibility,
  platformBreakdown,
  analysisFailures,
  via,
  multiEntityRows,
  multiEntitySummary,
  human_review_confirmed,
  partial
}) {
  const evaluated = rerunStats.total;
  const models = [...new Set(analyses.filter((a) => a?.analysis_model).map((a) => `${a.analysis_platform}/${a.analysis_model}`))];
  const lines = [];
  lines.push(`# GEO 基线测量报告

> 生成时间：${new Date().toISOString()}
> 分析方法：${ANALYSIS_METHOD}；分析模型：${models.join('、') || '—'}；分析器来源：${via}
> 结构版本：${CURRENT_STRUCTURE_VERSION}；指标语义：${CURRENT_METRIC_SEMANTICS}
> 样本数：${samples.length}；重跑成功：${evaluated}；重跑失败：${analysisFailures}；含生产已存指标：${storedCount}
> human_review_confirmed：${human_review_confirmed ? 'yes' : 'no'}；报告状态：${partial ? 'partial（非正式结论）' : '人工确认完成'}

## 能力边界声明

n=${evaluated} 的样本量能**发现明显错误**（如实测准确率 70%，CI 上限也到不了 90%），
但**不能认证达标**（38/40 正确时 Wilson 95% 下限仅约 84%）。
本报告用途：发现错误、校准标注规范、建立可累积的基线资产。
"是否达标"的正式结论交给按月累积样本后的后续评测。
${partial ? '\n> 本报告由 `--allow-partial` 生成，只包含已完整标注样本，未完成人工确认，不得作为正式结论。\n' : ''}

## 一、当前分析配置 vs 人工真值（重跑）

| 字段 | 指标 | 结果 | 参考判读 |
| --- | --- | --- | --- |
| 分析可用性 | 失败率 | ${pct(analysisFailures, samples.length)} | >5% 说明管线本身不稳定 |
| brand_mentioned | 准确率 | ${fmtRateCI(confusionSuccess(rerunStats.mentioned), evaluated)} | 应 ≥95% |
| brand_mentions | 完全一致率 / ±1 容差率 / MAE | ${pct(rerunStats.mentions.exact, evaluated)} / ${pct(rerunStats.mentions.within1, evaluated)} / ${(rerunStats.mentions.absError / Math.max(1, evaluated)).toFixed(2)} | ±1 容差率应 ≥90% |
| brand_recommended | 准确率 | ${fmtRateCI(confusionSuccess(rerunStats.recommended), evaluated)} | <90% 需收紧 prompt 或加证据锚定 |
| brand_rank | 一致率（${rerunStats.rank.evaluated} 条有榜样本） | ${pct(rerunStats.rank.exact, rerunStats.rank.evaluated)} | 误报榜 ${rerunStats.rank.falseRank}，漏榜 ${rerunStats.rank.missedRank}，错名次 ${rerunStats.rank.wrongRank} |
| sentiment | 一致率（${rerunStats.sentiment.evaluated} 条已提及样本） | ${pct(rerunStats.sentiment.correct, rerunStats.sentiment.evaluated)} | 方向性指标，≥85% 可用 |

### brand_mentioned 混淆矩阵（重跑）

${confusionTable(rerunStats.mentioned)}

### brand_recommended 混淆矩阵（重跑）

${confusionTable(rerunStats.recommended)}

> 推荐判定解读：FP（分析说推荐、人认为只是列举）偏高 → 指标虚高；FN 偏高 → 指标虚低。

### sentiment 混淆（真值→预测，重跑）

${Object.entries(rerunStats.sentiment.confusion).map(([key, count]) => `- ${key}：${count}`).join('\n') || '—'}

## 二、生产已存指标 vs 人工真值（历史看板数据的可信度）

${storedCount ? fieldStatsSummary(storedStats, storedCount) : '样本中没有已存指标可对比。'}

## 三、复现性：生产已存指标 vs 当前重跑（同方法、同模型）

${reproducibility.total ? `共 ${reproducibility.total} 条双料样本。逐字段一致率：
${Object.entries(reproducibility.fields).map(([field, value]) => `- ${field}：${pct(value.agree, reproducibility.total)}`).join('\n')}

> 一致率 <100% 的字段即"temperature=0 不等于确定性"的实测证据。` : '无双料样本。'}

${reproducibility.disagreements.length ? `不一致明细：
${reproducibility.disagreements.map((item) => `- ${item.sample.sample_id}（${item.fields.join('、')}）：已存 ${item.stored}；重跑 ${item.rerun}`).join('\n')}` : ''}

## 四、分平台分层（小样本，只展示、不下强结论）

| 平台 | n | 提及准确率 | 推荐准确率 |
| --- | --- | --- | --- |
${platformBreakdown.map((row) => `| ${row.platform} | ${row.n} | ${pct(confusionSuccess(row.stats.mentioned), row.n)} | ${pct(confusionSuccess(row.stats.recommended), row.n)} |`).join('\n')}

## 五、多实体竞品关系复核

已完成 ${multiEntitySummary.reviewed} 条多实体真值复核；分析成功 ${multiEntitySummary.evaluated} 条；分析失败 ${multiEntitySummary.failed} 条。分析成功样本中，错误纳入 ${multiEntitySummary.false_inclusions} 个，错误排除 ${multiEntitySummary.false_exclusions} 个，别名拆分 ${multiEntitySummary.alias_splits} 个，漏抽取 ${multiEntitySummary.missing_entities} 个，多抽取 ${multiEntitySummary.extra_entities} 个。

SOV 数值可比 ${multiEntitySummary.sov_comparable} 条，可计算性错配 ${multiEntitySummary.calculability_mismatches} 条。仅在双方都可计算的样本上，SOV 绝对误差均值为 ${multiEntitySummary.mean_absolute_sov_impact == null ? '—' : `${multiEntitySummary.mean_absolute_sov_impact} 个百分点`}。按各自可计算样本聚合，人工 SOV 为 ${multiEntitySummary.truth_aggregate_sov == null ? '—' : `${multiEntitySummary.truth_aggregate_sov}%（n=${multiEntitySummary.truth_calculable}）`}，分析 SOV 为 ${multiEntitySummary.predicted_aggregate_sov == null ? '—' : `${multiEntitySummary.predicted_aggregate_sov}%（n=${multiEntitySummary.predicted_calculable}）`}，聚合偏差为 ${multiEntitySummary.aggregate_sov_bias == null ? '—' : `${multiEntitySummary.aggregate_sov_bias > 0 ? '+' : ''}${multiEntitySummary.aggregate_sov_bias} 个百分点`}。

| 样本 | 错误纳入 | 错误排除 | 别名拆分 | 漏抽取 / 多抽取 | 人工 SOV | 分析 SOV | SOV 影响 |
| --- | --- | --- | --- | --- | --- | --- | --- |
${multiEntityRows.map((row) => row.analysis_failed
    ? `| ${row.sample.sample_id} | 不可评估 | 不可评估 | 不可评估 | 分析失败（${row.error_code}） | ${row.truth_sov == null ? 'N/A' : `${row.truth_sov}%`} | N/A | N/A |`
    : `| ${row.sample.sample_id} | ${row.false_inclusions.join('、') || '—'} | ${row.false_exclusions.join('、') || '—'} | ${row.alias_splits.map((item) => `${item.name}→${item.predicted.join('/')}`).join('、') || '—'} | ${row.missing_entities.join('、') || '—'} / ${row.extra_entities.join('、') || '—'} | ${row.truth_sov == null ? 'N/A' : `${row.truth_sov}%`} | ${row.predicted_sov == null ? 'N/A' : `${row.predicted_sov}%`} | ${row.sov_impact == null ? 'N/A' : `${row.sov_impact > 0 ? '+' : ''}${row.sov_impact}pp`} |`).join('\n')}

> “约 10%”只作为人工评审时的观察参考，不是生产门禁、配置或运行时判断条件。

## 六、不一致明细（重跑 vs 真值，逐条复核用）

| 样本 | 平台 | 不一致字段 | 人工标注 | 分析结果 |
| --- | --- | --- | --- | --- |`);

  for (const row of rerunRows) {
    if (!row.disagreements.length) continue;
    const actual = row.actual
      ? `提及=${row.actual.brand_mentioned} 次数=${row.actual.brand_mentions} 推荐=${row.actual.brand_recommended} 排名=${row.actual.brand_rank} 情绪=${row.actual.sentiment}`
      : '分析失败';
    const expected = `提及=${row.label.mentioned} 次数=${row.label.mentions} 推荐=${row.label.recommended} 排名=${row.label.rank} 情绪=${row.label.sentiment}`;
    lines.push(`| ${row.sample.sample_id} | ${row.sample.platform} | ${row.disagreements.join('、')} | ${expected} | ${actual} |`);
  }

  lines.push(`
## 复核建议

1. 先复核不一致明细：在 LABELING.md 中找到对应样本，确认是分析错误还是标注口径问题；标注可修正后重跑本脚本（分析结果走缓存，不重复调用 API）。
2. 复核完成后，以上一致率即为各字段的可信度初基线；随样本按月累积，CI 会逐步收窄。
3. 后续改动分析 prompt、加证据锚定或更换模型时，重跑 \`--refresh\` 即可得到可对比的新基线。
`);
  return lines.join('\n');
}

// ---------- 主流程 ----------

async function main() {
  const options = parseArgs();
  initPaths(options.dir, options.experimentName);
  if (!fs.existsSync(PATHS.samples)) {
    console.error('未找到 samples.json，请先运行 geoBaselineSample.js');
    process.exit(1);
  }
  fs.mkdirSync(PATHS.raw, { recursive: true });
  const samples = JSON.parse(fs.readFileSync(PATHS.samples, 'utf8'));
  const { analyzer, via } = await buildAnalyzer(options);
  console.log(`分析器来源：${via}`);

  let targetSamples = samples;
  let labels = new Map();

  if (options.warmCache) {
    targetSamples = options.limit ? samples.slice(0, options.limit) : samples;
    console.log(`预热模式：对 ${targetSamples.length} 条样本运行分析（不读标注、不写报告）`);
  } else {
    const parsedLabels = parseLabels();
    const { problems, usable } = validateLabels(
      samples,
      parsedLabels.labels,
      options.allowPartial,
      parsedLabels.human_review_confirmed
    );
    if (problems.length) {
      console.error(`标注问题 ${problems.length} 处：`);
      problems.forEach((problem) => console.error(`  - ${problem}`));
      console.error('修正后重跑；或用 --allow-partial 只评测已完整标注的样本。');
      process.exit(1);
    }
    labels = usable;
    targetSamples = samples.filter((sample) => labels.has(sample.sample_id));
    if (!targetSamples.length) {
      console.error('没有可评测的完整人工标注样本');
      process.exit(1);
    }
    options.humanReviewConfirmed = parsedLabels.human_review_confirmed;
    console.log(`已标注样本 ${targetSamples.length}/${samples.length}，开始分析（并发 ${CONCURRENCY}）...`);
  }

  const analyses = await runWithConcurrency(
    targetSamples,
    (sample) => analyzeSample(sample, options.refresh, analyzer, via),
    CONCURRENCY
  );

  if (options.warmCache) {
    const ok = analyses.filter((item) => item.ok).length;
    console.log(`预热完成：成功 ${ok}，失败 ${analyses.length - ok}。缓存目录：${PATHS.raw}`);
    await require('../config/database').close();
    return;
  }

  // 已存生产指标（用户历史看板实际看到的数字）
  const recordIds = targetSamples.map((sample) => sample.question_record_id);
  const storedRows = await VisibilityMetric.findAll({ where: { question_record_id: recordIds } });
  const storedMap = new Map(storedRows.map((row) => [
    row.question_record_id,
    row.toJSON ? row.toJSON() : row
  ]));
  targetSamples.forEach((sample) => {
    if (sample.stored_metric && !storedMap.has(sample.question_record_id)) {
      storedMap.set(sample.question_record_id, sample.stored_metric);
    }
  });

  const rerunPairs = [];
  let analysisFailures = 0;
  for (const sample of targetSamples) {
    const analysis = analyses.find((item) => item.sample_id === sample.sample_id);
    if (!analysis || !analysis.ok) {
      analysisFailures += 1;
      rerunPairs.push({
        sample,
        label: labels.get(sample.sample_id),
        actual: null,
        analysis,
        disagreements: ['分析失败']
      });
      continue;
    }
    rerunPairs.push({
      sample,
      label: labels.get(sample.sample_id),
      actual: analysis.result,
      analysis
    });
  }
  const { stats: rerunStats, rows: rerunRows } = computeFieldStats(
    rerunPairs.filter((pair) => pair.actual)
  );
  // 把分析失败的行并回明细行，保持报告完整
  const allRerunRows = rerunPairs.map((pair) => (
    pair.actual
      ? rerunRows.find((row) => row.sample.sample_id === pair.sample.sample_id)
      : pair
  ));

  const storedPairs = targetSamples
    .filter((sample) => storedMap.has(sample.question_record_id))
    .map((sample) => ({
      sample,
      label: labels.get(sample.sample_id),
      actual: storedMap.get(sample.question_record_id)
    }));
  const { stats: storedStats } = computeFieldStats(storedPairs);

  const reproPairs = targetSamples
    .map((sample) => {
      const analysis = analyses.find((item) => item.sample_id === sample.sample_id);
      const stored = storedMap.get(sample.question_record_id);
      return analysis?.ok && stored ? { sample, stored, rerun: analysis.result } : null;
    })
    .filter(Boolean);
  const reproducibility = computeReproducibility(reproPairs);

  const platformBreakdown = groupByPlatform(rerunPairs.filter((pair) => pair.actual));
  const multiEntityRows = rerunPairs
    .filter((pair) => pair.sample.multi_entity_review)
    .map((pair) => pair.actual
      ? reviewMultiEntitySample(pair.sample, pair.label, pair.actual)
      : buildFailedMultiEntityReview(pair.sample, pair.label, pair.analysis));
  const multiEntitySummary = summarizeMultiEntityReviews(multiEntityRows);

  const report = buildReport({
    samples: targetSamples,
    analyses,
    rerunRows: allRerunRows,
    rerunStats,
    storedStats,
    storedCount: storedPairs.length,
    reproducibility,
    platformBreakdown,
    analysisFailures,
    via,
    multiEntityRows,
    multiEntitySummary,
    human_review_confirmed: options.humanReviewConfirmed,
    partial: options.allowPartial
  });
  const reportPath = options.allowPartial ? PATHS.partialReport : PATHS.report;
  fs.writeFileSync(reportPath, report);

  const evaluated = rerunStats.total;
  console.log('\n===== 基线结果（重跑 vs 真值）=====');
  console.log(`分析失败：${analysisFailures}/${targetSamples.length}`);
  console.log(`brand_mentioned 准确率：${fmtRateCI(confusionSuccess(rerunStats.mentioned), evaluated)}`);
  console.log(`brand_mentions 完全一致率：${pct(rerunStats.mentions.exact, evaluated)}，±1 容差率：${pct(rerunStats.mentions.within1, evaluated)}`);
  console.log(`brand_recommended 准确率：${fmtRateCI(confusionSuccess(rerunStats.recommended), evaluated)}（FP=${rerunStats.recommended.fp} FN=${rerunStats.recommended.fn}）`);
  console.log(`brand_rank 一致率：${pct(rerunStats.rank.exact, rerunStats.rank.evaluated)}（误报榜=${rerunStats.rank.falseRank} 漏榜=${rerunStats.rank.missedRank} 错名次=${rerunStats.rank.wrongRank}）`);
  console.log(`sentiment 一致率：${pct(rerunStats.sentiment.correct, rerunStats.sentiment.evaluated)}`);
  console.log(`已存指标 vs 真值：${fieldStatsSummary(storedStats, storedPairs.length)}`);
  console.log(`复现性（已存 vs 重跑，${reproducibility.total} 条）：${Object.entries(reproducibility.fields).map(([field, value]) => `${field} ${pct(value.agree, reproducibility.total)}`).join('，')}`);
  console.log(`多实体复核：${multiEntitySummary.reviewed} 条（分析成功 ${multiEntitySummary.evaluated}，SOV 数值可比 ${multiEntitySummary.sov_comparable}，可计算性错配 ${multiEntitySummary.calculability_mismatches}，分析失败 ${multiEntitySummary.failed}），错误纳入 ${multiEntitySummary.false_inclusions}，错误排除 ${multiEntitySummary.false_exclusions}，别名拆分 ${multiEntitySummary.alias_splits}，成对可比 SOV 绝对误差均值 ${multiEntitySummary.mean_absolute_sov_impact ?? '—'}pp，聚合偏差 ${multiEntitySummary.aggregate_sov_bias ?? '—'}pp`);
  console.log(`报告：${reportPath}`);

  await require('../config/database').close();
}

if (require.main === module) {
  main().catch((error) => {
    console.error('评测失败：', error);
    process.exit(1);
  });
}

module.exports = {
  buildAnalyzer,
  buildReport,
  buildFailedMultiEntityReview,
  computeFieldStats,
  initPaths,
  parseArgs,
  parseEntityLabels,
  parseLabels,
  recalculateCachedResult,
  reviewMultiEntitySample,
  summarizeMultiEntityReviews,
  validateLabels,
  wilsonInterval
};
