#!/usr/bin/env node
const path = require('node:path');

const databaseArgIndex = process.argv.indexOf('--database');
process.env.DB_STORAGE = databaseArgIndex >= 0
  ? path.resolve(process.argv[databaseArgIndex + 1])
  : path.resolve(__dirname, '../database.sqlite');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const fs = require('node:fs');
const AIPlatformConfigService = require('../services/AIPlatformConfigService');
const AIPlatformRequestService = require('../services/AIPlatformRequestService');
const { AIResponseAnalysisService } = require('../services/AIResponseAnalysisService');
const {
  AIResponseEntityExtractionService
} = require('../services/AIResponseEntityExtractionService');
const {
  AIResponseSemanticJudgmentService
} = require('../services/AIResponseSemanticJudgmentService');
const {
  AIResponseAnalysisV5Service
} = require('../services/AIResponseAnalysisV5Service');
const { calculate: calculateV5 } = require('../services/AIResponseAnalysisV5Service');
const { createSourceMap } = require('../services/AIAnalysisSourceMapService');
const { buildTargetMentions } = require('../services/AIEntityCatalogService');
const {
  computeFieldStats,
  initPaths,
  parseLabels,
  wilsonInterval
} = require('./geoBaselineEvaluate');
const { buildCacheKey } = require('./geoFlashStructuredCorpus');
const { summarizeArm } = require('../services/GeoFlashStructuredBenchmarkService');
const { ENTITY_PROMPT_REVISION } = require('../services/AIResponseEntityExtractionService');
const { SEMANTIC_PROMPT_REVISION, SEMANTIC_PROMPT_REVISION_REV2 } = require('../services/AIResponseSemanticJudgmentService');

const EXPERIMENT_REVISION = 'three_track_partial_v1';

function cacheIdentityFor(arm) {
  if (arm === 'v5-json' || arm === 'v5-json-rev2') {
    return {
      promptRevision: `${ENTITY_PROMPT_REVISION}+${arm === 'v5-json-rev2' ? SEMANTIC_PROMPT_REVISION_REV2 : SEMANTIC_PROMPT_REVISION}`,
      model: 'deepseek-v4-flash',
      requestPolicy: { temperature: 0, thinking: 'disabled', response_format: 'json_object' },
      experimentRevision: EXPERIMENT_REVISION
    };
  }
  const singleton = require('../services/AIResponseAnalysisService');
  const definition = singleton.getPromptDefinition();
  return {
    promptRevision: definition.prompt_revision,
    model: 'deepseek-v4-flash',
    requestPolicy: arm === 'v4-temperature-zero'
      ? { temperature: 0 }
      : { temperature: 'default' },
    experimentRevision: EXPERIMENT_REVISION
  };
}

const {
  MIN_EVALUABLE_SAMPLES,
  entityQualityStats,
  fieldStatusDistribution,
  groundingEvidenceStats,
  rankQualityStats,
  recommendationQualityStats,
  relationQualityStats,
  semanticTruthCoverage,
  sentimentQualityStats,
  targetMappingQualityStats,
  validateTruthEntry
} = require('../services/GeoFlashStructuredBenchmarkService');
// v5-json-rev2：014 最后一轮 A/B 修订臂，阶段 2 提示词仅改情绪规则
// （推荐与情绪独立、肯定性描述判 positive、组合示例；删除 rev1 的"综合性较强"孤立示例），
// 其余管线与 v5-json 完全一致。此为该系列最后一轮，不再有 rev3/rev4。
const SUPPORTED_ARMS = new Set(['v4-current', 'v4-temperature-zero', 'v5-json', 'v5-json-rev2']);
const DEFAULT_BASELINE_DIR = path.resolve(__dirname, '../../work/geo-baseline-2026-07-28');
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, '../../work/geo-flash-structured-2026-08-05');
const DEFAULT_CHALLENGE_ARTIFACT = path.resolve(
  __dirname,
  '../../work/diagnostics/real-ai-structure-2026-08-05T01-54-10-701Z.json'
);

function parseArgs(argv = process.argv.slice(2)) {
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : null;
  };
  const arms = String(value('--arms') || 'v4-current,v4-temperature-zero,v5-json')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!arms.length || arms.some((arm) => !SUPPORTED_ARMS.has(arm))) {
    throw new Error(`--arms 只允许 ${[...SUPPORTED_ARMS].join(',')}`);
  }
  const repeats = Number(value('--repeats') || 3);
  const concurrency = Number(value('--concurrency') || 3);
  const limitValue = value('--limit');
  const limit = limitValue == null ? null : Number(limitValue);
  const sampleIds = String(value('--sample-ids') || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) {
    throw new Error('--repeats 必须是 1 至 10 的整数');
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5) {
    throw new Error('--concurrency 必须是 1 至 5 的整数');
  }
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error('--limit 必须是正整数');
  }
  return {
    arms: [...new Set(arms)],
    repeats,
    concurrency,
    limit,
    sampleIds: [...new Set(sampleIds)],
    refresh: argv.includes('--refresh'),
    recalculateCached: argv.includes('--recalculate-cached'),
    baselineDir: path.resolve(value('--dir') || DEFAULT_BASELINE_DIR),
    outputDir: path.resolve(value('--out') || DEFAULT_OUTPUT_DIR),
    challengeArtifact: path.resolve(value('--challenge-artifact') || DEFAULT_CHALLENGE_ARTIFACT)
  };
}

/**
 * issue 013 P1 修复：truth.jsonl 严格加载（fail-closed）。
 * 校验 schema、唯一 sample_id、answer_sha256 与冻结回答一致、span 可定位、
 * relation 引用有效、confirmed 必须带复核元数据；任一错误都终止评测，
 * 不允许坏记录静默进入评分。
 */
function loadTruth(options) {
  const truthPath = path.join(options.baselineDir, 'truth.jsonl');
  if (!fs.existsSync(truthPath)) return { map: new Map(), errors: [] };
  const samples = JSON.parse(fs.readFileSync(path.join(options.baselineDir, 'samples.json'), 'utf8'));
  const sampleById = new Map(samples.map((sample) => [sample.sample_id, sample]));
  const entries = [];
  fs.readFileSync(truthPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line, index) => {
      try {
        entries.push({ line: index + 1, entry: JSON.parse(line) });
      } catch (_) {
        entries.push({ line: index + 1, entry: null, parse_error: true });
      }
    });
  const errors = [];
  const truthBySample = new Map();
  entries.forEach(({ line, entry, parse_error }) => {
    if (parse_error) {
      errors.push(`truth.jsonl 第 ${line} 行不是合法 JSON`);
      return;
    }
    if (!entry?.sample_id) {
      errors.push(`truth.jsonl 第 ${line} 行缺少 sample_id`);
      return;
    }
    if (truthBySample.has(entry.sample_id)) {
      errors.push(`truth.jsonl 重复 sample_id: ${entry.sample_id}`);
      return;
    }
    const entryErrors = validateTruthEntry(entry, sampleById);
    if (entryErrors.length) {
      errors.push(`truth.jsonl ${entry.sample_id}: ${entryErrors.join('; ')}`);
    }
    truthBySample.set(entry.sample_id, entry);
  });
  return { map: truthBySample, errors };
}

function loadCorpus(options) {
  const samples = JSON.parse(
    fs.readFileSync(path.join(options.baselineDir, 'samples.json'), 'utf8')
  );
  initPaths(options.baselineDir);
  const parsedLabels = parseLabels();
  if (!parsedLabels.human_review_confirmed) {
    throw new Error('现有真实语料尚未完成人工确认');
  }
  const labels = new Map(parsedLabels.labels);
  // issue 013 P0-1 修复：LABELING.md 的全局 human_review_confirmed 只覆盖旧主语料。
  // 补充样本（supplement: true）的标签必须由 truth.jsonl 的 confirmed 记录提供，
  // 在 main 中合并；这里先删除 LABELING 解析出的补充样本标签，防止泄漏进目标评分。
  samples.filter((sample) => sample.supplement).forEach((sample) => {
    labels.delete(sample.sample_id);
  });
  const hashes = new Set(samples.map((sample) => sample.response_text));
  if (fs.existsSync(options.challengeArtifact)) {
    const artifact = JSON.parse(fs.readFileSync(options.challengeArtifact, 'utf8'));
    if (artifact.answer_text && !hashes.has(artifact.answer_text)) {
      samples.push({
        sample_id: 'C01',
        question_record_id: null,
        project_id: null,
        platform: 'doubao-web',
        question: artifact.question,
        brand: {
          name: '广拓',
          aliases: ['上海广拓', 'GATO'],
          primary_keywords: ['电子围栏', '振动光纤', '激光对射', '电磁感知电缆', '周界报警']
        },
        competitors: [],
        response_text: artifact.answer_text,
        multi_entity_review: false,
        challenge: 'target_absent_long_multi_category_english_alias'
      });
      labels.set('C01', {
        mentioned: false,
        mentions: 0,
        recommended: false,
        rank: null,
        sentiment: null
      });
    }
  }
  return { samples, labels };
}

function armPlatform(basePlatform, arm) {
  return {
    ...basePlatform,
    enabled: true,
    default_model: 'deepseek-v4-flash',
    analysis_request_options: arm === 'v4-temperature-zero'
      ? { temperature: 0 }
      : {}
  };
}

function createCapturingRequestService(calls) {
  return {
    async queryConfig(platform, prompt, options) {
      const startedAt = Date.now();
      const result = await AIPlatformRequestService.queryConfig(platform, prompt, options);
      calls.push({
        success: Boolean(result?.success),
        error_code: result?.error_code || null,
        model_name: result?.model_name || platform?.default_model || null,
        duration_ms: Date.now() - startedAt,
        finish_reason: result?.data?.choices?.[0]?.finish_reason || null,
        usage: result?.data?.usage || null,
        prompt_length: String(prompt || '').length,
        request_options: options?.requestOptions || null,
        output_length: String(result?.text || '').length,
        output: result?.text || null
      });
      return result;
    }
  };
}

function createAnalyzer({ arm, basePlatform, calls }) {
  const platform = armPlatform(basePlatform, arm);
  const configService = { getAnalysisPlatform: async () => platform };
  const requestService = createCapturingRequestService(calls);
  if (arm === 'v5-json' || arm === 'v5-json-rev2') {
    return new AIResponseAnalysisV5Service({
      entityExtractionService: new AIResponseEntityExtractionService({
        configService,
        requestService
      }),
      semanticJudgmentService: new AIResponseSemanticJudgmentService({
        configService,
        requestService,
        promptRevision: arm === 'v5-json-rev2' ? 'rev2' : null
      })
    });
  }
  return new AIResponseAnalysisService({ configService, requestService });
}

function resultPath(options, arm, repeat, sampleId) {
  return path.join(
    options.outputDir,
    'runs',
    arm,
    `repeat-${String(repeat).padStart(2, '0')}`,
    `${sampleId}.json`
  );
}

function readCachedResult(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function recalculateCachedV5Entry(entry, sample) {
  if (!entry?.ok || entry.arm !== 'v5-json' || !entry.result?.analysis_structure) return entry;
  const structure = entry.result.analysis_structure;
  const sourceMap = createSourceMap(sample.response_text);
  const mentions = Array.isArray(structure.mentions) ? structure.mentions : [];
  const catalog = {
    target_entity_id: structure.target_entity_id || null,
    target_mentions: structure.target_entity_id
      ? buildTargetMentions(sourceMap, sample.brand)
      : [],
    entities: (Array.isArray(structure.entities) ? structure.entities : []).map((entity) => ({
      ...entity,
      mentions: mentions
        .filter((mention) => mention.entity_id === entity.entity_id)
        .map(({ entity_id: _entityId, ...mention }) => mention)
    }))
  };
  const semantic = {
    competitor_relations: structure.competitor_relations || [],
    candidate_groups: structure.candidate_groups || [],
    recommendations: structure.recommendations || [],
    sentiment: structure.sentiment
  };
  const calculated = calculateV5({
    sourceMap,
    catalog,
    semantic,
    diagnostics: structure.diagnostics?.stages || []
  });
  return {
    ...entry,
    result: {
      ...entry.result,
      ...calculated
    },
    recalculated_at: new Date().toISOString()
  };
}

async function runEntry({ sample, arm, repeat, basePlatform, options }) {
  const filePath = resultPath(options, arm, repeat, sample.sample_id);
  const cacheKey = buildCacheKey({ sample, arm, repeat, ...cacheIdentityFor(arm) });
  if (!options.refresh) {
    const cached = readCachedResult(filePath);
    if (
      cached?.sample_id === sample.sample_id
      && cached?.arm === arm
      && cached?.repeat === repeat
      && cached?.cache_key === cacheKey
    ) {
      const normalized = options.recalculateCached && arm === 'v5-json'
        ? recalculateCachedV5Entry(cached, sample)
        : cached;
      if (normalized !== cached) fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2));
      return { ...normalized, from_cache: true };
    }
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const calls = [];
  const analyzer = createAnalyzer({ arm, basePlatform, calls });
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  let entry;
  try {
    const result = await analyzer.analyze({
      question: sample.question,
      responseText: sample.response_text,
      brand: sample.brand
    });
    entry = {
      sample_id: sample.sample_id,
      arm,
      repeat,
      cache_key: cacheKey,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedMs,
      total_tokens: calls.reduce(
        (total, call) => total + (Number(call?.usage?.total_tokens) || 0),
        0
      ),
      ok: true,
      result,
      calls
    };
  } catch (error) {
    entry = {
      sample_id: sample.sample_id,
      arm,
      repeat,
      cache_key: cacheKey,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedMs,
      total_tokens: calls.reduce(
        (total, call) => total + (Number(call?.usage?.total_tokens) || 0),
        0
      ),
      ok: false,
      error: {
        name: error?.name || 'Error',
        code: error?.code || 'unknown',
        message: error?.message || 'unknown',
        details: error?.details || null
      },
      calls
    };
  }
  fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
  return entry;
}

async function runWithConcurrency(tasks, worker, concurrency, onProgress) {
  const results = new Array(tasks.length);
  let cursor = 0;
  let completed = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= tasks.length) return;
        results[index] = await worker(tasks[index]);
        completed += 1;
        onProgress(completed, tasks.length, results[index]);
      }
    }
  );
  await Promise.all(runners);
  return results;
}

function percentage(value) {
  return value == null ? '—' : `${(value * 100).toFixed(2)}%`;
}

function targetMappingTruthCount(truthBySample = new Map()) {
  let count = 0;
  truthBySample.forEach((truth) => {
    if (truth?.review_status === 'confirmed' && truth.target_mapping?.status) count += 1;
  });
  return count;
}

function targetStatsForEntries(entries, labels) {
  const pairs = entries
    .filter((entry) => entry.ok && labels.has(entry.sample_id))
    .map((entry) => ({
      sample: { sample_id: entry.sample_id },
      label: labels.get(entry.sample_id),
      actual: entry.result
    }));
  return computeFieldStats(pairs).stats;
}

function buildReport({ options, samples, labels, entries, summaries, truthBySample = new Map() }) {
  const lines = [
    '# DeepSeek Flash 结构化分析真实对比报告',
    '',
    `- 生成时间：${new Date().toISOString()}`,
    `- 模型：deepseek-v4-flash`,
    `- 样本：${samples.length} 条真实完整回答`,
    `- 重复：每臂每样本 ${options.repeats} 次`,
    `- 实验臂：${options.arms.join('、')}`,
    '',
    '## 核心结果',
    '',
    '| 实验臂 | 完成率 | 目标出现准确率 | 目标假阳性 | 目标核心稳定率 | 竞品集合 Jaccard 中位 | Token 中位 | P95 耗时 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
  ];
  options.arms.forEach((arm) => {
    const summary = summaries[arm];
    lines.push(`| ${arm} | ${summary.completed}/${summary.total}（${percentage(summary.completion_rate)}） | ${summary.target_presence_correct}/${summary.target_presence_evaluated}（${percentage(summary.target_presence_accuracy)}） | ${summary.target_false_positives} | ${summary.stability_agreements}/${summary.stability_pairs}（${percentage(summary.stability_rate)}） | ${percentage(summary.competition_jaccard?.median)} | ${summary.tokens.median ?? '—'} | ${summary.latency_ms.p95 == null ? '—' : Math.round(summary.latency_ms.p95)}ms |`);
  });
  lines.push('', '## 目标品牌人工真值对比', '');
  options.arms.forEach((arm) => {
    const armEntries = entries.filter((entry) => entry.arm === arm);
    const stats = targetStatsForEntries(armEntries, labels);
    const mentionedCorrect = stats.mentioned.tp + stats.mentioned.tn;
    const recommendedCorrect = stats.recommended.tp + stats.recommended.tn;
    const mentionCi = wilsonInterval(mentionedCorrect, stats.total);
    lines.push(`### ${arm}`, '');
    lines.push(`- brand_mentioned：${mentionedCorrect}/${stats.total}（${percentage(stats.total ? mentionedCorrect / stats.total : null)}；Wilson 95% CI ${mentionCi ? `${percentage(mentionCi[0])}–${percentage(mentionCi[1])}` : '—'}）`);
    lines.push(`- brand_mentions 完全一致：${stats.mentions.exact}/${stats.total}（${percentage(stats.total ? stats.mentions.exact / stats.total : null)}）`);
    lines.push(`- brand_recommended：${recommendedCorrect}/${stats.total}（${percentage(stats.total ? recommendedCorrect / stats.total : null)}；FP=${stats.recommended.fp}，FN=${stats.recommended.fn}）`);
    lines.push(`- brand_rank：${stats.rank.exact}/${stats.rank.evaluated || 0}（${percentage(stats.rank.evaluated ? stats.rank.exact / stats.rank.evaluated : null)}）`);
    lines.push(`- sentiment：${stats.sentiment.correct}/${stats.sentiment.evaluated || 0}（${percentage(stats.sentiment.evaluated ? stats.sentiment.correct / stats.sentiment.evaluated : null)}）`, '');
  });
  lines.push('## 字段状态与阶段 2 降级率（issue 013）', '');
  options.arms.forEach((arm) => {
    const stats = fieldStatusDistribution(entries.filter((entry) => entry.arm === arm));
    lines.push(`### ${arm}`, '');
    lines.push(`- 已评估：${stats.evaluated}；target_semantics 总状态：${JSON.stringify(stats.target_semantics_distribution)}`);
    lines.push(`- 推荐字段：${JSON.stringify(stats.recommendation_distribution)}；排名：${JSON.stringify(stats.rank_distribution)}；情绪：${JSON.stringify(stats.sentiment_distribution)}`);
    lines.push(`- 竞品轨：${JSON.stringify(stats.competition_distribution)}；assessed 可用率：${percentage(stats.assessed_rate)}；阶段 2 降级率：${percentage(stats.degradation_rate)}`);
    lines.push('');
  });
  lines.push('## 实体与语义真值（issue 013）', '');
  const coverage = semanticTruthCoverage(truthBySample);
  lines.push(`- 已复核实例：推荐 ${coverage.recommendation.count}、排名 ${coverage.rank.count}、情绪 ${coverage.sentiment.count}、已输出竞品关系 ${coverage.relations.count}（各维度 ≥20 才算可评估）。`);
  options.arms.forEach((arm) => {
    const armEntries = entries.filter((entry) => entry.arm === arm);
    const quality = entityQualityStats(armEntries, truthBySample);
    if (quality.status === 'EVALUATED') {
      lines.push(`- ${arm}：实体 precision=${percentage(quality.precision)}，recall=${percentage(quality.recall)}，micro-F1=${percentage(quality.micro_f1)}，canonicalization=${percentage(quality.canonicalization_accuracy)}；组合实体=${quality.merged_entity_count}，无依据拆分=${quality.split_entity_count}`);
    } else {
      lines.push(`- ${arm}：实体 ${quality.status} — ${quality.reason}`);
    }
    const relation = relationQualityStats(armEntries, truthBySample);
    if (relation.status === 'EVALUATED') {
      lines.push(`- ${arm}：已输出关系 precision=${percentage(relation.precision)}，recall=${percentage(relation.recall)}，micro-F1=${percentage(relation.micro_f1)}（TP=${relation.tp}，FP=${relation.fp}，FN=${relation.fn}）`);
    } else {
      lines.push(`- ${arm}：已输出关系 ${relation.status} — ${relation.reason}`);
    }
  });
  lines.push('', '## 语义指标（issue 015 四组合同）', '');
  const sampleById = new Map(samples.map((sample) => [sample.sample_id, sample]));
  const candidateArm = options.arms.includes('v5-json-rev2')
    ? 'v5-json-rev2'
    : (options.arms.includes('v5-json') ? 'v5-json' : null);
  options.arms.forEach((arm) => {
    if (!arm.startsWith('v5-json')) return;
    const armEntries = entries.filter((entry) => entry.arm === arm);
    const rec = recommendationQualityStats(armEntries, truthBySample);
    const sent = sentimentQualityStats(armEntries, truthBySample);
    const rank = rankQualityStats(armEntries, truthBySample);
    const mapping = targetMappingQualityStats(armEntries, truthBySample);
    const evidence = groundingEvidenceStats(armEntries, sampleById);
    lines.push(`### ${arm}`, '');
    lines.push(`- 推荐：${rec.status}；precision=${percentage(rec.precision)}，recall=${percentage(rec.recall)}，F1=${percentage(rec.f1)}，assessed coverage=${percentage(rec.coverage)}；可评估真值 ${rec.evaluated_samples}，降级 ${rec.degraded_count} 条${rec.status_reason ? `（${rec.status_reason}）` : ''}`);
    lines.push(`- 情绪：${sent.status}；accuracy=${percentage(sent.accuracy)}（${sent.correct}/${sent.evaluated_samples}），混淆矩阵=${JSON.stringify(sent.confusion_matrix)}；降级 ${sent.degraded_count} 条${sent.status_reason ? `（${sent.status_reason}）` : ''}`);
    lines.push(`- 排名：${rank.status}；exact accuracy=${percentage(rank.exact_accuracy)}（${rank.exact_matches}/${rank.denominator_samples}），coverage=${percentage(rank.coverage)}；降级 ${rank.degraded_count} 条${rank.status_reason ? `（${rank.status_reason}）` : ''}；真值样本 ID=${rank.sample_ids.join(',') || '—'}`);
    lines.push(`- target_mapping：${mapping.status}；状态判断 accuracy=${percentage(mapping.status_accuracy)}（${mapping.status_evaluated_samples} 条），成功映射 accuracy=${percentage(mapping.mapped_accuracy)}（${mapping.mapped_evaluated_samples} 条）；降级 ${mapping.degraded_count} 条${mapping.status_reason ? `（${mapping.status_reason}）` : ''}`);
    lines.push(`- 证据合法性：evidence_reference_invalid=${evidence.evidence_invalid_count}；grounding 错误=${evidence.grounding_error_count}（mention span 与原文逐字校验）`);
    lines.push(`- 重复方差（逐次计分，禁止多数投票）：推荐 F1 ${JSON.stringify(rec.repeat_variance.f1)}；情绪 accuracy ${JSON.stringify(sent.repeat_variance.accuracy)}；排名 exact ${JSON.stringify(rank.repeat_variance.exact_accuracy)}`);
    lines.push('');
  });

  lines.push('', '## 门禁说明', '');
  const v5 = candidateArm ? summaries[candidateArm] : null;
  if (v5) {
    const armEntries = entries.filter((entry) => entry.arm === candidateArm);
    const rec = recommendationQualityStats(armEntries, truthBySample);
    const sent = sentimentQualityStats(armEntries, truthBySample);
    const rank = rankQualityStats(armEntries, truthBySample);
    const evidence = groundingEvidenceStats(armEntries, sampleById);
    const completionPass = v5.total >= 120 && v5.completion_rate >= (118 / 120);
    const targetPass = v5.target_false_positives === 0 && v5.target_presence_accuracy === 1;
    const coveragePass = Object.values(coverage).every((item) => item.pass);
    const v5Relation = relationQualityStats(armEntries, truthBySample);
    const relationGatePass = coverage.relations.pass
      && v5Relation.status === 'EVALUATED'
      && v5Relation.precision !== null
      && v5Relation.precision >= 0.95;
    const evidencePass = evidence.evidence_invalid_count === 0 && evidence.grounding_error_count === 0;
    const recGatePass = rec.status === 'EVALUATED' && rec.f1 !== null && rec.f1 >= 0.95;
    const sentGatePass = sent.status === 'EVALUATED' && sent.accuracy !== null && sent.accuracy >= 0.90;
    const rankGatePass = rank.status === 'EVALUATED' && rank.exact_accuracy !== null && rank.exact_accuracy >= 0.95;
    const baselineArm = options.arms.includes('v4-current') ? 'v4-current'
      : (options.arms.includes('v5-json') && candidateArm !== 'v5-json' ? 'v5-json' : null);
    const tokenGatePass = baselineArm
      ? summaries[baselineArm].tokens.median !== null
        && v5.tokens.median !== null
        && v5.tokens.median <= summaries[baselineArm].tokens.median * 1.5
        && v5.tokens.p95 !== null
        && summaries[baselineArm].tokens.p95 !== null
        && v5.tokens.p95 <= summaries[baselineArm].tokens.p95 * 2
      : null;
    lines.push('**硬门槛**（完成率/目标事实/假阳性/grounding/证据合法性/关系 precision/Token）：');
    lines.push(`- 完成率门槛：${completionPass ? 'PASS' : 'FAIL'}（${v5.completed}/${v5.total}）。`);
    lines.push(`- 目标品牌事实门槛：${targetPass ? 'PASS' : 'FAIL'}（presence accuracy ${percentage(v5.target_presence_accuracy)}，假阳性 ${v5.target_false_positives}）。`);
    lines.push(`- 证据合法性门槛：${evidencePass ? 'PASS' : 'FAIL'}（evidence_reference_invalid=${evidence.evidence_invalid_count}，grounding 错误=${evidence.grounding_error_count}）。`);
    lines.push(`- 已输出关系 precision≥0.95：${relationGatePass ? 'PASS' : (coverage.relations.pass ? 'FAIL' : 'NOT EVALUABLE')}（覆盖 ${coverage.relations.count}，precision ${percentage(v5Relation.precision)}）。`);
    lines.push(`- Token/延迟门槛（候选 vs ${baselineArm || '无基线'}）：${tokenGatePass === null ? 'NOT EVALUABLE（无基线臂）' : (tokenGatePass ? 'PASS' : 'FAIL')}（候选中位 ${v5.tokens.median} ≤ 基线×1.5=${baselineArm ? Math.round(summaries[baselineArm].tokens.median * 1.5) : '—'}，p95 ${v5.tokens.p95} ≤ 基线×2=${baselineArm ? Math.round(summaries[baselineArm].tokens.p95 * 2) : '—'}）。`);
    lines.push('**语义门槛**（仅 EVALUATED 判定；NOT_EVALUABLE 不判 PASS、不阻塞其他指标）：');
    lines.push(`- 推荐 F1≥0.95：${rec.status === 'EVALUATED' ? (recGatePass ? 'PASS' : 'FAIL') : 'NOT EVALUABLE'}（F1=${percentage(rec.f1)}，覆盖 ${rec.evaluated_samples}${rec.status === 'NOT_EVALUABLE' ? `，${rec.status_reason}` : ''}）。`);
    lines.push(`- 情绪准确率≥0.90：${sent.status === 'EVALUATED' ? (sentGatePass ? 'PASS' : 'FAIL') : 'NOT EVALUABLE'}（accuracy=${percentage(sent.accuracy)}，覆盖 ${sent.evaluated_samples}${sent.status === 'NOT_EVALUABLE' ? `，${sent.status_reason}` : ''}）。`);
    lines.push(`- 明确排名 exact-match≥0.95：${rank.status === 'EVALUATED' ? (rankGatePass ? 'PASS' : 'FAIL') : 'NOT EVALUABLE'}（exact=${percentage(rank.exact_accuracy)}，真值样本 ${rank.denominator_samples}${rank.status === 'NOT_EVALUABLE' ? `，${rank.status_reason}` : ''}）。`);
    lines.push(`- target_mapping：报告状态判断与成功映射 accuracy（真值 ${candidateArm ? targetMappingTruthCount(truthBySample) : 0} 条）；评分接入，不设 PASS/FAIL 门槛。`);
    lines.push('**诚实降级**：unresolved/unavailable 单独计数（见上方各指标 degraded），不算错误预测、不得伪装成 assessed；降级只降低 assessed coverage。');
    lines.push('**重复运行**：只用于测量方差（上方 repeat_variance），禁止多数投票改写单次预测。');
    lines.push('- 语义真值覆盖（推荐/排名/情绪/已输出关系各 ≥20 已复核实例）：PASS 判定仅对 EVALUATED 生效；覆盖不足时 NOT EVALUABLE，不得用 grounding 100% 或 assessed 幸存样本宣布语义门禁通过。');
    lines.push('- 开放式竞品发现允许遗漏；竞品集合 Jaccard 作为诊断指标，不作为整条完成门槛。');
  }
  const failures = entries.filter((entry) => !entry.ok);
  lines.push('', '## 失败明细', '');
  if (!failures.length) lines.push('无。');
  else failures.forEach((entry) => {
    lines.push(`- ${entry.arm} / ${entry.sample_id} / repeat ${entry.repeat}：${entry.error?.code} — ${entry.error?.message}`);
  });
  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArgs();
  const corpus = loadCorpus(options);
  const selectedSamples = options.sampleIds.length
    ? corpus.samples.filter((sample) => options.sampleIds.includes(sample.sample_id))
    : corpus.samples;
  if (options.sampleIds.length && selectedSamples.length !== options.sampleIds.length) {
    const found = new Set(selectedSamples.map((sample) => sample.sample_id));
    const missing = options.sampleIds.filter((sampleId) => !found.has(sampleId));
    throw new Error(`--sample-ids 包含未知样本：${missing.join(',')}`);
  }
  const samples = options.limit ? selectedSamples.slice(0, options.limit) : selectedSamples;
  fs.mkdirSync(options.outputDir, { recursive: true });
  fs.writeFileSync(path.join(options.outputDir, 'manifest.json'), JSON.stringify({
    generated_at: new Date().toISOString(),
    model: 'deepseek-v4-flash',
    repeats: options.repeats,
    arms: options.arms,
    samples
  }, null, 2));
  const row = await AIPlatformConfigService.getPlatformByCode('deepseek');
  const basePlatform = row.get ? row.get({ plain: true }) : { ...row };
  const tasks = options.arms.flatMap((arm) => (
    Array.from({ length: options.repeats }, (_, index) => index + 1)
      .flatMap((repeat) => samples.map((sample) => ({ sample, arm, repeat })))
  ));
  console.log(`开始真实 Flash 对比：${samples.length} 条 × ${options.repeats} 次 × ${options.arms.length} 臂 = ${tasks.length} 次分析`);
  const entries = await runWithConcurrency(
    tasks,
    (task) => runEntry({ ...task, basePlatform, options }),
    options.concurrency,
    (completed, total, entry) => {
      console.log(`[${completed}/${total}] ${entry.arm} ${entry.sample_id} r${entry.repeat}: ${entry.ok ? 'ok' : entry.error?.code}${entry.from_cache ? ' cache' : ''}`);
    }
  );
  const { map: truthBySample, errors: truthErrors } = loadTruth(options);
  if (truthErrors.length) {
    // issue 013 P1：truth.jsonl 存在但内容不满足 schema/哈希/引用校验 -> fail-closed
    throw new Error(`truth.jsonl 校验失败（${truthErrors.length} 处）：\n- ${truthErrors.join('\n- ')}`);
  }
  // 合并 confirmed 真值标签：truth.jsonl 的 confirmed 记录覆盖 LABELING 标签，
  // 补充样本只有 confirmed 才进入目标评分
  // issue 015：recommendation=null（语义 unavailable，如 S53）必须保留 null，
  // 禁止 Boolean(null) 强转成 false——unavailable 与明确不推荐是两个不同语义值。
  const labels = new Map(corpus.labels);
  truthBySample.forEach((truth, sampleId) => {
    if (truth.review_status !== 'confirmed') return;
    labels.set(sampleId, {
      mentioned: Boolean(truth.mentioned),
      mentions: Number(truth.mentions) || 0,
      recommended: truth.recommendation === null ? null : Boolean(truth.recommendation),
      rank: truth.rank == null || truth.rank === 'none' ? null : Number(truth.rank),
      sentiment: truth.sentiment && truth.sentiment !== 'none' ? truth.sentiment : null
    });
  });
  const summaries = Object.fromEntries(options.arms.map((arm) => [
    arm,
    summarizeArm(entries.filter((entry) => entry.arm === arm), labels)
  ]));
  fs.writeFileSync(
    path.join(options.outputDir, 'summary.json'),
    JSON.stringify({ generated_at: new Date().toISOString(), summaries }, null, 2)
  );
  fs.writeFileSync(
    path.join(options.outputDir, 'COMPARISON-REPORT.md'),
    buildReport({ options, samples, labels, entries, summaries, truthBySample })
  );
  console.log(JSON.stringify({ output: options.outputDir, summaries }, null, 2));
  await require('../config/database').close();
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error('真实 Flash 对比失败：', error);
    process.exitCode = 1;
    try {
      await require('../config/database').close();
    } catch (_) { /* ignore shutdown error */ }
  });
}

module.exports = {
  buildReport,
  cacheIdentityFor,
  loadCorpus,
  parseArgs,
  recalculateCachedV5Entry,
  runWithConcurrency,
  targetStatsForEntries
};
