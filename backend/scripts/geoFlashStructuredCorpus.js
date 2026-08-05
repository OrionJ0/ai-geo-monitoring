#!/usr/bin/env node
/**
 * DeepSeek Flash 结构化分析冻结语料与评测合同。
 *
 * 本模块只做纯函数：语料去重与哈希、分层计数、六类问题覆盖验证、
 * 预计模型调用量、缓存身份、预注册门槛清单。它不调用真实模型，
 * 不写入正式运行数据，也不把人工真值拼进任何提示或请求体。
 *
 * 实验修订与历史报告隔离由外部输出目录保证：新合同必须使用新
 * 的 experiment revision 和新目录，不得覆盖旧实验报告。
 */
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SIX_QUESTION_PATTERNS = Object.freeze([
  { key: '张力电子围栏', pattern: /张力/u },
  { key: '脉冲电子围栏', pattern: /脉冲/u },
  { key: '激光对射报警器', pattern: /激光对射/u },
  { key: '电磁感知电缆', pattern: /电磁感知/u },
  { key: '振动光纤周界报警', pattern: /振动光纤/u },
  { key: '大工业园区', pattern: /大工业园区/u }
]);

const LONG_ANSWER_THRESHOLD = 2000;

function answerSha256(answer) {
  return createHash('sha256').update(String(answer || ''), 'utf8').digest('hex');
}

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

/**
 * 加载冻结语料：按 answer_sha256 去重（去重时保留首条），
 * 并为每条样本附加 answer_sha256，保证与评测清单可追溯。
 */
function loadFrozenCorpus({ samples, labels = null, dedupeByAnswer = true }) {
  const raw = Array.isArray(samples) ? samples : [];
  const withHash = raw.map((sample) => ({ ...sample, answer_sha256: answerSha256(sample.response_text) }));
  const list = dedupeByAnswer
    ? (() => {
      const seen = new Set();
      const result = [];
      withHash.forEach((sample) => {
        if (seen.has(sample.answer_sha256)) return;
        seen.add(sample.answer_sha256);
        result.push(sample);
      });
      return result;
    })()
    : withHash;
  return { samples: list, labels };
}

/**
 * 语料分层统计：目标出现/未出现、长回答、多实体、英文别名、
 * 历史失败与平台分布。只使用样本与人工真值元数据，不读取模型输出。
 */
function corpusStrata({ samples, labels = null }) {
  const list = Array.isArray(samples) ? samples : [];
  const byPlatform = {};
  list.forEach((sample) => {
    const platform = String(sample.platform || 'unknown');
    byPlatform[platform] = (byPlatform[platform] || 0) + 1;
  });
  let targetAbsent = 0;
  let targetPresent = 0;
  if (labels instanceof Map) {
    list.forEach((sample) => {
      const label = labels.get(sample.sample_id);
      if (typeof label?.mentioned === 'boolean') {
        if (label.mentioned) targetPresent += 1;
        else targetAbsent += 1;
      }
    });
  }
  return {
    total: list.length,
    by_platform: byPlatform,
    target_absent: targetAbsent,
    target_present: targetPresent,
    long_answer: list.filter((sample) => (
      String(sample.response_text || '').length > LONG_ANSWER_THRESHOLD
    )).length,
    multi_entity: list.filter((sample) => Boolean(sample.multi_entity_review)).length,
    english_alias: list.filter((sample) => (
      /[A-Za-z]{3,}/u.test(String(sample.response_text || ''))
    )).length,
    historical_failure: list.filter((sample) => Boolean(
      sample.challenge || sample.historical_failure
    )).length
  };
}

/**
 * 六类真实问题覆盖验证：用户列出的六类问题必须全部出现在冻结语料中。
 */
function sixQuestionCoverage(samples) {
  const list = Array.isArray(samples) ? samples : [];
  const questions = list.map((sample) => String(sample.question || ''));
  const covered = [];
  const missing = [];
  SIX_QUESTION_PATTERNS.forEach((item) => {
    if (questions.some((question) => item.pattern.test(question))) covered.push(item.key);
    else missing.push(item.key);
  });
  return { covered, missing, total: SIX_QUESTION_PATTERNS.length };
}

/**
 * 预计模型调用量：正常路径样本数 × 重复次数 × 臂数。
 * 竞品注册表匹配是纯程序步骤，不增加任何模型调用。
 */
function estimateModelCalls({ samples, repeats = 3, arms = 3 }) {
  const list = Array.isArray(samples) ? samples : [];
  const perSample = Number(repeats) * Number(arms);
  return {
    samples: list.length,
    repeats: Number(repeats),
    arms: Number(arms),
    per_sample: perSample,
    total: list.length * perSample,
    registry_additional_calls: 0
  };
}

/**
 * 缓存身份：答案哈希、问题、实验臂、重复次数、prompt revision、
 * 模型、最终请求策略与实验修订共同决定。任一关键项变化都不能误用旧输出。
 */
function buildCacheKey({
  sample,
  arm,
  repeat,
  promptRevision,
  model,
  requestPolicy,
  experimentRevision
}) {
  const payload = {
    answer_sha256: answerSha256(sample?.response_text),
    question: String(sample?.question || '').trim(),
    arm: String(arm || ''),
    repeat: Number(repeat),
    prompt_revision: String(promptRevision || ''),
    model: String(model || ''),
    request_policy: requestPolicy,
    experiment_revision: String(experimentRevision || '')
  };
  return sha256Json(Object.fromEntries(
    Object.keys(payload).sort().map((key) => [key, payload[key]])
  ));
}

/**
 * 预注册清单：在真实 API 调用前先生成语料分层、缺失真值占位、
 * 预计调用量和门槛清单供人工审查。清单哈希用于锁定实验身份。
 */
function buildPreRegistration({ samples, repeats = 3, arms = [], gates = [] }) {
  const list = Array.isArray(samples) ? samples : [];
  const estimate = estimateModelCalls({ samples: list, repeats, arms: arms.length });
  const coverage = sixQuestionCoverage(list);
  const strata = corpusStrata({ samples: list });
  const payload = {
    samples: list.map((sample) => ({
      sample_id: sample.sample_id,
      question: sample.question,
      platform: sample.platform,
      answer_sha256: answerSha256(sample.response_text)
    })),
    estimated_calls: estimate,
    six_question_coverage: coverage,
    strata,
    gates: Array.isArray(gates) ? gates : [],
    generated_for_review: true
  };
  return {
    ...payload,
    registration_sha256: sha256Json(payload)
  };
}

function parseCorpusArgs(argv = process.argv.slice(2)) {
  const readValue = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : null;
  };
  return {
    baselineDir: path.resolve(readValue('--dir') || path.resolve(__dirname, '../../work/geo-baseline-2026-07-28')),
    challengeArtifact: readValue('--challenge-artifact')
      ? path.resolve(readValue('--challenge-artifact'))
      : null,
    repeats: Number(readValue('--repeats') || 3),
    arms: String(readValue('--arms') || 'v4-current,v4-temperature-zero,v5-json')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    gates: String(readValue('--gates') || 'target_fact_availability:1,grounding_precision:1,recommendation_f1:0.95,sentiment_accuracy:0.9,relation_precision:0.95,rank_exact_match:0.95,target_core_stability:0.99')
      .split(',')
      .filter(Boolean)
      .map((item) => {
        const [key, threshold] = item.split(':');
        return { key, threshold: Number(threshold) };
      })
  };
}

function planOnly(baselineDir, challengeArtifact) {
  const samples = JSON.parse(
    fs.readFileSync(path.join(baselineDir, 'samples.json'), 'utf8')
  );
  let challenge = null;
  if (challengeArtifact && fs.existsSync(challengeArtifact)) {
    const artifact = JSON.parse(fs.readFileSync(challengeArtifact, 'utf8'));
    if (artifact?.question && artifact?.answer_text) {
      challenge = {
        sample_id: 'C01',
        question: artifact.question,
        response_text: artifact.answer_text,
        platform: 'doubao-web',
        challenge: true,
        brand: { name: '广拓', aliases: ['上海广拓', 'GATO'] }
      };
    }
  }
  const withChallenge = challenge ? [...samples, challenge] : samples;
  const corpus = loadFrozenCorpus({ samples: withChallenge });
  return { corpus, challenge };
}

async function main() {
  const options = parseCorpusArgs();
  const { corpus, challenge } = planOnly(options.baselineDir, options.challengeArtifact);
  const pre = buildPreRegistration({
    samples: corpus.samples,
    repeats: options.repeats,
    arms: options.arms,
    gates: options.gates
  });
  const plan = {
    generated_at: new Date().toISOString(),
    challenge_included: Boolean(challenge),
    ...pre
  };
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('生成评测预注册清单失败：', error);
    process.exitCode = 1;
  });
}

module.exports = {
  SIX_QUESTION_PATTERNS,
  LONG_ANSWER_THRESHOLD,
  answerSha256,
  buildCacheKey,
  buildPreRegistration,
  corpusStrata,
  estimateModelCalls,
  loadFrozenCorpus,
  parseCorpusArgs,
  planOnly,
  sixQuestionCoverage
};
