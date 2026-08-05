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
const { SEMANTIC_PROMPT_REVISION } = require('../services/AIResponseSemanticJudgmentService');

const EXPERIMENT_REVISION = 'three_track_partial_v1';

function cacheIdentityFor(arm) {
  if (arm === 'v5-json') {
    return {
      promptRevision: `${ENTITY_PROMPT_REVISION}+${SEMANTIC_PROMPT_REVISION}`,
      model: 'deepseek-v4-flash',
      requestPolicy: { temperature: 0, thinking: 'disabled', response_format: 'json_object' },
      experimentRevision: EXPERIMENT_REVISION
    };
  }
  const definition = AIResponseAnalysisService.getPromptDefinition();
  return {
    promptRevision: definition.prompt_revision,
    model: 'deepseek-v4-flash',
    requestPolicy: arm === 'v4-temperature-zero'
      ? { temperature: 0 }
      : { temperature: 'default' },
    experimentRevision: EXPERIMENT_REVISION
  };
}

const SUPPORTED_ARMS = new Set(['v4-current', 'v4-temperature-zero', 'v5-json']);
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
  if (arm === 'v5-json') {
    return new AIResponseAnalysisV5Service({
      entityExtractionService: new AIResponseEntityExtractionService({
        configService,
        requestService
      }),
      semanticJudgmentService: new AIResponseSemanticJudgmentService({
        configService,
        requestService
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

function buildReport({ options, samples, labels, entries, summaries }) {
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
  lines.push('## 门禁说明', '');
  const v5 = summaries['v5-json'];
  if (v5) {
    const completionPass = v5.total >= 120 && v5.completion_rate >= (118 / 120);
    const targetPass = v5.target_false_positives === 0 && v5.target_presence_accuracy === 1;
    const stabilityPass = v5.stability_rate !== null && v5.stability_rate >= 0.99;
    lines.push(`- 完成率门槛：${completionPass ? 'PASS' : 'FAIL'}。`);
    lines.push(`- 目标品牌事实门槛：${targetPass ? 'PASS' : 'FAIL'}。`);
    lines.push(`- 目标核心稳定门槛：${stabilityPass ? 'PASS' : 'FAIL'}。`);
    lines.push('- 开放式竞品发现允许遗漏；竞品集合 Jaccard 作为诊断指标，不作为整条完成门槛。');
    lines.push('- 实体 span、完整竞品关系、候选组 exact-match 尚需至少 20 条扩展人工真值；未满足前不得宣称完整语义门禁通过。');
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
  const summaries = Object.fromEntries(options.arms.map((arm) => [
    arm,
    summarizeArm(entries.filter((entry) => entry.arm === arm), corpus.labels)
  ]));
  fs.writeFileSync(
    path.join(options.outputDir, 'summary.json'),
    JSON.stringify({ generated_at: new Date().toISOString(), summaries }, null, 2)
  );
  fs.writeFileSync(
    path.join(options.outputDir, 'COMPARISON-REPORT.md'),
    buildReport({ options, samples, labels: corpus.labels, entries, summaries })
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
