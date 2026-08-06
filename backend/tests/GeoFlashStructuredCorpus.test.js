const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  answerSha256,
  buildCacheKey,
  buildPreRegistration,
  corpusStrata,
  estimateModelCalls,
  loadFrozenCorpus,
  sixQuestionCoverage
} = require('../scripts/geoFlashStructuredCorpus');
const {
  precisionRecallF1,
  pairwiseDiff
} = require('../services/GeoFlashStructuredBenchmarkService');

const SIX_QUESTIONS = [
  '学校项目要用张力电子围栏，有哪些有经验的厂家？',
  '脉冲电子围栏国内哪几家做得比较成熟？',
  '激光对射报警器有哪些质量比较稳定的国产品牌？',
  '想采购电磁感知电缆，国内有哪些专业厂家可以选？',
  '国内做振动光纤周界报警的厂家，哪些比较靠谱？',
  '大工业园区用什么安防设备比较好？'
];

const CORPUS_HASH_MANIFEST = path.resolve(
  __dirname,
  'fixtures/geo-flash-structured-corpus-manifest.json'
);

function sampleFixture() {
  return [
    {
      sample_id: 'S01',
      question: SIX_QUESTIONS[0],
      response_text: '学校项目通常选择张力电子围栏。\n海康威视是主流厂家。',
      platform: 'doubao-web',
      multi_entity_review: false,
      brand: { name: '广拓', aliases: ['上海广拓'] }
    },
    {
      sample_id: 'S02',
      question: SIX_QUESTIONS[1],
      response_text: '脉冲电子围栏国内比较成熟的有上海广拓、海康威视、大华股份等品牌。',
      platform: 'deepseek',
      multi_entity_review: true,
      brand: { name: '广拓', aliases: ['上海广拓'] }
    },
    {
      sample_id: 'S03',
      question: SIX_QUESTIONS[2],
      response_text: '激光对射报警器质量稳定的国产品牌有海康威视、大华、慧眼视讯等。',
      platform: 'qwen',
      multi_entity_review: false,
      brand: { name: '广拓', aliases: ['上海广拓'] }
    },
    {
      sample_id: 'S04',
      question: SIX_QUESTIONS[3],
      response_text: '电磁感知电缆国内专业厂家有上海广拓等。',
      platform: 'deepseek-web',
      multi_entity_review: false,
      brand: { name: '广拓', aliases: ['上海广拓'] }
    },
    {
      sample_id: 'S05',
      question: SIX_QUESTIONS[4],
      response_text: '振动光纤周界报警厂家中，汉威科技与 GATO 比较靠谱。',
      platform: 'doubao-web',
      multi_entity_review: true,
      brand: { name: '广拓', aliases: ['上海广拓', 'GATO'] }
    },
    {
      sample_id: 'S06',
      question: SIX_QUESTIONS[5],
      response_text: '大工业园区安防核心是全域覆盖。',
      platform: 'doubao-web',
      multi_entity_review: false,
      brand: { name: '广拓', aliases: ['上海广拓'] }
    }
  ];
}

function writeFixtureDir(samples, labels, challengeText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-corpus-fixture-'));
  const challenge = challengeText != null
    ? { question: SIX_QUESTIONS[5], answer_text: challengeText }
    : null;
  fs.writeFileSync(path.join(dir, 'samples.json'), JSON.stringify(samples));
  fs.writeFileSync(path.join(dir, 'LABELING.md'), labels);
  if (challenge) {
    fs.writeFileSync(path.join(dir, 'challenge.json'), JSON.stringify(challenge));
  }
  return { dir, challengePath: challenge ? path.join(dir, 'challenge.json') : null };
}

test('同一 answer_sha256 的去重回答只保留一条，不同回答全部保留', () => {
  const samples = [
    { sample_id: 'A1', question: '问题一', response_text: '同一原文回答' },
    { sample_id: 'A2', question: '问题二', response_text: '同一原文回答' },
    { sample_id: 'A3', question: '问题三', response_text: '另一个原文回答' }
  ];
  const deduped = loadFrozenCorpus({ samples, dedupeByAnswer: true });
  assert.equal(deduped.samples.length, 2);
  assert.deepEqual(deduped.samples.map((sample) => sample.sample_id), ['A1', 'A3']);
});

test('语料分层正确统计目标出现/未出现、长回答、多实体、英文别名和平台', () => {
  const samples = sampleFixture();
  const labels = new Map([
    ['S01', { mentioned: false }],
    ['S02', { mentioned: true }],
    ['S03', { mentioned: false }],
    ['S04', { mentioned: true }],
    ['S05', { mentioned: true }],
    ['S06', { mentioned: false }]
  ]);
  const strata = corpusStrata({ samples, labels });
  assert.equal(strata.total, 6);
  assert.equal(strata.target_absent, 3);
  assert.equal(strata.target_present, 3);
  assert.equal(strata.multi_entity, 2);
  assert.equal(strata.by_platform['doubao-web'], 3);
  assert.equal(strata.by_platform.deepseek, 1);
});

test('六类问题覆盖验证能识别覆盖与缺失', () => {
  const samples = sampleFixture();
  const coverage = sixQuestionCoverage(samples);
  assert.equal(coverage.covered.length, 6);
  assert.equal(coverage.missing.length, 0);
  const incomplete = sixQuestionCoverage(samples.slice(0, 3));
  assert.ok(incomplete.missing.length > 0);
  assert.match(incomplete.missing.join(' '), /大工业园区/);
});

test('缓存身份由答案哈希、prompt revision、模型、请求策略和实验修订共同决定', () => {
  const base = {
    sample: { sample_id: 'S01', question: '问题', response_text: '回答文本' },
    arm: 'v5-json',
    repeat: 1,
    promptRevision: 'grounded_entity_catalog_v1',
    model: 'deepseek-v4-flash',
    requestPolicy: { temperature: 0, thinking: 'disabled' },
    experimentRevision: 'three_track_partial_v1'
  };
  const first = buildCacheKey(base);
  assert.equal(buildCacheKey(base), first);
  const variants = [
    { ...base, arm: 'v4-current' },
    { ...base, repeat: 2 },
    { ...base, promptRevision: 'grounded_entity_catalog_v2' },
    { ...base, model: 'deepseek-v4-pro' },
    { ...base, requestPolicy: { temperature: 0.7 } },
    { ...base, experimentRevision: 'three_track_partial_v2' },
    { ...base, sample: { ...base.sample, response_text: '回答文本改过' } },
    { ...base, sample: { ...base.sample, question: '问题改过' } }
  ];
  variants.forEach((variant) => assert.notEqual(buildCacheKey(variant), first));
});

test('预计模型调用量 = 样本数 × 重复次数 × 臂数，注册表匹配不增加调用', () => {
  const estimate = estimateModelCalls({ samples: sampleFixture(), repeats: 3, arms: 3 });
  assert.equal(estimate.total, 54);
  assert.equal(estimate.per_sample, 9);
  assert.equal(estimate.registry_additional_calls, 0);
});

test('预注册清单包含门槛、分层、缺失真值、预计调用量，可在真实 API 前审查', () => {
  const samples = sampleFixture();
  const pre = buildPreRegistration({
    samples,
    repeats: 3,
    arms: ['v4-current', 'v4-temperature-zero', 'v5-json'],
    gates: [
      { key: 'target_fact_availability', threshold: 1 },
      { key: 'grounding_precision', threshold: 1 },
      { key: 'recommendation_f1', threshold: 0.95 },
      { key: 'sentiment_accuracy', threshold: 0.9 }
    ]
  });
  assert.equal(pre.samples.length, 6);
  assert.equal(pre.estimated_calls.total, 54);
  assert.ok(Array.isArray(pre.gates));
  assert.equal(pre.gates.length, 4);
  assert.ok(pre.gates.every((gate) => typeof gate.threshold === 'number'));
  assert.ok(pre.registration_sha256);
  assert.ok(pre.generated_for_review === true);
});

test('precision/recall/F1 与配对差值有固定夹具', () => {
  const stats = precisionRecallF1({ tp: 18, fp: 2, fn: 2 });
  assert.equal(stats.precision, 0.9);
  assert.equal(stats.recall, 0.9);
  assert.equal(stats.f1, 0.9);

  const diff = pairwiseDiff([0.8, 0.85, 0.9], [0.9, 0.9, 0.95]);
  assert.equal(diff.paired_pairs, 3);
  assert.ok(Number.isFinite(diff.mean_diff));
  assert.ok(Math.abs(diff.mean_diff - 0.0667) < 0.001);
  assert.ok(diff.mean_diff > 0);
});

test('人工真值不会进入模型提示或请求体', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../scripts/geoFlashStructuredCorpus.js'), 'utf8');
  assert.doesNotMatch(source, /competitorHints:\s*sample\.competitors/);
  assert.doesNotMatch(source, /truth\.jsonl/);
});

test('冻结语料加载后输出与语料清单可追溯（sample_id、question、answer_sha256）', () => {
  const samples = sampleFixture();
  const corpus = loadFrozenCorpus({ samples });
  assert.ok(corpus.samples.every((sample) => sample.answer_sha256));
  assert.equal(corpus.samples[0].answer_sha256, answerSha256(samples[0].response_text));
});

test('脱敏冻结语料哈希清单在干净仓库强制满足 40+ 唯一回答、六类问题与分层门槛', () => {
  const manifest = JSON.parse(fs.readFileSync(CORPUS_HASH_MANIFEST, 'utf8'));
  assert.equal(manifest.schema_version, 'geo_flash_corpus_hash_manifest_v1');
  assert.equal(manifest.privacy, 'raw_text_omitted');
  assert.doesNotMatch(JSON.stringify(manifest), /response_text|answer_text|question_text/u);

  const hashes = Object.values(manifest.answer_sha256_by_sample_id || {});
  const sampleIds = new Set(Object.keys(manifest.answer_sha256_by_sample_id || {}));
  assert.ok(hashes.length >= 40, `清单至少 40 条，实际 ${hashes.length}`);
  assert.ok(hashes.every((hash) => /^[0-9a-f]{64}$/u.test(hash)), '答案哈希必须是 SHA-256');
  assert.ok(new Set(hashes).size >= 40, `去重后至少 40 条，实际 ${new Set(hashes).size}`);

  const expectedQuestionClasses = [
    'tension_fence',
    'pulse_fence',
    'laser_beam',
    'electromagnetic_cable',
    'vibration_fiber',
    'industrial_park'
  ];
  assert.deepEqual(
    Object.keys(manifest.question_class_sample_ids || {}).sort(),
    expectedQuestionClasses.sort()
  );
  Object.values(manifest.question_class_sample_ids).forEach((ids) => {
    assert.ok(ids.length > 0, '六类问题每类至少有一条冻结样本');
    assert.ok(ids.every((id) => sampleIds.has(id)), '问题分层不得引用未知样本');
  });

  const platformGroups = Object.values(manifest.platform_sample_ids || {});
  assert.ok(platformGroups.length >= 3, '至少 3 个平台');
  const platformIds = platformGroups.flat();
  assert.equal(platformIds.length, sampleIds.size, '每条样本必须且只能归属一个平台');
  assert.equal(new Set(platformIds).size, sampleIds.size, '平台分层不得重复或遗漏样本');
  assert.ok(platformIds.every((id) => sampleIds.has(id)), '平台分层不得引用未知样本');

  const manifestStrata = manifest.strata_sample_ids || {};
  assert.ok(manifestStrata.long_answer?.length >= 10, `长回答至少 10 条，实际 ${manifestStrata.long_answer?.length || 0}`);
  assert.ok(manifestStrata.multi_entity?.length >= 10, `多实体至少 10 条，实际 ${manifestStrata.multi_entity?.length || 0}`);
  assert.ok(manifestStrata.challenge?.length >= 1, '至少保留一条挑战样本');
  Object.values(manifestStrata).forEach((ids) => {
    assert.ok(ids.every((id) => sampleIds.has(id)), '语料分层不得引用未知样本');
  });

  const realDir = path.resolve(__dirname, '../../work/geo-baseline-2026-07-28');
  if (!fs.existsSync(path.join(realDir, 'samples.json'))) return;
  const samples = JSON.parse(fs.readFileSync(path.join(realDir, 'samples.json'), 'utf8'));
  const challengeArtifact = path.resolve(__dirname, '../../work/diagnostics/real-ai-structure-2026-08-05T01-54-10-701Z.json');
  const all = [...samples];
  if (fs.existsSync(challengeArtifact)) {
    const artifact = JSON.parse(fs.readFileSync(challengeArtifact, 'utf8'));
    all.push({
      sample_id: 'C01',
      question: artifact.question,
      response_text: artifact.answer_text,
      platform: 'doubao-web',
      challenge: true
    });
  }
  const coverage = sixQuestionCoverage(all);
  assert.ok(samples.length >= 40, `语料至少 40 条，实际 ${samples.length}`);
  assert.equal(coverage.missing.length, 0, `六类问题缺 ${coverage.missing.join(',')}`);
  const strata = corpusStrata({ samples: all });
  assert.ok(strata.long_answer >= 10, `长回答至少 10 条，实际 ${strata.long_answer}`);
  assert.ok(strata.multi_entity >= 10, `多实体至少 10 条，实际 ${strata.multi_entity}`);
  assert.ok(strata.by_platform && Object.keys(strata.by_platform).length >= 3, '至少 3 个平台');
  const deduped = loadFrozenCorpus({ samples: all }).samples;
  assert.ok(samples.length >= 40, `原始语料至少 40 条，实际 ${samples.length}`);
  assert.ok(deduped.length >= 40, `去重后至少 40 条，实际 ${deduped.length}`);
  all.forEach((sample) => {
    assert.equal(
      manifest.answer_sha256_by_sample_id[sample.sample_id],
      answerSha256(sample.response_text),
      `${sample.sample_id} 的本地原文与提交哈希清单不一致`
    );
  });
});

test('评测把失败计入完成率分母，输出缺失不当作成功', () => {
  const { summarizeArm } = require('../services/GeoFlashStructuredBenchmarkService');
  const entries = [
    { sample_id: 'S01', arm: 'v5-json', repeat: 1, ok: true, result: { brand_mentioned: true, brand_mentions: 1, brand_rank: null, brand_recommended: false, sentiment: 'neutral' }, total_tokens: 100, duration_ms: 50 },
    { sample_id: 'S01', arm: 'v5-json', repeat: 2, ok: false, error: { code: 'analysis_api_failed' }, total_tokens: 0, duration_ms: 40 },
    { sample_id: 'S02', arm: 'v5-json', repeat: 1, ok: false, error: { code: 'analysis_output_truncated' }, total_tokens: 0, duration_ms: 30 }
  ];
  const summary = summarizeArm(entries);
  assert.equal(summary.total, 3);
  assert.equal(summary.completed, 1);
  assert.equal(summary.completion_rate, 1 / 3);
  assert.ok(summary.stability_pairs <= summary.completed);
});

test('Wilson 95% 区间与重复一致率有确定性数值夹具', () => {
  const { wilsonInterval } = require('../scripts/geoBaselineEvaluate');
  const interval = wilsonInterval(38, 40);
  assert.ok(Array.isArray(interval) && interval.length === 2);
  assert.ok(interval[0] > 0.83 && interval[0] < 0.85, `下界约 0.835，实际 ${interval[0]}`);
  assert.ok(interval[1] > 0.98 && interval[1] < 0.99, `上界约 0.986，实际 ${interval[1]}`);
  assert.equal(wilsonInterval(0, 0), null);
});

test('新实验修订使用新缓存身份，历史实验报告不会被旧键误用', () => {
  const sample = { sample_id: 'S01', question: '问题', response_text: '回答' };
  const oldKey = buildCacheKey({
    sample,
    arm: 'v5-json',
    repeat: 1,
    promptRevision: 'grounded_entity_catalog_v1',
    model: 'deepseek-v4-flash',
    requestPolicy: { temperature: 0 },
    experimentRevision: 'three_track_partial_v1'
  });
  const newContractKey = buildCacheKey({
    sample,
    arm: 'v5-json',
    repeat: 1,
    promptRevision: 'grounded_entity_catalog_v1',
    model: 'deepseek-v4-flash',
    requestPolicy: { temperature: 0 },
    experimentRevision: 'three_track_partial_v2'
  });
  assert.notEqual(newContractKey, oldKey);
});
