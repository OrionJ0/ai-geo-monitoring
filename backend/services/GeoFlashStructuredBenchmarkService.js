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
  const f1 = precision !== null && recall !== null && precision + recall > 0
    ? (2 * precision * recall) / (precision + recall)
    : null;
  return { precision, recall, f1 };
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
 * 实体质量（issue 013）：在已复核真值上评估实体 precision/recall/micro-F1 与
 * canonicalization。逐字可定位但把多个品牌合成一个实体、或无依据拆分的实体
 * 必须计错，grounding 不能替代实体正确性。真值缺失或未复核时 NOT_EVALUABLE。
 */
function extractPredictedEntities(result = {}) {
  const structure = result.analysis_structure;
  if (!Array.isArray(structure?.entities)) return [];
  return structure.entities.map((entity) => ({
    name: String(entity?.name || '').trim(),
    surface_forms: (Array.isArray(entity?.surface_forms) ? entity.surface_forms : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  })).filter((entity) => entity.name);
}

function entityQualityStats(entries, truthBySample = new Map()) {
  const totals = { tp: 0, fp: 0, fn: 0, merged: 0, split: 0 };
  let evaluatedSamples = 0;
  let missingTruthSamples = 0;
  let canonicalMatched = 0;
  let canonicalEvaluated = 0;
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry?.ok || !entry.result) return;
    const predicted = extractPredictedEntities(entry.result);
    const truth = truthBySample.get(entry.sample_id);
    if (!truth || truth.review_status !== 'confirmed' || !Array.isArray(truth.entities)) {
      if (predicted.length) missingTruthSamples += 1;
      return;
    }
    evaluatedSamples += 1;
    const expectedNames = truth.entities.map((entity) => String(entity.canonical_name || '').trim()).filter(Boolean);
    const predictedNames = predicted.map((entity) => entity.name);
    predictedNames.forEach((name) => {
      if (expectedNames.includes(name)) {
        totals.tp += 1;
        const truthEntity = truth.entities.find((entity) => entity.canonical_name === name);
        canonicalEvaluated += 1;
        if (truthEntity && name === String(truthEntity.canonical_name || '').trim()) canonicalMatched += 1;
      } else {
        totals.fp += 1;
      }
    });
    expectedNames.forEach((name) => {
      if (!predictedNames.includes(name)) totals.fn += 1;
    });
    // 组合实体：一个预测实体覆盖多个真值实体（surface 词或 name 包含多个真值 canonical）
    predicted.forEach((entity) => {
      const hits = expectedNames.filter((name) => (
        entity.name === name
        || entity.surface_forms.some((surface) => surface.includes(name) || name.includes(surface))
      ));
      if (hits.length > 1) totals.merged += 1;
    });
    // 无依据拆分：一个真值 canonical 被多个预测实体覆盖
    expectedNames.forEach((name) => {
      const covering = predicted.filter((entity) => (
        entity.name === name
        || entity.surface_forms.some((surface) => surface.includes(name) || name.includes(surface))
      ));
      if (covering.length > 1) totals.split += 1;
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
    canonicalization_accuracy: canonicalEvaluated ? canonicalMatched / canonicalEvaluated : null,
    merged_entity_count: totals.merged,
    split_entity_count: totals.split
  };
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
  competitionJaccard,
  distribution,
  entityQualityStats,
  fieldStatusDistribution,
  metricSignature,
  pairwiseDiff,
  percentile,
  precisionRecallF1,
  semanticTruthCoverage,
  summarizeArm
};
