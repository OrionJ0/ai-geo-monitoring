function sortedCompetitionEntities(value) {
  return (Array.isArray(value) ? value : [])
    .map((entity) => ({
      name: String(entity?.name || ''),
      relation: String(entity?.relation || ''),
      mentions: Number(entity?.mentions || 0)
    }))
    .sort((left, right) => (
      left.name.localeCompare(right.name)
      || left.relation.localeCompare(right.relation)
      || left.mentions - right.mentions
    ));
}

function metricSignature(result = {}) {
  return JSON.stringify({
    brand_mentioned: Boolean(result.brand_mentioned),
    brand_mentions: Number(result.brand_mentions || 0),
    brand_rank: Number(result.brand_rank) > 0 ? Number(result.brand_rank) : null,
    brand_recommended: Boolean(result.brand_recommended),
    sentiment: Boolean(result.brand_mentioned) ? String(result.sentiment || '') : null
  });
}

function competitionJaccard(left = {}, right = {}) {
  const leftNames = new Set(
    sortedCompetitionEntities(left.competition_entities)
      .filter((entity) => entity.relation === 'competitor')
      .map((entity) => entity.name)
  );
  const rightNames = new Set(
    sortedCompetitionEntities(right.competition_entities)
      .filter((entity) => entity.relation === 'competitor')
      .map((entity) => entity.name)
  );
  const union = new Set([...leftNames, ...rightNames]);
  if (!union.size) return 1;
  let intersection = 0;
  leftNames.forEach((name) => {
    if (rightNames.has(name)) intersection += 1;
  });
  return intersection / union.size;
}

function percentile(values, fraction) {
  const sorted = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const position = Math.max(0, Math.min(1, Number(fraction))) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] + ((sorted[upper] - sorted[lower]) * weight);
}

function distribution(values) {
  const normalized = values.map(Number).filter(Number.isFinite);
  return {
    count: normalized.length,
    median: percentile(normalized, 0.5),
    p95: percentile(normalized, 0.95)
  };
}

function stability(entries) {
  const bySample = new Map();
  entries.filter((entry) => entry?.ok && entry.result).forEach((entry) => {
    if (!bySample.has(entry.sample_id)) bySample.set(entry.sample_id, []);
    bySample.get(entry.sample_id).push(metricSignature(entry.result));
  });
  let pairs = 0;
  let agreements = 0;
  bySample.forEach((signatures) => {
    for (let left = 0; left < signatures.length; left += 1) {
      for (let right = left + 1; right < signatures.length; right += 1) {
        pairs += 1;
        if (signatures[left] === signatures[right]) agreements += 1;
      }
    }
  });
  return { pairs, agreements, rate: pairs ? agreements / pairs : null };
}

function competitionStability(entries) {
  const bySample = new Map();
  entries.filter((entry) => entry?.ok && entry.result).forEach((entry) => {
    if (!bySample.has(entry.sample_id)) bySample.set(entry.sample_id, []);
    bySample.get(entry.sample_id).push(entry.result);
  });
  const pairScores = [];
  bySample.forEach((results) => {
    for (let left = 0; left < results.length; left += 1) {
      for (let right = left + 1; right < results.length; right += 1) {
        pairScores.push(competitionJaccard(results[left], results[right]));
      }
    }
  });
  return distribution(pairScores);
}

function precisionRecallF1({ tp = 0, fp = 0, fn = 0 } = {}) {
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  // issue 015：F1 用等价公式 2TP/(2TP+FP+FN)——tp=0 时（无任何正面命中）
  // 仍返回 0 而非 null，保证门禁可判、方差可算；tp+fp+fn=0（无评估）才 null。
  const f1 = tp + fp + fn > 0 ? (2 * tp) / (2 * tp + fp + fn) : null;
  return { precision, recall, f1 };
}

// ---- issue 015 语义门禁指标（2026-08-06，数据所有者裁决合同） ----
// 原则：
// 1. 全部按单次预测计分（每次运行是一条预测）；重复运行只报告逐次分数与方差，
//    禁止多数投票改写单次预测。
// 2. 真值缺失/未复核/语义 unavailable（null）的样本不进入评估分母。
// 3. 预测侧非 assessed（unresolved/unavailable/not_applicable）计为诚实降级：
//    单独计数、降低 assessed coverage、不计作错误预测。
// 4. 可评估真值样本 < MIN_EVALUABLE_SAMPLES 时 status=NOT_EVALUABLE（不判 PASS、
//    不阻塞其他指标），但始终报告分子、分母与样本 ID，不伪造、不凑数。
const MIN_EVALUABLE_SAMPLES = 20;

/** v5 合同字段取值：analysis_structure.target_semantics.{field}.status/value；无结构返回 null。 */
function semanticFieldOf(result = {}, field) {
  const semantics = result?.analysis_structure?.target_semantics;
  const item = semantics && semantics[field];
  if (!item || typeof item !== 'object') return null;
  return { status: String(item.status || ''), value: item.value };
}

/** 逐次计分：按 entry.repeat 分组；无 repeat 时全部归入组 1。 */
function groupByRepeat(entries) {
  const groups = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const key = Number(entry?.repeat) > 0 ? Number(entry.repeat) : 1;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });
  return [...groups.entries()].sort((left, right) => left[0] - right[0]);
}

/** 数值序列 min/max/mean/stddev（样本方差，n-1 分母；n<2 时 stddev=null）。 */
function spread(values) {
  const normalized = values.map(Number).filter(Number.isFinite);
  if (!normalized.length) {
    return { values: [], min: null, max: null, mean: null, stddev: null };
  }
  const mean = normalized.reduce((sum, value) => sum + value, 0) / normalized.length;
  const variance = normalized.length > 1
    ? normalized.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (normalized.length - 1)
    : null;
  return {
    values: normalized,
    min: Math.min(...normalized),
    max: Math.max(...normalized),
    mean,
    stddev: variance === null ? null : Math.sqrt(variance)
  };
}

function truthFor(truthBySample, sampleId) {
  const truth = truthBySample.get(sampleId);
  return truth && truth.review_status === 'confirmed' ? truth : null;
}

/**
 * 推荐指标（issue 015）：precision/recall/F1 + assessed coverage。
 * - 真值 recommendation 必须是 boolean（null=unavailable 不评估）。
 * - 预测 assessed 时与真值比较（推荐=二分类）；非 assessed 计诚实降级，不计错误。
 */
function recommendationQualityStats(entries, truthBySample = new Map()) {
  const totals = { tp: 0, fp: 0, fn: 0 };
  let degraded = 0;
  const degradedDetails = [];
  let coverageDenominator = 0;
  const uniqueEvaluable = new Set();
  const perRepeat = {};
  groupByRepeat(entries).forEach(([repeat, groupEntries]) => {
    const group = { tp: 0, fp: 0, fn: 0, evaluable: 0, degraded: 0 };
    groupEntries.forEach((entry) => {
      if (!entry?.ok || !entry.result) return;
      const truth = truthFor(truthBySample, entry.sample_id);
      if (!truth || typeof truth.recommendation !== 'boolean') return;
      const pred = semanticFieldOf(entry.result, 'recommendation');
      // 目标未出现（truth.mentioned=false）时预测 not_applicable 是合同正常状态，
      // 不是降级：不进 coverage 分母、不计错误、不计降级。
      if (pred?.status === 'not_applicable' && truth.mentioned === false) return;
      group.evaluable += 1;
      uniqueEvaluable.add(entry.sample_id);
      if (!pred || pred.status !== 'assessed' || typeof pred.value !== 'boolean') {
        group.degraded += 1;
        degraded += 1;
        degradedDetails.push(`${entry.sample_id} r${entry.repeat}: ${pred ? pred.status : 'no_structure'}`);
        return;
      }
      const truthValue = truth.recommendation;
      if (pred.value === truthValue) {
        if (truthValue) { totals.tp += 1; group.tp += 1; }
      } else if (truthValue) {
        totals.fn += 1;
        group.fn += 1;
      } else {
        totals.fp += 1;
        group.fp += 1;
      }
    });
    coverageDenominator += group.evaluable;
    const stats = precisionRecallF1(group);
    perRepeat[repeat] = { ...stats, evaluable: group.evaluable, degraded: group.degraded };
  });
  const coverage = coverageDenominator > 0 ? (coverageDenominator - degraded) / coverageDenominator : null;
  const overall = precisionRecallF1(totals);
  const variance = spread(Object.values(perRepeat).map((group) => group.f1).filter((value) => value !== null));
  // 状态判定基于唯一已复核真值样本数（"至少 20 个已复核可评估实例"合同）；
  // accuracy/PRF 仍按逐次预测合并计分（重复不合并、不投票）。
  const status = uniqueEvaluable.size >= MIN_EVALUABLE_SAMPLES ? 'EVALUATED' : 'NOT_EVALUABLE';
  return {
    status,
    status_reason: status === 'NOT_EVALUABLE'
      ? `可评估推荐真值样本 ${uniqueEvaluable.size} < ${MIN_EVALUABLE_SAMPLES}`
      : null,
    evaluated_samples: uniqueEvaluable.size,
    predictions: coverageDenominator,
    sample_ids: [...uniqueEvaluable].sort(),
    coverage,
    degraded_count: degraded,
    degraded_details: degradedDetails,
    tp: totals.tp,
    fp: totals.fp,
    fn: totals.fn,
    ...overall,
    per_repeat: perRepeat,
    repeat_variance: { f1: variance }
  };
}

/**
 * 情绪指标（issue 015）：逐次预测准确率 + 3×3 混淆矩阵。
 * 真值 sentiment 必须是 positive/neutral/negative（null 不评估）；预测非 assessed 计降级。
 */
function sentimentQualityStats(entries, truthBySample = new Map()) {
  const totals = { correct: 0, evaluated: 0, degraded: 0 };
  const confusion = {};
  const degradedDetails = [];
  const uniqueEvaluable = new Set();
  const perRepeat = {};
  VALID_SENTIMENTS.forEach((truthLabel) => {
    confusion[truthLabel] = { positive: 0, neutral: 0, negative: 0 };
  });
  groupByRepeat(entries).forEach(([repeat, groupEntries]) => {
    const group = { correct: 0, evaluated: 0, degraded: 0 };
    groupEntries.forEach((entry) => {
      if (!entry?.ok || !entry.result) return;
      const truth = truthFor(truthBySample, entry.sample_id);
      if (!truth || !VALID_SENTIMENTS.has(truth.sentiment)) return;
      group.evaluated += 1;
      uniqueEvaluable.add(entry.sample_id);
      const pred = semanticFieldOf(entry.result, 'sentiment');
      if (!pred || pred.status !== 'assessed' || !VALID_SENTIMENTS.has(pred.value)) {
        group.degraded += 1;
        totals.degraded += 1;
        degradedDetails.push(`${entry.sample_id} r${entry.repeat}: ${pred ? pred.status : 'no_structure'}`);
        return;
      }
      totals.evaluated += 1;
      confusion[truth.sentiment][pred.value] += 1;
      if (pred.value === truth.sentiment) {
        totals.correct += 1;
        group.correct += 1;
      }
    });
    perRepeat[repeat] = {
      accuracy: group.evaluated ? group.correct / group.evaluated : null,
      evaluated: group.evaluated,
      degraded: group.degraded
    };
  });
  const predictions = totals.evaluated + totals.degraded;
  const coverage = predictions > 0 ? totals.evaluated / predictions : null;
  const variance = spread(Object.values(perRepeat).map((group) => group.accuracy).filter((value) => value !== null));
  const status = uniqueEvaluable.size >= MIN_EVALUABLE_SAMPLES ? 'EVALUATED' : 'NOT_EVALUABLE';
  return {
    status,
    status_reason: status === 'NOT_EVALUABLE'
      ? `可评估情绪真值样本 ${uniqueEvaluable.size} < ${MIN_EVALUABLE_SAMPLES}`
      : null,
    evaluated_samples: uniqueEvaluable.size,
    predictions,
    accuracy: totals.evaluated ? totals.correct / totals.evaluated : null,
    correct: totals.correct,
    coverage,
    degraded_count: totals.degraded,
    degraded_details: degradedDetails,
    confusion_matrix: confusion,
    per_repeat: perRepeat,
    repeat_variance: { accuracy: variance }
  };
}

/**
 * 排名指标（issue 015）：仅评估真值 rank 非空的样本，报告 exact accuracy。
 * 不人为扩充/伪造排名样本；样本不足时 NOT_EVALUABLE（不判 PASS、不阻塞其他指标），
 * 但始终报告分子、分母与样本 ID。
 */
function rankQualityStats(entries, truthBySample = new Map()) {
  const evaluableSampleIds = (Array.isArray(entries) ? entries : [])
    .filter((entry) => {
      const truth = truthFor(truthBySample, entry.sample_id);
      return Boolean(entry?.ok) && truth && Number.isInteger(truth.rank) && truth.rank > 0;
    })
    .map((entry) => entry.sample_id);
  const denominator = new Set(evaluableSampleIds).size;
  let exact = 0;
  let degraded = 0;
  const degradedDetails = [];
  const perRepeat = {};
  const totalEvaluated = { evaluated: 0 };
  groupByRepeat(entries).forEach(([repeat, groupEntries]) => {
    const group = { exact: 0, evaluated: 0, degraded: 0 };
    groupEntries.forEach((entry) => {
      if (!entry?.ok || !entry.result) return;
      const truth = truthFor(truthBySample, entry.sample_id);
      if (!truth || !Number.isInteger(truth.rank) || truth.rank < 1) return;
      group.evaluated += 1;
      totalEvaluated.evaluated += 1;
      const pred = semanticFieldOf(entry.result, 'rank');
      if (!pred || pred.status !== 'assessed') {
        group.degraded += 1;
        degraded += 1;
        degradedDetails.push(`${entry.sample_id} r${entry.repeat}: ${pred ? pred.status : 'no_structure'}`);
        return;
      }
      // assessed value=null 是合法判断（明确无排名）：与真值比较计错判，不计降级
      if (pred.value !== null && Number(pred.value) === Number(truth.rank)) {
        exact += 1;
        group.exact += 1;
      }
    });
    perRepeat[repeat] = {
      exact_accuracy: group.evaluated ? group.exact / group.evaluated : null,
      evaluated: group.evaluated,
      degraded: group.degraded
    };
  });
  const variance = spread(Object.values(perRepeat).map((group) => group.exact_accuracy).filter((value) => value !== null));
  const coverage = totalEvaluated.evaluated > 0
    ? (totalEvaluated.evaluated - degraded) / totalEvaluated.evaluated
    : null;
  return {
    status: denominator >= MIN_EVALUABLE_SAMPLES ? 'EVALUATED' : 'NOT_EVALUABLE',
    status_reason: denominator < MIN_EVALUABLE_SAMPLES
      ? `排名真值仅 ${denominator} 个可评估样本 < ${MIN_EVALUABLE_SAMPLES}；不伪造、不凑数`
      : null,
    denominator_samples: denominator,
    sample_ids: [...new Set(evaluableSampleIds)].sort(),
    exact_accuracy: totalEvaluated.evaluated ? exact / totalEvaluated.evaluated : null,
    exact_matches: exact,
    coverage,
    degraded_count: degraded,
    degraded_details: degradedDetails,
    per_repeat: perRepeat,
    repeat_variance: { exact_accuracy: variance }
  };
}

/**
 * 证据合法性与 grounding（issue 015 硬门槛）：
 * - evidence_reference_invalid：来自 diagnostics.error_codes（运行时机械校验
 *   已拒绝无效 source_id；评测器侧复计数作为门禁证据）。
 * - grounding：校验结构内全部 mention（target_mentions + mentions）的 span
 *   与冻结回答原文逐字匹配（绝对字符位置）；span 越界或文本不匹配计 grounding 错误。
 *   source_id 的段级合法性由运行时合同保证（无效引用会导致字段降级或整条错误）。
 */
function groundingEvidenceStats(entries, samplesById = new Map()) {
  const stats = { evaluated: 0, evidence_invalid_count: 0, grounding_error_count: 0, details: [] };
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry?.ok || !entry.result) return;
    const structure = entry.result.analysis_structure;
    if (!structure) return;
    stats.evaluated += 1;
    const codes = new Set((structure.diagnostics?.error_codes || []).map((item) => item?.code));
    if (codes.has('analysis_evidence_reference_invalid')) {
      stats.evidence_invalid_count += 1;
      stats.details.push(`${entry.sample_id} r${entry.repeat}: analysis_evidence_reference_invalid`);
    }
    const text = String(samplesById.get(entry.sample_id)?.response_text || '');
    const mentions = [
      ...(Array.isArray(structure.target_mentions) ? structure.target_mentions : []),
      ...(Array.isArray(structure.mentions) ? structure.mentions : [])
    ];
    mentions.forEach((mention) => {
      const start = Number(mention?.start);
      const end = Number(mention?.end);
      const surface = String(mention?.surface_form || '');
      const slice = text.slice(start, end);
      if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start || end > text.length || slice !== surface) {
        stats.grounding_error_count += 1;
        stats.details.push(`${entry.sample_id} r${entry.repeat}: mention ${mention?.source_id || ''} span 与原文不匹配`);
      }
    });
  });
  return stats;
}

/**
 * target_mapping 指标（issue 015）：分别统计状态判断准确率与成功映射准确率。
 * - 状态判断：预测 target_mapping.status 与真值 status 精确一致（含 conflicting_identity）。
 * - 成功映射：真值 target_mapped=false（conflicting_identity）时，预测不得把目标
 *   映射为已解析（resolved + 非空 target_entity_id）；真值 target_mapped=true 时
 *   预测必须已解析。预测侧无法确定映射时计诚实降级。
 */
function targetMappingQualityStats(entries, truthBySample = new Map()) {
  const totals = { status_evaluated: 0, status_correct: 0, mapped_evaluated: 0, mapped_correct: 0, degraded: 0 };
  const degradedDetails = [];
  const perRepeat = {};
  groupByRepeat(entries).forEach(([repeat, groupEntries]) => {
    const group = { status_evaluated: 0, status_correct: 0, mapped_evaluated: 0, mapped_correct: 0, degraded: 0 };
    groupEntries.forEach((entry) => {
      if (!entry?.ok || !entry.result) return;
      const truth = truthFor(truthBySample, entry.sample_id);
      const truthMapping = truth && truth.target_mapping;
      if (!truthMapping || typeof truthMapping !== 'object' || !truthMapping.status) return;
      const predicted = entry.result.analysis_structure?.target_mapping;
      if (!predicted || typeof predicted !== 'object') {
        group.degraded += 1;
        totals.degraded += 1;
        degradedDetails.push(`${entry.sample_id} r${entry.repeat}: no target_mapping structure`);
        return;
      }
      // 状态判断
      group.status_evaluated += 1;
      totals.status_evaluated += 1;
      if (String(predicted.status || '') === String(truthMapping.status)) {
        group.status_correct += 1;
        totals.status_correct += 1;
      }
      // 成功映射：仅当真值声明 target_mapped 时评估
      if (typeof truthMapping.target_mapped === 'boolean') {
        const predictedMapped = String(predicted.status || '') === 'resolved'
          && Boolean(String(predicted.target_entity_id || '').trim());
        group.mapped_evaluated += 1;
        totals.mapped_evaluated += 1;
        if (predictedMapped === truthMapping.target_mapped) {
          group.mapped_correct += 1;
          totals.mapped_correct += 1;
        }
      }
    });
    perRepeat[repeat] = {
      status_accuracy: group.status_evaluated ? group.status_correct / group.status_evaluated : null,
      mapped_accuracy: group.mapped_evaluated ? group.mapped_correct / group.mapped_evaluated : null,
      status_evaluated: group.status_evaluated,
      mapped_evaluated: group.mapped_evaluated,
      degraded: group.degraded
    };
  });
  const statusVariance = spread(Object.values(perRepeat).map((group) => group.status_accuracy).filter((value) => value !== null));
  const mappedVariance = spread(Object.values(perRepeat).map((group) => group.mapped_accuracy).filter((value) => value !== null));
  return {
    status: totals.status_evaluated >= MIN_EVALUABLE_SAMPLES ? 'EVALUATED' : 'NOT_EVALUABLE',
    status_reason: totals.status_evaluated < MIN_EVALUABLE_SAMPLES
      ? `target_mapping 真值样本 ${totals.status_evaluated} < ${MIN_EVALUABLE_SAMPLES}`
      : null,
    status_accuracy: totals.status_evaluated ? totals.status_correct / totals.status_evaluated : null,
    mapped_accuracy: totals.mapped_evaluated ? totals.mapped_correct / totals.mapped_evaluated : null,
    status_evaluated_samples: totals.status_evaluated,
    mapped_evaluated_samples: totals.mapped_evaluated,
    degraded_count: totals.degraded,
    degraded_details: degradedDetails,
    per_repeat: perRepeat,
    repeat_variance: { status_accuracy: statusVariance, mapped_accuracy: mappedVariance }
  };
}

function pairwiseDiff(left = [], right = []) {
  const pairs = Math.min(left.length, right.length);
  const diffs = [];
  for (let index = 0; index < pairs; index += 1) {
    const a = Number(left[index]);
    const b = Number(right[index]);
    if (Number.isFinite(a) && Number.isFinite(b)) diffs.push(b - a);
  }
  return {
    paired_pairs: pairs,
    diffs,
    mean_diff: diffs.length
      ? diffs.reduce((sum, value) => sum + value, 0) / diffs.length
      : null
  };
}

/**
 * 字段级状态与阶段 2 降级率（issue 013）。
 * 只统计 analysis_structure 提供的三轨与字段状态，不评价幸存样本，
 * 明确报告 assessed 可用率、unresolved/invalid/not_applicable 分布与降级率。
 */
function fieldStatusDistribution(entries) {
  const evaluated = [];
  const targetSemanticsDistribution = {};
  const recommendationDistribution = {};
  const rankDistribution = {};
  const sentimentDistribution = {};
  const competitionDistribution = {};
  let degradedCount = 0;
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry?.ok || !entry.result?.analysis_structure) return;
    const structure = entry.result.analysis_structure;
    const semantics = structure.target_semantics || {};
    const competition = structure.competition_analysis || {};
    evaluated.push(entry);
    targetSemanticsDistribution[semantics.status || 'unknown'] = (targetSemanticsDistribution[semantics.status || 'unknown'] || 0) + 1;
    ['recommendation', 'rank', 'sentiment'].forEach((field) => {
      const status = semantics[field]?.status || 'unknown';
      const distribution = field === 'recommendation'
        ? recommendationDistribution
        : (field === 'rank' ? rankDistribution : sentimentDistribution);
      distribution[status] = (distribution[status] || 0) + 1;
    });
    competitionDistribution[competition.status || 'unknown'] = (competitionDistribution[competition.status || 'unknown'] || 0) + 1;
    const stages = Array.isArray(structure.diagnostics?.stages) ? structure.diagnostics.stages : [];
    if (stages.some((stage) => stage?.degraded || stage?.stage === 'semantic_judge' && stage?.error_code)) {
      degradedCount += 1;
    }
  });
  // assessed 可用率 = target_semantics 总状态为 complete 的比例（三字段全已判断/不适用）
  const assessedCount = evaluated.filter((entry) => {
    const semantics = entry.result.analysis_structure.target_semantics || {};
    return semantics.status === 'complete';
  }).length;
  return {
    evaluated: evaluated.length,
    degraded_count: degradedCount,
    degradation_rate: evaluated.length ? degradedCount / evaluated.length : null,
    assessed_rate: evaluated.length ? assessedCount / evaluated.length : null,
    target_semantics_distribution: targetSemanticsDistribution,
    recommendation_distribution: recommendationDistribution,
    rank_distribution: rankDistribution,
    sentiment_distribution: sentimentDistribution,
    competition_distribution: competitionDistribution
  };
}

/**
 * 实体质量（issue 013 span-based）：先按原文 mention span 对齐预测实体与
 * truth 实体，再计分。逐字可定位但把多个品牌合成一个实体（merged）或无依据
 * 拆分（split）必须计错；canonicalization 只对 span 对齐正确的实体评估
 * 名称归一是否正确，不再因“仅名称精确匹配才进分母”而近似恒为 100%。
 * 真值缺失或未复核时 NOT_EVALUABLE。
 */
function extractPredictedEntities(result = {}) {
  const structure = result.analysis_structure;
  if (!structure || !Array.isArray(structure.entities)) return [];
  const mentionsByEntity = new Map();
  (Array.isArray(structure.mentions) ? structure.mentions : []).forEach((mention) => {
    if (!mention || !mention.entity_id) return;
    if (!mentionsByEntity.has(mention.entity_id)) mentionsByEntity.set(mention.entity_id, []);
    mentionsByEntity.get(mention.entity_id).push({
      start: Number(mention.start),
      end: Number(mention.end),
      surface_form: String(mention.surface_form || '')
    });
  });
  return structure.entities.map((entity) => ({
    name: String(entity?.name || '').trim(),
    surface_forms: (Array.isArray(entity?.surface_forms) ? entity.surface_forms : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
    mentions: mentionsByEntity.get(entity?.entity_id) || []
  })).filter((entity) => entity.name);
}

function spansOverlap(left, right) {
  return Number(left.start) < Number(right.end) && Number(right.start) < Number(left.end);
}

function alignedTruthEntities(predictedEntity, truthEntities) {
  const predictedMentions = Array.isArray(predictedEntity.mentions) ? predictedEntity.mentions : [];
  if (!predictedMentions.length) return [];
  return truthEntities.filter((truthEntity) => (
    (Array.isArray(truthEntity.mentions) ? truthEntity.mentions : []).some((truthMention) => (
      predictedMentions.some((predictedMention) => spansOverlap(predictedMention, truthMention))
    ))
  ));
}

function entityQualityStats(entries, truthBySample = new Map()) {
  const totals = { tp: 0, fp: 0, fn: 0, merged: 0, split: 0, canonical_ok: 0, canonical_evaluated: 0 };
  let evaluatedSamples = 0;
  let missingTruthSamples = 0;
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry?.ok || !entry.result) return;
    const predicted = extractPredictedEntities(entry.result);
    const truth = truthBySample.get(entry.sample_id);
    if (!truth || truth.review_status !== 'confirmed' || !Array.isArray(truth.entities)) {
      if (predicted.length) missingTruthSamples += 1;
      return;
    }
    evaluatedSamples += 1;
    const truthEntities = truth.entities;
    const matchedTruthNames = new Set();
    const truthHitCount = new Map();
    predicted.forEach((entity) => {
      const aligned = alignedTruthEntities(entity, truthEntities);
      if (aligned.length === 0) {
        totals.fp += 1;
        return;
      }
      if (aligned.length > 1) {
        // 组合实体：一个预测实体覆盖多个真值实体 -> 计 fp，被覆盖真值计 fn
        totals.merged += 1;
        totals.fp += 1;
        return;
      }
      const truthEntity = aligned[0];
      const truthName = String(truthEntity.canonical_name || '').trim();
      matchedTruthNames.add(truthName);
      const previousHits = truthHitCount.get(truthName) || 0;
      truthHitCount.set(truthName, previousHits + 1);
      if (previousHits > 0) {
        // 无依据拆分：多个预测实体对齐同一 truth 实体 -> 后续预测计 fp
        totals.split += 1;
        totals.fp += 1;
        return;
      }
      totals.tp += 1;
      totals.canonical_evaluated += 1;
      if (String(entity.name) === truthName) totals.canonical_ok += 1;
    });
    truthEntities.forEach((truthEntity) => {
      if (!matchedTruthNames.has(String(truthEntity.canonical_name || '').trim())) totals.fn += 1;
    });
  });
  if (!evaluatedSamples) {
    return {
      status: 'NOT_EVALUABLE',
      evaluated_samples: 0,
      reason: missingTruthSamples
        ? `缺少已复核实体真值（${missingTruthSamples} 个样本有输出但无 confirmed 真值）`
        : '无成功结果'
    };
  }
  const precision = totals.tp + totals.fp > 0 ? totals.tp / (totals.tp + totals.fp) : null;
  const recall = totals.tp + totals.fn > 0 ? totals.tp / (totals.tp + totals.fn) : null;
  const microF1 = precision !== null && recall !== null && precision + recall > 0
    ? (2 * precision * recall) / (precision + recall)
    : null;
  return {
    status: 'EVALUATED',
    evaluated_samples: evaluatedSamples,
    tp: totals.tp,
    fp: totals.fp,
    fn: totals.fn,
    precision,
    recall,
    micro_f1: microF1,
    canonicalization_accuracy: totals.canonical_evaluated
      ? totals.canonical_ok / totals.canonical_evaluated
      : null,
    merged_entity_count: totals.merged,
    split_entity_count: totals.split
  };
}

/**
 * 已输出竞品关系真实计分（issue 013 P0 修复）：预测关系（entity_id -> relation）
 * 与 truth relations 计算 TP/FP/FN 与 micro precision/recall/F1。
 * 覆盖样本数达标不等于关系正确；关系全错时 precision 必须为 0，不能 PASS。
 */
function relationQualityStats(entries, truthBySample = new Map()) {
  const totals = { tp: 0, fp: 0, fn: 0 };
  let evaluatedSamples = 0;
  let missingTruthSamples = 0;
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry?.ok || !entry.result) return;
    const structure = entry.result.analysis_structure;
    const truth = truthBySample.get(entry.sample_id);
    if (!truth || truth.review_status !== 'confirmed' || !Array.isArray(truth.relations)) {
      if (structure) missingTruthSamples += 1;
      return;
    }
    if (!structure || !Array.isArray(structure.entities) || !Array.isArray(structure.competitor_relations)) {
      return;
    }
    evaluatedSamples += 1;
    const nameById = new Map(structure.entities.map((entity) => [
      entity.entity_id,
      String(entity?.name || '').trim()
    ]));
    // P1：预测实体先按 mention span 对齐 truth 实体，再用对齐后的 truth
    // canonical_name 与真值关系比较；归一化差异（杭州海康威视 vs 海康威视
    // 同一 span）不误判为关系错误。
    const predictedEntities = extractPredictedEntities(entry.result);
    const truthEntities = Array.isArray(truth.entities) ? truth.entities : [];
    const predicted = new Set();
    structure.competitor_relations.forEach((relation) => {
      const predictedName = nameById.get(relation.entity_id);
      if (!predictedName) return;
      const predictedEntity = predictedEntities.find((entity) => entity.name === predictedName);
      const aligned = predictedEntity
        ? alignedTruthEntities(predictedEntity, truthEntities)
        : [];
      if (aligned.length !== 1) {
        // 第三轮 P1：预测关系没有可对齐的 span（或无唯一对齐）时不得仅凭名称
        // 字符串判 TP——关系 correctness 只按 span 对齐后的 truth 实体计，
        // 不把 canonical name 字符串一致性混入关系 correctness；无对齐依据计 FP。
        totals.fp += 1;
        return;
      }
      predicted.add(`${String(aligned[0].canonical_name || '').trim()}::${relation.relation}`);
    });
    const expected = new Set((Array.isArray(truth.relations) ? truth.relations : [])
      .map((relation) => `${String(relation.canonical_name || '').trim()}::${relation.relation}`)
      .filter(Boolean));
    predicted.forEach((key) => {
      if (expected.has(key)) totals.tp += 1;
      else totals.fp += 1;
    });
    expected.forEach((key) => {
      if (!predicted.has(key)) totals.fn += 1;
    });
  });
  if (!evaluatedSamples) {
    return {
      status: 'NOT_EVALUABLE',
      evaluated_samples: 0,
      reason: missingTruthSamples ? '缺少已复核关系真值' : '无成功结果'
    };
  }
  const precision = totals.tp + totals.fp > 0 ? totals.tp / (totals.tp + totals.fp) : null;
  const recall = totals.tp + totals.fn > 0 ? totals.tp / (totals.tp + totals.fn) : null;
  const microF1 = precision !== null && recall !== null && precision + recall > 0
    ? (2 * precision * recall) / (precision + recall)
    : null;
  return {
    status: 'EVALUATED',
    evaluated_samples: evaluatedSamples,
    tp: totals.tp,
    fp: totals.fp,
    fn: totals.fn,
    precision,
    recall,
    micro_f1: microF1
  };
}

function answerSha256(text) {
  return require('node:crypto').createHash('sha256').update(String(text || '')).digest('hex');
}

/**
 * truth schema v3 严格校验（issue 013 P1 修复）：缺字段、哈希不匹配、
 * 重复 canonical_name、relation 引用悬空、span 与原文不一致、
 * 未在冻结语料中的 sample_id 均返回错误；调用方必须 fail-closed。
 */
const VALID_ENTITY_TYPES = new Set(['brand', 'company', 'other_organization']);
const VALID_SENTIMENTS = new Set(['positive', 'neutral', 'negative']);
// 第三轮：truth 目标映射真值 status 与运行时 target_mapping 合同一致，
// 另加 conflicting_identity（确定性命中的是身份冲突的其他主体，如 S53 的
// 深圳市广拓科技有限公司 vs 目标上海广拓/Gato）
const VALID_TARGET_MAPPING_STATUSES = new Set([
  'resolved',
  'not_applicable',
  'ambiguous',
  'unavailable',
  'invalid_input',
  'conflicting_identity'
]);

function validateTruthEntry(entry, sampleById = new Map()) {
  const errors = [];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return ['truth 条目必须是对象'];
  }
  if (!String(entry.sample_id || '').trim()) errors.push('缺少 sample_id');
  if (!['confirmed', 'pending_review'].includes(entry.review_status)) {
    errors.push(`review_status 无效: ${String(entry.review_status)}`);
  }
  if (entry.review_status === 'confirmed') {
    if (!String(entry.reviewer || '').trim()) errors.push('confirmed 必须记录 reviewer');
    if (!String(entry.reviewed_at || '').trim()) errors.push('confirmed 必须记录 reviewed_at');
    // 第三轮 P0：confirmed 必须提供全部目标字段，loader 的 Boolean()/Number() 兜底
    // 不得掩盖字段缺失。recommendation/rank/sentiment 允许 null——目标语义
    // unavailable 时无推荐/排名/情绪真值（S53 拆分合同），null 是合法语义值；
    // mentioned/mentions 是确定性 target_fact 核心字段，confirmed 不允许 null。
    ['mentioned', 'mentions', 'recommendation', 'rank', 'sentiment'].forEach((field) => {
      if (entry[field] === undefined) errors.push(`confirmed 必须提供目标字段 ${field}`);
    });
    ['mentioned', 'mentions'].forEach((field) => {
      if (entry[field] === null) errors.push(`confirmed 的 ${field} 必须提供非 null 值`);
    });
  }
  // P0：truth_version 与 dispute 必填（版本化数据集合同）
  if (!/^truth_v\d+/.test(String(entry.truth_version || ''))) {
    errors.push(`truth_version 无效: ${String(entry.truth_version)}`);
  }
  if (entry.dispute === undefined || entry.dispute === null || !String(entry.dispute || '').trim()) {
    errors.push('dispute 必须记录（无争议填 none）');
  }
  if (!/^[a-f0-9]{64}$/i.test(String(entry.answer_sha256 || ''))) {
    errors.push('answer_sha256 必须是 64 位 hex');
  }
  // P0：目标字段严格类型校验——字符串 "false" 会被 Boolean() 强转 true，必须拒绝
  if (entry.mentioned !== undefined && entry.mentioned !== null && typeof entry.mentioned !== 'boolean') {
    errors.push(`mentioned 必须是 boolean: ${JSON.stringify(entry.mentioned)}`);
  }
  if (entry.mentions !== undefined && entry.mentions !== null) {
    if (!Number.isInteger(entry.mentions) || entry.mentions < 0) {
      errors.push(`mentions 必须是非负整数: ${JSON.stringify(entry.mentions)}`);
    }
  }
  if (entry.recommendation !== undefined && entry.recommendation !== null
    && typeof entry.recommendation !== 'boolean') {
    errors.push(`recommendation 必须是 boolean: ${JSON.stringify(entry.recommendation)}`);
  }
  if (entry.rank !== undefined && entry.rank !== null && entry.rank !== 'none') {
    if (!Number.isInteger(entry.rank) || entry.rank < 1) {
      errors.push(`rank 必须是 null 或正整数: ${JSON.stringify(entry.rank)}`);
    }
  }
  if (entry.sentiment !== undefined && entry.sentiment !== null && entry.sentiment !== 'none'
    && !VALID_SENTIMENTS.has(entry.sentiment)) {
    errors.push(`sentiment 必须是 null 或 positive/neutral/negative: ${JSON.stringify(entry.sentiment)}`);
  }
  // 目标未出现时的字段组合约束
  if (entry.mentioned === false) {
    if (Number(entry.mentions) !== 0) errors.push('mentioned=false 时 mentions 必须为 0');
    if (entry.recommendation !== false) errors.push('mentioned=false 时 recommendation 必须为 false');
    if (entry.rank !== null && entry.rank !== undefined) errors.push('mentioned=false 时 rank 必须为 null');
    if (entry.sentiment !== null && entry.sentiment !== undefined) errors.push('mentioned=false 时 sentiment 必须为 null');
  }
  // 第三轮：truth 目标映射真值（可选，争议样本如 S53 必须提供）。
  // conflicting_identity 表示确定性命中但身份冲突：target_fact 必须 mentioned=true
  if (entry.target_mapping !== undefined && entry.target_mapping !== null) {
    if (typeof entry.target_mapping !== 'object' || Array.isArray(entry.target_mapping)) {
      errors.push('target_mapping 必须是对象');
    } else {
      if (!VALID_TARGET_MAPPING_STATUSES.has(entry.target_mapping.status)) {
        errors.push(`target_mapping.status 无效: ${String(entry.target_mapping.status)}`);
      }
      if (entry.target_mapping.status === 'conflicting_identity' && entry.mentioned !== true) {
        errors.push('target_mapping=conflicting_identity 时 target_fact.mentioned 必须为 true');
      }
    }
  }
  const sample = entry.sample_id ? sampleById.get(entry.sample_id) : undefined;
  if (!sample) {
    errors.push(`sample_id 未在冻结语料中: ${entry.sample_id}`);
  } else if (answerSha256(sample.response_text) !== String(entry.answer_sha256 || '').toLowerCase()) {
    errors.push(`answer_sha256 与冻结回答不一致: ${entry.sample_id}`);
  }
  if (!Array.isArray(entry.entities)) {
    errors.push('entities 必须是数组');
  } else {
    const names = new Set();
    entry.entities.forEach((entity, index) => {
      const field = `entities[${index}]`;
      if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
        errors.push(`${field} 必须是对象`);
        return;
      }
      const name = String(entity.canonical_name || '').trim();
      if (!name) errors.push(`${field}.canonical_name 缺失`);
      else if (names.has(name)) errors.push(`${field}.canonical_name 重复: ${name}`);
      names.add(name);
      if (!Array.isArray(entity.surface_forms) || !entity.surface_forms.length) {
        errors.push(`${field}.surface_forms 必须非空`);
      }
      // P1：实体 type 必须提供且属于 brand/company/other_organization
      //（第三轮：type 缺失同样拒绝，不能只校验"存在时的枚举"）
      const entityType = String(entity.type || '').trim();
      if (!entityType) {
        errors.push(`${field}.type 缺失（必须是 brand/company/other_organization）`);
      } else if (!VALID_ENTITY_TYPES.has(entityType)) {
        errors.push(`${field}.type 必须是 brand/company/other_organization: ${entity.type}`);
      }
      if (!Array.isArray(entity.mentions)) {
        errors.push(`${field}.mentions 必须是数组`);
      } else {
        entity.mentions.forEach((mention, j) => {
          const mentionField = `${field}.mentions[${j}]`;
          if (!mention || typeof mention !== 'object' || Array.isArray(mention)) {
            errors.push(`${mentionField} 必须是对象`);
            return;
          }
          if (!sample) return;
          const text = String(sample.response_text || '');
          const start = Number(mention.start);
          const end = Number(mention.end);
          const surface = String(mention.surface_form || '');
          if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > text.length || end <= start) {
            errors.push(`${mentionField} span 无效`);
          } else if (text.slice(start, end) !== surface) {
            errors.push(`${mentionField} span 与 surface_form 不一致`);
          }
        });
      }
    });
  }
  if (!Array.isArray(entry.relations)) {
    errors.push('relations 必须是数组');
  } else {
    const names = new Set((Array.isArray(entry.entities) ? entry.entities : [])
      .map((entity) => String(entity?.canonical_name || '').trim())
      .filter(Boolean));
    entry.relations.forEach((relation, index) => {
      const field = `relations[${index}]`;
      if (!relation || typeof relation !== 'object' || Array.isArray(relation)) {
        errors.push(`${field} 必须是对象`);
        return;
      }
      if (!names.has(String(relation.canonical_name || '').trim())) {
        errors.push(`${field}.canonical_name 未在 entities 中: ${relation.canonical_name}`);
      }
      if (!['competitor', 'non_competitor'].includes(relation.relation)) {
        errors.push(`${field}.relation 无效: ${relation.relation}`);
      }
    });
  }
  return errors;
}

/**
 * 语义真值覆盖（issue 013）：推荐/排名/情绪/已输出竞品关系各自至少 20 个
 * 已复核可评估实例；不足时对应项 pass=false，benchmark 必须输出 NOT EVALUABLE。
 */
function semanticTruthCoverage(truthBySample = new Map()) {
  const counts = { recommendation: 0, rank: 0, sentiment: 0, relations: 0 };
  truthBySample.forEach((truth) => {
    if (!truth || truth.review_status !== 'confirmed') return;
    if (typeof truth.recommendation === 'boolean') counts.recommendation += 1;
    if (truth.rank !== null && truth.rank !== undefined && truth.rank !== 'none') counts.rank += 1;
    if (truth.sentiment && truth.sentiment !== 'none') counts.sentiment += 1;
    if (Array.isArray(truth.relations) && truth.relations.length) counts.relations += 1;
  });
  return Object.fromEntries(Object.entries(counts).map(([key, count]) => [
    key,
    { count, pass: count >= 20 }
  ]));
}

function summarizeArm(entries, labels = new Map()) {
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  const completedEntries = normalizedEntries.filter((entry) => entry?.ok && entry.result);
  let targetPresenceEvaluated = 0;
  let targetPresenceCorrect = 0;
  let targetFalsePositives = 0;
  completedEntries.forEach((entry) => {
    const label = labels.get(entry.sample_id);
    if (!label || typeof label.mentioned !== 'boolean') return;
    targetPresenceEvaluated += 1;
    const actual = Boolean(entry.result.brand_mentioned);
    if (actual === label.mentioned) targetPresenceCorrect += 1;
    if (actual && !label.mentioned) targetFalsePositives += 1;
  });
  const stable = stability(normalizedEntries);
  const competitorStable = competitionStability(normalizedEntries);
  return {
    total: normalizedEntries.length,
    completed: completedEntries.length,
    completion_rate: normalizedEntries.length
      ? completedEntries.length / normalizedEntries.length
      : null,
    target_presence_evaluated: targetPresenceEvaluated,
    target_presence_correct: targetPresenceCorrect,
    target_presence_accuracy: targetPresenceEvaluated
      ? targetPresenceCorrect / targetPresenceEvaluated
      : null,
    target_false_positives: targetFalsePositives,
    stability_pairs: stable.pairs,
    stability_agreements: stable.agreements,
    stability_rate: stable.rate,
    competition_jaccard: competitorStable,
    tokens: distribution(normalizedEntries.map((entry) => entry.total_tokens)),
    latency_ms: distribution(normalizedEntries.map((entry) => entry.duration_ms))
  };
}

module.exports = {
  MIN_EVALUABLE_SAMPLES,
  answerSha256,
  competitionJaccard,
  distribution,
  entityQualityStats,
  fieldStatusDistribution,
  groundingEvidenceStats,
  groupByRepeat,
  metricSignature,
  pairwiseDiff,
  percentile,
  precisionRecallF1,
  rankQualityStats,
  recommendationQualityStats,
  relationQualityStats,
  semanticFieldOf,
  semanticTruthCoverage,
  sentimentQualityStats,
  spread,
  summarizeArm,
  targetMappingQualityStats,
  validateTruthEntry
};
